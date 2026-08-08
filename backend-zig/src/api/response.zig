const std = @import("std");

const http = std.http;

pub const ApiError = enum {
    not_found,
    method_not_allowed,
    internal_error,

    fn message(self: ApiError) []const u8 {
        return switch (self) {
            .not_found => "The requested resource was not found.",
            .method_not_allowed => "The resource does not support this method.",
            .internal_error => "The request could not be completed.",
        };
    }

    fn status(self: ApiError) http.Status {
        return switch (self) {
            .not_found => .not_found,
            .method_not_allowed => .method_not_allowed,
            .internal_error => .internal_server_error,
        };
    }
};

pub fn json(
    request: *http.Server.Request,
    status: http.Status,
    body: []const u8,
    request_id: []const u8,
) !void {
    const origin = requestOrigin(request);
    if (origin) |allowed_origin| {
        try request.respond(body, .{
            .status = status,
            .extra_headers = &.{
                .{ .name = "content-type", .value = "application/json" },
                .{ .name = "x-request-id", .value = request_id },
                .{ .name = "access-control-allow-origin", .value = allowed_origin },
                .{ .name = "access-control-allow-credentials", .value = "true" },
                .{ .name = "access-control-allow-methods", .value = "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
                .{ .name = "access-control-allow-headers", .value = "*" },
                .{ .name = "vary", .value = "origin" },
                .{ .name = "x-content-type-options", .value = "nosniff" },
                .{ .name = "referrer-policy", .value = "strict-origin-when-cross-origin" },
            },
        });
        return;
    }

    try request.respond(body, .{
        .status = status,
        .extra_headers = &.{
            .{ .name = "content-type", .value = "application/json" },
            .{ .name = "x-request-id", .value = request_id },
            .{ .name = "x-content-type-options", .value = "nosniff" },
            .{ .name = "referrer-policy", .value = "strict-origin-when-cross-origin" },
        },
    });
}

pub fn empty(
    request: *http.Server.Request,
    status: http.Status,
    request_id: []const u8,
) !void {
    try json(request, status, "", request_id);
}

pub fn apiError(
    request: *http.Server.Request,
    kind: ApiError,
    request_id: []const u8,
) !void {
    var buffer: [384]u8 = undefined;
    const body = try formatError(&buffer, kind, request_id);
    try json(request, kind.status(), body, request_id);
}

fn formatError(buffer: []u8, kind: ApiError, request_id: []const u8) ![]const u8 {
    return std.fmt.bufPrint(
        buffer,
        "{{\"error\":{{\"code\":\"{s}\",\"message\":\"{s}\",\"request_id\":\"{s}\"}}}}",
        .{ @tagName(kind), kind.message(), request_id },
    );
}

fn requestOrigin(request: *const http.Server.Request) ?[]const u8 {
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "origin") and isAllowedOrigin(header.value)) {
            return header.value;
        }
    }
    return null;
}

fn isAllowedOrigin(origin: []const u8) bool {
    return std.mem.eql(u8, origin, "null") or
        std.mem.startsWith(u8, origin, "https://") or
        std.mem.startsWith(u8, origin, "http://localhost:") or
        std.mem.startsWith(u8, origin, "http://127.0.0.1:");
}

test "error envelopes are stable and include the request id" {
    var buffer: [384]u8 = undefined;
    const body = try formatError(&buffer, .not_found, "req_test");
    try std.testing.expectEqualStrings(
        "{\"error\":{\"code\":\"not_found\",\"message\":\"The requested resource was not found.\",\"request_id\":\"req_test\"}}",
        body,
    );
}

test "credentialed CORS reflects only intentional origins" {
    try std.testing.expect(isAllowedOrigin("https://plyr.fm"));
    try std.testing.expect(isAllowedOrigin("https://example.test"));
    try std.testing.expect(isAllowedOrigin("http://localhost:5173"));
    try std.testing.expect(isAllowedOrigin("null"));
    try std.testing.expect(!isAllowedOrigin("http://example.test"));
}
