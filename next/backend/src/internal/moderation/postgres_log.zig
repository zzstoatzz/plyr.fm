//! The moderation log in PostgreSQL (`plyr_moderation.events`, migration
//! 0048), plus the one projection it owns: an operator's allow/exclude
//! decision on `plyr_index.track_policies`, which feeds, search, radio and
//! stats already read. Labels it signs live in postgres_labels.zig.

const std = @import("std");
const pg = @import("pg");
const log = @import("log.zig");
const Labeler = @import("labeler.zig").Labeler;
const labels = @import("postgres_labels.zig");
const quota = @import("../quota/postgres_quota.zig");

pub const StoredLabel = labels.StoredLabel;
pub const LabelQuery = labels.LabelQuery;

const Action = log.Action;

pub const Error = error{ Unavailable, OutOfMemory, Corrupt, LabelerUnavailable, LabelNotAllowed };

pub const Entry = struct {
    subject: []const u8,
    action: Action,
    actor: []const u8,
    reason_type: ?log.ReasonType = null,
    reason: ?[]const u8 = null,
    /// the label value, for label_applied / label_negated
    label_value: ?[]const u8 = null,
};

pub const Recorded = struct {
    id: i64,
    subject: []const u8,
    action: []const u8,
    actor: []const u8,
    reasonType: ?[]const u8,
    reason: ?[]const u8,
    labelValue: ?[]const u8,
    createdAt: i64,
};

pub const QueueItem = struct {
    /// pass back as `after` for the next page
    cursor: i64,
    subject: []const u8,
    /// the first opening entry since the subject was last closed
    openedAt: i64,
    /// opening entries since then (reports and flags)
    openCount: i64,
    reasonTypes: []const []const u8,
    trackTitle: ?[]const u8,
    trackOwner: ?[]const u8,
    decision: ?[]const u8,
    /// `album` or `playlist` when the subject is a list
    listType: ?[]const u8 = null,
};

/// `unknown`: the subject is not a track, comment or account plyr has seen.
/// `limited`: the reporter is out of their `reports` quota for the hour.
pub const ReportOutcome = enum { recorded, duplicate, unknown, limited };

pub const PostgresModerationLog = struct {
    pool: *pg.Pool,
    track_collection: []const u8,
    /// null: label actions are refused
    labeler: ?*const Labeler = null,

    /// One report per reporter per subject per day; later ones are accepted
    /// and dropped, so a reporter cannot tell they were deduplicated.
    pub fn report(self: *PostgresModerationLog, entry: Entry) Error!ReportOutcome {
        std.debug.assert(entry.action == .reported);
        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        try begin(conn);
        var committed = false;
        defer if (!committed) rollback(conn);
        // one reporter at a time, so a double submit cannot slip past the checks
        try exec(conn, "SELECT pg_advisory_xact_lock(hashtext('moderation-report:' || $1))", .{entry.actor});
        const outcome: ?ReportOutcome = if (!try exists(conn, subject_known_query, .{entry.subject}))
            .unknown
        else if (try exists(conn, recent_report_query, .{ entry.actor, entry.subject }))
            .duplicate
        else if (!try reportGranted(conn, entry.actor))
            .limited
        else
            null;
        if (outcome) |value| return value;
        _ = try insert(conn, entry);
        try commit(conn);
        committed = true;
        return .recorded;
    }

    /// Append one entry and, for a decision on a track, project it in the
    /// same transaction so the log and what listeners see cannot disagree.
    pub fn record(self: *PostgresModerationLog, entry: Entry, now_ms: i64) Error!i64 {
        var signed: ?@import("zat").Label = null;
        var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
        defer arena_state.deinit();
        if (entry.action.isLabel()) {
            const value = entry.label_value orelse return error.LabelNotAllowed;
            if (!log.labelAllowed(entry.subject, value, self.track_collection)) return error.LabelNotAllowed;
            const labeler = self.labeler orelse return error.LabelerUnavailable;
            signed = labeler.sign(arena_state.allocator(), entry.subject, value, entry.action == .label_negated, now_ms) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.LabelerUnavailable,
            };
        } else if (entry.label_value != null) return error.LabelNotAllowed;

        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        try begin(conn);
        var committed = false;
        defer if (!committed) rollback(conn);
        // decisions on one subject apply in log order, so the newest entry
        // is always what listeners see
        try exec(conn, "SELECT pg_advisory_xact_lock(hashtext('moderation-subject:' || $1))", .{entry.subject});
        const id = try insert(conn, entry);
        if (entry.action.decision()) |decision| {
            if (log.isTrack(entry.subject, self.track_collection))
                try project(conn, entry.subject, decision)
            else if (log.isList(entry.subject, self.track_collection))
                try projectList(conn, entry.subject, decision);
        }
        if (signed) |label| {
            try labels.insert(conn, label, id);
            try labels.project(conn, entry.subject, label.val, !label.neg, now_ms * 1000);
        }
        try commit(conn);
        committed = true;
        return id;
    }

    pub fn queue(self: *PostgresModerationLog, allocator: std.mem.Allocator, limit: u16, after: i64) Error![]QueueItem {
        const conn = self.pool.acquire() catch return error.Unavailable;
        defer self.pool.release(conn);
        var result = conn.query(queue_query, .{ @as(i64, limit), after }) catch |err| {
            logQueryError(conn, err);
            return error.Unavailable;
        };
        defer result.deinit();
        var items: std.ArrayList(QueueItem) = .empty;
        while (result.next() catch return error.Unavailable) |row| {
            const reasons = row.get([]const u8, 3) catch return error.Corrupt;
            items.append(allocator, .{
                .cursor = row.get(i64, 7) catch return error.Corrupt,
                .subject = try allocator.dupe(u8, row.get([]const u8, 0) catch return error.Corrupt),
                .openedAt = row.get(i64, 1) catch return error.Corrupt,
                .openCount = row.get(i64, 2) catch return error.Corrupt,
                .reasonTypes = try splitReasons(allocator, reasons),
                .trackTitle = try dupeOptional(allocator, row.get(?[]const u8, 4) catch return error.Corrupt),
                .trackOwner = try dupeOptional(allocator, row.get(?[]const u8, 5) catch return error.Corrupt),
                .decision = try dupeOptional(allocator, row.get(?[]const u8, 6) catch return error.Corrupt),
                .listType = try dupeOptional(allocator, row.get(?[]const u8, 8) catch return error.Corrupt),
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    pub fn queryLabels(self: *PostgresModerationLog, allocator: std.mem.Allocator, request: LabelQuery) Error![]StoredLabel {
        return labels.query(self.pool, allocator, request);
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
                .labelValue = try dupeOptional(allocator, row.get(?[]const u8, 6) catch return error.Corrupt),
                .createdAt = row.get(i64, 7) catch return error.Corrupt,
            }) catch return error.OutOfMemory;
        }
        return entries.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

fn insert(conn: *pg.Conn, entry: Entry) Error!i64 {
    const reason_type: ?[]const u8 = if (entry.reason_type) |value| @tagName(value) else null;
    var row = (conn.row(insert_query, .{ entry.subject, @tagName(entry.action), entry.actor, reason_type, entry.reason, entry.label_value }) catch |err| {
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

/// An album or playlist carries only a decision, so clearing drops its row.
fn projectList(conn: *pg.Conn, record_uri: []const u8, decision: ?[]const u8) Error!void {
    if (decision) |value|
        try exec(conn, set_list_decision, .{ record_uri, value })
    else
        try exec(conn, "DELETE FROM plyr_index.list_policies WHERE record_uri = $1", .{record_uri});
}

fn exec(conn: *pg.Conn, sql: []const u8, args: anytype) Error!void {
    _ = conn.exec(sql, args) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
}

fn exists(conn: *pg.Conn, sql: []const u8, args: anytype) Error!bool {
    var row = conn.row(sql, args) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
    if (row) |*value| {
        value.deinit() catch {};
        return true;
    }
    return false;
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
    \\INSERT INTO plyr_moderation.events (subject_uri, action, actor, reason_type, reason, label_value)
    \\VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
;

const subject_known_query =
    \\SELECT 1 WHERE EXISTS (SELECT 1 FROM plyr_index.track_records WHERE record_uri = $1 AND NOT deleted)
    \\  OR EXISTS (SELECT 1 FROM plyr_index.comment_records WHERE record_uri = $1 AND NOT deleted)
    \\  OR EXISTS (SELECT 1 FROM plyr_index.actor_identities WHERE did = $1)
    \\  OR EXISTS (SELECT 1 FROM plyr_index.track_records WHERE owner_did = $1 AND NOT deleted)
;

/// A report spends one of the reporter's `reports` quota (30 an hour, see
/// migration 0064) in the report's transaction, so a dropped report costs nothing.
fn reportGranted(conn: *pg.Conn, reporter: []const u8) Error!bool {
    var buffer: [64]u8 = undefined;
    var fixed = std.heap.FixedBufferAllocator.init(&buffer);
    const grant = quota.spend(fixed.allocator(), conn, .reports, reporter, 1) catch |err| switch (err) {
        error.Unavailable => return error.Unavailable,
        error.Corrupt => return error.Corrupt,
    };
    return grant.granted;
}

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

const set_list_decision =
    \\INSERT INTO plyr_index.list_policies
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
    \\       coalesce(t.title, l.name), coalesce(t.owner_did, l.owner_did),
    \\       coalesce(p.moderation_decision, lp.moderation_decision), o.first_id, l.list_type
    \\FROM open o
    \\LEFT JOIN plyr_index.track_records t ON t.record_uri = o.subject_uri AND NOT t.deleted
    \\-- an album or playlist can be flagged too (its cover), so it gets a title
    \\LEFT JOIN plyr_index.list_records l ON l.record_uri = o.subject_uri AND NOT l.deleted
    \\LEFT JOIN plyr_index.track_policies p ON p.record_uri = o.subject_uri
    \\LEFT JOIN plyr_index.list_policies lp ON lp.record_uri = o.subject_uri
    \\WHERE o.first_id > $2
    \\ORDER BY o.first_id
    \\LIMIT $1
;

const history_query =
    \\SELECT id, subject_uri, action, actor, reason_type, reason, label_value,
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

    try resetTestSchema(pool);

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
    // reports must name something plyr has seen, and a reporter is rate limited
    try std.testing.expectEqual(ReportOutcome.unknown, try moderation.report(.{ .subject = "at://did:plc:x/fm.plyr.track/nope", .action = .reported, .actor = "did:plc:one", .reason_type = .spam }));
    try std.testing.expectEqual(ReportOutcome.recorded, try moderation.report(.{ .subject = "did:plc:artist", .action = .reported, .actor = "did:plc:one", .reason_type = .impersonation }));
    try std.testing.expectEqual(ReportOutcome.recorded, try moderation.report(.{ .subject = "did:plc:listener", .action = .reported, .actor = "did:plc:one", .reason_type = .harassment }));
    _ = try pool.exec("SELECT plyr_quota.spend('reports', 'did:plc:spammy', 30)", .{});
    try std.testing.expectEqual(ReportOutcome.limited, try moderation.report(.{ .subject = cover, .action = .reported, .actor = "did:plc:spammy", .reason_type = .spam }));
    _ = try moderation.record(.{ .subject = "did:plc:artist", .action = .acknowledged, .actor = "did:plc:operator" }, 0);
    _ = try moderation.record(.{ .subject = "did:plc:listener", .action = .acknowledged, .actor = "did:plc:operator" }, 0);

    _ = try moderation.record(.{ .subject = labeled, .action = .flagged_by_scan, .actor = "scan:audd" }, 0);

    var open = try moderation.queue(arena, 50, 0);
    try std.testing.expectEqual(@as(usize, 2), open.len);
    try std.testing.expectEqualStrings(cover, open[0].subject);
    try std.testing.expectEqual(@as(i64, 2), open[0].openCount);
    try std.testing.expectEqual(@as(usize, 2), open[0].reasonTypes.len);
    try std.testing.expectEqualStrings("a cover", open[0].trackTitle.?);
    try std.testing.expectEqual(@as(?[]const u8, null), open[0].decision);
    const rest = try moderation.queue(arena, 50, open[0].cursor);
    try std.testing.expectEqual(@as(usize, 1), rest.len);
    try std.testing.expectEqualStrings(labeled, rest[0].subject);

    // allowing a cover closes it and projects onto a track with no policy row
    _ = try moderation.record(.{ .subject = cover, .action = .override_allow, .actor = "did:plc:operator", .reason = "licensed cover" }, 0);
    open = try moderation.queue(arena, 50, 0);
    try std.testing.expectEqual(@as(usize, 1), open.len);
    try std.testing.expectEqualStrings(labeled, open[0].subject);
    var policy = (try pool.row("SELECT moderation_decision, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{cover})).?;
    try std.testing.expectEqualStrings("allow", try policy.get([]const u8, 0));
    try std.testing.expectEqualStrings("moderation_log", try policy.get([]const u8, 1));
    try policy.deinit();

    // a fresh report reopens it; the decision stays until someone changes it
    try std.testing.expectEqual(ReportOutcome.recorded, try moderation.report(.{ .subject = cover, .action = .reported, .actor = "did:plc:three", .reason_type = .other }));
    open = try moderation.queue(arena, 50, 0);
    try std.testing.expectEqual(@as(usize, 2), open.len);
    try std.testing.expectEqual(@as(i64, 1), open[1].openCount);
    try std.testing.expectEqualStrings("allow", open[1].decision.?);

    // clearing removes a decision-only row and keeps rows carrying anything else
    _ = try moderation.record(.{ .subject = cover, .action = .override_clear, .actor = "did:plc:operator" }, 0);
    var gone = try pool.row("SELECT 1 FROM plyr_index.track_policies WHERE record_uri=$1", .{cover});
    try std.testing.expect(gone == null);
    if (gone) |*row| try row.deinit();
    _ = try moderation.record(.{ .subject = labeled, .action = .override_exclude, .actor = "did:plc:operator" }, 0);
    _ = try moderation.record(.{ .subject = labeled, .action = .override_clear, .actor = "did:plc:operator" }, 0);
    var kept = (try pool.row("SELECT operator_labels::text, moderation_decision, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{labeled})).?;
    try std.testing.expectEqualStrings("[\"copyright-violation\"]", try kept.get([]const u8, 0));
    try std.testing.expectEqual(@as(?[]const u8, null), try kept.get(?[]const u8, 1));
    try std.testing.expectEqualStrings("moderation_log", try kept.get([]const u8, 2));
    try kept.deinit();
    _ = try moderation.record(.{ .subject = private, .action = .override_exclude, .actor = "did:plc:operator" }, 0);
    _ = try moderation.record(.{ .subject = private, .action = .override_clear, .actor = "did:plc:operator" }, 0);
    var still = (try pool.row("SELECT visibility, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{private})).?;
    try std.testing.expectEqualStrings("private", try still.get([]const u8, 0));
    try std.testing.expectEqual(@as(?[]const u8, null), try still.get(?[]const u8, 1));
    try still.deinit();

    // an album flagged for its cover is listed by name; a decision on it
    // projects onto list policies, and clearing drops the row
    const album = "at://did:plc:artist/fm.plyr.list/album";
    _ = try pool.exec("INSERT INTO plyr_index.list_records VALUES ($1,'did:plc:artist','an album',false,'album')", .{album});
    _ = try moderation.record(.{ .subject = album, .action = .flagged_by_scan, .actor = "scan:cover", .reason = "high: sexual: nudity" }, 0);
    open = try moderation.queue(arena, 50, 0);
    try std.testing.expectEqualStrings(album, open[open.len - 1].subject);
    try std.testing.expectEqualStrings("an album", open[open.len - 1].trackTitle.?);
    try std.testing.expectEqualStrings("album", open[open.len - 1].listType.?);
    _ = try moderation.record(.{ .subject = album, .action = .override_exclude, .actor = "did:plc:operator" }, 0);
    var excluded = (try pool.row("SELECT moderation_decision FROM plyr_index.list_policies WHERE record_uri=$1", .{album})).?;
    try std.testing.expectEqualStrings("exclude", try excluded.get([]const u8, 0));
    try excluded.deinit();
    _ = try moderation.record(.{ .subject = album, .action = .override_clear, .actor = "did:plc:operator" }, 0);
    var cleared = try pool.row("SELECT 1 FROM plyr_index.list_policies WHERE record_uri=$1", .{album});
    try std.testing.expect(cleared == null);
    if (cleared) |*row| try row.deinit();

    // other subjects are logged without touching any policy
    _ = try moderation.record(.{ .subject = "did:plc:spammer", .action = .override_exclude, .actor = "did:plc:operator" }, 0);
    const entries = try moderation.history(arena, cover);
    try std.testing.expectEqual(@as(usize, 5), entries.len);
    try std.testing.expectEqualStrings("reported", entries[0].action);
    try std.testing.expectEqualStrings("this is someone else's song", entries[0].reason.?);
    try std.testing.expectEqualStrings("override_clear", entries[4].action);
}

/// A minimal plyr_index plus migrations 0048-0049, for this file's and
/// postgres_labels.zig's tests.
pub fn resetTestSchema(pool: *pg.Pool) !void {
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
    _ = try pool.exec("CREATE TABLE plyr_index.list_records (record_uri text PRIMARY KEY, owner_did text, name text, deleted boolean NOT NULL DEFAULT false, list_type text)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.list_policies (record_uri text PRIMARY KEY, moderation_decision text NOT NULL, moderation_write_source text NOT NULL, moderation_observed_at_us bigint NOT NULL)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.comment_records (record_uri text PRIMARY KEY, deleted boolean NOT NULL DEFAULT false)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.actor_identities (did text PRIMARY KEY)", .{});
    _ = try pool.exec("INSERT INTO plyr_index.actor_identities VALUES ('did:plc:listener')", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.account_label_policies (owner_did text PRIMARY KEY, operator_labels jsonb NOT NULL CHECK (operator_labels = '[\"ai\"]'::jsonb), observed_at_us bigint NOT NULL, expires_at_us bigint)", .{});
    _ = try pool.exec(@embedFile("migration_0048"), .{});
    _ = try pool.exec(@embedFile("migration_0049"), .{});
    try quota.resetTestSchema(pool);
}
