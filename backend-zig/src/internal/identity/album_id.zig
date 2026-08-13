//! Stable REST identifiers for canonical ATProto album-list records.

const record_id = @import("record_id.zig");

pub const prefix = "alb_";

pub fn encodedLength(at_uri: []const u8) usize {
    return record_id.encodedLength(prefix, at_uri);
}

pub fn encode(destination: []u8, at_uri: []const u8) ![]const u8 {
    return record_id.encode(prefix, destination, at_uri);
}

pub fn decode(destination: []u8, id: []const u8) ![]const u8 {
    return record_id.decode(prefix, destination, id) catch |err| switch (err) {
        error.InvalidRecordId => error.InvalidAlbumId,
        else => |other| other,
    };
}
