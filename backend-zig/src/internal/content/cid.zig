//! The deliberately small CID profile used by DASL and BDASL.
//!
//! DASL uses CIDv1, lowercase base32, raw or DRISL codecs, SHA-256, and a
//! 32-byte digest. BDASL changes only the hash to BLAKE3 so large media can be
//! verified incrementally. Keeping this parser narrow prevents a value that
//! merely looks like a CID from crossing an authority boundary.

const std = @import("std");

pub const Codec = enum { raw, drisl };
pub const Hash = enum { sha256, blake3 };

pub const Cid = struct {
    codec: Codec,
    hash: Hash,
    digest: [32]u8,

    pub fn verify(self: Cid, bytes: []const u8) bool {
        var actual: [32]u8 = undefined;
        switch (self.hash) {
            .sha256 => std.crypto.hash.sha2.Sha256.hash(bytes, &actual, .{}),
            .blake3 => std.crypto.hash.Blake3.hash(bytes, &actual, .{}),
        }
        return std.crypto.timing_safe.eql([32]u8, self.digest, actual);
    }
};

pub const ParseError = error{
    InvalidEncoding,
    InvalidLength,
    InvalidVersion,
    UnsupportedCodec,
    UnsupportedHash,
    InvalidDigestLength,
};

pub fn parse(text: []const u8) ParseError!Cid {
    // 36 binary bytes encode as 58 unpadded base32 characters, plus `b`.
    if (text.len != 59) return error.InvalidLength;
    if (text[0] != 'b') return error.InvalidEncoding;

    var binary: [36]u8 = undefined;
    try decodeBase32(binary[0..], text[1..]);
    if (binary[0] != 0x01) return error.InvalidVersion;

    const codec: Codec = switch (binary[1]) {
        0x55 => .raw,
        0x71 => .drisl,
        else => return error.UnsupportedCodec,
    };
    const hash: Hash = switch (binary[2]) {
        0x12 => .sha256,
        0x1e => .blake3,
        else => return error.UnsupportedHash,
    };
    if (binary[3] != 0x20) return error.InvalidDigestLength;

    return .{ .codec = codec, .hash = hash, .digest = binary[4..36].* };
}

fn decodeBase32(destination: []u8, encoded: []const u8) ParseError!void {
    var accumulator: u32 = 0;
    var bit_count: usize = 0;
    var output_index: usize = 0;

    for (encoded) |character| {
        const value: u5 = switch (character) {
            'a'...'z' => @intCast(character - 'a'),
            '2'...'7' => @intCast(character - '2' + 26),
            else => return error.InvalidEncoding,
        };
        accumulator = (accumulator << 5) | value;
        bit_count += 5;
        if (bit_count >= 8) {
            bit_count -= 8;
            if (output_index >= destination.len) return error.InvalidLength;
            destination[output_index] = @truncate(accumulator >> @intCast(bit_count));
            output_index += 1;
            if (bit_count == 0) {
                accumulator = 0;
            } else {
                accumulator &= (@as(u32, 1) << @intCast(bit_count)) - 1;
            }
        }
    }

    if (output_index != destination.len) return error.InvalidLength;
    // Unpadded base32 may leave zero padding bits, never information.
    if (accumulator != 0) return error.InvalidEncoding;
}

test "parse and verify a DASL raw CID" {
    const value = try parse("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
    try std.testing.expectEqual(Codec.raw, value.codec);
    try std.testing.expectEqual(Hash.sha256, value.hash);
    try std.testing.expect(value.verify(""));
    try std.testing.expect(!value.verify("not empty"));
}

test "parse the BDASL CID framing used by Streamplace" {
    // BLAKE3 of the empty input, wrapped as CIDv1/raw/blake3/32 bytes.
    const value = try parse("bafkr4ifpcne3t5pzugtkaqcn5i3nzskjtpfslsnnyejlpte2spfoihzsmi");
    try std.testing.expectEqual(Codec.raw, value.codec);
    try std.testing.expectEqual(Hash.blake3, value.hash);
    try std.testing.expect(value.verify(""));
}

test "reject non-canonical CID spellings" {
    try std.testing.expectError(error.InvalidEncoding, parse("Bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"));
    try std.testing.expectError(error.InvalidLength, parse("bafkblob"));
}
