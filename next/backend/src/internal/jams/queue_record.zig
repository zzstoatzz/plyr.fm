//! PostgreSQL record of each personal queue. Redis holds the live copy.

const std = @import("std");
const pg = @import("pg");
const model = @import("model.zig");
const postgres_url = @import("../index/postgres_url.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

pub const Records = struct {
    pool: *pg.Pool,

    pub fn init(allocator: std.mem.Allocator, io: std.Io, database_url: []const u8, pool_size: u16) !Records {
        var normalized = try postgres_url.normalize(allocator, database_url);
        defer normalized.deinit(allocator);
        const uri = try std.Uri.parse(normalized.value);
        return .{ .pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = pool_size, .connect_on_init_count = 1 }) };
    }

    pub fn deinit(self: *Records) void {
        self.pool.deinit();
    }

    /// The stored state as JSON, owned by `allocator`.
    pub fn load(self: *Records, allocator: std.mem.Allocator, owner: []const u8) !?[]const u8 {
        var row = try self.pool.row(load_sql, .{owner}) orelse return null;
        defer row.deinit() catch {};
        return try allocator.dupe(u8, try row.get([]const u8, 0));
    }

    pub fn save(self: *Records, allocator: std.mem.Allocator, owner: []const u8, state: model.State, now_ms: i64) !void {
        const json = try std.json.Stringify.valueAlloc(allocator, resting(state, now_ms), .{});
        defer allocator.free(json);
        _ = try self.pool.exec(save_sql, .{ owner, state.epoch, @as(i64, @intCast(state.revision)), json });
    }
};

/// What a later session starts from: paused at the current position, owned by no device.
pub fn resting(state: model.State, now_ms: i64) model.State {
    var stored = state;
    stored.positionMs = model.positionAt(state, now_ms);
    stored.playing = false;
    if (stored.personal) |*personal| {
        personal.output = null;
        personal.disconnected = false;
    }
    return stored;
}

const load_sql =
    \\SELECT state::text FROM plyr_playback.queue_records WHERE owner_did = $1
;

const save_sql =
    \\INSERT INTO plyr_playback.queue_records (owner_did, epoch, revision, state)
    \\VALUES ($1, $2, $3, $4::jsonb)
    \\ON CONFLICT (owner_did) DO UPDATE SET
    \\  epoch = EXCLUDED.epoch,
    \\  revision = EXCLUDED.revision,
    \\  state = EXCLUDED.state,
    \\  updated_at = clock_timestamp()
    \\WHERE plyr_playback.queue_records.epoch <> EXCLUDED.epoch
    \\   OR plyr_playback.queue_records.revision <= EXCLUDED.revision
;

test "a queue record keeps the newest revision of an epoch and rests paused" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    var name = try pool.row("SELECT current_database()", .{}) orelse return error.MissingDatabase;
    const disposable = std.mem.eql(u8, try name.get([]const u8, 0), "zig_test");
    try name.deinit();
    if (!disposable) return error.UnsafeTestDatabase;
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_playback CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_playback CASCADE", .{}) catch null;
    _ = try pool.exec(@embedFile("migration_0035_queue_records"), .{});

    var records: Records = .{ .pool = pool };
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    try std.testing.expect(try records.load(allocator, owner) == null);
    const track: model.Track = .{ .id = "trk_YXQ6Ly9kaWQ6cGxjOmFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEvZm0ucGx5ci50cmFjay8zazI", .uri = "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.track/3k2", .cid = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae", .durationMs = 60_000, .key = "current" };
    const playing: model.State = .{ .epoch = "first", .revision = 4, .queue = &.{track}, .index = 0, .occurrence = 1, .playing = true, .positionMs = 1_000, .updatedAtMs = 10_000, .personal = .{ .explicitEnd = 1, .output = .{ .clientId = "device", .connectionId = "connection" } } };
    try records.save(allocator, owner, playing, 15_000);
    var older = playing;
    older.revision = 3;
    older.positionMs = 50_000;
    try records.save(allocator, owner, older, 15_000);

    const stored = (try records.load(allocator, owner)).?;
    defer allocator.free(stored);
    const parsed = try std.json.parseFromSlice(model.State, allocator, stored, .{});
    defer parsed.deinit();
    try std.testing.expectEqual(@as(u64, 4), parsed.value.revision);
    try std.testing.expectEqual(@as(u64, 6_000), parsed.value.positionMs);
    try std.testing.expect(!parsed.value.playing);
    try std.testing.expect(parsed.value.personal.?.output == null);

    var restarted = playing;
    restarted.epoch = "second";
    restarted.revision = 0;
    try records.save(allocator, owner, restarted, 15_000);
    const replaced = (try records.load(allocator, owner)).?;
    defer allocator.free(replaced);
    try std.testing.expect(std.mem.indexOf(u8, replaced, "\"second\"") != null);
}
