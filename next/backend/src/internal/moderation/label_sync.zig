//! Operator labels from plyr's labeler onto `plyr_index.track_policies`, so
//! next hides and gates the same tracks prod does (`copyright-violation`
//! drops a track from listings and playback; `porn`/`sexual` gate it).
//!
//! Polls `com.atproto.label.queryLabels` in the labeler's seq order. Like the
//! jetstreams, the labeler host is trusted rather than signature-checked.
//! Applying a label is idempotent (set add/remove), so replaying a page is
//! safe: the labeler only returns a cursor for a full page, so the last,
//! partial page is re-read each poll until it fills. Runs beside the ingester.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");

const log = std.log.scoped(.label_sync);
const user_agent = "plyr.fm-zig-labels/0.1 (+https://plyr.fm)";
const page_limit = 250;

/// The values the projection accepts (ck_track_policies_labels).
pub const track_label_values = [_][]const u8{ "copyright-violation", "porn", "sexual" };

pub const Settings = struct {
    /// empty disables the sync
    labeler_url: []const u8 = "https://moderation.plyr.fm",
    poll_ms: i64 = 60_000,
    track_collection: []const u8,

    pub fn fromEnvironment(track_collection: []const u8) Settings {
        var settings: Settings = .{ .track_collection = track_collection };
        if (std.c.getenv("LABELER_URL")) |raw|
            settings.labeler_url = std.mem.trimEnd(u8, std.mem.span(raw), "/");
        return settings;
    }
};

pub const Change = struct {
    uri: []const u8,
    value: []const u8,
    active: bool,
    account: bool = false,
    expires_at_us: ?i64 = null,
};

pub const Page = struct {
    changes: []Change,
    cursor: ?[]const u8,
};

/// The track-label changes on one queryLabels page, in order. Labels on other
/// subjects or with values the projection doesn't hold are skipped; an
/// expired label counts as removed.
pub fn parsePage(arena: std.mem.Allocator, body: []const u8, track_collection: []const u8, now_ms: i64) !Page {
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{}) catch return error.CorruptLabels;
    if (parsed != .object) return error.CorruptLabels;
    const labels = parsed.object.get("labels") orelse return error.CorruptLabels;
    if (labels != .array) return error.CorruptLabels;
    var changes: std.ArrayList(Change) = .empty;
    for (labels.array.items) |label| {
        if (label != .object) return error.CorruptLabels;
        const uri = stringField(label, "uri") orelse return error.CorruptLabels;
        const value = stringField(label, "val") orelse return error.CorruptLabels;
        const account = zat.Did.parse(uri) != null;
        if (account) {
            if (!std.mem.eql(u8, value, "ai")) continue;
        } else {
            const at = zat.AtUri.parse(uri) orelse continue;
            const collection = at.collection() orelse continue;
            if (!std.mem.eql(u8, collection, track_collection) or at.rkey() == null) continue;
            if (!isTrackValue(value)) continue;
        }
        var active = true;
        var expires_at_us: ?i64 = null;
        if (label.object.get("neg")) |neg| {
            if (neg == .bool and neg.bool) active = false;
        }
        if (stringField(label, "exp")) |exp| {
            if (parseMillis(exp)) |exp_ms| {
                if (exp_ms <= now_ms) active = false;
                expires_at_us = std.math.mul(i64, exp_ms, 1000) catch return error.CorruptLabels;
            }
        }
        try changes.append(arena, .{ .uri = uri, .value = value, .active = active, .account = account, .expires_at_us = expires_at_us });
    }
    const cursor = stringField(parsed, "cursor");
    return .{ .changes = try changes.toOwnedSlice(arena), .cursor = if (cursor) |c| (if (c.len == 0) null else c) else null };
}

fn isTrackValue(value: []const u8) bool {
    for (track_label_values) |allowed| if (std.mem.eql(u8, allowed, value)) return true;
    return false;
}

fn stringField(value: std.json.Value, key: []const u8) ?[]const u8 {
    if (value != .object) return null;
    const field = value.object.get(key) orelse return null;
    return if (field == .string) field.string else null;
}

/// `YYYY-MM-DDTHH:MM:SS[.fff]Z` to unix milliseconds; null if it isn't that.
fn parseMillis(text: []const u8) ?i64 {
    if (text.len < 20 or text[4] != '-' or text[7] != '-' or text[10] != 'T' or
        text[13] != ':' or text[16] != ':') return null;
    const year = std.fmt.parseInt(i64, text[0..4], 10) catch return null;
    const month = std.fmt.parseInt(u8, text[5..7], 10) catch return null;
    const day = std.fmt.parseInt(u8, text[8..10], 10) catch return null;
    const hour = std.fmt.parseInt(i64, text[11..13], 10) catch return null;
    const minute = std.fmt.parseInt(i64, text[14..16], 10) catch return null;
    const second = std.fmt.parseInt(i64, text[17..19], 10) catch return null;
    if (month < 1 or month > 12 or day < 1 or day > 31) return null;
    // days from civil (Howard Hinnant)
    const y = if (month <= 2) year - 1 else year;
    const era = @divFloor(y, 400);
    const yoe = y - era * 400;
    const m: i64 = month;
    const doy = @divFloor(153 * (if (m > 2) m - 3 else m + 9) + 2, 5) + day - 1;
    const doe = yoe * 365 + @divFloor(yoe, 4) - @divFloor(yoe, 100) + doy;
    const days = era * 146097 + doe - 719468;
    return ((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000;
}

pub fn spawnBeside(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, track_collection: []const u8) void {
    const settings = Settings.fromEnvironment(track_collection);
    if (settings.labeler_url.len == 0) {
        log.info("label sync off (LABELER_URL empty)", .{});
        return;
    }
    const thread = std.Thread.spawn(.{}, backgroundMain, .{ io, allocator, pool, settings }) catch |err| {
        log.err("label sync disabled, thread spawn failed: {}", .{err});
        return;
    };
    thread.detach();
}

fn backgroundMain(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, settings: Settings) void {
    run(io, allocator, pool, settings) catch |err| log.err("label sync stopped: {}", .{err});
}

pub fn run(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, settings: Settings) !void {
    var transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer transport.deinit();
    const source = try std.fmt.allocPrint(allocator, "labels:v2:{s}", .{settings.labeler_url});
    defer allocator.free(source);
    log.info("label sync running against {s}", .{settings.labeler_url});
    while (true) {
        const full_page = poll(io, allocator, pool, &transport, settings, source) catch |err| blk: {
            log.warn("label sync poll failed: {}", .{err});
            break :blk false;
        };
        if (!full_page) try io.sleep(std.Io.Duration.fromMilliseconds(settings.poll_ms), .awake);
    }
}

/// One page. True when a cursor came back, i.e. there's more to read now.
fn poll(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    transport: *zat.HttpTransport,
    settings: Settings,
    source: []const u8,
) !bool {
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const conn = pool.acquire() catch return error.StoreUnavailable;
    defer pool.release(conn);

    var cursor: ?i64 = null;
    if (conn.row(load_cursor_sql, .{source}) catch |err| return storeError(conn, err)) |found| {
        var row = found;
        defer row.deinit() catch {};
        cursor = row.get(i64, 0) catch return error.CorruptCursor;
    }

    const url = if (cursor) |c|
        try std.fmt.allocPrint(arena, "{s}/xrpc/com.atproto.label.queryLabels?uriPatterns=at%3A%2F%2F*%2Cdid%3A*&limit={d}&cursor={d}", .{ settings.labeler_url, page_limit, c })
    else
        try std.fmt.allocPrint(arena, "{s}/xrpc/com.atproto.label.queryLabels?uriPatterns=at%3A%2F%2F*%2Cdid%3A*&limit={d}", .{ settings.labeler_url, page_limit });
    var result = transport.fetch(.{
        .url = url,
        .accept = "application/json",
        .max_response_size = 4 * 1024 * 1024,
        .on_redirect = .refuse,
        .deadline_ns = 30 * std.time.ns_per_s,
    }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.LabelerUnavailable,
    };
    defer result.deinit(transport.allocator);
    if (result.status != .ok) return error.LabelerUnavailable;

    const now_us = std.Io.Timestamp.now(io, .real).toMicroseconds();
    const page = try parsePage(arena, result.body, settings.track_collection, @divFloor(now_us, 1000));
    try applyPage(conn, page, now_us);
    const next = page.cursor orelse return false;
    const next_seq = std.fmt.parseInt(i64, next, 10) catch return error.CorruptLabels;
    _ = conn.exec(save_cursor_sql, .{ source, next_seq, now_us }) catch |err| return storeError(conn, err);
    if (page.changes.len > 0) log.info("applied {d} labels through seq {d}", .{ page.changes.len, next_seq });
    return true;
}

pub fn applyPage(conn: *pg.Conn, page: Page, now_us: i64) !void {
    for (page.changes) |change| {
        if (change.account) {
            if (change.active) {
                _ = conn.exec(add_account_sql, .{ change.uri, now_us, change.expires_at_us }) catch |err| return storeError(conn, err);
            } else {
                _ = conn.exec("DELETE FROM plyr_index.account_label_policies WHERE owner_did = $1", .{change.uri}) catch |err| return storeError(conn, err);
            }
        } else if (change.active) {
            _ = conn.exec(add_sql, .{ change.uri, change.value, now_us }) catch |err| return storeError(conn, err);
        } else {
            _ = conn.exec(drop_empty_sql, .{ change.uri, change.value }) catch |err| return storeError(conn, err);
            _ = conn.exec(remove_sql, .{ change.uri, change.value, now_us }) catch |err| return storeError(conn, err);
        }
    }
}

fn storeError(conn: *pg.Conn, err: anyerror) error{StoreUnavailable} {
    if (conn.err) |pg_err|
        log.err("label sync store: {}: {s}", .{ err, pg_err.message })
    else
        log.err("label sync store: {}", .{err});
    return error.StoreUnavailable;
}

const load_cursor_sql =
    \\SELECT seq FROM plyr_index.relay_cursors WHERE source = $1
;

const save_cursor_sql =
    \\INSERT INTO plyr_index.relay_cursors (source, seq, updated_at_us)
    \\VALUES ($1, $2, $3)
    \\ON CONFLICT (source) DO UPDATE SET seq = EXCLUDED.seq, updated_at_us = EXCLUDED.updated_at_us
    \\WHERE plyr_index.relay_cursors.seq < EXCLUDED.seq
;

const add_sql =
    \\INSERT INTO plyr_index.track_policies (
    \\  record_uri, operator_labels, moderation_write_source, moderation_observed_at_us
    \\) VALUES ($1, jsonb_build_array($2::text), 'labeler_sync', $3)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  operator_labels = to_jsonb(ARRAY(
    \\    SELECT DISTINCT v FROM jsonb_array_elements_text(
    \\      plyr_index.track_policies.operator_labels || EXCLUDED.operator_labels) AS v
    \\    ORDER BY v)),
    \\  moderation_write_source = 'labeler_sync',
    \\  moderation_observed_at_us = EXCLUDED.moderation_observed_at_us
;

/// a row whose only content is this label goes away entirely
const drop_empty_sql =
    \\DELETE FROM plyr_index.track_policies
    \\WHERE record_uri = $1
    \\  AND visibility IS NULL
    \\  AND moderation_decision IS NULL
    \\  AND operator_labels <@ jsonb_build_array($2::text)
;

const remove_sql =
    \\UPDATE plyr_index.track_policies SET
    \\  operator_labels = operator_labels - $2::text,
    \\  moderation_write_source = CASE
    \\    WHEN jsonb_array_length(operator_labels - $2::text) = 0 AND moderation_decision IS NULL THEN NULL
    \\    ELSE 'labeler_sync' END,
    \\  moderation_observed_at_us = CASE
    \\    WHEN jsonb_array_length(operator_labels - $2::text) = 0 AND moderation_decision IS NULL THEN NULL
    \\    ELSE $3::bigint END
    \\WHERE record_uri = $1 AND operator_labels ? $2::text
;

test "label pages keep track labels in order and honor negation and expiry" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const page = try parsePage(arena_state.allocator(),
        \\{"cursor":"42","labels":[
        \\ {"src":"did:plc:mod","uri":"at://did:plc:a/fm.plyr.track/3k1","val":"copyright-violation","cts":"2026-01-01T00:00:00.000Z"},
        \\ {"src":"did:plc:mod","uri":"at://did:plc:a/fm.plyr.track/3k1","val":"copyright-violation","neg":true,"cts":"2026-01-02T00:00:00.000Z"},
        \\ {"src":"did:plc:mod","uri":"at://did:plc:a/fm.plyr.track/3k2","val":"porn","cts":"2026-01-01T00:00:00.000Z","exp":"2026-02-01T00:00:00.000Z"},
        \\ {"src":"did:plc:mod","uri":"at://did:plc:a/fm.plyr.track/3k3","val":"sexual","cts":"2026-01-01T00:00:00.000Z","exp":"2027-02-01T00:00:00Z"},
        \\ {"src":"did:plc:mod","uri":"at://did:plc:a/fm.plyr.dev.track/3k4","val":"porn","cts":"2026-01-01T00:00:00.000Z"},
        \\ {"src":"did:plc:mod","uri":"did:plc:a","val":"porn","cts":"2026-01-01T00:00:00.000Z"},
        \\ {"src":"did:plc:mod","uri":"at://did:plc:a/fm.plyr.track/3k5","val":"spam","cts":"2026-01-01T00:00:00.000Z"}
        \\]}
    , "fm.plyr.track", parseMillis("2026-11-03T00:00:00Z").?);
    try std.testing.expectEqualStrings("42", page.cursor.?);
    try std.testing.expectEqual(@as(usize, 4), page.changes.len);
    try std.testing.expect(page.changes[0].active);
    try std.testing.expect(!page.changes[1].active);
    try std.testing.expect(!page.changes[2].active); // expired
    try std.testing.expect(page.changes[3].active);
    try std.testing.expectEqualStrings("sexual", page.changes[3].value);

    const last = try parsePage(arena_state.allocator(), "{\"labels\":[]}", "fm.plyr.track", 0);
    try std.testing.expect(last.cursor == null);
    try std.testing.expectError(error.CorruptLabels, parsePage(arena_state.allocator(), "{\"labels\":[{\"uri\":1}]}", "fm.plyr.track", 0));
}

test "label timestamps" {
    try std.testing.expectEqual(@as(?i64, 0), parseMillis("1970-01-01T00:00:00Z"));
    try std.testing.expectEqual(@as(?i64, 1_767_225_600_000), parseMillis("2026-01-01T00:00:00.000Z"));
    try std.testing.expect(parseMillis("nope") == null);
}

const add_account_sql =
    \\INSERT INTO plyr_index.account_label_policies (owner_did, operator_labels, observed_at_us, expires_at_us)
    \\VALUES ($1, '["ai"]', $2, $3)
    \\ON CONFLICT (owner_did) DO UPDATE SET operator_labels = EXCLUDED.operator_labels,
    \\  observed_at_us = EXCLUDED.observed_at_us, expires_at_us = EXCLUDED.expires_at_us
;

test "account AI labels stay separate from track labels" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const page = try parsePage(arena.allocator(),
        \\{"labels":[
        \\ {"uri":"did:plc:account","val":"ai","exp":"2099-01-01T00:00:00Z"},
        \\ {"uri":"did:plc:account","val":"ai","neg":true},
        \\ {"uri":"did:plc:account","val":"porn"},
        \\ {"uri":"at://did:plc:account/fm.plyr.track/a","val":"ai"},
        \\ {"uri":"at://did:plc:account/fm.plyr.track/a","val":"porn"}
        \\]}
    , "fm.plyr.track", 0);
    try std.testing.expectEqual(@as(usize, 3), page.changes.len);
    try std.testing.expect(page.changes[0].account and page.changes[0].active);
    try std.testing.expectEqual(parseMillis("2099-01-01T00:00:00Z").? * 1000, page.changes[0].expires_at_us.?);
    try std.testing.expect(page.changes[1].account and !page.changes[1].active);
    try std.testing.expect(!page.changes[2].account);
}
