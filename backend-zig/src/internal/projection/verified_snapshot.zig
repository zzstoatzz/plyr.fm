//! Authenticated complete-repository snapshot ready for atomic reconciliation.

const std = @import("std");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const track_change = @import("track_change.zig");
const profile_change = @import("profile_change.zig");
const like_change = @import("like_change.zig");
const record_rejection = @import("record_rejection.zig");

pub const Snapshot = struct {
    repo_did: []const u8,
    commit_rev: []const u8,
    commit_cid: zat.Cid,
    data_cid: zat.Cid,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    indexed_at_us: i64,
    list_changes: []const list_change.Change,
    track_changes: []const track_change.Change = &.{},
    profile_changes: []const profile_change.Change = &.{},
    like_changes: []const like_change.Change = &.{},
    rejections: []const record_rejection.Rejection = &.{},

    pub fn validate(self: Snapshot) Error!void {
        if (zat.Did.parse(self.repo_did) == null or
            zat.Tid.parse(self.commit_rev) == null or
            zat.Nsid.parse(self.list_collection) == null or
            zat.Nsid.parse(self.track_collection) == null or
            zat.Nsid.parse(self.profile_collection) == null or
            zat.Nsid.parse(self.like_collection) == null or
            self.indexed_at_us < 0) return error.InvalidSnapshot;
        try validateDagCborCid(self.commit_cid);
        try validateDagCborCid(self.data_cid);
        for (self.list_changes, 0..) |change, index| {
            const upsert = switch (change) {
                .upsert => |value| value,
                .delete => return error.InvalidSnapshot,
            };
            if (!std.mem.eql(u8, upsert.owner_did, self.repo_did) or
                !std.mem.eql(u8, upsert.collection, self.list_collection) or
                !std.mem.eql(u8, upsert.proof.commit_rev, self.commit_rev) or
                upsert.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, upsert.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidSnapshot;
            for (self.list_changes[0..index]) |prior| {
                const prior_uri = switch (prior) {
                    .upsert => |value| value.record_uri,
                    .delete => return error.InvalidSnapshot,
                };
                if (std.mem.eql(u8, upsert.record_uri, prior_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.track_changes, 0..) |change, index| {
            const upsert = switch (change) {
                .upsert => |value| value,
                .delete => return error.InvalidSnapshot,
            };
            if (!std.mem.eql(u8, upsert.owner_did, self.repo_did) or
                !std.mem.eql(u8, upsert.collection, self.track_collection) or
                !std.mem.eql(u8, upsert.proof.commit_rev, self.commit_rev) or
                upsert.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, upsert.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidSnapshot;
            for (self.track_changes[0..index]) |prior| {
                const prior_uri = switch (prior) {
                    .upsert => |value| value.record_uri,
                    .delete => return error.InvalidSnapshot,
                };
                if (std.mem.eql(u8, upsert.record_uri, prior_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.profile_changes, 0..) |change, index| {
            const upsert = switch (change) {
                .upsert => |value| value,
                .delete => return error.InvalidSnapshot,
            };
            if (!std.mem.eql(u8, upsert.owner_did, self.repo_did) or
                !std.mem.eql(u8, upsert.collection, self.profile_collection) or
                !std.mem.eql(u8, upsert.rkey, "self") or
                !std.mem.eql(u8, upsert.proof.commit_rev, self.commit_rev) or
                upsert.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, upsert.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidSnapshot;
            for (self.profile_changes[0..index]) |prior| {
                const prior_uri = switch (prior) {
                    .upsert => |value| value.record_uri,
                    .delete => return error.InvalidSnapshot,
                };
                if (std.mem.eql(u8, upsert.record_uri, prior_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.like_changes, 0..) |change, index| {
            const upsert = switch (change) {
                .upsert => |value| value,
                .delete => return error.InvalidSnapshot,
            };
            if (!std.mem.eql(u8, upsert.owner_did, self.repo_did) or
                !std.mem.eql(u8, upsert.collection, self.like_collection) or
                !std.mem.eql(u8, upsert.proof.commit_rev, self.commit_rev) or
                upsert.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, upsert.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidSnapshot;
            for (self.like_changes[0..index]) |prior| {
                const prior_uri = switch (prior) {
                    .upsert => |value| value.record_uri,
                    .delete => return error.InvalidSnapshot,
                };
                if (std.mem.eql(u8, upsert.record_uri, prior_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.rejections, 0..) |rejection, index| {
            rejection.validate() catch return error.InvalidSnapshot;
            if (!std.mem.eql(u8, rejection.owner_did, self.repo_did) or
                (!std.mem.eql(u8, rejection.collection, self.list_collection) and
                    !std.mem.eql(u8, rejection.collection, self.track_collection) and
                    !std.mem.eql(u8, rejection.collection, self.profile_collection) and
                    !std.mem.eql(u8, rejection.collection, self.like_collection)) or
                !std.mem.eql(u8, rejection.proof.commit_rev, self.commit_rev) or
                rejection.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, rejection.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidSnapshot;
            for (self.rejections[0..index]) |prior| {
                if (std.mem.eql(u8, rejection.record_uri, prior.record_uri))
                    return error.DuplicateRecord;
            }
            if (containsProjectedUri(self, rejection.record_uri)) return error.DuplicateRecord;
        }
    }
};

pub const ApplyResult = enum { applied, idempotent, stale };

pub const Store = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, Snapshot) Error!ApplyResult,

    pub fn apply(
        self: Store,
        allocator: std.mem.Allocator,
        snapshot: Snapshot,
    ) Error!ApplyResult {
        try snapshot.validate();
        return self.apply_fn(self.context, allocator, snapshot);
    }
};

pub const Error = error{
    InvalidSnapshot,
    DuplicateRecord,
    RevisionConflict,
    CorruptProjection,
    ProjectionUnavailable,
    OutOfMemory,
};

fn validateDagCborCid(cid: zat.Cid) Error!void {
    const parsed = zat.Cid.fromBytes(cid.raw) catch return error.InvalidSnapshot;
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidSnapshot;
}

fn containsProjectedUri(snapshot: Snapshot, uri: []const u8) bool {
    for (snapshot.list_changes) |change| if (std.mem.eql(
        u8,
        change.upsert.record_uri,
        uri,
    )) return true;
    for (snapshot.track_changes) |change| if (std.mem.eql(
        u8,
        change.upsert.record_uri,
        uri,
    )) return true;
    for (snapshot.profile_changes) |change| if (std.mem.eql(
        u8,
        change.upsert.record_uri,
        uri,
    )) return true;
    for (snapshot.like_changes) |change| if (std.mem.eql(
        u8,
        change.upsert.record_uri,
        uri,
    )) return true;
    return false;
}

test "complete snapshot accepts only unique upserts with one proof" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commit = try zat.Cid.forDagCbor(a, "commit");
    const root = try zat.Cid.forDagCbor(a, "root");
    const change: list_change.Change = .{ .upsert = .{
        .record_uri = "at://did:plc:a/fm.plyr.dev.list/r",
        .record_cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        .owner_did = "did:plc:a",
        .collection = "fm.plyr.dev.list",
        .rkey = "r",
        .list_type = .album,
        .name = null,
        .created_at = "2026-08-08T12:00:00Z",
        .updated_at = null,
        .members = &.{},
        .proof = .{
            .commit_cid = commit,
            .commit_rev = "3jqfcqzm3fo2j",
            .indexed_at_us = 1,
        },
    } };
    const snapshot: Snapshot = .{
        .repo_did = "did:plc:a",
        .commit_rev = "3jqfcqzm3fo2j",
        .commit_cid = commit,
        .data_cid = root,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .like_collection = "fm.plyr.dev.like",
        .indexed_at_us = 1,
        .list_changes = &.{change},
    };
    try snapshot.validate();
    var duplicate = snapshot;
    duplicate.list_changes = &.{ change, change };
    try std.testing.expectError(error.DuplicateRecord, duplicate.validate());
}
