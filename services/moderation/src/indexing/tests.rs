use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;

use crate::{build_router, db::LabelDb, AppState};

const URI: &str = "at://did:plc:example/fm.plyr.track/one";
const OTHER: &str = "at://did:plc:example/fm.plyr.track/two";

async fn app(pool: PgPool) -> (Router, Arc<LabelDb>) {
    let db = Arc::new(LabelDb::from_test_pool(pool));
    db.migrate().await.unwrap();
    db.migrate_events().await.unwrap();
    let state = AppState {
        audd_api_token: String::new(),
        audd_api_url: String::new(),
        db: Some(db.clone()),
        signer: None,
        label_tx: None,
        claude: None,
    };
    (build_router(state, Some("test-token".into())), db)
}

async fn post(app: &Router, path: &str, body: Value, auth: bool) -> (StatusCode, Value) {
    let mut request = Request::post(path).header("content-type", "application/json");
    if auth {
        request = request.header("X-Moderation-Key", "test-token");
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn event(app: &Router, action: &str) -> Value {
    let (status, response) = post(app, "/admin/events", json!({
        "subject_uri": URI, "action": action, "actor": "test:operator", "reason": "test curation"
    }), true).await;
    assert_eq!(status, StatusCode::OK);
    response
}

async fn decisions(app: &Router) -> Value {
    let (status, response) = post(
        app,
        "/internal/indexing-decisions",
        json!({"uris": [URI, OTHER]}),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    response["decisions"].clone()
}

#[sqlx::test]
async fn indexing_decisions_are_durable_exact_and_independent(pool: PgPool) {
    let (app, db) = app(pool).await;
    assert!(decisions(&app).await[URI].is_null());
    event(&app, "flagged_by_scan").await;
    let excluded = event(&app, "indexing_exclude").await;
    let result = decisions(&app).await;
    assert_eq!(result[URI]["excluded"], true);
    assert_eq!(result[URI]["event_id"], excluded["id"]);
    assert!(result[OTHER].is_null());
    assert_eq!(db.review_queue().await.unwrap().len(), 1);
    event(&app, "label_negated").await;
    assert_eq!(decisions(&app).await[URI]["excluded"], true);
    event(&app, "indexing_exclude").await;
    assert_eq!(decisions(&app).await[URI]["excluded"], true);
    let cleared = event(&app, "indexing_clear").await;
    let result = decisions(&app).await;
    assert_eq!(result[URI]["excluded"], false);
    assert_eq!(result[URI]["event_id"], cleared["id"]);
    assert_eq!(db.review_queue().await.unwrap().len(), 1);
    assert!(db.active_overrides().await.unwrap().is_empty());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM labels")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
async fn indexing_endpoints_require_auth_and_bounded_exact_subjects(pool: PgPool) {
    let (app, db) = app(pool).await;
    assert_eq!(
        post(
            &app,
            "/internal/indexing-decisions",
            json!({"uris": [URI]}),
            false
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    for subject in [
        "did:plc:example",
        "at://did:plc:example/fm.plyr.track/*",
        "at://example.test/fm.plyr.track/one",
        "at://did:plc:example/fm.plyr.track/one?x=1",
    ] {
        assert_eq!(post(&app, "/admin/events", json!({"subject_uri":subject,"action":"indexing_exclude","actor":"operator","reason":"curation"}), true).await.0, StatusCode::BAD_REQUEST);
    }
    assert_eq!(
        post(
            &app,
            "/admin/events",
            json!({"subject_uri":URI,"action":"indexing_exclude","actor":"operator","reason":" "}),
            true
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &app,
            "/internal/indexing-decisions",
            json!({"uris": vec![URI; 501]}),
            true
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(db.latest_event_id().await.unwrap(), 0);
}
