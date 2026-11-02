//! Opaque bearer generation and irreversible database/cache lookup keys.

const std = @import("std");

pub const Digest = [std.crypto.hash.sha2.Sha256.digest_length]u8;
pub const random_length = 32;

pub fn generate(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    var random: [random_length]u8 = undefined;
    io.random(&random);
    const encoder = std.base64.url_safe_no_pad.Encoder;
    const token = try allocator.alloc(u8, encoder.calcSize(random.len));
    _ = encoder.encode(token, &random);
    return token;
}

pub fn digest(token: []const u8) Digest {
    var value: Digest = undefined;
    std.crypto.hash.sha2.Sha256.hash(token, &value, .{});
    return value;
}

pub fn isCanonical(token: []const u8) bool {
    const decoder = std.base64.url_safe_no_pad.Decoder;
    const decoded_len = decoder.calcSizeForSlice(token) catch return false;
    if (decoded_len != random_length) return false;
    var decoded: [random_length]u8 = undefined;
    decoder.decode(&decoded, token) catch return false;
    var canonical: [43]u8 = undefined;
    const encoded = std.base64.url_safe_no_pad.Encoder.encode(&canonical, &decoded);
    return std.mem.eql(u8, encoded, token);
}

test "bearer tokens are canonical and only their digest is stable storage material" {
    const first = try generate(std.testing.allocator, std.Options.debug_io);
    defer std.testing.allocator.free(first);
    const second = try generate(std.testing.allocator, std.Options.debug_io);
    defer std.testing.allocator.free(second);

    try std.testing.expect(isCanonical(first));
    try std.testing.expect(isCanonical(second));
    try std.testing.expect(!std.mem.eql(u8, first, second));
    try std.testing.expectEqual(digest(first), digest(first));
    try std.testing.expect(!std.mem.eql(u8, &digest(first), &digest(second)));
    try std.testing.expect(!isCanonical("session-id"));
    try std.testing.expect(!isCanonical(first[0 .. first.len - 1]));
}
