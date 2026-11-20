//! Logfire export for the Next backend. Without LOGFIRE_WRITE_TOKEN nothing
//! leaves the process and std.log writes to stderr as before.

const std = @import("std");
const logfire = @import("logfire");
const Role = @import("../config.zig").Role;

pub fn serviceName(role: Role) []const u8 {
    return switch (role) {
        inline else => |tag| "plyr-next-" ++ comptime hyphenated(@tagName(tag)),
    };
}

fn hyphenated(comptime name: []const u8) []const u8 {
    comptime {
        var out: [name.len]u8 = name[0..name.len].*;
        std.mem.replaceScalar(u8, &out, '_', '-');
        const final = out;
        return &final;
    }
}

pub fn configure(role: Role) void {
    _ = logfire.configure(.{
        .service_name = serviceName(role),
        .service_version = env("FLY_IMAGE_REF") orelse "dev",
        .environment = env("LOGFIRE_ENVIRONMENT") orelse "next",
    }) catch |err| std.log.err("logfire configure failed: {}", .{err});
}

pub fn shutdown() void {
    logfire.shutdown();
}

/// Prints the trace, ships the message within a bounded flush, then aborts.
pub const panicFn = logfire.panicFn;

/// Warnings and errors ship to Logfire; everything reaches stderr.
pub fn logFn(
    comptime level: std.log.Level,
    comptime scope: @EnumLiteral(),
    comptime format: []const u8,
    args: anytype,
) void {
    if (comptime shipped(level)) {
        logfire.logFn(level, scope, format, args);
    } else {
        std.log.defaultLog(level, scope, format, args);
    }
}

fn shipped(comptime level: std.log.Level) bool {
    return @backingInt(level) <= @backingInt(std.log.Level.warn);
}

/// Fly's health checks run every few seconds; they stay out of traces.
pub fn traced(path: []const u8) bool {
    return !std.mem.eql(u8, path, "/health") and !std.mem.eql(u8, path, "/ready");
}

/// One span per HTTP request, named by method and route so identifiers in
/// the path do not split it into a span name per track.
pub const Request = struct {
    span: ?logfire.Span,

    pub fn begin(a: std.mem.Allocator, method: []const u8, target: []const u8, request_id: ?[]const u8) Request {
        const path = target[0 .. std.mem.indexOfScalar(u8, target, '?') orelse target.len];
        if (!traced(path)) return .{ .span = null };
        const route = routeOf(a, path) catch path;
        const name = std.fmt.allocPrint(a, "{s} {s}", .{ method, route }) catch "http request";
        const span = logfire.span(name, .{
            .@"http.request.method" = method,
            .@"http.route" = route,
            .@"url.path" = path,
        });
        if (request_id) |id| span.setAttribute("request_id", id);
        return .{ .span = span };
    }

    pub fn failed(self: *const Request, err: anyerror) void {
        const span = self.span orelse return;
        span.setAttribute("error.type", @errorName(err));
    }

    pub fn end(self: *const Request, status: u16) void {
        const span = self.span orelse return;
        span.setAttribute("http.response.status_code", @as(i64, status));
        if (status >= 500) span.setStatus(.@"error", null);
        span.end();
    }
};

/// Path segments that carry an identifier become `{id}`.
pub fn routeOf(a: std.mem.Allocator, path: []const u8) ![]const u8 {
    var out: std.ArrayList(u8) = .empty;
    var segments = std.mem.splitScalar(u8, path, '/');
    var first = true;
    while (segments.next()) |segment| {
        if (!first) try out.append(a, '/');
        first = false;
        try out.appendSlice(a, if (identifier(segment)) "{id}" else segment);
    }
    return out.items;
}

fn identifier(segment: []const u8) bool {
    if (segment.len == 0) return false;
    for ([_][]const u8{ "trk_", "did:", "did%3A", "at:", "at%3A" }) |prefix| {
        if (std.mem.startsWith(u8, segment, prefix)) return true;
    }
    if (segment.len < 6) return false;
    for (segment) |c| if (std.ascii.isDigit(c)) return true;
    return false;
}

fn env(key: [:0]const u8) ?[]const u8 {
    return if (std.c.getenv(key)) |value| std.mem.span(value) else null;
}

test "each role reports under its own service name" {
    try std.testing.expectEqualStrings("plyr-next-api", serviceName(.api));
    try std.testing.expectEqualStrings("plyr-next-jams", serviceName(.jams));
    try std.testing.expectEqualStrings("plyr-next-space-consumer", serviceName(.space_consumer));
}

test "routes keep their shape and drop identifiers" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const cases = .{
        .{ "/v1/tracks/trk_YXQ6Ly9kaWQ6cGxj/playback", "/v1/tracks/{id}/playback" },
        .{ "/v1/actors/did:plc:xbtmt2zjwlrfegqvch7fboei/tracks", "/v1/actors/{id}/tracks" },
        .{ "/v1/uploads/0a1b2c3d4e5f6071/12345678-1234-4123-8123-123456789abc/retry-processing", "/v1/uploads/{id}/{id}/retry-processing" },
        .{ "/v1/tracks", "/v1/tracks" },
        .{ "/", "/" },
    };
    inline for (cases) |case| try std.testing.expectEqualStrings(case[1], try routeOf(arena.allocator(), case[0]));
}

test "health checks stay out of traces" {
    try std.testing.expect(!traced("/health"));
    try std.testing.expect(!traced("/ready"));
    try std.testing.expect(traced("/v1/uploads/authorize"));
}

test "only warnings and errors ship as log records" {
    comptime {
        std.debug.assert(shipped(.err));
        std.debug.assert(shipped(.warn));
        std.debug.assert(!shipped(.info));
        std.debug.assert(!shipped(.debug));
    }
}
