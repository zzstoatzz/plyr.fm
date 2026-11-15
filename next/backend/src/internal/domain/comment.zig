//! Source-authenticated timed comments (fm.plyr.comment) exposed by the appview.

pub const Comment = struct {
    object: []const u8 = "comment",
    record: Record,
    author: Author,
    subject: Subject,
    text: []const u8,
    timestamp_ms: i64,
    created_at: []const u8,
    updated_at: ?[]const u8,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    rkey: []const u8,
};

pub const Author = struct {
    did: []const u8,
    handle: ?[]const u8,
    display_name: ?[]const u8,
    avatar_url: ?[]const u8,
};

pub const Subject = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Page = struct {
    object: []const u8 = "list",
    data: []const Comment,
    has_more: bool,
};
