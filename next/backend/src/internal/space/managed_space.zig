//! plyr as the managing app of gated-audio managedspaces.
//!
//! An artist's PDS owns the space (`at://{artist}/space/{type}/{skey}`) and
//! names plyr as its managing app. When a listener asks that PDS for a space
//! credential, the PDS asks plyr `checkUserAccess` with a service JWT the
//! artist's repo key signed. plyr answers one bit; it never holds or relays
//! the audio.
//!
//! The skey carries the gate:
//!   - `supporters`: the listener must support the artist (atprotofans).
//!   - `signed-in`: any signed-in listener.
//! The artist always has access to their own space, and nobody else may
//! write to it.

const std = @import("std");
const zat = @import("zat");

pub const check_user_access_nsid = "com.atproto.managedspace.checkUserAccess";

/// Clock skew tolerated on service-JWT expiry, in seconds.
const expiry_skew_seconds = 30;
/// Longest lifetime accepted on a service JWT (atproto service auth is
/// short-lived; a far-future exp is a replayable credential).
const max_lifetime_seconds = 5 * 60;

pub const Config = struct {
    /// e.g. `did:web:api.next.plyr.fm`
    service_did: []const u8,
    /// DID-doc service id without `#`, e.g. `plyr_space`
    service_id: []const u8,
    /// e.g. `https://api.next.plyr.fm`
    service_endpoint: []const u8,
    /// the space type plyr manages, e.g. `fm.plyr.stg.audio`
    space_type: []const u8,

    /// The managingApp value artists put in their space policy, and the aud
    /// every checkUserAccess JWT must carry (fragment included).
    pub fn managingApp(self: Config, allocator: std.mem.Allocator) ![]const u8 {
        return std.fmt.allocPrint(allocator, "{s}#{s}", .{ self.service_did, self.service_id });
    }

    pub fn didDocument(self: Config, allocator: std.mem.Allocator) ![]const u8 {
        var out: std.Io.Writer.Allocating = .init(allocator);
        try std.json.Stringify.value(.{
            .@"@context" = .{"https://www.w3.org/ns/did/v1"},
            .id = self.service_did,
            .service = .{.{
                .id = try std.fmt.allocPrint(allocator, "#{s}", .{self.service_id}),
                .type = "PlyrManagedSpace",
                .serviceEndpoint = self.service_endpoint,
            }},
        }, .{}, &out.writer);
        return out.written();
    }
};

pub const Access = enum {
    read,
    write,

    pub fn parse(text: []const u8) ?Access {
        return std.meta.stringToEnum(Access, text);
    }
};

pub const Gate = enum {
    supporters,
    @"signed-in",

    pub fn parse(skey: []const u8) ?Gate {
        return std.meta.stringToEnum(Gate, skey);
    }
};

pub const SpaceUri = struct {
    authority: []const u8,
    space_type: []const u8,
    skey: []const u8,

    /// `at://{authority-did}/space/{type-nsid}/{skey}`
    pub fn parse(text: []const u8) ?SpaceUri {
        const rest = if (std.mem.startsWith(u8, text, "at://")) text["at://".len..] else return null;
        var parts = std.mem.splitScalar(u8, rest, '/');
        const authority = parts.next() orelse return null;
        const marker = parts.next() orelse return null;
        const space_type = parts.next() orelse return null;
        const skey = parts.next() orelse return null;
        if (parts.next() != null) return null;
        if (!std.mem.eql(u8, marker, "space")) return null;
        if (zat.Did.parse(authority) == null) return null;
        if (zat.Nsid.parse(space_type) == null) return null;
        if (skey.len == 0 or skey.len > 512) return null;
        return .{ .authority = authority, .space_type = space_type, .skey = skey };
    }
};

/// A record inside a space:
/// `at://{authority}/space/{type}/{skey}/{repo}/{collection}/{rkey}`.
pub const SpaceRecordUri = struct {
    space: SpaceUri,
    /// `at://{authority}/space/{type}/{skey}`, a prefix of the record URI
    space_uri: []const u8,
    repo: []const u8,
    collection: []const u8,
    rkey: []const u8,

    pub fn parse(text: []const u8) ?SpaceRecordUri {
        var cut: usize = "at://".len;
        var seen: usize = 0;
        while (seen < 4) : (seen += 1) {
            const slash = std.mem.indexOfScalarPos(u8, text, cut, '/') orelse return null;
            cut = slash + 1;
        }
        const space_uri = text[0 .. cut - 1];
        const space = SpaceUri.parse(space_uri) orelse return null;
        var parts = std.mem.splitScalar(u8, text[cut..], '/');
        const repo = parts.next() orelse return null;
        const collection = parts.next() orelse return null;
        const rkey = parts.next() orelse return null;
        if (parts.next() != null) return null;
        if (zat.Did.parse(repo) == null) return null;
        if (zat.Nsid.parse(collection) == null) return null;
        if (zat.Rkey.parse(rkey) == null) return null;
        return .{ .space = space, .space_uri = space_uri, .repo = repo, .collection = collection, .rkey = rkey };
    }
};

pub const Decision = enum { allow, deny, check_supporter };

/// The access rule, without any I/O.
pub fn decide(config: Config, space: SpaceUri, user: []const u8, access: Access) Decision {
    if (!std.mem.eql(u8, space.space_type, config.space_type)) return .deny;
    if (std.mem.eql(u8, user, space.authority)) return .allow;
    if (access == .write) return .deny;
    const gate = Gate.parse(space.skey) orelse return .deny;
    return switch (gate) {
        .@"signed-in" => .allow,
        .supporters => .check_supporter,
    };
}

pub const AuthError = error{
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

/// Verify the PDS's service JWT: aud is the managingApp (fragment included),
/// lxm is checkUserAccess, iss is the space authority, signed by its key.
pub fn verifyServiceAuth(
    allocator: std.mem.Allocator,
    now_seconds: i64,
    token: []const u8,
    managing_app: []const u8,
    authority: []const u8,
    keys: KeyLookup,
) AuthError!void {
    var jwt = zat.Jwt.parse(allocator, token) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.MalformedToken,
    };
    defer jwt.deinit();
    const payload = jwt.payload;
    if (!std.mem.eql(u8, payload.aud, managing_app)) return error.BadAudience;
    const lxm = payload.lxm orelse return error.BadMethod;
    if (!std.mem.eql(u8, lxm, check_user_access_nsid)) return error.BadMethod;
    const issuer = if (std.mem.indexOfScalar(u8, payload.iss, '#')) |hash| payload.iss[0..hash] else payload.iss;
    if (!std.mem.eql(u8, issuer, authority)) return error.BadIssuer;
    if (now_seconds > payload.exp + expiry_skew_seconds) return error.Expired;
    if (payload.exp - now_seconds > max_lifetime_seconds + expiry_skew_seconds) return error.Expired;
    const key = keys.lookup(allocator, issuer) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.IssuerKeyUnavailable,
    };
    jwt.verify(key) catch return error.BadSignature;
}

/// Answers "does `supporter` support `artist`".
pub const SupporterCheck = struct {
    context: *anyopaque,
    check_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8, []const u8) anyerror!bool,

    pub fn check(self: SupporterCheck, allocator: std.mem.Allocator, supporter: []const u8, artist: []const u8) !bool {
        return self.check_fn(self.context, allocator, supporter, artist);
    }
};

/// Full answer for an authenticated request. Supporter-check failures are
/// denials: the PDS treats anything but `true` as no access anyway.
pub fn authorize(
    allocator: std.mem.Allocator,
    config: Config,
    space: SpaceUri,
    user: []const u8,
    access: Access,
    supporters: SupporterCheck,
) bool {
    return switch (decide(config, space, user, access)) {
        .allow => true,
        .deny => false,
        .check_supporter => supporters.check(allocator, user, space.authority) catch |err| blk: {
            std.log.warn("supporter check failed: {s}", .{@errorName(err)});
            break :blk false;
        },
    };
}

// --- tests -----------------------------------------------------------------

const test_config: Config = .{
    .service_did = "did:web:api.next.plyr.fm",
    .service_id = "plyr_space",
    .service_endpoint = "https://api.next.plyr.fm",
    .space_type = "fm.plyr.stg.audio",
};

test "space URIs parse strictly" {
    const space = SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/supporters").?;
    try std.testing.expectEqualStrings("did:plc:artist", space.authority);
    try std.testing.expectEqualStrings("fm.plyr.stg.audio", space.space_type);
    try std.testing.expectEqualStrings("supporters", space.skey);
    try std.testing.expect(SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio") == null);
    try std.testing.expect(SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/x/y") == null);
    try std.testing.expect(SpaceUri.parse("at://did:plc:artist/fm.plyr.stg.track/abc/x") == null);
    try std.testing.expect(SpaceUri.parse("https://did:plc:artist/space/fm.plyr.stg.audio/x") == null);
}

test "space record URIs parse strictly" {
    const record = SpaceRecordUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/supporters/did:plc:artist/fm.plyr.stg.track/3l2abc").?;
    try std.testing.expectEqualStrings("at://did:plc:artist/space/fm.plyr.stg.audio/supporters", record.space_uri);
    try std.testing.expectEqualStrings("supporters", record.space.skey);
    try std.testing.expectEqualStrings("did:plc:artist", record.repo);
    try std.testing.expectEqualStrings("fm.plyr.stg.track", record.collection);
    try std.testing.expectEqualStrings("3l2abc", record.rkey);
    try std.testing.expect(SpaceRecordUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/supporters") == null);
    try std.testing.expect(SpaceRecordUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/supporters/did:plc:artist/fm.plyr.stg.track") == null);
    try std.testing.expect(SpaceRecordUri.parse("at://did:plc:artist/fm.plyr.stg.track/3l2abc") == null);
    try std.testing.expect(SpaceRecordUri.parse("at://did:plc:a/space/fm.plyr.stg.audio/s/did:plc:a/fm.plyr.stg.track/x/y") == null);
}

test "access rules" {
    const supporters = SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/supporters").?;
    const signed_in = SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/signed-in").?;
    const unknown = SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/vip").?;
    const foreign = SpaceUri.parse("at://did:plc:artist/space/com.example.space/supporters").?;
    try std.testing.expectEqual(Decision.allow, decide(test_config, supporters, "did:plc:artist", .read));
    try std.testing.expectEqual(Decision.allow, decide(test_config, supporters, "did:plc:artist", .write));
    try std.testing.expectEqual(Decision.check_supporter, decide(test_config, supporters, "did:plc:fan", .read));
    try std.testing.expectEqual(Decision.deny, decide(test_config, supporters, "did:plc:fan", .write));
    try std.testing.expectEqual(Decision.allow, decide(test_config, signed_in, "did:plc:fan", .read));
    try std.testing.expectEqual(Decision.deny, decide(test_config, signed_in, "did:plc:fan", .write));
    try std.testing.expectEqual(Decision.deny, decide(test_config, unknown, "did:plc:fan", .read));
    try std.testing.expectEqual(Decision.deny, decide(test_config, foreign, "did:plc:artist", .read));
}

test "did document names the managing-app service" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    try std.testing.expectEqualStrings("did:web:api.next.plyr.fm#plyr_space", try test_config.managingApp(arena));
    const doc = try zat.DidDocument.parse(arena, try test_config.didDocument(arena));
    try std.testing.expectEqualStrings("did:web:api.next.plyr.fm", doc.id);
    try std.testing.expectEqualStrings("#plyr_space", doc.services[0].id);
    try std.testing.expectEqualStrings("https://api.next.plyr.fm", doc.services[0].service_endpoint);
}

const TestKeys = struct {
    did: []const u8,
    multibase: []const u8,

    fn lookup(context: *anyopaque, allocator: std.mem.Allocator, did: []const u8) anyerror![]const u8 {
        const self: *TestKeys = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, did, self.did)) return error.UnknownDid;
        return allocator.dupe(u8, self.multibase);
    }
};

fn signToken(arena: std.mem.Allocator, keypair: zat.Keypair, claims: anytype) ![]const u8 {
    var payload: std.Io.Writer.Allocating = .init(arena);
    try std.json.Stringify.value(claims, .{ .emit_null_optional_fields = false }, &payload.writer);
    const header = try zat.jwt.base64UrlEncode(arena, "{\"alg\":\"ES256K\",\"typ\":\"JWT\"}");
    const body = try zat.jwt.base64UrlEncode(arena, payload.written());
    const signed_input = try std.fmt.allocPrint(arena, "{s}.{s}", .{ header, body });
    const signature = try keypair.sign(signed_input);
    const encoded = try zat.jwt.base64UrlEncode(arena, &signature.bytes);
    return std.fmt.allocPrint(arena, "{s}.{s}", .{ signed_input, encoded });
}

test "service JWTs are bound to the managing app, method, authority and key" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const keypair = try zat.Keypair.fromSecretKey(.secp256k1, @splat(7));
    const other = try zat.Keypair.fromSecretKey(.secp256k1, @splat(9));
    const public_key = try keypair.publicKey();
    const encoded_key = try zat.multicodec.encodePublicKey(arena, .secp256k1, &public_key);
    var keys: TestKeys = .{
        .did = "did:plc:artist",
        .multibase = try zat.multibase.encode(arena, .base58btc, encoded_key),
    };
    const lookup: KeyLookup = .{ .context = &keys, .lookup_fn = TestKeys.lookup };
    const app = try test_config.managingApp(arena);
    const now: i64 = 1_800_000_000;

    const good = try signToken(arena, keypair, .{
        .iss = "did:plc:artist",
        .aud = app,
        .exp = now + 60,
        .lxm = check_user_access_nsid,
    });
    try verifyServiceAuth(arena, now, good, app, "did:plc:artist", lookup);

    // the bare DID is not the audience: the fragment is part of it
    const bare = try signToken(arena, keypair, .{ .iss = "did:plc:artist", .aud = "did:web:api.next.plyr.fm", .exp = now + 60, .lxm = check_user_access_nsid });
    try std.testing.expectError(error.BadAudience, verifyServiceAuth(arena, now, bare, app, "did:plc:artist", lookup));

    const wrong_method = try signToken(arena, keypair, .{ .iss = "did:plc:artist", .aud = app, .exp = now + 60, .lxm = "com.atproto.repo.getRecord" });
    try std.testing.expectError(error.BadMethod, verifyServiceAuth(arena, now, wrong_method, app, "did:plc:artist", lookup));

    try std.testing.expectError(error.BadIssuer, verifyServiceAuth(arena, now, good, app, "did:plc:someone", lookup));
    try std.testing.expectError(error.Expired, verifyServiceAuth(arena, now + 600, good, app, "did:plc:artist", lookup));

    const long_lived = try signToken(arena, keypair, .{ .iss = "did:plc:artist", .aud = app, .exp = now + 86_400, .lxm = check_user_access_nsid });
    try std.testing.expectError(error.Expired, verifyServiceAuth(arena, now, long_lived, app, "did:plc:artist", lookup));

    const forged = try signToken(arena, other, .{ .iss = "did:plc:artist", .aud = app, .exp = now + 60, .lxm = check_user_access_nsid });
    try std.testing.expectError(error.BadSignature, verifyServiceAuth(arena, now, forged, app, "did:plc:artist", lookup));

    const fragment_issuer = try signToken(arena, keypair, .{ .iss = "did:plc:artist#atproto_pds", .aud = app, .exp = now + 60, .lxm = check_user_access_nsid });
    try verifyServiceAuth(arena, now, fragment_issuer, app, "did:plc:artist", lookup);
}

test "supporter checks gate only supporter spaces and fail closed" {
    const Stub = struct {
        answer: anyerror!bool,
        calls: usize = 0,
        fn check(context: *anyopaque, _: std.mem.Allocator, _: []const u8, _: []const u8) anyerror!bool {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            return self.answer;
        }
    };
    const space = SpaceUri.parse("at://did:plc:artist/space/fm.plyr.stg.audio/supporters").?;
    var yes: Stub = .{ .answer = true };
    var down: Stub = .{ .answer = error.Unavailable };
    try std.testing.expect(authorize(std.testing.allocator, test_config, space, "did:plc:fan", .read, .{ .context = &yes, .check_fn = Stub.check }));
    try std.testing.expect(!authorize(std.testing.allocator, test_config, space, "did:plc:fan", .read, .{ .context = &down, .check_fn = Stub.check }));
    try std.testing.expect(authorize(std.testing.allocator, test_config, space, "did:plc:artist", .read, .{ .context = &down, .check_fn = Stub.check }));
    try std.testing.expectEqual(@as(usize, 1), down.calls);
}
