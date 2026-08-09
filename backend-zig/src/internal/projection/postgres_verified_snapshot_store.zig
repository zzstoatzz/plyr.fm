//! Atomic PostgreSQL bootstrap/repair from an authenticated complete repo.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const list_store = @import("list_store.zig");
const postgres_list = @import("postgres_list_store.zig");
const postgres_track = @import("postgres_track_store.zig");
const track_change = @import("track_change.zig");
const verified = @import("verified_snapshot.zig");

pub const PostgresVerifiedSnapshotStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresVerifiedSnapshotStore) verified.Store {
        return .{ .context = self, .apply_fn = applyOpaque };
    }

    fn applyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        snapshot: verified.Snapshot,
    ) verified.Error!verified.ApplyResult {
        const self: *PostgresVerifiedSnapshotStore = @ptrCast(@alignCast(context));
        return self.apply(allocator, snapshot);
    }

    fn apply(
        self: *PostgresVerifiedSnapshotStore,
        allocator: std.mem.Allocator,
        snapshot: verified.Snapshot,
    ) verified.Error!verified.ApplyResult {
        const commit_cid = snapshot.commit_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(commit_cid);
        const data_cid = snapshot.data_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(data_cid);
        const record_uris = allocator.alloc([]const u8, snapshot.list_changes.len) catch
            return error.OutOfMemory;
        defer allocator.free(record_uris);
        for (snapshot.list_changes, record_uris) |change, *uri| {
            uri.* = switch (change) {
                .upsert => |value| value.record_uri,
                .delete => return error.InvalidSnapshot,
            };
        }
        const track_uris = allocator.alloc([]const u8, snapshot.track_changes.len) catch
            return error.OutOfMemory;
        defer allocator.free(track_uris);
        for (snapshot.track_changes, track_uris) |change, *uri| {
            uri.* = switch (change) {
                .upsert => |value| value.record_uri,
                .delete => return error.InvalidSnapshot,
            };
        }

        var conn = self.pool.acquire() catch |err| {
            std.log.err("verified snapshot connection acquisition failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        defer self.pool.release(conn);
        conn.begin() catch |err| {
            std.log.err("verified snapshot transaction begin failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        var transaction_open = true;
        defer if (transaction_open) conn.rollback() catch |err| {
            std.log.err("verified snapshot rollback failed: {}", .{err});
        };

        // A row lock cannot serialize two initial bootstraps because the row
        // does not exist yet. The transaction-scoped hash lock closes that
        // race and is shared by bootstrap and repair for one DID only.
        var lock_row = conn.row(advisory_lock_sql, .{snapshot.repo_did}) catch |err| {
            std.log.err("verified snapshot advisory lock failed: {}", .{err});
            return error.ProjectionUnavailable;
        } orelse return error.CorruptProjection;
        lock_row.deinit() catch return error.CorruptProjection;

        if (try classifyHead(conn, allocator, snapshot, commit_cid, data_cid)) |result| {
            conn.rollback() catch |err| {
                std.log.err("verified snapshot no-op rollback failed: {}", .{err});
                return error.ProjectionUnavailable;
            };
            transaction_open = false;
            return result;
        }
        var future_row = conn.row(has_future_records_sql, .{
            snapshot.repo_did,
            snapshot.list_collection,
            snapshot.track_collection,
            snapshot.commit_rev,
        }) catch |err| {
            std.log.err("verified snapshot future-record check failed: {}", .{err});
            return error.ProjectionUnavailable;
        } orelse return error.CorruptProjection;
        const has_future = future_row.get(bool, 0) catch {
            future_row.deinit() catch {};
            return error.CorruptProjection;
        };
        future_row.deinit() catch return error.CorruptProjection;
        if (has_future) return error.CorruptProjection;

        var lists: postgres_list.PostgresListStore = .{ .pool = self.pool };
        for (snapshot.list_changes) |change| {
            const result = lists.applyInTransaction(conn, allocator, change) catch |err| switch (err) {
                error.RevisionConflict => return error.RevisionConflict,
                error.CorruptProjection => return error.CorruptProjection,
                error.ProjectionUnavailable => return error.ProjectionUnavailable,
                error.OutOfMemory => return error.OutOfMemory,
            };
            if (result != .applied) return error.CorruptProjection;
        }
        var tracks: postgres_track.PostgresTrackStore = .{ .pool = self.pool };
        for (snapshot.track_changes) |change| {
            const result = tracks.applyInTransaction(conn, allocator, change) catch |err| switch (err) {
                error.RevisionConflict => return error.RevisionConflict,
                error.CorruptProjection => return error.CorruptProjection,
                error.ProjectionUnavailable => return error.ProjectionUnavailable,
                error.OutOfMemory => return error.OutOfMemory,
            };
            if (result != .applied) return error.CorruptProjection;
        }

        _ = conn.exec(tombstone_absent_sql, .{
            snapshot.repo_did,
            snapshot.list_collection,
            record_uris,
            commit_cid,
            snapshot.commit_rev,
            snapshot.indexed_at_us,
        }) catch |err| {
            std.log.err("verified snapshot absence reconciliation failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        _ = conn.exec(delete_tombstoned_members_sql, .{
            snapshot.repo_did,
            snapshot.list_collection,
            snapshot.commit_rev,
            commit_cid,
        }) catch |err| {
            std.log.err("verified snapshot tombstone member cleanup failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        _ = conn.exec(tombstone_absent_tracks_sql, .{
            snapshot.repo_did,
            snapshot.track_collection,
            track_uris,
            commit_cid,
            snapshot.commit_rev,
            snapshot.indexed_at_us,
        }) catch |err| {
            std.log.err("verified snapshot track absence reconciliation failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        const advanced = conn.exec(install_head_sql, .{
            snapshot.repo_did,
            snapshot.commit_rev,
            commit_cid,
            data_cid,
            snapshot.indexed_at_us,
        }) catch |err| {
            std.log.err("verified snapshot head installation failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        if (advanced != 1) return error.CorruptProjection;

        conn.commit() catch |err| {
            std.log.err("verified snapshot transaction commit failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        transaction_open = false;
        return .applied;
    }
};

fn classifyHead(
    conn: *pg.Conn,
    allocator: std.mem.Allocator,
    snapshot: verified.Snapshot,
    commit_cid: []const u8,
    data_cid: []const u8,
) verified.Error!?verified.ApplyResult {
    var row = conn.row(head_sql, .{snapshot.repo_did}) catch |err| {
        std.log.err("verified snapshot head read failed: {}", .{err});
        return error.ProjectionUnavailable;
    } orelse return null;
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

    return switch (std.mem.order(u8, current_rev, snapshot.commit_rev)) {
        .gt => .stale,
        .lt => null,
        .eq => if (std.mem.eql(u8, current_commit, commit_cid) and
            std.mem.eql(u8, current_data, data_cid))
            .idempotent
        else
            error.RevisionConflict,
    };
}

const advisory_lock_sql =
    \\SELECT pg_advisory_xact_lock(hashtextextended($1, 1881820018))
;

const head_sql =
    \\SELECT commit_rev, commit_cid, data_cid
    \\FROM plyr_index.repo_heads
    \\WHERE repo_did = $1
    \\FOR UPDATE
;

const has_future_records_sql =
    \\SELECT EXISTS (
    \\  SELECT 1 FROM plyr_index.list_records
    \\  WHERE owner_did = $1 AND collection = $2 AND commit_rev > $4
    \\  UNION ALL
    \\  SELECT 1 FROM plyr_index.track_records
    \\  WHERE owner_did = $1 AND collection = $3 AND commit_rev > $4
    \\)
;

const tombstone_absent_sql =
    \\UPDATE plyr_index.list_records SET
    \\  record_cid = NULL,
    \\  list_type = NULL,
    \\  name = NULL,
    \\  record_created_at = NULL,
    \\  record_updated_at = NULL,
    \\  deleted = TRUE,
    \\  commit_cid = $4,
    \\  commit_rev = $5,
    \\  indexed_at_us = $6
    \\WHERE owner_did = $1 AND collection = $2
    \\  AND NOT (record_uri = ANY($3::text[]))
    \\  AND commit_rev <= $5
;

const delete_tombstoned_members_sql =
    \\DELETE FROM plyr_index.list_members AS members
    \\USING plyr_index.list_records AS records
    \\WHERE members.list_uri = records.record_uri
    \\  AND records.owner_did = $1 AND records.collection = $2
    \\  AND records.deleted AND records.commit_rev = $3 AND records.commit_cid = $4
;

const tombstone_absent_tracks_sql =
    \\UPDATE plyr_index.track_records SET
    \\  record_cid = NULL,
    \\  title = NULL,
    \\  artist_name = NULL,
    \\  file_type = NULL,
    \\  record_created_at = NULL,
    \\  audio_url = NULL,
    \\  audio_blob_cid = NULL,
    \\  audio_blob_media_type = NULL,
    \\  audio_blob_size = NULL,
    \\  album = NULL,
    \\  duration_seconds = NULL,
    \\  featured_dids = '{}',
    \\  image_url = NULL,
    \\  support_gate_type = NULL,
    \\  description = NULL,
    \\  self_labels = '{}',
    \\  deleted = TRUE,
    \\  commit_cid = $4,
    \\  commit_rev = $5,
    \\  indexed_at_us = $6
    \\WHERE owner_did = $1 AND collection = $2
    \\  AND NOT (record_uri = ANY($3::text[]))
    \\  AND commit_rev <= $5
;

const install_head_sql =
    \\INSERT INTO plyr_index.repo_heads (
    \\  repo_did, commit_rev, commit_cid, data_cid, indexed_at_us
    \\) VALUES ($1, $2, $3, $4, $5)
    \\ON CONFLICT (repo_did) DO UPDATE SET
    \\  commit_rev = EXCLUDED.commit_rev,
    \\  commit_cid = EXCLUDED.commit_cid,
    \\  data_cid = EXCLUDED.data_cid,
    \\  indexed_at_us = EXCLUDED.indexed_at_us
    \\WHERE plyr_index.repo_heads.commit_rev < EXCLUDED.commit_rev
;

test "PostgreSQL complete snapshot bootstraps and reconciles atomically" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    try postgres_list.createTestSchema(pool);
    try postgres_track.createTestTable(pool);
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
    const rev_1 = zat.Tid.fromTimestamp(1_000, 1);
    const rev_2 = zat.Tid.fromTimestamp(2_000, 1);
    const rev_3 = zat.Tid.fromTimestamp(3_000, 1);
    const commit_1 = try zat.Cid.forDagCbor(a, "commit-1");
    const commit_2 = try zat.Cid.forDagCbor(a, "commit-2");
    const commit_3 = try zat.Cid.forDagCbor(a, "commit-3");
    const commit_4 = try zat.Cid.forDagCbor(a, "commit-4");
    const data_1 = try zat.Cid.forDagCbor(a, "data-1");
    const data_2 = try zat.Cid.forDagCbor(a, "data-2");
    const data_3 = try zat.Cid.forDagCbor(a, "data-3");
    const record_cid = try cidString(a, "record");
    const one_1 = listUpsert("one", record_cid, rev_1.str(), commit_1, 1_000);
    var two_1 = listUpsert("two", record_cid, rev_1.str(), commit_1, 1_000);
    const two_members = [_]list_change.Member{.{
        .position = 0,
        .track_uri = "at://did:plc:artist/fm.plyr.dev.track/track",
        .track_cid = record_cid,
    }};
    two_1.upsert.members = &two_members;
    var initial = makeSnapshot(rev_1.str(), commit_1, data_1, 1_000, &.{ one_1, two_1 });
    const track_one_1 = trackUpsert("track-one", rev_1.str(), commit_1, 1_000);
    const track_two_1 = trackUpsert("track-two", rev_1.str(), commit_1, 1_000);
    initial.track_changes = &.{ track_one_1, track_two_1 };
    var implementation: PostgresVerifiedSnapshotStore = .{ .pool = pool };
    const store = implementation.store();
    try std.testing.expectEqual(verified.ApplyResult.applied, try store.apply(a, initial));
    try std.testing.expectEqual(verified.ApplyResult.idempotent, try store.apply(a, initial));
    try expectState(pool, rev_1.str(), "one", false);
    try expectState(pool, rev_1.str(), "two", false);
    try expectTrackState(pool, "track-one", rev_1.str(), false);
    try expectTrackState(pool, "track-two", rev_1.str(), false);

    const one_2 = listUpsert("one", record_cid, rev_2.str(), commit_2, 2_000);
    var repaired = makeSnapshot(rev_2.str(), commit_2, data_2, 2_000, &.{one_2});
    const track_one_2 = trackUpsert("track-one", rev_2.str(), commit_2, 2_000);
    repaired.track_changes = &.{track_one_2};
    try std.testing.expectEqual(verified.ApplyResult.applied, try store.apply(a, repaired));
    try expectState(pool, rev_2.str(), "one", false);
    try expectState(pool, rev_2.str(), "two", true);
    try expectMemberCount(pool, "two", 0);
    try expectTrackState(pool, "track-one", rev_2.str(), false);
    try expectTrackState(pool, "track-two", rev_2.str(), true);

    try std.testing.expectEqual(verified.ApplyResult.stale, try store.apply(a, initial));
    var conflict = repaired;
    conflict.commit_cid = commit_3;
    conflict.list_changes = &.{};
    conflict.track_changes = &.{};
    try std.testing.expectError(error.RevisionConflict, store.apply(a, conflict));

    var list_implementation: postgres_list.PostgresListStore = .{ .pool = pool };
    const poison = listUpsert("two", record_cid, rev_3.str(), commit_4, 3_000);
    try std.testing.expectEqual(list_store.ApplyResult.applied, try list_implementation.store().apply(a, poison));
    const one_3 = listUpsert("one", record_cid, rev_3.str(), commit_3, 3_000);
    const two_3 = listUpsert("two", record_cid, rev_3.str(), commit_3, 3_000);
    const broken = makeSnapshot(rev_3.str(), commit_3, data_3, 3_000, &.{ one_3, two_3 });
    try std.testing.expectError(error.RevisionConflict, store.apply(a, broken));
    try expectState(pool, rev_2.str(), "one", false);
    try expectHead(pool, rev_2.str());
}

fn makeSnapshot(
    rev: []const u8,
    commit_cid: zat.Cid,
    data_cid: zat.Cid,
    indexed_at_us: i64,
    changes: []const list_change.Change,
) verified.Snapshot {
    return .{
        .repo_did = "did:plc:artist",
        .commit_rev = rev,
        .commit_cid = commit_cid,
        .data_cid = data_cid,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .indexed_at_us = indexed_at_us,
        .list_changes = changes,
    };
}

fn listUpsert(
    rkey: []const u8,
    record_cid: []const u8,
    rev: []const u8,
    commit_cid: zat.Cid,
    indexed_at_us: i64,
) list_change.Change {
    const record_uri = if (std.mem.eql(u8, rkey, "one"))
        "at://did:plc:artist/fm.plyr.dev.list/one"
    else
        "at://did:plc:artist/fm.plyr.dev.list/two";
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = record_cid,
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.list",
        .rkey = rkey,
        .list_type = .album,
        .name = rkey,
        .created_at = "2026-08-08T12:00:00Z",
        .updated_at = null,
        .members = &.{},
        .proof = .{
            .commit_cid = commit_cid,
            .commit_rev = rev,
            .indexed_at_us = indexed_at_us,
        },
    } };
}

fn trackUpsert(
    rkey: []const u8,
    rev: []const u8,
    commit_cid: zat.Cid,
    indexed_at_us: i64,
) track_change.Change {
    const record_uri = if (std.mem.eql(u8, rkey, "track-one"))
        "at://did:plc:artist/fm.plyr.dev.track/track-one"
    else
        "at://did:plc:artist/fm.plyr.dev.track/track-two";
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.track",
        .rkey = rkey,
        .title = rkey,
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

fn expectState(pool: *pg.Pool, head_rev: []const u8, rkey: []const u8, deleted: bool) !void {
    try expectHead(pool, head_rev);
    var row = (try pool.row(
        "SELECT commit_rev, deleted FROM plyr_index.list_records WHERE rkey = $1",
        .{rkey},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(head_rev, try row.get([]const u8, 0));
    try std.testing.expectEqual(deleted, try row.get(bool, 1));
}

fn expectHead(pool: *pg.Pool, rev: []const u8) !void {
    var row = (try pool.row(
        "SELECT commit_rev FROM plyr_index.repo_heads WHERE repo_did = 'did:plc:artist'",
        .{},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 0));
}

fn expectMemberCount(pool: *pg.Pool, rkey: []const u8, expected: i64) !void {
    var row = (try pool.row(
        \\SELECT count(*) FROM plyr_index.list_members AS members
        \\JOIN plyr_index.list_records AS records ON records.record_uri = members.list_uri
        \\WHERE records.rkey = $1
    , .{rkey})).?;
    defer row.deinit() catch {};
    try std.testing.expectEqual(expected, try row.get(i64, 0));
}

fn expectTrackState(pool: *pg.Pool, rkey: []const u8, rev: []const u8, deleted: bool) !void {
    var row = (try pool.row(
        "SELECT commit_rev, deleted FROM plyr_index.track_records WHERE rkey = $1",
        .{rkey},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 0));
    try std.testing.expectEqual(deleted, try row.get(bool, 1));
}
