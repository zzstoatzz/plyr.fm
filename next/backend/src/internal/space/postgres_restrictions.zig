//! PostgreSQL adapter for access.Restrictions, and the one writer of
//! `plyr_account.space_removals` (migration 0051).
//!
//! A space is closed when moderation took down a track whose audio lives in
//! it: an `exclude` decision, or the copyright label without an `allow`, the
//! same reading feeds use. Only the space authority's own tracks count, so a
//! stranger's record pointing into someone else's space cannot close it, and
//! a deleted track still counts, so deleting the public record does not undo
//! a takedown. A reader is removed when the authority put them on their list.

const std = @import("std");
const pg = @import("pg");
const access = @import("access.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

/// how many readers one artist may remove; the list is returned whole
pub const maximum_removals = 1000;

pub const Removal = struct { did: []const u8, removedAt: []const u8 };

pub const RemoveOutcome = enum { removed, already, full };

pub const PostgresRestrictions = struct {
    pool: *pg.Pool,

    pub fn restrictions(self: *PostgresRestrictions) access.Restrictions {
        return .{ .context = self, .closed_fn = closedFn, .removed_fn = removedFn };
    }

    fn of(context: *anyopaque) *PostgresRestrictions {
        return @ptrCast(@alignCast(context));
    }

    fn closedFn(context: *anyopaque, _: std.mem.Allocator, authority: []const u8, space_uri: []const u8) anyerror!bool {
        var row = (try of(context).pool.row(closed_sql, .{ authority, space_uri })) orelse return error.Unavailable;
        defer row.deinit() catch {};
        return row.get(bool, 0);
    }

    fn removedFn(context: *anyopaque, _: std.mem.Allocator, authority: []const u8, reader: []const u8) anyerror!bool {
        var row = (try of(context).pool.row(removed_sql, .{ authority, reader })) orelse return error.Unavailable;
        defer row.deinit() catch {};
        return row.get(bool, 0);
    }

    pub fn remove(self: *PostgresRestrictions, authority: []const u8, reader: []const u8) !RemoveOutcome {
        var row = (try self.pool.row(remove_sql, .{ authority, reader, @as(i64, maximum_removals) })) orelse return error.Unavailable;
        defer row.deinit() catch {};
        const outcome = try row.get([]const u8, 0);
        return std.meta.stringToEnum(RemoveOutcome, outcome) orelse error.Corrupt;
    }

    pub fn restore(self: *PostgresRestrictions, authority: []const u8, reader: []const u8) !void {
        _ = try self.pool.exec("DELETE FROM plyr_account.space_removals WHERE authority_did = $1 AND reader_did = $2", .{ authority, reader });
    }

    /// newest first; slices are allocated from `allocator`
    pub fn list(self: *PostgresRestrictions, allocator: std.mem.Allocator, authority: []const u8) ![]Removal {
        var result = try self.pool.query(list_sql, .{ authority, @as(i64, maximum_removals) });
        defer result.deinit();
        var out: std.ArrayList(Removal) = .empty;
        while (try result.next()) |row| {
            try out.append(allocator, .{
                .did = try allocator.dupe(u8, try row.get([]const u8, 0)),
                .removedAt = try allocator.dupe(u8, try row.get([]const u8, 1)),
            });
        }
        return out.toOwnedSlice(allocator);
    }
};

const closed_sql =
    \\SELECT EXISTS (
    \\  SELECT 1 FROM plyr_index.track_records t
    \\  JOIN plyr_index.track_policies p ON p.record_uri = t.record_uri
    \\  WHERE t.owner_did = $1
    \\    AND t.audio_space IS NOT NULL
    \\    AND left(t.audio_space, length($2) + 1) = $2 || '/'
    \\    AND (
    \\      p.moderation_decision = 'exclude'
    \\      OR (p.moderation_decision IS DISTINCT FROM 'allow'
    \\          AND COALESCE(p.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation'])
    \\    )
    \\)
;

const removed_sql =
    \\SELECT EXISTS (SELECT 1 FROM plyr_account.space_removals WHERE authority_did = $1 AND reader_did = $2)
;

// one statement, so two removals racing past the cap can overshoot it by at
// most one each, never unboundedly
const remove_sql =
    \\WITH present AS (
    \\  SELECT 1 FROM plyr_account.space_removals WHERE authority_did = $1 AND reader_did = $2
    \\), room AS (
    \\  SELECT count(*) < $3 AS ok FROM plyr_account.space_removals WHERE authority_did = $1
    \\), inserted AS (
    \\  INSERT INTO plyr_account.space_removals (authority_did, reader_did)
    \\  SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM present) AND (SELECT ok FROM room)
    \\  ON CONFLICT DO NOTHING
    \\  RETURNING 1
    \\)
    \\SELECT CASE
    \\  WHEN EXISTS (SELECT 1 FROM present) THEN 'already'
    \\  WHEN EXISTS (SELECT 1 FROM inserted) THEN 'removed'
    \\  WHEN NOT (SELECT ok FROM room) THEN 'full'
    \\  ELSE 'already'
    \\END
;

const list_sql =
    \\SELECT reader_did, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    \\FROM plyr_account.space_removals WHERE authority_did = $1
    \\ORDER BY created_at DESC, reader_did
    \\LIMIT $2
;

test "takedowns close the space their audio lives in; removals shut out one reader" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    var pool = try pg.Pool.initUri(io, allocator, try std.Uri.parse(std.mem.span(url_z)), .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_account CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_account CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_records (record_uri text PRIMARY KEY, owner_did text NOT NULL, audio_space text, deleted boolean NOT NULL DEFAULT false)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_policies (record_uri text PRIMARY KEY, operator_labels jsonb NOT NULL DEFAULT '[]', moderation_decision text)", .{});
    _ = try pool.exec(@embedFile("migration_0051_space_removals"), .{});

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    var adapter: PostgresRestrictions = .{ .pool = pool };
    const port = adapter.restrictions();

    const artist = "did:plc:artist";
    const album = "at://did:plc:artist/space/fm.plyr.next.audio/3album";
    const single = "at://did:plc:artist/space/fm.plyr.next.audio/3single";
    // a space whose name extends the album's must not be caught by the prefix
    const album2 = "at://did:plc:artist/space/fm.plyr.next.audio/3album2";
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri, owner_did, audio_space) VALUES
        \\ ('at://did:plc:artist/fm.plyr.track/1', 'did:plc:artist', $1 || '/did:plc:artist/fm.plyr.track/1'),
        \\ ('at://did:plc:artist/fm.plyr.track/2', 'did:plc:artist', $2 || '/did:plc:artist/fm.plyr.track/2'),
        \\ ('at://did:plc:artist/fm.plyr.track/3', 'did:plc:artist', $3 || '/did:plc:artist/fm.plyr.track/3'),
        \\ ('at://did:plc:troll/fm.plyr.track/9', 'did:plc:troll', $2 || '/did:plc:troll/fm.plyr.track/9')
    , .{ album, single, album2 });
    try std.testing.expect(!try port.closed(a, artist, album));

    _ = try pool.exec("INSERT INTO plyr_index.track_policies (record_uri, moderation_decision) VALUES ('at://did:plc:artist/fm.plyr.track/1', 'exclude')", .{});
    try std.testing.expect(try port.closed(a, artist, album));
    try std.testing.expect(!try port.closed(a, artist, album2));
    try std.testing.expect(!try port.closed(a, artist, single));
    // deleting the public record does not reopen it
    _ = try pool.exec("UPDATE plyr_index.track_records SET deleted = true WHERE record_uri = 'at://did:plc:artist/fm.plyr.track/1'", .{});
    try std.testing.expect(try port.closed(a, artist, album));

    // a copyright label closes it unless a moderator allowed the track
    _ = try pool.exec("INSERT INTO plyr_index.track_policies (record_uri, operator_labels) VALUES ('at://did:plc:artist/fm.plyr.track/3', '[\"copyright-violation\"]')", .{});
    try std.testing.expect(try port.closed(a, artist, album2));
    _ = try pool.exec("UPDATE plyr_index.track_policies SET moderation_decision = 'allow' WHERE record_uri = 'at://did:plc:artist/fm.plyr.track/3'", .{});
    try std.testing.expect(!try port.closed(a, artist, album2));

    // someone else's track pointing into the artist's space cannot close it
    _ = try pool.exec("INSERT INTO plyr_index.track_policies (record_uri, moderation_decision) VALUES ('at://did:plc:troll/fm.plyr.track/9', 'exclude')", .{});
    try std.testing.expect(!try port.closed(a, artist, single));

    try std.testing.expect(!try port.removed(a, artist, "did:plc:fan"));
    try std.testing.expectEqual(RemoveOutcome.removed, try adapter.remove(artist, "did:plc:fan"));
    try std.testing.expectEqual(RemoveOutcome.already, try adapter.remove(artist, "did:plc:fan"));
    try std.testing.expect(try port.removed(a, artist, "did:plc:fan"));
    try std.testing.expect(!try port.removed(a, "did:plc:other", "did:plc:fan"));
    const listed = try adapter.list(a, artist);
    try std.testing.expectEqual(@as(usize, 1), listed.len);
    try std.testing.expectEqualStrings("did:plc:fan", listed[0].did);
    try std.testing.expect(std.mem.endsWith(u8, listed[0].removedAt, "Z"));
    try adapter.restore(artist, "did:plc:fan");
    try std.testing.expect(!try port.removed(a, artist, "did:plc:fan"));
    try adapter.restore(artist, "did:plc:fan");

    // the list is bounded
    _ = try pool.exec("INSERT INTO plyr_account.space_removals (authority_did, reader_did) SELECT 'did:plc:busy', 'did:plc:r' || n FROM generate_series(1, $1) n", .{@as(i64, maximum_removals)});
    try std.testing.expectEqual(RemoveOutcome.full, try adapter.remove("did:plc:busy", "did:plc:one-more"));
    try std.testing.expectEqual(RemoveOutcome.already, try adapter.remove("did:plc:busy", "did:plc:r1"));
}

fn requireDisposableDatabase(pool: *pg.Pool) !void {
    var row = try pool.row("SELECT current_database()", .{}) orelse return error.MissingDatabase;
    defer row.deinit() catch {};
    if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
}
