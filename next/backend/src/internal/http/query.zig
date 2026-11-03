//! Strict URL query-pair parsing shared by v1 resources.
//!
//! This layer only handles syntax and form-style percent decoding. Each
//! application use case remains responsible for its allowed names, duplicate
//! policy, value types, and bounds.

const std = @import("std");

pub const Pair = struct {
    name: []const u8,
    value: []const u8,
};

pub const Iterator = struct {
    allocator: std.mem.Allocator,
    remaining: ?[]const u8,

    pub fn init(allocator: std.mem.Allocator, target: []const u8) Iterator {
        const start = std.mem.indexOfScalar(u8, target, '?') orelse
            return .{ .allocator = allocator, .remaining = null };
        const query = target[start + 1 ..];
        return .{ .allocator = allocator, .remaining = if (query.len == 0) null else query };
    }

    pub fn next(self: *Iterator) !?Pair {
        const remaining = self.remaining orelse return null;
        const separator = std.mem.indexOfScalar(u8, remaining, '&');
        const encoded_pair = if (separator) |index| remaining[0..index] else remaining;
        self.remaining = if (separator) |index| remaining[index + 1 ..] else null;
        if (encoded_pair.len == 0 or (self.remaining != null and self.remaining.?.len == 0))
            return error.InvalidQuery;

        const equals = std.mem.indexOfScalar(u8, encoded_pair, '=') orelse
            return error.InvalidQuery;
        const encoded_name = encoded_pair[0..equals];
        const encoded_value = encoded_pair[equals + 1 ..];
        if (encoded_name.len == 0) return error.InvalidQuery;
        return .{
            .name = try decodeComponent(self.allocator, encoded_name),
            .value = try decodeComponent(self.allocator, encoded_value),
        };
    }
};

pub fn decodeComponent(allocator: std.mem.Allocator, encoded: []const u8) ![]const u8 {
    if (std.mem.indexOfAny(u8, encoded, "%+") == null) return encoded;
    const decoded = try allocator.alloc(u8, encoded.len);
    var read: usize = 0;
    var written: usize = 0;
    while (read < encoded.len) {
        if (encoded[read] == '%') {
            if (read + 2 >= encoded.len) return error.InvalidQuery;
            decoded[written] = hexByte(encoded[read + 1 .. read + 3]) orelse
                return error.InvalidQuery;
            read += 3;
        } else {
            decoded[written] = if (encoded[read] == '+') ' ' else encoded[read];
            read += 1;
        }
        written += 1;
    }
    return decoded[0..written];
}

/// Decimal digits only: `std.fmt.parseInt` also takes a sign and `_`
/// separators, so "+5" and "1_0" would read as limits.
pub fn parseDecimal(comptime T: type, text: []const u8) !T {
    if (text.len == 0) return error.InvalidCharacter;
    for (text) |c| if (!std.ascii.isDigit(c)) return error.InvalidCharacter;
    return std.fmt.parseInt(T, text, 10);
}

/// Two hex digits, nothing else: `std.fmt.parseInt` would also take a sign.
pub fn hexByte(digits: []const u8) ?u8 {
    const high = std.fmt.charToDigit(digits[0], 16) catch return null;
    const low = std.fmt.charToDigit(digits[1], 16) catch return null;
    return high * 16 + low;
}

test "query iterator decodes names and values without accepting malformed pairs" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    var iterator = Iterator.init(arena.allocator(), "/v1/things?artist%5Fdid=did%3Aplc%3Aartist&name=a+b");
    const first = (try iterator.next()).?;
    try std.testing.expectEqualStrings("artist_did", first.name);
    try std.testing.expectEqualStrings("did:plc:artist", first.value);
    const second = (try iterator.next()).?;
    try std.testing.expectEqualStrings("a b", second.value);
    try std.testing.expect((try iterator.next()) == null);

    var trailing = Iterator.init(arena.allocator(), "/v1/things?a=b&");
    try std.testing.expectError(error.InvalidQuery, trailing.next());
    var invalid_escape = Iterator.init(arena.allocator(), "/v1/things?a=%3X");
    try std.testing.expectError(error.InvalidQuery, invalid_escape.next());
}

test "percent escapes take exactly two hex digits" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    try std.testing.expectEqualStrings("\x0f", try decodeComponent(allocator, "%0F"));
    try std.testing.expectEqualStrings("\xab", try decodeComponent(allocator, "%aB"));
    try std.testing.expectError(error.InvalidQuery, decodeComponent(allocator, "%+0"));
    try std.testing.expectError(error.InvalidQuery, decodeComponent(allocator, "%+f"));
    try std.testing.expectError(error.InvalidQuery, decodeComponent(allocator, "%-0"));
}

test "decimal parameters take digits only" {
    try std.testing.expectEqual(@as(usize, 10), try parseDecimal(usize, "10"));
    try std.testing.expectEqual(@as(usize, 7), try parseDecimal(usize, "007"));
    try std.testing.expectError(error.InvalidCharacter, parseDecimal(usize, "1_0"));
    try std.testing.expectError(error.InvalidCharacter, parseDecimal(usize, "+5"));
    try std.testing.expectError(error.InvalidCharacter, parseDecimal(usize, "-0"));
    try std.testing.expectError(error.InvalidCharacter, parseDecimal(usize, ""));
    try std.testing.expectError(error.Overflow, parseDecimal(u32, "4294967296"));
}
