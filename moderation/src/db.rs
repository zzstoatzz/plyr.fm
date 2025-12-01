//! Database operations for the labeler.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::admin::FlaggedTrack;
use crate::labels::Label;

/// Type alias for context row from database query.
type ContextRow = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<f64>,
    Option<serde_json::Value>,
);

/// Type alias for flagged track row from database query.
type FlaggedRow = (
    i64,
    String,
    String,
    DateTime<Utc>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<f64>,
    Option<serde_json::Value>,
);

/// Copyright match info stored alongside labels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyrightMatch {
    pub title: String,
    pub artist: String,
    pub score: f64,
}

/// Context stored alongside a label for display in admin UI.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LabelContext {
    pub track_title: Option<String>,
    pub artist_handle: Option<String>,
    pub artist_did: Option<String>,
    pub highest_score: Option<f64>,
    pub matches: Option<Vec<CopyrightMatch>>,
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

        Ok(())
    }

    /// Store or update label context for a URI.
    pub async fn store_context(&self, uri: &str, context: &LabelContext) -> Result<(), sqlx::Error> {
        let matches_json = context
            .matches
            .as_ref()
            .map(|m| serde_json::to_value(m).unwrap_or_default());

        sqlx::query(
            r#"
            INSERT INTO label_context (uri, track_title, artist_handle, artist_did, highest_score, matches)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (uri) DO UPDATE SET
                track_title = EXCLUDED.track_title,
                artist_handle = EXCLUDED.artist_handle,
                artist_did = EXCLUDED.artist_did,
                highest_score = EXCLUDED.highest_score,
                matches = EXCLUDED.matches
            "#,
        )
        .bind(uri)
        .bind(&context.track_title)
        .bind(&context.artist_handle)
        .bind(&context.artist_did)
        .bind(context.highest_score)
        .bind(matches_json)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get label context for a URI.
    pub async fn get_context(&self, uri: &str) -> Result<Option<LabelContext>, sqlx::Error> {
        let row: Option<ContextRow> = sqlx::query_as(
                r#"
                SELECT track_title, artist_handle, artist_did, highest_score, matches
                FROM label_context
                WHERE uri = $1
                "#,
            )
            .bind(uri)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|(track_title, artist_handle, artist_did, highest_score, matches)| {
            LabelContext {
                track_title,
                artist_handle,
                artist_did,
                highest_score,
                matches: matches.and_then(|v| serde_json::from_value(v).ok()),
            }
        }))
    }

    /// Store a signed label and return its sequence number.
    pub async fn store_label(&self, label: &Label) -> Result<i64, sqlx::Error> {
        let sig = label.sig.as_ref().map(|b| b.to_vec()).unwrap_or_default();
        let cts: DateTime<Utc> = label
            .cts
            .parse()
            .unwrap_or_else(|_| Utc::now());
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
    pub async fn get_labels_since(&self, cursor: i64, limit: i64) -> Result<Vec<LabelRow>, sqlx::Error> {
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

    /// Get all copyright-violation labels with their resolution status and context.
    ///
    /// A label is resolved if there's a negation label for the same uri+val.
    pub async fn get_pending_flags(&self) -> Result<Vec<FlaggedTrack>, sqlx::Error> {
        // Get all copyright-violation labels with context via LEFT JOIN
        let rows: Vec<FlaggedRow> = sqlx::query_as(
                r#"
                SELECT l.seq, l.uri, l.val, l.cts,
                       c.track_title, c.artist_handle, c.artist_did, c.highest_score, c.matches
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
            .map(|(seq, uri, val, cts, track_title, artist_handle, artist_did, highest_score, matches)| {
                let context = if track_title.is_some() || artist_handle.is_some() {
                    Some(LabelContext {
                        track_title,
                        artist_handle,
                        artist_did,
                        highest_score,
                        matches: matches.and_then(|v| serde_json::from_value(v).ok()),
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
            })
            .collect();

        Ok(tracks)
    }
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
            exp: self.exp.map(|e| e.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
            sig: Some(bytes::Bytes::from(self.sig.clone())),
        }
    }
}
