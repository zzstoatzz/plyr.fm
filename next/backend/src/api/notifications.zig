//! HTTP surface of notifications: three XRPC methods, each authenticated by
//! the caller's own service JWT (minted by their PDS for this service and
//! this method), the way Tangled's and Grain's notification services are.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const bearer = @import("bearer.zig");
const response = @import("response.zig");
const application = @import("../internal/application/notifications.zig");
const service_auth = @import("../internal/atproto/service_auth.zig");
const service = @import("../internal/notification/service.zig");
const NotificationStore = @import("../internal/notification/store.zig").NotificationStore;
const Network = @import("../internal/space/network.zig").Network;

const maximum_body_bytes = 4 * 1024;

pub const Method = enum { list, count, seen };

/// Which notification method `path` names, if any.
pub fn match(config: service.Config, path: []const u8) ?Method {
    const xrpc = "/xrpc/";
    if (!std.mem.startsWith(u8, path, xrpc)) return null;
    const nsid = path[xrpc.len..];
    if (std.mem.eql(u8, nsid, config.list_method)) return .list;
    if (std.mem.eql(u8, nsid, config.count_method)) return .count;
    if (std.mem.eql(u8, nsid, config.seen_method)) return .seen;
    return null;
}

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: service.Config,
    store: ?NotificationStore,
    method: Method,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const expected: @import("exchange.zig").Method = if (method == .seen) .POST else .GET;
    if (request.method != expected) {
        try xrpcError(request, .method_not_allowed, "InvalidRequest", "method not allowed", request_id, cors);
        return;
    }
    const response_cors = try response.captureCors(request, allocator, cors);
    const token = try allocator.dupe(u8, bearer.fromRequest(request) orelse {
        try xrpcError(request, .unauthorized, "AuthenticationRequired", "service auth required", request_id, response_cors);
        return;
    });
    const nsid = switch (method) {
        .list => config.list_method,
        .count => config.count_method,
        .seen => config.seen_method,
    };
    const recipient = (try authenticate(request, allocator, io, config, nsid, token, request_id, response_cors)) orelse return;

    switch (method) {
        .list => switch (application.list(allocator, store, recipient, config.collections, request.target)) {
            .found => |page| {
                const body = try std.json.Stringify.valueAlloc(allocator, page, .{ .emit_null_optional_fields = false });
                try response.json(request, .ok, body, request_id, response_cors);
            },
            .invalid_request => try xrpcError(request, .bad_request, "InvalidRequest", "invalid limit or cursor", request_id, response_cors),
            .internal_error => try xrpcError(request, .internal_server_error, "InternalServerError", "notifications could not be read", request_id, response_cors),
            .unavailable => try xrpcError(request, .service_unavailable, "ServiceUnavailable", "notifications are temporarily unavailable", request_id, response_cors),
        },
        .count => switch (application.unreadCount(store, recipient, config.collections)) {
            .found => |count| {
                const body = try std.fmt.allocPrint(allocator, "{{\"count\":{d}}}", .{count});
                try response.json(request, .ok, body, request_id, response_cors);
            },
            .internal_error => try xrpcError(request, .internal_server_error, "InternalServerError", "notifications could not be read", request_id, response_cors),
            .unavailable => try xrpcError(request, .service_unavailable, "ServiceUnavailable", "notifications are temporarily unavailable", request_id, response_cors),
        },
        .seen => {
            const body = request.readBody(maximum_body_bytes) catch {
                try xrpcError(request, .bad_request, "InvalidRequest", "unreadable body", request_id, response_cors);
                return;
            };
            switch (application.updateSeen(allocator, store, recipient, body)) {
                .updated => try response.empty(request, .ok, request_id, response_cors),
                .invalid_request => try xrpcError(request, .bad_request, "InvalidRequest", "seenAt must be a datetime", request_id, response_cors),
                .internal_error => try xrpcError(request, .internal_server_error, "InternalServerError", "the watermark could not be stored", request_id, response_cors),
                .unavailable => try xrpcError(request, .service_unavailable, "ServiceUnavailable", "notifications are temporarily unavailable", request_id, response_cors),
            }
        },
    }
}

/// The caller's DID, or null after answering 401.
fn authenticate(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: service.Config,
    nsid: []const u8,
    token: []const u8,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !?[]const u8 {
    var network = Network.init(io, allocator, config.plc_url);
    defer network.deinit();
    const now = std.Io.Timestamp.now(io, .real).toSeconds();
    return service_auth.verify(allocator, now, token, .{
        .audiences = config.audiences,
        .method = nsid,
    }, network.keys()) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.BadAudience => {
            try xrpcError(request, .unauthorized, "BadJwtAudience", "jwt audience does not match this service", request_id, cors);
            return null;
        },
        error.BadMethod => {
            try xrpcError(request, .unauthorized, "BadJwtLexiconMethod", "jwt lxm does not match", request_id, cors);
            return null;
        },
        error.Expired => {
            try xrpcError(request, .unauthorized, "JwtExpired", "jwt expired", request_id, cors);
            return null;
        },
        else => {
            std.log.info("notification auth rejected: {s}", .{@errorName(err)});
            try xrpcError(request, .unauthorized, "AuthenticationRequired", "invalid service auth", request_id, cors);
            return null;
        },
    };
}

fn xrpcError(
    request: *Exchange,
    status: std.http.Status,
    comptime name: []const u8,
    comptime message: []const u8,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !void {
    try response.json(request, status, "{\"error\":\"" ++ name ++ "\",\"message\":\"" ++ message ++ "\"}", request_id, cors);
}

test "notification routes match only the configured method names" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const config = try service.Config.init(arena_state.allocator(), "did:web:api.example", "https://plc.directory", .{
        .track = "fm.plyr.track",
        .like = "fm.plyr.like",
        .profile = "fm.plyr.actor.profile",
    });
    try std.testing.expectEqual(Method.list, match(config, "/xrpc/fm.plyr.notification.listNotifications").?);
    try std.testing.expectEqual(Method.count, match(config, "/xrpc/fm.plyr.notification.getUnreadCount").?);
    try std.testing.expectEqual(Method.seen, match(config, "/xrpc/fm.plyr.notification.updateSeen").?);
    try std.testing.expect(match(config, "/xrpc/fm.plyr.dev.notification.listNotifications") == null);
    try std.testing.expect(match(config, "/xrpc/app.bsky.notification.listNotifications") == null);
    try std.testing.expect(match(config, "/v1/fm.plyr.notification.listNotifications") == null);
}
