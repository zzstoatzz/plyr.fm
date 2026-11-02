//! Account identifier accepted at the browser-login boundary.
//!
//! ATProto OAuth starts from either a handle or a DID. Keeping that distinction
//! explicit prevents handle-only assumptions from leaking into discovery while
//! still giving admission control one canonical subject key.

const std = @import("std");
const zat = @import("zat");

pub const Identifier = union(enum) {
    handle: []const u8,
    did: []const u8,

    pub fn text(self: Identifier) []const u8 {
        return switch (self) {
            .handle => |value| value,
            .did => |value| value,
        };
    }
};

pub fn parse(allocator: std.mem.Allocator, raw: []const u8) !Identifier {
    if (zat.Did.parse(raw)) |did| {
        return switch (did.method()) {
            .plc, .web => .{ .did = raw },
            .other => error.InvalidLoginIdentifier,
        };
    }
    if (raw.len == 0 or raw.len > zat.Handle.max_length or
        zat.Handle.parse(raw) == null)
        return error.InvalidLoginIdentifier;
    const normalized = try allocator.alloc(u8, raw.len);
    for (raw, normalized) |source, *destination|
        destination.* = std.ascii.toLower(source);
    return .{ .handle = normalized };
}

test "login identifiers preserve DIDs and canonicalize handles" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const handle = try parse(allocator, "Artist.Example");
    try std.testing.expectEqualStrings("artist.example", handle.handle);
    try std.testing.expectEqualStrings("artist.example", handle.text());

    const did = try parse(allocator, "did:plc:AbC123");
    try std.testing.expectEqualStrings("did:plc:AbC123", did.did);
    try std.testing.expectEqualStrings("did:plc:AbC123", did.text());

    try std.testing.expectError(
        error.InvalidLoginIdentifier,
        parse(allocator, "did:example:unsupported"),
    );
    try std.testing.expectError(
        error.InvalidLoginIdentifier,
        parse(allocator, "not-an-identifier"),
    );
}
