//! Read port for an account's notifications.
//!
//! A notification is derived, not stored: another account's verified like on
//! one of the recipient's tracks, or another account's track that features
//! the recipient. The only owned state is the recipient's read watermark.

const std = @import("std");
const scoped_record_cursor = @import("../identity/scoped_record_cursor.zig");

pub const Reason = enum {
    /// another account liked one of your tracks
    like,
    /// another account published a track that features you
    feature,

    pub fn parse(text: []const u8) ?Reason {
        return std.meta.stringToEnum(Reason, text);
    }
};

pub const Collections = struct {
    track: []const u8,
    like: []const u8,
    profile: []const u8,
};

pub const ListRequest = struct {
    recipient_did: []const u8,
    collections: Collections,
    limit: usize,
    /// keyset: strictly older than this (sort instant, uri) pair
    before: ?scoped_record_cursor.Cursor,
};

pub const Author = struct {
    did: []const u8,
    handle: ?[]const u8,
    display_name: ?[]const u8,
    avatar: ?[]const u8,
};

pub const Item = struct {
    reason: Reason,
    /// the record that caused it: the like, or the featuring track
    uri: []const u8,
    cid: []const u8,
    author: Author,
    /// the recipient's track that was liked, or the track featuring them
    subject_uri: []const u8,
    subject_title: []const u8,
    /// the record's own createdAt, as written
    created_at: []const u8,
    /// when plyr orders and reads it: the record's createdAt, or when plyr
    /// first indexed it if the record claims a later time
    sort_at_us: i64,
};

pub const NotificationStore = struct {
    context: *anyopaque,
    list_fn: *const fn (*anyopaque, std.mem.Allocator, ListRequest) Error![]Item,
    count_unread_fn: *const fn (*anyopaque, []const u8, Collections, ?i64) Error!i64,
    seen_at_fn: *const fn (*anyopaque, []const u8) Error!?i64,
    mark_seen_fn: *const fn (*anyopaque, []const u8, []const u8) Error!i64,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn list(self: NotificationStore, allocator: std.mem.Allocator, request: ListRequest) Error![]Item {
        return self.list_fn(self.context, allocator, request);
    }

    /// Notifications sorted after `seen_at_us` (all of them when null).
    pub fn countUnread(self: NotificationStore, recipient_did: []const u8, collections: Collections, seen_at_us: ?i64) Error!i64 {
        return self.count_unread_fn(self.context, recipient_did, collections, seen_at_us);
    }

    pub fn seenAt(self: NotificationStore, recipient_did: []const u8) Error!?i64 {
        return self.seen_at_fn(self.context, recipient_did);
    }

    /// Advances the watermark to `seen_at` (an atproto datetime from 1970
    /// on), never backwards and never past now; returns the watermark stored.
    pub fn markSeen(self: NotificationStore, recipient_did: []const u8, seen_at: []const u8) Error!i64 {
        return self.mark_seen_fn(self.context, recipient_did, seen_at);
    }
};
