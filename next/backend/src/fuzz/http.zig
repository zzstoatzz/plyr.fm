//! Query strings and path segments are the first bytes a client controls.
//! The decoders are checked against a percent-decoding model written from
//! RFC 3986: `%` followed by exactly two hex digits, nothing else.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const query = @import("../internal/http/query.zig");
const path_segment = @import("../internal/http/path_segment.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "http.query_component", queryComponent },
        .{ "http.query_pairs", queryPairs },
        .{ "http.path_segment", pathSegment },
        .{ "http.encode_decode", encodeDecode },
        .{ "http.decimal", decimal },
    });
}

const alphabet = "%+-_ 0123456789aAfFgG=&/\\.:\x00\xff";

/// mostly escapes, whose two digits are drawn from hex and its near misses
fn encodedText(case: *hegel.TestCase, a: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    for (0..try case.int(usize, 0, 6)) |_| {
        if (try case.boolean()) {
            try out.append(a, '%');
            try gen.fromAlphabet(case, a, &out, "0123456789aAfFgG+-_ ", 0, 2);
        } else {
            try gen.fromAlphabet(case, a, &out, alphabet, 1, 2);
        }
    }
    return out.toOwnedSlice(a);
}

fn hexDigit(c: u8) ?u8 {
    return switch (c) {
        '0'...'9' => c - '0',
        'a'...'f' => c - 'a' + 10,
        'A'...'F' => c - 'A' + 10,
        else => null,
    };
}

/// null when the model rejects the input
fn modelDecode(a: std.mem.Allocator, encoded: []const u8, plus_is_space: bool) !?[]u8 {
    var out: std.ArrayList(u8) = .empty;
    var i: usize = 0;
    while (i < encoded.len) {
        if (encoded[i] == '%') {
            if (encoded.len - i < 3) return null;
            const hi = hexDigit(encoded[i + 1]) orelse return null;
            const lo = hexDigit(encoded[i + 2]) orelse return null;
            try out.append(a, hi * 16 + lo);
            i += 3;
        } else {
            try out.append(a, if (plus_is_space and encoded[i] == '+') ' ' else encoded[i]);
            i += 1;
        }
    }
    return out.items;
}

fn queryComponent(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const encoded = try encodedText(case, a);
    case.note("decodeComponent({x})", .{encoded});
    const expected = try modelDecode(a, encoded, true);
    if (query.decodeComponent(a, encoded)) |actual| {
        case.note("-> {x}", .{actual});
        const want = expected orelse {
            case.event("decoder accepts what the model rejects");
            return case.fail("query decoder accepts a malformed escape");
        };
        if (!std.mem.eql(u8, actual, want)) return case.fail("query decoder disagrees with the model");
    } else |_| {
        if (expected != null) return case.fail("query decoder rejects a well-formed component");
    }
}

fn queryPairs(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    var target: std.ArrayList(u8) = .empty;
    try target.appendSlice(a, "/v1/tracks");
    if (try case.boolean()) try target.append(a, '?');
    try gen.fromAlphabet(case, a, &target, "ab=&%2B+?", 0, 16);
    case.note("iterate({s})", .{target.items});

    var pairs = query.Iterator.init(a, target.items);
    var count: usize = 0;
    while (true) {
        const pair = pairs.next() catch break;
        const p = pair orelse break;
        count += 1;
        if (p.name.len == 0) return case.fail("query iterator yields an empty name");
        if (count > target.items.len) return case.fail("query iterator does not terminate");
    }
}

fn pathSegment(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const encoded = if (try case.boolean()) try encodedText(case, a) else try gen.string(case, a, "ab:/\\\x00", 0, 4);
    case.note("path_segment.decode({x})", .{encoded});
    const expected: ?[]u8 = blk: {
        if (encoded.len == 0 or std.mem.indexOfAny(u8, encoded, "/\\") != null) break :blk null;
        const decoded = (try modelDecode(a, encoded, false)) orelse break :blk null;
        if (std.mem.indexOfAny(u8, decoded, "\x00/\\") != null) break :blk null;
        break :blk decoded;
    };
    if (path_segment.decode(a, encoded)) |actual| {
        const want = expected orelse return case.fail("path decoder accepts a malformed segment");
        if (!std.mem.eql(u8, actual, want)) return case.fail("path decoder disagrees with the model");
    } else |_| {
        if (expected != null) return case.fail("path decoder rejects a well-formed segment");
    }
}

fn encodeDecode(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const raw = try gen.bytes(case, a, 24);
    var encoded: std.ArrayList(u8) = .empty;
    for (raw) |byte| {
        if (std.ascii.isAlphanumeric(byte) and try case.boolean()) {
            try encoded.append(a, byte);
        } else {
            const upper = try case.boolean();
            if (upper) try encoded.print(a, "%{X:0>2}", .{byte}) else try encoded.print(a, "%{x:0>2}", .{byte});
        }
    }
    case.note("raw {x} encoded {s}", .{ raw, encoded.items });
    const decoded = query.decodeComponent(a, encoded.items) catch return case.fail("a percent-encoded component does not decode");
    if (!std.mem.eql(u8, decoded, raw)) return case.fail("percent encoding does not round-trip");
}

/// limits and timeouts are decimal digits and nothing else; std's parseInt
/// alone would also take a sign and `_` separators
fn decimal(_: void, case: *hegel.TestCase) !void {
    var buffer: [24]u8 = undefined;
    const text = buffer[0..try case.int(usize, 0, buffer.len)];
    for (text) |*c| c.* = try gen.pick(case, u8, "0123456789012345678901234567890123456789+-_ x");
    case.note("text {s}", .{text});
    var digits_only = text.len > 0;
    for (text) |c| digits_only = digits_only and std.ascii.isDigit(c);
    const parsed = query.parseDecimal(u64, text) catch |err| {
        if (digits_only and err != error.Overflow) return case.fail("digits were refused");
        return;
    };
    if (!digits_only) return case.fail("a non-digit was accepted");
    var expected: u64 = 0;
    for (text) |c| expected = expected * 10 + (c - '0');
    if (parsed != expected) return case.fail("digits parse to the wrong value");
    case.event("accepted");
}
