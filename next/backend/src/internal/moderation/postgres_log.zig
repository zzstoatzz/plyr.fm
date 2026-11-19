//! The moderation log in PostgreSQL (`plyr_moderation.events`, migration
//! 0048), plus the one projection it owns: an operator's allow/exclude
//! decision on `plyr_index.track_policies`, which feeds, search, radio and
//! stats already read.

const std = @import("std");
const pg = @import("pg");
const log = @import("log.zig");

const Action = log.Action;

pub const Error = error{ Unavailable, OutOfMemory, Corrupt };

pub const Entry = struct {
    subject: []const u8,
    action: Action,
    actor: []const u8,
    reason_type: ?log.ReasonType = null,
    reason: ?[]const u8 = null,
};

pub const Recorded = struct {
    id: i64,
    subject: []const u8,
    action: []const u8,
    actor: []const u8,
    reasonType: ?[]const u8,
    reason: ?[]const u8,
    createdAt: i64,
};

pub const QueueItem = struct {
    subject: []const u8,
    /// the first opening entry since the subject was last closed
    openedAt: i64,
    /// opening entries since then (reports and flags)
    openCount: i64,
    reasonTypes: []const []const u8,
    trackTitle: ?[]const u8,
    trackOwner: ?[]const u8,
    decision: ?[]const u8,
};

pub const ReportOutcome = enum { recorded, duplicate };

pub const PostgresModerationLog = struct {
    pool: *pg.Pool,
    track_collection: []const u8,

    /// One report per reporter per subject per day; later ones are accepted
    /// and dropped, so a reporter cannot tell they were deduplicated.
    pub fn report(self: *PostgresModerationLog, entry: Entry) Error!ReportOutcome {
        std.debug.assert(entry.action == .reported);
        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        try begin(conn);
        var committed = false;
        defer if (!committed) rollback(conn);
        var existing = (conn.row(recent_report_query, .{ entry.actor, entry.subject }) catch |err| {
            logQueryError(conn, err);
            return error.Unavailable;
        });
        if (existing) |*row| {
            row.deinit() catch {};
            rollback(conn);
            committed = true;
            return .duplicate;
        }
        _ = try insert(conn, entry);
        try commit(conn);
        committed = true;
        return .recorded;
    }

    /// Append one entry and, for a decision on a track, project it in the
    /// same transaction so the log and what listeners see cannot disagree.
    pub fn record(self: *PostgresModerationLog, entry: Entry) Error!i64 {
        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        try begin(conn);
        var committed = false;
        defer if (!committed) rollback(conn);
        const id = try insert(conn, entry);
        if (entry.action.decision()) |decision| {
            if (log.isTrack(entry.subject, self.track_collection)) try project(conn, entry.subject, decision);
        }
        try commit(conn);
        committed = true;
        return id;
    }

    pub fn queue(self: *PostgresModerationLog, allocator: std.mem.Allocator, limit: u16) Error![]QueueItem {
        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        var result = conn.query(queue_query, .{@as(i64, limit)}) catch |err| {
            logQueryError(conn, err);
            return error.Unavailable;
        };
        defer result.deinit();
        var items: std.ArrayList(QueueItem) = .empty;
        while (result.next() catch return error.Unavailable) |row| {
            const reasons = row.get([]const u8, 3) catch return error.Corrupt;
            items.append(allocator, .{
                .subject = try allocator.dupe(u8, row.get([]const u8, 0) catch return error.Corrupt),
                .openedAt = row.get(i64, 1) catch return error.Corrupt,
                .openCount = row.get(i64, 2) catch return error.Corrupt,
                .reasonTypes = try splitReasons(allocator, reasons),
                .trackTitle = try dupeOptional(allocator, row.get(?[]const u8, 4) catch return error.Corrupt),
                .trackOwner = try dupeOptional(allocator, row.get(?[]const u8, 5) catch return error.Corrupt),
                .decision = try dupeOptional(allocator, row.get(?[]const u8, 6) catch return error.Corrupt),
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    pub fn history(self: *PostgresModerationLog, allocator: std.mem.Allocator, subject: []const u8) Error![]Recorded {
        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        var result = conn.query(history_query, .{subject}) catch |err| {
            logQueryError(conn, err);
            return error.Unavailable;
        };
        defer result.deinit();
        var entries: std.ArrayList(Recorded) = .empty;
        while (result.next() catch return error.Unavailable) |row| {
            entries.append(allocator, .{
                .id = row.get(i64, 0) catch return error.Corrupt,
                .subject = try allocator.dupe(u8, row.get([]const u8, 1) catch return error.Corrupt),
                .action = try allocator.dupe(u8, row.get([]const u8, 2) catch return error.Corrupt),
                .actor = try allocator.dupe(u8, row.get([]const u8, 3) catch return error.Corrupt),
                .reasonType = try dupeOptional(allocator, row.get(?[]const u8, 4) catch return error.Corrupt),
                .reason = try dupeOptional(allocator, row.get(?[]const u8, 5) catch return error.Corrupt),
                .createdAt = row.get(i64, 6) catch return error.Corrupt,
            }) catch return error.OutOfMemory;
        }
        return entries.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

fn insert(conn: *pg.Conn, entry: Entry) Error!i64 {
    const reason_type: ?[]const u8 = if (entry.reason_type) |value| @tagName(value) else null;
    var row = (conn.row(insert_query, .{ entry.subject, @tagName(entry.action), entry.actor, reason_type, entry.reason }) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    }) orelse return error.Corrupt;
    defer row.deinit() catch {};
    return row.get(i64, 0) catch return error.Corrupt;
}

/// `decision` null clears: the row goes when nothing else is on it (the
/// table refuses an empty policy), otherwise only the decision does.
fn project(conn: *pg.Conn, record_uri: []const u8, decision: ?[]const u8) Error!void {
    if (decision == null) _ = conn.exec(drop_empty_policy, .{record_uri}) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
    const result = if (decision) |value|
        conn.exec(set_decision, .{ record_uri, value })
    else
        conn.exec(clear_decision, .{record_uri});
    _ = result catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
}

fn begin(conn: *pg.Conn) Error!void {
    // the api's role defaults to read-only transactions
    _ = conn.exec("BEGIN READ WRITE", .{}) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
}

fn commit(conn: *pg.Conn) Error!void {
    _ = conn.exec("COMMIT", .{}) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
}

fn rollback(conn: *pg.Conn) void {
    _ = conn.exec("ROLLBACK", .{}) catch {};
}

fn dupeOptional(allocator: std.mem.Allocator, value: ?[]const u8) Error!?[]const u8 {
    return if (value) |text| allocator.dupe(u8, text) catch return error.OutOfMemory else null;
}

fn splitReasons(allocator: std.mem.Allocator, joined: []const u8) Error![]const []const u8 {
    var out: std.ArrayList([]const u8) = .empty;
    var it = std.mem.tokenizeScalar(u8, joined, ',');
    while (it.next()) |part| out.append(allocator, allocator.dupe(u8, part) catch return error.OutOfMemory) catch return error.OutOfMemory;
    return out.toOwnedSlice(allocator) catch return error.OutOfMemory;
}

fn logQueryError(conn: *pg.Conn, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("moderation query failed: {}: {s}", .{ err, pg_err.message })
    else
        std.log.err("moderation query failed: {}", .{err});
}

const insert_query =
    \\INSERT INTO plyr_moderation.events (subject_uri, action, actor, reason_type, reason)
    \\VALUES ($1, $2, $3, $4, $5) RETURNING id
;

const recent_report_query =
    \\SELECT 1 FROM plyr_moderation.events
    \\WHERE action = 'reported' AND actor = $1 AND subject_uri = $2
    \\  AND created_at > clock_timestamp() - interval '1 day'
    \\LIMIT 1
;

const set_decision =
    \\INSERT INTO plyr_index.track_policies
    \\  (record_uri, moderation_decision, moderation_write_source, moderation_observed_at_us)
    \\VALUES ($1, $2, 'moderation_log', (extract(epoch FROM clock_timestamp()) * 1000000)::bigint)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  moderation_decision = EXCLUDED.moderation_decision,
    \\  moderation_write_source = 'moderation_log',
    \\  moderation_observed_at_us = EXCLUDED.moderation_observed_at_us
;

const clear_decision =
    \\UPDATE plyr_index.track_policies SET
    \\  moderation_decision = NULL,
    \\  moderation_write_source = CASE WHEN jsonb_array_length(operator_labels) = 0 THEN NULL
    \\    ELSE moderation_write_source END,
    \\  moderation_observed_at_us = CASE WHEN jsonb_array_length(operator_labels) = 0 THEN NULL
    \\    ELSE moderation_observed_at_us END
    \\WHERE record_uri = $1
;

const drop_empty_policy =
    \\DELETE FROM plyr_index.track_policies
    \\WHERE record_uri = $1 AND visibility IS NULL AND jsonb_array_length(operator_labels) = 0
;

const queue_query =
    \\WITH closed AS (
    \\  SELECT subject_uri, max(id) AS id FROM plyr_moderation.events
    \\  WHERE action IN
++ log.SQL_CLOSING ++
    \\ GROUP BY subject_uri
    \\), open AS (
    \\  SELECT e.subject_uri,
    \\         min(e.id) AS first_id,
    \\         (extract(epoch FROM min(e.created_at)) * 1000)::bigint AS opened_at_ms,
    \\         count(*) AS open_count,
    \\         coalesce(string_agg(DISTINCT e.reason_type, ','), '') AS reasons
    \\  FROM plyr_moderation.events e
    \\  LEFT JOIN closed c ON c.subject_uri = e.subject_uri
    \\  WHERE e.action IN
++ log.SQL_OPENING ++
    \\ AND e.id > coalesce(c.id, 0)
    \\  GROUP BY e.subject_uri
    \\)
    \\SELECT o.subject_uri, o.opened_at_ms, o.open_count, o.reasons,
    \\       t.title, t.owner_did, p.moderation_decision
    \\FROM open o
    \\LEFT JOIN plyr_index.track_records t ON t.record_uri = o.subject_uri AND NOT t.deleted
    \\LEFT JOIN plyr_index.track_policies p ON p.record_uri = o.subject_uri
    \\ORDER BY o.first_id
    \\LIMIT $1
;

const history_query =
    \\SELECT id, subject_uri, action, actor, reason_type, reason,
    \\       (extract(epoch FROM created_at) * 1000)::bigint
    \\FROM plyr_moderation.events WHERE subject_uri = $1 ORDER BY id
;

test "the log derives the queue and projects decisions onto track policies" {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    var database = try @import("../index/postgres_track_store.zig").PostgresTrackStore.init(allocator, io, std.mem.span(url), 2);
    defer database.deinit();
    const pool = database.pool;
    var name = (try pool.row("SELECT current_database()", .{})).?;
    const safe = std.mem.eql(u8, try name.get([]const u8, 0), "zig_test");
    try name.deinit();
    if (!safe) return error.UnsafeTestDatabase;

    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_moderation CASCADE", .{});
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_records (record_uri text PRIMARY KEY, owner_did text, title text, deleted boolean NOT NULL DEFAULT false)", .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_policies (
        \\  record_uri text PRIMARY KEY, visibility text,
        \\  operator_labels jsonb NOT NULL DEFAULT '[]', moderation_decision text,
        \\  moderation_write_source text, moderation_observed_at_us bigint,
        \\  CONSTRAINT ck_track_policies_nonempty CHECK (visibility IS NOT NULL OR jsonb_array_length(operator_labels) > 0 OR moderation_decision IS NOT NULL))
    , .{});
    _ = try pool.exec(@embedFile("migration_0048"), .{});

    const cover = "at://did:plc:artist/fm.plyr.track/cover";
    const labeled = "at://did:plc:artist/fm.plyr.track/labeled";
    const private = "at://did:plc:artist/fm.plyr.track/private";
    _ = try pool.exec("INSERT INTO plyr_index.track_records VALUES ($1,'did:plc:artist','a cover',false),($2,'did:plc:artist','labeled',false)", .{ cover, labeled });
    _ = try pool.exec("INSERT INTO plyr_index.track_policies (record_uri, operator_labels, moderation_write_source, moderation_observed_at_us) VALUES ($1,'[\"copyright-violation\"]','labeler_sync',1)", .{labeled});
    _ = try pool.exec("INSERT INTO plyr_index.track_policies (record_uri, visibility) VALUES ($1,'private')", .{private});

    var moderation: PostgresModerationLog = .{ .pool = pool, .track_collection = "fm.plyr.track" };
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    // two reporters, one of them twice: the duplicate is dropped
    try std.testing.expectEqual(ReportOutcome.recorded, try moderation.report(.{ .subject = cover, .action = .reported, .actor = "did:plc:one", .reason_type = .copyright, .reason = "this is someone else's song" }));
    try std.testing.expectEqual(ReportOutcome.duplicate, try moderation.report(.{ .subject = cover, .action = .reported, .actor = "did:plc:one", .reason_type = .copyright }));
    try std.testing.expectEqual(ReportOutcome.recorded, try moderation.report(.{ .subject = cover, .action = .reported, .actor = "did:plc:two", .reason_type = .spam }));
    _ = try moderation.record(.{ .subject = labeled, .action = .flagged_by_scan, .actor = "scan:audd" });

    var open = try moderation.queue(arena, 50);
    try std.testing.expectEqual(@as(usize, 2), open.len);
    try std.testing.expectEqualStrings(cover, open[0].subject);
    try std.testing.expectEqual(@as(i64, 2), open[0].openCount);
    try std.testing.expectEqual(@as(usize, 2), open[0].reasonTypes.len);
    try std.testing.expectEqualStrings("a cover", open[0].trackTitle.?);
    try std.testing.expectEqual(@as(?[]const u8, null), open[0].decision);

    // allowing a cover closes it and projects onto a track with no policy row
    _ = try moderation.record(.{ .subject = cover, .action = .override_allow, .actor = "did:plc:operator", .reason = "licensed cover" });
    open = try moderation.queue(arena, 50);
    try std.testing.expectEqual(@as(usize, 1), open.len);
    try std.testing.expectEqualStrings(labeled, open[0].subject);
    var policy = (try pool.row("SELECT moderation_decision, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{cover})).?;
    try std.testing.expectEqualStrings("allow", try policy.get([]const u8, 0));
    try std.testing.expectEqualStrings("moderation_log", try policy.get([]const u8, 1));
    try policy.deinit();

    // a fresh report reopens it; the decision stays until someone changes it
    try std.testing.expectEqual(ReportOutcome.recorded, try moderation.report(.{ .subject = cover, .action = .reported, .actor = "did:plc:three", .reason_type = .other }));
    open = try moderation.queue(arena, 50);
    try std.testing.expectEqual(@as(usize, 2), open.len);
    try std.testing.expectEqual(@as(i64, 1), open[1].openCount);
    try std.testing.expectEqualStrings("allow", open[1].decision.?);

    // clearing removes a decision-only row and keeps rows carrying anything else
    _ = try moderation.record(.{ .subject = cover, .action = .override_clear, .actor = "did:plc:operator" });
    var gone = try pool.row("SELECT 1 FROM plyr_index.track_policies WHERE record_uri=$1", .{cover});
    try std.testing.expect(gone == null);
    if (gone) |*row| try row.deinit();
    _ = try moderation.record(.{ .subject = labeled, .action = .override_exclude, .actor = "did:plc:operator" });
    _ = try moderation.record(.{ .subject = labeled, .action = .override_clear, .actor = "did:plc:operator" });
    var kept = (try pool.row("SELECT operator_labels::text, moderation_decision, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{labeled})).?;
    try std.testing.expectEqualStrings("[\"copyright-violation\"]", try kept.get([]const u8, 0));
    try std.testing.expectEqual(@as(?[]const u8, null), try kept.get(?[]const u8, 1));
    try std.testing.expectEqualStrings("moderation_log", try kept.get([]const u8, 2));
    try kept.deinit();
    _ = try moderation.record(.{ .subject = private, .action = .override_exclude, .actor = "did:plc:operator" });
    _ = try moderation.record(.{ .subject = private, .action = .override_clear, .actor = "did:plc:operator" });
    var still = (try pool.row("SELECT visibility, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{private})).?;
    try std.testing.expectEqualStrings("private", try still.get([]const u8, 0));
    try std.testing.expectEqual(@as(?[]const u8, null), try still.get(?[]const u8, 1));
    try still.deinit();

    // non-track subjects are logged without touching track policies
    _ = try moderation.record(.{ .subject = "did:plc:spammer", .action = .override_exclude, .actor = "did:plc:operator" });
    const entries = try moderation.history(arena, cover);
    try std.testing.expectEqual(@as(usize, 5), entries.len);
    try std.testing.expectEqualStrings("reported", entries[0].action);
    try std.testing.expectEqualStrings("this is someone else's song", entries[0].reason.?);
    try std.testing.expectEqualStrings("override_clear", entries[4].action);
}
