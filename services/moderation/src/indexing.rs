use std::collections::BTreeMap;

use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{db::LabelDb, AppError, AppState};

const MAX_SUBJECTS: usize = 500;

#[derive(Deserialize)]
pub struct DecisionQuery {
    pub uris: Vec<String>,
}

#[derive(Serialize, FromRow)]
pub struct IndexingDecision {
    pub event_id: i64,
    pub excluded: bool,
    pub actor: String,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct DecisionResponse {
    pub decisions: BTreeMap<String, Option<IndexingDecision>>,
}

pub fn validate_subject(uri: &str) -> Result<(), AppError> {
    let parts: Vec<&str> = uri.strip_prefix("at://").unwrap_or("").split('/').collect();
    let valid = parts.len() == 3
        && parts[0].starts_with("did:")
        && parts[0].split(':').count() >= 3
        && parts[0].split(':').all(|part| !part.is_empty())
        && parts.iter().all(|part| !part.is_empty())
        && parts[1].split('.').count() >= 3
        && parts[1].split('.').all(|part| !part.is_empty())
        && parts[2] != "."
        && parts[2] != ".."
        && uri.is_ascii()
        && !uri.chars().any(|c| {
            c.is_ascii_control() || c.is_whitespace() || matches!(c, '*' | '?' | '#' | '\\')
        });
    if !valid {
        return Err(AppError::BadRequest(
            "indexing subjects must be exact AT record URIs using a DID".to_string(),
        ));
    }
    Ok(())
}

impl LabelDb {
    pub async fn indexing_decisions(
        &self,
        uris: &[String],
    ) -> Result<BTreeMap<String, Option<IndexingDecision>>, sqlx::Error> {
        let rows = sqlx::query_as::<_, (String, i64, bool, String, Option<String>, DateTime<Utc>)>(
            r#"
            SELECT DISTINCT ON (subject_uri)
                subject_uri, id, action = 'indexing_exclude', actor, reason, created_at
            FROM moderation_events
            WHERE subject_uri = ANY($1)
              AND action IN ('indexing_exclude', 'indexing_clear')
            ORDER BY subject_uri, id DESC
            "#,
        )
        .bind(uris)
        .fetch_all(self.pool())
        .await?;
        let mut decisions = uris
            .iter()
            .map(|uri| (uri.clone(), None))
            .collect::<BTreeMap<_, _>>();
        for (uri, event_id, excluded, actor, reason, created_at) in rows {
            decisions.insert(
                uri,
                Some(IndexingDecision {
                    event_id,
                    excluded,
                    actor,
                    reason,
                    created_at,
                }),
            );
        }
        Ok(decisions)
    }
}

pub async fn decisions(
    State(state): State<AppState>,
    Json(query): Json<DecisionQuery>,
) -> Result<Json<DecisionResponse>, AppError> {
    if query.uris.len() > MAX_SUBJECTS {
        return Err(AppError::BadRequest(
            "at most 500 subjects per query".to_string(),
        ));
    }
    for uri in &query.uris {
        validate_subject(uri)?;
    }
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    Ok(Json(DecisionResponse {
        decisions: db.indexing_decisions(&query.uris).await?,
    }))
}

#[cfg(test)]
mod tests;
