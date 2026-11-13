//! Where the notification XRPC methods live and who may call them.
//!
//! Method names follow the environment's record namespace, the way
//! `{prefix}.upload.authorize` does: collections `fm.plyr.track` give
//! `fm.plyr.notification.listNotifications`, `fm.plyr.dev.track` gives
//! `fm.plyr.dev.notification.listNotifications`.

const std = @import("std");
const store_module = @import("store.zig");

pub const appview_service_id = @import("../space/managed_space.zig").appview_service_id;

pub const Config = struct {
    /// `aud` values a caller's PDS may sign for: the bare service DID and
    /// the appview service (what a PDS uses when it proxies the call)
    audiences: []const []const u8,
    list_method: []const u8,
    count_method: []const u8,
    seen_method: []const u8,
    plc_url: []const u8,
    collections: store_module.Collections,

    pub fn init(
        allocator: std.mem.Allocator,
        service_did: []const u8,
        plc_url: []const u8,
        collections: store_module.Collections,
    ) !Config {
        const prefix = namespace(collections.track) orelse return error.UnsupportedTrackCollection;
        const audiences = try allocator.alloc([]const u8, 2);
        audiences[0] = service_did;
        audiences[1] = try std.fmt.allocPrint(allocator, "{s}#{s}", .{ service_did, appview_service_id });
        return .{
            .audiences = audiences,
            .list_method = try std.fmt.allocPrint(allocator, "{s}.notification.listNotifications", .{prefix}),
            .count_method = try std.fmt.allocPrint(allocator, "{s}.notification.getUnreadCount", .{prefix}),
            .seen_method = try std.fmt.allocPrint(allocator, "{s}.notification.updateSeen", .{prefix}),
            .plc_url = plc_url,
            .collections = collections,
        };
    }
};

/// `fm.plyr.dev.track` -> `fm.plyr.dev`
fn namespace(track_collection: []const u8) ?[]const u8 {
    const suffix = ".track";
    if (!std.mem.endsWith(u8, track_collection, suffix) or track_collection.len == suffix.len) return null;
    return track_collection[0 .. track_collection.len - suffix.len];
}

test "notification methods follow the record namespace" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const config = try Config.init(arena, "did:web:api.next.plyr.fm", "https://plc.directory", .{
        .track = "fm.plyr.track",
        .like = "fm.plyr.like",
        .profile = "fm.plyr.actor.profile",
    });
    try std.testing.expectEqualStrings("fm.plyr.notification.listNotifications", config.list_method);
    try std.testing.expectEqualStrings("fm.plyr.notification.getUnreadCount", config.count_method);
    try std.testing.expectEqualStrings("fm.plyr.notification.updateSeen", config.seen_method);
    try std.testing.expectEqualStrings("did:web:api.next.plyr.fm", config.audiences[0]);
    try std.testing.expectEqualStrings("did:web:api.next.plyr.fm#plyr_appview", config.audiences[1]);
    const dev = try Config.init(arena, "did:web:x", "https://plc.directory", .{ .track = "fm.plyr.dev.track", .like = "l", .profile = "p" });
    try std.testing.expectEqualStrings("fm.plyr.dev.notification.listNotifications", dev.list_method);
    try std.testing.expectError(error.UnsupportedTrackCollection, Config.init(arena, "did:web:x", "u", .{ .track = "fm.plyr.song", .like = "l", .profile = "p" }));
}
