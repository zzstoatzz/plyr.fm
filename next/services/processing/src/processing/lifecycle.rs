use std::{
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::{Context, Poll},
    time::Duration,
};

use axum::{
    body::Body,
    extract::State,
    http::{Response, StatusCode},
    routing::{get, post},
    Router,
};
use tokio::{
    io::{AsyncRead, AsyncWriteExt, DuplexStream, ReadBuf},
    net::TcpListener,
    sync::{Mutex, Notify},
};
use tokio_util::io::ReaderStream;

use super::{execute, run, Attempt, Runner, RECIPE};

struct HeldSource {
    reader: DuplexStream,
    closed: Arc<Notify>,
}
impl AsyncRead for HeldSource {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.reader).poll_read(cx, buffer)
    }
}
impl Drop for HeldSource {
    fn drop(&mut self) {
        self.closed.notify_one();
    }
}

struct Fixture {
    reading: AtomicBool,
    writer: Mutex<Option<DuplexStream>>,
    closed: Arc<Notify>,
}

async fn heartbeat(State(fixture): State<Arc<Fixture>>) -> StatusCode {
    if fixture.reading.load(Ordering::SeqCst) {
        StatusCode::CONFLICT
    } else {
        StatusCode::NO_CONTENT
    }
}

async fn source(State(fixture): State<Arc<Fixture>>) -> Response<Body> {
    let (mut writer, reader) = tokio::io::duplex(1024);
    writer.write_all(b"x").await.unwrap();
    *fixture.writer.lock().await = Some(writer);
    fixture.reading.store(true, Ordering::SeqCst);
    Response::builder()
        .header("content-length", "100")
        .body(Body::from_stream(ReaderStream::new(HeldSource {
            reader,
            closed: fixture.closed.clone(),
        })))
        .unwrap()
}

#[tokio::test]
async fn lost_lease_cancels_active_source_and_cleans_scratch() {
    let fixture = Arc::new(Fixture {
        reading: AtomicBool::new(false),
        writer: Mutex::new(None),
        closed: Arc::new(Notify::new()),
    });
    let app = Router::new()
        .route("/v1/processing/:id/:generation/heartbeat", post(heartbeat))
        .route("/v1/processing/:id/:generation/source", get(source))
        .with_state(fixture.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let scratch = tempfile::tempdir().unwrap();
    let runner = Runner {
        origin: origin.parse().unwrap(),
        auth: "fixture".into(),
        client: reqwest::Client::new(),
        active: Mutex::new(None),
        scratch: scratch.path().to_owned(),
        heartbeat_interval: Duration::from_millis(10),
    };
    let attempt = Attempt {
        upload_id: "12345678-1234-1234-1234-123456789abc".into(),
        generation: 1,
        source_bytes: 100,
        output_budget: 100_000,
        recipe: RECIPE.into(),
        capability: "x".repeat(32),
    };
    assert!(
        tokio::time::timeout(Duration::from_secs(2), run(&runner, &attempt))
            .await
            .unwrap()
            .is_err()
    );
    assert!(fixture.reading.load(Ordering::SeqCst));
    tokio::time::timeout(Duration::from_secs(2), fixture.closed.notified())
        .await
        .unwrap();
    assert!(std::fs::read_dir(scratch.path()).unwrap().next().is_none());
    server.abort();
}

#[tokio::test]
async fn actual_encoder_reports_capacity_separately_from_other_failures() {
    for valid_audio in [true, false] {
        let failure = Arc::new(Mutex::new(None));
        let observed = failure.clone();
        let mut bytes = vec![0_u8; 16044];
        if valid_audio {
            bytes[..4].copy_from_slice(b"RIFF");
            bytes[4..8].copy_from_slice(&16036_u32.to_le_bytes());
            bytes[8..16].copy_from_slice(b"WAVEfmt ");
            bytes[16..20].copy_from_slice(&16_u32.to_le_bytes());
            bytes[20..22].copy_from_slice(&1_u16.to_le_bytes());
            bytes[22..24].copy_from_slice(&1_u16.to_le_bytes());
            bytes[24..28].copy_from_slice(&8000_u32.to_le_bytes());
            bytes[28..32].copy_from_slice(&16000_u32.to_le_bytes());
            bytes[32..34].copy_from_slice(&2_u16.to_le_bytes());
            bytes[34..36].copy_from_slice(&16_u16.to_le_bytes());
            bytes[36..40].copy_from_slice(b"data");
            bytes[40..44].copy_from_slice(&16000_u32.to_le_bytes());
        }
        let app = Router::new()
            .route(
                "/v1/processing/:id/:generation/heartbeat",
                post(|| async { StatusCode::NO_CONTENT }),
            )
            .route(
                "/v1/processing/:id/:generation/source",
                get(move || async move { bytes }),
            )
            .route(
                "/v1/processing/:id/:generation/failed",
                post(
                    move |axum::Json(value): axum::Json<serde_json::Value>| async move {
                        *observed.lock().await = Some(value);
                        StatusCode::NO_CONTENT
                    },
                ),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let scratch = tempfile::tempdir().unwrap();
        let runner = Runner {
            origin: origin.parse().unwrap(),
            auth: "fixture".into(),
            client: reqwest::Client::new(),
            active: Mutex::new(None),
            scratch: scratch.path().to_owned(),
            heartbeat_interval: Duration::from_secs(20),
        };
        let attempt = Attempt {
            upload_id: "12345678-1234-1234-1234-123456789abc".into(),
            generation: 1,
            source_bytes: 16044,
            output_budget: 1,
            recipe: RECIPE.into(),
            capability: "x".repeat(32),
        };
        let result = execute(&runner, &attempt).await.unwrap_err();
        assert_eq!(
            result.is::<super::transfer::OutputBudgetExceeded>(),
            valid_audio
        );
        assert_eq!(
            *failure.lock().await,
            Some(
                serde_json::json!({ "reason": if valid_audio { "output_budget_exceeded" } else { "executor_failed" } })
            )
        );
        assert!(std::fs::read_dir(scratch.path()).unwrap().next().is_none());
        server.abort();
    }
}
