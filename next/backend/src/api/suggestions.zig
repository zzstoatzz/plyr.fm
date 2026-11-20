const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const list_track_suggestions = @import("../internal/application/list_track_suggestions.zig");
const TrackSuggestionStore = @import("../internal/index/track_suggestion_store.zig").TrackSuggestionStore;
const response = @import("response.zig");

pub fn tracks(
    request: *Exchange,
    allocator: std.mem.Allocator,
    store: ?TrackSuggestionStore,
    collections: list_track_suggestions.Collections,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (list_track_suggestions.execute(allocator, store, collections, request.target)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}
