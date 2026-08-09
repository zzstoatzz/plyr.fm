//! Atomic PostgreSQL sink for authenticated repository commits.

const std = @import("std");
const pg = @import("pg");
const availability = @import("../account/availability.zig");
const postgres_availability = @import("../account/postgres_availability_store.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const postgres_list = @import("postgres_list_store.zig");
const postgres_track = @import("postgres_track_store.zig");
const postgres_profile = @import("postgres_profile_store.zig");
const postgres_rejections = @import("postgres_record_rejection_store.zig");
const profile_change = @import("profile_change.zig");
const profile_store = @import("profile_store.zig");
const track_change = @import("track_change.zig");
const track_store = @import("track_store.zig");
const repository_head = @import("repository_head.zig");
const record_rejection = @import("record_rejection.zig");
const verified = @import("verified_commit.zig");

pub const PostgresVerifiedCommitStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresVerifiedCommitStore) verified.Store {
        return .{ .context = self, .apply_fn = applyOpaque };
    }

    pub fn reader(self: *PostgresVerifiedCommitStore) repository_head.Reader {
        return .{ .context = self, .load_fn = loadOpaque };
    }

    fn loadOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        repo_did: []const u8,
    ) repository_head.Error!?repository_head.Head {
        const self: *PostgresVerifiedCommitStore = @ptrCast(@alignCast(context));
        return self.load(allocator, repo_did);
    }

    fn load(
        self: *PostgresVerifiedCommitStore,
        allocator: std.mem.Allocator,
        repo_did: []const u8,
    ) repository_head.Error!?repository_head.Head {
        var row = self.pool.row(load_head_sql, .{repo_did}) catch |err| {
            std.log.err("verified repository head read failed: {}", .{err});
            return error.ProjectionUnavailable;
        } orelse return null;
        defer row.deinit() catch {};
        const commit_rev = allocator.dupe(
            u8,
            row.get([]const u8, 0) catch return error.CorruptProjection,
        ) catch return error.OutOfMemory;
        errdefer allocator.free(commit_rev);
        const commit_text = row.get([]const u8, 1) catch return error.CorruptProjection;
        const data_text = row.get([]const u8, 2) catch return error.CorruptProjection;
        const indexed_at_us = row.get(i64, 3) catch return error.CorruptProjection;
        const owned_did = allocator.dupe(u8, repo_did) catch return error.OutOfMemory;
        errdefer allocator.free(owned_did);
        const commit_cid = zat.Cid.fromString(allocator, commit_text) catch
            return error.CorruptProjection;
        errdefer allocator.free(commit_cid.raw);
        const data_cid = zat.Cid.fromString(allocator, data_text) catch
            return error.CorruptProjection;
        errdefer allocator.free(data_cid.raw);
        const head: repository_head.Head = .{
            .repo_did = owned_did,
            .commit_rev = commit_rev,
            .commit_cid = commit_cid,
            .data_cid = data_cid,
            .indexed_at_us = indexed_at_us,
        };
        try head.validate();
        return head;
    }

    fn applyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        commit: verified.Commit,
    ) verified.Error!verified.ApplyResult {
        const self: *PostgresVerifiedCommitStore = @ptrCast(@alignCast(context));
        return self.apply(allocator, commit);
    }

    fn apply(
        self: *PostgresVerifiedCommitStore,
        allocator: std.mem.Allocator,
        commit: verified.Commit,
    ) verified.Error!verified.ApplyResult {
        const commit_cid = commit.commit_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(commit_cid);
        const prev_data_cid = commit.prev_data_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(prev_data_cid);
        const data_cid = commit.data_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(data_cid);

        var conn = self.pool.acquire() catch |err| {
            std.log.err("verified commit connection acquisition failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        defer self.pool.release(conn);
        conn.begin() catch |err| {
            std.log.err("verified commit transaction begin failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        var transaction_open = true;
        defer if (transaction_open) conn.rollback() catch |err| {
            std.log.err("verified commit rollback failed: {}", .{err});
        };

        const disposition = try lockAndClassify(
            conn,
            allocator,
            commit,
            commit_cid,
            prev_data_cid,
            data_cid,
        );
        if (disposition) |result| {
            conn.rollback() catch |err| {
                std.log.err("verified commit no-op rollback failed: {}", .{err});
                return error.ProjectionUnavailable;
            };
            transaction_open = false;
            return result;
        }

        var lists: postgres_list.PostgresListStore = .{ .pool = self.pool };
        for (commit.list_changes) |change| {
            const result = lists.applyInTransaction(conn, allocator, change) catch |err| switch (err) {
                error.RevisionConflict => return error.RevisionConflict,
                error.CorruptProjection => return error.CorruptProjection,
                error.ProjectionUnavailable => return error.ProjectionUnavailable,
                error.OutOfMemory => return error.OutOfMemory,
            };
            if (result != .applied) return error.CorruptProjection;
        }
        var tracks: postgres_track.PostgresTrackStore = .{ .pool = self.pool };
        for (commit.track_changes) |change| {
            const result = tracks.applyInTransaction(conn, allocator, change) catch |err| switch (err) {
                error.RevisionConflict => return error.RevisionConflict,
                error.CorruptProjection => return error.CorruptProjection,
                error.ProjectionUnavailable => return error.ProjectionUnavailable,
                error.OutOfMemory => return error.OutOfMemory,
            };
            if (result != .applied) return error.CorruptProjection;
        }
        var profiles: postgres_profile.PostgresProfileStore = .{ .pool = self.pool };
        for (commit.profile_changes) |change| {
            const result = profiles.applyInTransaction(conn, allocator, change) catch |err| switch (err) {
                error.RevisionConflict => return error.RevisionConflict,
                error.CorruptProjection => return error.CorruptProjection,
                error.ProjectionUnavailable => return error.ProjectionUnavailable,
                error.OutOfMemory => return error.OutOfMemory,
            };
            if (result != .applied) return error.CorruptProjection;
        }
        const touched = collectTouchedUris(allocator, commit) catch return error.OutOfMemory;
        defer allocator.free(touched);
        var rejection_store: postgres_rejections.PostgresRecordRejectionStore = .{ .pool = self.pool };
        rejection_store.replaceForCommit(
            conn,
            allocator,
            touched,
            commit.rejections,
        ) catch |err| return mapRejectionError(err);
        var accounts: postgres_availability.PostgresAvailabilityStore = .{ .pool = self.pool };
        const account_result = accounts.applyInTransaction(conn, allocator, .{
            .repo_did = commit.repo_did,
            .available = true,
            .source = .verified_repository,
            .repository_rev = commit.commit_rev,
            .commit_cid = commit.commit_cid,
            .observed_at_us = commit.indexed_at_us,
        }) catch |err| return mapAvailabilityError(err);
        switch (account_result) {
            .applied, .idempotent, .stale => {},
        }

        const advanced = conn.exec(advance_head_sql, .{
            commit.commit_rev,
            commit_cid,
            data_cid,
            commit.indexed_at_us,
            commit.repo_did,
            prev_data_cid,
        }) catch |err| {
            std.log.err("verified repository head advance failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        if (advanced != 1) return error.CorruptProjection;

        conn.commit() catch |err| {
            std.log.err("verified commit transaction commit failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        transaction_open = false;
        return .applied;
    }
};

fn mapAvailabilityError(err: availability.Error) verified.Error {
    return switch (err) {
        error.EvidenceConflict => error.RevisionConflict,
        error.OutOfMemory => error.OutOfMemory,
        error.ProjectionUnavailable => error.ProjectionUnavailable,
        error.InvalidEvidence, error.CorruptProjection => error.CorruptProjection,
    };
}

fn mapRejectionError(err: postgres_rejections.Error) verified.Error {
    return switch (err) {
        error.RevisionConflict => error.RevisionConflict,
        error.OutOfMemory => error.OutOfMemory,
        error.ProjectionUnavailable => error.ProjectionUnavailable,
        error.InvalidRejection, error.CorruptProjection => error.CorruptProjection,
    };
}

fn collectTouchedUris(
    allocator: std.mem.Allocator,
    commit: verified.Commit,
) ![][]const u8 {
    const count = commit.list_changes.len + commit.track_changes.len + commit.profile_changes.len;
    const uris = try allocator.alloc([]const u8, count);
    var index: usize = 0;
    for (commit.list_changes) |change| {
        uris[index] = switch (change) {
            .upsert => |value| value.record_uri,
            .delete => |value| value.record_uri,
        };
        index += 1;
    }
    for (commit.track_changes) |change| {
        uris[index] = switch (change) {
            .upsert => |value| value.record_uri,
            .delete => |value| value.record_uri,
        };
        index += 1;
    }
    for (commit.profile_changes) |change| {
        uris[index] = switch (change) {
            .upsert => |value| value.record_uri,
            .delete => |value| value.record_uri,
        };
        index += 1;
    }
    return uris;
}

/// Null means the caller owns the current successor and may apply it.
fn lockAndClassify(
    conn: *pg.Conn,
    allocator: std.mem.Allocator,
    commit: verified.Commit,
    commit_cid: []const u8,
    prev_data_cid: []const u8,
    data_cid: []const u8,
) verified.Error!?verified.ApplyResult {
    var row = conn.row(lock_head_sql, .{commit.repo_did}) catch |err| {
        std.log.err("verified repository head lock failed: {}", .{err});
        return error.ProjectionUnavailable;
    } orelse return .needs_bootstrap;
    const current_rev = allocator.dupe(u8, row.get([]const u8, 0) catch {
        row.deinit() catch {};
        return error.CorruptProjection;
    }) catch {
        row.deinit() catch {};
        return error.OutOfMemory;
    };
    defer allocator.free(current_rev);
    const current_commit = allocator.dupe(u8, row.get([]const u8, 1) catch {
        row.deinit() catch {};
        return error.CorruptProjection;
    }) catch {
        row.deinit() catch {};
        return error.OutOfMemory;
    };
    defer allocator.free(current_commit);
    const current_data = allocator.dupe(u8, row.get([]const u8, 2) catch {
        row.deinit() catch {};
        return error.CorruptProjection;
    }) catch {
        row.deinit() catch {};
        return error.OutOfMemory;
    };
    defer allocator.free(current_data);
    row.deinit() catch return error.CorruptProjection;

    switch (std.mem.order(u8, current_rev, commit.commit_rev)) {
        .gt => return .stale,
        .eq => {
            if (!std.mem.eql(u8, current_commit, commit_cid) or
                !std.mem.eql(u8, current_data, data_cid))
                return error.RevisionConflict;
            return .idempotent;
        },
        .lt => {},
    }
    if (!std.mem.eql(u8, current_data, prev_data_cid)) return error.ChainGap;
    return null;
}

const lock_head_sql =
    \\SELECT commit_rev, commit_cid, data_cid
    \\FROM plyr_index.repo_heads
    \\WHERE repo_did = $1
    \\FOR UPDATE
;

const load_head_sql =
    \\SELECT commit_rev, commit_cid, data_cid, indexed_at_us
    \\FROM plyr_index.repo_heads
    \\WHERE repo_did = $1
;

const advance_head_sql =
    \\UPDATE plyr_index.repo_heads SET
    \\  commit_rev = $1,
    \\  commit_cid = $2,
    \\  data_cid = $3,
    \\  indexed_at_us = $4
    \\WHERE repo_did = $5 AND data_cid = $6 AND commit_rev < $1
;

test "PostgreSQL verified commit sink is atomic, strict, and replay safe" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);

    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    try postgres_list.createTestSchema(pool);
    try postgres_track.createTestTable(pool);
    try postgres_profile.createTestTable(pool);
    try postgres_availability.createTestTable(pool);
    try postgres_rejections.createTestTable(pool);
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.repo_heads (
        \\  repo_did text PRIMARY KEY,
        \\  commit_rev text NOT NULL,
        \\  commit_cid text NOT NULL,
        \\  data_cid text NOT NULL,
        \\  indexed_at_us bigint NOT NULL CHECK (indexed_at_us >= 0)
        \\)
    , .{});

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const did = "did:plc:artist";
    const initial_rev = zat.Tid.fromTimestamp(1_000, 1);
    const rev_1 = zat.Tid.fromTimestamp(2_000, 1);
    const rev_2 = zat.Tid.fromTimestamp(3_000, 1);
    const rev_3 = zat.Tid.fromTimestamp(4_000, 1);
    const rev_4 = zat.Tid.fromTimestamp(5_000, 1);
    const initial_commit = try cidString(a, "initial-commit");
    const initial_data = try zat.Cid.forDagCbor(a, "initial-data");
    const data_1 = try zat.Cid.forDagCbor(a, "data-1");
    const data_2 = try zat.Cid.forDagCbor(a, "data-2");
    const data_3 = try zat.Cid.forDagCbor(a, "data-3");
    const commit_1 = try zat.Cid.forDagCbor(a, "commit-1");
    const commit_2 = try zat.Cid.forDagCbor(a, "commit-2");
    const commit_3 = try zat.Cid.forDagCbor(a, "commit-3");
    const commit_4 = try zat.Cid.forDagCbor(a, "commit-4");

    var implementation: PostgresVerifiedCommitStore = .{ .pool = pool };
    const store = implementation.store();
    try std.testing.expect((try implementation.reader().load(a, did)) == null);
    const first_change = listDelete("one", rev_1.str(), commit_1, 2_000);
    const rejected = try record_rejection.init(
        a,
        did,
        "fm.plyr.dev.list",
        "one",
        try zat.Cid.forDagCbor(a, "malformed-one"),
        .invalid_schema,
        "InvalidStrongRefCid",
        .{ .commit_cid = commit_1, .commit_rev = rev_1.str(), .indexed_at_us = 2_000 },
    );
    const first: verified.Commit = .{
        .repo_did = did,
        .commit_rev = rev_1.str(),
        .commit_cid = commit_1,
        .prev_data_cid = initial_data,
        .data_cid = data_1,
        .indexed_at_us = 2_000,
        .list_changes = &.{first_change},
        .rejections = &.{rejected},
    };
    try std.testing.expectEqual(verified.ApplyResult.needs_bootstrap, try store.apply(a, first));

    _ = try pool.exec(
        "INSERT INTO plyr_index.repo_heads VALUES ($1, $2, $3, $4, $5)",
        .{ did, initial_rev.str(), initial_commit, try initial_data.toString(a), @as(i64, 1_000) },
    );
    try std.testing.expectEqual(verified.ApplyResult.applied, try store.apply(a, first));
    try std.testing.expectEqual(verified.ApplyResult.idempotent, try store.apply(a, first));
    try expectHead(pool, rev_1.str(), try data_1.toString(a));
    try expectAvailability(pool, rev_1.str(), 2_000);
    try expectRejection(pool, rejected.record_uri, rev_1.str());
    const loaded_head = (try implementation.reader().load(a, did)).?;
    try std.testing.expectEqualStrings(rev_1.str(), loaded_head.commit_rev);
    try std.testing.expectEqualSlices(u8, data_1.raw, loaded_head.data_cid.raw);

    var stale = first;
    stale.commit_rev = initial_rev.str();
    stale.list_changes = &.{};
    stale.rejections = &.{};
    try std.testing.expectEqual(verified.ApplyResult.stale, try store.apply(a, stale));

    var gap = first;
    gap.commit_rev = rev_2.str();
    gap.commit_cid = commit_2;
    gap.prev_data_cid = try zat.Cid.forDagCbor(a, "wrong-parent");
    gap.data_cid = data_2;
    gap.indexed_at_us = 3_000;
    gap.list_changes = &.{};
    gap.rejections = &.{};
    try std.testing.expectError(error.ChainGap, store.apply(a, gap));

    var conflict = first;
    conflict.commit_cid = commit_2;
    conflict.list_changes = &.{};
    conflict.rejections = &.{};
    try std.testing.expectError(error.RevisionConflict, store.apply(a, conflict));

    var track_implementation: postgres_track.PostgresTrackStore = .{ .pool = pool };
    const poison = trackUpsert(rev_3.str(), commit_3, 4_000);
    try std.testing.expectEqual(track_store.ApplyResult.applied, try track_implementation.store().apply(a, poison));
    const second_changes = [_]list_change.Change{listDelete("one", rev_2.str(), commit_2, 3_000)};
    const second_track_changes = [_]track_change.Change{trackUpsert(rev_2.str(), commit_2, 3_000)};
    const second: verified.Commit = .{
        .repo_did = did,
        .commit_rev = rev_2.str(),
        .commit_cid = commit_2,
        .prev_data_cid = data_1,
        .data_cid = data_2,
        .indexed_at_us = 3_000,
        .list_changes = &second_changes,
        .track_changes = &second_track_changes,
    };
    try std.testing.expectError(error.CorruptProjection, store.apply(a, second));
    try expectHead(pool, rev_1.str(), try data_1.toString(a));
    try expectRecordRev(pool, "one", rev_1.str());
    try expectTrackRev(pool, rev_3.str());
    try expectAvailability(pool, rev_1.str(), 2_000);

    var profile_implementation: postgres_profile.PostgresProfileStore = .{ .pool = pool };
    const future_profile = postgres_profile.profileUpsert("future", rev_3.str(), commit_3, 4_000);
    try std.testing.expectEqual(
        profile_store.ApplyResult.applied,
        try profile_implementation.store().apply(a, future_profile),
    );
    var profile_conflict = second;
    profile_conflict.track_changes = &.{};
    const profile_changes = [_]profile_change.Change{
        postgres_profile.profileUpsert("older", rev_2.str(), commit_2, 3_000),
    };
    profile_conflict.profile_changes = &profile_changes;
    try std.testing.expectError(error.CorruptProjection, store.apply(a, profile_conflict));
    try expectHead(pool, rev_1.str(), try data_1.toString(a));
    try expectRecordRev(pool, "one", rev_1.str());
    try expectProfileRev(pool, rev_3.str());
    try expectAvailability(pool, rev_1.str(), 2_000);

    const resolved_changes = [_]list_change.Change{listDelete("one", rev_4.str(), commit_4, 5_000)};
    const resolved: verified.Commit = .{
        .repo_did = did,
        .commit_rev = rev_4.str(),
        .commit_cid = commit_4,
        .prev_data_cid = data_1,
        .data_cid = data_3,
        .indexed_at_us = 5_000,
        .list_changes = &resolved_changes,
    };
    try std.testing.expectEqual(verified.ApplyResult.applied, try store.apply(a, resolved));
    try expectHead(pool, rev_4.str(), try data_3.toString(a));
    try expectNoRejection(pool, rejected.record_uri);
}

fn expectAvailability(pool: *pg.Pool, rev: []const u8, observed_at_us: i64) !void {
    var row = (try pool.row(
        \\SELECT available, evidence_source, repository_rev, observed_at_us
        \\FROM plyr_index.account_availability WHERE repo_did = 'did:plc:artist'
    , .{})).?;
    defer row.deinit() catch {};
    try std.testing.expect(try row.get(bool, 0));
    try std.testing.expectEqualStrings("verified_repository", try row.get([]const u8, 1));
    try std.testing.expectEqualStrings(rev, (try row.get(?[]const u8, 2)).?);
    try std.testing.expectEqual(observed_at_us, try row.get(i64, 3));
}

fn expectRejection(pool: *pg.Pool, uri: []const u8, rev: []const u8) !void {
    var row = (try pool.row(
        "SELECT reason, detail, commit_rev FROM plyr_index.record_rejections WHERE record_uri = $1",
        .{uri},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings("invalid_schema", try row.get([]const u8, 0));
    try std.testing.expectEqualStrings("InvalidStrongRefCid", try row.get([]const u8, 1));
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 2));
}

fn expectNoRejection(pool: *pg.Pool, uri: []const u8) !void {
    try std.testing.expect((try pool.row(
        "SELECT 1 FROM plyr_index.record_rejections WHERE record_uri = $1",
        .{uri},
    )) == null);
}

fn trackUpsert(
    rev: []const u8,
    commit_cid: zat.Cid,
    indexed_at_us: i64,
) track_change.Change {
    return .{ .upsert = .{
        .record_uri = "at://did:plc:artist/fm.plyr.dev.track/track",
        .record_cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.track",
        .rkey = "track",
        .title = "Track",
        .artist_name = "Artist",
        .file_type = "flac",
        .created_at = "2026-08-08T12:00:00Z",
        .audio_url = "https://media.example/track.flac",
        .audio_blob = null,
        .album = null,
        .duration_seconds = 42,
        .featured_dids = &.{},
        .image_url = null,
        .support_gate_type = null,
        .description = null,
        .self_labels = &.{},
        .proof = .{
            .commit_cid = commit_cid,
            .commit_rev = rev,
            .indexed_at_us = indexed_at_us,
        },
    } };
}

fn listDelete(
    rkey: []const u8,
    rev: []const u8,
    commit_cid: zat.Cid,
    indexed_at_us: i64,
) list_change.Change {
    const record_uri = if (std.mem.eql(u8, rkey, "one"))
        "at://did:plc:artist/fm.plyr.dev.list/one"
    else
        "at://did:plc:artist/fm.plyr.dev.list/two";
    return .{ .delete = .{
        .record_uri = record_uri,
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.list",
        .rkey = rkey,
        .proof = .{
            .commit_cid = commit_cid,
            .commit_rev = rev,
            .indexed_at_us = indexed_at_us,
        },
    } };
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(database_name);
    try row.deinit();
    if (!std.mem.eql(u8, database_name, "relay_test")) return error.UnsafeTestDatabase;
}

fn cidString(allocator: std.mem.Allocator, seed: []const u8) ![]const u8 {
    const cid = try zat.Cid.forDagCbor(allocator, seed);
    return cid.toString(allocator);
}

fn expectHead(pool: *pg.Pool, rev: []const u8, data_cid: []const u8) !void {
    var row = (try pool.row(
        "SELECT commit_rev, data_cid FROM plyr_index.repo_heads WHERE repo_did = 'did:plc:artist'",
        .{},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 0));
    try std.testing.expectEqualStrings(data_cid, try row.get([]const u8, 1));
}

fn expectRecordRev(pool: *pg.Pool, rkey: []const u8, rev: []const u8) !void {
    var row = (try pool.row(
        "SELECT commit_rev FROM plyr_index.list_records WHERE rkey = $1",
        .{rkey},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 0));
}

fn expectTrackRev(pool: *pg.Pool, rev: []const u8) !void {
    var row = (try pool.row(
        "SELECT commit_rev FROM plyr_index.track_records WHERE rkey = 'track'",
        .{},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 0));
}

fn expectProfileRev(pool: *pg.Pool, rev: []const u8) !void {
    var row = (try pool.row(
        "SELECT commit_rev FROM plyr_index.profile_records WHERE rkey = 'self'",
        .{},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 0));
}
