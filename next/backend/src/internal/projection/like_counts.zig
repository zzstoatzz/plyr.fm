//! Runs migrations/0029 (maintained like counts) in a test database, so the
//! tests and the property harness exercise the migration itself.

const std = @import("std");
const pg = @import("pg");

const migration = @embedFile("migration_0029_like_counts");

/// Needs `like_records` and `account_availability` to exist.
pub fn applyTestMigration(pool: *pg.Pool) !void {
    var statements = Statements{ .rest = migration };
    while (statements.next()) |statement| _ = try pool.exec(statement, .{});
}

/// Splits on `;` at line ends outside `$$` bodies, after dropping comment lines.
const Statements = struct {
    rest: []const u8,
    buffer: [16 * 1024]u8 = undefined,

    fn next(self: *Statements) ?[]const u8 {
        var len: usize = 0;
        var in_body = false;
        while (self.rest.len > 0) {
            const end = std.mem.indexOfScalar(u8, self.rest, '\n') orelse self.rest.len;
            const line = self.rest[0..end];
            self.rest = if (end < self.rest.len) self.rest[end + 1 ..] else "";
            const trimmed = std.mem.trim(u8, line, " \t\r");
            if (!in_body and (trimmed.len == 0 or std.mem.startsWith(u8, trimmed, "--"))) continue;
            if (std.mem.count(u8, line, "$$") % 2 == 1) in_body = !in_body;
            @memcpy(self.buffer[len..][0..line.len], line);
            len += line.len;
            self.buffer[len] = '\n';
            len += 1;
            if (!in_body and std.mem.endsWith(u8, trimmed, ";")) return self.buffer[0 .. len - 2];
        }
        return if (len > 0) self.buffer[0..len] else null;
    }
};

test "the like-count migration splits into whole statements" {
    var statements = Statements{ .rest = migration };
    var count: usize = 0;
    var functions: usize = 0;
    while (statements.next()) |statement| {
        count += 1;
        if (std.mem.startsWith(u8, statement, "CREATE FUNCTION")) {
            functions += 1;
            try std.testing.expect(std.mem.endsWith(u8, statement, "$$"));
        }
    }
    try std.testing.expectEqual(@as(usize, 4), functions);
    try std.testing.expectEqual(@as(usize, 11), count);
}
