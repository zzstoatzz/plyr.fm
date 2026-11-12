use std::{path::Path, process::Stdio, time::Duration};

use anyhow::{bail, Context};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::{
    fs::File,
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use super::{Attempt, Receipt, Runner, PART_BYTES};

pub(super) async fn process(runner: &Runner, attempt: &Attempt) -> anyhow::Result<()> {
    let directory = tempfile::tempdir()?;
    let input = directory.path().join("source");
    let output = directory.path().join("rendition.mp3");
    download(runner, attempt, &input).await?;
    encode(&input, &output, attempt.output_budget).await?;
    upload(runner, attempt, &output).await
}

async fn download(runner: &Runner, attempt: &Attempt, path: &Path) -> anyhow::Result<()> {
    let mut response = runner
        .request(attempt, reqwest::Method::GET, "source")
        .send()
        .await?
        .error_for_status()?;
    if response.content_length() != Some(attempt.source_bytes) {
        bail!("source length does not match reservation");
    }
    let mut file = File::create(path).await?;
    let mut size = 0_u64;
    while let Some(chunk) = response.chunk().await? {
        size += chunk.len() as u64;
        if size > attempt.source_bytes {
            bail!("source exceeds reservation");
        }
        file.write_all(&chunk).await?;
    }
    if size != attempt.source_bytes {
        bail!("incomplete source");
    }
    file.flush().await?;
    Ok(())
}

async fn encode(input: &Path, output: &Path, budget: u64) -> anyhow::Result<()> {
    let mut child = Command::new("ffmpeg")
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(input)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-acodec",
            "libmp3lame",
            "-b:a",
            "320k",
            "-ar",
            "44100",
            "-f",
            "mp3",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("cannot start encoder")?;
    let mut stdout = child.stdout.take().context("encoder output unavailable")?;
    let mut file = File::create(output).await?;
    let size = copy_bounded(&mut stdout, &mut file, budget).await?;
    if !child.wait().await?.success() || size == 0 {
        bail!("encoding failed");
    }
    file.flush().await?;
    Ok(())
}

async fn copy_bounded(
    reader: &mut (impl AsyncRead + Unpin),
    file: &mut File,
    budget: u64,
) -> anyhow::Result<u64> {
    let mut buffer = [0_u8; 65536];
    let mut size = 0_u64;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(size);
        }
        size += count as u64;
        if size > budget {
            bail!("rendition exceeds admitted output budget");
        }
        file.write_all(&buffer[..count]).await?;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Completion {
    size_bytes: u64,
    content_type: &'static str,
    parts: Vec<Receipt>,
}

async fn upload(runner: &Runner, attempt: &Attempt, path: &Path) -> anyhow::Result<()> {
    let mut file = File::open(path).await?;
    let size = file.metadata().await?.len();
    if size == 0 || size > attempt.output_budget {
        bail!("invalid rendition size");
    }
    let mut parts = Vec::new();
    let mut remaining = size;
    while remaining > 0 {
        let length = remaining.min(PART_BYTES as u64) as usize;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes).await?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let number = parts.len() + 1;
        runner
            .request(attempt, reqwest::Method::PUT, &format!("parts/{number}"))
            .header("X-Part-SHA256", &sha256)
            .header("Content-Type", "application/octet-stream")
            .timeout(Duration::from_secs(120))
            .body(bytes)
            .send()
            .await?
            .error_for_status()?;
        parts.push(Receipt { number, sha256 });
        remaining -= length as u64;
    }
    runner
        .request(attempt, reqwest::Method::POST, "complete")
        .timeout(Duration::from_secs(30))
        .json(&Completion {
            size_bytes: size,
            content_type: "audio/mpeg",
            parts,
        })
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Bytes,
        extract::State,
        http::HeaderMap,
        routing::{post, put},
        Json, Router,
    };
    use std::sync::Arc;
    use tokio::{net::TcpListener, sync::Mutex};

    #[tokio::test]
    async fn real_encoder_honors_output_budget() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("source.wav");
        let output = directory.path().join("output.mp3");
        let samples = 16000_u32;
        let mut wav = b"RIFF".to_vec();
        wav.extend((36 + samples).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16_u32.to_le_bytes());
        wav.extend([1, 0, 1, 0]);
        wav.extend(8000_u32.to_le_bytes());
        wav.extend(16000_u32.to_le_bytes());
        wav.extend([2, 0, 16, 0]);
        wav.extend(b"data");
        wav.extend(samples.to_le_bytes());
        wav.resize(wav.len() + samples as usize, 0);
        tokio::fs::write(&input, wav).await.unwrap();
        assert!(encode(&input, &output, 100_000).await.is_ok());
        assert!(
            File::open(&output)
                .await
                .unwrap()
                .metadata()
                .await
                .unwrap()
                .len()
                > 10_000
        );
        assert!(encode(&input, &output, 100).await.is_err());
    }

    #[derive(Default)]
    struct Observed {
        lengths: Vec<usize>,
        completed: bool,
    }

    async fn part(
        State(state): State<Arc<Mutex<Observed>>>,
        headers: HeaderMap,
        bytes: Bytes,
    ) -> axum::http::StatusCode {
        assert_eq!(
            headers["authorization"],
            format!("Bearer {}", "x".repeat(32))
        );
        assert_eq!(
            headers["x-part-sha256"],
            format!("{:x}", Sha256::digest(&bytes))
        );
        assert_eq!(
            headers["content-length"]
                .to_str()
                .unwrap()
                .parse::<usize>()
                .unwrap(),
            bytes.len()
        );
        state.lock().await.lengths.push(bytes.len());
        axum::http::StatusCode::NO_CONTENT
    }

    async fn complete(
        State(state): State<Arc<Mutex<Observed>>>,
        Json(value): Json<serde_json::Value>,
    ) -> axum::http::StatusCode {
        assert_eq!(value["sizeBytes"], PART_BYTES + 123);
        assert_eq!(value["parts"].as_array().unwrap().len(), 2);
        state.lock().await.completed = true;
        axum::http::StatusCode::NO_CONTENT
    }

    #[tokio::test]
    async fn actual_http_output_uses_bounded_parts_and_ordered_completion() {
        let state = Arc::new(Mutex::new(Observed::default()));
        let app = Router::new()
            .route("/v1/processing/:id/:generation/parts/:number", put(part))
            .route("/v1/processing/:id/:generation/complete", post(complete))
            .layer(axum::extract::DefaultBodyLimit::max(PART_BYTES))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let runner = Runner {
            origin: origin.parse().unwrap(),
            auth: "test".into(),
            client: reqwest::Client::new(),
            active: Mutex::new(None),
        };
        let attempt = Attempt {
            upload_id: "12345678-1234-1234-1234-123456789abc".into(),
            generation: 1,
            source_bytes: 1,
            output_budget: (PART_BYTES + 123) as u64,
            recipe: super::super::RECIPE.into(),
            capability: "x".repeat(32),
        };
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rendition");
        let file = File::create(&path).await.unwrap();
        file.set_len((PART_BYTES + 123) as u64).await.unwrap();
        upload(&runner, &attempt, &path).await.unwrap();
        let observed = state.lock().await;
        assert_eq!(observed.lengths, [PART_BYTES, 123]);
        assert!(observed.completed);
        server.abort();
    }

    #[tokio::test]
    async fn output_budget_never_publishes_a_truncated_success() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("output");
        let mut file = File::create(&path).await.unwrap();
        assert!(copy_bounded(&mut &b"123456"[..], &mut file, 5)
            .await
            .is_err());
        assert_eq!(file.metadata().await.unwrap().len(), 0);
        assert_eq!(
            copy_bounded(&mut &b"12345"[..], &mut file, 5)
                .await
                .unwrap(),
            5
        );
    }
}
