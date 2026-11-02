//! Read-only port for the last authenticated repository state.

const std = @import("std");
const zat = @import("zat");

pub const Head = struct {
    repo_did: []const u8,
    commit_rev: []const u8,
    commit_cid: zat.Cid,
    data_cid: zat.Cid,
    indexed_at_us: i64,

    pub fn validate(self: Head) Error!void {
        if (zat.Did.parse(self.repo_did) == null or
            zat.Tid.parse(self.commit_rev) == null or
            self.indexed_at_us < 0) return error.CorruptProjection;
        try validateDagCborCid(self.commit_cid);
        try validateDagCborCid(self.data_cid);
    }
};

pub const Reader = struct {
    context: *anyopaque,
    load_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!?Head,

    pub fn load(
        self: Reader,
        allocator: std.mem.Allocator,
        repo_did: []const u8,
    ) Error!?Head {
        if (zat.Did.parse(repo_did) == null) return error.InvalidIdentity;
        const head = try self.load_fn(self.context, allocator, repo_did);
        if (head) |value| {
            try value.validate();
            if (!std.mem.eql(u8, value.repo_did, repo_did))
                return error.CorruptProjection;
        }
        return head;
    }
};

pub const Error = error{
    InvalidIdentity,
    CorruptProjection,
    ProjectionUnavailable,
    OutOfMemory,
};

fn validateDagCborCid(cid: zat.Cid) Error!void {
    const parsed = zat.Cid.fromBytes(cid.raw) catch return error.CorruptProjection;
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.CorruptProjection;
}

test "repository head reader validates identity and returned authority" {
    const Fake = struct {
        head: ?Head,

        fn reader(self: *@This()) Reader {
            return .{ .context = self, .load_fn = load };
        }

        fn load(
            context: *anyopaque,
            _: std.mem.Allocator,
            _: []const u8,
        ) Error!?Head {
            const self: *@This() = @ptrCast(@alignCast(context));
            return self.head;
        }
    };
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commit = try zat.Cid.forDagCbor(a, "commit");
    const data = try zat.Cid.forDagCbor(a, "data");
    var fake: Fake = .{ .head = .{
        .repo_did = "did:plc:a",
        .commit_rev = "3jqfcqzm3fo2j",
        .commit_cid = commit,
        .data_cid = data,
        .indexed_at_us = 1,
    } };
    _ = try fake.reader().load(a, "did:plc:a");
    try std.testing.expectError(
        error.CorruptProjection,
        fake.reader().load(a, "did:plc:b"),
    );
    try std.testing.expectError(
        error.InvalidIdentity,
        fake.reader().load(a, "not-a-did"),
    );
}
