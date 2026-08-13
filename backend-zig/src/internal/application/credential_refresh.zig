//! Cluster-safe OAuth credential rotation.
//!
//! Refresh tokens rotate on use. A refresh is therefore a write, not a cache
//! fill: only one instance may spend a session's current token generation.
//! PostgreSQL owns the short recoverable lease and generation fence; this
//! service owns encryption and the destination-safe OAuth exchange.

const std = @import("std");
const config = @import("../../config.zig");
const bearer = @import("../auth/bearer_token.zig");
const oauth_gateway = @import("../auth/oauth_gateway.zig");
const oauth_state = @import("../auth/oauth_state.zig");
const sealed_secret = @import("../auth/sealed_secret.zig");
const auth_store = @import("../auth/store.zig");

// One token-endpoint round trip normally takes 1-3 seconds. Match the proven
// Python boundary: enough headroom for a slow auth server without making a
// crashed owner strand authenticated writes for minutes.
const lease_seconds: i64 = 15;

pub const Outcome = union(enum) {
    refreshed: i64,
    superseded: i64,
    busy,
};

pub const Service = struct {
    io: std.Io,
    settings: config.AuthConfig,
    store: auth_store.Store,
    oauth: oauth_gateway.Client,

    /// Rotate only the generation rejected by the PDS. The caller must reload
    /// credentials after every outcome; secret material never leaves this
    /// application boundary.
    pub fn refresh(
        self: Service,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
        observed_generation: i64,
    ) !Outcome {
        var owner_buffer: [36]u8 = undefined;
        const owner = refreshOwner(self.io, &owner_buffer);
        var claimed = (self.store.claimRefresh(
            allocator,
            session_digest,
            observed_generation,
            owner,
            lease_seconds,
        ) catch return error.AuthStoreUnavailable) orelse {
            var current = (self.store.getCredentials(allocator, session_digest) catch
                return error.AuthStoreUnavailable) orelse return error.SessionUnavailable;
            defer current.deinit(allocator);
            if (current.generation != observed_generation)
                return .{ .superseded = current.generation };
            return .busy;
        };
        defer claimed.deinit(allocator);

        var release_lease = true;
        defer if (release_lease) self.store.abandonRefresh(
            session_digest,
            owner,
            claimed.generation,
        ) catch |err| std.log.err("OAuth refresh lease release failed: {}", .{err});

        const plaintext = sealed_secret.open(
            allocator,
            self.settings.encryption_key,
            "plyr/auth/session/v1",
            claimed.sealed_credentials,
        ) catch return error.CorruptCredentials;
        const credentials = oauth_state.decodeCredentials(allocator, plaintext) catch
            return error.CorruptCredentials;
        const rotated = self.oauth.refresh(
            allocator,
            self.settings,
            claimed.did,
            credentials,
        ) catch |err| {
            std.log.warn("OAuth credential refresh failed: {}", .{err});
            return error.TokenRefreshFailed;
        };
        const encoded = oauth_state.encodeCredentials(allocator, rotated.credentials) catch
            return error.CredentialEncodingFailed;
        const sealed = sealed_secret.seal(
            allocator,
            self.io,
            self.settings.encryption_key,
            "plyr/auth/session/v1",
            encoded,
        ) catch return error.CredentialEncodingFailed;
        const published = self.store.publishRefresh(.{
            .session_digest = session_digest,
            .owner = owner,
            .generation = claimed.generation,
            .sealed_credentials = sealed,
            .scope = rotated.credentials.scope,
        }) catch return error.AuthStoreUnavailable;
        if (!published) return error.RefreshLeaseLost;
        release_lease = false;
        return .{ .refreshed = claimed.generation + 1 };
    }
};

fn refreshOwner(io: std.Io, output: *[36]u8) []const u8 {
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

test "refresh owner is a canonical UUID v4" {
    var buffer: [36]u8 = undefined;
    const owner = refreshOwner(std.Options.debug_io, &buffer);
    try std.testing.expectEqual(@as(usize, 36), owner.len);
    try std.testing.expectEqual(@as(u8, '4'), owner[14]);
    try std.testing.expect(std.mem.indexOfScalar(u8, "89ab", owner[19]) != null);
}

const FakeStore = struct {
    sealed: []const u8,
    generation: i64 = 1,
    leased: bool = false,
    abandoned: usize = 0,

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

    fn snapshot(self: *FakeStore, allocator: std.mem.Allocator) !auth_store.CredentialSnapshot {
        return .{
            .did = try allocator.dupe(u8, "did:plc:artist"),
            .sealed_credentials = try allocator.dupe(u8, self.sealed),
            .generation = self.generation,
        };
    }

    fn getCredentials(context: *anyopaque, allocator: std.mem.Allocator, _: bearer.Digest) !?auth_store.CredentialSnapshot {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        return try self.snapshot(allocator);
    }

    fn claimRefresh(context: *anyopaque, allocator: std.mem.Allocator, _: bearer.Digest, generation: i64, _: []const u8, _: i64) !?auth_store.CredentialSnapshot {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (self.leased or self.generation != generation) return null;
        self.leased = true;
        return try self.snapshot(allocator);
    }

    fn publishRefresh(context: *anyopaque, value: auth_store.RefreshPublication) !bool {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (!self.leased or self.generation != value.generation) return false;
        self.sealed = value.sealed_credentials;
        self.generation += 1;
        self.leased = false;
        return true;
    }

    fn abandonRefresh(context: *anyopaque, _: bearer.Digest, _: []const u8, generation: i64) !void {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (self.generation == generation and self.leased) {
            self.leased = false;
            self.abandoned += 1;
        }
    }

    fn putRequest(_: *anyopaque, _: bearer.Digest, _: []const u8, _: i64) !void {}
    fn takeRequest(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest) !?[]const u8 {
        return null;
    }
    fn createSessionExchange(_: *anyopaque, _: auth_store.SessionExchange) !void {}
    fn consumeExchange(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest) !?[]const u8 {
        return null;
    }
    fn getSession(_: *anyopaque, _: std.mem.Allocator, _: bearer.Digest) !?auth_store.Session {
        return null;
    }
    fn revokeSession(_: *anyopaque, _: bearer.Digest) !bool {
        return false;
    }
};

const FakeOAuth = struct {
    calls: usize = 0,
    fail: bool = false,

    fn client(self: *FakeOAuth) oauth_gateway.Client {
        return .{
            .context = self,
            .begin_fn = begin,
            .exchange_fn = exchange,
            .refresh_fn = refresh,
        };
    }

    fn begin(_: *anyopaque, _: std.mem.Allocator, _: config.AuthConfig, _: @import("../auth/login_identifier.zig").Identifier) !oauth_gateway.BeginResult {
        return error.UnexpectedBegin;
    }

    fn exchange(_: *anyopaque, _: std.mem.Allocator, _: config.AuthConfig, _: oauth_state.Request, _: []const u8) !oauth_gateway.ExchangeResult {
        return error.UnexpectedExchange;
    }

    fn refresh(context: *anyopaque, _: std.mem.Allocator, _: config.AuthConfig, did: []const u8, credentials: oauth_state.Credentials) !oauth_gateway.RefreshResult {
        const self: *FakeOAuth = @ptrCast(@alignCast(context));
        self.calls += 1;
        if (self.fail) return error.InvalidGrant;
        if (!std.mem.eql(u8, did, "did:plc:artist") or
            !std.mem.eql(u8, credentials.refresh_token, "refresh-one"))
            return error.UnexpectedCredentials;
        return .{ .credentials = .{
            .issuer = credentials.issuer,
            .token_endpoint = credentials.token_endpoint,
            .pds_url = credentials.pds_url,
            .access_token = "access-two",
            .refresh_token = "refresh-two",
            .scope = credentials.scope,
            .dpop_secret = credentials.dpop_secret,
            .authserver_dpop_nonce = "auth-nonce-two",
            .pds_dpop_nonce = credentials.pds_dpop_nonce,
        } };
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

test "credential refresh is fenced, encrypted, and releases failed leases" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const settings = try testSettings();
    const initial_json = try oauth_state.encodeCredentials(allocator, .{
        .issuer = "https://auth.example",
        .token_endpoint = "https://auth.example/token",
        .pds_url = "https://pds.example",
        .access_token = "access-one",
        .refresh_token = "refresh-one",
        .scope = settings.scope,
        .dpop_secret = .{0x24} ** 32,
        .authserver_dpop_nonce = "auth-nonce-one",
        .pds_dpop_nonce = "pds-nonce-one",
    });
    const initial_sealed = try sealed_secret.seal(
        allocator,
        std.Options.debug_io,
        settings.encryption_key,
        "plyr/auth/session/v1",
        initial_json,
    );
    var fake_store: FakeStore = .{ .sealed = initial_sealed };
    var fake_oauth: FakeOAuth = .{};
    const service: Service = .{
        .io = std.Options.debug_io,
        .settings = settings,
        .store = fake_store.store(),
        .oauth = fake_oauth.client(),
    };
    const digest = bearer.digest("browser-session");

    const outcome = try service.refresh(allocator, digest, 1);
    try std.testing.expectEqual(@as(i64, 2), outcome.refreshed);
    try std.testing.expectEqual(@as(usize, 1), fake_oauth.calls);
    try std.testing.expect(std.mem.indexOf(u8, fake_store.sealed, "refresh-two") == null);
    const rotated_json = try sealed_secret.open(
        allocator,
        settings.encryption_key,
        "plyr/auth/session/v1",
        fake_store.sealed,
    );
    const rotated = try oauth_state.decodeCredentials(allocator, rotated_json);
    try std.testing.expectEqualStrings("refresh-two", rotated.refresh_token);
    try std.testing.expectEqualStrings("pds-nonce-one", rotated.pds_dpop_nonce.?);

    const stale = try service.refresh(allocator, digest, 1);
    try std.testing.expectEqual(@as(i64, 2), stale.superseded);
    try std.testing.expectEqual(@as(usize, 1), fake_oauth.calls);

    fake_store.leased = true;
    try std.testing.expect((try service.refresh(allocator, digest, 2)) == .busy);
    fake_store.leased = false;
    fake_oauth.fail = true;
    try std.testing.expectError(
        error.TokenRefreshFailed,
        service.refresh(allocator, digest, 2),
    );
    try std.testing.expect(!fake_store.leased);
    try std.testing.expectEqual(@as(usize, 1), fake_store.abandoned);
}
