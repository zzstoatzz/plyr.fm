//! Appearance and playback settings an account keeps across devices.

const std = @import("std");
const pg = @import("pg");
const tag_filter = @import("../domain/tag_filter.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

pub const Patch = struct {
    theme: ?[]const u8 = null,
    accent: ?[]const u8 = null,
    font: ?[]const u8 = null,
    keepPlaying: ?bool = null,
    playThrough: ?bool = null,
    scale: ?u16 = null,
    hiddenTags: ?[]const []const u8 = null,

    pub fn valid(self: Patch) bool {
        if (self.theme) |value| if (!oneOf(value, &.{ "system", "light", "dark" })) return false;
        if (self.font) |value| if (!oneOf(value, &.{ "comic-sans", "system", "mono", "serif" })) return false;
        if (self.scale) |value| if (value != 90 and value != 100 and value != 115 and value != 130) return false;
        if (self.accent) |value| {
            if (value.len != 7 or value[0] != '#') return false;
            for (value[1..]) |digit| if (!std.ascii.isHex(digit)) return false;
        }
        if (self.hiddenTags) |values| {
            for (values) |value| if (!tag_filter.valid(value)) return false;
        }
        return true;
    }

    pub fn empty(self: Patch) bool {
        return self.theme == null and self.accent == null and self.font == null and self.keepPlaying == null and self.playThrough == null and self.scale == null and self.hiddenTags == null;
    }
};

fn oneOf(value: []const u8, allowed: []const []const u8) bool {
    for (allowed) |candidate| if (std.mem.eql(u8, value, candidate)) return true;
    return false;
}

pub const Preferences = struct {
    pool: *pg.Pool,

    /// The account's settings as a JSON object, owned by `allocator`.
    pub fn read(self: Preferences, allocator: std.mem.Allocator, owner: []const u8) ![]const u8 {
        var row = try self.pool.row(read_sql, .{owner}) orelse return allocator.dupe(u8, "{}");
        defer row.deinit() catch {};
        return allocator.dupe(u8, try row.get([]const u8, 0));
    }

    /// Merges the patch into the account's settings and returns the result.
    pub fn merge(self: Preferences, allocator: std.mem.Allocator, owner: []const u8, patch: Patch) ![]const u8 {
        if (!patch.valid()) return error.InvalidPreferences;
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        var normalized = patch;
        if (patch.hiddenTags) |values| normalized.hiddenTags = tag_filter.canonical(arena.allocator(), values) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.InvalidPreferences,
        };
        const json = try std.json.Stringify.valueAlloc(allocator, normalized, .{ .emit_null_optional_fields = false });
        defer allocator.free(json);
        var row = try self.pool.row(merge_sql, .{ owner, json }) orelse return error.PreferencesUnavailable;
        defer row.deinit() catch {};
        return allocator.dupe(u8, try row.get([]const u8, 0));
    }
};

const read_sql =
    \\SELECT value::text FROM plyr_account.preferences WHERE owner_did = $1
;

const merge_sql =
    \\INSERT INTO plyr_account.preferences (owner_did, value)
    \\VALUES ($1, $2::jsonb)
    \\ON CONFLICT (owner_did) DO UPDATE SET
    \\  value = plyr_account.preferences.value || EXCLUDED.value,
    \\  updated_at = clock_timestamp()
    \\RETURNING value::text
;

test "a settings patch accepts only known values" {
    try std.testing.expect((Patch{ .theme = "dark", .accent = "#6a9fff", .font = "mono", .scale = 115, .keepPlaying = true }).valid());
    try std.testing.expect(!(Patch{ .theme = "neon" }).valid());
    try std.testing.expect(!(Patch{ .accent = "#12345" }).valid());
    try std.testing.expect(!(Patch{ .accent = "#12345g" }).valid());
    try std.testing.expect(!(Patch{ .font = "papyrus" }).valid());
    try std.testing.expect(!(Patch{ .scale = 200 }).valid());
    try std.testing.expect(!(Patch{ .hiddenTags = &.{" -- "} }).valid());
    try std.testing.expect(!(Patch{ .hiddenTags = &.{} }).empty());
    try std.testing.expect((Patch{}).empty());
    try std.testing.expect(!(Patch{ .playThrough = false }).empty());
}

test "account settings merge per owner" {
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
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_account CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_account CASCADE", .{}) catch null;
    _ = try pool.exec(@embedFile("migration_0036_account_preferences"), .{});

    const preferences: Preferences = .{ .pool = pool };
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const none = try preferences.read(allocator, owner);
    defer allocator.free(none);
    try std.testing.expectEqualStrings("{}", none);
    const first = try preferences.merge(allocator, owner, .{ .theme = "dark", .scale = 115, .hiddenTags = &.{ " SUNO ", "ai", "ai" } });
    defer allocator.free(first);
    const second = try preferences.merge(allocator, owner, .{ .theme = "light", .keepPlaying = true });
    defer allocator.free(second);
    const parsed = try std.json.parseFromSlice(Patch, allocator, second, .{});
    defer parsed.deinit();
    try std.testing.expectEqualStrings("light", parsed.value.theme.?);
    try std.testing.expectEqual(@as(usize, 2), parsed.value.hiddenTags.?.len);
    try std.testing.expectEqualStrings("ai", parsed.value.hiddenTags.?[0]);
    const cleared = try preferences.merge(allocator, owner, .{ .hiddenTags = &.{} });
    defer allocator.free(cleared);
    const cleared_value = try std.json.parseFromSlice(Patch, allocator, cleared, .{});
    defer cleared_value.deinit();
    try std.testing.expectEqual(@as(usize, 0), cleared_value.value.hiddenTags.?.len);
    try std.testing.expectEqual(@as(?u16, 115), parsed.value.scale);
    try std.testing.expectEqual(@as(?bool, true), parsed.value.keepPlaying);
    try std.testing.expectError(error.InvalidPreferences, preferences.merge(allocator, owner, .{ .font = "papyrus" }));
    const other = try preferences.read(allocator, "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb");
    defer allocator.free(other);
    try std.testing.expectEqualStrings("{}", other);
}
