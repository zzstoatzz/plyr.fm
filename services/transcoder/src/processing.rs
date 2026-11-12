use std::{env, sync::Arc, time::Duration};

use anyhow::{bail, Context};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

mod transfer;

const RECIPE: &str = "mp3-320k-44100-v1";
const PART_BYTES: usize = 10 * 1024 * 1024;
const MAX_BYTES: u64 = 1536 * 1024 * 1024;
const JOB_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attempt {
    upload_id: String,
    generation: u32,
    source_bytes: u64,
    output_budget: u64,
    recipe: String,
    capability: String,
}

impl Attempt {
    fn valid(&self) -> bool {
        self.upload_id.len() == 36
            && self.upload_id.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit() && !b.is_ascii_uppercase()
                }
            })
            && self.generation > 0
            && (1..=MAX_BYTES).contains(&self.source_bytes)
            && (1..=2 * MAX_BYTES - self.source_bytes).contains(&self.output_budget)
            && self.recipe == RECIPE
            && (32..=4096).contains(&self.capability.len())
            && self.capability.bytes().all(|b| b.is_ascii_graphic())
    }

    fn path(&self, action: &str) -> String {
        format!(
            "/v1/processing/{}/{}/{}",
            self.upload_id, self.generation, action
        )
    }
}

struct Runner {
    origin: Url,
    auth: String,
    client: reqwest::Client,
    active: Mutex<Option<Attempt>>,
}

pub fn configured_router() -> anyhow::Result<Router> {
    let origin = env::var("NEXT_PROCESSING_ORIGIN").ok();
    let auth = env::var("NEXT_PROCESSING_AUTH_TOKEN").ok();
    match (origin, auth) {
        (None, None) => Ok(Router::new()),
        (Some(origin), Some(auth)) => {
            if env::var("FLY_APP_NAME").as_deref() != Ok("plyr-transcoder-staging") {
                bail!("Next processing requires the staging transcoder app");
            }
            let origin = callback_origin(&origin)?;
            if auth.len() < 32 || !auth.bytes().all(|b| b.is_ascii_graphic()) {
                bail!("invalid Next processing authentication configuration");
            }
            Ok(router(Arc::new(Runner {
                origin,
                auth,
                client: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(Duration::from_secs(15))
                    .read_timeout(Duration::from_secs(60))
                    .build()?,
                active: Mutex::new(None),
            })))
        }
        _ => bail!("incomplete Next processing configuration"),
    }
}

fn callback_origin(value: &str) -> anyhow::Result<Url> {
    let url = Url::parse(value)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("Next processing callback must be an HTTPS origin");
    }
    Ok(url)
}

fn router(runner: Arc<Runner>) -> Router {
    Router::new()
        .route("/v1/processing", post(start))
        .layer(DefaultBodyLimit::max(8192))
        .with_state(runner)
}

async fn start(
    State(runner): State<Arc<Runner>>,
    headers: HeaderMap,
    Json(attempt): Json<Attempt>,
) -> StatusCode {
    if headers
        .get("X-Processing-Key")
        .and_then(|v| v.to_str().ok())
        != Some(runner.auth.as_str())
    {
        return StatusCode::UNAUTHORIZED;
    }
    if !attempt.valid() {
        return StatusCode::BAD_REQUEST;
    }
    let mut active = runner.active.lock().await;
    if let Some(current) = active.as_ref() {
        return if current == &attempt {
            StatusCode::ACCEPTED
        } else {
            StatusCode::TOO_MANY_REQUESTS
        };
    }
    *active = Some(attempt.clone());
    drop(active);
    tokio::spawn(async move {
        let result = tokio::time::timeout(JOB_TIMEOUT, run(&runner, &attempt)).await;
        if !matches!(result, Ok(Ok(()))) {
            tracing::warn!(upload_id = %attempt.upload_id, generation = attempt.generation, "processing attempt stopped; owner reconciliation required");
        }
        *runner.active.lock().await = None;
    });
    StatusCode::ACCEPTED
}

impl Runner {
    fn request(
        &self,
        attempt: &Attempt,
        method: reqwest::Method,
        action: &str,
    ) -> reqwest::RequestBuilder {
        self.client
            .request(
                method,
                self.origin
                    .join(&attempt.path(action))
                    .expect("validated attempt path"),
            )
            .bearer_auth(&attempt.capability)
    }

    async fn heartbeat(&self, attempt: &Attempt) -> anyhow::Result<()> {
        self.request(attempt, reqwest::Method::POST, "heartbeat")
            .timeout(Duration::from_secs(15))
            .send()
            .await?
            .error_for_status()
            .context("processing authority unavailable")?;
        Ok(())
    }
}

async fn run(runner: &Runner, attempt: &Attempt) -> anyhow::Result<()> {
    runner.heartbeat(attempt).await?;
    let work = transfer::process(runner, attempt);
    tokio::select! {
        result = work => result,
        result = monitor(runner, attempt) => result,
    }
}

async fn monitor(runner: &Runner, attempt: &Attempt) -> anyhow::Result<()> {
    loop {
        tokio::time::sleep(Duration::from_secs(20)).await;
        runner.heartbeat(attempt).await?;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    number: usize,
    sha256: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt() -> Attempt {
        Attempt {
            upload_id: "12345678-1234-1234-1234-123456789abc".into(),
            generation: 1,
            source_bytes: MAX_BYTES,
            output_budget: MAX_BYTES,
            recipe: RECIPE.into(),
            capability: "x".repeat(32),
        }
    }

    #[test]
    fn accepts_full_size_and_rejects_invalid_reservations() {
        let valid = attempt();
        assert!(valid.valid());
        for invalid in [
            Attempt {
                source_bytes: MAX_BYTES + 1,
                ..valid.clone()
            },
            Attempt {
                output_budget: MAX_BYTES + 1,
                ..valid.clone()
            },
            Attempt {
                upload_id: "../source".into(),
                ..valid.clone()
            },
            Attempt {
                generation: 0,
                ..valid.clone()
            },
            Attempt {
                recipe: "wav".into(),
                ..valid.clone()
            },
        ] {
            assert!(!invalid.valid());
        }
    }

    #[test]
    fn callback_origin_cannot_carry_paths_or_credentials() {
        assert!(callback_origin("https://audio.example").is_ok());
        for invalid in [
            "http://audio.example",
            "https://user:secret@audio.example",
            "https://audio.example/path",
            "https://audio.example?token=x",
        ] {
            assert!(callback_origin(invalid).is_err());
        }
    }

    #[tokio::test]
    async fn active_dispatch_is_idempotent_and_capacity_is_bounded() {
        let runner = Arc::new(Runner {
            origin: "http://127.0.0.1:1".parse().unwrap(),
            auth: "fixture-key".into(),
            client: reqwest::Client::new(),
            active: Mutex::new(None),
        });
        let mut headers = HeaderMap::new();
        headers.insert("X-Processing-Key", "fixture-key".parse().unwrap());
        let job = attempt();
        assert_eq!(
            start(State(runner.clone()), HeaderMap::new(), Json(job.clone())).await,
            StatusCode::UNAUTHORIZED
        );
        assert!(runner.active.lock().await.is_none());
        assert_eq!(
            start(State(runner.clone()), headers.clone(), Json(job.clone())).await,
            StatusCode::ACCEPTED
        );
        assert_eq!(
            start(State(runner.clone()), headers.clone(), Json(job.clone())).await,
            StatusCode::ACCEPTED
        );
        assert_eq!(
            start(
                State(runner.clone()),
                headers,
                Json(Attempt {
                    generation: 2,
                    ..job
                })
            )
            .await,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[tokio::test]
    async fn rejected_lease_prevents_source_access() {
        let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = reads.clone();
        let app = Router::new()
            .route(
                "/v1/processing/:id/:generation/heartbeat",
                post(|| async { StatusCode::CONFLICT }),
            )
            .route(
                "/v1/processing/:id/:generation/source",
                axum::routing::get(move || {
                    let reads = observed.clone();
                    async move {
                        reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        StatusCode::OK
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let runner = Runner {
            origin: origin.parse().unwrap(),
            auth: "fixture".into(),
            client: reqwest::Client::new(),
            active: Mutex::new(None),
        };
        assert!(run(&runner, &attempt()).await.is_err());
        assert_eq!(reads.load(std::sync::atomic::Ordering::SeqCst), 0);
        server.abort();
    }
}
