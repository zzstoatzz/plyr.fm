//! Stable REST identifiers for canonical ATProto track records.
//!
//! The index's integer primary key is deliberately absent. A track ID is the
//! URL-safe, reversible encoding of its canonical AT-URI, so another index can
//! rebuild exactly the same identifier without coordinating with plyr.fm.

const std = @import("std");
const record_id = @import("record_id.zig");

pub const prefix = "trk_";
pub fn encodedLength(at_uri: []const u8) usize {
    return record_id.encodedLength(prefix, at_uri);
}

pub fn encode(destination: []u8, at_uri: []const u8) ![]const u8 {
    return record_id.encode(prefix, destination, at_uri);
}

pub fn decode(destination: []u8, id: []const u8) ![]const u8 {
    return record_id.decode(prefix, destination, id) catch |err| switch (err) {
        error.InvalidRecordId => error.InvalidTrackId,
        else => |other| other,
    };
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
