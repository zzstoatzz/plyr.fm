//! Public read models for source-authenticated ATProto lists.
//!
//! Albums and playlists share one signed record and ordered strong-reference
//! substrate. Product semantics choose the kind and REST identifier, while the
//! projection, member availability, and provenance model remain common.

const track = @import("track.zig");

pub const Kind = enum { album, playlist };

pub const Summary = struct {
    object: Kind,
    id: []const u8,
    record: Record,
    metadata: Metadata,
    owner: Owner,
    metrics: Metrics,
    sources: Sources,
    projection: Projection,
};

pub const Detail = struct {
    object: Kind,
    id: []const u8,
    record: Record,
    metadata: Metadata,
    owner: Owner,
    members: []const Member,
    metrics: Metrics,
    sources: Sources,
    projection: Projection,
};

pub const Page = struct {
    object: []const u8 = "list",
    data: []const Summary,
    has_more: bool,
    next_cursor: ?[]const u8,
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

pub const Owner = struct {
    did: []const u8,
    profile: ?OwnerProfile,
};

pub const OwnerProfile = struct {
    handle: []const u8,
    display_name: []const u8,
    avatar_url: ?[]const u8,
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

pub const Sources = struct {
    record: track.Source = .verified_repo,
    membership: track.Source = .verified_repo,
    owner_identity: track.Source = .verified_repo,
    owner_profile: track.Source,
    metrics: track.Source,
    account_availability: track.Source,
};

pub const Projection = struct {
    verification: []const u8 = "verified_repo",
    commit_cid: []const u8,
    commit_rev: []const u8,
    indexed_at_us: i64,
};
