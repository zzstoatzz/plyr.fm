const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const Store = @import("../internal/metrics/platform_stats_store.zig").Store;
const response = @import("response.zig");

pub fn get(request: *Exchange, allocator: std.mem.Allocator, store: ?Store, cors: response.CorsPolicy, request_id: []const u8) !void {
    const source = store orelse return response.apiError(request, .service_unavailable, request_id, cors);
    const value = source.get() catch |err| {
        std.log.err("platform stats failed: {}", .{err});
        return response.apiError(request, .service_unavailable, request_id, cors);
    };
    const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
    try response.json(request, .ok, body, request_id, cors);
}

/// The atlas map is rebuilt daily, so caches may hold it for an hour.
pub fn atlas(request: *Exchange, allocator: std.mem.Allocator, store: ?Store, cors: response.CorsPolicy, request_id: []const u8) !void {
    const source = store orelse return response.apiError(request, .service_unavailable, request_id, cors);
    const body = source.atlas(allocator) catch |err| {
        std.log.err("atlas read failed: {}", .{err});
        return response.apiError(request, .service_unavailable, request_id, cors);
    } orelse return response.apiError(request, .not_found, request_id, cors);
    try response.jsonWithHeaders(request, .ok, body, request_id, cors, &.{
        .{ .name = "cache-control", .value = "public, max-age=3600" },
    });
}

const overview_store = @import("../internal/metrics/postgres_stats_overview_store.zig");

/// The stats page's overview for `range` (week, month, year or all; month
/// when absent).
pub fn overview(request: *Exchange, allocator: std.mem.Allocator, store: ?*overview_store.PostgresStatsOverviewStore, cors: response.CorsPolicy, request_id: []const u8) !void {
    const range = overview_store.Range.parse(allocator, request.target) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return response.apiError(request, .invalid_request, request_id, cors),
    };
    const source = store orelse return response.apiError(request, .service_unavailable, request_id, cors);
    const body = source.get(allocator, range) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => {
            std.log.err("stats overview failed: {}", .{err});
            return response.apiError(request, .service_unavailable, request_id, cors);
        },
    };
    try response.json(request, .ok, body, request_id, cors);
}
