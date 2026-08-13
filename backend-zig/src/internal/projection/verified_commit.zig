//! Storage-independent transaction boundary for an authenticated repo commit.
//!
//! Construction is allowed only after the signed commit, MST transition,
//! envelope fields, and every operation CID have been verified. Persistence
//! then applies all selected projection changes and advances the verified repo
//! head atomically.

const std = @import("std");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const track_change = @import("track_change.zig");
const profile_change = @import("profile_change.zig");
const like_change = @import("like_change.zig");
const record_rejection = @import("record_rejection.zig");

pub const Commit = struct {
    repo_did: []const u8,
    commit_rev: []const u8,
    commit_cid: zat.Cid,
    prev_data_cid: zat.Cid,
    data_cid: zat.Cid,
    indexed_at_us: i64,
    list_changes: []const list_change.Change,
    track_changes: []const track_change.Change = &.{},
    profile_changes: []const profile_change.Change = &.{},
    like_changes: []const like_change.Change = &.{},
    rejections: []const record_rejection.Rejection = &.{},

    pub fn validate(self: Commit) Error!void {
        if (zat.Did.parse(self.repo_did) == null or
            zat.Tid.parse(self.commit_rev) == null or
            self.indexed_at_us < 0) return error.InvalidCommit;
        try validateDagCborCid(self.commit_cid);
        try validateDagCborCid(self.prev_data_cid);
        try validateDagCborCid(self.data_cid);

        for (self.list_changes, 0..) |change, index| {
            const identity = identityOf(change);
            if (!std.mem.eql(u8, identity.owner_did, self.repo_did) or
                !std.mem.eql(u8, identity.proof.commit_rev, self.commit_rev) or
                identity.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, identity.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidCommit;
            for (self.list_changes[0..index]) |prior| {
                if (std.mem.eql(u8, identity.record_uri, identityOf(prior).record_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.track_changes, 0..) |change, index| {
            const identity = trackIdentityOf(change);
            if (!std.mem.eql(u8, identity.owner_did, self.repo_did) or
                !std.mem.eql(u8, identity.proof.commit_rev, self.commit_rev) or
                identity.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, identity.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidCommit;
            for (self.track_changes[0..index]) |prior| {
                if (std.mem.eql(u8, identity.record_uri, trackIdentityOf(prior).record_uri))
                    return error.DuplicateRecord;
            }
            for (self.list_changes) |list| {
                if (std.mem.eql(u8, identity.record_uri, identityOf(list).record_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.profile_changes, 0..) |change, index| {
            const identity = profileIdentityOf(change);
            if (!std.mem.eql(u8, identity.owner_did, self.repo_did) or
                !std.mem.eql(u8, identity.proof.commit_rev, self.commit_rev) or
                identity.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, identity.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidCommit;
            for (self.profile_changes[0..index]) |prior| {
                if (std.mem.eql(u8, identity.record_uri, profileIdentityOf(prior).record_uri))
                    return error.DuplicateRecord;
            }
            for (self.list_changes) |list| {
                if (std.mem.eql(u8, identity.record_uri, identityOf(list).record_uri))
                    return error.DuplicateRecord;
            }
            for (self.track_changes) |track| {
                if (std.mem.eql(u8, identity.record_uri, trackIdentityOf(track).record_uri))
                    return error.DuplicateRecord;
            }
        }
        for (self.like_changes, 0..) |change, index| {
            const identity = likeIdentityOf(change);
            if (!std.mem.eql(u8, identity.owner_did, self.repo_did) or
                !std.mem.eql(u8, identity.proof.commit_rev, self.commit_rev) or
                identity.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, identity.proof.commit_cid.raw, self.commit_cid.raw))
                return error.InvalidCommit;
            for (self.like_changes[0..index]) |prior| {
                if (std.mem.eql(u8, identity.record_uri, likeIdentityOf(prior).record_uri))
                    return error.DuplicateRecord;
            }
            for (self.list_changes) |prior| if (std.mem.eql(
                u8,
                identity.record_uri,
                identityOf(prior).record_uri,
            )) return error.DuplicateRecord;
            for (self.track_changes) |prior| if (std.mem.eql(
                u8,
                identity.record_uri,
                trackIdentityOf(prior).record_uri,
            )) return error.DuplicateRecord;
            for (self.profile_changes) |prior| if (std.mem.eql(
                u8,
                identity.record_uri,
                profileIdentityOf(prior).record_uri,
            )) return error.DuplicateRecord;
        }
        for (self.rejections, 0..) |rejection, index| {
            rejection.validate() catch return error.InvalidCommit;
            if (!std.mem.eql(u8, rejection.owner_did, self.repo_did) or
                !std.mem.eql(u8, rejection.proof.commit_rev, self.commit_rev) or
                rejection.proof.indexed_at_us != self.indexed_at_us or
                !std.mem.eql(u8, rejection.proof.commit_cid.raw, self.commit_cid.raw) or
                !hasMatchingDelete(self, rejection.record_uri)) return error.InvalidCommit;
            for (self.rejections[0..index]) |prior| {
                if (std.mem.eql(u8, rejection.record_uri, prior.record_uri))
                    return error.DuplicateRecord;
            }
        }
    }
};

pub const ApplyResult = enum {
    applied,
    idempotent,
    stale,
    needs_bootstrap,
};

pub const Store = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, Commit) Error!ApplyResult,

    pub fn apply(
        self: Store,
        allocator: std.mem.Allocator,
        commit: Commit,
    ) Error!ApplyResult {
        try commit.validate();
        return self.apply_fn(self.context, allocator, commit);
    }
};

pub const Error = error{
    InvalidCommit,
    DuplicateRecord,
    ChainGap,
    RevisionConflict,
    CorruptProjection,
    ProjectionUnavailable,
    OutOfMemory,
};

const Identity = struct {
    record_uri: []const u8,
    owner_did: []const u8,
    proof: list_change.Proof,
};

fn identityOf(change: list_change.Change) Identity {
    return switch (change) {
        .upsert => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
        .delete => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
    };
}

fn trackIdentityOf(change: track_change.Change) Identity {
    return switch (change) {
        .upsert => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
        .delete => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
    };
}

fn profileIdentityOf(change: profile_change.Change) Identity {
    return switch (change) {
        .upsert => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
        .delete => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
    };
}

fn likeIdentityOf(change: like_change.Change) Identity {
    return switch (change) {
        .upsert => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
        .delete => |value| .{
            .record_uri = value.record_uri,
            .owner_did = value.owner_did,
            .proof = value.proof,
        },
    };
}

fn validateDagCborCid(cid: zat.Cid) Error!void {
    const parsed = zat.Cid.fromBytes(cid.raw) catch return error.InvalidCommit;
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidCommit;
}

fn hasMatchingDelete(commit: Commit, uri: []const u8) bool {
    for (commit.list_changes) |change| switch (change) {
        .upsert => {},
        .delete => |value| if (std.mem.eql(u8, value.record_uri, uri)) return true,
    };
    for (commit.track_changes) |change| switch (change) {
        .upsert => {},
        .delete => |value| if (std.mem.eql(u8, value.record_uri, uri)) return true,
    };
    for (commit.profile_changes) |change| switch (change) {
        .upsert => {},
        .delete => |value| if (std.mem.eql(u8, value.record_uri, uri)) return true,
    };
    for (commit.like_changes) |change| switch (change) {
        .upsert => {},
        .delete => |value| if (std.mem.eql(u8, value.record_uri, uri)) return true,
    };
    return false;
}

test "verified commit rejects mixed provenance and duplicate paths" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const before = try zat.Cid.forDagCbor(a, "before");
    const after = try zat.Cid.forDagCbor(a, "after");
    const change: list_change.Change = .{ .delete = .{
        .record_uri = "at://did:plc:a/fm.plyr.dev.list/r",
        .owner_did = "did:plc:a",
        .collection = "fm.plyr.dev.list",
        .rkey = "r",
        .proof = .{
            .commit_cid = commit_cid,
            .commit_rev = "3jqfcqzm3fo2j",
            .indexed_at_us = 1,
        },
    } };
    const valid: Commit = .{
        .repo_did = "did:plc:a",
        .commit_rev = "3jqfcqzm3fo2j",
        .commit_cid = commit_cid,
        .prev_data_cid = before,
        .data_cid = after,
        .indexed_at_us = 1,
        .list_changes = &.{change},
    };
    try valid.validate();

    var duplicate = valid;
    duplicate.list_changes = &.{ change, change };
    try std.testing.expectError(error.DuplicateRecord, duplicate.validate());

    var wrong_did = valid;
    wrong_did.repo_did = "did:plc:b";
    try std.testing.expectError(error.InvalidCommit, wrong_did.validate());
}
