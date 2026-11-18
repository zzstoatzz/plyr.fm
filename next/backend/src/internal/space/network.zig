//! Network adapters for the access core: DID signing keys through Zat's
//! resolver, a space authority's policy records from their PDS, and
//! broker-verified attested.network payments from the reader's PDS.

const std = @import("std");
const zat = @import("zat");
const managed_space = @import("managed_space.zig");
const access = @import("access.zig");
const policy = @import("policy.zig");
const attested = @import("attested.zig");
const safe_endpoint = @import("../net/safe_endpoint.zig");
const pinned_tls = @import("../net/pinned_tls.zig");

/// listRecords pages read per payment or policy collection
const max_pages = 5;

const user_agent = "plyr.fm-zig-api/0.1 (+https://plyr.fm)";

/// Which brokers' payment proofs count when a policy names none, read per
/// check from `SUPPORT_TRUSTED_BROKERS` (comma-separated DIDs; default
/// broker.atmosphere.money). A policy that names its own brokers uses those.
pub const SupportSources = struct {
    trusted_brokers: []const []const u8 = &attested.default_trusted_brokers,

    pub fn fromEnv(allocator: std.mem.Allocator) !SupportSources {
        return parse(allocator, getenv("SUPPORT_TRUSTED_BROKERS"));
    }

    pub fn parse(allocator: std.mem.Allocator, brokers: ?[]const u8) !SupportSources {
        var sources: SupportSources = .{};
        if (brokers) |list| {
            var dids: std.ArrayList([]const u8) = .empty;
            var parts = std.mem.splitScalar(u8, list, ',');
            while (parts.next()) |part| {
                const did = std.mem.trim(u8, part, " ");
                if (did.len == 0) continue;
                if (zat.Did.parse(did) == null) return error.InvalidSupportConfig;
                try dids.append(allocator, did);
            }
            if (dids.items.len == 0) return error.InvalidSupportConfig;
            sources.trusted_brokers = try dids.toOwnedSlice(allocator);
        }
        return sources;
    }
};

fn getenv(name: [*:0]const u8) ?[]const u8 {
    const value = std.c.getenv(name) orelse return null;
    return std.mem.span(value);
}

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

    pub fn evidence(self: *Network) policy.Evidence {
        return .{ .context = self, .payments_fn = loadPayments };
    }

    pub fn policies(self: *Network) access.PolicySource {
        return .{ .context = self, .list_fn = listPolicies };
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

    /// Broker-verified payments from `payer` to `recipient`, by the given
    /// brokers or else the deployment's trusted set.
    fn loadPayments(context: *anyopaque, allocator: std.mem.Allocator, payer: []const u8, recipient: []const u8, brokers: policy.Brokers) anyerror![]const policy.Payment {
        const self: *Network = @ptrCast(@alignCast(context));
        // DIDs are restricted to [A-Za-z0-9._:%-], all query-safe.
        if (zat.Did.parse(payer) == null or zat.Did.parse(recipient) == null) return error.InvalidIdentity;
        const trusted = brokers orelse (try SupportSources.fromEnv(allocator)).trusted_brokers;
        try self.checkDeadline();
        var verified: std.ArrayList(policy.Payment) = .empty;
        var seen: std.StringHashMapUnmanaged(void) = .empty;
        const pds = try self.pdsOf(allocator, payer);
        for (attested.payment_collections) |collection| {
            var page_cursor: ?[]const u8 = null;
            var page: usize = 0;
            while (page < max_pages) : (page += 1) {
                const path = if (page_cursor) |c|
                    try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100&cursor={f}", .{ payer, collection, std.fmt.alt(std.Uri.Component{ .raw = c }, .formatQuery) })
                else
                    try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100", .{ payer, collection });
                const body = (try self.getJson(allocator, pds, path)) orelse break;
                const parsed = try std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{});
                try validatePage(parsed);
                for (try attested.proofRefs(allocator, parsed, payer, recipient, trusted)) |proof| {
                    if (seen.contains(proof.payment_uri)) continue;
                    if (!try self.proofVerified(allocator, proof)) continue;
                    try seen.put(allocator, proof.payment_uri, {});
                    try verified.append(allocator, try attested.paymentOf(allocator, proof.payment));
                }
                page_cursor = attested.cursor(parsed) orelse break;
            }
            if (page == max_pages and page_cursor != null) return error.SupporterCheckIncomplete;
        }
        return verified.toOwnedSlice(allocator);
    }

    /// The policies `authority` publishes for spaces of `space_type`. A
    /// malformed record opens nothing; an unreadable repo is an error.
    fn listPolicies(context: *anyopaque, allocator: std.mem.Allocator, authority: []const u8, collection: []const u8, space_type: []const u8) anyerror![]const policy.Policy {
        const self: *Network = @ptrCast(@alignCast(context));
        if (zat.Did.parse(authority) == null) return error.InvalidIdentity;
        if (zat.Nsid.parse(collection) == null) return error.InvalidPolicyCollection;
        const pds = try self.pdsOf(allocator, authority);
        var out: std.ArrayList(policy.Policy) = .empty;
        var page_cursor: ?[]const u8 = null;
        var page: usize = 0;
        while (page < max_pages) : (page += 1) {
            const path = if (page_cursor) |c|
                try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100&cursor={f}", .{ authority, collection, std.fmt.alt(std.Uri.Component{ .raw = c }, .formatQuery) })
            else
                try std.fmt.allocPrint(allocator, "/xrpc/com.atproto.repo.listRecords?repo={s}&collection={s}&limit=100", .{ authority, collection });
            const body = (try self.getJson(allocator, pds, path)) orelse break;
            const parsed = try std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{});
            try validatePage(parsed);
            for (parsed.object.get("records").?.array.items) |item| {
                if (try policy.parse(allocator, item, collection, space_type)) |entry| try out.append(allocator, entry);
            }
            page_cursor = attested.cursor(parsed) orelse break;
        }
        if (page == max_pages and page_cursor != null) return error.PolicyListIncomplete;
        return out.toOwnedSlice(allocator);
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
    /// 404; any other non-200 answer is an error, never an empty result.
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
            if (result.status != .not_found) return error.UpstreamRejected;
            return null;
        }
        return try allocator.dupe(u8, result.body);
    }
};

test "an expired budget rejects before any identity lookup" {
    var network = Network.init(std.testing.io, std.testing.allocator, "http://127.0.0.1:1");
    defer network.deinit();
    network.deadline_ns = std.Io.Clock.awake.now(std.testing.io).nanoseconds - 1;
    try std.testing.expectError(error.AuthorizationUnavailable, network.evidence().payments(std.testing.allocator, "did:plc:viewer", "did:plc:artist", null));
    try std.testing.expectError(error.AuthorizationUnavailable, network.requestBudget());
}

fn validatePage(page: std.json.Value) !void {
    const records = if (page == .object) page.object.get("records") else null;
    if (records == null or records.? != .array) return error.InvalidSupporterResponse;
    if (page.object.get("cursor")) |cursor| {
        if (cursor != .string) return error.InvalidSupporterResponse;
    }
}

test "budgeted supporter pages distinguish absent from malformed cursors" {
    for ([_][]const u8{ "{\"records\":[]}", "{\"records\":[],\"cursor\":\"next\"}" }) |body| {
        var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, body, .{});
        defer parsed.deinit();
        try validatePage(parsed.value);
    }
    for ([_][]const u8{ "{\"records\":[],\"cursor\":null}", "{\"records\":[],\"cursor\":3}", "{\"records\":[],\"cursor\":false}", "{\"records\":{}}" }) |body| {
        var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, body, .{});
        defer parsed.deinit();
        try std.testing.expectError(error.InvalidSupporterResponse, validatePage(parsed.value));
    }
}

test "support sources default to atmosphere money" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const defaults = try SupportSources.parse(a, null);
    try std.testing.expectEqual(@as(usize, 1), defaults.trusted_brokers.len);
    try std.testing.expectEqualStrings(attested.default_trusted_brokers[0], defaults.trusted_brokers[0]);

    const configured = try SupportSources.parse(a, " did:plc:one , did:web:broker.example ,");
    try std.testing.expectEqual(@as(usize, 2), configured.trusted_brokers.len);
    try std.testing.expectEqualStrings("did:plc:one", configured.trusted_brokers[0]);
    try std.testing.expectEqualStrings("did:web:broker.example", configured.trusted_brokers[1]);

    try std.testing.expectError(error.InvalidSupportConfig, SupportSources.parse(a, "not-a-did"));
    try std.testing.expectError(error.InvalidSupportConfig, SupportSources.parse(a, ""));
}
