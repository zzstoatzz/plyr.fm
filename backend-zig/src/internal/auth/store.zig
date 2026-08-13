//! Persistence port for non-rebuildable browser authentication state.
//!
//! Application and HTTP code depend on these semantics, never PostgreSQL
//! tables. Adapters are responsible for atomic one-time consumption and
//! atomic publication of a session plus its exchange capability.

const std = @import("std");
const bearer = @import("bearer_token.zig");

pub const Session = struct {
    did: []const u8,
    handle: []const u8,
    scope: []const u8,

    pub fn deinit(self: *Session, allocator: std.mem.Allocator) void {
        allocator.free(self.did);
        allocator.free(self.handle);
        allocator.free(self.scope);
        self.* = undefined;
    }
};

pub const CredentialSnapshot = struct {
    did: []const u8,
    sealed_credentials: []const u8,
    generation: i64,

    pub fn deinit(self: *CredentialSnapshot, allocator: std.mem.Allocator) void {
        allocator.free(self.did);
        allocator.free(self.sealed_credentials);
        self.* = undefined;
    }
};

pub const RefreshPublication = struct {
    session_digest: bearer.Digest,
    owner: []const u8,
    generation: i64,
    sealed_credentials: []const u8,
    scope: []const u8,
};

pub const SessionExchange = struct {
    session_digest: bearer.Digest,
    group_id: []const u8,
    did: []const u8,
    handle: []const u8,
    scope: []const u8,
    sealed_credentials: []const u8,
    session_ttl_seconds: i64,
    exchange_digest: bearer.Digest,
    sealed_session_token: []const u8,
    exchange_ttl_seconds: i64,
};

pub const Store = struct {
    context: *anyopaque,
    put_request_fn: *const fn (*anyopaque, bearer.Digest, []const u8, i64) anyerror!void,
    take_request_fn: *const fn (*anyopaque, std.mem.Allocator, bearer.Digest) anyerror!?[]const u8,
    create_session_exchange_fn: *const fn (*anyopaque, SessionExchange) anyerror!void,
    consume_exchange_fn: *const fn (*anyopaque, std.mem.Allocator, bearer.Digest) anyerror!?[]const u8,
    get_session_fn: *const fn (*anyopaque, std.mem.Allocator, bearer.Digest) anyerror!?Session,
    revoke_session_fn: *const fn (*anyopaque, bearer.Digest) anyerror!bool,
    get_credentials_fn: *const fn (*anyopaque, std.mem.Allocator, bearer.Digest) anyerror!?CredentialSnapshot,
    claim_refresh_fn: *const fn (*anyopaque, std.mem.Allocator, bearer.Digest, i64, []const u8, i64) anyerror!?CredentialSnapshot,
    publish_refresh_fn: *const fn (*anyopaque, RefreshPublication) anyerror!bool,
    abandon_refresh_fn: *const fn (*anyopaque, bearer.Digest, []const u8, i64) anyerror!void,
    update_credentials_fn: *const fn (*anyopaque, bearer.Digest, i64, []const u8) anyerror!bool,

    pub fn putRequest(self: Store, digest: bearer.Digest, payload: []const u8, ttl: i64) !void {
        return self.put_request_fn(self.context, digest, payload, ttl);
    }

    pub fn takeRequest(self: Store, allocator: std.mem.Allocator, digest: bearer.Digest) !?[]const u8 {
        return self.take_request_fn(self.context, allocator, digest);
    }

    pub fn createSessionExchange(self: Store, value: SessionExchange) !void {
        return self.create_session_exchange_fn(self.context, value);
    }

    pub fn consumeExchange(self: Store, allocator: std.mem.Allocator, digest: bearer.Digest) !?[]const u8 {
        return self.consume_exchange_fn(self.context, allocator, digest);
    }

    pub fn getSession(self: Store, allocator: std.mem.Allocator, digest: bearer.Digest) !?Session {
        return self.get_session_fn(self.context, allocator, digest);
    }

    pub fn revokeSession(self: Store, digest: bearer.Digest) !bool {
        return self.revoke_session_fn(self.context, digest);
    }

    pub fn getCredentials(self: Store, allocator: std.mem.Allocator, digest: bearer.Digest) !?CredentialSnapshot {
        return self.get_credentials_fn(self.context, allocator, digest);
    }

    pub fn claimRefresh(
        self: Store,
        allocator: std.mem.Allocator,
        digest: bearer.Digest,
        generation: i64,
        owner: []const u8,
        lease_seconds: i64,
    ) !?CredentialSnapshot {
        return self.claim_refresh_fn(
            self.context,
            allocator,
            digest,
            generation,
            owner,
            lease_seconds,
        );
    }

    pub fn publishRefresh(self: Store, value: RefreshPublication) !bool {
        return self.publish_refresh_fn(self.context, value);
    }

    pub fn abandonRefresh(
        self: Store,
        digest: bearer.Digest,
        owner: []const u8,
        generation: i64,
    ) !void {
        return self.abandon_refresh_fn(self.context, digest, owner, generation);
    }

    /// Persist destination nonce evolution without overwriting a token
    /// generation concurrently rotated by another instance.
    pub fn updateCredentials(
        self: Store,
        digest: bearer.Digest,
        generation: i64,
        sealed_credentials: []const u8,
    ) !bool {
        return self.update_credentials_fn(
            self.context,
            digest,
            generation,
            sealed_credentials,
        );
    }
};
