//! PostgreSQL persistence for non-rebuildable browser authentication state.
//!
//! All externally presented bearer values are reduced to SHA-256 lookup keys
//! before this adapter is called. Secret payloads are already authenticated
//! ciphertext. Atomic DELETE ... RETURNING implements one-time consumption.

const std = @import("std");
const pg = @import("pg");
const bearer = @import("bearer_token.zig");
const auth_store = @import("store.zig");
const Session = auth_store.Session;

pub const PostgresAuthStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresAuthStore) auth_store.Store {
        return .{
            .context = self,
            .put_request_fn = putRequestOpaque,
            .take_request_fn = takeRequestOpaque,
            .create_session_exchange_fn = createSessionExchangeOpaque,
            .consume_exchange_fn = consumeExchangeOpaque,
            .get_session_fn = getSessionOpaque,
            .revoke_session_fn = revokeSessionOpaque,
            .get_credentials_fn = getCredentialsOpaque,
            .claim_refresh_fn = claimRefreshOpaque,
            .publish_refresh_fn = publishRefreshOpaque,
            .abandon_refresh_fn = abandonRefreshOpaque,
            .update_credentials_fn = updateCredentialsOpaque,
        };
    }

    fn putRequestOpaque(context: *anyopaque, digest: bearer.Digest, payload: []const u8, ttl: i64) !void {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.putRequest(digest, payload, ttl);
    }

    fn takeRequestOpaque(context: *anyopaque, allocator: std.mem.Allocator, digest: bearer.Digest) !?[]const u8 {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.takeRequest(allocator, digest);
    }

    fn createSessionExchangeOpaque(context: *anyopaque, value: auth_store.SessionExchange) !void {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.createSessionExchange(value);
    }

    fn consumeExchangeOpaque(context: *anyopaque, allocator: std.mem.Allocator, digest: bearer.Digest) !?[]const u8 {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.consumeExchange(allocator, digest);
    }

    fn getSessionOpaque(context: *anyopaque, allocator: std.mem.Allocator, digest: bearer.Digest) !?Session {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.getSession(allocator, digest);
    }

    fn revokeSessionOpaque(context: *anyopaque, digest: bearer.Digest) !bool {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.revokeSession(digest);
    }

    fn getCredentialsOpaque(context: *anyopaque, allocator: std.mem.Allocator, digest: bearer.Digest) !?auth_store.CredentialSnapshot {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.getCredentials(allocator, digest);
    }

    fn claimRefreshOpaque(context: *anyopaque, allocator: std.mem.Allocator, digest: bearer.Digest, generation: i64, owner: []const u8, lease_seconds: i64) !?auth_store.CredentialSnapshot {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.claimRefresh(allocator, digest, generation, owner, lease_seconds);
    }

    fn publishRefreshOpaque(context: *anyopaque, value: auth_store.RefreshPublication) !bool {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.publishRefresh(value);
    }

    fn abandonRefreshOpaque(context: *anyopaque, digest: bearer.Digest, owner: []const u8, generation: i64) !void {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.abandonRefresh(digest, owner, generation);
    }

    fn updateCredentialsOpaque(context: *anyopaque, digest: bearer.Digest, generation: i64, sealed_credentials: []const u8) !bool {
        const self: *PostgresAuthStore = @ptrCast(@alignCast(context));
        return self.updateCredentials(digest, generation, sealed_credentials);
    }

    pub fn putRequest(
        self: PostgresAuthStore,
        state_digest: bearer.Digest,
        sealed_payload: []const u8,
        ttl_seconds: i64,
    ) !void {
        const affected = try self.pool.exec(
            \\INSERT INTO plyr_auth.oauth_requests
            \\  (state_digest, sealed_payload, expires_at)
            \\VALUES ($1::bytea, $2::bytea, clock_timestamp() + $3::bigint * INTERVAL '1 second')
        , .{ state_digest[0..], sealed_payload, ttl_seconds });
        if (affected != 1) return error.UnexpectedRowCount;
    }

    pub fn takeRequest(
        self: PostgresAuthStore,
        allocator: std.mem.Allocator,
        state_digest: bearer.Digest,
    ) !?[]const u8 {
        var query_row = try self.pool.row(
            \\DELETE FROM plyr_auth.oauth_requests
            \\WHERE state_digest = $1::bytea AND expires_at > clock_timestamp()
            \\RETURNING sealed_payload
        , .{state_digest[0..]}) orelse return null;
        defer query_row.deinit() catch query_row.result.deinit();
        return try allocator.dupe(u8, try query_row.row.get([]const u8, 0));
    }

    /// A callback either publishes both bearer capabilities or neither. This
    /// avoids stranding a valid session when exchange-token insertion fails.
    pub fn createSessionExchange(
        self: PostgresAuthStore,
        value: auth_store.SessionExchange,
    ) !void {
        var conn = try self.pool.acquire();
        defer self.pool.release(conn);
        try conn.begin();
        var transaction_open = true;
        defer if (transaction_open) conn.rollback() catch |err| {
            std.log.err("auth issuance rollback failed: {}", .{err});
        };
        const session_rows = try conn.exec(
            \\INSERT INTO plyr_auth.sessions
            \\  (session_digest, group_id, did, handle, scope, sealed_credentials, expires_at)
            \\VALUES ($1::bytea, $2::uuid, $3, $4, $5, $6::bytea,
            \\        clock_timestamp() + $7::bigint * INTERVAL '1 second')
        , .{
            value.session_digest[0..], value.group_id, value.did,
            value.handle,              value.scope,    value.sealed_credentials,
            value.session_ttl_seconds,
        });
        if (session_rows != 1) return error.UnexpectedRowCount;
        const exchange_rows = try conn.exec(
            \\INSERT INTO plyr_auth.exchange_tokens
            \\  (token_digest, session_digest, sealed_session_token, expires_at)
            \\VALUES ($1::bytea, $2::bytea, $3::bytea,
            \\        clock_timestamp() + $4::bigint * INTERVAL '1 second')
        , .{
            value.exchange_digest[0..], value.session_digest[0..],
            value.sealed_session_token, value.exchange_ttl_seconds,
        });
        if (exchange_rows != 1) return error.UnexpectedRowCount;
        try conn.commit();
        transaction_open = false;
    }

    pub fn consumeExchange(
        self: PostgresAuthStore,
        allocator: std.mem.Allocator,
        token_digest: bearer.Digest,
    ) !?[]const u8 {
        var query_row = try self.pool.row(
            \\DELETE FROM plyr_auth.exchange_tokens AS exchange
            \\USING plyr_auth.sessions AS session
            \\WHERE exchange.token_digest = $1::bytea
            \\  AND exchange.session_digest = session.session_digest
            \\  AND exchange.expires_at > clock_timestamp()
            \\  AND session.expires_at > clock_timestamp()
            \\  AND session.revoked_at IS NULL
            \\RETURNING exchange.sealed_session_token
        , .{token_digest[0..]}) orelse return null;
        defer query_row.deinit() catch query_row.result.deinit();
        return try allocator.dupe(u8, try query_row.row.get([]const u8, 0));
    }

    pub fn getSession(
        self: PostgresAuthStore,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
    ) !?Session {
        var query_row = try self.pool.row(
            \\SELECT did, handle, scope
            \\FROM plyr_auth.sessions
            \\WHERE session_digest = $1::bytea
            \\  AND expires_at > clock_timestamp()
            \\  AND revoked_at IS NULL
        , .{session_digest[0..]}) orelse return null;
        defer query_row.deinit() catch query_row.result.deinit();
        return .{
            .did = try allocator.dupe(u8, try query_row.row.get([]const u8, 0)),
            .handle = try allocator.dupe(u8, try query_row.row.get([]const u8, 1)),
            .scope = try allocator.dupe(u8, try query_row.row.get([]const u8, 2)),
        };
    }

    pub fn revokeSession(self: PostgresAuthStore, session_digest: bearer.Digest) !bool {
        const affected = try self.pool.exec(
            \\UPDATE plyr_auth.sessions
            \\SET revoked_at = clock_timestamp()
            \\WHERE session_digest = $1::bytea AND revoked_at IS NULL
        , .{session_digest[0..]});
        return affected == 1;
    }

    pub fn getCredentials(
        self: PostgresAuthStore,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
    ) !?auth_store.CredentialSnapshot {
        var query_row = try self.pool.row(
            \\SELECT did, sealed_credentials, credentials_generation
            \\FROM plyr_auth.sessions
            \\WHERE session_digest = $1::bytea
            \\  AND expires_at > clock_timestamp()
            \\  AND revoked_at IS NULL
        , .{session_digest[0..]}) orelse return null;
        defer query_row.deinit() catch query_row.result.deinit();
        return .{
            .did = try allocator.dupe(u8, try query_row.row.get([]const u8, 0)),
            .sealed_credentials = try allocator.dupe(u8, try query_row.row.get([]const u8, 1)),
            .generation = try query_row.row.get(i64, 2),
        };
    }

    /// Claim refresh only for the credential generation the caller observed.
    /// A crashed owner is recoverable after the bounded lease expires.
    pub fn claimRefresh(
        self: PostgresAuthStore,
        allocator: std.mem.Allocator,
        session_digest: bearer.Digest,
        generation: i64,
        owner: []const u8,
        lease_seconds: i64,
    ) !?auth_store.CredentialSnapshot {
        var query_row = try self.pool.row(
            \\UPDATE plyr_auth.sessions
            \\SET refresh_owner = $3::uuid,
            \\    refresh_lease_until = clock_timestamp() + $4::bigint * INTERVAL '1 second'
            \\WHERE session_digest = $1::bytea
            \\  AND credentials_generation = $2::bigint
            \\  AND expires_at > clock_timestamp()
            \\  AND revoked_at IS NULL
            \\  AND (refresh_lease_until IS NULL OR refresh_lease_until <= clock_timestamp())
            \\RETURNING did, sealed_credentials, credentials_generation
        , .{ session_digest[0..], generation, owner, lease_seconds }) orelse return null;
        defer query_row.deinit() catch query_row.result.deinit();
        return .{
            .did = try allocator.dupe(u8, try query_row.row.get([]const u8, 0)),
            .sealed_credentials = try allocator.dupe(u8, try query_row.row.get([]const u8, 1)),
            .generation = try query_row.row.get(i64, 2),
        };
    }

    /// Rotated refresh tokens and their access token are one fenced update.
    pub fn publishRefresh(self: PostgresAuthStore, value: auth_store.RefreshPublication) !bool {
        const affected = try self.pool.exec(
            \\UPDATE plyr_auth.sessions
            \\SET sealed_credentials = $4::bytea,
            \\    scope = $5,
            \\    credentials_generation = credentials_generation + 1,
            \\    refresh_owner = NULL,
            \\    refresh_lease_until = NULL
            \\WHERE session_digest = $1::bytea
            \\  AND credentials_generation = $3::bigint
            \\  AND refresh_owner = $2::uuid
            \\  AND expires_at > clock_timestamp()
            \\  AND revoked_at IS NULL
        , .{
            value.session_digest[0..], value.owner, value.generation,
            value.sealed_credentials,  value.scope,
        });
        return affected == 1;
    }

    pub fn abandonRefresh(
        self: PostgresAuthStore,
        session_digest: bearer.Digest,
        owner: []const u8,
        generation: i64,
    ) !void {
        _ = try self.pool.exec(
            \\UPDATE plyr_auth.sessions
            \\SET refresh_owner = NULL, refresh_lease_until = NULL
            \\WHERE session_digest = $1::bytea
            \\  AND refresh_owner = $2::uuid
            \\  AND credentials_generation = $3::bigint
        , .{ session_digest[0..], owner, generation });
    }

    pub fn updateCredentials(
        self: PostgresAuthStore,
        session_digest: bearer.Digest,
        generation: i64,
        sealed_credentials: []const u8,
    ) !bool {
        const affected = try self.pool.exec(
            \\UPDATE plyr_auth.sessions
            \\SET sealed_credentials = $3::bytea
            \\WHERE session_digest = $1::bytea
            \\  AND credentials_generation = $2::bigint
            \\  AND expires_at > clock_timestamp()
            \\  AND revoked_at IS NULL
        , .{ session_digest[0..], generation, sealed_credentials });
        return affected == 1;
    }
};

test "Postgres auth store consumes exchange tokens once and revokes sessions" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const io = std.Options.debug_io;
    const postgres_lock = @import("../testing/postgres_lock.zig");
    postgres_lock.lock(io);
    defer postgres_lock.unlock(io);

    var database = try @import("../index/postgres_track_store.zig").PostgresTrackStore.init(
        std.testing.allocator,
        io,
        std.mem.span(url_z),
        2,
    );
    defer database.deinit();
    var database_row = (try database.pool.row("SELECT current_database()", .{})).?;
    const database_name = try std.testing.allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer std.testing.allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try database.pool.exec("DROP SCHEMA IF EXISTS plyr_auth CASCADE", .{});
    _ = try database.pool.exec("CREATE SCHEMA plyr_auth", .{});
    defer _ = database.pool.exec("DROP SCHEMA IF EXISTS plyr_auth CASCADE", .{}) catch null;
    _ = try database.pool.exec(
        \\CREATE TABLE plyr_auth.oauth_requests (
        \\  state_digest bytea PRIMARY KEY, sealed_payload bytea NOT NULL,
        \\  expires_at timestamptz NOT NULL
        \\)
    , .{});
    _ = try database.pool.exec(
        \\CREATE TABLE plyr_auth.sessions (
        \\  session_digest bytea PRIMARY KEY, group_id uuid NOT NULL,
        \\  did text NOT NULL, handle text NOT NULL, scope text NOT NULL,
        \\  sealed_credentials bytea NOT NULL, expires_at timestamptz NOT NULL,
        \\  revoked_at timestamptz,
        \\  credentials_generation bigint NOT NULL DEFAULT 1,
        \\  refresh_owner uuid, refresh_lease_until timestamptz,
        \\  CHECK ((refresh_owner IS NULL) = (refresh_lease_until IS NULL))
        \\)
    , .{});
    _ = try database.pool.exec(
        \\CREATE TABLE plyr_auth.exchange_tokens (
        \\  token_digest bytea PRIMARY KEY,
        \\  session_digest bytea NOT NULL REFERENCES plyr_auth.sessions(session_digest),
        \\  sealed_session_token bytea NOT NULL, expires_at timestamptz NOT NULL
        \\)
    , .{});

    var postgres: PostgresAuthStore = .{ .pool = database.pool };
    const store = postgres.store();
    const state = bearer.digest("state");
    try store.putRequest(state, "sealed request", 60);
    const request_payload = (try store.takeRequest(std.testing.allocator, state)).?;
    defer std.testing.allocator.free(request_payload);
    try std.testing.expectEqualStrings("sealed request", request_payload);
    try std.testing.expect((try store.takeRequest(std.testing.allocator, state)) == null);

    const session = bearer.digest("session");
    const exchange = bearer.digest("exchange");
    try store.createSessionExchange(.{
        .session_digest = session,
        .group_id = "00000000-0000-4000-8000-000000000001",
        .did = "did:plc:test",
        .handle = "test.example",
        .scope = "atproto",
        .sealed_credentials = "sealed credentials",
        .session_ttl_seconds = 60,
        .exchange_digest = exchange,
        .sealed_session_token = "sealed session token",
        .exchange_ttl_seconds = 60,
    });
    const rolled_back_session = bearer.digest("rolled-back-session");
    if (store.createSessionExchange(.{
        .session_digest = rolled_back_session,
        .group_id = "00000000-0000-4000-8000-000000000002",
        .did = "did:plc:other",
        .handle = "other.example",
        .scope = "atproto",
        .sealed_credentials = "must roll back",
        .session_ttl_seconds = 60,
        .exchange_digest = exchange,
        .sealed_session_token = "duplicate exchange",
        .exchange_ttl_seconds = 60,
    })) |_| {
        return error.ExpectedUniqueViolation;
    } else |_| {}
    try std.testing.expect(
        (try store.getSession(std.testing.allocator, rolled_back_session)) == null,
    );
    const session_token = (try store.consumeExchange(std.testing.allocator, exchange)).?;
    defer std.testing.allocator.free(session_token);
    try std.testing.expectEqualStrings("sealed session token", session_token);
    try std.testing.expect((try store.consumeExchange(std.testing.allocator, exchange)) == null);

    var loaded = (try store.getSession(std.testing.allocator, session)).?;
    defer loaded.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("did:plc:test", loaded.did);

    var credentials = (try store.getCredentials(std.testing.allocator, session)).?;
    defer credentials.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(i64, 1), credentials.generation);
    const owner = "00000000-0000-4000-8000-000000000003";
    var claimed = (try store.claimRefresh(
        std.testing.allocator,
        session,
        credentials.generation,
        owner,
        60,
    )).?;
    defer claimed.deinit(std.testing.allocator);
    try std.testing.expect((try store.claimRefresh(
        std.testing.allocator,
        session,
        credentials.generation,
        "00000000-0000-4000-8000-000000000004",
        60,
    )) == null);
    try std.testing.expect(try store.publishRefresh(.{
        .session_digest = session,
        .owner = owner,
        .generation = claimed.generation,
        .sealed_credentials = "rotated credentials",
        .scope = "atproto transition:generic",
    }));
    try std.testing.expect(!try store.publishRefresh(.{
        .session_digest = session,
        .owner = owner,
        .generation = claimed.generation,
        .sealed_credentials = "stale credentials",
        .scope = "atproto",
    }));
    var rotated = (try store.getCredentials(std.testing.allocator, session)).?;
    defer rotated.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(i64, 2), rotated.generation);
    try std.testing.expectEqualStrings("rotated credentials", rotated.sealed_credentials);
    try std.testing.expect(try store.updateCredentials(
        session,
        rotated.generation,
        "nonce-updated credentials",
    ));
    try std.testing.expect(!try store.updateCredentials(
        session,
        1,
        "stale credentials",
    ));
    try std.testing.expect(try store.revokeSession(session));
    try std.testing.expect((try store.getSession(std.testing.allocator, session)) == null);
}
