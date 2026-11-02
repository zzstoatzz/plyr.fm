//! Strict percent decoding for one already-isolated HTTP path segment.

const std = @import("std");

pub const Error = error{ InvalidPathSegment, OutOfMemory };

pub fn decode(allocator: std.mem.Allocator, encoded: []const u8) Error![]const u8 {
    if (encoded.len == 0 or containsSeparator(encoded)) return error.InvalidPathSegment;
    if (std.mem.indexOfScalar(u8, encoded, '%') == null) return encoded;

    const decoded = try allocator.alloc(u8, encoded.len);
    var read: usize = 0;
    var written: usize = 0;
    while (read < encoded.len) {
        const byte = if (encoded[read] == '%') blk: {
            if (read + 2 >= encoded.len) return error.InvalidPathSegment;
            const value = std.fmt.parseInt(u8, encoded[read + 1 .. read + 3], 16) catch
                return error.InvalidPathSegment;
            read += 3;
            break :blk value;
        } else blk: {
            const value = encoded[read];
            read += 1;
            break :blk value;
        };
        if (byte == 0 or byte == '/' or byte == '\\') return error.InvalidPathSegment;
        decoded[written] = byte;
        written += 1;
    }
    return decoded[0..written];
}

fn containsSeparator(value: []const u8) bool {
    return std.mem.indexOfAny(u8, value, "/\\") != null;
}

test "path segment decoding is strict and does not use form semantics" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    try std.testing.expectEqualStrings(
        "did:plc:artist",
        try decode(allocator, "did%3Aplc%3Aartist"),
    );
    try std.testing.expectEqualStrings("artist+alias", try decode(allocator, "artist+alias"));
    try std.testing.expectError(error.InvalidPathSegment, decode(allocator, "did%3Xplc"));
    try std.testing.expectError(error.InvalidPathSegment, decode(allocator, "did%2Fplc"));
    try std.testing.expectError(error.InvalidPathSegment, decode(allocator, "did%5cplc"));
    try std.testing.expectError(error.InvalidPathSegment, decode(allocator, "did%00plc"));
}
