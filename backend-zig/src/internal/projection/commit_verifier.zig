//! Strict live-repository verification before projection construction.
//!
//! Unlike availability-oriented relay ingestion, this path has no legacy or
//! lenient-inversion mode. A live event must extend a known authenticated MST
//! root. Missing continuity is routed to authoritative full-repo repair.

const std = @import("std");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const track_change = @import("track_change.zig");
const profile_change = @import("profile_change.zig");
const like_change = @import("like_change.zig");
const record_rejection = @import("record_rejection.zig");
const verified = @import("verified_commit.zig");

pub const max_commit_blocks_bytes = 2_000_000;
pub const max_operations = 200;

pub const PriorHead = struct {
    commit_rev: []const u8,
    data_cid: zat.Cid,
};

pub fn verify(
    allocator: std.mem.Allocator,
    event: zat.firehose.CommitEvent,
    public_key: zat.multicodec.PublicKey,
    prior: PriorHead,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    indexed_at_us: i64,
) !verified.Commit {
    if (event.rebase or event.too_big) return error.RequiresRepoRepair;
    if (event.blocks.len > max_commit_blocks_bytes or event.ops.len > max_operations)
        return error.CommitTooLarge;
    if (zat.Did.parse(event.repo) == null or
        zat.Tid.parse(event.rev) == null or
        zat.Tid.parse(prior.commit_rev) == null or
        std.mem.order(u8, event.rev, prior.commit_rev) != .gt or
        indexed_at_us < 0) return error.InvalidEnvelope;

    const claimed_parent = event.prev_data orelse return error.RequiresRepoRepair;
    if (!std.mem.eql(u8, claimed_parent.raw, prior.data_cid.raw))
        return error.RequiresRepoRepair;
    const outer_commit = event.commit orelse return error.InvalidEnvelope;

    const mst_ops = try event.toMstOperations(allocator);
    const result = try zat.verifyCommitDiff(
        allocator,
        event.blocks,
        mst_ops,
        prior.data_cid.raw,
        public_key,
        .{
            .expected_did = event.repo,
            .max_car_size = max_commit_blocks_bytes,
        },
    );
    if (!std.mem.eql(u8, result.commit_did, event.repo) or
        !std.mem.eql(u8, result.commit_rev, event.rev) or
        !std.mem.eql(u8, result.commit_cid, outer_commit.raw))
        return error.InvalidEnvelope;
    try checkOperationCids(allocator, event, result.data_cid);

    var changes: std.ArrayList(list_change.Change) = .empty;
    var track_changes: std.ArrayList(track_change.Change) = .empty;
    var profile_changes: std.ArrayList(profile_change.Change) = .empty;
    var like_changes: std.ArrayList(like_change.Change) = .empty;
    var rejections: std.ArrayList(record_rejection.Rejection) = .empty;
    const proof: list_change.Proof = .{
        .commit_cid = outer_commit,
        .commit_rev = event.rev,
        .indexed_at_us = indexed_at_us,
    };
    for (event.ops) |operation| {
        if (std.mem.eql(u8, operation.collection, list_collection)) {
            const change = list_change.fromVerifiedOperation(
                allocator,
                event.repo,
                operation,
                list_collection,
                track_collection,
                proof,
            ) catch |err| {
                const rejected = try rejectOperation(allocator, event.repo, operation, proof, err);
                try rejections.append(allocator, rejected);
                try changes.append(allocator, rejected.listDelete());
                continue;
            } orelse return error.InvalidProjectedRecord;
            try changes.append(allocator, change);
        } else if (std.mem.eql(u8, operation.collection, track_collection)) {
            const change = track_change.fromVerifiedOperation(
                allocator,
                event.repo,
                operation,
                track_collection,
                proof,
            ) catch |err| {
                const rejected = try rejectOperation(allocator, event.repo, operation, proof, err);
                try rejections.append(allocator, rejected);
                try track_changes.append(allocator, rejected.trackDelete());
                continue;
            } orelse return error.InvalidProjectedRecord;
            try track_changes.append(allocator, change);
        } else if (std.mem.eql(u8, operation.collection, profile_collection)) {
            const change = profile_change.fromVerifiedOperation(
                allocator,
                event.repo,
                operation,
                profile_collection,
                proof,
            ) catch |err| {
                const rejected = try rejectOperation(allocator, event.repo, operation, proof, err);
                try rejections.append(allocator, rejected);
                try profile_changes.append(allocator, rejected.profileDelete());
                continue;
            } orelse return error.InvalidProjectedRecord;
            try profile_changes.append(allocator, change);
        } else if (std.mem.eql(u8, operation.collection, like_collection)) {
            const change = like_change.fromVerifiedOperation(
                allocator,
                event.repo,
                operation,
                like_collection,
                track_collection,
                proof,
            ) catch |err| {
                const rejected = try rejectOperation(allocator, event.repo, operation, proof, err);
                try rejections.append(allocator, rejected);
                try like_changes.append(allocator, rejected.likeDelete());
                continue;
            } orelse return error.InvalidProjectedRecord;
            try like_changes.append(allocator, change);
        }
    }

    const commit: verified.Commit = .{
        .repo_did = event.repo,
        .commit_rev = event.rev,
        .commit_cid = outer_commit,
        .prev_data_cid = claimed_parent,
        .data_cid = try zat.Cid.fromBytes(result.data_cid),
        .indexed_at_us = indexed_at_us,
        .list_changes = try changes.toOwnedSlice(allocator),
        .track_changes = try track_changes.toOwnedSlice(allocator),
        .profile_changes = try profile_changes.toOwnedSlice(allocator),
        .like_changes = try like_changes.toOwnedSlice(allocator),
        .rejections = try rejections.toOwnedSlice(allocator),
    };
    try commit.validate();
    return commit;
}

fn rejectOperation(
    allocator: std.mem.Allocator,
    repo_did: []const u8,
    operation: zat.firehose.RepoOp,
    proof: list_change.Proof,
    err: anyerror,
) !record_rejection.Rejection {
    switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.InvalidOperation, error.InvalidIdentity => return error.InvalidProjectedRecord,
        else => {},
    }
    if (operation.action == .delete) return error.InvalidProjectedRecord;
    const record_cid = operation.cid orelse return error.InvalidProjectedRecord;
    return record_rejection.init(
        allocator,
        repo_did,
        operation.collection,
        operation.rkey,
        record_cid,
        .invalid_schema,
        @errorName(err),
        proof,
    );
}

fn checkOperationCids(
    allocator: std.mem.Allocator,
    event: zat.firehose.CommitEvent,
    data_cid: []const u8,
) !void {
    if (event.ops.len == 0) return;
    const loaded = try zat.loadCommitFromCAR(allocator, event.blocks);
    var tree = zat.mst.Mst.loadFromBlocks(allocator, loaded.repo_car, data_cid) catch
        return error.InvalidOperationCid;
    for (event.ops) |operation| {
        const path = if (operation.path.len > 0)
            operation.path
        else
            try std.fmt.allocPrint(
                allocator,
                "{s}/{s}",
                .{ operation.collection, operation.rkey },
            );
        const found = tree.getLazy(path) catch return error.InvalidOperationCid;
        switch (operation.action) {
            .create, .update => {
                const claimed = operation.cid orelse return error.InvalidOperationCid;
                const actual = found orelse return error.InvalidOperationCid;
                if (!std.mem.eql(u8, claimed.raw, actual.raw))
                    return error.InvalidOperationCid;
            },
            .delete => if (found != null) return error.InvalidOperationCid,
        }
    }
}

test "strict verifier proves chain, envelope, op CIDs, and selected records together" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const keypair = try zat.Keypair.fromSecretKey(.p256, .{17} ** 32);
    const did = try keypair.did(a);
    const public_key_bytes = try keypair.publicKey();
    const public_key: zat.multicodec.PublicKey = .{
        .key_type = .p256,
        .raw = &public_key_bytes,
    };
    const prior_rev = "3jqfcqzm3fo2j";
    const rev = "3jqfcqzm3fo2k";
    const path = "fm.plyr.dev.list/3m123abc";
    const track_path = "fm.plyr.dev.track/3m123abd";
    const profile_path = "fm.plyr.dev.actor.profile/self";
    const like_path = "fm.plyr.dev.like/3m123abe";

    var before = zat.mst.Mst.init(a);
    const before_root = try before.rootCid();
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "items", .value = .{ .array = &.{} } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const record_bytes = try zat.cbor.encodeAlloc(a, record);
    const record_cid = try zat.Cid.forDagCbor(a, record_bytes);
    const blob_cid = try zat.Cid.create(a, 1, zat.cbor.Codec.raw, zat.cbor.HashFn.sha2_256, "audio");
    const track_record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "Verified" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "flac" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
        .{ .key = "audioBlob", .value = .{ .map = &.{
            .{ .key = "$type", .value = .{ .text = "blob" } },
            .{ .key = "ref", .value = .{ .cid = blob_cid } },
            .{ .key = "mimeType", .value = .{ .text = "audio/flac" } },
            .{ .key = "size", .value = .{ .unsigned = 5 } },
        } } },
    } };
    const track_bytes = try zat.cbor.encodeAlloc(a, track_record);
    const track_cid = try zat.Cid.forDagCbor(a, track_bytes);
    const profile_record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.actor.profile" } },
        .{ .key = "bio", .value = .{ .text = "Verified artist" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const profile_bytes = try zat.cbor.encodeAlloc(a, profile_record);
    const profile_cid = try zat.Cid.forDagCbor(a, profile_bytes);
    const subject_uri = try std.fmt.allocPrint(a, "at://{s}/{s}", .{ did, track_path });
    const like_record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.like" } },
        .{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = subject_uri } },
            .{ .key = "cid", .value = .{ .cid = track_cid } },
        } } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const like_bytes = try zat.cbor.encodeAlloc(a, like_record);
    const like_cid = try zat.Cid.forDagCbor(a, like_bytes);
    var after = zat.mst.Mst.init(a);
    try after.put(path, record_cid);
    try after.put(track_path, track_cid);
    try after.put(profile_path, profile_cid);
    try after.put(like_path, like_cid);
    const after_root = try after.rootCid();
    const previous_commit = try zat.Cid.forDagCbor(a, "previous commit");
    const signed = try zat.signCommit(a, .{
        .did = did,
        .rev = rev,
        .data = after_root,
        .prev = previous_commit,
    }, &keypair);
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    try blocks.append(a, .{ .cid_raw = signed.cid.raw, .data = signed.bytes });
    try after.collectBlocks(&blocks);
    try blocks.append(a, .{ .cid_raw = record_cid.raw, .data = record_bytes });
    try blocks.append(a, .{ .cid_raw = track_cid.raw, .data = track_bytes });
    try blocks.append(a, .{ .cid_raw = profile_cid.raw, .data = profile_bytes });
    try blocks.append(a, .{ .cid_raw = like_cid.raw, .data = like_bytes });
    const car_bytes = try zat.car.writeAlloc(a, .{
        .roots = &.{signed.cid},
        .blocks = blocks.items,
    });
    const operation: zat.firehose.RepoOp = .{
        .action = .create,
        .path = path,
        .collection = "fm.plyr.dev.list",
        .rkey = "3m123abc",
        .cid = record_cid,
        .record = record,
    };
    const track_operation: zat.firehose.RepoOp = .{
        .action = .create,
        .path = track_path,
        .collection = "fm.plyr.dev.track",
        .rkey = "3m123abd",
        .cid = track_cid,
        .record = track_record,
    };
    const profile_operation: zat.firehose.RepoOp = .{
        .action = .create,
        .path = profile_path,
        .collection = "fm.plyr.dev.actor.profile",
        .rkey = "self",
        .cid = profile_cid,
        .record = profile_record,
    };
    const like_operation: zat.firehose.RepoOp = .{
        .action = .create,
        .path = like_path,
        .collection = "fm.plyr.dev.like",
        .rkey = "3m123abe",
        .cid = like_cid,
        .record = like_record,
    };
    const event: zat.firehose.CommitEvent = .{
        .seq = 1,
        .repo = did,
        .rev = rev,
        .time = "2026-08-08T12:00:00Z",
        .commit = signed.cid,
        .blocks = car_bytes,
        .ops = &.{ operation, track_operation, profile_operation, like_operation },
        .prev_data = before_root,
    };
    const commit = try verify(
        a,
        event,
        public_key,
        .{ .commit_rev = prior_rev, .data_cid = before_root },
        "fm.plyr.dev.list",
        "fm.plyr.dev.track",
        "fm.plyr.dev.actor.profile",
        "fm.plyr.dev.like",
        42,
    );
    try std.testing.expectEqual(@as(usize, 1), commit.list_changes.len);
    try std.testing.expectEqual(@as(usize, 1), commit.track_changes.len);
    try std.testing.expectEqual(@as(usize, 1), commit.profile_changes.len);
    try std.testing.expectEqual(@as(usize, 1), commit.like_changes.len);
    try std.testing.expectEqualStrings(subject_uri, commit.like_changes[0].upsert.subject_uri);
    try std.testing.expectEqualStrings("Verified", commit.track_changes[0].upsert.title);
    try std.testing.expectEqualStrings("Verified artist", commit.profile_changes[0].upsert.bio.?);
    try std.testing.expectEqualStrings(rev, commit.commit_rev);
    try std.testing.expectEqualSlices(u8, after_root.raw, commit.data_cid.raw);

    var no_parent = event;
    no_parent.prev_data = null;
    try std.testing.expectError(
        error.RequiresRepoRepair,
        verify(
            a,
            no_parent,
            public_key,
            .{ .commit_rev = prior_rev, .data_cid = before_root },
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            "fm.plyr.dev.actor.profile",
            "fm.plyr.dev.like",
            42,
        ),
    );

    const wrong_cid = try zat.Cid.forDagCbor(a, "wrong record");
    var tampered = event;
    tampered.ops = &.{.{
        .action = .create,
        .path = path,
        .collection = "fm.plyr.dev.list",
        .rkey = "3m123abc",
        .cid = wrong_cid,
        .record = record,
    }};
    try std.testing.expectError(
        error.InvalidOperationCid,
        checkOperationCids(a, tampered, after_root.raw),
    );
}

test "malformed live app record becomes a proved rejection and projection delete" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record_cid = try zat.Cid.forDagCbor(a, "malformed list");
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const previous = try zat.Cid.forDagCbor(a, "previous");
    const data = try zat.Cid.forDagCbor(a, "data");
    const proof: list_change.Proof = .{
        .commit_cid = commit_cid,
        .commit_rev = "3jqfcqzm3fo2k",
        .indexed_at_us = 42,
    };
    const rejected = try rejectOperation(a, "did:plc:owner", .{
        .action = .create,
        .path = "fm.plyr.dev.list/list",
        .collection = "fm.plyr.dev.list",
        .rkey = "list",
        .cid = record_cid,
        .record = .{ .map = &.{} },
    }, proof, error.InvalidStrongRefCid);
    const commit: verified.Commit = .{
        .repo_did = "did:plc:owner",
        .commit_rev = proof.commit_rev,
        .commit_cid = commit_cid,
        .prev_data_cid = previous,
        .data_cid = data,
        .indexed_at_us = proof.indexed_at_us,
        .list_changes = &.{rejected.listDelete()},
        .rejections = &.{rejected},
    };
    try commit.validate();
    try std.testing.expectEqualStrings("InvalidStrongRefCid", rejected.detail);
    try std.testing.expectEqualStrings(
        rejected.record_uri,
        commit.list_changes[0].delete.record_uri,
    );
}
