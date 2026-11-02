//! Public search references over source-authenticated projections.
//!
//! Search is an index view, not a new source of content authority. Every hit
//! retains canonical record identity and per-field provenance while lexical
//! score remains an internal ranking detail.

const track = @import("track.zig");

pub const Kind = enum { track, artist, album, playlist };
pub const MatchKind = enum { exact, prefix, substring, fuzzy };
pub const MatchField = enum { title, handle, display_name, name };

pub const Hit = struct {
    object: []const u8 = "search_result",
    type: Kind,
    id: []const u8,
    record: Record,
    title: []const u8,
    owner: Owner,
    image_url: ?[]const u8,
    metrics: Metrics,
    match: Match,
    sources: Sources,
    projection: Projection,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Owner = struct {
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
};

pub const Metrics = struct {
    play_count: ?i64 = null,
    member_count: ?usize = null,
};

pub const Match = struct {
    kind: MatchKind,
    field: MatchField,
};

pub const Sources = struct {
    record: track.Source = .verified_repo,
    title: track.Source,
    owner_identity: track.Source = .verified_repo,
    owner_handle: track.Source,
    owner_display_name: track.Source,
    image: track.Source,
    metrics: track.Source,
    account_availability: track.Source,
};

pub const Projection = struct {
    verification: []const u8 = "verified_repo",
    indexed_at_us: i64,
};

pub const Counts = struct {
    tracks: usize = 0,
    artists: usize = 0,
    albums: usize = 0,
    playlists: usize = 0,
};

pub const Page = struct {
    object: []const u8 = "list",
    data: []const Hit,
    query: []const u8,
    counts: Counts,
};
