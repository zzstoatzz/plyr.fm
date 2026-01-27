//! Database operations for the labeler.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};

use crate::admin::FlaggedTrack;
use crate::labels::Label;

/// Sensitive image record from the database.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SensitiveImageRow {
    pub id: i64,
    /// R2 storage ID (for track/album artwork)
    pub image_id: Option<String>,
    /// Full URL (for external images like avatars)
    pub url: Option<String>,
    /// Why this image was flagged
    pub reason: Option<String>,
    /// When the image was flagged
    pub flagged_at: DateTime<Utc>,
    /// Admin who flagged it
    pub flagged_by: Option<String>,
}

/// User-submitted content report.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct UserReport {
    pub id: i32,
    pub reporter_did: String,
    pub target_type: String,
    pub target_id: String,
    pub target_uri: Option<String>,
    pub reason: String,
    pub description: Option<String>,
    pub screenshot_url: Option<String>,
    pub status: String,
    pub admin_notes: Option<String>,
    pub resolved_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// Review batch for mobile-friendly flag review.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ReviewBatch {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    /// Status: pending, completed.
    pub status: String,
    /// Who created this batch.
    pub created_by: Option<String>,
}

/// A flag within a review batch.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct BatchFlag {
    pub id: i64,
    pub batch_id: String,
    pub uri: String,
    pub reviewed: bool,
    pub reviewed_at: Option<DateTime<Utc>>,
    /// Decision: approved, rejected, or null.
    pub decision: Option<String>,
}

/// Type alias for context row from database query.
type ContextRow = (
    Option<i64>,    // track_id
    Option<String>, // track_title
    Option<String>, // artist_handle
    Option<String>, // artist_did
    Option<f64>,    // highest_score
    Option<serde_json::Value>, // matches
    Option<String>, // resolution_reason
    Option<String>, // resolution_notes
);

/// Type alias for flagged track row from database query.
type FlaggedRow = (
    i64,            // seq
    String,         // uri
    String,         // val
    DateTime<Utc>,  // cts
    Option<i64>,    // track_id
    Option<String>, // track_title
    Option<String>, // artist_handle
    Option<String>, // artist_did
    Option<f64>,    // highest_score
    Option<serde_json::Value>, // matches
    Option<String>, // resolution_reason
    Option<String>, // resolution_notes
);

/// Copyright match info stored alongside labels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyrightMatch {
    pub title: String,
    pub artist: String,
    pub score: f64,
}

/// Reason for resolving a false positive.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionReason {
    /// Artist uploaded their own distributed music
    OriginalArtist,
    /// Artist has licensing/permission for the content
    Licensed,
    /// Fingerprint matcher produced a false match
    FingerprintNoise,
    /// Legal cover version or remix
    CoverVersion,
    /// Content was deleted from plyr.fm
    ContentDeleted,
    /// Other reason (see resolution_notes)
    Other,
}

impl ResolutionReason {
    /// Human-readable label for the reason.
    pub fn label(&self) -> &'static str {
        match self {
            Self::OriginalArtist => "original artist",
            Self::Licensed => "licensed",
            Self::FingerprintNoise => "fingerprint noise",
            Self::CoverVersion => "cover/remix",
            Self::ContentDeleted => "content deleted",
            Self::Other => "other",
        }
    }

    /// Parse from string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "original_artist" => Some(Self::OriginalArtist),
            "licensed" => Some(Self::Licensed),
            "fingerprint_noise" => Some(Self::FingerprintNoise),
            "cover_version" => Some(Self::CoverVersion),
            "content_deleted" => Some(Self::ContentDeleted),
            "other" => Some(Self::Other),
            _ => None,
        }
    }
}

/// Context stored alongside a label for display in admin UI.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LabelContext {
    pub track_id: Option<i64>,
    pub track_title: Option<String>,
    pub artist_handle: Option<String>,
    pub artist_did: Option<String>,
    pub highest_score: Option<f64>,
    pub matches: Option<Vec<CopyrightMatch>>,
    /// Why the flag was resolved as false positive (set on resolution).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_reason: Option<ResolutionReason>,
    /// Additional notes about the resolution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_notes: Option<String>,
}

/// Database connection pool and operations.
#[derive(Clone)]
pub struct LabelDb {
    pool: PgPool,
}

/// Stored label row from the database.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LabelRow {
    pub seq: i64,
    pub src: String,
    pub uri: String,
    pub cid: Option<String>,
    pub val: String,
    pub neg: bool,
    pub cts: DateTime<Utc>,
    pub exp: Option<DateTime<Utc>>,
    pub sig: Vec<u8>,
}

impl LabelDb {
    /// Connect to the database.
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        Ok(Self { pool })
    }

    /// Run database migrations.
    pub async fn migrate(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS labels (
                id BIGSERIAL PRIMARY KEY,
                seq BIGSERIAL UNIQUE NOT NULL,
                src TEXT NOT NULL,
                uri TEXT NOT NULL,
                cid TEXT,
                val TEXT NOT NULL,
                neg BOOLEAN NOT NULL DEFAULT FALSE,
                cts TIMESTAMPTZ NOT NULL,
                exp TIMESTAMPTZ,
                sig BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_labels_uri ON labels(uri)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_labels_src ON labels(src)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_labels_seq ON labels(seq)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_labels_val ON labels(val)")
            .execute(&self.pool)
            .await?;

        // Label context table for admin UI display
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS label_context (
                id BIGSERIAL PRIMARY KEY,
                uri TEXT NOT NULL UNIQUE,
                track_title TEXT,
                artist_handle TEXT,
                artist_did TEXT,
                highest_score DOUBLE PRECISION,
                matches JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_label_context_uri ON label_context(uri)")
            .execute(&self.pool)
            .await?;

        // Add resolution columns (migration-safe: only adds if missing)
        sqlx::query("ALTER TABLE label_context ADD COLUMN IF NOT EXISTS resolution_reason TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE label_context ADD COLUMN IF NOT EXISTS resolution_notes TEXT")
            .execute(&self.pool)
            .await?;

        // Sensitive images table for content moderation
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sensitive_images (
                id BIGSERIAL PRIMARY KEY,
                image_id TEXT,
                url TEXT,
                reason TEXT,
                flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                flagged_by TEXT
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sensitive_images_image_id ON sensitive_images(image_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sensitive_images_url ON sensitive_images(url)")
            .execute(&self.pool)
            .await?;

        // Image scans table for tracking automated moderation
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS image_scans (
                id BIGSERIAL PRIMARY KEY,
                image_id TEXT NOT NULL,
                is_safe BOOLEAN NOT NULL,
                violated_categories JSONB,
                severity TEXT,
                explanation TEXT,
                scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                model TEXT
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_image_scans_image_id ON image_scans(image_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_image_scans_is_safe ON image_scans(is_safe)")
            .execute(&self.pool)
            .await?;

        // Review batches for mobile-friendly flag review
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS review_batches (
                id TEXT PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ,
                status TEXT NOT NULL DEFAULT 'pending',
                created_by TEXT
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Flags within review batches
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS batch_flags (
                id BIGSERIAL PRIMARY KEY,
                batch_id TEXT NOT NULL REFERENCES review_batches(id) ON DELETE CASCADE,
                uri TEXT NOT NULL,
                reviewed BOOLEAN NOT NULL DEFAULT FALSE,
                reviewed_at TIMESTAMPTZ,
                decision TEXT,
                UNIQUE(batch_id, uri)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_batch_flags_batch_id ON batch_flags(batch_id)")
            .execute(&self.pool)
            .await?;

        // User reports table for content moderation reports
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS user_reports (
                id SERIAL PRIMARY KEY,
                reporter_did TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                target_uri TEXT,
                reason TEXT NOT NULL,
                description TEXT,
                screenshot_url TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                admin_notes TEXT,
                resolved_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ,
                resolved_at TIMESTAMPTZ
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports(reporter_did)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status)")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_user_reports_created ON user_reports(created_at DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_user_reports_target ON user_reports(target_type, target_id)",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Store or update label context for a URI.
    pub async fn store_context(
        &self,
        uri: &str,
        context: &LabelContext,
    ) -> Result<(), sqlx::Error> {
        let matches_json = context
            .matches
            .as_ref()
            .map(|m| serde_json::to_value(m).unwrap_or_default());
        let reason_str = context
            .resolution_reason
            .map(|r| format!("{:?}", r).to_lowercase());

        sqlx::query(
            r#"
            INSERT INTO label_context (uri, track_id, track_title, artist_handle, artist_did, highest_score, matches, resolution_reason, resolution_notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (uri) DO UPDATE SET
                track_id = COALESCE(EXCLUDED.track_id, label_context.track_id),
                track_title = COALESCE(EXCLUDED.track_title, label_context.track_title),
                artist_handle = COALESCE(EXCLUDED.artist_handle, label_context.artist_handle),
                artist_did = COALESCE(EXCLUDED.artist_did, label_context.artist_did),
                highest_score = COALESCE(EXCLUDED.highest_score, label_context.highest_score),
                matches = COALESCE(EXCLUDED.matches, label_context.matches),
                resolution_reason = COALESCE(EXCLUDED.resolution_reason, label_context.resolution_reason),
                resolution_notes = COALESCE(EXCLUDED.resolution_notes, label_context.resolution_notes)
            "#,
        )
        .bind(uri)
        .bind(context.track_id)
        .bind(&context.track_title)
        .bind(&context.artist_handle)
        .bind(&context.artist_did)
        .bind(context.highest_score)
        .bind(matches_json)
        .bind(reason_str)
        .bind(&context.resolution_notes)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Store resolution reason for a URI (without overwriting other context).
    pub async fn store_resolution(
        &self,
        uri: &str,
        reason: ResolutionReason,
        notes: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let reason_str = format!("{:?}", reason).to_lowercase();
        sqlx::query(
            r#"
            INSERT INTO label_context (uri, resolution_reason, resolution_notes)
            VALUES ($1, $2, $3)
            ON CONFLICT (uri) DO UPDATE SET
                resolution_reason = EXCLUDED.resolution_reason,
                resolution_notes = EXCLUDED.resolution_notes
            "#,
        )
        .bind(uri)
        .bind(reason_str)
        .bind(notes)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get label context for a URI.
    pub async fn get_context(&self, uri: &str) -> Result<Option<LabelContext>, sqlx::Error> {
        let row: Option<ContextRow> = sqlx::query_as(
                r#"
                SELECT track_id, track_title, artist_handle, artist_did, highest_score, matches, resolution_reason, resolution_notes
                FROM label_context
                WHERE uri = $1
                "#,
            )
            .bind(uri)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(
            |(
                track_id,
                track_title,
                artist_handle,
                artist_did,
                highest_score,
                matches,
                resolution_reason,
                resolution_notes,
            )| {
                LabelContext {
                    track_id,
                    track_title,
                    artist_handle,
                    artist_did,
                    highest_score,
                    matches: matches.and_then(|v| serde_json::from_value(v).ok()),
                    resolution_reason: resolution_reason
                        .and_then(|s| ResolutionReason::from_str(&s)),
                    resolution_notes,
                }
            },
        ))
    }

    /// Store a signed label and return its sequence number.
    pub async fn store_label(&self, label: &Label) -> Result<i64, sqlx::Error> {
        let sig = label.sig.as_ref().map(|b| b.to_vec()).unwrap_or_default();
        let cts: DateTime<Utc> = label.cts.parse().unwrap_or_else(|_| Utc::now());
        let exp: Option<DateTime<Utc>> = label.exp.as_ref().and_then(|e| e.parse().ok());

        let row = sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO labels (src, uri, cid, val, neg, cts, exp, sig)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING seq
            "#,
        )
        .bind(&label.src)
        .bind(&label.uri)
        .bind(&label.cid)
        .bind(&label.val)
        .bind(label.neg.unwrap_or(false))
        .bind(cts)
        .bind(exp)
        .bind(sig)
        .fetch_one(&self.pool)
        .await?;

        Ok(row)
    }

    /// Query labels matching URI patterns.
    ///
    /// Patterns can contain `*` as a wildcard (e.g., `at://did:plc:*`).
    pub async fn query_labels(
        &self,
        uri_patterns: &[String],
        sources: Option<&[String]>,
        cursor: Option<&str>,
        limit: i64,
    ) -> Result<(Vec<LabelRow>, Option<String>), sqlx::Error> {
        // Build dynamic query
        let mut conditions = Vec::new();
        let mut param_idx = 1;

        // URI pattern matching
        let uri_conditions: Vec<String> = uri_patterns
            .iter()
            .map(|p| {
                let idx = param_idx;
                param_idx += 1;
                if p.contains('*') {
                    format!("uri LIKE ${}", idx)
                } else {
                    format!("uri = ${}", idx)
                }
            })
            .collect();

        if !uri_conditions.is_empty() {
            conditions.push(format!("({})", uri_conditions.join(" OR ")));
        }

        // Source filtering
        if let Some(srcs) = sources {
            if !srcs.is_empty() {
                let placeholders: Vec<String> = srcs
                    .iter()
                    .map(|_| {
                        let idx = param_idx;
                        param_idx += 1;
                        format!("${}", idx)
                    })
                    .collect();
                conditions.push(format!("src IN ({})", placeholders.join(", ")));
            }
        }

        // Cursor for pagination
        if cursor.is_some() {
            conditions.push(format!("seq > ${}", param_idx));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let query = format!(
            r#"
            SELECT seq, src, uri, cid, val, neg, cts, exp, sig
            FROM labels
            {}
            ORDER BY seq ASC
            LIMIT {}
            "#,
            where_clause,
            limit + 1 // Fetch one extra to determine if there's more
        );

        // Build query with parameters
        let mut q = sqlx::query_as::<_, LabelRow>(&query);

        // Bind URI patterns (converting * to %)
        for pattern in uri_patterns {
            let sql_pattern = pattern.replace('*', "%");
            q = q.bind(sql_pattern);
        }

        // Bind sources
        if let Some(srcs) = sources {
            for src in srcs {
                q = q.bind(src);
            }
        }

        // Bind cursor
        if let Some(c) = cursor {
            let cursor_seq: i64 = c.parse().unwrap_or(0);
            q = q.bind(cursor_seq);
        }

        let mut rows: Vec<LabelRow> = q.fetch_all(&self.pool).await?;

        // Determine next cursor
        let next_cursor = if rows.len() > limit as usize {
            rows.pop(); // Remove the extra row
            rows.last().map(|r| r.seq.to_string())
        } else {
            None
        };

        Ok((rows, next_cursor))
    }

    /// Get labels since a sequence number (for subscribeLabels).
    pub async fn get_labels_since(
        &self,
        cursor: i64,
        limit: i64,
    ) -> Result<Vec<LabelRow>, sqlx::Error> {
        sqlx::query_as::<_, LabelRow>(
            r#"
            SELECT seq, src, uri, cid, val, neg, cts, exp, sig
            FROM labels
            WHERE seq > $1
            ORDER BY seq ASC
            LIMIT $2
            "#,
        )
        .bind(cursor)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// Get the latest sequence number.
    pub async fn get_latest_seq(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(seq) FROM labels")
            .fetch_one(&self.pool)
            .await
            .map(|s| s.unwrap_or(0))
    }

    /// Get URIs that have active (non-negated) copyright-violation labels.
    ///
    /// For each URI, checks if there's a negation label. Returns only those
    /// that are still actively flagged.
    pub async fn get_active_labels(&self, uris: &[String]) -> Result<Vec<String>, sqlx::Error> {
        if uris.is_empty() {
            return Ok(Vec::new());
        }

        // Get all negated URIs from our input set
        let negated_uris: std::collections::HashSet<String> = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT uri
            FROM labels
            WHERE val = 'copyright-violation' AND neg = true AND uri = ANY($1)
            "#,
        )
        .bind(uris)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .collect();

        // Get URIs that have a positive label and are not negated
        let active_uris: Vec<String> = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT uri
            FROM labels
            WHERE val = 'copyright-violation' AND neg = false AND uri = ANY($1)
            "#,
        )
        .bind(uris)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .filter(|uri| !negated_uris.contains(uri))
        .collect();

        Ok(active_uris)
    }

    /// Get all copyright-violation labels with their resolution status and context.
    ///
    /// A label is resolved if there's a negation label for the same uri+val.
    pub async fn get_pending_flags(&self) -> Result<Vec<FlaggedTrack>, sqlx::Error> {
        // Get all copyright-violation labels with context via LEFT JOIN
        let rows: Vec<FlaggedRow> = sqlx::query_as(
            r#"
                SELECT l.seq, l.uri, l.val, l.cts,
                       c.track_id, c.track_title, c.artist_handle, c.artist_did, c.highest_score, c.matches,
                       c.resolution_reason, c.resolution_notes
                FROM labels l
                LEFT JOIN label_context c ON l.uri = c.uri
                WHERE l.val = 'copyright-violation' AND l.neg = false
                ORDER BY l.seq DESC
                "#,
        )
        .fetch_all(&self.pool)
        .await?;

        // Get all negation labels
        let negated_uris: std::collections::HashSet<String> = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT uri
            FROM labels
            WHERE val = 'copyright-violation' AND neg = true
            "#,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .collect();

        let tracks = rows
            .into_iter()
            .map(
                |(
                    seq,
                    uri,
                    val,
                    cts,
                    track_id,
                    track_title,
                    artist_handle,
                    artist_did,
                    highest_score,
                    matches,
                    resolution_reason,
                    resolution_notes,
                )| {
                    let context = if track_id.is_some()
                        || track_title.is_some()
                        || artist_handle.is_some()
                        || resolution_reason.is_some()
                    {
                        Some(LabelContext {
                            track_id,
                            track_title,
                            artist_handle,
                            artist_did,
                            highest_score,
                            matches: matches.and_then(|v| serde_json::from_value(v).ok()),
                            resolution_reason: resolution_reason
                                .and_then(|s| ResolutionReason::from_str(&s)),
                            resolution_notes,
                        })
                    } else {
                        None
                    };

                    FlaggedTrack {
                        seq,
                        uri: uri.clone(),
                        val,
                        created_at: cts.format("%Y-%m-%d %H:%M:%S").to_string(),
                        resolved: negated_uris.contains(&uri),
                        context,
                    }
                },
            )
            .collect();

        Ok(tracks)
    }

    // -------------------------------------------------------------------------
    // Review batches
    // -------------------------------------------------------------------------

    /// Create a review batch with the given flags.
    pub async fn create_batch(
        &self,
        id: &str,
        uris: &[String],
        created_by: Option<&str>,
    ) -> Result<ReviewBatch, sqlx::Error> {
        let batch = sqlx::query_as::<_, ReviewBatch>(
            r#"
            INSERT INTO review_batches (id, created_by)
            VALUES ($1, $2)
            RETURNING id, created_at, expires_at, status, created_by
            "#,
        )
        .bind(id)
        .bind(created_by)
        .fetch_one(&self.pool)
        .await?;

        for uri in uris {
            sqlx::query(
                r#"
                INSERT INTO batch_flags (batch_id, uri)
                VALUES ($1, $2)
                ON CONFLICT (batch_id, uri) DO NOTHING
                "#,
            )
            .bind(id)
            .bind(uri)
            .execute(&self.pool)
            .await?;
        }

        Ok(batch)
    }

    /// Get a batch by ID.
    pub async fn get_batch(&self, id: &str) -> Result<Option<ReviewBatch>, sqlx::Error> {
        sqlx::query_as::<_, ReviewBatch>(
            r#"
            SELECT id, created_at, expires_at, status, created_by
            FROM review_batches
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get all flags in a batch with their context.
    pub async fn get_batch_flags(&self, batch_id: &str) -> Result<Vec<FlaggedTrack>, sqlx::Error> {
        let rows: Vec<FlaggedRow> = sqlx::query_as(
            r#"
            SELECT l.seq, l.uri, l.val, l.cts,
                   c.track_id, c.track_title, c.artist_handle, c.artist_did, c.highest_score, c.matches,
                   c.resolution_reason, c.resolution_notes
            FROM batch_flags bf
            JOIN labels l ON l.uri = bf.uri AND l.val = 'copyright-violation' AND l.neg = false
            LEFT JOIN label_context c ON l.uri = c.uri
            WHERE bf.batch_id = $1
            ORDER BY l.seq DESC
            "#,
        )
        .bind(batch_id)
        .fetch_all(&self.pool)
        .await?;

        let batch_uris: Vec<String> = rows.iter().map(|r| r.1.clone()).collect();
        let negated_uris: std::collections::HashSet<String> = if !batch_uris.is_empty() {
            sqlx::query_scalar::<_, String>(
                r#"
                SELECT DISTINCT uri
                FROM labels
                WHERE val = 'copyright-violation' AND neg = true AND uri = ANY($1)
                "#,
            )
            .bind(&batch_uris)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .collect()
        } else {
            std::collections::HashSet::new()
        };

        let tracks = rows
            .into_iter()
            .map(
                |(
                    seq,
                    uri,
                    val,
                    cts,
                    track_id,
                    track_title,
                    artist_handle,
                    artist_did,
                    highest_score,
                    matches,
                    resolution_reason,
                    resolution_notes,
                )| {
                    let context = if track_id.is_some()
                        || track_title.is_some()
                        || artist_handle.is_some()
                        || resolution_reason.is_some()
                    {
                        Some(LabelContext {
                            track_id,
                            track_title,
                            artist_handle,
                            artist_did,
                            highest_score,
                            matches: matches.and_then(|v| serde_json::from_value(v).ok()),
                            resolution_reason: resolution_reason
                                .and_then(|s| ResolutionReason::from_str(&s)),
                            resolution_notes,
                        })
                    } else {
                        None
                    };

                    FlaggedTrack {
                        seq,
                        uri: uri.clone(),
                        val,
                        created_at: cts.format("%Y-%m-%d %H:%M:%S").to_string(),
                        resolved: negated_uris.contains(&uri),
                        context,
                    }
                },
            )
            .collect();

        Ok(tracks)
    }

    /// Update batch status.
    pub async fn update_batch_status(&self, id: &str, status: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("UPDATE review_batches SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Mark a flag in a batch as reviewed.
    pub async fn mark_flag_reviewed(
        &self,
        batch_id: &str,
        uri: &str,
        decision: &str,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE batch_flags
            SET reviewed = true, reviewed_at = NOW(), decision = $1
            WHERE batch_id = $2 AND uri = $3
            "#,
        )
        .bind(decision)
        .bind(batch_id)
        .bind(uri)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Get pending (non-reviewed) flags from a batch.
    pub async fn get_batch_pending_uris(&self, batch_id: &str) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT uri FROM batch_flags
            WHERE batch_id = $1 AND reviewed = false
            "#,
        )
        .bind(batch_id)
        .fetch_all(&self.pool)
        .await
    }

    // -------------------------------------------------------------------------
    // Sensitive images
    // -------------------------------------------------------------------------

    /// Get all sensitive images.
    pub async fn get_sensitive_images(&self) -> Result<Vec<SensitiveImageRow>, sqlx::Error> {
        sqlx::query_as::<_, SensitiveImageRow>(
            "SELECT id, image_id, url, reason, flagged_at, flagged_by FROM sensitive_images ORDER BY flagged_at DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    /// Add a sensitive image entry.
    pub async fn add_sensitive_image(
        &self,
        image_id: Option<&str>,
        url: Option<&str>,
        reason: Option<&str>,
        flagged_by: Option<&str>,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO sensitive_images (image_id, url, reason, flagged_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            "#,
        )
        .bind(image_id)
        .bind(url)
        .bind(reason)
        .bind(flagged_by)
        .fetch_one(&self.pool)
        .await
    }

    /// Remove a sensitive image entry by ID.
    pub async fn remove_sensitive_image(&self, id: i64) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM sensitive_images WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    // -------------------------------------------------------------------------
    // Image scans
    // -------------------------------------------------------------------------

    /// Store an image scan result.
    pub async fn store_image_scan(
        &self,
        image_id: &str,
        is_safe: bool,
        violated_categories: &[String],
        severity: &str,
        explanation: &str,
        model: &str,
    ) -> Result<i64, sqlx::Error> {
        let categories_json = serde_json::to_value(violated_categories).unwrap_or_default();
        sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO image_scans (image_id, is_safe, violated_categories, severity, explanation, model)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            "#,
        )
        .bind(image_id)
        .bind(is_safe)
        .bind(categories_json)
        .bind(severity)
        .bind(explanation)
        .bind(model)
        .fetch_one(&self.pool)
        .await
    }

    /// Get image scan stats for cost tracking.
    pub async fn get_image_scan_stats(&self) -> Result<ImageScanStats, sqlx::Error> {
        let row: (i64, i64, i64) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_safe = true) as safe,
                COUNT(*) FILTER (WHERE is_safe = false) as flagged
            FROM image_scans
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(ImageScanStats {
            total: row.0,
            safe: row.1,
            flagged: row.2,
        })
    }

    // -------------------------------------------------------------------------
    // User reports
    // -------------------------------------------------------------------------

    /// Create a new user report.
    pub async fn create_report(
        &self,
        reporter_did: &str,
        target_type: &str,
        target_id: &str,
        target_uri: Option<&str>,
        reason: &str,
        description: Option<&str>,
        screenshot_url: Option<&str>,
    ) -> Result<UserReport, sqlx::Error> {
        sqlx::query_as::<_, UserReport>(
            r#"
            INSERT INTO user_reports (reporter_did, target_type, target_id, target_uri, reason, description, screenshot_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(reporter_did)
        .bind(target_type)
        .bind(target_id)
        .bind(target_uri)
        .bind(reason)
        .bind(description)
        .bind(screenshot_url)
        .fetch_one(&self.pool)
        .await
    }

    /// List user reports with optional filtering.
    pub async fn list_reports(
        &self,
        status: Option<&str>,
        target_type: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<UserReport>, sqlx::Error> {
        let mut query = String::from(
            "SELECT * FROM user_reports WHERE 1=1",
        );
        let mut param_idx = 1;

        if status.is_some() {
            query.push_str(&format!(" AND status = ${}", param_idx));
            param_idx += 1;
        }
        if target_type.is_some() {
            query.push_str(&format!(" AND target_type = ${}", param_idx));
            param_idx += 1;
        }

        query.push_str(&format!(" ORDER BY created_at DESC LIMIT ${} OFFSET ${}", param_idx, param_idx + 1));

        let mut q = sqlx::query_as::<_, UserReport>(&query);

        if let Some(s) = status {
            q = q.bind(s);
        }
        if let Some(t) = target_type {
            q = q.bind(t);
        }

        q = q.bind(limit).bind(offset);

        q.fetch_all(&self.pool).await
    }

    /// Get a user report by ID.
    pub async fn get_report(&self, id: i32) -> Result<Option<UserReport>, sqlx::Error> {
        sqlx::query_as::<_, UserReport>("SELECT * FROM user_reports WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Resolve a user report.
    pub async fn resolve_report(
        &self,
        id: i32,
        status: &str,
        admin_notes: Option<&str>,
        resolved_by: &str,
    ) -> Result<Option<UserReport>, sqlx::Error> {
        sqlx::query_as::<_, UserReport>(
            r#"
            UPDATE user_reports
            SET status = $1, admin_notes = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
            WHERE id = $4
            RETURNING *
            "#,
        )
        .bind(status)
        .bind(admin_notes)
        .bind(resolved_by)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }
}

/// Statistics for image scans.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageScanStats {
    pub total: i64,
    pub safe: i64,
    pub flagged: i64,
}

impl LabelRow {
    /// Convert database row to Label struct.
    pub fn to_label(&self) -> Label {
        Label {
            ver: Some(1),
            src: self.src.clone(),
            uri: self.uri.clone(),
            cid: self.cid.clone(),
            val: self.val.clone(),
            neg: if self.neg { Some(true) } else { None },
            cts: self.cts.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            exp: self
                .exp
                .map(|e| e.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
            sig: Some(bytes::Bytes::from(self.sig.clone())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolution_reason_from_str() {
        assert_eq!(
            ResolutionReason::from_str("original_artist"),
            Some(ResolutionReason::OriginalArtist)
        );
        assert_eq!(
            ResolutionReason::from_str("licensed"),
            Some(ResolutionReason::Licensed)
        );
        assert_eq!(
            ResolutionReason::from_str("fingerprint_noise"),
            Some(ResolutionReason::FingerprintNoise)
        );
        assert_eq!(
            ResolutionReason::from_str("cover_version"),
            Some(ResolutionReason::CoverVersion)
        );
        assert_eq!(
            ResolutionReason::from_str("other"),
            Some(ResolutionReason::Other)
        );
        assert_eq!(ResolutionReason::from_str("invalid"), None);
    }

    #[test]
    fn test_resolution_reason_labels() {
        assert_eq!(ResolutionReason::OriginalArtist.label(), "original artist");
        assert_eq!(ResolutionReason::Licensed.label(), "licensed");
        assert_eq!(
            ResolutionReason::FingerprintNoise.label(),
            "fingerprint noise"
        );
        assert_eq!(ResolutionReason::CoverVersion.label(), "cover/remix");
        assert_eq!(ResolutionReason::Other.label(), "other");
    }

    #[test]
    fn test_label_context_default() {
        let ctx = LabelContext::default();
        assert!(ctx.track_title.is_none());
        assert!(ctx.resolution_reason.is_none());
        assert!(ctx.resolution_notes.is_none());
    }
}
