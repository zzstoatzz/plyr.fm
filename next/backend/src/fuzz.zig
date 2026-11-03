//! Property harnesses for the code that reads untrusted input, run by
//! `zig build fuzz -Dhegel`. `-Dfuzz-only=<name>` runs the groups whose name
//! contains it; `-Dfuzz-cases` or `HEGEL_TEST_CASES` sets the cases per
//! property.

const std = @import("std");

const groups = .{
    .{ "identity", @import("fuzz/identity.zig") },
    .{ "http", @import("fuzz/http.zig") },
    .{ "text", @import("fuzz/text.zig") },
    .{ "records", @import("fuzz/records.zig") },
    .{ "pagination", @import("fuzz/pagination.zig") },
    .{ "await", @import("fuzz/await.zig") },
    .{ "health", @import("fuzz/health.zig") },
    .{ "like_counts", @import("fuzz/like_counts.zig") },
};

pub fn main() !void {
    const filter: ?[]const u8 = if (std.c.getenv("FUZZ_ONLY")) |only| std.mem.span(only) else null;
    var failed = false;
    inline for (groups) |group| {
        if (filter == null or std.mem.indexOf(u8, group[0], filter.?) != null) {
            std.debug.print("== {s}\n", .{group[0]});
            group[1].run() catch {
                failed = true;
            };
        }
    }
    if (failed) std.process.exit(1);
}
