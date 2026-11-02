//! Public aggregate facts for one admitted artist catalog.

pub const ArtistMetrics = struct {
    object: []const u8 = "artist_metrics",
    artist_did: []const u8,
    totals: Totals,
    top_track: ?TrackReference,
    sources: Sources = .{},
    projection: Projection = .{},
};

pub const Totals = struct {
    plays: i64,
    tracks: i64,
    duration_seconds: i64,
};

pub const TrackReference = struct {
    id: []const u8,
    record: Record,
    title: []const u8,
    play_count: i64,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Sources = struct {
    catalog: []const u8 = "verified_repo",
    duration: []const u8 = "verified_repo",
    plays: []const u8 = "application_metrics",
};

pub const Projection = struct {
    verification: []const u8 = "verified_repo",
};
