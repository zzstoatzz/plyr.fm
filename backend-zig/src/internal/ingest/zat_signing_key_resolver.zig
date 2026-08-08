//! DID-document signing-key resolution through Zat.

const std = @import("std");
const zat = @import("zat");
const signing_key = @import("signing_key.zig");

pub const ZatSigningKeyResolver = struct {
    resolver: *zat.DidResolver,

    pub fn port(self: *ZatSigningKeyResolver) signing_key.Resolver {
        return .{ .context = self, .resolve_fn = resolveOpaque };
    }

    fn resolveOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        did_text: []const u8,
        refresh: bool,
    ) signing_key.Error!signing_key.Key {
        const self: *ZatSigningKeyResolver = @ptrCast(@alignCast(context));
        _ = refresh; // This uncached adapter always performs a fresh resolution.
        const did = zat.Did.parse(did_text) orelse return error.InvalidIdentity;
        var document = self.resolver.resolve(did) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.IdentityUnavailable,
        };
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text)) return error.InvalidIdentity;
        const method = document.signingKey() orelse return error.InvalidSigningKey;
        if (!validSigningMethod(did_text, method.id, method.controller))
            return error.InvalidSigningKey;
        const decoded = zat.multibase.decode(allocator, method.public_key_multibase) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.InvalidSigningKey,
        };
        errdefer allocator.free(decoded);
        const key = zat.multicodec.parsePublicKey(decoded) catch
            return error.InvalidSigningKey;
        if (key.raw.len == 0 or key.raw.len > 33) return error.InvalidSigningKey;
        // `parsePublicKey` borrows the multicodec payload within `decoded`.
        // Move only that payload into a compact caller-owned allocation.
        const owned = allocator.dupe(u8, key.raw) catch return error.OutOfMemory;
        allocator.free(decoded);
        return .{ .key_type = key.key_type, .raw = owned };
    }
};

fn validSigningMethod(did: []const u8, method_id: []const u8, controller: []const u8) bool {
    return std.mem.eql(u8, controller, did) and
        method_id.len == did.len + "#atproto".len and
        std.mem.startsWith(u8, method_id, did) and
        std.mem.endsWith(u8, method_id, "#atproto");
}

test "ATProto signing methods are bound to the resolved DID" {
    try std.testing.expect(validSigningMethod(
        "did:plc:alice",
        "did:plc:alice#atproto",
        "did:plc:alice",
    ));
    try std.testing.expect(!validSigningMethod(
        "did:plc:alice",
        "did:plc:mallory#atproto",
        "did:plc:alice",
    ));
    try std.testing.expect(!validSigningMethod(
        "did:plc:alice",
        "did:plc:alice#atproto",
        "did:plc:mallory",
    ));
}
