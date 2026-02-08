//! ATProto XRPC endpoints for the labeler protocol.

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    Json,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
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

    Ok(ws.on_upgrade(move |socket| handle_subscribe(socket, db, label_tx, params.cursor)))
}

async fn handle_subscribe(
    mut socket: WebSocket,
    db: Arc<LabelDb>,
    label_tx: broadcast::Sender<(i64, Label)>,
    cursor: Option<i64>,
) {
    // If cursor provided, backfill from that point
    let start_seq = if let Some(c) = cursor {
        // Send historical labels first
        match db.get_labels_since(c, 1000).await {
            Ok(rows) => {
                for row in &rows {
                    let msg = SubscribeLabelsMessage {
                        seq: row.seq,
                        labels: vec![row.to_label()],
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if socket.send(Message::Text(json)).await.is_err() {
                            return;
                        }
                    }
                }
                rows.last().map(|r| r.seq).unwrap_or(c)
            }
            Err(e) => {
                error!(error = %e, "failed to backfill labels");
                return;
            }
        }
    } else {
        // Start from current position
        db.get_latest_seq().await.unwrap_or(0)
    };

    // Subscribe to live updates
    let rx = label_tx.subscribe();
    let mut stream = BroadcastStream::new(rx);

    let mut last_seq = start_seq;

    loop {
        tokio::select! {
            // Receive from broadcast
            Some(result) = stream.next() => {
                match result {
                    Ok((seq, label)) => {
                        if seq > last_seq {
                            let msg = SubscribeLabelsMessage {
                                seq,
                                labels: vec![label],
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if socket.send(Message::Text(json)).await.is_err() {
                                    break;
                                }
                            }
                            last_seq = seq;
                        }
                    }
                    Err(_) => continue, // Lagged, skip
                }
            }
            // Check for client disconnect
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}
