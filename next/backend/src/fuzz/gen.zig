//! Draws shared by the property harnesses. Each generator mixes valid
//! syntax with near-misses, so a harness spends most cases near the
//! boundary a parser decides on.

const std = @import("std");
const hegel = @import("hegel");

pub const TestCase = hegel.TestCase;

pub fn pick(case: *TestCase, comptime T: type, options: []const T) !T {
    return options[try case.index(options.len)];
}

/// `len` bytes drawn from `alphabet`, appended to `out`.
pub fn fromAlphabet(
    case: *TestCase,
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    alphabet: []const u8,
    min: usize,
    max: usize,
) !void {
    const len = try case.int(usize, min, max);
    for (0..len) |_| try out.append(allocator, alphabet[try case.index(alphabet.len)]);
}

pub fn string(
    case: *TestCase,
    allocator: std.mem.Allocator,
    alphabet: []const u8,
    min: usize,
    max: usize,
) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    try fromAlphabet(case, allocator, &out, alphabet, min, max);
    return out.toOwnedSlice(allocator);
}

pub fn bytes(case: *TestCase, allocator: std.mem.Allocator, max: usize) ![]u8 {
    const buffer = try allocator.alloc(u8, max);
    return case.bytes(buffer, 0, max);
}

const lower = "abcdefghijklmnopqrstuvwxyz";
const base32 = "abcdefghijklmnopqrstuvwxyz234567";
const rkey_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_:~";
const noise = "a:/.%_-~@#?&= Z9\x00\xff\xc3";

pub fn did(case: *TestCase, allocator: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    switch (try case.int(u8, 0, 3)) {
        0 => {
            try out.appendSlice(allocator, "did:plc:");
            try fromAlphabet(case, allocator, &out, base32, 24, 24);
        },
        1 => {
            try out.appendSlice(allocator, "did:web:");
            try fromAlphabet(case, allocator, &out, lower, 1, 8);
            try out.appendSlice(allocator, ".example");
        },
        2 => {
            try out.appendSlice(allocator, "did:");
            try fromAlphabet(case, allocator, &out, lower, 1, 4);
            try out.append(allocator, ':');
            try fromAlphabet(case, allocator, &out, rkey_chars, 1, 12);
        },
        else => try fromAlphabet(case, allocator, &out, noise, 0, 16),
    }
    return out.toOwnedSlice(allocator);
}

pub fn rkey(case: *TestCase, allocator: std.mem.Allocator) ![]u8 {
    return switch (try case.int(u8, 0, 3)) {
        0 => string(case, allocator, base32, 13, 13),
        1 => string(case, allocator, rkey_chars, 1, 16),
        2 => try allocator.dupe(u8, try pick(case, []const u8, &.{ "self", ".", "..", "a", "3m123abc" })),
        else => string(case, allocator, noise, 0, 8),
    };
}

pub fn collection(case: *TestCase) ![]const u8 {
    return pick(case, []const u8, &.{
        "fm.plyr.dev.track",
        "fm.plyr.dev.list",
        "fm.plyr.track",
        "app.bsky.feed.post",
        "fm.plyr",
        "Fm.plyr.track",
        "fm..track",
    });
}

/// An AT-URI that is usually a record URI and sometimes almost one.
pub fn atUri(case: *TestCase, allocator: std.mem.Allocator) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    if (try case.boolean()) {
        try out.appendSlice(allocator, "at://did:plc:");
        try fromAlphabet(case, allocator, &out, base32, 24, 24);
        try out.append(allocator, '/');
        try out.appendSlice(allocator, try pick(case, []const u8, &.{ "fm.plyr.dev.track", "fm.plyr.dev.list" }));
        try out.append(allocator, '/');
        try fromAlphabet(case, allocator, &out, rkey_chars, 1, 14);
        return out.toOwnedSlice(allocator);
    }
    try out.appendSlice(allocator, try pick(case, []const u8, &.{ "at://", "at://", "at://", "at:/", "AT://", "" }));
    try out.appendSlice(allocator, try did(case, allocator));
    if (try case.int(u8, 0, 7) != 0) {
        try out.append(allocator, '/');
        try out.appendSlice(allocator, try collection(case));
        if (try case.int(u8, 0, 7) != 0) {
            try out.append(allocator, '/');
            try out.appendSlice(allocator, try rkey(case, allocator));
        }
    }
    if (try case.int(u8, 0, 15) == 0) try out.appendSlice(allocator, try pick(case, []const u8, &.{ "/", "#frag", "?q", "/extra" }));
    return out.toOwnedSlice(allocator);
}

/// A code point biased toward the classes grapheme segmentation cares about.
pub fn codepoint(case: *TestCase) !u21 {
    const ranges = [_][2]u21{
        .{ 0x20, 0x7e }, // printable ASCII
        .{ 0x00, 0x1f }, // controls, CR, LF
        .{ 0x300, 0x36f }, // combining marks
        .{ 0x200c, 0x200d }, // ZWNJ, ZWJ
        .{ 0x1f1e6, 0x1f1ff }, // regional indicators
        .{ 0x1f300, 0x1f6ff }, // pictographs
        .{ 0x1f3fb, 0x1f3ff }, // skin tone modifiers
        .{ 0xfe00, 0xfe0f }, // variation selectors
        .{ 0x1100, 0x11ff }, // Hangul jamo
        .{ 0xac00, 0xac20 }, // Hangul syllables
        .{ 0x0915, 0x094d }, // Devanagari consonants and virama
        .{ 0x0600, 0x0605 }, // prepend
        .{ 0x0e30, 0x0e33 }, // Thai spacing marks
        .{ 0x80, 0xd7ff },
        .{ 0xe000, 0x10ffff },
    };
    const range = ranges[try case.index(ranges.len)];
    return case.int(u21, range[0], range[1]);
}

pub fn utf8(case: *TestCase, allocator: std.mem.Allocator, max_codepoints: usize) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    const len = try case.int(usize, 0, max_codepoints);
    for (0..len) |_| {
        var encoded: [4]u8 = undefined;
        const n = std.unicode.utf8Encode(try codepoint(case), &encoded) catch unreachable;
        try out.appendSlice(allocator, encoded[0..n]);
    }
    return out.toOwnedSlice(allocator);
}

pub const Debug = std.heap.DebugAllocator(.{});

pub fn noLeaks(debug: *Debug) void {
    if (debug.deinit() == .leak) @panic("the case leaked memory");
}

/// run every `.{ key, property }`, so one failure does not hide the rest
pub fn runAll(comptime properties: anytype) error{PropertyFailed}!void {
    var failed = false;
    inline for (properties) |property| {
        std.debug.print("-- {s}\n", .{property[0]});
        hegel.run(.{ .key = property[0] }, {}, property[1]) catch {
            failed = true;
        };
    }
    if (failed) return error.PropertyFailed;
}
