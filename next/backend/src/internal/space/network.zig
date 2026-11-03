//! Network adapters for the managed-space checks: DID signing keys through
//! Zat's resolver, and supporter status through atprotofans.

const std = @import("std");
const zat = @import("zat");
const managed_space = @import("managed_space.zig");

const user_agent = "plyr.fm-zig-api/0.1 (+https://plyr.fm)";

pub const Network = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    resolver: zat.DidResolver,
    transport: zat.HttpTransport,

    pub fn init(io: std.Io, allocator: std.mem.Allocator) Network {
        var resolver = zat.DidResolver.init(io, allocator);
        resolver.transport.user_agent = user_agent;
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

    pub fn keys(self: *Network) managed_space.KeyLookup {
        return .{ .context = self, .lookup_fn = lookupKey };
    }

    pub fn supporters(self: *Network) managed_space.SupporterCheck {
        return .{ .context = self, .check_fn = checkSupporter };
    }

    fn lookupKey(context: *anyopaque, allocator: std.mem.Allocator, did_text: []const u8) anyerror![]const u8 {
        const self: *Network = @ptrCast(@alignCast(context));
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

    /// Direct atprotofans support: the artist is both subject and signer.
    fn checkSupporter(context: *anyopaque, allocator: std.mem.Allocator, supporter: []const u8, artist: []const u8) anyerror!bool {
        const self: *Network = @ptrCast(@alignCast(context));
        // DIDs are restricted to [A-Za-z0-9._:%-], all query-safe.
        if (zat.Did.parse(supporter) == null or zat.Did.parse(artist) == null) return error.InvalidIdentity;
        const url = try std.fmt.allocPrint(
            allocator,
            "https://atprotofans.com/xrpc/com.atprotofans.validateSupporter?supporter={s}&subject={s}&signer={s}",
            .{ supporter, artist, artist },
        );
        var result = try self.transport.fetch(.{
            .url = url,
            .accept = "application/json",
            .max_response_size = 64 * 1024,
            .deadline_ns = 5 * std.time.ns_per_s,
        });
        defer result.deinit(self.transport.allocator);
        if (result.status != .ok) return error.SupporterCheckRejected;
        return validFromBody(allocator, result.body);
    }
};

fn validFromBody(allocator: std.mem.Allocator, body: []const u8) !bool {
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSupporterResponse;
    const valid = parsed.value.object.get("valid") orelse return false;
    return valid == .bool and valid.bool;
}

test "atprotofans answers are read strictly" {
    try std.testing.expect(try validFromBody(std.testing.allocator, "{\"valid\":true,\"profile\":{}}"));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{\"valid\":false}"));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{\"valid\":\"true\"}"));
    try std.testing.expect(!try validFromBody(std.testing.allocator, "{}"));
    try std.testing.expectError(error.InvalidSupporterResponse, validFromBody(std.testing.allocator, "[]"));
}
