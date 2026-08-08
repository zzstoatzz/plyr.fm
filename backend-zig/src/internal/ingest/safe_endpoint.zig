//! Resolve an untrusted HTTPS service endpoint without DNS-rebinding SSRF.
//!
//! Every returned address is checked. One checked IPv4 address is then pinned
//! for the connection while the original hostname remains the TLS/SNI identity.

const std = @import("std");
const zat = @import("zat");

const net = std.Io.net;

pub const Endpoint = struct {
    base_url: []const u8,
    logical_host: []const u8,
    dial_host: []const u8,

    pub fn deinit(self: Endpoint, allocator: std.mem.Allocator) void {
        allocator.free(self.base_url);
        allocator.free(self.logical_host);
        allocator.free(self.dial_host);
    }

    pub fn connection(self: Endpoint) zat.HttpTransport.ResolvedConnection {
        return .{ .dial_host = self.dial_host, .logical_host = self.logical_host };
    }
};

pub const Error = error{
    InvalidEndpoint,
    UnsafeEndpoint,
    DnsResolutionFailed,
    NoSupportedAddress,
    OutOfMemory,
};

pub fn resolve(
    io: std.Io,
    allocator: std.mem.Allocator,
    raw_url: []const u8,
) Error!Endpoint {
    const parsed = parseOrigin(raw_url) catch return error.InvalidEndpoint;
    const port = parsed.port orelse 443;
    if (parseLiteral(parsed.host, port)) |address| {
        return fromAddresses(allocator, raw_url, parsed.host, &.{address});
    }

    const host_name = net.HostName.init(parsed.host) catch return error.InvalidEndpoint;
    var canonical_name_buffer: [net.HostName.max_len]u8 = undefined;
    var lookup_buffer: [32]net.HostName.LookupResult = undefined;
    var lookup_queue: std.Io.Queue(net.HostName.LookupResult) = .init(&lookup_buffer);
    host_name.lookup(io, &lookup_queue, .{
        .port = port,
        .canonical_name_buffer = &canonical_name_buffer,
    }) catch return error.DnsResolutionFailed;

    var addresses: std.ArrayList(net.IpAddress) = .empty;
    defer addresses.deinit(allocator);
    while (lookup_queue.getOne(io)) |result| switch (result) {
        .address => |address| addresses.append(allocator, address) catch
            return error.OutOfMemory,
        .canonical_name => {},
    } else |err| switch (err) {
        error.Closed => {},
        else => return error.DnsResolutionFailed,
    }
    if (addresses.items.len == 0) return error.DnsResolutionFailed;
    return fromAddresses(allocator, raw_url, parsed.host, addresses.items);
}

pub fn fromAddresses(
    allocator: std.mem.Allocator,
    raw_url: []const u8,
    expected_host: []const u8,
    addresses: []const net.IpAddress,
) Error!Endpoint {
    const parsed = parseOrigin(raw_url) catch return error.InvalidEndpoint;
    if (!std.ascii.eqlIgnoreCase(parsed.host, expected_host))
        return error.InvalidEndpoint;
    if (addresses.len == 0) return error.DnsResolutionFailed;

    var selected: ?[4]u8 = null;
    for (addresses) |address| switch (address) {
        .ip4 => |ip4| {
            if (!isGlobalIp4(ip4.bytes)) return error.UnsafeEndpoint;
            if (selected == null) selected = ip4.bytes;
        },
        .ip6 => |ip6| {
            if (net.Ip4Address.fromIp6(ip6)) |ip4| {
                if (!isGlobalIp4(ip4.bytes)) return error.UnsafeEndpoint;
                if (selected == null) selected = ip4.bytes;
            } else if (!isGlobalIp6(ip6.bytes)) return error.UnsafeEndpoint;
        },
    };
    const ip = selected orelse return error.NoSupportedAddress;

    const base = std.mem.trimEnd(u8, raw_url, "/");
    const owned_base = allocator.dupe(u8, base) catch return error.OutOfMemory;
    errdefer allocator.free(owned_base);
    const owned_host = allocator.dupe(u8, parsed.host) catch return error.OutOfMemory;
    errdefer allocator.free(owned_host);
    const dial_host = std.fmt.allocPrint(
        allocator,
        "{d}.{d}.{d}.{d}",
        .{ ip[0], ip[1], ip[2], ip[3] },
    ) catch return error.OutOfMemory;
    return .{
        .base_url = owned_base,
        .logical_host = owned_host,
        .dial_host = dial_host,
    };
}

const ParsedOrigin = struct {
    host: []const u8,
    port: ?u16,
};

fn parseOrigin(raw_url: []const u8) !ParsedOrigin {
    const uri = try std.Uri.parse(raw_url);
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "https") or
        uri.user != null or
        uri.password != null or
        uri.query != null or
        uri.fragment != null or
        !uri.path.isEmpty() and !componentEquals(uri.path, "/"))
        return error.InvalidEndpoint;
    const host = switch (uri.host orelse return error.InvalidEndpoint) {
        .raw => |value| value,
        .percent_encoded => |value| if (std.mem.indexOfScalar(u8, value, '%') == null)
            value
        else
            return error.InvalidEndpoint,
    };
    if (host.len == 0 or std.ascii.eqlIgnoreCase(std.mem.trimEnd(u8, host, "."), "localhost"))
        return error.InvalidEndpoint;
    return .{ .host = host, .port = uri.port };
}

fn componentEquals(component: std.Uri.Component, expected: []const u8) bool {
    var buffer: [8]u8 = undefined;
    const raw = component.toRaw(&buffer) catch return false;
    return std.mem.eql(u8, raw, expected);
}

fn parseLiteral(host: []const u8, port: u16) ?net.IpAddress {
    if (net.Ip4Address.parse(host, port)) |ip4| return .{ .ip4 = ip4 } else |_| {}
    const ip6_text = if (host.len >= 2 and host[0] == '[' and host[host.len - 1] == ']')
        host[1 .. host.len - 1]
    else
        host;
    if (net.Ip6Address.parse(ip6_text, port)) |ip6| return .{ .ip6 = ip6 } else |_| {}
    return null;
}

fn isGlobalIp4(ip: [4]u8) bool {
    const blocked = [_]Ip4Range{
        .{ .network = .{ 0, 0, 0, 0 }, .prefix = 8 },
        .{ .network = .{ 10, 0, 0, 0 }, .prefix = 8 },
        .{ .network = .{ 100, 64, 0, 0 }, .prefix = 10 },
        .{ .network = .{ 127, 0, 0, 0 }, .prefix = 8 },
        .{ .network = .{ 169, 254, 0, 0 }, .prefix = 16 },
        .{ .network = .{ 172, 16, 0, 0 }, .prefix = 12 },
        .{ .network = .{ 192, 0, 0, 0 }, .prefix = 24 },
        .{ .network = .{ 192, 0, 2, 0 }, .prefix = 24 },
        .{ .network = .{ 192, 168, 0, 0 }, .prefix = 16 },
        .{ .network = .{ 198, 18, 0, 0 }, .prefix = 15 },
        .{ .network = .{ 198, 51, 100, 0 }, .prefix = 24 },
        .{ .network = .{ 203, 0, 113, 0 }, .prefix = 24 },
        .{ .network = .{ 224, 0, 0, 0 }, .prefix = 4 },
        .{ .network = .{ 240, 0, 0, 0 }, .prefix = 4 },
    };
    for (blocked) |range| if (range.contains(ip)) return false;
    return true;
}

const Ip4Range = struct {
    network: [4]u8,
    prefix: u5,

    fn contains(self: Ip4Range, address: [4]u8) bool {
        const network = std.mem.readInt(u32, &self.network, .big);
        const candidate = std.mem.readInt(u32, &address, .big);
        const shift: u5 = @intCast(32 - @as(u6, self.prefix));
        const mask = if (self.prefix == 0) @as(u32, 0) else ~@as(u32, 0) << shift;
        return network & mask == candidate & mask;
    }
};

fn isGlobalIp6(ip: [16]u8) bool {
    // IPv4-mapped values inherit the IPv4 policy.
    const mapped: net.Ip6Address = .{ .bytes = ip, .port = 0 };
    if (net.Ip4Address.fromIp6(mapped)) |ip4| return isGlobalIp4(ip4.bytes);

    // Permit only global unicast, then remove special-purpose subranges.
    if (ip[0] & 0xe0 != 0x20) return false; // 2000::/3
    if (matchesIp6(ip, .{ 0x20, 0x01 } ++ .{0} ** 14, 23)) return false; // IETF special-purpose
    if (matchesIp6(ip, .{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 12, 32)) return false; // documentation
    if (matchesIp6(ip, .{ 0x20, 0x02 } ++ .{0} ** 14, 16)) return false; // 6to4
    return true;
}

fn matchesIp6(address: [16]u8, network: [16]u8, prefix: u8) bool {
    const whole_bytes = prefix / 8;
    const remaining = prefix % 8;
    if (!std.mem.eql(u8, address[0..whole_bytes], network[0..whole_bytes])) return false;
    if (remaining == 0) return true;
    const mask: u8 = @as(u8, 0xff) << @intCast(8 - remaining);
    return address[whole_bytes] & mask == network[whole_bytes] & mask;
}

test "endpoint syntax is an HTTPS origin without credentials or indirection" {
    const address: net.IpAddress = .{ .ip4 = .{ .bytes = .{ 8, 8, 8, 8 }, .port = 443 } };
    var endpoint = try fromAddresses(
        std.testing.allocator,
        "https://pds.example/",
        "pds.example",
        &.{address},
    );
    defer endpoint.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("https://pds.example", endpoint.base_url);
    try std.testing.expectEqualStrings("pds.example", endpoint.logical_host);
    try std.testing.expectEqualStrings("8.8.8.8", endpoint.dial_host);

    for ([_][]const u8{
        "http://pds.example",
        "https://user@pds.example",
        "https://pds.example/xrpc",
        "https://pds.example?next=https://safe.example",
        "https://pds.example#fragment",
    }) |url| try std.testing.expectError(
        error.InvalidEndpoint,
        fromAddresses(std.testing.allocator, url, "pds.example", &.{address}),
    );
}

test "every DNS answer must be globally routable" {
    const safe: net.IpAddress = .{ .ip4 = .{ .bytes = .{ 8, 8, 8, 8 }, .port = 443 } };
    const unsafe: net.IpAddress = .{ .ip4 = .{ .bytes = .{ 10, 0, 0, 1 }, .port = 443 } };
    try std.testing.expectError(
        error.UnsafeEndpoint,
        fromAddresses(std.testing.allocator, "https://pds.example", "pds.example", &.{ safe, unsafe }),
    );

    for ([_][4]u8{
        .{ 0, 0, 0, 0 },
        .{ 100, 64, 0, 1 },
        .{ 127, 0, 0, 1 },
        .{ 169, 254, 169, 254 },
        .{ 172, 31, 0, 1 },
        .{ 192, 0, 2, 1 },
        .{ 192, 168, 1, 1 },
        .{ 198, 18, 0, 1 },
        .{ 203, 0, 113, 1 },
        .{ 224, 0, 0, 1 },
        .{ 255, 255, 255, 255 },
    }) |ip| try std.testing.expect(!isGlobalIp4(ip));
    try std.testing.expect(isGlobalIp4(.{ 1, 1, 1, 1 }));
}

test "IPv6 special-purpose and mapped-private addresses are unsafe" {
    try std.testing.expect(!isGlobalIp6((try net.Ip6Address.parse("::1", 0)).bytes));
    try std.testing.expect(!isGlobalIp6((try net.Ip6Address.parse("fc00::1", 0)).bytes));
    try std.testing.expect(!isGlobalIp6((try net.Ip6Address.parse("fe80::1", 0)).bytes));
    try std.testing.expect(!isGlobalIp6((try net.Ip6Address.parse("2001:db8::1", 0)).bytes));
    try std.testing.expect(!isGlobalIp6((try net.Ip6Address.parse("2002:7f00:1::", 0)).bytes));
    try std.testing.expect(!isGlobalIp6((try net.Ip6Address.parse("::ffff:127.0.0.1", 0)).bytes));
    try std.testing.expect(isGlobalIp6((try net.Ip6Address.parse("2606:4700:4700::1111", 0)).bytes));
}
