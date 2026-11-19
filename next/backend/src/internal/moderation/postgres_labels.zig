//! Labels next's labeler signed (`plyr_moderation.labels`, migration 0049):
//! written in the same transaction as the log entry that decided them
//! (postgres_log.zig), projected onto the policy tables feeds read, and
//! served by queryLabels.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");

pub const Error = error{ Unavailable, OutOfMemory, Corrupt };

/// `com.atproto.label.defs#label` as queryLabels returns it
pub const StoredLabel = struct {
    seq: i64,
    src: []const u8,
    uri: []const u8,
    cid: ?[]const u8,
    val: []const u8,
    neg: bool,
    cts: []const u8,
    exp: ?[]const u8,
    sig: []const u8,
};

pub const LabelQuery = struct {
    /// exact URIs, and prefixes (a pattern ending in `*`, star removed)
    exact: []const []const u8,
    prefixes: []const []const u8,
    sources: []const []const u8,
    after_seq: i64,
    limit: u16,
};

pub fn query(pool: *pg.Pool, allocator: std.mem.Allocator, request: LabelQuery) Error![]StoredLabel {
    const conn = pool.acquire() catch return error.Unavailable;
    defer pool.release(conn);
    var likes: std.ArrayList([]const u8) = .empty;
    for (request.prefixes) |prefix| {
        var escaped: std.ArrayList(u8) = .empty;
        for (prefix) |byte| {
            if (byte == '%' or byte == '_' or byte == '\\') escaped.append(allocator, '\\') catch return error.OutOfMemory;
            escaped.append(allocator, byte) catch return error.OutOfMemory;
        }
        escaped.append(allocator, '%') catch return error.OutOfMemory;
        likes.append(allocator, escaped.items) catch return error.OutOfMemory;
    }
    var result = conn.query(query_labels, .{ request.after_seq, request.exact, likes.items, request.sources, @as(i64, request.limit) }) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
    defer result.deinit();
    var found: std.ArrayList(StoredLabel) = .empty;
    while (result.next() catch return error.Unavailable) |row| {
        found.append(allocator, .{
            .seq = row.get(i64, 0) catch return error.Corrupt,
            .src = try allocator.dupe(u8, row.get([]const u8, 1) catch return error.Corrupt),
            .uri = try allocator.dupe(u8, row.get([]const u8, 2) catch return error.Corrupt),
            .cid = try dupeOptional(allocator, row.get(?[]const u8, 3) catch return error.Corrupt),
            .val = try allocator.dupe(u8, row.get([]const u8, 4) catch return error.Corrupt),
            .neg = row.get(bool, 5) catch return error.Corrupt,
            .cts = try allocator.dupe(u8, row.get([]const u8, 6) catch return error.Corrupt),
            .exp = try dupeOptional(allocator, row.get(?[]const u8, 7) catch return error.Corrupt),
            .sig = try allocator.dupe(u8, row.get([]const u8, 8) catch return error.Corrupt),
        }) catch return error.OutOfMemory;
    }
    return found.toOwnedSlice(allocator) catch return error.OutOfMemory;
}

pub fn insert(conn: *pg.Conn, label: zat.Label, event_id: i64) Error!void {
    _ = conn.exec(insert_label, .{ label.src, label.uri, label.cid, label.val, label.neg, label.cts, label.exp, label.sig.?, event_id }) catch |err| {
        logQueryError(conn, err);
        return error.Unavailable;
    };
}

/// What the label means for listeners, written where label_sync writes the
/// same values from prod's labeler.
pub fn project(conn: *pg.Conn, subject: []const u8, value: []const u8, active: bool, now_us: i64) Error!void {
    const account = std.mem.startsWith(u8, subject, "did:");
    const steps: []const []const u8 = if (account)
        (if (active) &.{add_account_label} else &.{remove_account_label})
    else if (active)
        &.{add_track_label}
    else
        &.{ drop_label_only_policy, remove_track_label };
    for (steps) |sql| {
        const outcome = if (account and active)
            conn.exec(sql, .{ subject, now_us })
        else if (account)
            conn.exec(sql, .{subject})
        else if (sql.ptr == drop_label_only_policy.ptr)
            conn.exec(sql, .{ subject, value })
        else
            conn.exec(sql, .{ subject, value, now_us });
        _ = outcome catch |err| {
            logQueryError(conn, err);
            return error.Unavailable;
        };
    }
}

fn dupeOptional(allocator: std.mem.Allocator, value: ?[]const u8) Error!?[]const u8 {
    return if (value) |text| allocator.dupe(u8, text) catch return error.OutOfMemory else null;
}

fn logQueryError(conn: *pg.Conn, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("label query failed: {}: {s}", .{ err, pg_err.message })
    else
        std.log.err("label query failed: {}", .{err});
}

const insert_label =
    \\INSERT INTO plyr_moderation.labels (src, uri, cid, val, neg, cts, exp, sig, event_id)
    \\VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
;

const query_labels =
    \\SELECT seq, src, uri, cid, val, neg, cts, exp, sig FROM plyr_moderation.labels
    \\WHERE seq > $1
    \\  AND (uri = ANY($2::text[]) OR uri LIKE ANY($3::text[]))
    \\  AND (cardinality($4::text[]) = 0 OR src = ANY($4::text[]))
    \\ORDER BY seq LIMIT $5
;

const add_track_label =
    \\INSERT INTO plyr_index.track_policies (
    \\  record_uri, operator_labels, moderation_write_source, moderation_observed_at_us
    \\) VALUES ($1, jsonb_build_array($2::text), 'moderation_log', $3)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  operator_labels = to_jsonb(ARRAY(
    \\    SELECT DISTINCT v FROM jsonb_array_elements_text(
    \\      plyr_index.track_policies.operator_labels || EXCLUDED.operator_labels) AS v
    \\    ORDER BY v)),
    \\  moderation_write_source = 'moderation_log',
    \\  moderation_observed_at_us = EXCLUDED.moderation_observed_at_us
;

const drop_label_only_policy =
    \\DELETE FROM plyr_index.track_policies
    \\WHERE record_uri = $1 AND visibility IS NULL AND moderation_decision IS NULL
    \\  AND operator_labels <@ jsonb_build_array($2::text)
;

const remove_track_label =
    \\UPDATE plyr_index.track_policies SET
    \\  operator_labels = operator_labels - $2::text,
    \\  moderation_write_source = CASE
    \\    WHEN jsonb_array_length(operator_labels - $2::text) = 0 AND moderation_decision IS NULL THEN NULL
    \\    ELSE 'moderation_log' END,
    \\  moderation_observed_at_us = CASE
    \\    WHEN jsonb_array_length(operator_labels - $2::text) = 0 AND moderation_decision IS NULL THEN NULL
    \\    ELSE $3::bigint END
    \\WHERE record_uri = $1 AND operator_labels ? $2::text
;

const add_account_label =
    \\INSERT INTO plyr_index.account_label_policies (owner_did, operator_labels, observed_at_us, expires_at_us)
    \\VALUES ($1, '["ai"]', $2, NULL)
    \\ON CONFLICT (owner_did) DO UPDATE SET operator_labels = EXCLUDED.operator_labels,
    \\  observed_at_us = EXCLUDED.observed_at_us, expires_at_us = NULL
;

const remove_account_label =
    \\DELETE FROM plyr_index.account_label_policies WHERE owner_did = $1
;

test "operator labels are signed, projected, negated and served in seq order" {
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
    const postgres_log = @import("postgres_log.zig");
    try postgres_log.resetTestSchema(pool);

    const cover = "at://did:plc:artist/fm.plyr.track/cover";
    const labeled = "at://did:plc:artist/fm.plyr.track/labeled";
    _ = try pool.exec("INSERT INTO plyr_index.track_records VALUES ($1,'did:plc:artist','a cover',false),($2,'did:plc:artist','labeled',false)", .{ cover, labeled });
    _ = try pool.exec("INSERT INTO plyr_index.track_policies (record_uri, operator_labels, moderation_write_source, moderation_observed_at_us) VALUES ($1,'[\"copyright-violation\"]','labeler_sync',1)", .{labeled});
    var moderation: postgres_log.PostgresModerationLog = .{ .pool = pool, .track_collection = "fm.plyr.track" };
    const Labeler = @import("labeler.zig").Labeler;
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    // labels: refused with no labeler, then signed, stored and projected
    try std.testing.expectError(error.LabelerUnavailable, moderation.record(.{ .subject = cover, .action = .label_applied, .actor = "did:plc:operator", .label_value = "copyright-violation" }, 1_000));
    const labeler = try Labeler.fromHex("did:web:api.next.plyr.fm", "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d");
    moderation.labeler = &labeler;
    try std.testing.expectError(error.LabelNotAllowed, moderation.record(.{ .subject = cover, .action = .label_applied, .actor = "did:plc:operator", .label_value = "ai" }, 1_000));
    try std.testing.expectError(error.LabelNotAllowed, moderation.record(.{ .subject = cover, .action = .override_allow, .actor = "did:plc:operator", .label_value = "porn" }, 1_000));
    _ = try moderation.record(.{ .subject = cover, .action = .label_applied, .actor = "did:plc:operator", .label_value = "copyright-violation" }, 1_000);
    _ = try moderation.record(.{ .subject = labeled, .action = .label_applied, .actor = "did:plc:operator", .label_value = "sexual" }, 2_000);
    _ = try moderation.record(.{ .subject = "did:plc:artist", .action = .label_applied, .actor = "did:plc:operator", .label_value = "ai" }, 3_000);
    var applied = (try pool.row("SELECT operator_labels::text, moderation_write_source FROM plyr_index.track_policies WHERE record_uri=$1", .{cover})).?;
    try std.testing.expectEqualStrings("[\"copyright-violation\"]", try applied.get([]const u8, 0));
    try std.testing.expectEqualStrings("moderation_log", try applied.get([]const u8, 1));
    try applied.deinit();
    var merged = (try pool.row("SELECT operator_labels::text FROM plyr_index.track_policies WHERE record_uri=$1", .{labeled})).?;
    try std.testing.expectEqualStrings("[\"copyright-violation\", \"sexual\"]", try merged.get([]const u8, 0));
    try merged.deinit();
    var account = (try pool.row("SELECT observed_at_us FROM plyr_index.account_label_policies WHERE owner_did='did:plc:artist'", .{})).?;
    try std.testing.expectEqual(@as(i64, 3_000_000), try account.get(i64, 0));
    try account.deinit();

    // negations undo the projection; the label row stays as history
    _ = try moderation.record(.{ .subject = cover, .action = .label_negated, .actor = "did:plc:operator", .label_value = "copyright-violation" }, 4_000);
    _ = try moderation.record(.{ .subject = "did:plc:artist", .action = .label_negated, .actor = "did:plc:operator", .label_value = "ai" }, 5_000);
    var gone = try pool.row("SELECT 1 FROM plyr_index.track_policies WHERE record_uri=$1", .{cover});
    try std.testing.expect(gone == null);
    if (gone) |*row| try row.deinit();
    var no_account = try pool.row("SELECT 1 FROM plyr_index.account_label_policies WHERE owner_did='did:plc:artist'", .{});
    try std.testing.expect(no_account == null);
    if (no_account) |*row| try row.deinit();

    // queryLabels: seq order, prefixes, cursors, and signatures that verify
    const all = try moderation.queryLabels(arena, .{ .exact = &.{}, .prefixes = &.{ "at://", "did:" }, .sources = &.{}, .after_seq = 0, .limit = 50 });
    try std.testing.expectEqual(@as(usize, 5), all.len);
    try std.testing.expectEqualStrings("copyright-violation", all[0].val);
    try std.testing.expect(all[3].neg);
    try std.testing.expectEqualStrings("1970-01-01T00:00:04.000Z", all[3].cts);
    const did_key = try labeler.keypair.did(arena);
    for (all) |stored| {
        const label: zat.Label = .{ .src = stored.src, .uri = stored.uri, .cid = stored.cid, .val = stored.val, .neg = stored.neg, .cts = stored.cts, .exp = stored.exp, .sig = stored.sig };
        try label.verify(arena, did_key);
    }
    const one = try moderation.queryLabels(arena, .{ .exact = &.{cover}, .prefixes = &.{}, .sources = &.{}, .after_seq = 0, .limit = 1 });
    try std.testing.expectEqual(@as(usize, 1), one.len);
    const next_page = try moderation.queryLabels(arena, .{ .exact = &.{cover}, .prefixes = &.{}, .sources = &.{}, .after_seq = one[0].seq, .limit = 50 });
    try std.testing.expectEqual(@as(usize, 1), next_page.len);
    try std.testing.expect(next_page[0].neg);
    // LIKE wildcards in a prefix are literal
    const literal = try moderation.queryLabels(arena, .{ .exact = &.{}, .prefixes = &.{"at://did:plc:artist/fm.plyr.track/_"}, .sources = &.{}, .after_seq = 0, .limit = 50 });
    try std.testing.expectEqual(@as(usize, 0), literal.len);
    const elsewhere = try moderation.queryLabels(arena, .{ .exact = &.{}, .prefixes = &.{"did:"}, .sources = &.{"did:plc:someone-else"}, .after_seq = 0, .limit = 50 });
    try std.testing.expectEqual(@as(usize, 0), elsewhere.len);
}
