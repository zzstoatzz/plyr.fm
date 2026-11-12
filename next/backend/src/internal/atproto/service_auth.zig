//! Inter-service auth: the short-lived JWT an account's PDS signs with the
//! account's repo key (`com.atproto.server.getServiceAuth`, or minted by the
//! PDS itself when it proxies a request).
//!
//! The verifier binds a token to one audience set and one XRPC method, bounds
//! its lifetime, and checks the signature against the issuer's current
//! `#atproto` key. It returns the issuer DID; what that account may do is the
//! caller's decision.

const std = @import("std");
const zat = @import("zat");

/// Clock skew tolerated on expiry, in seconds.
pub const expiry_skew_seconds = 30;
/// Longest lifetime accepted (service auth is short-lived; a far-future exp
/// is a replayable credential).
pub const max_lifetime_seconds = 5 * 60;

pub const Error = error{
    OutOfMemory,
    MalformedToken,
    BadAudience,
    BadMethod,
    BadIssuer,
    Expired,
    IssuerKeyUnavailable,
    BadSignature,
};

/// Resolves a DID to its `#atproto` signing key as a multibase string.
pub const KeyLookup = struct {
    context: *anyopaque,
    lookup_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) anyerror![]const u8,

    pub fn lookup(self: KeyLookup, allocator: std.mem.Allocator, did: []const u8) ![]const u8 {
        return self.lookup_fn(self.context, allocator, did);
    }
};

pub const Expectation = struct {
    /// Every audience this service answers to. A PDS may put the bare service
    /// DID or the DID with a service fragment in `aud`.
    audiences: []const []const u8,
    /// The XRPC method the token must name in `lxm`.
    method: []const u8,
};

/// Verify `token` and return its issuer DID (any `#fragment` removed), owned
/// by `allocator`.
pub fn verify(
    allocator: std.mem.Allocator,
    now_seconds: i64,
    token: []const u8,
    expectation: Expectation,
    keys: KeyLookup,
) Error![]const u8 {
    var jwt = zat.Jwt.parse(allocator, token) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.MalformedToken,
    };
    defer jwt.deinit();
    const payload = jwt.payload;
    if (!oneOf(payload.aud, expectation.audiences)) return error.BadAudience;
    const lxm = payload.lxm orelse return error.BadMethod;
    if (!std.mem.eql(u8, lxm, expectation.method)) return error.BadMethod;
    const issuer = if (std.mem.indexOfScalar(u8, payload.iss, '#')) |hash| payload.iss[0..hash] else payload.iss;
    if (zat.Did.parse(issuer) == null) return error.BadIssuer;
    if (now_seconds > payload.exp + expiry_skew_seconds) return error.Expired;
    if (payload.exp - now_seconds > max_lifetime_seconds + expiry_skew_seconds) return error.Expired;
    const key = keys.lookup(allocator, issuer) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.IssuerKeyUnavailable,
    };
    defer allocator.free(key);
    jwt.verify(key) catch return error.BadSignature;
    return allocator.dupe(u8, issuer);
}

fn oneOf(value: []const u8, candidates: []const []const u8) bool {
    for (candidates) |candidate| if (std.mem.eql(u8, value, candidate)) return true;
    return false;
}

/// `Authorization: Bearer <token>`; null when absent, repeated or malformed.
pub fn bearerToken(request: *const std.http.Server.Request) ?[]const u8 {
    var token: ?[]const u8 = null;
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (!std.ascii.eqlIgnoreCase(header.name, "authorization")) continue;
        if (token != null) return null;
        if (header.value.len <= "Bearer ".len or
            !std.ascii.eqlIgnoreCase(header.value[0.."Bearer ".len], "Bearer ")) return null;
        token = std.mem.trim(u8, header.value["Bearer ".len..], " ");
    }
    return token;
}

// --- tests -----------------------------------------------------------------

pub const TestKeys = struct {
    did: []const u8,
    multibase: []const u8,

    pub fn keys(self: *TestKeys) KeyLookup {
        return .{ .context = self, .lookup_fn = lookup };
    }

    fn lookup(context: *anyopaque, allocator: std.mem.Allocator, did: []const u8) anyerror![]const u8 {
        const self: *TestKeys = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, did, self.did)) return error.UnknownDid;
        return allocator.dupe(u8, self.multibase);
    }
};

/// Test helper: a multibase public key for `keypair`.
pub fn testMultibase(arena: std.mem.Allocator, keypair: zat.Keypair) ![]const u8 {
    const public_key = try keypair.publicKey();
    const encoded_key = try zat.multicodec.encodePublicKey(arena, .secp256k1, &public_key);
    return zat.multibase.encode(arena, .base58btc, encoded_key);
}

/// Test helper: an ES256K service JWT over `claims`.
pub fn signTestToken(arena: std.mem.Allocator, keypair: zat.Keypair, claims: anytype) ![]const u8 {
    var payload: std.Io.Writer.Allocating = .init(arena);
    try std.json.Stringify.value(claims, .{ .emit_null_optional_fields = false }, &payload.writer);
    const header = try zat.jwt.base64UrlEncode(arena, "{\"alg\":\"ES256K\",\"typ\":\"JWT\"}");
    const body = try zat.jwt.base64UrlEncode(arena, payload.written());
    const signed_input = try std.fmt.allocPrint(arena, "{s}.{s}", .{ header, body });
    const signature = try keypair.sign(signed_input);
    const encoded = try zat.jwt.base64UrlEncode(arena, &signature.bytes);
    return std.fmt.allocPrint(arena, "{s}.{s}", .{ signed_input, encoded });
}

test "service JWTs bind audience, method, lifetime and the issuer's key" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const keypair = try zat.Keypair.fromSecretKey(.secp256k1, @splat(7));
    const other = try zat.Keypair.fromSecretKey(.secp256k1, @splat(9));
    var keys: TestKeys = .{ .did = "did:plc:listener", .multibase = try testMultibase(arena, keypair) };
    const expectation: Expectation = .{
        .audiences = &.{ "did:web:api.example", "did:web:api.example#plyr_appview" },
        .method = "fm.plyr.notification.listNotifications",
    };
    const now: i64 = 1_800_000_000;

    const bare = try signTestToken(arena, keypair, .{ .iss = "did:plc:listener", .aud = "did:web:api.example", .exp = now + 60, .lxm = expectation.method });
    try std.testing.expectEqualStrings("did:plc:listener", try verify(arena, now, bare, expectation, keys.keys()));

    const fragment = try signTestToken(arena, keypair, .{ .iss = "did:plc:listener#atproto", .aud = "did:web:api.example#plyr_appview", .exp = now + 60, .lxm = expectation.method });
    try std.testing.expectEqualStrings("did:plc:listener", try verify(arena, now, fragment, expectation, keys.keys()));

    const foreign = try signTestToken(arena, keypair, .{ .iss = "did:plc:listener", .aud = "did:web:elsewhere.example", .exp = now + 60, .lxm = expectation.method });
    try std.testing.expectError(error.BadAudience, verify(arena, now, foreign, expectation, keys.keys()));

    const other_method = try signTestToken(arena, keypair, .{ .iss = "did:plc:listener", .aud = "did:web:api.example", .exp = now + 60, .lxm = "fm.plyr.notification.updateSeen" });
    try std.testing.expectError(error.BadMethod, verify(arena, now, other_method, expectation, keys.keys()));

    const no_method = try signTestToken(arena, keypair, .{ .iss = "did:plc:listener", .aud = "did:web:api.example", .exp = now + 60 });
    try std.testing.expectError(error.BadMethod, verify(arena, now, no_method, expectation, keys.keys()));

    const not_a_did = try signTestToken(arena, keypair, .{ .iss = "listener.example", .aud = "did:web:api.example", .exp = now + 60, .lxm = expectation.method });
    try std.testing.expectError(error.BadIssuer, verify(arena, now, not_a_did, expectation, keys.keys()));

    try std.testing.expectError(error.Expired, verify(arena, now + 600, bare, expectation, keys.keys()));
    const long_lived = try signTestToken(arena, keypair, .{ .iss = "did:plc:listener", .aud = "did:web:api.example", .exp = now + 86_400, .lxm = expectation.method });
    try std.testing.expectError(error.Expired, verify(arena, now, long_lived, expectation, keys.keys()));

    const unknown = try signTestToken(arena, keypair, .{ .iss = "did:plc:stranger", .aud = "did:web:api.example", .exp = now + 60, .lxm = expectation.method });
    try std.testing.expectError(error.IssuerKeyUnavailable, verify(arena, now, unknown, expectation, keys.keys()));

    const forged = try signTestToken(arena, other, .{ .iss = "did:plc:listener", .aud = "did:web:api.example", .exp = now + 60, .lxm = expectation.method });
    try std.testing.expectError(error.BadSignature, verify(arena, now, forged, expectation, keys.keys()));

    try std.testing.expectError(error.MalformedToken, verify(arena, now, "not.a.jwt", expectation, keys.keys()));
}
