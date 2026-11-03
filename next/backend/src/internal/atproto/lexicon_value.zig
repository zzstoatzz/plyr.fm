//! Shared validation for AT Protocol Lexicon scalar formats.

const std = @import("std");
const zat = @import("zat");

/// Decode the `cid` of a `com.atproto.repo.strongRef`. The lexicon types it
/// as `string` with `format: cid`, so in DAG-CBOR it is a text string, not a
/// tag-42 CID link. Only dag-cbor record CIDs are accepted.
pub fn strongRefCid(
    allocator: std.mem.Allocator,
    subject: zat.cbor.Value,
) error{ InvalidCid, OutOfMemory }!zat.Cid {
    const text = subject.getString("cid") orelse return error.InvalidCid;
    const cid = zat.Cid.fromString(allocator, text) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidCid,
    };
    if (cid.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidCid;
    return cid;
}

pub fn validUri(value: []const u8) bool {
    if (!std.unicode.utf8ValidateSlice(value) or value.len == 0) return false;
    if (std.Uri.parse(value)) |uri| return uri.scheme.len != 0 else |_| {}
    // std.Uri reads `did:plc:x` in `at://did:plc:x/...` as host:port
    return atprotoUriSyntax(value);
}

/// The atproto interop fixtures' `uri` grammar: a lowercase scheme of at
/// most 81 characters, then printable non-space ASCII.
fn atprotoUriSyntax(value: []const u8) bool {
    if (value.len > 8192) return false;
    const colon = std.mem.indexOfScalar(u8, value, ':') orelse return false;
    if (colon == 0 or colon > 81 or colon + 1 == value.len) return false;
    if (!std.ascii.isLower(value[0])) return false;
    for (value[1..colon]) |c| if (!std.ascii.isLower(c) and c != '.' and c != '-') return false;
    for (value[colon + 1 ..]) |c| if (c < 0x21 or c > 0x7e) return false;
    return true;
}

/// RFC 3339's Internet profile as atproto pins it, through zat's parser,
/// which passes the atproto interop fixtures.
pub fn validDatetime(value: []const u8) bool {
    return zat.Datetime.parse(value) != null;
}

test "datetime uses the ATProto RFC 3339 profile" {
    try std.testing.expect(validDatetime("0000-01-01T00:00:00.000Z"));
    try std.testing.expect(validDatetime("1985-04-12T23:20:50.123+01:45"));
    try std.testing.expect(!validDatetime("1985-04-12t23:20:50.123Z"));
    try std.testing.expect(!validDatetime("1985-04-12T23:20:50.123z"));
    try std.testing.expect(!validDatetime("1985-04-12T23:20:50.123-00:00"));
    try std.testing.expect(!validDatetime("2025-02-29T00:00:00Z"));
}

test "datetime follows the reference parser at year zero and in length" {
    try std.testing.expect(validDatetime("0000-01-01T00:00:00+00:00"));
    try std.testing.expect(validDatetime("0000-06-01T00:00:00+01:00"));
    try std.testing.expect(!validDatetime("0000-01-01T00:00:00+01:00"));
    try std.testing.expect(!validDatetime("0001-01-01T00:00:00.00000000000000000000000000000000000000000000Z"));
}

test "URI format requires an absolute valid UTF-8 URI" {
    try std.testing.expect(validUri("https://media.example/avatar.png"));
    try std.testing.expect(validUri("did:plc:alice"));
    try std.testing.expect(!validUri("/relative/avatar.png"));
    try std.testing.expect(!validUri("\xff"));
}

test "URI format accepts AT-URIs with a DID authority" {
    try std.testing.expect(validUri("at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.dev.track/3m123abc"));
    try std.testing.expect(validUri("at://did:web:example.com/app.bsky.actor.profile/self"));
    try std.testing.expect(validUri("at://handle.example.com/nsid/rkey"));
    try std.testing.expect(!validUri("//example.com"));
    try std.testing.expect(!validUri("at://did:plc:a/b c"));
}
