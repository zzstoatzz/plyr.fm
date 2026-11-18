//! Destination-safe direct PDS `getRepo` source.
//!
//! The DID document selects the PDS origin. `safe_endpoint` checks every DNS
//! answer and pins the checked dial address while Zat retains the logical host
//! for TLS/SNI. Redirects remain disabled.

const std = @import("std");
const zat = @import("zat");
const repository_source = @import("repository_source.zig");
const safe_endpoint = @import("../net/safe_endpoint.zig");
const pinned_tls = @import("../net/pinned_tls.zig");
const snapshot_verifier = @import("../projection/snapshot_verifier.zig");
const collection_repository = @import("collection_repository.zig");

pub const ZatPdsRepositorySource = struct {
    io: std.Io,
    identity_resolver: *zat.DidResolver,
    transport: *zat.HttpTransport,
    /// plyr's collections; when set, a repository too large to fetch whole is
    /// read as per-record proofs of just these collections instead.
    collections: []const []const u8 = &.{},

    pub fn port(self: *ZatPdsRepositorySource) repository_source.Source {
        return .{ .context = self, .fetch_fn = fetchOpaque };
    }

    fn fetchOpaque(
        context: *anyopaque,
        request_allocator: std.mem.Allocator,
        did_text: []const u8,
    ) repository_source.Error!repository_source.Repo {
        const self: *ZatPdsRepositorySource = @ptrCast(@alignCast(context));
        var endpoint = try self.resolveEndpoint(request_allocator, did_text);
        defer endpoint.deinit(request_allocator);

        const url = std.fmt.allocPrint(
            request_allocator,
            "{s}/xrpc/com.atproto.sync.getRepo?did={s}",
            .{ endpoint.base_url, did_text },
        ) catch return error.OutOfMemory;
        defer request_allocator.free(url);
        pinned_tls.prepare(self.io, self.transport) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryUnavailable,
        };
        const result = self.transport.fetch(.{
            .url = url,
            .accept = "application/vnd.ipld.car",
            .max_response_size = snapshot_verifier.max_repo_bytes,
            .on_redirect = .refuse,
            .resolved_connection = endpoint.connection(),
        }) catch |err| switch (err) {
            error.ResponseTooLarge => return self.fetchProofs(request_allocator, &endpoint, did_text),
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

    /// The DID document's PDS, DNS-checked and pinned. Caller deinits.
    fn resolveEndpoint(
        self: *ZatPdsRepositorySource,
        allocator: std.mem.Allocator,
        did_text: []const u8,
    ) repository_source.Error!safe_endpoint.Endpoint {
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
        const endpoint = safe_endpoint.resolve(
            self.io,
            allocator,
            pds_url,
        ) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.UnsafeEndpoint => return error.UnsafeRepositoryEndpoint,
            error.NoSupportedAddress => return error.UnsupportedRepositoryEndpoint,
            error.InvalidEndpoint, error.DnsResolutionFailed => return error.RepositoryUnavailable,
        };
        return endpoint;
    }

    /// One record's `sync.getRecord` proof from the repo's own PDS, owned by
    /// `allocator`; null when the PDS answers 404/400 instead of a proof.
    pub fn fetchRecordProof(
        self: *ZatPdsRepositorySource,
        allocator: std.mem.Allocator,
        did: []const u8,
        collection: []const u8,
        rkey: []const u8,
    ) repository_source.Error!?[]const u8 {
        var endpoint = try self.resolveEndpoint(allocator, did);
        defer endpoint.deinit(allocator);
        const url = std.fmt.allocPrint(
            allocator,
            "{s}/xrpc/com.atproto.sync.getRecord?did={s}&collection={s}&rkey={s}",
            .{ endpoint.base_url, did, collection, rkey },
        ) catch return error.OutOfMemory;
        return self.get(allocator, &endpoint, url, "application/vnd.ipld.car", 4 * 1024 * 1024);
    }

    pub fn fetchCollections(self: *ZatPdsRepositorySource, allocator: std.mem.Allocator, did: []const u8) repository_source.Error!repository_source.Repo {
        var endpoint = try self.resolveEndpoint(allocator, did);
        defer endpoint.deinit(allocator);
        return self.fetchProofs(allocator, &endpoint, did);
    }

    fn fetchProofs(
        self: *ZatPdsRepositorySource,
        allocator: std.mem.Allocator,
        endpoint: *safe_endpoint.Endpoint,
        did: []const u8,
    ) repository_source.Error!repository_source.Repo {
        if (self.collections.len == 0) return error.RepositoryTooLarge;
        const url = try std.fmt.allocPrint(allocator, "{s}/xrpc/com.atproto.sync.getLatestCommit?did={s}", .{ endpoint.base_url, did });
        const body = (try self.get(allocator, endpoint, url, "application/json", 4096)) orelse return error.RepositoryUnavailable;
        const parsed = std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{}) catch return error.RepositoryUnavailable;
        if (parsed != .object) return error.RepositoryUnavailable;
        const cid_value = parsed.object.get("cid") orelse return error.RepositoryUnavailable;
        if (cid_value != .string) return error.RepositoryUnavailable;
        const root = zat.Cid.fromString(allocator, cid_value.string) catch return error.RepositoryUnavailable;
        var blocks: BlockFetch = .{ .source = self, .endpoint = endpoint, .did = did };
        const proof = collection_repository.fetch(allocator, root, self.collections, .{ .context = &blocks, .fetch_fn = BlockFetch.fetch }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.RepositoryTooLarge => return error.RepositoryTooLarge,
            error.RepositoryRateLimited => return error.RepositoryRateLimited,
            else => return error.RepositoryUnavailable,
        };
        const proofs = try allocator.alloc([]const u8, 1);
        proofs[0] = proof.bytes;
        std.log.info("collection proof for {s}: {d} requests, {d} bytes", .{ did, proof.requests, proof.received_bytes });
        return .{ .bytes = proof.bytes, .proofs = proofs, .release_context = self, .release_fn = releaseNothing };
    }

    const BlockFetch = struct {
        source: *ZatPdsRepositorySource,
        endpoint: *safe_endpoint.Endpoint,
        did: []const u8,

        fn fetch(context: *anyopaque, allocator: std.mem.Allocator, cids: []const zat.Cid) ![]const u8 {
            const self: *BlockFetch = @ptrCast(@alignCast(context));
            var url: std.Io.Writer.Allocating = .init(allocator);
            try url.writer.print("{s}/xrpc/com.atproto.sync.getBlocks?did={s}", .{ self.endpoint.base_url, self.did });
            for (cids) |cid| try url.writer.print("&cids={s}", .{try cid.toString(allocator)});
            return (try self.source.get(allocator, self.endpoint, url.written(), "application/vnd.ipld.car", collection_repository.max_bytes)) orelse error.RepositoryUnavailable;
        }
    };

    /// GET through the pinned endpoint; null on 404, the body (owned by
    /// `allocator`) on 200.
    fn get(
        self: *ZatPdsRepositorySource,
        allocator: std.mem.Allocator,
        endpoint: *safe_endpoint.Endpoint,
        url: []const u8,
        accept: []const u8,
        max_bytes: usize,
    ) repository_source.Error!?[]const u8 {
        pinned_tls.prepare(self.io, self.transport) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryUnavailable,
        };
        const result = self.transport.fetch(.{
            .url = url,
            .accept = accept,
            .max_response_size = max_bytes,
            .on_redirect = .refuse,
            .resolved_connection = endpoint.connection(),
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryUnavailable,
        };
        defer self.transport.allocator.free(result.body);
        switch (result.status) {
            .ok => return allocator.dupe(u8, result.body) catch error.OutOfMemory,
            .not_found, .bad_request => return null,
            .too_many_requests => return error.RepositoryRateLimited,
            else => return error.RepositoryUnavailable,
        }
    }

    fn releaseNothing(_: *anyopaque, _: []const u8) void {}

    fn releaseOpaque(context: *anyopaque, bytes: []const u8) void {
        const self: *ZatPdsRepositorySource = @ptrCast(@alignCast(context));
        self.transport.allocator.free(bytes);
    }
};

test "direct PDS source exposes the bounded repository port" {
    var source: ZatPdsRepositorySource = undefined;
    const port = source.port();
    try std.testing.expect(port.context == @as(*anyopaque, @ptrCast(&source)));
}
