//! Claude API client for image moderation using structured outputs.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tracing::info;

const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const STRUCTURED_OUTPUTS_BETA: &str = "structured-outputs-2025-11-13";

/// Result of image moderation analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModerationResult {
    pub is_safe: bool,
    pub violated_categories: Vec<String>,
    pub severity: String,
    pub explanation: String,
}

/// Claude API client for image moderation.
pub struct ClaudeClient {
    api_key: String,
    model: String,
    http: reqwest::Client,
}

impl ClaudeClient {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            api_key,
            model: model.unwrap_or_else(|| "claude-sonnet-4-5-20250514".to_string()),
            http: reqwest::Client::new(),
        }
    }

    /// Analyze an image for policy violations using structured outputs.
    pub async fn analyze_image(
        &self,
        image_bytes: &[u8],
        media_type: &str,
    ) -> anyhow::Result<ModerationResult> {
        let b64 = STANDARD.encode(image_bytes);

        // Build request with structured output schema
        let request = serde_json::json!({
            "model": self.model,
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": MODERATION_PROMPT
                    },
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64
                        }
                    }
                ]
            }],
            // Structured output schema - guarantees valid JSON matching this schema
            "output_format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": {
                        "is_safe": {
                            "type": "boolean",
                            "description": "Whether the image passes moderation"
                        },
                        "violated_categories": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "List of policy categories violated, empty if safe"
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["safe", "low", "medium", "high"],
                            "description": "Severity level of the violation"
                        },
                        "explanation": {
                            "type": "string",
                            "description": "Brief explanation of the moderation decision"
                        }
                    },
                    "required": ["is_safe", "violated_categories", "severity", "explanation"],
                    "additionalProperties": false
                }
            }
        });

        info!(model = %self.model, "analyzing image with structured outputs");

        let response = self
            .http
            .post(CLAUDE_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("anthropic-beta", STRUCTURED_OUTPUTS_BETA)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("claude API error {status}: {body}");
        }

        let response: ClaudeResponse = response.json().await?;

        // Check for refusal
        if response.stop_reason == Some("refusal".to_string()) {
            anyhow::bail!("claude refused to analyze the image");
        }

        // Check for max_tokens cutoff
        if response.stop_reason == Some("max_tokens".to_string()) {
            anyhow::bail!("response was cut off due to max_tokens limit");
        }

        // Extract text content - guaranteed to be valid JSON matching our schema
        let text = response
            .content
            .into_iter()
            .find_map(|block| {
                if block.content_type == "text" {
                    block.text
                } else {
                    None
                }
            })
            .ok_or_else(|| anyhow::anyhow!("no text content in response"))?;

        // Direct JSON parse - no string manipulation needed thanks to structured outputs
        serde_json::from_str(&text)
            .map_err(|e| anyhow::anyhow!("failed to parse structured output: {e}"))
    }
}

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ContentBlock>,
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

const MODERATION_PROMPT: &str = r#"You are a content moderator for a music streaming platform. Analyze the provided image (album/track cover art) for policy violations.

Check for:
1. Explicit sexual content (nudity, pornography)
2. Extreme violence or gore
3. Hate symbols or content
4. Illegal content
5. Graphic drug use imagery

Note: Artistic nudity in album art (like classic rock covers) may be acceptable if not explicit/pornographic.

Analyze the image and provide your moderation decision."#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_safe_response() {
        let response = r#"{"is_safe": true, "violated_categories": [], "severity": "safe", "explanation": "Normal album artwork"}"#;
        let result: ModerationResult = serde_json::from_str(response).unwrap();
        assert!(result.is_safe);
        assert!(result.violated_categories.is_empty());
        assert_eq!(result.severity, "safe");
    }

    #[test]
    fn test_parse_unsafe_response() {
        let response = r#"{"is_safe": false, "violated_categories": ["explicit_sexual"], "severity": "high", "explanation": "Contains explicit nudity"}"#;
        let result: ModerationResult = serde_json::from_str(response).unwrap();
        assert!(!result.is_safe);
        assert_eq!(result.violated_categories, vec!["explicit_sexual"]);
        assert_eq!(result.severity, "high");
    }
}
