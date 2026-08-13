//! Reversible REST identifiers for canonical ATProto records.
//!
//! Resource-specific wrappers supply a short prefix (`trk_`, `alb_`, ...),
//! while the payload is always the complete canonical record AT-URI. This
//! keeps IDs stable across projection rebuilds without making every resource
//! duplicate the validation and base64url codec.

const std = @import("std");
const zat = @import("zat");

const encoder = std.base64.url_safe_no_pad.Encoder;
const decoder = std.base64.url_safe_no_pad.Decoder;

pub fn encodedLength(prefix: []const u8, at_uri: []const u8) usize {
    return prefix.len + encoder.calcSize(at_uri.len);
}

pub fn encode(prefix: []const u8, destination: []u8, at_uri: []const u8) ![]const u8 {
    try validateRecordUri(at_uri);
    const required = encodedLength(prefix, at_uri);
    if (destination.len < required) return error.NoSpaceLeft;

    @memcpy(destination[0..prefix.len], prefix);
    _ = encoder.encode(destination[prefix.len..required], at_uri);
    return destination[0..required];
}

pub fn decode(prefix: []const u8, destination: []u8, id: []const u8) ![]const u8 {
    if (!std.mem.startsWith(u8, id, prefix)) return error.InvalidRecordId;
    const payload = id[prefix.len..];
    const required = decoder.calcSizeForSlice(payload) catch return error.InvalidRecordId;
    if (destination.len < required) return error.NoSpaceLeft;
    decoder.decode(destination[0..required], payload) catch return error.InvalidRecordId;

    const at_uri = destination[0..required];
    validateRecordUri(at_uri) catch return error.InvalidRecordId;
    return at_uri;
}

fn validateRecordUri(uri: []const u8) !void {
    const parsed = zat.AtUri.parse(uri) orelse return error.InvalidAtUri;
    if (!parsed.hasRkey()) return error.RecordUriRequired;
    if (zat.Did.parse(parsed.authority()) == null) return error.DidAuthorityRequired;
}

test "resource prefixes share one canonical record identifier codec" {
    const uri = "at://did:plc:artist/fm.plyr.list/3m123abc";
    var id_buffer: [256]u8 = undefined;
    const id = try encode("alb_", &id_buffer, uri);
    try std.testing.expect(std.mem.startsWith(u8, id, "alb_"));
    try std.testing.expect(std.mem.indexOfAny(u8, id, "/+=") == null);

    var uri_buffer: [256]u8 = undefined;
    try std.testing.expectEqualStrings(uri, try decode("alb_", &uri_buffer, id));
    try std.testing.expectError(error.InvalidRecordId, decode("trk_", &uri_buffer, id));
}
