//! Client identity at the Fly/Cloudflare trust boundary.
//!
//! Fly supplies the address connected to its proxy. When that peer belongs to
//! an explicitly configured trusted reverse-proxy range, the adapter accepts
//! Cloudflare's connecting-client header. A direct caller cannot opt into that
//! branch by forging headers because its Fly-observed peer is outside the
//! trusted ranges.

const std = @import("std");

const http = std.http;
const IpAddress = std.Io.net.IpAddress;

pub fn rateLimitKey(
    request: *const http.Server.Request,
    trusted_proxy_cidrs: []const u8,
) ![]const u8 {
    var fly_peer: ?[]const u8 = null;
    var connecting_client: ?[]const u8 = null;
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "fly-client-ip")) {
            if (fly_peer != null) return error.AmbiguousClientIdentity;
            fly_peer = header.value;
        } else if (std.ascii.eqlIgnoreCase(header.name, "cf-connecting-ip")) {
            if (connecting_client != null) return error.AmbiguousClientIdentity;
            connecting_client = header.value;
        }
    }
    return select(fly_peer, connecting_client, trusted_proxy_cidrs);
}

pub fn validateTrustedProxyCidrs(value: []const u8) !void {
    var ranges = std.mem.tokenizeAny(u8, value, ", \t\r\n");
    while (ranges.next()) |range| _ = try parseCidr(range);
}

fn select(
    fly_peer: ?[]const u8,
    connecting_client: ?[]const u8,
    trusted_proxy_cidrs: []const u8,
) ![]const u8 {
    const peer_text = fly_peer orelse return "unknown";
    const peer = try parseClientIp(peer_text);
    if (!try isTrusted(peer.address, trusted_proxy_cidrs)) return peer.text;
    const client_text = connecting_client orelse return error.MissingProxyClientIdentity;
    return (try parseClientIp(client_text)).text;
}

const ParsedClientIp = struct {
    text: []const u8,
    address: IpAddress,
};

fn parseClientIp(raw: []const u8) !ParsedClientIp {
    const value = std.mem.trim(u8, raw, " \t");
    if (value.len == 0 or value.len > 64 or std.mem.indexOfScalar(u8, value, ',') != null)
        return error.InvalidClientIdentity;
    return .{
        .text = value,
        .address = IpAddress.parse(value, 0) catch return error.InvalidClientIdentity,
    };
}

const Cidr = union(enum) {
    ip4: struct { network: [4]u8, prefix: u8 },
    ip6: struct { network: [16]u8, prefix: u8 },

    fn contains(self: Cidr, address: IpAddress) bool {
        return switch (self) {
            .ip4 => |range| switch (address) {
                .ip4 => |candidate| prefixMatches(&range.network, &candidate.bytes, range.prefix),
                .ip6 => false,
            },
            .ip6 => |range| switch (address) {
                .ip4 => false,
                .ip6 => |candidate| prefixMatches(&range.network, &candidate.bytes, range.prefix),
            },
        };
    }
};

fn parseCidr(value: []const u8) !Cidr {
    const slash = std.mem.lastIndexOfScalar(u8, value, '/') orelse
        return error.InvalidProxyCidr;
    if (slash == 0 or slash == value.len - 1) return error.InvalidProxyCidr;
    const address = IpAddress.parse(value[0..slash], 0) catch
        return error.InvalidProxyCidr;
    const prefix = std.fmt.parseInt(u8, value[slash + 1 ..], 10) catch
        return error.InvalidProxyCidr;
    return switch (address) {
        .ip4 => |ip| if (prefix <= 32)
            .{ .ip4 = .{ .network = ip.bytes, .prefix = prefix } }
        else
            error.InvalidProxyCidr,
        .ip6 => |ip| if (prefix <= 128)
            .{ .ip6 = .{ .network = ip.bytes, .prefix = prefix } }
        else
            error.InvalidProxyCidr,
    };
}

fn isTrusted(address: IpAddress, cidrs: []const u8) !bool {
    var ranges = std.mem.tokenizeAny(u8, cidrs, ", \t\r\n");
    while (ranges.next()) |raw| {
        if ((try parseCidr(raw)).contains(address)) return true;
    }
    return false;
}

fn prefixMatches(network: []const u8, candidate: []const u8, prefix: u8) bool {
    const whole_bytes = prefix / 8;
    if (!std.mem.eql(u8, network[0..whole_bytes], candidate[0..whole_bytes]))
        return false;
    const remaining = prefix % 8;
    if (remaining == 0) return true;
    const mask: u8 = @as(u8, 0xff) << @intCast(8 - remaining);
    return network[whole_bytes] & mask == candidate[whole_bytes] & mask;
}

test "trusted proxies reveal a validated client while direct peers cannot spoof it" {
    const ranges = "173.245.48.0/20, 2606:4700::/32";
    try std.testing.expectEqualStrings(
        "203.0.113.9",
        try select("173.245.48.3", "203.0.113.9", ranges),
    );
    try std.testing.expectEqualStrings(
        "2001:db8::9",
        try select("2606:4700::1", "2001:db8::9", ranges),
    );
    try std.testing.expectEqualStrings(
        "198.51.100.4",
        try select("198.51.100.4", "203.0.113.9", ranges),
    );
    try std.testing.expectError(
        error.MissingProxyClientIdentity,
        select("173.245.48.3", null, ranges),
    );
}

test "proxy ranges and client addresses are strict" {
    try validateTrustedProxyCidrs("173.245.48.0/20, 2606:4700::/32");
    try std.testing.expectError(
        error.InvalidProxyCidr,
        validateTrustedProxyCidrs("173.245.48.0/33"),
    );
    try std.testing.expectError(
        error.InvalidProxyCidr,
        validateTrustedProxyCidrs("cloudflare.example/24"),
    );
    try std.testing.expectError(
        error.InvalidClientIdentity,
        select("203.0.113.7, 198.51.100.2", null, ""),
    );
}
