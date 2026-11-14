//! The projector reaches a repository's state two ways: the firehose's
//! verified commits, applied one at a time on top of a bootstrap, and a
//! complete snapshot, applied fresh or on top of whatever is already there to
//! repair it. All three must agree. Random repositories of tracks, lists,
//! likes and a profile go through a chain of commits; a snapshot of the end
//! state must then project the same live records as the chain did, and must
//! leave the chain's projection unchanged when applied on top of it. Proof
//! columns (which commit wrote a row) are left out of the comparison, since a
//! snapshot proves every record with its own commit. Needs the disposable
//! `zig_test` database in `PLYR_ZIG_TEST_DATABASE_URL`; without it the group
//! reports a skip.

const std = @import("std");
const hegel = @import("hegel");
const pg = @import("pg");
const zat = @import("zat");
const list_change = @import("../internal/projection/list_change.zig");
const track_change = @import("../internal/projection/track_change.zig");
const profile_change = @import("../internal/projection/profile_change.zig");
const like_change = @import("../internal/projection/like_change.zig");
const verified_commit = @import("../internal/projection/verified_commit.zig");
const verified_snapshot = @import("../internal/projection/verified_snapshot.zig");
const commit_store = @import("../internal/projection/postgres_verified_commit_store.zig");
const snapshot_store = @import("../internal/projection/postgres_verified_snapshot_store.zig");
const postgres_list = @import("../internal/projection/postgres_list_store.zig");
const postgres_track = @import("../internal/projection/postgres_track_store.zig");
const postgres_profile = @import("../internal/projection/postgres_profile_store.zig");
const postgres_like = @import("../internal/projection/postgres_like_store.zig");
const postgres_comment = @import("../internal/projection/postgres_comment_store.zig");
const postgres_rejections = @import("../internal/projection/postgres_record_rejection_store.zig");
const postgres_availability = @import("../internal/account/postgres_availability_store.zig");

const repo = "did:plc:artist";
const list_nsid = "fm.plyr.dev.list";
const track_nsid = "fm.plyr.dev.track";
const profile_nsid = "fm.plyr.dev.actor.profile";
const like_nsid = "fm.plyr.dev.like";

const Kind = enum { track, list, like, profile };
const Key = struct { kind: Kind, rkey: []const u8 };
const keys = [_]Key{
    .{ .kind = .track, .rkey = "t1" },
    .{ .kind = .track, .rkey = "t2" },
    .{ .kind = .track, .rkey = "t3" },
    .{ .kind = .list, .rkey = "l1" },
    .{ .kind = .list, .rkey = "l2" },
    .{ .kind = .like, .rkey = "k1" },
    .{ .kind = .like, .rkey = "k2" },
    .{ .kind = .profile, .rkey = "self" },
};
const variants = 4;
/// which record each key holds; null when the repository has none
const State = [keys.len]?u8;

const Rule = enum { upsert, delete };
var tally: hegel.Tally(Rule) = .{};

pub fn run() error{PropertyFailed}!void {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse {
        std.debug.print("-- projector.commits_match_snapshot skipped: set PLYR_ZIG_TEST_DATABASE_URL to the zig_test database\n", .{});
        return;
    };
    var threaded = std.Io.Threaded.init(std.heap.smp_allocator, .{});
    defer threaded.deinit();
    const uri = std.Uri.parse(std.mem.span(url)) catch @panic("PLYR_ZIG_TEST_DATABASE_URL is not a URL");
    const pool = pg.Pool.initUri(threaded.io(), std.heap.smp_allocator, uri, .{ .size = 1 }) catch |err|
        std.debug.panic("cannot reach the test database: {}", .{err});
    defer pool.deinit();
    requireDisposable(pool);

    reset(pool) catch |err| std.debug.panic("cannot create the test schema: {}", .{err});
    std.debug.print("-- projector.commits_match_snapshot\n", .{});
    const outcome = hegel.run(.{ .key = "projector.commits_match_snapshot" }, pool, commitsMatchSnapshot);
    tally.print();
    _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch {};
    return outcome;
}

fn requireDisposable(pool: *pg.Pool) void {
    var row = (pool.row("SELECT current_database() = 'zig_test'", .{}) catch @panic("database check failed")).?;
    defer row.deinit() catch {};
    if (!(row.get(bool, 0) catch false)) @panic("PLYR_ZIG_TEST_DATABASE_URL must name the zig_test database");
}

fn reset(pool: *pg.Pool) !void {
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    try postgres_list.createTestSchema(pool);
    try postgres_track.createTestTable(pool);
    try postgres_profile.createTestTable(pool);
    try postgres_like.createTestTable(pool);
    try postgres_comment.createTestTable(pool);
    try postgres_availability.createTestTable(pool);
    try postgres_rejections.createTestTable(pool);
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.repo_heads (
        \\  repo_did text PRIMARY KEY,
        \\  commit_rev text NOT NULL,
        \\  commit_cid text NOT NULL,
        \\  data_cid text NOT NULL,
        \\  indexed_at_us bigint NOT NULL CHECK (indexed_at_us >= 0),
        \\  projection_version integer NOT NULL DEFAULT 0
        \\)
    , .{});
}

/// emptying the tables is far cheaper than rebuilding the schema per case
fn clear(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\DO $$ DECLARE t text; BEGIN
        \\  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'plyr_index' LOOP
        \\    EXECUTE format('DELETE FROM plyr_index.%I', t);
        \\  END LOOP;
        \\END $$
    , .{});
}

fn commitsMatchSnapshot(pool: *pg.Pool, case: *hegel.TestCase) !void {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.smp_allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    try clear(pool);
    tally.case();

    var commits_impl: commit_store.PostgresVerifiedCommitStore = .{ .pool = pool };
    var snapshots_impl: snapshot_store.PostgresVerifiedSnapshotStore = .{ .pool = pool };
    const commits = commits_impl.store();
    const snapshots = snapshots_impl.store();

    var state: State = @splat(null);
    for (&state) |*slot| {
        if (try case.boolean()) slot.* = try case.int(u8, 0, variants - 1);
    }
    case.note("bootstrap {any}", .{state});
    var seq: u64 = 1;
    const bootstrap = try snapshotOf(a, state, seq);
    if (try snapshots.apply(a, bootstrap) != .applied) return case.fail("the bootstrap snapshot did not apply");
    var data_cid = bootstrap.data_cid;

    const length = try case.int(usize, 1, 6);
    for (0..length) |_| {
        seq += 1;
        const at = try point(a, seq);
        var lists: std.ArrayList(list_change.Change) = .empty;
        var tracks: std.ArrayList(track_change.Change) = .empty;
        var profiles: std.ArrayList(profile_change.Change) = .empty;
        var likes: std.ArrayList(like_change.Change) = .empty;
        var touched: [keys.len]bool = @splat(false);
        const writes = try case.int(usize, 1, 3);
        for (0..writes) |_| {
            const index = try case.index(keys.len);
            if (touched[index]) continue;
            touched[index] = true;
            const rule: Rule = if (state[index] != null and try case.int(u8, 0, 2) == 0) .delete else .upsert;
            tally.step(rule);
            const key = keys[index];
            switch (rule) {
                .delete => {
                    case.note("commit {d} deletes {s}", .{ seq, key.rkey });
                    state[index] = null;
                    switch (key.kind) {
                        .track => try tracks.append(a, .{ .delete = try deletion(track_change.Delete, a, key, at) }),
                        .list => try lists.append(a, .{ .delete = try deletion(list_change.Delete, a, key, at) }),
                        .like => try likes.append(a, .{ .delete = try deletion(like_change.Delete, a, key, at) }),
                        .profile => try profiles.append(a, .{ .delete = try deletion(profile_change.Delete, a, key, at) }),
                    }
                },
                .upsert => {
                    const variant = try case.int(u8, 0, variants - 1);
                    if (state[index] != null) case.event("a commit rewrites an existing record");
                    case.note("commit {d} writes {s} as {d}", .{ seq, key.rkey, variant });
                    state[index] = variant;
                    switch (key.kind) {
                        .track => try tracks.append(a, try trackUpsert(a, key.rkey, variant, at)),
                        .list => try lists.append(a, try listUpsert(a, key.rkey, variant, at)),
                        .like => try likes.append(a, try likeUpsert(a, key.rkey, variant, at)),
                        .profile => try profiles.append(a, try profileUpsert(a, variant, at)),
                    }
                },
            }
        }
        const next_data = try zat.Cid.forDagCbor(a, try std.fmt.allocPrint(a, "data-{d}", .{seq}));
        const result = try commits.apply(a, .{
            .repo_did = repo,
            .commit_rev = at.commit_rev,
            .commit_cid = at.commit_cid.?,
            .prev_data_cid = data_cid,
            .data_cid = next_data,
            .indexed_at_us = at.indexed_at_us,
            .list_changes = lists.items,
            .track_changes = tracks.items,
            .profile_changes = profiles.items,
            .like_changes = likes.items,
        });
        if (result != .applied) {
            case.note("commit {d} returned {s}", .{ seq, @tagName(result) });
            return case.fail("a commit in the chain did not apply");
        }
        data_cid = next_data;
    }

    const streamed = try dump(pool, a);
    case.note("after the commits:\n{s}", .{streamed});

    seq += 1;
    const final = try snapshotOf(a, state, seq);
    if (try snapshots.apply(a, final) != .applied) return case.fail("a newer snapshot did not apply on top of the commits");
    const repaired = try dump(pool, a);
    if (!std.mem.eql(u8, streamed, repaired)) {
        case.note("after the snapshot on top:\n{s}", .{repaired});
        return case.fail("a snapshot of the same state changed what the commits projected");
    }

    try clear(pool);
    if (try snapshots.apply(a, final) != .applied) return case.fail("the end-state snapshot did not bootstrap");
    const fresh = try dump(pool, a);
    if (!std.mem.eql(u8, streamed, fresh)) {
        case.note("from the snapshot alone:\n{s}", .{fresh});
        return case.fail("the commits and a snapshot of their end state project different records");
    }
    var live: usize = 0;
    for (state) |slot| live += @intFromBool(slot != null);
    if (live == 0) case.event("the chain ends with an empty repository");
    tally.finish(live);
}

fn point(a: std.mem.Allocator, seq: u64) !list_change.Proof {
    const rev = zat.Tid.fromTimestamp(seq * 1_000, 1);
    return .{
        .commit_cid = try zat.Cid.forDagCbor(a, try std.fmt.allocPrint(a, "commit-{d}", .{seq})),
        .commit_rev = try a.dupe(u8, &rev.str()),
        .indexed_at_us = @intCast(seq * 1_000),
    };
}

fn snapshotOf(a: std.mem.Allocator, state: State, seq: u64) !verified_snapshot.Snapshot {
    const at = try point(a, seq);
    var lists: std.ArrayList(list_change.Change) = .empty;
    var tracks: std.ArrayList(track_change.Change) = .empty;
    var profiles: std.ArrayList(profile_change.Change) = .empty;
    var likes: std.ArrayList(like_change.Change) = .empty;
    for (keys, state) |key, slot| {
        const variant = slot orelse continue;
        switch (key.kind) {
            .track => try tracks.append(a, try trackUpsert(a, key.rkey, variant, at)),
            .list => try lists.append(a, try listUpsert(a, key.rkey, variant, at)),
            .like => try likes.append(a, try likeUpsert(a, key.rkey, variant, at)),
            .profile => try profiles.append(a, try profileUpsert(a, variant, at)),
        }
    }
    return .{
        .repo_did = repo,
        .commit_rev = at.commit_rev,
        .commit_cid = at.commit_cid.?,
        .data_cid = try zat.Cid.forDagCbor(a, try std.fmt.allocPrint(a, "data-{d}", .{seq})),
        .list_collection = list_nsid,
        .track_collection = track_nsid,
        .profile_collection = profile_nsid,
        .like_collection = like_nsid,
        .comment_collection = "fm.plyr.dev.comment",
        .indexed_at_us = at.indexed_at_us,
        .list_changes = lists.items,
        .track_changes = tracks.items,
        .profile_changes = profiles.items,
        .like_changes = likes.items,
    };
}

fn recordUri(a: std.mem.Allocator, collection: []const u8, rkey: []const u8) ![]const u8 {
    return std.fmt.allocPrint(a, "at://" ++ repo ++ "/{s}/{s}", .{ collection, rkey });
}

fn recordCid(a: std.mem.Allocator, rkey: []const u8, variant: u8) ![]const u8 {
    const cid = try zat.Cid.forDagCbor(a, try std.fmt.allocPrint(a, "{s}-{d}", .{ rkey, variant }));
    return cid.toString(a);
}

fn collectionOf(kind: Kind) []const u8 {
    return switch (kind) {
        .track => track_nsid,
        .list => list_nsid,
        .like => like_nsid,
        .profile => profile_nsid,
    };
}

fn deletion(comptime T: type, a: std.mem.Allocator, key: Key, at: list_change.Proof) !T {
    return .{
        .record_uri = try recordUri(a, collectionOf(key.kind), key.rkey),
        .owner_did = repo,
        .collection = collectionOf(key.kind),
        .rkey = key.rkey,
        .proof = at,
    };
}

const track_rkeys = [_][]const u8{ "t1", "t2", "t3" };

fn trackUpsert(a: std.mem.Allocator, rkey: []const u8, variant: u8, at: list_change.Proof) !track_change.Change {
    const titles = [_][]const u8{ "first", "second", "third", "fourth" };
    const featured = [_][]const []const u8{ &.{}, &.{"did:plc:guest"}, &.{}, &.{ "did:plc:guest", "did:plc:other" } };
    return .{ .upsert = .{
        .record_uri = try recordUri(a, track_nsid, rkey),
        .record_cid = try recordCid(a, rkey, variant),
        .owner_did = repo,
        .collection = track_nsid,
        .rkey = rkey,
        .title = titles[variant],
        .artist_name = "Artist",
        .file_type = if (variant % 2 == 0) "flac" else "mp3",
        .created_at = "2026-08-08T12:00:00Z",
        .audio_url = "https://media.example/track.flac",
        .audio_blob = null,
        .album = if (variant == 2) "an album" else null,
        .duration_seconds = 40 + @as(u64, variant),
        .featured_dids = featured[variant],
        .image_url = null,
        .support_gate_type = null,
        .download_policy = if (variant == 3) "never" else "ask",
        .description = null,
        .self_labels = &.{},
        .proof = at,
    } };
}

fn listUpsert(a: std.mem.Allocator, rkey: []const u8, variant: u8, at: list_change.Proof) !list_change.Change {
    // variant picks which tracks the list holds, in order
    var members: std.ArrayList(list_change.Member) = .empty;
    for (track_rkeys, 0..) |track, bit| {
        if (variant & (@as(u8, 1) << @intCast(bit)) == 0) continue;
        try members.append(a, .{
            .position = @intCast(members.items.len),
            .track_uri = try recordUri(a, track_nsid, track),
            .track_cid = try recordCid(a, track, 0),
        });
    }
    return .{ .upsert = .{
        .record_uri = try recordUri(a, list_nsid, rkey),
        .record_cid = try recordCid(a, rkey, variant),
        .owner_did = repo,
        .collection = list_nsid,
        .rkey = rkey,
        .list_type = if (variant == 3) .playlist else .album,
        .name = if (variant == 0) null else rkey,
        .created_at = "2026-08-08T12:00:00Z",
        .updated_at = if (variant == 1) "2026-08-09T12:00:00Z" else null,
        .members = members.items,
        .proof = at,
    } };
}

fn likeUpsert(a: std.mem.Allocator, rkey: []const u8, variant: u8, at: list_change.Proof) !like_change.Change {
    const subject = track_rkeys[variant % track_rkeys.len];
    return .{ .upsert = .{
        .record_uri = try recordUri(a, like_nsid, rkey),
        .record_cid = try recordCid(a, rkey, variant),
        .owner_did = repo,
        .collection = like_nsid,
        .rkey = rkey,
        .subject_uri = try recordUri(a, track_nsid, subject),
        .subject_cid = try recordCid(a, subject, variant),
        .created_at = "2026-08-08T12:00:00Z",
        .proof = at,
    } };
}

fn profileUpsert(a: std.mem.Allocator, variant: u8, at: list_change.Proof) !profile_change.Change {
    const bios = [_]?[]const u8{ null, "a bio", "another bio", "" };
    return .{ .upsert = .{
        .record_uri = try recordUri(a, profile_nsid, "self"),
        .record_cid = try recordCid(a, "self", variant),
        .owner_did = repo,
        .collection = profile_nsid,
        .rkey = "self",
        .display_name = if (variant == 2) "Artist" else null,
        .avatar = if (variant == 1) null else "https://media.example/avatar.png",
        .bio = bios[variant],
        .created_at = "2026-08-08T12:00:00Z",
        .updated_at = null,
        .proof = at,
    } };
}

/// every live record and list member, without the columns that say which
/// commit proved it
fn dump(pool: *pg.Pool, a: std.mem.Allocator) ![]const u8 {
    var row = (try pool.row(
        \\WITH lines AS (
        \\  SELECT 'list ' || (to_jsonb(r) - ARRAY['commit_rev', 'commit_cid', 'indexed_at_us'])::text AS line
        \\  FROM plyr_index.list_records AS r WHERE NOT r.deleted
        \\  UNION ALL
        \\  SELECT 'member ' || to_jsonb(m)::text
        \\  FROM plyr_index.list_members AS m
        \\  JOIN plyr_index.list_records AS r ON r.record_uri = m.list_uri AND NOT r.deleted
        \\  UNION ALL
        \\  SELECT 'track ' || (to_jsonb(r) - ARRAY['commit_rev', 'commit_cid', 'indexed_at_us'])::text
        \\  FROM plyr_index.track_records AS r WHERE NOT r.deleted
        \\  UNION ALL
        \\  SELECT 'profile ' || (to_jsonb(r) - ARRAY['commit_rev', 'commit_cid', 'indexed_at_us'])::text
        \\  FROM plyr_index.profile_records AS r WHERE NOT r.deleted
        \\  UNION ALL
        \\  SELECT 'like ' || (to_jsonb(r) - ARRAY['commit_rev', 'commit_cid', 'indexed_at_us'])::text
        \\  FROM plyr_index.like_records AS r WHERE NOT r.deleted
        \\)
        \\SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM lines
    , .{})).?;
    defer row.deinit() catch {};
    return a.dupe(u8, try row.get([]const u8, 0));
}
