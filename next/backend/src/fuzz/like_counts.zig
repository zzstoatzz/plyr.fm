//! `track_like_counts` (migrations/0029) is kept by triggers. Random
//! histories of the writes every writer makes (like upserts, retargets and
//! tombstones from the projector, owner purges from the snapshot reconciler,
//! availability changes from the account reconciler, truncation) must leave
//! it equal, after every step, to counting distinct available likers from
//! scratch. Needs the disposable `zig_test` database in
//! `PLYR_ZIG_TEST_DATABASE_URL`; without it the group reports a skip.

const std = @import("std");
const hegel = @import("hegel");
const pg = @import("pg");
const like_store = @import("../internal/projection/postgres_like_store.zig");
const availability_store = @import("../internal/account/postgres_availability_store.zig");
const like_counts = @import("../internal/projection/like_counts.zig");

const Rule = enum { like, tombstone, purge_owner, set_available, forget_account, truncate };
var tally: hegel.Tally(Rule) = .{};

const owners = [_][]const u8{ "did:plc:a", "did:plc:b", "did:plc:c" };
const subjects = [_][]const u8{ "at://did:plc:x/fm.plyr.dev.track/one", "at://did:plc:x/fm.plyr.dev.track/two" };
const cids = [_][]const u8{ "bafyone", "bafytwo" };
const rkeys = [_][]const u8{ "l1", "l2", "l3" };

pub fn run() error{PropertyFailed}!void {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse {
        std.debug.print("-- like_counts.triggers skipped: set PLYR_ZIG_TEST_DATABASE_URL to the zig_test database\n", .{});
        return;
    };
    var threaded = std.Io.Threaded.init(std.heap.smp_allocator, .{});
    defer threaded.deinit();
    const uri = std.Uri.parse(std.mem.span(url)) catch @panic("PLYR_ZIG_TEST_DATABASE_URL is not a URL");
    const pool = pg.Pool.initUri(threaded.io(), std.heap.smp_allocator, uri, .{ .size = 1 }) catch |err|
        std.debug.panic("cannot reach the test database: {}", .{err});
    defer pool.deinit();
    requireDisposable(pool);

    std.debug.print("-- like_counts.triggers\n", .{});
    const outcome = hegel.run(.{ .key = "like_counts.triggers" }, pool, triggers);
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
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try like_store.createTestTable(pool);
    try availability_store.createTestTable(pool);
    try like_counts.applyTestMigration(pool);
}

fn triggers(pool: *pg.Pool, case: *hegel.TestCase) !void {
    try reset(pool);
    tally.case();
    var machine = try case.machine(Rule, &.{ 6, 2, 1, 3, 1, 1 }, 24);
    defer machine.deinit();
    while (try machine.next()) |rule| {
        tally.step(rule);
        const owner = owners[try case.index(owners.len)];
        switch (rule) {
            .like => {
                const rkey = rkeys[try case.index(rkeys.len)];
                const subject = try case.index(subjects.len);
                case.note("{s} likes {s} as {s}", .{ owner, subjects[subject], rkey });
                _ = try pool.exec(
                    \\INSERT INTO plyr_index.like_records (record_uri, record_cid, owner_did, collection, rkey,
                    \\  subject_uri, subject_cid, record_created_at, deleted, commit_rev, indexed_at_us)
                    \\VALUES ('at://' || $1 || '/fm.plyr.dev.like/' || $2, 'bafylike', $1, 'fm.plyr.dev.like', $2,
                    \\  $3, $4, '2026-01-01T00:00:00Z', false, '3jzfcijpj2z2a', 1)
                    \\ON CONFLICT (record_uri) DO UPDATE SET record_cid = EXCLUDED.record_cid,
                    \\  subject_uri = EXCLUDED.subject_uri, subject_cid = EXCLUDED.subject_cid,
                    \\  record_created_at = EXCLUDED.record_created_at, deleted = false
                , .{ owner, rkey, subjects[subject], cids[subject] });
            },
            .tombstone => {
                const rkey = rkeys[try case.index(rkeys.len)];
                case.note("{s} deletes {s}", .{ owner, rkey });
                _ = try pool.exec(
                    \\UPDATE plyr_index.like_records SET deleted = true, record_cid = NULL,
                    \\  subject_uri = NULL, subject_cid = NULL, record_created_at = NULL
                    \\WHERE owner_did = $1 AND rkey = $2
                , .{ owner, rkey });
            },
            .purge_owner => {
                case.note("snapshot purges {s}", .{owner});
                _ = try pool.exec("DELETE FROM plyr_index.like_records WHERE owner_did = $1", .{owner});
            },
            .set_available => {
                const available = try case.boolean();
                case.note("{s} available = {}", .{ owner, available });
                _ = try pool.exec(
                    \\INSERT INTO plyr_index.account_availability (repo_did, available, unavailable_reason,
                    \\  evidence_source, pds_origin, observed_at_us)
                    \\VALUES ($1, $2, CASE WHEN $2 THEN NULL ELSE 'deactivated' END, 'current_pds', 'https://pds.example', 1)
                    \\ON CONFLICT (repo_did) DO UPDATE SET available = EXCLUDED.available,
                    \\  unavailable_reason = EXCLUDED.unavailable_reason
                , .{ owner, available });
                if (!available) case.event("an account with likes goes unavailable");
            },
            .forget_account => {
                case.note("{s} availability row removed", .{owner});
                _ = try pool.exec("DELETE FROM plyr_index.account_availability WHERE repo_did = $1", .{owner});
            },
            .truncate => {
                case.note("likes truncated", .{});
                _ = try pool.exec("TRUNCATE plyr_index.like_records", .{});
            },
        }
        if (try divergence(pool)) return case.fail("maintained like counts differ from a recount");
    }
    var row = (try pool.row("SELECT coalesce(sum(like_count), 0)::bigint FROM plyr_index.track_like_counts", .{})).?;
    defer row.deinit() catch {};
    const total = try row.get(i64, 0);
    if (total > 1) case.event("a subject counts more than one liker");
    tally.finish(@intCast(total));
}

/// rows in either the maintained table or a recount but not both
fn divergence(pool: *pg.Pool) !bool {
    var row = (try pool.row(
        \\WITH recount AS (
        \\  SELECT likes.collection, likes.subject_uri, likes.subject_cid,
        \\    count(DISTINCT likes.owner_did)::bigint AS like_count
        \\  FROM plyr_index.like_records AS likes
        \\  JOIN plyr_index.account_availability AS liker
        \\    ON liker.repo_did = likes.owner_did AND liker.available
        \\  WHERE NOT likes.deleted
        \\  GROUP BY 1, 2, 3
        \\), kept AS (
        \\  SELECT collection, subject_uri, subject_cid, like_count FROM plyr_index.track_like_counts
        \\)
        \\SELECT (SELECT count(*) FROM (SELECT * FROM recount EXCEPT SELECT * FROM kept) AS missing)
        \\     + (SELECT count(*) FROM (SELECT * FROM kept EXCEPT SELECT * FROM recount) AS extra)
    , .{})).?;
    defer row.deinit() catch {};
    return try row.get(i64, 0) != 0;
}
