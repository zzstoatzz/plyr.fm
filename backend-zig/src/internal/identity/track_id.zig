//! Stable REST identifiers for canonical ATProto track records.
//!
//! The index's integer primary key is deliberately absent. A track ID is the
//! URL-safe, reversible encoding of its canonical AT-URI, so another index can
//! rebuild exactly the same identifier without coordinating with plyr.fm.

const std = @import("std");
const zat = @import("zat");

pub const prefix = "trk_";
const encoder = std.base64.url_safe_no_pad.Encoder;
const decoder = std.base64.url_safe_no_pad.Decoder;

pub fn encodedLength(at_uri: []const u8) usize {
    return prefix.len + encoder.calcSize(at_uri.len);
}

pub fn encode(destination: []u8, at_uri: []const u8) ![]const u8 {
    const parsed = zat.AtUri.parse(at_uri) orelse return error.InvalidAtUri;
    if (!parsed.hasRkey()) return error.RecordUriRequired;
    if (zat.Did.parse(parsed.authority()) == null) return error.DidAuthorityRequired;
    const required = encodedLength(at_uri);
    if (destination.len < required) return error.NoSpaceLeft;

    @memcpy(destination[0..prefix.len], prefix);
    _ = encoder.encode(destination[prefix.len..required], at_uri);
    return destination[0..required];
}

pub fn decode(destination: []u8, id: []const u8) ![]const u8 {
    if (!std.mem.startsWith(u8, id, prefix)) return error.InvalidTrackId;
    const payload = id[prefix.len..];
    const required = decoder.calcSizeForSlice(payload) catch return error.InvalidTrackId;
    if (destination.len < required) return error.NoSpaceLeft;
    decoder.decode(destination[0..required], payload) catch return error.InvalidTrackId;

    const at_uri = destination[0..required];
    const parsed = zat.AtUri.parse(at_uri) orelse return error.InvalidTrackId;
    if (!parsed.hasRkey()) return error.InvalidTrackId;
    if (zat.Did.parse(parsed.authority()) == null) return error.InvalidTrackId;
    return at_uri;
}

test "track IDs round trip a canonical record URI" {
    const uri = "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.dev.track/3m123abc";
    var id_buffer: [256]u8 = undefined;
    const id = try encode(&id_buffer, uri);
    try std.testing.expect(std.mem.startsWith(u8, id, prefix));
    try std.testing.expect(std.mem.indexOfAny(u8, id, "/+=") == null);

    var uri_buffer: [256]u8 = undefined;
    try std.testing.expectEqualStrings(uri, try decode(&uri_buffer, id));
}

test "track IDs reject database IDs and non-record AT-URIs" {
    var buffer: [256]u8 = undefined;
    try std.testing.expectError(error.InvalidTrackId, decode(&buffer, "42"));
    try std.testing.expectError(
        error.RecordUriRequired,
        encode(&buffer, "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.track"),
    );
    try std.testing.expectError(
        error.DidAuthorityRequired,
        encode(&buffer, "at://artist.example/fm.plyr.track/3m123abc"),
    );
}
