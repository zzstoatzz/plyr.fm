//! Network adapters for the managed-space checks: DID signing keys through
//! Zat's resolver, and supporter status through atprotofans.

const std = @import("std");
const zat = @import("zat");
const managed_space = @import("managed_space.zig");
const attested = @import("attested.zig");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");
const pinned_tls = @import("../ingest/pinned_tls.zig");

/// listRecords pages read per payment collection
const max_pages = 5;

const user_agent = "plyr.fm-zig-api/0.1 (+https://plyr.fm)";

pub const Network = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    resolver: zat.DidResolver,
    transport: zat.HttpTransport,
    deadline_ns: ?i96 = null,

    pub fn init(io: std.Io, allocator: std.mem.Allocator, plc_url: []const u8) Network {
        var resolver = zat.DidResolver.init(io, allocator);
        resolver.transport.user_agent = user_agent;
        resolver.plc_url = plc_url;
        return .{
            .io = io,
            .allocator = allocator,
            .resolver = resolver,
            .transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent),
        };
    }

    pub fn deinit(self: *Network) void {
        self.transport.deinit();
        self.resolver.deinit();
    }

    pub fn checkDeadline(self: *Network) !void {
        try self.io.checkCancel();
        if (self.deadline_ns) |deadline| {
            if (std.Io.Clock.awake.now(self.io).nanoseconds >= deadline) return error.AuthorizationUnavailable;
        }
    }

    fn requestBudget(self: *Network) !u64 {
        try self.checkDeadline();
        if (self.deadline_ns) |deadline| {
            const remaining = deadline - std.Io.Clock.awake.now(self.io).nanoseconds;
            if (remaining <= 0) return error.AuthorizationUnavailable;
            return @intCast(@min(remaining, 5 * std.time.ns_per_s));
        }
        return 5 * std.time.ns_per_s;
    }

    pub fn keys(self: *Network) managed_space.KeyLookup {
        return .{ .context = self, .lookup_fn = lookupKey };
    }

    pub fn supporters(self: *Network) managed_space.SupporterCheck {
        return .{ .context = self, .check_fn = checkSupporter };
    }

    fn lookupKey(context: *anyopaque, allocator: std.mem.Allocator, did_text: []const u8) anyerror![]const u8 {
        const self: *Network = @ptrCast(@alignCast(context));
        try self.checkDeadline();
        const did = zat.Did.parse(did_text) orelse return error.InvalidIdentity;
        var document = try self.resolver.resolve(did);
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text)) return error.InvalidIdentity;
        const method = document.signingKey() orelse return error.InvalidSigningKey;
        if (!std.mem.eql(u8, method.controller, did_text) or
            !std.mem.startsWith(u8, method.id, did_text) or
            !std.mem.eql(u8, method.id[did_text.len..], "#atproto"))
            return error.InvalidSigningKey;
        return allocator.dupe(u8, method.public_key_multibase);
    }

    /// attested.network first, then atprotofans (same order as the python
    /// backend). An attested failure falls through to atprotofans.
    fn checkSupporter(context: *anyopaque, allocator: std.mem.Allocator, supporter: []const u8, artist: []const u8) anyerror!bool {
        const self: *Network = @ptrCast(@alignCast(context));
        // DIDs are restricted to [A-Za-z0-9._:%-], all query-safe.
        if (zat.Did.parse(supporter) == null or zat.Did.parse(artist) == null) return error.InvalidIdentity;
        try self.checkDeadline();
        var incomplete = false;
        if (self.attestedSupport(allocator, supporter, artist)) |yes| {
            if (yes) return true;
        } else |err| {
            if (err == error.Canceled) return err;
            incomplete = self.deadline_ns != null;
            std.log.info("attested.network check failed: {s}", .{@errorName(err)});
        }
        try self.checkDeadline();
        return completeDecision(incomplete, try self.atprotofansSupport(allocator, supporter, artist));
    }

    fn attestedSupport(self: *Network, allocator: std.mem.Allocator, supporter: []const u8, artist: []const u8) !bool {
        const pds = try self.pdsOf(allocator, supporter);
        for (attested.payment_collections) |collection| {
            var page_cursor: ?[]const u8 = null;
            var page: usize = 0;
            while (page < max_pages) : (page += 1) {
                const path = if (page_cursor) |c|
                    try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100&cursor={f}", .{ supporter, collection, std.fmt.alt(std.Uri.Component{ .raw = c }, .formatQuery) })
                else
                    try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100", .{ supporter, collection });
                const body = (try self.getJson(allocator, pds, path)) orelse break;
                const parsed = try std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{});
                if (self.deadline_ns != null) {
                    const records = if (parsed == .object) parsed.object.get("records") else null;
                    if (records == null or records.? != .array) return error.InvalidSupporterResponse;
                }
                for (try attested.proofRefs(allocator, parsed, supporter, artist, &attested.default_trusted_brokers)) |proof| {
                    if (try self.proofVerified(allocator, proof)) return true;
                }
                page_cursor = attested.cursor(parsed) orelse break;
            }
            if (page == max_pages and page_cursor != null and self.deadline_ns != null) return error.SupporterCheckIncomplete;
        }
        return false;
    }

    fn proofVerified(self: *Network, allocator: std.mem.Allocator, proof: attested.ProofRef) !bool {
        if (zat.Rkey.parse(proof.rkey) == null) return false;
        const pds = try self.pdsOf(allocator, proof.broker);
        const path = try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.getRecord?repo={s}&collection={s}&rkey={s}", .{ proof.broker, attested.proof_collection, proof.rkey });
        const body = (try self.getJson(allocator, pds, path)) orelse return false;
        const parsed = try std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{});
        return attested.proofVerifies(allocator, parsed, proof);
    }

    fn pdsOf(self: *Network, allocator: std.mem.Allocator, did_text: []const u8) ![]const u8 {
        try self.checkDeadline();
        const did = zat.Did.parse(did_text) orelse return error.InvalidIdentity;
        var document = try self.resolver.resolve(did);
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text)) return error.InvalidIdentity;
        return allocator.dupe(u8, document.pdsEndpoint() orelse return error.EndpointMissing);
    }

    /// GET from a DID-declared PDS, address-pinned past SSRF checks. Null on
    /// a non-200 answer.
    fn getJson(self: *Network, allocator: std.mem.Allocator, pds: []const u8, path: []const u8) !?[]const u8 {
        try self.checkDeadline();
        var endpoint = try safe_endpoint.resolve(self.io, allocator, pds);
        defer endpoint.deinit(allocator);
        const url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ endpoint.base_url, path });
        try pinned_tls.prepare(self.io, &self.transport);
        var result = try self.transport.fetch(.{
            .url = url,
            .accept = "application/json",
            .max_response_size = 1024 * 1024,
            .on_redirect = .refuse,
            .resolved_connection = endpoint.connection(),
            .deadline_ns = try self.requestBudget(),
        });
        defer result.deinit(self.transport.allocator);
        if (result.status != .ok) {
            if (self.deadline_ns != null and result.status != .not_found) return error.SupporterCheckRejected;
            return null;
        }
        return try allocator.dupe(u8, result.body);
    }

    /// Direct atprotofans support: the artist is both subject and signer.
    fn atprotofansSupport(self: *Network, allocator: std.mem.Allocator, supporter: []const u8, artist: []const u8) !bool {
        const url = try std.fmt.allocPrint(
            allocator,
            "https://atprotofans.com/xrpc/com.atprotofans.validateSupporter?supporter={s}&subject={s}&signer={s}",
            .{ supporter, artist, artist },
        );
        var result = try self.transport.fetch(.{
            .url = url,
            .accept = "application/json",
            .max_response_size = 64 * 1024,
            .on_redirect = .refuse,
            .deadline_ns = try self.requestBudget(),
        });
        defer result.deinit(self.transport.allocator);
        if (result.status != .ok) return error.SupporterCheckRejected;
        return validFromBody(allocator, result.body, self.deadline_ns != null);
    }
};

fn validFromBody(allocator: std.mem.Allocator, body: []const u8, required: bool) !bool {
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSupporterResponse;
    const valid = parsed.value.object.get("valid") orelse return if (required) error.InvalidSupporterResponse else false;
    if (valid != .bool) return if (required) error.InvalidSupporterResponse else false;
    return valid.bool;
}

test "atprotofans answers are read strictly" {
    try std.testing.expect(try validFromBody(std.testing.allocator, "{\"valid\":true,\"profile\":{}}", false));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{\"valid\":false}", false));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{\"valid\":\"true\"}", false));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{}", false));
    try std.testing.expectError(error.InvalidSupporterResponse, validFromBody(std.testing.allocator, "[]", false));
}

test "expired supporter budget rejects before identity or atprotofans fallback" {
    var network = Network.init(std.testing.io, std.testing.allocator, "http://127.0.0.1:1");
    defer network.deinit();
    network.deadline_ns = std.Io.Clock.awake.now(std.testing.io).nanoseconds - 1;
    try std.testing.expectError(error.AuthorizationUnavailable, network.supporters().check(std.testing.allocator, "did:plc:viewer", "did:plc:artist"));
    try std.testing.expectError(error.AuthorizationUnavailable, network.requestBudget());
}

fn completeDecision(incomplete: bool, verified: bool) !bool {
    if (!verified and incomplete) return error.SupporterCheckIncomplete;
    return verified;
}

test "incomplete supporter source cannot become a definitive negative" {
    try std.testing.expectError(error.SupporterCheckIncomplete, completeDecision(true, false));
    try std.testing.expect(try completeDecision(true, true));
    try std.testing.expect(!try completeDecision(false, false));
    try std.testing.expect(try completeDecision(false, true));
}

test "budgeted supporter query requires an explicit boolean decision" {
    try std.testing.expectError(error.InvalidSupporterResponse, validFromBody(std.testing.allocator, "{}", true));
    try std.testing.expectError(error.InvalidSupporterResponse, validFromBody(std.testing.allocator, "{\"valid\":\"false\"}", true));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{\"valid\":false}", true));
}
