//! Authenticated PDS commands with encrypted credentials and one refresh retry.
//!
//! A remaining 401 after Zat's DPoP-nonce retry spends the observed refresh
//! generation exactly once. Concurrent instances either perform that refresh
//! or wait for its fenced publication, then replay the command with the new
//! access token. Successful PDS nonce evolution is persisted best-effort; it
//! is an efficiency hint and must never turn an accepted mutation into a
//! client-visible failure that invites a duplicate retry.

const std = @import("std");
const config = @import("../../config.zig");
const bearer = @import("../auth/bearer_token.zig");
const oauth_gateway = @import("../auth/oauth_gateway.zig");
const oauth_state = @import("../auth/oauth_state.zig");
const pds_gateway = @import("../auth/pds_gateway.zig");
const sealed_secret = @import("../auth/sealed_secret.zig");
const auth_store = @import("../auth/store.zig");
const credential_refresh = @import("credential_refresh.zig");

const refresh_poll_attempts = 75;
const refresh_poll_ms = 200;

pub const Service = struct {
    io: std.Io,
    settings: config.AuthConfig,
    store: auth_store.Store,
    oauth: oauth_gateway.Client,
    pds: pds_gateway.Client,

    pub fn execute(
        self: Service,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
        method: std.http.Method,
        procedure: []const u8,
        payload: ?[]const u8,
    ) !pds_gateway.Response {
        var loaded = try self.load(allocator, session_digest);
        defer loaded.snapshot.deinit(allocator);
        var first = self.pds.request(
            allocator,
            loaded.credentials,
            method,
            procedure,
            payload,
        ) catch return error.PdsUnavailable;
        self.persistNonce(
            allocator,
            session_digest,
            loaded.snapshot.generation,
            loaded.credentials,
            first.pds_nonce,
        );
        if (first.status != .unauthorized) return first;
        first.deinit(allocator);

        try self.refreshOrWait(allocator, session_digest, loaded.snapshot.generation);
        var rotated = try self.load(allocator, session_digest);
        defer rotated.snapshot.deinit(allocator);
        const retried = self.pds.request(
            allocator,
            rotated.credentials,
            method,
            procedure,
            payload,
        ) catch return error.PdsUnavailable;
        self.persistNonce(
            allocator,
            session_digest,
            rotated.snapshot.generation,
            rotated.credentials,
            retried.pds_nonce,
        );
        return retried;
    }

    const Loaded = struct {
        snapshot: auth_store.CredentialSnapshot,
        credentials: oauth_state.Credentials,
    };

    fn load(
        self: Service,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
    ) !Loaded {
        var snapshot = (self.store.getCredentials(allocator, session_digest) catch
            return error.AuthStoreUnavailable) orelse return error.SessionUnavailable;
        errdefer snapshot.deinit(allocator);
        const plaintext = sealed_secret.open(
            allocator,
            self.settings.encryption_key,
            "plyr/auth/session/v1",
            snapshot.sealed_credentials,
        ) catch return error.CorruptCredentials;
        return .{
            .snapshot = snapshot,
            .credentials = oauth_state.decodeCredentials(allocator, plaintext) catch
                return error.CorruptCredentials,
        };
    }

    fn refreshOrWait(
        self: Service,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
        observed_generation: i64,
    ) !void {
        const refresh: credential_refresh.Service = .{
            .io = self.io,
            .settings = self.settings,
            .store = self.store,
            .oauth = self.oauth,
        };
        for (0..refresh_poll_attempts) |_| {
            switch (refresh.refresh(allocator, session_digest, observed_generation) catch |err|
                return err) {
                .refreshed, .superseded => return,
                .busy => try self.io.sleep(
                    std.Io.Duration.fromMilliseconds(refresh_poll_ms),
                    .awake,
                ),
            }
        }
        return error.RefreshTimedOut;
    }

    fn persistNonce(
        self: Service,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
        generation: i64,
        credentials: oauth_state.Credentials,
        nonce: ?[]const u8,
    ) void {
        const value = nonce orelse return;
        if (credentials.pds_dpop_nonce) |current|
            if (std.mem.eql(u8, current, value)) return;
        var updated = credentials;
        updated.pds_dpop_nonce = value;
        const encoded = oauth_state.encodeCredentials(allocator, updated) catch |err| {
            std.log.err("PDS nonce credential encoding failed: {}", .{err});
            return;
        };
        const sealed = sealed_secret.seal(
            allocator,
            self.io,
            self.settings.encryption_key,
            "plyr/auth/session/v1",
            encoded,
        ) catch |err| {
            std.log.err("PDS nonce credential sealing failed: {}", .{err});
            return;
        };
        _ = self.store.updateCredentials(
            session_digest,
            generation,
            sealed,
        ) catch |err| {
            std.log.warn("PDS nonce persistence unavailable: {}", .{err});
            return;
        };
    }
};

const FakeStore = struct {
    sealed: []const u8,
    generation: i64 = 1,
    leased: bool = false,
    nonce_updates: usize = 0,

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
            .update_credentials_fn = updateCredentials,
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
        if (self.generation == generation) self.leased = false;
    }

    fn updateCredentials(context: *anyopaque, _: bearer.Digest, generation: i64, sealed: []const u8) !bool {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (self.generation != generation) return false;
        self.sealed = sealed;
        self.nonce_updates += 1;
        return true;
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

    fn refresh(context: *anyopaque, _: std.mem.Allocator, _: config.AuthConfig, _: []const u8, credentials: oauth_state.Credentials) !oauth_gateway.RefreshResult {
        const self: *FakeOAuth = @ptrCast(@alignCast(context));
        self.calls += 1;
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

const FakePds = struct {
    calls: usize = 0,

    fn client(self: *FakePds) pds_gateway.Client {
        return .{ .context = self, .request_fn = request };
    }

    fn request(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        credentials: oauth_state.Credentials,
        method: std.http.Method,
        procedure: []const u8,
        payload: ?[]const u8,
    ) !pds_gateway.Response {
        const self: *FakePds = @ptrCast(@alignCast(context));
        self.calls += 1;
        if (method != .POST or
            !std.mem.eql(u8, procedure, "com.atproto.repo.createRecord") or
            !std.mem.eql(u8, payload orelse "", "{\"record\":{}}"))
            return error.UnexpectedCommand;
        if (self.calls == 1) {
            try std.testing.expectEqualStrings("access-one", credentials.access_token);
            return .{
                .status = .unauthorized,
                .body = try allocator.dupe(u8, "{\"error\":\"ExpiredToken\"}"),
                .pds_nonce = try allocator.dupe(u8, "pds-nonce-one"),
            };
        }
        try std.testing.expectEqualStrings("access-two", credentials.access_token);
        try std.testing.expectEqualStrings("pds-nonce-one", credentials.pds_dpop_nonce.?);
        return .{
            .status = .ok,
            .body = try allocator.dupe(u8, "{\"uri\":\"at://did:plc:artist/fm.plyr.like/tid\"}"),
            .pds_nonce = try allocator.dupe(u8, "pds-nonce-two"),
        };
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

test "authenticated PDS command persists nonces and retries once with rotated tokens" {
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
        .pds_dpop_nonce = null,
    });
    const initial_sealed = try sealed_secret.seal(
        allocator,
        std.Options.debug_io,
        settings.encryption_key,
        "plyr/auth/session/v1",
        initial_json,
    );
    var store: FakeStore = .{ .sealed = initial_sealed };
    var oauth: FakeOAuth = .{};
    var pds: FakePds = .{};
    const service: Service = .{
        .io = std.Options.debug_io,
        .settings = settings,
        .store = store.store(),
        .oauth = oauth.client(),
        .pds = pds.client(),
    };
    var result = try service.execute(
        allocator,
        bearer.digest("browser-session"),
        .POST,
        "com.atproto.repo.createRecord",
        "{\"record\":{}}",
    );
    defer result.deinit(allocator);
    try std.testing.expectEqual(std.http.Status.ok, result.status);
    try std.testing.expectEqual(@as(usize, 2), pds.calls);
    try std.testing.expectEqual(@as(usize, 1), oauth.calls);
    try std.testing.expectEqual(@as(i64, 2), store.generation);
    try std.testing.expectEqual(@as(usize, 2), store.nonce_updates);

    const final_plaintext = try sealed_secret.open(
        allocator,
        settings.encryption_key,
        "plyr/auth/session/v1",
        store.sealed,
    );
    const final = try oauth_state.decodeCredentials(allocator, final_plaintext);
    try std.testing.expectEqualStrings("refresh-two", final.refresh_token);
    try std.testing.expectEqualStrings("pds-nonce-two", final.pds_dpop_nonce.?);
}
