use std::{path::Path, process::Stdio, time::Duration};

use anyhow::{bail, Context};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::{
    fs::File,
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use super::{accepted, Attempt, Receipt, Runner, PART_BYTES};

pub(super) async fn process(runner: &Runner, attempt: &Attempt) -> anyhow::Result<()> {
    let directory = tempfile::tempdir_in(&runner.scratch)?;
    let scratch = directory.path().to_owned();
    let available = tokio::task::spawn_blocking(move || fs2::available_space(scratch)).await??;
    require_scratch(available, attempt.source_bytes, attempt.output_budget)?;
    let input = directory.path().join("source");
    let output = directory.path().join("rendition.mp3");
    download(runner, attempt, &input).await?;
    encode(&input, &output, attempt.output_budget).await?;
    let duration = duration(&output).await?;
    upload(runner, attempt, &output, duration).await
}

fn require_scratch(available: u64, source: u64, output: u64) -> anyhow::Result<()> {
    if available
        < source
            .checked_add(output)
            .context("invalid scratch reservation")?
    {
        bail!("insufficient scratch capacity for source and rendition");
    }
    Ok(())
}

async fn download(runner: &Runner, attempt: &Attempt, path: &Path) -> anyhow::Result<()> {
    let mut response = accepted(
        runner
            .request(attempt, reqwest::Method::GET, "source")
            .send()
            .await?,
    )?;
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
        .args([
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mp3,wav,flac,ogg,mov,aac,aiff,matroska,webm",
            "-i",
        ])
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
    duration: u32,
    content_type: &'static str,
    parts: Vec<Receipt>,
}

async fn duration(path: &Path) -> anyhow::Result<u32> {
    tokio::time::timeout(Duration::from_secs(15), probe_duration(path))
        .await
        .context("duration probe timed out")?
}

async fn probe_duration(path: &Path) -> anyhow::Result<u32> {
    let mut child = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mp3",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child.stdout.take().context("probe output unavailable")?;
    let mut bytes = Vec::with_capacity(65);
    (&mut stdout).take(65).read_to_end(&mut bytes).await?;
    if bytes.len() > 64 {
        bail!("duration probe output exceeded limit");
    }
    if !child.wait().await?.success() {
        bail!("rendition duration unavailable");
    }
    let seconds: f64 = std::str::from_utf8(&bytes)?.trim().parse()?;
    if !seconds.is_finite() || seconds <= 0.0 || seconds.round() > u32::MAX as f64 {
        bail!("invalid rendition duration");
    }
    Ok(seconds.round() as u32)
}

async fn upload(
    runner: &Runner,
    attempt: &Attempt,
    path: &Path,
    duration: u32,
) -> anyhow::Result<()> {
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
        accepted(
            runner
                .request(attempt, reqwest::Method::PUT, &format!("parts/{number}"))
                .header("X-Part-SHA256", &sha256)
                .header("Content-Type", "application/octet-stream")
                .timeout(Duration::from_secs(120))
                .body(bytes)
                .send()
                .await?,
        )?;
        parts.push(Receipt { number, sha256 });
        remaining -= length as u64;
    }
    accepted(
        runner
            .request(attempt, reqwest::Method::POST, "complete")
            .timeout(Duration::from_secs(30))
            .json(&Completion {
                size_bytes: size,
                duration,
                content_type: "audio/mpeg",
                parts,
            })
            .send()
            .await?,
    )?;
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
        for extension in ["mp3", "flac", "ogg", "m4a", "aac", "aif", "aiff", "webm"] {
            let converted = directory.path().join(format!("source.{extension}"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-i"])
                .arg(&input)
                .arg(&converted)
                .status()
                .await
                .unwrap()
                .success());
            assert!(
                encode(&converted, &output, 100_000).await.is_ok(),
                "{extension}"
            );
            assert!(
                (1..=2).contains(&duration(&output).await.unwrap()),
                "{extension}"
            );
        }
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
        assert_eq!(value["duration"], 1);
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
            scratch: std::env::temp_dir(),
            heartbeat_interval: Duration::from_secs(20),
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
        upload(&runner, &attempt, &path, 1).await.unwrap();
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

    #[test]
    fn scratch_requires_both_retained_files() {
        assert!(require_scratch(300, 150, 150).is_ok());
        assert!(require_scratch(299, 150, 150).is_err());
        assert!(require_scratch(u64::MAX, u64::MAX, 1).is_err());
    }

    #[tokio::test]
    async fn manifests_cannot_open_external_sources() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let reads = Arc::new(AtomicUsize::new(0));
        let observed = reads.clone();
        let app = Router::new().route(
            "/segment.wav",
            axum::routing::get(move || {
                let reads = observed.clone();
                async move {
                    reads.fetch_add(1, Ordering::SeqCst);
                    "not audio"
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("manifest");
        let output = directory.path().join("output.mp3");
        tokio::fs::write(&input, format!("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://{address}/segment.wav\n#EXT-X-ENDLIST\n")).await.unwrap();
        assert!(encode(&input, &output, 100_000).await.is_err());
        assert_eq!(reads.load(Ordering::SeqCst), 0);
        let wav = directory.path().join("local.wav");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=8000:cl=mono",
                "-t",
                "0.1",
            ])
            .arg(&wav)
            .status()
            .await
            .unwrap();
        assert!(generated.success());
        tokio::fs::write(&input, "ffconcat version 1.0\nfile 'local.wav'\n")
            .await
            .unwrap();
        assert!(encode(&input, &output, 100_000).await.is_err());
        server.abort();
    }
}
