//! An artist's own moderation of their gated spaces: removing one reader
//! from every space they own, bought or not, and putting them back. The
//! caller is always the space authority, proven by their service JWT, so
//! there is no operator role here. The list is private to the artist.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const bearer = @import("bearer.zig");
const response = @import("response.zig");
const moderation = @import("moderation.zig");
const restrictions = @import("../internal/space/postgres_restrictions.zig");
const PostgresRestrictions = restrictions.PostgresRestrictions;

const maximum_body_bytes = 1024;
const maximum_did_bytes = 512;

pub const Method = enum { remove_reader, restore_reader, list_removed_readers };

/// `fm.plyr.track` gives `fm.plyr.moderation.removeReader`, next to the
/// other moderation methods.
pub fn nsid(allocator: std.mem.Allocator, config: moderation.Config, method: Method) ![]const u8 {
    const collection = config.track_collection;
    const prefix = collection[0 .. collection.len - ".track".len];
    const name = switch (method) {
        .remove_reader => "removeReader",
        .restore_reader => "restoreReader",
        .list_removed_readers => "listRemovedReaders",
    };
    return std.fmt.allocPrint(allocator, "{s}.moderation.{s}", .{ prefix, name });
}

pub fn match(config: moderation.Config, path: []const u8) ?Method {
    const xrpc = "/xrpc/";
    if (!std.mem.startsWith(u8, path, xrpc)) return null;
    const name = path[xrpc.len..];
    const collection = config.track_collection;
    const prefix = collection[0 .. collection.len - ".track".len];
    if (!std.mem.startsWith(u8, name, prefix) or !std.mem.startsWith(u8, name[prefix.len..], ".moderation.")) return null;
    const tail = name[prefix.len + ".moderation.".len ..];
    if (std.mem.eql(u8, tail, "removeReader")) return .remove_reader;
    if (std.mem.eql(u8, tail, "restoreReader")) return .restore_reader;
    if (std.mem.eql(u8, tail, "listRemovedReaders")) return .list_removed_readers;
    return null;
}

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: moderation.Config,
    store: ?*PostgresRestrictions,
    method: Method,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const expected: @import("exchange.zig").Method = if (method == .list_removed_readers) .GET else .POST;
    if (request.method != expected) {
        try moderation.xrpcError(request, .method_not_allowed, "InvalidRequest", "method not allowed", request_id, cors);
        return;
    }
    const response_cors = try response.captureCors(request, allocator, cors);
    const token = try allocator.dupe(u8, bearer.fromRequest(request) orelse {
        try moderation.xrpcError(request, .unauthorized, "AuthenticationRequired", "service auth required", request_id, response_cors);
        return;
    });
    const artist = (try moderation.authenticate(request, allocator, io, config, try nsid(allocator, config, method), token, request_id, response_cors)) orelse return;
    const removals = store orelse return unavailable(request, error.Unavailable, request_id, response_cors);

    switch (method) {
        .list_removed_readers => {
            const listed = removals.list(allocator, artist) catch |err| return unavailable(request, err, request_id, response_cors);
            const out = try std.json.Stringify.valueAlloc(allocator, .{ .readers = listed }, .{});
            try response.json(request, .ok, out, request_id, response_cors);
        },
        .remove_reader, .restore_reader => {
            const body = request.readBody(maximum_body_bytes) catch {
                try moderation.xrpcError(request, .bad_request, "InvalidRequest", "unreadable body", request_id, response_cors);
                return;
            };
            const reader = parseReader(allocator, body) orelse {
                try moderation.xrpcError(request, .bad_request, "InvalidRequest", "reader must be an account DID", request_id, response_cors);
                return;
            };
            if (std.mem.eql(u8, reader, artist)) {
                try moderation.xrpcError(request, .bad_request, "InvalidRequest", "you can't remove yourself", request_id, response_cors);
                return;
            }
            if (method == .restore_reader) {
                removals.restore(artist, reader) catch |err| return unavailable(request, err, request_id, response_cors);
            } else {
                const outcome = removals.remove(artist, reader) catch |err| return unavailable(request, err, request_id, response_cors);
                if (outcome == .full) {
                    try moderation.xrpcError(request, .bad_request, "LimitReached", "you've removed as many people as plyr.fm can hold. put someone back first", request_id, response_cors);
                    return;
                }
            }
            try response.json(request, .ok, "{}", request_id, response_cors);
        },
    }
}

fn parseReader(allocator: std.mem.Allocator, body: []const u8) ?[]const u8 {
    const Raw = struct { reader: []const u8 };
    const raw = std.json.parseFromSliceLeaky(Raw, allocator, body, .{}) catch return null;
    return if (validDid(raw.reader)) raw.reader else null;
}

fn validDid(did: []const u8) bool {
    if (did.len > maximum_did_bytes or !std.mem.startsWith(u8, did, "did:")) return false;
    const method_end = std.mem.indexOfScalarPos(u8, did, "did:".len, ':') orelse return false;
    if (method_end == "did:".len or method_end + 1 == did.len) return false;
    for (did) |byte| if (byte <= ' ' or byte == 0x7f or byte == '/' or byte == '?' or byte == '#') return false;
    return true;
}

fn unavailable(request: *Exchange, err: anyerror, request_id: []const u8, cors: response.CorsPolicy) !void {
    if (err == error.OutOfMemory) return error.OutOfMemory;
    try moderation.xrpcError(request, .service_unavailable, "ServiceUnavailable", "this is temporarily unavailable", request_id, cors);
}

test "removal methods sit beside moderation and take one account DID" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const config = try moderation.Config.init(arena, &.{"did:web:api.next.plyr.fm"}, "https://plc.directory", "fm.plyr.track", &.{});
    try std.testing.expectEqual(Method.remove_reader, match(config, "/xrpc/fm.plyr.moderation.removeReader").?);
    try std.testing.expectEqual(Method.restore_reader, match(config, "/xrpc/fm.plyr.moderation.restoreReader").?);
    try std.testing.expectEqual(Method.list_removed_readers, match(config, "/xrpc/fm.plyr.moderation.listRemovedReaders").?);
    try std.testing.expectEqual(@as(?Method, null), match(config, "/xrpc/fm.plyr.moderation.createReport"));
    try std.testing.expectEqual(@as(?Method, null), match(config, "/xrpc/fm.plyr.next.moderation.removeReader"));
    try std.testing.expectEqualStrings("fm.plyr.moderation.listRemovedReaders", try nsid(arena, config, .list_removed_readers));
    try std.testing.expectEqualStrings("did:plc:fan", parseReader(arena, "{\"reader\":\"did:plc:fan\"}").?);
    try std.testing.expectEqualStrings("did:web:example.com", parseReader(arena, "{\"reader\":\"did:web:example.com\"}").?);
    for ([_][]const u8{
        "{\"reader\":\"fan.bsky.social\"}",
        "{\"reader\":\"did:plc:\"}",
        "{\"reader\":\"did::x\"}",
        "{\"reader\":\"at://did:plc:fan/x/y\"}",
        "{\"reader\":\"did:plc:fan x\"}",
        "{\"who\":\"did:plc:fan\"}",
        "nope",
    }) |body| try std.testing.expectEqual(@as(?[]const u8, null), parseReader(arena, body));
}
