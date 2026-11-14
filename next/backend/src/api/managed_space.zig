//! HTTP surface of plyr's managing-app role: the did:web document that names
//! the service, and the XRPC method a space's PDS calls to ask whether a user
//! may read (or write) a gated space.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const bearer = @import("bearer.zig");
const response = @import("response.zig");
const query = @import("../internal/http/query.zig");
const managed_space = @import("../internal/space/managed_space.zig");
const space_access = @import("../internal/space/access.zig");
const Network = @import("../internal/space/network.zig").Network;

pub fn didDocument(
    request: *Exchange,
    allocator: std.mem.Allocator,
    config: managed_space.Config,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    try response.json(request, .ok, try config.didDocument(allocator), request_id, cors);
}

const Params = struct {
    space: managed_space.SpaceUri,
    user: []const u8,
    access: managed_space.Access,
};

fn parseParams(allocator: std.mem.Allocator, target: []const u8) !Params {
    var space: ?[]const u8 = null;
    var user: ?[]const u8 = null;
    var access: ?[]const u8 = null;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        const slot = if (std.mem.eql(u8, pair.name, "space"))
            &space
        else if (std.mem.eql(u8, pair.name, "user"))
            &user
        else if (std.mem.eql(u8, pair.name, "access"))
            &access
        else
            continue; // e.g. clientId: no gate here depends on the client
        if (slot.* != null) return error.InvalidQuery;
        slot.* = pair.value;
    }
    const user_did = user orelse return error.InvalidQuery;
    if (@import("zat").Did.parse(user_did) == null) return error.InvalidQuery;
    return .{
        .space = managed_space.SpaceUri.parse(space orelse return error.InvalidQuery) orelse
            return error.InvalidQuery,
        .user = user_did,
        .access = managed_space.Access.parse(access orelse "read") orelse return error.InvalidQuery,
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

pub fn checkUserAccess(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: managed_space.Config,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const params = parseParams(allocator, request.target) catch {
        try xrpcError(request, .bad_request, "InvalidRequest", "space, user and access are required", request_id, cors);
        return;
    };
    const token = bearer.fromRequest(request) orelse {
        try xrpcError(request, .unauthorized, "AuthenticationRequired", "service auth required", request_id, cors);
        return;
    };

    var network = Network.init(io, allocator, config.plc_url);
    defer network.deinit();
    // the asking PDS is waiting; an answer after this is no answer
    network.deadline_ns = std.Io.Clock.awake.now(io).nanoseconds + 10 * std.time.ns_per_s;

    const now = std.Io.Timestamp.now(io, .real).toSeconds();
    managed_space.verifyServiceAuth(
        allocator,
        now,
        token,
        try config.managingApp(allocator),
        params.space.authority,
        network.keys(),
    ) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.BadAudience => {
            try xrpcError(request, .unauthorized, "BadJwtAudience", "jwt audience does not match the managing app", request_id, cors);
            return;
        },
        error.BadMethod => {
            try xrpcError(request, .unauthorized, "BadJwtLexiconMethod", "jwt lxm does not match", request_id, cors);
            return;
        },
        error.Expired => {
            try xrpcError(request, .unauthorized, "JwtExpired", "jwt expired", request_id, cors);
            return;
        },
        else => {
            std.log.info("checkUserAccess auth rejected: {s}", .{@errorName(err)});
            try xrpcError(request, .unauthorized, "AuthenticationRequired", "invalid service auth", request_id, cors);
            return;
        },
    };

    var core: space_access.Core = .{
        .space_type = config.space_type,
        .policy_collection = config.policy_collection,
        .policies = network.policies(),
        .evidence = network.evidence(),
        .sync_reader = config.sync_reader,
    };
    // anything short of a definite yes is no: the PDS treats it the same
    const authorized = core.decider().decide(allocator, .{
        .space = params.space,
        .user = params.user,
        .access = params.access,
    }) catch |err| blk: {
        if (err == error.OutOfMemory) return err;
        std.log.warn("access check failed: {s}", .{@errorName(err)});
        break :blk false;
    };
    try response.json(
        request,
        .ok,
        if (authorized) "{\"authorized\":true}" else "{\"authorized\":false}",
        request_id,
        cors,
    );
}

test "checkUserAccess params" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const params = try parseParams(arena, "/xrpc/x?space=at%3A%2F%2Fdid%3Aplc%3Aartist%2Fspace%2Ffm.plyr.next.audio%2Fsupporters&user=did:plc:fan&access=read&clientId=https%3A%2F%2Fnext.plyr.fm");
    try std.testing.expectEqualStrings("did:plc:artist", params.space.authority);
    try std.testing.expectEqualStrings("did:plc:fan", params.user);
    try std.testing.expectEqual(managed_space.Access.read, params.access);
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?user=did:plc:fan&access=read"));
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?space=at://did:plc:a/space/fm.plyr.next.audio/s&user=nope"));
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?space=at://did:plc:a/space/fm.plyr.next.audio/s&user=did:plc:b&access=admin"));
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?space=at://did:plc:a/space/fm.plyr.next.audio/s&user=did:plc:b&user=did:plc:c"));
}
