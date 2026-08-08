//! Port for resolving the current ATProto repository signing key.

const std = @import("std");
const zat = @import("zat");

pub const Key = struct {
    /// Borrows from the allocator passed to `Resolver.resolve`. Runtime
    /// callers use a request arena and release the complete arena afterward.
    key_type: zat.multicodec.KeyType,
    raw: []const u8,

    pub fn publicKey(self: Key) zat.multicodec.PublicKey {
        return .{ .key_type = self.key_type, .raw = self.raw };
    }
};

pub const Resolver = struct {
    context: *anyopaque,
    resolve_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        []const u8,
        bool,
    ) Error!Key,

    /// `refresh` bypasses any adapter cache after a signature mismatch.
    pub fn resolve(
        self: Resolver,
        allocator: std.mem.Allocator,
        did: []const u8,
        refresh: bool,
    ) Error!Key {
        if (zat.Did.parse(did) == null) return error.InvalidIdentity;
        const key = try self.resolve_fn(self.context, allocator, did, refresh);
        if (key.raw.len == 0 or key.raw.len > 33) return error.InvalidSigningKey;
        return key;
    }
};

pub const Error = error{
    InvalidIdentity,
    InvalidSigningKey,
    IdentityUnavailable,
    OutOfMemory,
};
