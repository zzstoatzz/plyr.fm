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
};

pub const Media = struct {
    source: ?Source,
    deliveries: []const Delivery,
};

pub const Source = struct {
    blob_cid: []const u8,
    byte_length: ?i64,
    file_type: []const u8,
};

pub const Delivery = struct {
    role: []const u8 = "playback",
    url: []const u8,
    file_type: []const u8,
    authoritative: bool,
};

pub const Access = struct {
    visibility: Visibility,
    in_discovery: bool,
    gate: ?Gate,
    space_uri: ?[]const u8,
};

pub const Visibility = enum { public, unlisted, supporters };

pub const Gate = struct {
    type: GateType,
};

pub const GateType = enum { any, copyright };

pub const Moderation = struct {
    self_labels: []const []const u8,
    operator_labels: []const []const u8,
    override: ?ModerationOverride,
};

pub const ModerationOverride = enum { allow, exclude };

pub const Metrics = struct {
    play_count: i64,
};
