const std = @import("std");
const await_record = @import("../internal/application/await_record.zig");
const RecordStatusStore = @import("../internal/index/record_status_store.zig").RecordStatusStore;
const response = @import("response.zig");

pub fn awaitRecord(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    io: std.Io,
    store: ?RecordStatusStore,
    collections: await_record.Collections,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (await_record.execute(allocator, io, store, collections, request.head.target)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{ .emit_null_optional_fields = false });
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}
