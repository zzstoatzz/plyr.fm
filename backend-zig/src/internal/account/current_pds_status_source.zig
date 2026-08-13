//! Destination-safe `getRepoStatus` client for the DID's current PDS.
//!
//! Resolution, all-address SSRF checks, pinned dialing, TLS/SNI identity, no
//! redirects, bounded bodies, and response-DID matching mirror repository
//! repair. Transport failures are errors and can never become account state.

const std = @import("std");
const zat = @import("zat");
const pinned_tls = @import("../ingest/pinned_tls.zig");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");
const repo_status = @import("repo_status.zig");

const max_response_bytes = 64 * 1024;

pub const Check = struct {
    pds_origin: []const u8,
    outcome: repo_status.Outcome,

    pub fn deinit(self: Check, allocator: std.mem.Allocator) void {
        if (self.outcome == .available) {
            if (self.outcome.available.repository_rev) |rev| allocator.free(rev);
        }
        allocator.free(self.pds_origin);
    }
};

pub const Source = struct {
    context: *anyopaque,
    check_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!Check,

    pub fn check(
        self: Source,
        allocator: std.mem.Allocator,
        repo_did: []const u8,
    ) Error!Check {
        if (zat.Did.parse(repo_did) == null) return error.InvalidIdentity;
        return self.check_fn(self.context, allocator, repo_did);
    }
};

pub const Error = error{
    InvalidIdentity,
    IdentityUnavailable,
    EndpointMissing,
    UnsafeEndpoint,
    UnsupportedEndpoint,
    StatusUnavailable,
    RateLimited,
    InvalidResponse,
    IdentityMismatch,
    OutOfMemory,
};

pub const ZatCurrentPdsStatusSource = struct {
    io: std.Io,
    identity_resolver: *zat.DidResolver,
    transport: *zat.HttpTransport,

    pub fn port(self: *ZatCurrentPdsStatusSource) Source {
        return .{ .context = self, .check_fn = checkOpaque };
    }

    fn checkOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        did_text: []const u8,
    ) Error!Check {
        const self: *ZatCurrentPdsStatusSource = @ptrCast(@alignCast(context));
        const did = zat.Did.parse(did_text) orelse return error.InvalidIdentity;
        var document = self.identity_resolver.resolve(did) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.IdentityUnavailable,
        };
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text)) return error.IdentityUnavailable;
        const pds_url = document.pdsEndpoint() orelse return error.EndpointMissing;
        var endpoint = safe_endpoint.resolve(self.io, allocator, pds_url) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.UnsafeEndpoint => return error.UnsafeEndpoint,
            error.NoSupportedAddress => return error.UnsupportedEndpoint,
            error.InvalidEndpoint, error.DnsResolutionFailed => return error.StatusUnavailable,
        };
        defer endpoint.deinit(allocator);
        const encoded_did = encodeQueryValue(allocator, did_text) catch
            return error.OutOfMemory;
        defer allocator.free(encoded_did);
        const url = std.fmt.allocPrint(
            allocator,
            "{s}/xrpc/com.atproto.sync.getRepoStatus?did={s}",
            .{ endpoint.base_url, encoded_did },
        ) catch return error.OutOfMemory;
        defer allocator.free(url);
        pinned_tls.prepare(self.io, self.transport) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.StatusUnavailable,
        };
        const result = self.transport.fetch(.{
            .url = url,
            .accept = "application/json",
            .max_response_size = max_response_bytes,
            .redirect_behavior = .not_allowed,
            .resolved_connection = endpoint.connection(),
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.StatusUnavailable,
        };
        defer self.transport.allocator.free(result.body);
        switch (result.status) {
            .ok => {},
            .too_many_requests => return error.RateLimited,
            else => return error.StatusUnavailable,
        }

        var parse_arena = std.heap.ArenaAllocator.init(allocator);
        defer parse_arena.deinit();
        var outcome = repo_status.parse(parse_arena.allocator(), did_text, result.body) catch |err| switch (err) {
            error.IdentityMismatch => return error.IdentityMismatch,
            error.OutOfMemory => return error.OutOfMemory,
            error.InvalidResponse => return error.InvalidResponse,
        };
        if (outcome == .available) {
            if (outcome.available.repository_rev) |rev| {
                outcome.available.repository_rev = allocator.dupe(u8, rev) catch
                    return error.OutOfMemory;
            }
        }
        errdefer if (outcome == .available) {
            if (outcome.available.repository_rev) |rev| allocator.free(rev);
        };
        return .{
            .pds_origin = allocator.dupe(u8, endpoint.base_url) catch
                return error.OutOfMemory,
            .outcome = outcome,
        };
    }
};

fn encodeQueryValue(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var encoded: std.ArrayList(u8) = .empty;
    errdefer encoded.deinit(allocator);
    const hex = "0123456789ABCDEF";
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '.' or
            byte == '_' or byte == '~' or byte == ':')
        {
            try encoded.append(allocator, byte);
        } else {
            try encoded.appendSlice(allocator, &.{ '%', hex[byte >> 4], hex[byte & 0x0f] });
        }
    }
    return encoded.toOwnedSlice(allocator);
}

test "status query preserves DID text through percent decoding" {
    const allocator = std.testing.allocator;
    const encoded = try encodeQueryValue(allocator, "did:web:example.com:user%3Aone");
    defer allocator.free(encoded);
    try std.testing.expectEqualStrings("did:web:example.com:user%253Aone", encoded);
}

test "current-PDS status source exposes a validated port" {
    var source: ZatCurrentPdsStatusSource = undefined;
    const port = source.port();
    try std.testing.expect(port.context == @as(*anyopaque, @ptrCast(&source)));
}
