//! One HTTP request and the response a handler gives it. Handlers see only
//! this type, so the server library stays a detail of `server.zig` and a
//! handler can be driven in a test without a socket.

const std = @import("std");

pub const Header = std.http.Header;
pub const Status = std.http.Status;

pub const Method = enum { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, CONNECT, OTHER };

pub const Response = struct {
    status: Status,
    headers: []const Header,
    body: []const u8,
};

pub const Exchange = struct {
    method: Method,
    /// origin-form request target: path and query, as received
    target: []const u8,
    headers: []const Header,
    /// The whole body. The server has already bounded it by its configured
    /// maximum; `readBody` applies a handler's tighter limit.
    body: []const u8,
    /// owns what `respond` copies, for as long as the request lives
    arena: std.mem.Allocator,
    response: ?Response = null,

    pub const RespondOptions = struct {
        status: Status = .ok,
        extra_headers: []const Header = &.{},
    };

    pub fn iterateHeaders(self: *const Exchange) HeaderIterator {
        return .{ .headers = self.headers };
    }

    /// The first header with this name, ignoring case.
    pub fn header(self: *const Exchange, name: []const u8) ?[]const u8 {
        for (self.headers) |h| {
            if (std.ascii.eqlIgnoreCase(h.name, name)) return h.value;
        }
        return null;
    }

    pub fn readBody(self: *const Exchange, limit: usize) error{BodyTooLarge}![]const u8 {
        if (self.body.len > limit) return error.BodyTooLarge;
        return self.body;
    }

    /// Records the response. Headers and body are copied because callers
    /// build them in stack buffers.
    pub fn respond(self: *Exchange, body: []const u8, options: RespondOptions) !void {
        if (self.response != null) return error.AlreadyResponded;
        const headers = try self.arena.alloc(Header, options.extra_headers.len);
        for (options.extra_headers, headers) |source, *copy| {
            copy.* = .{
                .name = try self.own(source.name),
                .value = try self.own(source.value),
            };
        }
        self.response = .{
            .status = options.status,
            .headers = headers,
            .body = try self.own(body),
        };
    }

    /// An empty slice from an allocator has an undefined pointer, and httpz
    /// hands body pointers straight to writev, which faults on one. Keep
    /// empty slices pointing at a real (static) address.
    fn own(self: *Exchange, bytes: []const u8) ![]const u8 {
        if (bytes.len == 0) return "";
        return self.arena.dupe(u8, bytes);
    }

    /// A request built in memory, for tests.
    pub fn initTest(arena: std.mem.Allocator, method: Method, target: []const u8, headers: []const Header, body: []const u8) Exchange {
        return .{ .method = method, .target = target, .headers = headers, .body = body, .arena = arena };
    }
};

pub const HeaderIterator = struct {
    headers: []const Header,
    index: usize = 0,

    pub fn next(self: *HeaderIterator) ?Header {
        if (self.index >= self.headers.len) return null;
        defer self.index += 1;
        return self.headers[self.index];
    }
};

test "respond copies headers and body out of the caller's buffers" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    var exchange = Exchange.initTest(arena_state.allocator(), .GET, "/health", &.{}, "");
    {
        var name = "x-test".*;
        var body = "{}".*;
        try exchange.respond(&body, .{ .status = .created, .extra_headers = &.{.{ .name = &name, .value = "1" }} });
        @memset(&name, 0);
        @memset(&body, 0);
    }
    const response = exchange.response.?;
    try std.testing.expectEqual(Status.created, response.status);
    try std.testing.expectEqualStrings("x-test", response.headers[0].name);
    try std.testing.expectEqualStrings("{}", response.body);
    try std.testing.expectError(error.AlreadyResponded, exchange.respond("", .{}));
}

test "readBody applies the handler's limit and header lookup ignores case" {
    var exchange = Exchange.initTest(std.testing.allocator, .POST, "/", &.{.{ .name = "Content-Type", .value = "application/json" }}, "12345");
    try std.testing.expectEqualStrings("12345", try exchange.readBody(5));
    try std.testing.expectError(error.BodyTooLarge, exchange.readBody(4));
    try std.testing.expectEqualStrings("application/json", exchange.header("content-type").?);
    try std.testing.expect(exchange.header("origin") == null);
}

test "an empty response body still points at real memory" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    var exchange = Exchange.initTest(arena_state.allocator(), .OPTIONS, "/", &.{}, "");
    try exchange.respond("", .{ .status = .no_content, .extra_headers = &.{.{ .name = "vary", .value = "" }} });
    const response = exchange.response.?;
    // writev faults on the undefined pointer an allocator gives a zero-length slice
    try std.testing.expectEqual(@intFromPtr(@as([]const u8, "").ptr), @intFromPtr(response.body.ptr));
    try std.testing.expectEqual(@intFromPtr(@as([]const u8, "").ptr), @intFromPtr(response.headers[0].value.ptr));
}
