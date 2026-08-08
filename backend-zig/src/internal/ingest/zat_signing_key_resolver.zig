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
        const method = document.signingKey() orelse return error.InvalidSigningKey;
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
