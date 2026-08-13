//! Browser-login application service.
//!
//! This owns one-time state, issuer/subject-bound OAuth completion, encrypted
//! credential persistence, and atomic bearer issuance. It knows neither HTTP
//! request objects nor PostgreSQL tables.

const std = @import("std");
const config = @import("../../config.zig");
const bearer = @import("../auth/bearer_token.zig");
const login_identifier = @import("../auth/login_identifier.zig");
const oauth_gateway = @import("../auth/oauth_gateway.zig");
const oauth_state = @import("../auth/oauth_state.zig");
const sealed_secret = @import("../auth/sealed_secret.zig");
const auth_store = @import("../auth/store.zig");

pub const Callback = struct {
    code: []const u8,
    state: []const u8,
    issuer: []const u8,
};

pub const Start = struct {
    redirect_url: []const u8,
    state: []const u8,
};

pub const Service = struct {
    io: std.Io,
    settings: config.AuthConfig,
    store: auth_store.Store,
    oauth: oauth_gateway.Client,

    pub fn start(
        self: Service,
        allocator: std.mem.Allocator,
        identifier: login_identifier.Identifier,
    ) !Start {
        const begun = self.oauth.begin(allocator, self.settings, identifier) catch |err| {
            std.log.warn("OAuth gateway start failed: {}", .{err});
            return error.OauthStartFailed;
        };
        if (!isCanonicalState(begun.state)) return error.InvalidOauthState;
        const plaintext = oauth_state.encodeRequest(allocator, begun.request) catch
            return error.AuthStateEncodingFailed;
        const sealed = sealed_secret.seal(
            allocator,
            self.io,
            self.settings.encryption_key,
            "plyr/auth/request/v1",
            plaintext,
        ) catch return error.AuthStateEncodingFailed;
        self.store.putRequest(bearer.digest(begun.state), sealed, 600) catch
            return error.AuthStoreUnavailable;
        return .{
            .redirect_url = begun.redirect_url,
            .state = begun.state,
        };
    }

    pub fn callback(
        self: Service,
        allocator: std.mem.Allocator,
        params: Callback,
    ) ![]const u8 {
        if (!isCanonicalState(params.state)) return error.InvalidOauthState;
        const sealed_request = (self.store.takeRequest(
            allocator,
            bearer.digest(params.state),
        ) catch return error.AuthStoreUnavailable) orelse return error.ExpiredOauthState;
        const plaintext = sealed_secret.open(
            allocator,
            self.settings.encryption_key,
            "plyr/auth/request/v1",
            sealed_request,
        ) catch return error.CorruptAuthState;
        const stored = oauth_state.decodeRequest(allocator, plaintext) catch
            return error.CorruptAuthState;
        if (!std.mem.eql(u8, params.issuer, stored.issuer))
            return error.IssuerMismatch;

        const exchanged = self.oauth.exchangeCode(
            allocator,
            self.settings,
            stored,
            params.code,
        ) catch |err| {
            std.log.warn("OAuth gateway token exchange failed: {}", .{err});
            return error.TokenExchangeFailed;
        };
        const credentials_plaintext = oauth_state.encodeCredentials(
            allocator,
            exchanged.credentials,
        ) catch return error.SessionEncodingFailed;
        const sealed_credentials = sealed_secret.seal(
            allocator,
            self.io,
            self.settings.encryption_key,
            "plyr/auth/session/v1",
            credentials_plaintext,
        ) catch return error.SessionEncodingFailed;
        const session_token = bearer.generate(allocator, self.io) catch
            return error.SessionEncodingFailed;
        const exchange_token = bearer.generate(allocator, self.io) catch
            return error.SessionEncodingFailed;
        const sealed_session_token = sealed_secret.seal(
            allocator,
            self.io,
            self.settings.encryption_key,
            "plyr/auth/exchange/v1",
            session_token,
        ) catch return error.SessionEncodingFailed;
        var group_id_buffer: [36]u8 = undefined;
        self.store.createSessionExchange(.{
            .session_digest = bearer.digest(session_token),
            .group_id = uuidV4(self.io, &group_id_buffer),
            .did = stored.did,
            .handle = stored.handle,
            .scope = exchanged.scope,
            .sealed_credentials = sealed_credentials,
            .session_ttl_seconds = 14 * 24 * 60 * 60,
            .exchange_digest = bearer.digest(exchange_token),
            .sealed_session_token = sealed_session_token,
            .exchange_ttl_seconds = 60,
        }) catch return error.AuthStoreUnavailable;
        return exchange_token;
    }

    /// Authorization errors consume their state too. A cancelled/denied flow
    /// must not leave a still-replayable request behind until TTL cleanup.
    pub fn cancel(
        self: Service,
        allocator: std.mem.Allocator,
        state: []const u8,
        issuer: []const u8,
    ) !void {
        if (!isCanonicalState(state)) return error.InvalidOauthState;
        const sealed_request = (self.store.takeRequest(
            allocator,
            bearer.digest(state),
        ) catch return error.AuthStoreUnavailable) orelse return error.ExpiredOauthState;
        const plaintext = sealed_secret.open(
            allocator,
            self.settings.encryption_key,
            "plyr/auth/request/v1",
            sealed_request,
        ) catch return error.CorruptAuthState;
        const stored = oauth_state.decodeRequest(allocator, plaintext) catch
            return error.CorruptAuthState;
        if (!std.mem.eql(u8, issuer, stored.issuer)) return error.IssuerMismatch;
    }
};

pub fn isCanonicalState(value: []const u8) bool {
    const decoder = std.base64.url_safe_no_pad.Decoder;
    const decoded_length = decoder.calcSizeForSlice(value) catch return false;
    if (decoded_length != 16) return false;
    var decoded: [16]u8 = undefined;
    decoder.decode(&decoded, value) catch return false;
    var canonical: [22]u8 = undefined;
    const encoded = std.base64.url_safe_no_pad.Encoder.encode(&canonical, &decoded);
    return std.mem.eql(u8, encoded, value);
}

fn uuidV4(io: std.Io, output: *[36]u8) []const u8 {
    var bytes: [16]u8 = undefined;
    io.random(&bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = std.fmt.bytesToHex(bytes, .lower);
    @memcpy(output[0..8], hex[0..8]);
    output[8] = '-';
    @memcpy(output[9..13], hex[8..12]);
    output[13] = '-';
    @memcpy(output[14..18], hex[12..16]);
    output[18] = '-';
    @memcpy(output[19..23], hex[16..20]);
    output[23] = '-';
    @memcpy(output[24..36], hex[20..32]);
    return output;
}

test "OAuth state and session group identifiers are canonical" {
    try std.testing.expect(isCanonicalState("QkJCQkJCQkJCQkJCQkJCQg"));
    try std.testing.expect(!isCanonicalState("bad"));
    var uuid: [36]u8 = undefined;
    const value = uuidV4(std.Options.debug_io, &uuid);
    try std.testing.expectEqual(@as(u8, '4'), value[14]);
    try std.testing.expect(std.mem.indexOfScalar(u8, "89ab", value[19]) != null);
}

const FakeStore = struct {
    request_digest: ?bearer.Digest = null,
    sealed_request: ?[]const u8 = null,
    issued: ?auth_store.SessionExchange = null,

    fn store(self: *FakeStore) auth_store.Store {
        return .{
            .context = self,
            .put_request_fn = putRequest,
            .take_request_fn = takeRequest,
            .create_session_exchange_fn = createSessionExchange,
            .consume_exchange_fn = consumeExchange,
            .get_session_fn = getSession,
            .revoke_session_fn = revokeSession,
            .get_credentials_fn = getCredentials,
            .claim_refresh_fn = claimRefresh,
            .publish_refresh_fn = publishRefresh,
            .abandon_refresh_fn = abandonRefresh,
        };
    }

    fn putRequest(context: *anyopaque, digest: bearer.Digest, payload: []const u8, _: i64) !void {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        self.request_digest = digest;
        self.sealed_request = payload;
    }

    fn takeRequest(context: *anyopaque, allocator: std.mem.Allocator, digest: bearer.Digest) !?[]const u8 {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (self.request_digest == null or
            !std.mem.eql(u8, &self.request_digest.?, &digest)) return null;
        const payload = self.sealed_request orelse return null;
        self.request_digest = null;
        self.sealed_request = null;
        return try allocator.dupe(u8, payload);
    }

    fn createSessionExchange(context: *anyopaque, value: auth_store.SessionExchange) !void {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        self.issued = value;
    }

    fn consumeExchange(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest) !?[]const u8 {
        return null;
    }

    fn getSession(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest) !?auth_store.Session {
        return null;
    }

    fn revokeSession(_: *anyopaque, _: bearer.Digest) !bool {
        return false;
    }

    fn getCredentials(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest) !?auth_store.CredentialSnapshot {
        return null;
    }

    fn claimRefresh(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest, _: i64, _: []const u8, _: i64) !?auth_store.CredentialSnapshot {
        return null;
    }

    fn publishRefresh(_: *anyopaque, _: auth_store.RefreshPublication) !bool {
        return false;
    }

    fn abandonRefresh(_: *anyopaque, _: bearer.Digest, _: []const u8, _: i64) !void {}
};

const FakeOAuth = struct {
    exchanges: usize = 0,

    fn client(self: *FakeOAuth) oauth_gateway.Client {
        return .{
            .context = self,
            .begin_fn = begin,
            .exchange_fn = exchange,
            .refresh_fn = refresh,
        };
    }

    fn begin(
        _: *anyopaque,
        _: std.mem.Allocator,
        _: config.AuthConfig,
        identifier: login_identifier.Identifier,
    ) !oauth_gateway.BeginResult {
        if (!std.mem.eql(u8, identifier.text(), "artist.example"))
            return error.UnexpectedIdentifier;
        return .{
            .state = "QkJCQkJCQkJCQkJCQkJCQg",
            .redirect_url = "https://auth.example/authorize?request_uri=urn%3Atest",
            .request = .{
                .did = "did:plc:artist",
                .handle = "artist.example",
                .pds_url = "https://pds.example",
                .issuer = "https://auth.example",
                .token_endpoint = "https://auth.example/token",
                .pkce_verifier = "pkce-secret",
                .dpop_secret = .{0x24} ** 32,
                .dpop_nonce = "par-nonce",
            },
        };
    }

    fn exchange(
        context: *anyopaque,
        _: std.mem.Allocator,
        _: config.AuthConfig,
        request: oauth_state.Request,
        code: []const u8,
    ) !oauth_gateway.ExchangeResult {
        const self: *FakeOAuth = @ptrCast(@alignCast(context));
        self.exchanges += 1;
        if (!std.mem.eql(u8, request.did, "did:plc:artist") or
            !std.mem.eql(u8, code, "authorization-code"))
            return error.UnexpectedExchange;
        return .{
            .scope = "atproto transition:generic",
            .credentials = .{
                .issuer = request.issuer,
                .token_endpoint = request.token_endpoint,
                .pds_url = request.pds_url,
                .access_token = "access-secret",
                .refresh_token = "refresh-secret",
                .scope = "atproto transition:generic",
                .dpop_secret = request.dpop_secret,
                .authserver_dpop_nonce = "token-nonce",
                .pds_dpop_nonce = null,
            },
        };
    }

    fn refresh(
        _: *anyopaque,
        _: std.mem.Allocator,
        _: config.AuthConfig,
        _: []const u8,
        _: oauth_state.Credentials,
    ) !oauth_gateway.RefreshResult {
        return error.UnexpectedRefresh;
    }
};

fn testSettings() !config.AuthConfig {
    return .{
        .client_id = "https://api.next.plyr.fm/oauth-client-metadata.json",
        .client_uri = "https://api.next.plyr.fm",
        .redirect_uri = "https://api.next.plyr.fm/auth/callback",
        .frontend_origin = "https://next.plyr.fm",
        .scope = "atproto transition:generic",
        .client_keypair = try @import("zat").Keypair.fromSecretKey(.p256, .{0x42} ** 32),
        .encryption_key = .{0x33} ** 32,
    };
}

test "browser login consumes state once and atomically issues encrypted capabilities" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var fake_store: FakeStore = .{};
    var fake_oauth: FakeOAuth = .{};
    const settings = try testSettings();
    const service: Service = .{
        .io = std.Options.debug_io,
        .settings = settings,
        .store = fake_store.store(),
        .oauth = fake_oauth.client(),
    };

    const identifier = try login_identifier.parse(allocator, "artist.example");
    const begun = try service.start(allocator, identifier);
    try std.testing.expectEqualStrings(
        "https://auth.example/authorize?request_uri=urn%3Atest",
        begun.redirect_url,
    );
    try std.testing.expectEqualStrings("QkJCQkJCQkJCQkJCQkJCQg", begun.state);
    try std.testing.expectEqual(
        bearer.digest("QkJCQkJCQkJCQkJCQkJCQg"),
        fake_store.request_digest.?,
    );
    try std.testing.expect(std.mem.indexOf(u8, fake_store.sealed_request.?, "pkce-secret") == null);

    try std.testing.expectError(error.IssuerMismatch, service.callback(allocator, .{
        .code = "authorization-code",
        .state = "QkJCQkJCQkJCQkJCQkJCQg",
        .issuer = "https://attacker.example",
    }));
    try std.testing.expectEqual(@as(usize, 0), fake_oauth.exchanges);
    try std.testing.expectError(error.ExpiredOauthState, service.callback(allocator, .{
        .code = "authorization-code",
        .state = "QkJCQkJCQkJCQkJCQkJCQg",
        .issuer = "https://auth.example",
    }));

    _ = try service.start(allocator, identifier);
    try service.cancel(
        allocator,
        "QkJCQkJCQkJCQkJCQkJCQg",
        "https://auth.example",
    );
    try std.testing.expectError(
        error.ExpiredOauthState,
        service.cancel(
            allocator,
            "QkJCQkJCQkJCQkJCQkJCQg",
            "https://auth.example",
        ),
    );

    _ = try service.start(allocator, identifier);
    const exchange_token = try service.callback(allocator, .{
        .code = "authorization-code",
        .state = "QkJCQkJCQkJCQkJCQkJCQg",
        .issuer = "https://auth.example",
    });
    try std.testing.expect(bearer.isCanonical(exchange_token));
    try std.testing.expectEqual(@as(usize, 1), fake_oauth.exchanges);
    const issued = fake_store.issued.?;
    try std.testing.expectEqual(bearer.digest(exchange_token), issued.exchange_digest);
    try std.testing.expectEqual(@as(i64, 60), issued.exchange_ttl_seconds);
    try std.testing.expectEqual(@as(i64, 14 * 24 * 60 * 60), issued.session_ttl_seconds);
    const credentials_json = try sealed_secret.open(
        allocator,
        settings.encryption_key,
        "plyr/auth/session/v1",
        issued.sealed_credentials,
    );
    const credentials = try oauth_state.decodeCredentials(allocator, credentials_json);
    try std.testing.expectEqualStrings("refresh-secret", credentials.refresh_token);
    try std.testing.expectEqualStrings("token-nonce", credentials.authserver_dpop_nonce.?);
    try std.testing.expect(credentials.pds_dpop_nonce == null);
    const session_token = try sealed_secret.open(
        allocator,
        settings.encryption_key,
        "plyr/auth/exchange/v1",
        issued.sealed_session_token,
    );
    try std.testing.expect(bearer.isCanonical(session_token));
    try std.testing.expectEqual(bearer.digest(session_token), issued.session_digest);
}
