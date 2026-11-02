//! Source-authenticated ATProto like records exposed by the appview.

const track = @import("track.zig");

pub const Like = struct {
    object: []const u8 = "like",
    record: Record,
    actor: Actor,
    subject: Subject,
    created_at: []const u8,
    sources: Sources,
    projection: Projection,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    collection: []const u8,
    rkey: []const u8,
};

pub const Actor = struct {
    did: []const u8,
    profile: ?Profile,
};

pub const Profile = struct {
    handle: []const u8,
    display_name: []const u8,
    avatar_url: ?[]const u8,
};

pub const Subject = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Sources = struct {
    record: track.Source = .verified_repo,
    subject: track.Source = .verified_repo,
    actor_identity: track.Source = .verified_repo,
    actor_profile: track.Source,
    account_availability: track.Source,
};

pub const Projection = struct {
    verification: []const u8 = "verified_repo",
    commit_cid: []const u8,
    commit_rev: []const u8,
    indexed_at_us: i64,
};

pub const Page = struct {
    object: []const u8 = "list",
    data: []const Like,
    has_more: bool,
    next_cursor: ?[]const u8,
};
