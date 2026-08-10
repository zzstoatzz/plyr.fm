//! Versioned plaintext formats that exist only inside authenticated envelopes.
//!
//! Keeping these formats independent of HTTP and PostgreSQL makes migrations
//! explicit and lets the OAuth adapter evolve without teaching storage about
//! credentials.

const std = @import("std");

pub const Request = struct {
    did: []const u8,
    handle: []const u8,
    pds_url: []const u8,
    issuer: []const u8,
    token_endpoint: []const u8,
    pkce_verifier: []const u8,
    dpop_secret: [32]u8,
    dpop_nonce: ?[]const u8,
};

pub const Credentials = struct {
    issuer: []const u8,
    token_endpoint: []const u8,
    pds_url: []const u8,
    access_token: []const u8,
    refresh_token: []const u8,
    scope: []const u8,
    dpop_secret: [32]u8,
    dpop_nonce: ?[]const u8,
};

const EncodedRequest = struct {
    version: u8,
    did: []const u8,
    handle: []const u8,
    pds_url: []const u8,
    issuer: []const u8,
    token_endpoint: []const u8,
    pkce_verifier: []const u8,
    dpop_secret: []const u8,
    dpop_nonce: ?[]const u8 = null,
};

const EncodedCredentials = struct {
    version: u8,
    issuer: []const u8,
    token_endpoint: []const u8,
    pds_url: []const u8,
    access_token: []const u8,
    refresh_token: []const u8,
    scope: []const u8,
    dpop_secret: []const u8,
    dpop_nonce: ?[]const u8 = null,
};

pub fn encodeRequest(allocator: std.mem.Allocator, value: Request) ![]u8 {
    const secret = try encodeKey(allocator, value.dpop_secret);
    defer allocator.free(secret);
    return stringify(allocator, EncodedRequest{
        .version = 1,
        .did = value.did,
        .handle = value.handle,
        .pds_url = value.pds_url,
        .issuer = value.issuer,
        .token_endpoint = value.token_endpoint,
        .pkce_verifier = value.pkce_verifier,
        .dpop_secret = secret,
        .dpop_nonce = value.dpop_nonce,
    });
}

pub fn decodeRequest(allocator: std.mem.Allocator, bytes: []const u8) !Request {
    const encoded = try std.json.parseFromSliceLeaky(
        EncodedRequest,
        allocator,
        bytes,
        .{ .ignore_unknown_fields = false },
    );
    if (encoded.version != 1) return error.UnsupportedVersion;
    return .{
        .did = encoded.did,
        .handle = encoded.handle,
        .pds_url = encoded.pds_url,
        .issuer = encoded.issuer,
        .token_endpoint = encoded.token_endpoint,
        .pkce_verifier = encoded.pkce_verifier,
        .dpop_secret = try decodeKey(encoded.dpop_secret),
        .dpop_nonce = encoded.dpop_nonce,
    };
}

pub fn encodeCredentials(allocator: std.mem.Allocator, value: Credentials) ![]u8 {
    const secret = try encodeKey(allocator, value.dpop_secret);
    defer allocator.free(secret);
    return stringify(allocator, EncodedCredentials{
        .version = 1,
        .issuer = value.issuer,
        .token_endpoint = value.token_endpoint,
        .pds_url = value.pds_url,
        .access_token = value.access_token,
        .refresh_token = value.refresh_token,
        .scope = value.scope,
        .dpop_secret = secret,
        .dpop_nonce = value.dpop_nonce,
    });
}

pub fn decodeCredentials(allocator: std.mem.Allocator, bytes: []const u8) !Credentials {
    const encoded = try std.json.parseFromSliceLeaky(
        EncodedCredentials,
        allocator,
        bytes,
        .{ .ignore_unknown_fields = false },
    );
    if (encoded.version != 1) return error.UnsupportedVersion;
    return .{
        .issuer = encoded.issuer,
        .token_endpoint = encoded.token_endpoint,
        .pds_url = encoded.pds_url,
        .access_token = encoded.access_token,
        .refresh_token = encoded.refresh_token,
        .scope = encoded.scope,
        .dpop_secret = try decodeKey(encoded.dpop_secret),
        .dpop_nonce = encoded.dpop_nonce,
    };
}

fn stringify(allocator: std.mem.Allocator, value: anytype) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn encodeKey(allocator: std.mem.Allocator, key: [32]u8) ![]u8 {
    const encoder = std.base64.standard.Encoder;
    const encoded = try allocator.alloc(u8, encoder.calcSize(key.len));
    _ = encoder.encode(encoded, &key);
    return encoded;
}

fn decodeKey(encoded: []const u8) ![32]u8 {
    const decoder = std.base64.standard.Decoder;
    const length = decoder.calcSizeForSlice(encoded) catch return error.InvalidKey;
    if (length != 32) return error.InvalidKey;
    var key: [32]u8 = undefined;
    decoder.decode(&key, encoded) catch return error.InvalidKey;
    return key;
}

test "OAuth request and session credentials have strict versioned formats" {
    const request_json = try encodeRequest(std.testing.allocator, .{
        .did = "did:plc:test",
        .handle = "test.example",
        .pds_url = "https://pds.example",
        .issuer = "https://auth.example",
        .token_endpoint = "https://auth.example/oauth/token",
        .pkce_verifier = "verifier",
        .dpop_secret = .{0x42} ** 32,
        .dpop_nonce = "nonce",
    });
    defer std.testing.allocator.free(request_json);
    const request = try decodeRequest(std.testing.allocator, request_json);
    try std.testing.expectEqualStrings("did:plc:test", request.did);
    try std.testing.expectEqual([_]u8{0x42} ** 32, request.dpop_secret);
    try std.testing.expectEqualStrings("nonce", request.dpop_nonce.?);

    const credentials_json = try encodeCredentials(std.testing.allocator, .{
        .issuer = "https://auth.example",
        .token_endpoint = "https://auth.example/oauth/token",
        .pds_url = "https://pds.example",
        .access_token = "access",
        .refresh_token = "refresh",
        .scope = "atproto transition:generic",
        .dpop_secret = .{0x24} ** 32,
        .dpop_nonce = null,
    });
    defer std.testing.allocator.free(credentials_json);
    const credentials = try decodeCredentials(std.testing.allocator, credentials_json);
    try std.testing.expectEqualStrings("refresh", credentials.refresh_token);
    try std.testing.expectEqual([_]u8{0x24} ** 32, credentials.dpop_secret);
    try std.testing.expect(credentials.dpop_nonce == null);
}

test "OAuth state rejects unknown versions and malformed private keys" {
    try std.testing.expectError(
        error.UnsupportedVersion,
        decodeRequest(std.testing.allocator,
            \\{"version":2,"did":"did:plc:x","handle":"x.test","pds_url":"https://pds.test","issuer":"https://auth.test","token_endpoint":"https://auth.test/token","pkce_verifier":"v","dpop_secret":"QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI="}
        ),
    );
    try std.testing.expectError(
        error.InvalidKey,
        decodeRequest(std.testing.allocator,
            \\{"version":1,"did":"did:plc:x","handle":"x.test","pds_url":"https://pds.test","issuer":"https://auth.test","token_endpoint":"https://auth.test/token","pkce_verifier":"v","dpop_secret":"c2hvcnQ="}
        ),
    );
}
