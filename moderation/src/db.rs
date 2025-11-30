//! Database operations for the labeler.

use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::labels::Label;

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

        Ok(())
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
