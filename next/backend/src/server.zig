//! The API's HTTP listener. httpz owns sockets, parsing, timeouts and the
//! handler pool; everything past that is an `Exchange` handed to the router.

const std = @import("std");
const httpz = @import("httpz");
const router = @import("api/router.zig");
const exchange = @import("api/exchange.zig");

const Io = std.Io;

pub const Limits = struct {
    /// open connections, idle or not
    max_connections: u16,
    /// threads running handlers; a records/await call holds one for up to 10s
    handler_threads: u16,
    /// seconds a connection has to send one complete request
    request_timeout_s: u32,
    /// seconds an idle keep-alive connection is kept
    keepalive_timeout_s: u32,
    /// Bound on any request body. Handlers apply their own, tighter limit so
    /// an oversized body still gets the API's error envelope.
    max_body_bytes: usize = 1024 * 1024,
};

var request_sequence = std.atomic.Value(u64).init(0);

const Handler = struct {
    app: router.App,

    pub fn handle(self: *Handler, req: *httpz.Request, res: *httpz.Response) void {
        serve(self.app, req, res) catch |err| {
            std.log.err("request failed: {}", .{err});
            res.status = 500;
            res.body = "";
            res.keepalive = false;
        };
    }
};

fn serve(app: router.App, req: *httpz.Request, res: *httpz.Response) !void {
    var request_id_buffer: [64]u8 = undefined;
    const request_id = try makeRequestId(app.io, &request_id_buffer);

    var headers: std.ArrayList(exchange.Header) = .empty;
    var iterator = req.headers.iterator();
    while (iterator.next()) |kv| try headers.append(req.arena, .{ .name = kv.key, .value = kv.value });

    var ex: exchange.Exchange = .{
        .method = method(req.method),
        .target = req.url.raw,
        .headers = headers.items,
        .body = req.body() orelse "",
        .arena = req.arena,
    };
    try router.handle(&ex, req.arena, app, request_id);

    const response = ex.response orelse return error.NoResponse;
    res.status = @backingInt(response.status);
    for (response.headers) |h| res.header(h.name, h.value);
    if (ex.method == .HEAD) {
        // a HEAD response carries no content; close so a client that sent a
        // body with it cannot desynchronize the connection
        res.body = "";
        res.keepalive = false;
    } else {
        res.body = response.body;
    }
}

fn method(m: httpz.Method) exchange.Method {
    return switch (m) {
        inline else => |tag| @field(exchange.Method, @tagName(tag)),
    };
}

pub fn run(io: Io, port: u16, limits: Limits, app: router.App) !void {
    var handler: Handler = .{ .app = app };
    var server = try httpz.Server(*Handler).init(io, std.heap.smp_allocator, .{
        .address = .all(port),
        .workers = .{ .max_conn = limits.max_connections },
        .thread_pool = .{ .count = limits.handler_threads },
        .request = .{ .max_body_size = limits.max_body_bytes },
        .timeout = .{
            .request = limits.request_timeout_s,
            .keepalive = limits.keepalive_timeout_s,
        },
    }, &handler);
    defer server.deinit();

    std.log.info("plyr api listening on port {d} (connections: {d}, handlers: {d})", .{
        port, limits.max_connections, limits.handler_threads,
    });
    try server.listen();
}

fn makeRequestId(io: Io, buffer: []u8) ![]const u8 {
    const timestamp = Io.Timestamp.now(io, .real).toMicroseconds();
    const sequence = request_sequence.fetchAdd(1, .monotonic);
    return std.fmt.bufPrint(buffer, "req_{x}_{x}", .{ timestamp, sequence });
}

test "every httpz method maps to an exchange method of the same name" {
    inline for (comptime std.enums.values(httpz.Method)) |tag| {
        try std.testing.expectEqualStrings(@tagName(tag), @tagName(method(tag)));
    }
}
