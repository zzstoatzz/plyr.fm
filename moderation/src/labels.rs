//! ATProto label types and signing.
//!
//! Labels are signed metadata tags that can be applied to ATProto resources.
//! This module implements the com.atproto.label.defs#label schema.

use bytes::Bytes;
use chrono::Utc;
use k256::ecdsa::{signature::Signer, Signature, SigningKey};
use serde::{Deserialize, Serialize};

/// ATProto label as defined in com.atproto.label.defs#label.
///
/// Labels are signed by the labeler's `#atproto_label` key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    /// Version of the label format (currently 1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ver: Option<i64>,

    /// DID of the labeler that created this label.
    pub src: String,

    /// AT URI of the resource this label applies to.
    pub uri: String,

    /// CID of the specific version (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cid: Option<String>,

    /// The label value (e.g., "copyright-violation").
    pub val: String,

    /// If true, this negates a previous label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub neg: Option<bool>,

    /// Timestamp when label was created (ISO 8601).
    pub cts: String,

    /// Expiration timestamp (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exp: Option<String>,

    /// DAG-CBOR signature of the label.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(with = "serde_bytes_opt")]
    pub sig: Option<Bytes>,
}

mod serde_bytes_opt {
    use bytes::Bytes;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(value: &Option<Bytes>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(bytes) => serde_bytes::Bytes::new(bytes.as_ref()).serialize(serializer),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Bytes>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt: Option<serde_bytes::ByteBuf> = Option::deserialize(deserializer)?;
        Ok(opt.map(|b| Bytes::from(b.into_vec())))
    }
}

impl Label {
    /// Create a new unsigned label.
    pub fn new(src: impl Into<String>, uri: impl Into<String>, val: impl Into<String>) -> Self {
        Self {
            ver: Some(1),
            src: src.into(),
            uri: uri.into(),
            cid: None,
            val: val.into(),
            neg: None,
            cts: Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            exp: None,
            sig: None,
        }
    }

    /// Set the CID for a specific version of the resource.
    pub fn with_cid(mut self, cid: impl Into<String>) -> Self {
        self.cid = Some(cid.into());
        self
    }

    /// Set this as a negation label.
    pub fn negated(mut self) -> Self {
        self.neg = Some(true);
        self
    }

    /// Sign this label with a secp256k1 key.
    ///
    /// The signing process:
    /// 1. Serialize the label without the `sig` field to DAG-CBOR
    /// 2. Sign the bytes with the secp256k1 key
    /// 3. Attach the signature
    pub fn sign(mut self, signing_key: &SigningKey) -> Result<Self, LabelError> {
        // Create unsigned version for signing
        let unsigned = UnsignedLabel {
            ver: self.ver,
            src: &self.src,
            uri: &self.uri,
            cid: self.cid.as_deref(),
            val: &self.val,
            neg: self.neg,
            cts: &self.cts,
            exp: self.exp.as_deref(),
        };

        // Encode to DAG-CBOR
        let cbor_bytes =
            serde_ipld_dagcbor::to_vec(&unsigned).map_err(LabelError::Serialization)?;

        // Sign with secp256k1
        let signature: Signature = signing_key.sign(&cbor_bytes);
        self.sig = Some(Bytes::copy_from_slice(&signature.to_bytes()));

        Ok(self)
    }
}

/// Unsigned label for serialization during signing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnsignedLabel<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    ver: Option<i64>,
    src: &'a str,
    uri: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cid: Option<&'a str>,
    val: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    neg: Option<bool>,
    cts: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    exp: Option<&'a str>,
}

/// Label-related errors.
#[derive(Debug, thiserror::Error)]
pub enum LabelError {
    #[error("failed to serialize label: {0}")]
    Serialization(#[from] serde_ipld_dagcbor::EncodeError<std::collections::TryReserveError>),

    #[error("invalid signing key: {0}")]
    InvalidKey(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Label signer that holds the signing key and labeler DID.
#[derive(Clone)]
pub struct LabelSigner {
    signing_key: SigningKey,
    labeler_did: String,
}

impl LabelSigner {
    /// Create a new label signer from a hex-encoded private key.
    pub fn from_hex(hex_key: &str, labeler_did: impl Into<String>) -> Result<Self, LabelError> {
        let key_bytes = hex::decode(hex_key)
            .map_err(|e| LabelError::InvalidKey(format!("invalid hex: {e}")))?;
        let signing_key = SigningKey::from_slice(&key_bytes)
            .map_err(|e| LabelError::InvalidKey(format!("invalid key: {e}")))?;
        Ok(Self {
            signing_key,
            labeler_did: labeler_did.into(),
        })
    }

    /// Get the labeler DID.
    pub fn did(&self) -> &str {
        &self.labeler_did
    }

    /// Sign an arbitrary label.
    pub fn sign_label(&self, label: Label) -> Result<Label, LabelError> {
        label.sign(&self.signing_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_creation() {
        let label = Label::new(
            "did:plc:test",
            "at://did:plc:user/fm.plyr.track/abc123",
            "copyright-violation",
        );

        assert_eq!(label.src, "did:plc:test");
        assert_eq!(label.val, "copyright-violation");
        assert!(label.sig.is_none());
    }

    #[test]
    fn test_label_signing() {
        // Generate a test key
        let signing_key = SigningKey::random(&mut rand::thread_rng());

        let label = Label::new(
            "did:plc:test",
            "at://did:plc:user/fm.plyr.track/abc123",
            "copyright-violation",
        )
        .sign(&signing_key)
        .unwrap();

        assert!(label.sig.is_some());
        assert_eq!(label.sig.as_ref().unwrap().len(), 64); // secp256k1 signature is 64 bytes
    }
}
