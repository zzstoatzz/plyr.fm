//! Strict normalization at the Python-to-Zig deployment boundary.
//!
//! SQLAlchemy permits driver-qualified PostgreSQL schemes. pg.zig consumes a
//! PostgreSQL URI directly, so strip only the driver names the existing Python
//! deployment is known to use and leave the URI payload untouched.

const std = @import("std");

pub const Normalized = struct {
    value: []const u8,
    owned: ?[]u8 = null,

    pub fn deinit(self: *Normalized, allocator: std.mem.Allocator) void {
        if (self.owned) |value| allocator.free(value);
        self.* = undefined;
    }
};

pub fn normalize(allocator: std.mem.Allocator, raw: []const u8) !Normalized {
    const separator = "://";
    const scheme_end = std.mem.indexOf(u8, raw, separator) orelse
        return error.InvalidDatabaseUrl;
    const scheme = raw[0..scheme_end];

    if (std.mem.eql(u8, scheme, "postgresql") or std.mem.eql(u8, scheme, "postgres")) {
        return .{ .value = raw };
    }

    const supported = std.mem.eql(u8, scheme, "postgresql+psycopg") or
        std.mem.eql(u8, scheme, "postgresql+psycopg2") or
        std.mem.eql(u8, scheme, "postgresql+asyncpg");
    if (!supported) {
        if (std.mem.startsWith(u8, scheme, "postgresql+")) {
            return error.UnsupportedDatabaseDriver;
        }
        return error.UnsupportedDatabaseScheme;
    }

    const payload = raw[scheme_end + separator.len ..];
    const value = try std.fmt.allocPrint(allocator, "postgresql://{s}", .{payload});
    return .{ .value = value, .owned = value };
}

test "canonical PostgreSQL URLs remain borrowed" {
    inline for (.{
        "postgresql://user:password@example.test/database?sslmode=require",
        "postgres://user:password@example.test/database?sslmode=require",
    }) |raw| {
        var normalized = try normalize(std.testing.allocator, raw);
        defer normalized.deinit(std.testing.allocator);

        try std.testing.expectEqualStrings(raw, normalized.value);
        try std.testing.expect(normalized.owned == null);
    }
}

test "known SQLAlchemy drivers normalize without changing the URI payload" {
    inline for (.{
        "postgresql+psycopg",
        "postgresql+psycopg2",
        "postgresql+asyncpg",
    }) |scheme| {
        const raw = scheme ++ "://user:p%40ss@[2001:db8::1]:5432/db%2Fname?sslmode=require&x=a%2Bb";
        var normalized = try normalize(std.testing.allocator, raw);
        defer normalized.deinit(std.testing.allocator);

        try std.testing.expectEqualStrings(
            "postgresql://user:p%40ss@[2001:db8::1]:5432/db%2Fname?sslmode=require&x=a%2Bb",
            normalized.value,
        );
        try std.testing.expect(normalized.owned != null);
    }
}

test "unknown drivers and unrelated schemes fail closed" {
    try std.testing.expectError(
        error.UnsupportedDatabaseDriver,
        normalize(std.testing.allocator, "postgresql+unknown://example.test/database"),
    );
    try std.testing.expectError(
        error.UnsupportedDatabaseScheme,
        normalize(std.testing.allocator, "mysql://example.test/database"),
    );
    try std.testing.expectError(
        error.InvalidDatabaseUrl,
        normalize(std.testing.allocator, "postgresql"),
    );
}
