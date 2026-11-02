//! Durable idempotency keys for PDS record-creation commands.
//!
//! This is operational state, not appview content: it reserves the TID and
//! authored timestamp needed to replay an uncertain `putRecord` safely. The
//! PDS remains authoritative for whether the record exists and the verified
//! repository projection remains authoritative for reads.

const std = @import("std");

pub const Digest = [32]u8;

pub const Reservation = struct {
    rkey: []const u8,
    created_at: []const u8,

    pub fn deinit(self: *Reservation, allocator: std.mem.Allocator) void {
        allocator.free(self.rkey);
        allocator.free(self.created_at);
        self.* = undefined;
    }
};

pub const Candidate = struct {
    actor_did: []const u8,
    collection: []const u8,
    operation_digest: Digest,
    rkey: []const u8,
    created_at: []const u8,
};

pub const Key = struct {
    actor_did: []const u8,
    collection: []const u8,
    operation_digest: Digest,
};

pub const Store = struct {
    context: *anyopaque,
    reserve_fn: *const fn (*anyopaque, std.mem.Allocator, Candidate) anyerror!Reservation,
    get_fn: *const fn (*anyopaque, std.mem.Allocator, Key) anyerror!?Reservation,
    release_fn: *const fn (*anyopaque, Key, []const u8) anyerror!bool,

    pub fn reserve(
        self: Store,
        allocator: std.mem.Allocator,
        candidate: Candidate,
    ) !Reservation {
        return self.reserve_fn(self.context, allocator, candidate);
    }

    pub fn get(
        self: Store,
        allocator: std.mem.Allocator,
        key: Key,
    ) !?Reservation {
        return self.get_fn(self.context, allocator, key);
    }

    pub fn release(self: Store, key: Key, rkey: []const u8) !bool {
        return self.release_fn(self.context, key, rkey);
    }
};

pub fn digest(parts: []const []const u8) Digest {
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    for (parts) |part| {
        var length: [8]u8 = undefined;
        std.mem.writeInt(u64, &length, part.len, .big);
        hasher.update(&length);
        hasher.update(part);
    }
    var value: Digest = undefined;
    hasher.final(&value);
    return value;
}

test "operation digests are framed rather than ambiguously concatenated" {
    try std.testing.expect(!std.mem.eql(
        u8,
        &digest(&.{ "ab", "c" }),
        &digest(&.{ "a", "bc" }),
    ));
    try std.testing.expectEqual(digest(&.{ "subject", "cid" }), digest(&.{ "subject", "cid" }));
}
