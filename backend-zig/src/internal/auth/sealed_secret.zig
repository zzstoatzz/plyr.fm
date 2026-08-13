//! Versioned authenticated encryption for OAuth and session credential blobs.
//!
//! The database never receives bearer tokens, PKCE verifiers, refresh tokens,
//! or DPoP private keys in plaintext. A purpose string is authenticated as
//! associated data so a blob from one table/column cannot be replayed as
//! another kind of secret.

const std = @import("std");

const Aead = std.crypto.aead.chacha_poly.XChaCha20Poly1305;
const format_version: u8 = 1;
const header_length = 1 + Aead.nonce_length;
const overhead = header_length + Aead.tag_length;

pub const Key = [Aead.key_length]u8;

pub fn parseKey(encoded: []const u8) !Key {
    const decoder = std.base64.standard.Decoder;
    const decoded_len = decoder.calcSizeForSlice(encoded) catch return error.InvalidKeyEncoding;
    if (decoded_len != Aead.key_length) return error.InvalidKeyLength;
    var key: Key = undefined;
    decoder.decode(&key, encoded) catch return error.InvalidKeyEncoding;
    return key;
}

pub fn seal(
    allocator: std.mem.Allocator,
    io: std.Io,
    key: Key,
    purpose: []const u8,
    plaintext: []const u8,
) ![]u8 {
    const output = try allocator.alloc(u8, plaintext.len + overhead);
    errdefer allocator.free(output);

    output[0] = format_version;
    var nonce: [Aead.nonce_length]u8 = undefined;
    io.random(&nonce);
    @memcpy(output[1..header_length], &nonce);

    const ciphertext = output[header_length .. output.len - Aead.tag_length];
    const tag: *[Aead.tag_length]u8 = @ptrCast(output[output.len - Aead.tag_length ..].ptr);
    Aead.encrypt(ciphertext, tag, plaintext, purpose, nonce, key);
    return output;
}

pub fn open(
    allocator: std.mem.Allocator,
    key: Key,
    purpose: []const u8,
    envelope: []const u8,
) ![]u8 {
    if (envelope.len < overhead) return error.InvalidEnvelope;
    if (envelope[0] != format_version) return error.UnsupportedVersion;

    const nonce: [Aead.nonce_length]u8 = envelope[1..header_length][0..Aead.nonce_length].*;
    const ciphertext = envelope[header_length .. envelope.len - Aead.tag_length];
    const tag: [Aead.tag_length]u8 = envelope[envelope.len - Aead.tag_length ..][0..Aead.tag_length].*;
    const plaintext = try allocator.alloc(u8, ciphertext.len);
    errdefer allocator.free(plaintext);
    Aead.decrypt(plaintext, ciphertext, tag, purpose, nonce, key) catch
        return error.AuthenticationFailed;
    return plaintext;
}

test "sealed secrets round trip only for their authenticated purpose" {
    const key: Key = .{0x42} ** Aead.key_length;
    const envelope = try seal(
        std.testing.allocator,
        std.Options.debug_io,
        key,
        "plyr/auth/session/v1",
        "refresh-token and dpop-private-key",
    );
    defer std.testing.allocator.free(envelope);

    const plaintext = try open(
        std.testing.allocator,
        key,
        "plyr/auth/session/v1",
        envelope,
    );
    defer std.testing.allocator.free(plaintext);
    try std.testing.expectEqualStrings("refresh-token and dpop-private-key", plaintext);
    try std.testing.expectError(
        error.AuthenticationFailed,
        open(std.testing.allocator, key, "plyr/auth/request/v1", envelope),
    );
}

test "sealed secrets reject tampering, truncation, and unknown versions" {
    const key: Key = .{0x24} ** Aead.key_length;
    var envelope = try seal(
        std.testing.allocator,
        std.Options.debug_io,
        key,
        "plyr/auth/session/v1",
        "credential",
    );
    defer std.testing.allocator.free(envelope);

    envelope[header_length] ^= 1;
    try std.testing.expectError(
        error.AuthenticationFailed,
        open(std.testing.allocator, key, "plyr/auth/session/v1", envelope),
    );
    try std.testing.expectError(
        error.InvalidEnvelope,
        open(std.testing.allocator, key, "plyr/auth/session/v1", envelope[0 .. overhead - 1]),
    );
    envelope[0] = 2;
    try std.testing.expectError(
        error.UnsupportedVersion,
        open(std.testing.allocator, key, "plyr/auth/session/v1", envelope),
    );
}

test "encryption key is exactly 32 standard-base64 bytes" {
    try std.testing.expectEqual(
        [_]u8{0x42} ** Aead.key_length,
        try parseKey("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI="),
    );
    try std.testing.expectError(error.InvalidKeyLength, parseKey("c2hvcnQ="));
    try std.testing.expectError(error.InvalidKeyEncoding, parseKey("not base64"));
}
