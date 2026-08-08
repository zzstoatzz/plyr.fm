//! Destination-safe direct PDS `getRepo` source.
//!
//! The DID document selects the PDS origin. `safe_endpoint` checks every DNS
//! answer and pins the checked dial address while Zat retains the logical host
//! for TLS/SNI. Redirects remain disabled.

const std = @import("std");
const zat = @import("zat");
const repository_source = @import("repository_source.zig");
const safe_endpoint = @import("safe_endpoint.zig");
const snapshot_verifier = @import("../projection/snapshot_verifier.zig");

pub const ZatPdsRepositorySource = struct {
    io: std.Io,
    identity_resolver: *zat.DidResolver,
    transport: *zat.HttpTransport,

    pub fn port(self: *ZatPdsRepositorySource) repository_source.Source {
        return .{ .context = self, .fetch_fn = fetchOpaque };
    }

    fn fetchOpaque(
        context: *anyopaque,
        request_allocator: std.mem.Allocator,
        did_text: []const u8,
    ) repository_source.Error!repository_source.Repo {
        const self: *ZatPdsRepositorySource = @ptrCast(@alignCast(context));
        const did = zat.Did.parse(did_text) orelse return error.InvalidIdentity;
        var document = self.identity_resolver.resolve(did) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryIdentityUnavailable,
        };
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text))
            return error.RepositoryIdentityUnavailable;
        const pds_url = document.pdsEndpoint() orelse
            return error.RepositoryEndpointMissing;
        var endpoint = safe_endpoint.resolve(
            self.io,
            request_allocator,
            pds_url,
        ) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.UnsafeEndpoint => return error.UnsafeRepositoryEndpoint,
            error.NoSupportedAddress => return error.UnsupportedRepositoryEndpoint,
            error.InvalidEndpoint, error.DnsResolutionFailed => return error.RepositoryUnavailable,
        };
        defer endpoint.deinit(request_allocator);

        const url = std.fmt.allocPrint(
            request_allocator,
            "{s}/xrpc/com.atproto.sync.getRepo?did={s}",
            .{ endpoint.base_url, did_text },
        ) catch return error.OutOfMemory;
        defer request_allocator.free(url);
        self.preparePinnedTls() catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryUnavailable,
        };
        const result = self.transport.fetch(.{
            .url = url,
            .accept = "application/vnd.ipld.car",
            .max_response_size = snapshot_verifier.max_repo_bytes,
            .redirect_behavior = .not_allowed,
            .resolved_connection = endpoint.connection(),
        }) catch |err| switch (err) {
            error.ResponseTooLarge => return error.RepositoryTooLarge,
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryUnavailable,
        };
        switch (result.status) {
            .ok => {},
            .not_found => {
                self.transport.allocator.free(result.body);
                return error.RepositoryNotFound;
            },
            .too_many_requests => {
                self.transport.allocator.free(result.body);
                return error.RepositoryRateLimited;
            },
            else => {
                self.transport.allocator.free(result.body);
                return error.RepositoryUnavailable;
            },
        }
        return .{
            .bytes = result.body,
            .release_context = self,
            .release_fn = releaseOpaque,
        };
    }

    fn releaseOpaque(context: *anyopaque, bytes: []const u8) void {
        const self: *ZatPdsRepositorySource = @ptrCast(@alignCast(context));
        self.transport.allocator.free(bytes);
    }

    /// Zat's pinned-address branch connects before `Client.request`, while
    /// std.http normally initializes its CA bundle and clock inside request.
    /// Prepare that shared state explicitly before the lower-level TLS dial.
    fn preparePinnedTls(self: *ZatPdsRepositorySource) !void {
        const client = &self.transport.http_client;
        try client.ca_bundle_lock.lockShared(self.io);
        const initialized = client.now != null;
        client.ca_bundle_lock.unlockShared(self.io);
        if (initialized) return;

        var bundle: std.crypto.Certificate.Bundle = .empty;
        defer bundle.deinit(client.allocator);
        const now = std.Io.Clock.real.now(self.io);
        try bundle.rescan(client.allocator, self.io, now);
        try client.ca_bundle_lock.lock(self.io);
        defer client.ca_bundle_lock.unlock(self.io);
        if (client.now == null) {
            client.now = now;
            std.mem.swap(std.crypto.Certificate.Bundle, &client.ca_bundle, &bundle);
        }
    }
};

test "direct PDS source exposes the bounded repository port" {
    var source: ZatPdsRepositorySource = undefined;
    const port = source.port();
    try std.testing.expect(port.context == @as(*anyopaque, @ptrCast(&source)));
}
