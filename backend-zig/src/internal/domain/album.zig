//! Public album summary with canonical record identity and explicit legacy
//! presentation provenance.

pub const Album = struct {
    object: []const u8 = "album",
    id: []const u8,
    record: Record,
    metadata: Metadata,
    presentation: Presentation,
    artist: Artist,
    metrics: Metrics,
    sources: Sources,
    projection: Projection,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    collection: []const u8,
    rkey: []const u8,
};

pub const Metadata = struct {
    name: []const u8,
    created_at: []const u8,
    updated_at: []const u8,
};

pub const Presentation = struct {
    slug: []const u8,
    description: ?[]const u8,
    artwork_url: ?[]const u8,
};

pub const Artist = struct {
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
};

pub const Metrics = struct {
    track_count: i64,
    total_plays: i64,
};

pub const Sources = struct {
    metadata: Source,
    presentation: Source,
    membership: Source,
    metrics: Source,
};

pub const Source = enum {
    legacy_projection,
    legacy_local,
    derived,
    verified_repo,
};

pub const Projection = struct {
    indexed_at: ?[]const u8,
    verification: ProjectionVerification,
};

pub const ProjectionVerification = enum {
    legacy_unverified,
    verified_repo,
};
