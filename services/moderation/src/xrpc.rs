//! ATProto XRPC endpoints for the labeler protocol.

use std::{sync::Arc, time::Duration};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::time::{interval, timeout, MissedTickBehavior};
use tracing::error;

use crate::db::LabelDb;
use crate::labels::Label;
use crate::state::{AppError, AppState};

// --- types ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryLabelsParams {
    pub uri_patterns: String, // comma-separated
    pub sources: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct QueryLabelsResponse {
    pub cursor: Option<String>,
    pub labels: Vec<Label>,
}

#[derive(Debug, Deserialize)]
pub struct SubscribeLabelsParams {
    pub cursor: Option<i64>,
}

#[derive(Serialize)]
struct SubscribeLabelsMessage {
    seq: i64,
    labels: Vec<Label>,
}

// --- handlers ---

/// Query labels by URI pattern.
pub async fn query_labels(
    State(state): State<AppState>,
    Query(params): Query<QueryLabelsParams>,
) -> Result<Json<QueryLabelsResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    let uri_patterns: Vec<String> = params
        .uri_patterns
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();
    let sources: Option<Vec<String>> = params
        .sources
        .map(|s| s.split(',').map(|s| s.trim().to_string()).collect());
    let limit = params.limit.unwrap_or(50).clamp(1, 250);

    let (rows, cursor) = db
        .query_labels(
            &uri_patterns,
            sources.as_deref(),
            params.cursor.as_deref(),
            limit,
        )
        .await?;

    let labels: Vec<Label> = rows.iter().map(|r| r.to_label()).collect();

    Ok(Json(QueryLabelsResponse { cursor, labels }))
}

/// WebSocket subscription for real-time label updates.
pub async fn subscribe_labels(
    State(state): State<AppState>,
    Query(params): Query<SubscribeLabelsParams>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let db = state.db.clone().ok_or(AppError::LabelerNotConfigured)?;
    let label_tx = state
        .label_tx
        .clone()
        .ok_or(AppError::LabelerNotConfigured)?;

    let head = db.get_latest_seq().await?;
    let cursor = params.cursor.unwrap_or(head);
    if cursor < 0 || cursor > head {
        return Err(AppError::BadRequest(
            "cursor is outside the available sequence range".into(),
        ));
    }
    Ok(ws.on_upgrade(move |socket| handle_subscribe(socket, db, label_tx, cursor)))
}

const REPLAY_PAGE_SIZE: i64 = 1000;
const CATCH_UP_INTERVAL: Duration = Duration::from_secs(30);
const SEND_TIMEOUT: Duration = Duration::from_secs(15);

async fn send_backlog(socket: &mut WebSocket, db: &LabelDb, cursor: &mut i64) -> bool {
    loop {
        let rows = match db.get_labels_since(*cursor, REPLAY_PAGE_SIZE).await {
            Ok(rows) => rows,
            Err(error) => {
                error!(%error, "failed to read durable label stream");
                return false;
            }
        };
        let full_page = rows.len() == REPLAY_PAGE_SIZE as usize;
        for row in rows {
            let message = SubscribeLabelsMessage {
                seq: row.seq,
                labels: vec![row.to_label()],
            };
            let json = match serde_json::to_string(&message) {
                Ok(json) => json,
                Err(error) => {
                    error!(%error, "failed to encode label stream event");
                    return false;
                }
            };
            if !matches!(
                timeout(SEND_TIMEOUT, socket.send(Message::Text(json))).await,
                Ok(Ok(()))
            ) {
                return false;
            }
            *cursor = row.seq;
        }
        if !full_page {
            return true;
        }
    }
}

async fn handle_subscribe(
    mut socket: WebSocket,
    db: Arc<LabelDb>,
    label_tx: broadcast::Sender<(i64, Label)>,
    mut cursor: i64,
) {
    let mut wakeups = label_tx.subscribe();
    drop(label_tx);
    let mut poll = interval(CATCH_UP_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    poll.tick().await;
    let mut channel_open = true;
    if !send_backlog(&mut socket, &db, &mut cursor).await {
        return;
    }
    loop {
        tokio::select! {
            _ = poll.tick() => {}
            wake = wakeups.recv(), if channel_open => {
                if matches!(wake, Err(broadcast::error::RecvError::Closed)) {
                    channel_open = false;
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                    Some(Ok(Message::Ping(data))) => {
                        if !matches!(timeout(SEND_TIMEOUT, socket.send(Message::Pong(data))).await, Ok(Ok(()))) {
                            return;
                        }
                    }
                    _ => {}
                }
                continue;
            }
        }
        if !send_backlog(&mut socket, &db, &mut cursor).await {
            return;
        }
    }
}

#[cfg(test)]
mod tests;
