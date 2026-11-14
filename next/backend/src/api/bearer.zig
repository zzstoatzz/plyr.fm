const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;

/// `Authorization: Bearer <token>`; null when absent, repeated or malformed.
pub fn fromRequest(request: *const Exchange) ?[]const u8 {
    var token: ?[]const u8 = null;
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (!std.ascii.eqlIgnoreCase(header.name, "authorization")) continue;
        if (token != null) return null;
        if (header.value.len <= "Bearer ".len or
            !std.ascii.eqlIgnoreCase(header.value[0.."Bearer ".len], "Bearer ")) return null;
        token = std.mem.trim(u8, header.value["Bearer ".len..], " ");
    }
    return token;
}
