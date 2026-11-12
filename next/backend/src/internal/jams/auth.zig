const std = @import("std");
const zat = @import("zat");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");
const pinned_tls = @import("../ingest/pinned_tls.zig");

pub const Config = struct {
    audience: []const u8,
    method: []const u8,
    space_type: []const u8,
    plc_url: []const u8 = "https://plc.directory",
    test_pds_origin: ?[]const u8 = null,
};

pub const Admission = struct {
    actor: []const u8,
    host: []const u8,
    room: []const u8,
    expires_ms: i64,
};

const Identity = struct { actor: []const u8, public_key: []const u8 };

fn identify(allocator: std.mem.Allocator, resolver: *zat.DidResolver, config: Config, service: []const u8, now: i64) !Identity {
    var identity = zat.Jwt.parse(allocator, service) catch return error.InvalidIdentity;
    defer identity.deinit();
    if (!std.mem.eql(u8, try tokenType(allocator, service), "JWT") or !std.mem.eql(u8, identity.payload.aud, config.audience) or
        !std.mem.eql(u8, identity.payload.lxm orelse "", config.method) or identity.payload.exp <= now or identity.payload.exp > now + 300)
        return error.InvalidIdentity;
    const actor = identity.payload.iss;
    const did = zat.Did.parse(actor) orelse return error.InvalidIdentity;
    var document = try resolver.resolve(did);
    defer document.deinit();
    if (!std.mem.eql(u8, document.id, actor)) return error.InvalidIdentity;
    const signing_key = document.signingKey() orelse return error.InvalidIdentity;
    if (!std.mem.eql(u8, signing_key.controller, actor)) return error.InvalidIdentity;
    identity.verify(signing_key.public_key_multibase) catch return error.InvalidIdentity;
    return .{ .actor = try allocator.dupe(u8, actor), .public_key = try allocator.dupe(u8, signing_key.public_key_multibase) };
}

const queue_prefix = "queue:";

pub fn queueRoom(allocator: std.mem.Allocator, owner: []const u8) ![]const u8 {
    return std.fmt.allocPrint(allocator, queue_prefix ++ "{s}", .{owner});
}

pub fn queueOwner(room: []const u8) ?[]const u8 {
    return if (std.mem.startsWith(u8, room, queue_prefix)) room[queue_prefix.len..] else null;
}

/// A personal queue belongs to whoever proves the identity; no Space is involved.
pub fn admitOwner(allocator: std.mem.Allocator, io: std.Io, config: Config, service: []const u8) !Admission {
    const now = std.Io.Timestamp.now(io, .real).toSeconds();
    var resolver = zat.DidResolver.init(io, allocator);
    defer resolver.deinit();
    resolver.plc_url = config.plc_url;
    const owner = try identify(allocator, &resolver, config, service, now);
    return .{ .actor = owner.actor, .host = owner.actor, .room = try queueRoom(allocator, owner.actor), .expires_ms = (now + 600) * 1000 };
}

pub fn admit(allocator: std.mem.Allocator, io: std.Io, config: Config, host: []const u8, key: []const u8, service: []const u8, delegation: []const u8) !Admission {
    if (zat.Did.parse(host) == null or zat.Rkey.parse(key) == null or key.len > 64) return error.InvalidRoom;
    const now = std.Io.Timestamp.now(io, .real).toSeconds();
    var resolver = zat.DidResolver.init(io, allocator);
    defer resolver.deinit();
    resolver.plc_url = config.plc_url;
    const member = try identify(allocator, &resolver, config, service, now);
    const actor = member.actor;
    const space = try std.fmt.allocPrint(allocator, "at://{s}/space/{s}/{s}", .{ host, config.space_type, key });
    var delegated = zat.Jwt.parse(allocator, delegation) catch return error.InvalidDelegation;
    defer delegated.deinit();
    if (!std.mem.eql(u8, try tokenType(allocator, delegation), "atproto-space-delegation+jwt") or !std.mem.eql(u8, delegated.payload.iss, actor) or
        !std.mem.eql(u8, delegated.payload.aud, try std.fmt.allocPrint(allocator, "{s}#atproto_pds", .{host})) or
        delegated.payload.exp <= now or delegated.payload.exp > now + 120) return error.InvalidDelegation;
    delegated.verify(member.public_key) catch return error.InvalidDelegation;
    const claims = try tokenClaims(allocator, delegation);
    if (!std.mem.eql(u8, string(claims, "sub") orelse "", space)) return error.InvalidDelegation;
    var host_document = try resolver.resolve(zat.Did.parse(host).?);
    defer host_document.deinit();
    if (!std.mem.eql(u8, host_document.id, host)) return error.InvalidIdentity;
    const pds = config.test_pds_origin orelse host_document.pdsEndpoint() orelse return error.MissingPds;
    var secret: [32]u8 = undefined;
    io.random(&secret);
    var pair = try zat.Keypair.fromSecretKey(.p256, secret);
    defer std.crypto.secureZero(u8, &pair.secret_key);
    const kid = try pair.did(allocator);
    const body = try std.json.Stringify.valueAlloc(allocator, .{ .space = space, .credentialKid = kid, .delegationToken = delegation }, .{});
    var transport = zat.HttpTransport.init(io, allocator);
    defer transport.deinit();
    const endpoint: ?safe_endpoint.Endpoint = if (config.test_pds_origin == null) try safe_endpoint.resolve(io, allocator, pds) else null;
    defer if (endpoint) |value| value.deinit(allocator);
    if (endpoint != null) try pinned_tls.prepare(io, &transport);
    var response = try transport.fetch(.{
        .url = try std.fmt.allocPrint(allocator, "{s}/xrpc/com.atproto.space.getSpaceCredential", .{pds}),
        .method = .POST,
        .content_type = "application/json",
        .payload = body,
        .max_response_size = 16 * 1024,
        .on_redirect = .refuse,
        .resolved_connection = if (endpoint) |value| value.connection() else null,
        .deadline_ns = 5 * std.time.ns_per_s,
    });
    defer response.deinit(allocator);
    if (response.status == .unauthorized or response.status == .forbidden or response.status == .bad_request or response.status == .not_found) return error.AccessDenied;
    if (response.status != .ok) return error.UpstreamUnavailable;
    const result = try std.json.parseFromSliceLeaky(std.json.Value, allocator, response.body, .{});
    const credential = string(result, "credential") orelse return error.InvalidCredential;
    const payload = try tokenClaims(allocator, credential);
    if (!std.mem.eql(u8, string(payload, "iss") orelse "", host) or !std.mem.eql(u8, string(payload, "sub") orelse "", space)) return error.InvalidCredential;
    const cnf = if (payload == .object) payload.object.get("cnf") orelse return error.InvalidCredential else return error.InvalidCredential;
    if (!std.mem.eql(u8, string(cnf, "kid") orelse "", kid)) return error.InvalidCredential;
    const exp = if (payload.object.get("exp")) |value| if (value == .integer) value.integer else return error.InvalidCredential else return error.InvalidCredential;
    if (exp <= now) return error.InvalidCredential;
    return .{ .actor = try allocator.dupe(u8, actor), .host = try allocator.dupe(u8, host), .room = try allocator.dupe(u8, space), .expires_ms = @min(exp, now + 600) * 1000 };
}

fn tokenClaims(allocator: std.mem.Allocator, token: []const u8) !std.json.Value {
    var parts = std.mem.splitScalar(u8, token, '.');
    _ = parts.next() orelse return error.InvalidToken;
    const encoded = parts.next() orelse return error.InvalidToken;
    const bytes = try zat.jwt.base64UrlDecode(allocator, encoded);
    return std.json.parseFromSliceLeaky(std.json.Value, allocator, bytes, .{});
}

pub fn string(value: std.json.Value, key: []const u8) ?[]const u8 {
    const field = if (value == .object) value.object.get(key) orelse return null else return null;
    return if (field == .string) field.string else null;
}

fn tokenType(a: std.mem.Allocator, token: []const u8) ![]const u8 {
    const end = std.mem.indexOfScalar(u8, token, '.') orelse return error.InvalidToken;
    const bytes = try zat.jwt.base64UrlDecode(a, token[0..end]);
    const header = try std.json.parseFromSliceLeaky(std.json.Value, a, bytes, .{});
    return string(header, "typ") orelse return error.InvalidToken;
}

test "delegation token type remains distinct from service identity" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try std.testing.expectEqualStrings("JWT", try tokenType(a, "eyJ0eXAiOiJKV1QifQ.e30.signature"));
    try std.testing.expectEqualStrings("atproto-space-delegation+jwt", try tokenType(a, "eyJ0eXAiOiJhdHByb3RvLXNwYWNlLWRlbGVnYXRpb24rand0In0.e30.signature"));
    try std.testing.expectError(error.InvalidToken, tokenType(a, "e30.e30.signature"));
    try std.testing.expectError(error.InvalidToken, tokenType(a, "missing-separators"));
}
