//! Destination-safe direct PDS `getRepo` source.
//!
//! The DID document selects the PDS origin. `safe_endpoint` checks every DNS
//! answer and pins the checked dial address while Zat retains the logical host
//! for TLS/SNI. Redirects remain disabled.

const std = @import("std");
const zat = @import("zat");
const repository_source = @import("repository_source.zig");
const safe_endpoint = @import("safe_endpoint.zig");
const pinned_tls = @import("pinned_tls.zig");
const snapshot_verifier = @import("../projection/snapshot_verifier.zig");

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

    /// The listed plyr records of an oversized repository, each with its
    /// `sync.getRecord` proof. Every proof must come from one commit; if the
    /// repository moves while we read, start over (bounded).
    fn fetchProofs(
        self: *ZatPdsRepositorySource,
        allocator: std.mem.Allocator,
        endpoint: *safe_endpoint.Endpoint,
        did: []const u8,
    ) repository_source.Error!repository_source.Repo {
        if (self.collections.len == 0) return error.RepositoryTooLarge;
        var attempt: usize = 0;
        while (attempt < 3) : (attempt += 1) {
            var paths: std.ArrayList([]const u8) = .empty;
            for (self.collections) |collection| try self.listPaths(allocator, endpoint, did, collection, &paths);
            if (paths.items.len == 0 or paths.items.len > snapshot_verifier.max_proof_records)
                return error.RepositoryTooLarge;
            var proofs: std.ArrayList([]const u8) = .empty;
            var kept: std.ArrayList([]const u8) = .empty;
            var root: ?[]const u8 = null;
            const consistent = for (paths.items) |path| {
                const slash = std.mem.indexOfScalar(u8, path, '/').?;
                const url = std.fmt.allocPrint(
                    allocator,
                    "{s}/xrpc/com.atproto.sync.getRecord?did={s}&collection={s}&rkey={s}",
                    .{ endpoint.base_url, did, path[0..slash], path[slash + 1 ..] },
                ) catch return error.OutOfMemory;
                const body = (try self.get(allocator, endpoint, url, "application/vnd.ipld.car", 4 * 1024 * 1024)) orelse continue;
                const proof_root = carRoot(body) orelse return error.RepositoryUnavailable;
                if (root) |expected| {
                    if (!std.mem.eql(u8, expected, proof_root)) break false;
                } else root = proof_root;
                try proofs.append(allocator, body);
                try kept.append(allocator, path);
            } else true;
            if (!consistent) continue;
            if (proofs.items.len == 0) return error.RepositoryTooLarge;
            return .{
                .bytes = proofs.items[0],
                .proofs = try proofs.toOwnedSlice(allocator),
                .paths = try kept.toOwnedSlice(allocator),
                .release_context = self,
                .release_fn = releaseNothing,
            };
        }
        return error.RepositoryUnavailable;
    }

    fn listPaths(
        self: *ZatPdsRepositorySource,
        allocator: std.mem.Allocator,
        endpoint: *safe_endpoint.Endpoint,
        did: []const u8,
        collection: []const u8,
        paths: *std.ArrayList([]const u8),
    ) repository_source.Error!void {
        var cursor: ?[]const u8 = null;
        var page: usize = 0;
        while (page < 50) : (page += 1) {
            const url = (if (cursor) |c|
                std.fmt.allocPrint(allocator, "{s}/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100&cursor={f}", .{ endpoint.base_url, did, collection, std.fmt.alt(std.Uri.Component{ .raw = c }, .formatQuery) })
            else
                std.fmt.allocPrint(allocator, "{s}/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100", .{ endpoint.base_url, did, collection })) catch return error.OutOfMemory;
            const body = (try self.get(allocator, endpoint, url, "application/json", 4 * 1024 * 1024)) orelse return;
            cursor = try collectPaths(allocator, body, collection, paths);
            if (cursor == null) return;
            if (paths.items.len > snapshot_verifier.max_proof_records) return;
        }
    }

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

/// The root CID bytes of a CAR v1 (header `{roots:[cid], version:1}`), without
/// verifying anything; the verifier re-reads every proof.
fn carRoot(bytes: []const u8) ?[]const u8 {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const parsed = zat.car.readWithOptions(arena_state.allocator(), bytes, .{
        .max_size = bytes.len,
        .max_blocks = 1024,
    }) catch return null;
    if (parsed.roots.len != 1) return null;
    // the root CID bytes point into `bytes` or the arena; locate them in
    // `bytes` so the slice outlives the arena
    const raw = parsed.roots[0].raw;
    const at = std.mem.indexOf(u8, bytes, raw) orelse return null;
    return bytes[at .. at + raw.len];
}

/// Record paths from one listRecords page; returns the next cursor (borrowed
/// from `allocator`) or null.
fn collectPaths(
    allocator: std.mem.Allocator,
    body: []const u8,
    collection: []const u8,
    paths: *std.ArrayList([]const u8),
) repository_source.Error!?[]const u8 {
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{}) catch
        return error.RepositoryUnavailable;
    if (parsed != .object) return error.RepositoryUnavailable;
    const records = parsed.object.get("records") orelse return error.RepositoryUnavailable;
    if (records != .array) return error.RepositoryUnavailable;
    for (records.array.items) |record| {
        if (record != .object) continue;
        const uri = record.object.get("uri") orelse continue;
        if (uri != .string) continue;
        const at = zat.AtUri.parse(uri.string) orelse continue;
        const rkey = at.rkey() orelse continue;
        if (!std.mem.eql(u8, at.collection() orelse continue, collection) or zat.Rkey.parse(rkey) == null) continue;
        const path = std.fmt.allocPrint(allocator, "{s}/{s}", .{ collection, rkey }) catch return error.OutOfMemory;
        try paths.append(allocator, path);
    }
    const cursor = parsed.object.get("cursor") orelse return null;
    if (cursor != .string or cursor.string.len == 0 or records.array.items.len == 0) return null;
    return cursor.string;
}

test "listRecords pages become record paths in the asked collection" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var paths: std.ArrayList([]const u8) = .empty;
    const next = try collectPaths(arena.allocator(),
        \\{"cursor":"c1","records":[{"uri":"at://did:plc:a/fm.plyr.track/3k1","value":{}},{"uri":"at://did:plc:a/fm.plyr.like/3k2","value":{}},{"uri":"nope"}]}
    , "fm.plyr.track", &paths);
    try std.testing.expectEqualStrings("c1", next.?);
    try std.testing.expectEqual(@as(usize, 1), paths.items.len);
    try std.testing.expectEqualStrings("fm.plyr.track/3k1", paths.items[0]);
}

test "direct PDS source exposes the bounded repository port" {
    var source: ZatPdsRepositorySource = undefined;
    const port = source.port();
    try std.testing.expect(port.context == @as(*anyopaque, @ptrCast(&source)));
}
