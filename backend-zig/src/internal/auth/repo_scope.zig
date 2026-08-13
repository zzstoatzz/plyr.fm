//! Minimal parser for collection-scoped ATProto repository permissions.

const std = @import("std");

pub const Action = enum { create, update, delete };

pub fn allows(
    scope: []const u8,
    collection: []const u8,
    required: []const Action,
) bool {
    var tokens = std.mem.tokenizeScalar(u8, scope, ' ');
    var has_atproto = false;
    var permitted = std.EnumSet(Action).initEmpty();
    while (tokens.next()) |token| {
        if (std.mem.eql(u8, token, "atproto")) {
            has_atproto = true;
            continue;
        }
        if (std.mem.eql(u8, token, "transition:generic")) return false;
        const prefix = "repo:";
        if (!std.mem.startsWith(u8, token, prefix)) continue;
        const remainder = token[prefix.len..];
        const query_index = std.mem.indexOfScalar(u8, remainder, '?');
        const token_collection = if (query_index) |index| remainder[0..index] else remainder;
        if (!std.mem.eql(u8, token_collection, collection)) continue;
        if (query_index == null) {
            permitted = std.EnumSet(Action).initFull();
            continue;
        }
        var candidate = std.EnumSet(Action).initEmpty();
        var parameters = std.mem.splitScalar(u8, remainder[query_index.? + 1 ..], '&');
        var valid = true;
        while (parameters.next()) |parameter| {
            const value = if (std.mem.startsWith(u8, parameter, "action="))
                parameter["action=".len..]
            else {
                valid = false;
                continue;
            };
            const action = std.meta.stringToEnum(Action, value) orelse {
                valid = false;
                continue;
            };
            if (candidate.contains(action)) valid = false else candidate.insert(action);
        }
        if (valid) permitted.setUnion(candidate);
    }
    if (!has_atproto) return false;
    for (required) |action| if (!permitted.contains(action)) return false;
    return true;
}

test "repo permissions are collection-scoped, action-aware, and never transitional" {
    const scope = "atproto repo:fm.plyr.like?action=delete&action=create&action=update";
    try std.testing.expect(allows(scope, "fm.plyr.like", &.{ .create, .update }));
    try std.testing.expect(allows(scope, "fm.plyr.like", &.{.delete}));
    try std.testing.expect(!allows(scope, "fm.plyr.track", &.{.delete}));
    try std.testing.expect(!allows("atproto transition:generic", "fm.plyr.like", &.{.delete}));
    try std.testing.expect(!allows("repo:fm.plyr.like", "fm.plyr.like", &.{.delete}));
}
