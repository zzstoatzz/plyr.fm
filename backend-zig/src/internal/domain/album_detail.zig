//! Verified album record plus position-preserving member resolution.

const track = @import("track.zig");

pub const AlbumDetail = struct {
    object: []const u8 = "album",
    id: []const u8,
    record: Record,
    metadata: Metadata,
    members: []const Member,
    metrics: Metrics,
    projection: Projection,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    collection: []const u8,
    rkey: []const u8,
};

pub const Metadata = struct {
    name: ?[]const u8,
    created_at: []const u8,
    updated_at: ?[]const u8,
};

pub const Member = struct {
    position: u16,
    subject: Subject,
    availability: Availability,
    track: ?track.Track,
};

pub const Subject = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Availability = enum { available, unavailable };

pub const Metrics = struct {
    member_count: usize,
    available_count: usize,
    total_plays: i64,
};

pub const Projection = struct {
    verification: []const u8 = "verified_repo",
    commit_cid: []const u8,
    commit_rev: []const u8,
    indexed_at_us: i64,
};
