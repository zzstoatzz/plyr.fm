//! Moderation event log.
//!
//! Labels record what we assert about content. This records what we *did*, and
//! who did it. Those are different questions, and until now only the first had
//! an answer: a false-positive label could only be undone by negating it, which
//! forces you to claim the assertion was wrong in order to change the behavior.
//! "The assertion stands and I am surfacing it anyway" had nowhere to live.
//!
//! One append-only table carries four things that were otherwise four features:
//! the review queue, per-subject operator overrides, the audit trail, and — for
//! any future automation — a proposed action that a human can read before it
//! takes effect.
//!
//! Events are never mutated or deleted. Current state is derived from the
//! latest relevant event per subject, the same way label state is.

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::db::LabelDb;
use crate::state::{AppError, AppState};

/// What happened to a subject.
///
/// Split by whether it opens review work or closes it. Anything that closes
/// work removes the subject from the queue; anything informational leaves the
/// queue alone, because emitting a label is not the same as deciding you are
/// finished with a track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationAction {
    /// The backend's copyright scan flagged this. Opens review.
    FlaggedByScan,
    /// A user reported this. Opens review.
    Reported,
    /// A signed label was emitted. Informational — review may still be open.
    LabelApplied,
    /// A signed label was retracted. Informational.
    LabelNegated,
    /// Reviewed; nothing further needed. Closes review.
    Acknowledged,
    /// The assertion stands, but keep surfacing this track anyway. Closes review.
    OverrideAllow,
    /// Keep this out of shared surfaces regardless of labels. Closes review.
    OverrideExclude,
    /// Any standing override no longer applies.
    OverrideClear,
    /// Content was removed. Closes review.
    Takedown,
}

impl ModerationAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FlaggedByScan => "flagged_by_scan",
            Self::Reported => "reported",
            Self::LabelApplied => "label_applied",
            Self::LabelNegated => "label_negated",
            Self::Acknowledged => "acknowledged",
            Self::OverrideAllow => "override_allow",
            Self::OverrideExclude => "override_exclude",
            Self::OverrideClear => "override_clear",
            Self::Takedown => "takedown",
        }
    }

    /// Does this action put a subject into the review queue?
    pub fn opens_review(self) -> bool {
        matches!(self, Self::FlaggedByScan | Self::Reported)
    }

    /// Does this action take a subject out of the review queue?
    pub fn closes_review(self) -> bool {
        matches!(
            self,
            Self::Acknowledged | Self::OverrideAllow | Self::OverrideExclude | Self::Takedown
        )
    }
}

/// Every write names an actor. Attribution, not authentication: the service
/// still trusts a single shared key, so this records a claim about who acted,
/// which is only as good as that key. It is the difference between an audit
/// trail and a pile of anonymous mutations, and it is what lets a human
/// reviewer, a second human, and an agent be told apart later.
#[derive(Debug, Deserialize)]
pub struct RecordEventRequest {
    pub subject_uri: String,
    pub subject_track_id: Option<i64>,
    pub action: ModerationAction,
    pub actor: String,
    pub reason: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ModerationEvent {
    pub id: i64,
    pub subject_uri: String,
    pub subject_track_id: Option<i64>,
    pub action: String,
    pub actor: String,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct RecordEventResponse {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
pub struct SubjectQuery {
    pub subject_uri: String,
}

#[derive(Debug, Serialize)]
pub struct EventsResponse {
    pub events: Vec<ModerationEvent>,
}

#[derive(Debug, Deserialize)]
pub struct EventsSinceParams {
    pub after_id: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct EventsHeadResponse {
    pub latest_id: i64,
}

/// A subject awaiting review, with enough context to act without leaving the page.
#[derive(Debug, Serialize)]
pub struct QueueItem {
    pub subject_uri: String,
    pub subject_track_id: Option<i64>,
    pub opened_by: String,
    pub opened_at: DateTime<Utc>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    /// Active label values on this subject, so the queue shows assertion state.
    pub labels: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct QueueResponse {
    pub items: Vec<QueueItem>,
}

#[derive(Debug, Serialize)]
pub struct OverridesResponse {
    /// subject_uri -> "allow" | "exclude"
    pub overrides: std::collections::HashMap<String, String>,
}

impl LabelDb {
    pub async fn migrate_events(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS moderation_events (
                id BIGSERIAL PRIMARY KEY,
                subject_uri TEXT NOT NULL,
                subject_track_id BIGINT,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                reason TEXT,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(self.pool())
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_mod_events_subject \
             ON moderation_events(subject_uri)",
        )
        .execute(self.pool())
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_mod_events_created \
             ON moderation_events(created_at DESC)",
        )
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn record_event(&self, req: &RecordEventRequest) -> Result<i64, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO moderation_events
                (subject_uri, subject_track_id, action, actor, reason, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            "#,
        )
        .bind(&req.subject_uri)
        .bind(req.subject_track_id)
        .bind(req.action.as_str())
        .bind(&req.actor)
        .bind(&req.reason)
        .bind(&req.notes)
        .fetch_one(self.pool())
        .await?;
        row.try_get("id")
    }

    pub async fn events_for_subject(
        &self,
        subject_uri: &str,
    ) -> Result<Vec<ModerationEvent>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, subject_uri, subject_track_id, action, actor, reason, notes, created_at
            FROM moderation_events
            WHERE subject_uri = $1
            ORDER BY id
            "#,
        )
        .bind(subject_uri)
        .fetch_all(self.pool())
        .await?;
        rows.into_iter().map(event_from_row).collect()
    }

    pub async fn events_since(
        &self,
        after_id: i64,
        limit: i64,
    ) -> Result<Vec<ModerationEvent>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, subject_uri, subject_track_id, action, actor, reason, notes, created_at
            FROM moderation_events
            WHERE id > $1
            ORDER BY id
            LIMIT $2
            "#,
        )
        .bind(after_id)
        .bind(limit)
        .fetch_all(self.pool())
        .await?;
        rows.into_iter().map(event_from_row).collect()
    }

    pub async fn latest_event_id(&self) -> Result<i64, sqlx::Error> {
        let row = sqlx::query("SELECT COALESCE(max(id), 0) AS latest FROM moderation_events")
            .fetch_one(self.pool())
            .await?;
        row.try_get("latest")
    }

    /// Subjects whose most recent opening event has no closing event after it.
    ///
    /// Re-opening works naturally: a fresh report on a previously acknowledged
    /// track has a higher id than the acknowledgement, so it surfaces again.
    pub async fn review_queue(&self) -> Result<Vec<QueueItem>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            WITH opened AS (
                SELECT DISTINCT ON (subject_uri)
                    subject_uri, subject_track_id, actor, reason, notes, created_at, id
                FROM moderation_events
                WHERE action IN ('flagged_by_scan', 'reported')
                ORDER BY subject_uri, id DESC
            ),
            closed AS (
                SELECT DISTINCT ON (subject_uri) subject_uri, id
                FROM moderation_events
                WHERE action IN ('acknowledged', 'override_allow',
                                 'override_exclude', 'takedown')
                ORDER BY subject_uri, id DESC
            )
            SELECT o.subject_uri, o.subject_track_id, o.actor, o.reason,
                   o.notes, o.created_at,
                   COALESCE(
                       (SELECT array_agg(DISTINCT l.val)
                        FROM labels l
                        WHERE l.uri = o.subject_uri
                          AND NOT l.neg
                          AND l.seq = (SELECT max(l2.seq) FROM labels l2
                                       WHERE l2.uri = l.uri AND l2.val = l.val)),
                       ARRAY[]::text[]
                   ) AS labels
            FROM opened o
            LEFT JOIN closed c ON c.subject_uri = o.subject_uri
            WHERE c.id IS NULL OR c.id < o.id
            ORDER BY o.created_at DESC
            "#,
        )
        .fetch_all(self.pool())
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(QueueItem {
                    subject_uri: row.try_get("subject_uri")?,
                    subject_track_id: row.try_get("subject_track_id")?,
                    opened_by: row.try_get("actor")?,
                    opened_at: row.try_get("created_at")?,
                    reason: row.try_get("reason")?,
                    notes: row.try_get("notes")?,
                    labels: row.try_get("labels")?,
                })
            })
            .collect()
    }

    /// Standing overrides: the latest override_* event per subject, unless it
    /// is a clear.
    pub async fn active_overrides(
        &self,
    ) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT DISTINCT ON (subject_uri) subject_uri, action
            FROM moderation_events
            WHERE action IN ('override_allow', 'override_exclude', 'override_clear')
            ORDER BY subject_uri, id DESC
            "#,
        )
        .fetch_all(self.pool())
        .await?;

        let mut out = std::collections::HashMap::new();
        for row in rows {
            let action: String = row.try_get("action")?;
            let uri: String = row.try_get("subject_uri")?;
            match action.as_str() {
                "override_allow" => {
                    out.insert(uri, "allow".to_string());
                }
                "override_exclude" => {
                    out.insert(uri, "exclude".to_string());
                }
                _ => {}
            }
        }
        Ok(out)
    }
}

fn event_from_row(row: sqlx::postgres::PgRow) -> Result<ModerationEvent, sqlx::Error> {
    Ok(ModerationEvent {
        id: row.try_get("id")?,
        subject_uri: row.try_get("subject_uri")?,
        subject_track_id: row.try_get("subject_track_id")?,
        action: row.try_get("action")?,
        actor: row.try_get("actor")?,
        reason: row.try_get("reason")?,
        notes: row.try_get("notes")?,
        created_at: row.try_get("created_at")?,
    })
}

// --- handlers ---

/// Record an event. Used by the backend (scan flags) and by operators.
pub async fn record_event(
    State(state): State<AppState>,
    Json(request): Json<RecordEventRequest>,
) -> Result<Json<RecordEventResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;

    if request.actor.trim().is_empty() {
        return Err(AppError::BadRequest(
            "actor is required — an unattributed action is not an audit trail".to_string(),
        ));
    }

    let id = db.record_event(&request).await?;
    tracing::info!(
        subject = %request.subject_uri,
        action = request.action.as_str(),
        actor = %request.actor,
        "moderation event recorded"
    );
    Ok(Json(RecordEventResponse { id }))
}

/// Full history for one subject.
pub async fn subject_events(
    State(state): State<AppState>,
    Json(query): Json<SubjectQuery>,
) -> Result<Json<EventsResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    Ok(Json(EventsResponse {
        events: db.events_for_subject(&query.subject_uri).await?,
    }))
}

/// Events newer than a cursor, oldest first.
///
/// Drives the backend's transparency publisher, which needs to walk forward
/// through decisions exactly once. Ordering by id (not timestamp) keeps the
/// cursor total and gap-free.
pub async fn events_since(
    State(state): State<AppState>,
    Query(params): Query<EventsSinceParams>,
) -> Result<Json<EventsResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    Ok(Json(EventsResponse {
        events: db.events_since(params.after_id.unwrap_or(0), limit).await?,
    }))
}

/// Highest event id, so a publisher can start from "now" rather than replaying
/// history it was never meant to announce.
pub async fn events_head(
    State(state): State<AppState>,
) -> Result<Json<EventsHeadResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    Ok(Json(EventsHeadResponse {
        latest_id: db.latest_event_id().await?,
    }))
}

/// Everything currently awaiting review.
pub async fn review_queue(State(state): State<AppState>) -> Result<Json<QueueResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    Ok(Json(QueueResponse {
        items: db.review_queue().await?,
    }))
}

/// Standing overrides, for the backend's projection.
pub async fn active_overrides(
    State(state): State<AppState>,
) -> Result<Json<OverridesResponse>, AppError> {
    let db = state.db.as_ref().ok_or(AppError::LabelerNotConfigured)?;
    Ok(Json(OverridesResponse {
        overrides: db.active_overrides().await?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_actions_put_a_subject_in_the_queue() {
        assert!(ModerationAction::FlaggedByScan.opens_review());
        assert!(ModerationAction::Reported.opens_review());
    }

    #[test]
    fn emitting_a_label_is_not_finishing_review() {
        // Labelling a track says what we assert, not that we are done with it.
        assert!(!ModerationAction::LabelApplied.opens_review());
        assert!(!ModerationAction::LabelApplied.closes_review());
        assert!(!ModerationAction::LabelNegated.closes_review());
    }

    #[test]
    fn decisions_close_review() {
        for action in [
            ModerationAction::Acknowledged,
            ModerationAction::OverrideAllow,
            ModerationAction::OverrideExclude,
            ModerationAction::Takedown,
        ] {
            assert!(action.closes_review(), "{}", action.as_str());
        }
    }

    #[test]
    fn clearing_an_override_is_not_a_decision() {
        // It withdraws a previous one, leaving the subject wherever it was.
        assert!(!ModerationAction::OverrideClear.closes_review());
        assert!(!ModerationAction::OverrideClear.opens_review());
    }

    #[test]
    fn action_names_round_trip_through_json() {
        let json = serde_json::to_string(&ModerationAction::OverrideAllow).unwrap();
        assert_eq!(json, "\"override_allow\"");
        assert_eq!(ModerationAction::OverrideAllow.as_str(), "override_allow");
    }
}
