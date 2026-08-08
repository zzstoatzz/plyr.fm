const std = @import("std");
const response = @import("response.zig");

const http = std.http;
const mem = std.mem;

pub const prefix = "/v1";

pub fn handle(request: *http.Server.Request, request_id: []const u8) !void {
    // std.http assumes body-capable methods have either Content-Length or a
    // transfer encoding when respond() discards an unread request body. An
    // empty POST without either header is valid and common in generic clients;
    // normalize it instead of letting the stdlib assertion terminate a worker.
    if (request.head.content_length == null and request.head.transfer_encoding == .none) {
        request.head.content_length = 0;
    }

    const target = request.head.target;
    const path = pathFromTarget(target);

    if (request.head.method == .OPTIONS) {
        try response.empty(request, .no_content, request_id);
    } else if (mem.eql(u8, path, "/health")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id);
            return;
        }
        try response.json(request, .ok, "{\"status\":\"ok\",\"role\":\"api\"}", request_id);
    } else if (mem.eql(u8, path, prefix)) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id);
            return;
        }
        try response.json(request, .ok, "{\"object\":\"api\",\"version\":\"v1\"}", request_id);
    } else if (mem.eql(u8, path, "/")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id);
            return;
        }
        try response.json(request, .ok, "{\"name\":\"plyr.fm\",\"api\":\"/v1\"}", request_id);
    } else {
        try response.apiError(request, .not_found, request_id);
    }
}

fn pathFromTarget(target: []const u8) []const u8 {
    const index = mem.indexOfScalar(u8, target, '?') orelse return target;
    return target[0..index];
}

test "query strings do not participate in route matching" {
    try std.testing.expectEqualStrings("/health", pathFromTarget("/health?probe=fly"));
}

test "product API paths use a major-version namespace" {
    try std.testing.expect(mem.startsWith(u8, "/v1/tracks", prefix ++ "/"));
    try std.testing.expect(!mem.startsWith(u8, "/tracks", prefix ++ "/"));
}
