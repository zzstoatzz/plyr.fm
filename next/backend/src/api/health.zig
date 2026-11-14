const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const get_ingest_status = @import("../internal/application/get_ingest_status.zig");
const IngestStatusStore = @import("../internal/index/ingest_status_store.zig").IngestStatusStore;
const response = @import("response.zig");

pub fn ingest(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    store: ?IngestStatusStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const now_us: i64 = @intCast(@divFloor(std.Io.Timestamp.now(io, .real).nanoseconds, std.time.ns_per_us));
    switch (get_ingest_status.execute(allocator, store, now_us)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}
