//! The v1 track read model.
//!
//! Source-owned facts and app-view projections stay in separate structures.
//! This prevents delivery URLs, counters, and cached handles from quietly
//! becoming part of the canonical music record.

pub const Track = struct {
    object: []const u8 = "track",
    id: []const u8,
    record: Record,
    metadata: Metadata,
    artist: Artist,
    media: Media,
    access: Access,
    moderation: Moderation,
    metrics: Metrics,
    sources: Sources = .{},
    projection: Projection,
};

pub const Record = struct {
    uri: []const u8,
    cid: ?[]const u8,
    revision: ?[]const u8,
    collection: []const u8,
    rkey: []const u8,
};

pub const Metadata = struct {
    title: []const u8,
    artist_name: ?[]const u8 = null,
    description: ?[]const u8,
    album: ?[]const u8,
    duration_seconds: ?i64,
    created_at: []const u8,
};

pub const Artist = struct {
    did: []const u8,
    profile: ArtistProfile,
};

pub const ArtistProfile = struct {
    handle: []const u8,
    display_name: []const u8,
    avatar_url: ?[]const u8,
    bio: ?[]const u8 = null,
};

pub const Media = struct {
    artifacts: []const Artifact,
    origins: []const Origin,
};

/// A content-addressed media object declared by an authored record. The CID is
/// the identity. Storage locations are separate origin claims.
pub const Artifact = struct {
    cid: []const u8,
    role: ArtifactRole = .source,
    byte_length: ?i64,
    media_type: []const u8,
    declared_by: []const u8,
    verification: ArtifactVerification,
};

pub const ArtifactRole = enum { source, derived };
pub const ArtifactVerification = enum { declared, verified };

/// A place from which an artifact may be retrieved. Legacy URLs have no
/// attestation and no persisted CID proof, so both relationships remain null.
pub const Origin = struct {
    url: []const u8,
    media_type: []const u8,
    artifact_cid: ?[]const u8,
    attestation: ?OriginAttestation,
    source: Source = .legacy_projection,
};

pub const OriginAttestation = struct {
    uri: []const u8,
    cid: []const u8,
    issuer_did: []const u8,
    indexed_at: []const u8,
};

pub const Access = struct {
    visibility: Visibility,
    in_discovery: bool,
    gate: ?Gate,
    space_uri: ?[]const u8,
};

pub const Visibility = enum { public, unlisted, supporters };

pub const Gate = struct {
    type: []const u8,
};

pub const Moderation = struct {
    self_labels: []const []const u8,
    operator_labels: []const []const u8,
    override: ?ModerationOverride,
};

pub const ModerationOverride = enum { allow, exclude };

pub const Metrics = struct {
    play_count: i64,
    /// Distinct currently available repositories with a live strong-reference
    /// like for this exact record CID.
    like_count: i64 = 0,
};

/// Per-claim provenance lets one transitional response compose authenticated
/// repository data with explicitly local policy and presentation fields.
pub const Sources = struct {
    record: Source = .legacy_projection,
    metadata: Source = .legacy_projection,
    artist_identity: Source = .legacy_projection,
    artist_handle: Source = .legacy_projection,
    artist_display_name: Source = .legacy_projection,
    artist_avatar: Source = .legacy_projection,
    artist_bio: Source = .legacy_projection,
    media_artifacts: Source = .legacy_projection,
    media_origins: Source = .legacy_projection,
    access: Source = .legacy_local,
    self_labels: Source = .legacy_projection,
    operator_labels: Source = .legacy_local,
    metrics: Source = .derived,
    like_count: Source = .derived,
    account_availability: Source = .legacy_projection,
};

pub const Source = enum {
    verified_repo,
    authored_profile,
    current_pds,
    verified_delivery,
    application_policy,
    application_metrics,
    moderation_service,
    legacy_projection,
    legacy_local,
    derived,
    mixed,
};

/// Facts about this appview row, not the authored record. A null indexed_at is
/// an honest marker for the legacy table, which never persisted ingest time.
pub const Projection = struct {
    indexed_at: ?[]const u8,
    verification: ProjectionVerification,
};

pub const ProjectionVerification = enum { legacy_unverified, verified_repo };
