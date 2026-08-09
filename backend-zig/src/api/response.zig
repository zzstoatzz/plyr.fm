const std = @import("std");

const http = std.http;

pub const ApiError = enum {
    invalid_request,
    authentication_required,
    not_found,
    method_not_allowed,
    internal_error,
    service_unavailable,

    fn message(self: ApiError) []const u8 {
        return switch (self) {
            .invalid_request => "The request is invalid.",
            .authentication_required => "Authentication is required for this resource.",
            .not_found => "The requested resource was not found.",
            .method_not_allowed => "The resource does not support this method.",
            .internal_error => "The request could not be completed.",
            .service_unavailable => "The service is temporarily unavailable.",
        };
    }

    fn status(self: ApiError) http.Status {
        return switch (self) {
            .invalid_request => .bad_request,
            .authentication_required => .unauthorized,
            .not_found => .not_found,
            .method_not_allowed => .method_not_allowed,
            .internal_error => .internal_server_error,
            .service_unavailable => .service_unavailable,
        };
    }
};

pub const CorsPolicy = struct {
    /// Comma-separated exact origins. Empty means browser cross-origin access
    /// is disabled; wildcard origins are never compatible with auth cookies.
    allowed_origins: []const u8,

    fn allows(self: CorsPolicy, candidate: []const u8) bool {
        var origins = std.mem.splitScalar(u8, self.allowed_origins, ',');
        while (origins.next()) |raw| {
            const origin = std.mem.trim(u8, raw, " \t");
            if (origin.len != 0 and std.mem.eql(u8, origin, candidate)) return true;
        }
        return false;
    }
};

pub fn json(
    request: *http.Server.Request,
    status: http.Status,
    body: []const u8,
    request_id: []const u8,
    cors: CorsPolicy,
) !void {
    return jsonWithHeaders(request, status, body, request_id, cors, &.{});
}

pub fn jsonWithHeaders(
    request: *http.Server.Request,
    status: http.Status,
    body: []const u8,
    request_id: []const u8,
    cors: CorsPolicy,
    additional_headers: []const http.Header,
) !void {
    const origin = requestOrigin(request, cors);
    var headers: [16]http.Header = undefined;
    var count: usize = 0;
    headers[count] = .{ .name = "content-type", .value = "application/json" };
    count += 1;
    headers[count] = .{ .name = "x-request-id", .value = request_id };
    count += 1;
    headers[count] = .{ .name = "x-content-type-options", .value = "nosniff" };
    count += 1;
    headers[count] = .{ .name = "referrer-policy", .value = "strict-origin-when-cross-origin" };
    count += 1;
    if (origin) |allowed_origin| {
        headers[count] = .{ .name = "access-control-allow-origin", .value = allowed_origin };
        count += 1;
        headers[count] = .{ .name = "access-control-allow-credentials", .value = "true" };
        count += 1;
        headers[count] = .{ .name = "access-control-allow-methods", .value = "GET, POST, PUT, PATCH, DELETE, OPTIONS" };
        count += 1;
        headers[count] = .{ .name = "access-control-allow-headers", .value = "authorization, content-type, dpop, idempotency-key, x-request-id" };
        count += 1;
        headers[count] = .{ .name = "vary", .value = "origin" };
        count += 1;
    }
    if (count + additional_headers.len > headers.len) return error.TooManyResponseHeaders;
    for (additional_headers) |header| {
        headers[count] = header;
        count += 1;
    }
    try request.respond(body, .{
        .status = status,
        .extra_headers = headers[0..count],
    });
}

pub fn empty(
    request: *http.Server.Request,
    status: http.Status,
    request_id: []const u8,
    cors: CorsPolicy,
) !void {
    try json(request, status, "", request_id, cors);
}

pub fn apiError(
    request: *http.Server.Request,
    kind: ApiError,
    request_id: []const u8,
    cors: CorsPolicy,
) !void {
    var buffer: [384]u8 = undefined;
    const body = try formatError(&buffer, kind, request_id);
    try json(request, kind.status(), body, request_id, cors);
}

fn formatError(buffer: []u8, kind: ApiError, request_id: []const u8) ![]const u8 {
    return std.fmt.bufPrint(
        buffer,
        "{{\"error\":{{\"code\":\"{s}\",\"message\":\"{s}\",\"request_id\":\"{s}\"}}}}",
        .{ @tagName(kind), kind.message(), request_id },
    );
}

fn requestOrigin(request: *const http.Server.Request, cors: CorsPolicy) ?[]const u8 {
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "origin") and cors.allows(header.value)) {
            return header.value;
        }
    }
    return null;
}

test "error envelopes are stable and include the request id" {
    var buffer: [384]u8 = undefined;
    const body = try formatError(&buffer, .not_found, "req_test");
    try std.testing.expectEqualStrings(
        "{\"error\":{\"code\":\"not_found\",\"message\":\"The requested resource was not found.\",\"request_id\":\"req_test\"}}",
        body,
    );
}

test "credentialed CORS uses exact configured origins" {
    const cors: CorsPolicy = .{
        .allowed_origins = "https://plyr.fm, http://localhost:5173",
    };
    try std.testing.expect(cors.allows("https://plyr.fm"));
    try std.testing.expect(cors.allows("http://localhost:5173"));
    try std.testing.expect(!cors.allows("https://example.test"));
    try std.testing.expect(!cors.allows("https://plyr.fm.attacker.example"));
    try std.testing.expect(!(CorsPolicy{ .allowed_origins = "" }).allows("null"));
}
