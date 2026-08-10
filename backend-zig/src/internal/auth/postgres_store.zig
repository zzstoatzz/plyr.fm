//! PostgreSQL persistence for non-rebuildable browser authentication state.
//!
//! All externally presented bearer values are reduced to SHA-256 lookup keys
//! before this adapter is called. Secret payloads are already authenticated
//! ciphertext. Atomic DELETE ... RETURNING implements one-time consumption.

const std = @import("std");
const pg = @import("pg");
const bearer = @import("bearer_token.zig");

pub const Session = struct {
    did: []const u8,
    handle: []const u8,
    scope: []const u8,
    sealed_credentials: []const u8,

    pub fn deinit(self: *Session, allocator: std.mem.Allocator) void {
        allocator.free(self.did);
        allocator.free(self.handle);
        allocator.free(self.scope);
        allocator.free(self.sealed_credentials);
        self.* = undefined;
    }
};

pub const PostgresAuthStore = struct {
    pool: *pg.Pool,

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

    pub fn putSession(
        self: PostgresAuthStore,
        session_digest: bearer.Digest,
        group_id: []const u8,
        did: []const u8,
        handle: []const u8,
        scope: []const u8,
        sealed_credentials: []const u8,
        ttl_seconds: i64,
    ) !void {
        const affected = try self.pool.exec(
            \\INSERT INTO plyr_auth.sessions
            \\  (session_digest, group_id, did, handle, scope, sealed_credentials, expires_at)
            \\VALUES ($1::bytea, $2::uuid, $3, $4, $5, $6::bytea,
            \\        clock_timestamp() + $7::bigint * INTERVAL '1 second')
        , .{
            session_digest[0..], group_id,    did, handle, scope,
            sealed_credentials,  ttl_seconds,
        });
        if (affected != 1) return error.UnexpectedRowCount;
    }

    pub fn putExchange(
        self: PostgresAuthStore,
        token_digest: bearer.Digest,
        session_digest: bearer.Digest,
        sealed_session_token: []const u8,
        ttl_seconds: i64,
    ) !void {
        const affected = try self.pool.exec(
            \\INSERT INTO plyr_auth.exchange_tokens
            \\  (token_digest, session_digest, sealed_session_token, expires_at)
            \\VALUES ($1::bytea, $2::bytea, $3::bytea,
            \\        clock_timestamp() + $4::bigint * INTERVAL '1 second')
        , .{ token_digest[0..], session_digest[0..], sealed_session_token, ttl_seconds });
        if (affected != 1) return error.UnexpectedRowCount;
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
            \\SELECT did, handle, scope, sealed_credentials
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
            .sealed_credentials = try allocator.dupe(u8, try query_row.row.get([]const u8, 3)),
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
        \\  revoked_at timestamptz
        \\)
    , .{});
    _ = try database.pool.exec(
        \\CREATE TABLE plyr_auth.exchange_tokens (
        \\  token_digest bytea PRIMARY KEY,
        \\  session_digest bytea NOT NULL REFERENCES plyr_auth.sessions(session_digest),
        \\  sealed_session_token bytea NOT NULL, expires_at timestamptz NOT NULL
        \\)
    , .{});

    const store: PostgresAuthStore = .{ .pool = database.pool };
    const state = bearer.digest("state");
    try store.putRequest(state, "sealed request", 60);
    const request_payload = (try store.takeRequest(std.testing.allocator, state)).?;
    defer std.testing.allocator.free(request_payload);
    try std.testing.expectEqualStrings("sealed request", request_payload);
    try std.testing.expect((try store.takeRequest(std.testing.allocator, state)) == null);

    const session = bearer.digest("session");
    try store.putSession(
        session,
        "00000000-0000-4000-8000-000000000001",
        "did:plc:test",
        "test.example",
        "atproto",
        "sealed credentials",
        60,
    );
    const exchange = bearer.digest("exchange");
    try store.putExchange(exchange, session, "sealed session token", 60);
    const session_token = (try store.consumeExchange(std.testing.allocator, exchange)).?;
    defer std.testing.allocator.free(session_token);
    try std.testing.expectEqualStrings("sealed session token", session_token);
    try std.testing.expect((try store.consumeExchange(std.testing.allocator, exchange)) == null);

    var loaded = (try store.getSession(std.testing.allocator, session)).?;
    defer loaded.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("did:plc:test", loaded.did);
    try std.testing.expect(try store.revokeSession(session));
    try std.testing.expect((try store.getSession(std.testing.allocator, session)) == null);
}
