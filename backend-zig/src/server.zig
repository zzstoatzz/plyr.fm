const std = @import("std");

const Io = std.Io;
const http = std.http;
const mem = std.mem;

const buffer_size = 16 * 1024;

pub fn run(io: Io, port: u16) !void {
    const address = Io.net.Ip4Address.unspecified(port);
    var listener = try (Io.net.IpAddress{ .ip4 = address }).listen(io, .{
        .reuse_address = true,
    });
    defer listener.deinit(io);

    std.log.info("plyr api listening on port {d}", .{port});

    while (true) {
        const stream = listener.accept(io) catch |err| {
            std.log.err("accept failed: {}", .{err});
            continue;
        };

        const thread = std.Thread.spawn(.{}, handleConnection, .{ stream, io }) catch |err| {
            std.log.err("failed to spawn connection handler: {}", .{err});
            stream.close(io);
            continue;
        };
        thread.detach();
    }
}

fn handleConnection(stream: Io.net.Stream, io: Io) void {
    defer stream.close(io);

    var read_buffer: [buffer_size]u8 = undefined;
    var write_buffer: [buffer_size]u8 = undefined;
    var reader = stream.reader(io, &read_buffer);
    var writer = stream.writer(io, &write_buffer);
    var server = http.Server.init(&reader.interface, &writer.interface);

    while (true) {
        var request = server.receiveHead() catch |err| {
            if (err != error.HttpConnectionClosing and err != error.EndOfStream) {
                std.log.debug("receive failed: {}", .{err});
            }
            return;
        };

        handleRequest(&request) catch |err| {
            std.log.err("request failed: {}", .{err});
            return;
        };

        if (!request.head.keep_alive) return;
    }
}

fn handleRequest(request: *http.Server.Request) !void {
    const target = request.head.target;
    const path = if (mem.indexOfScalar(u8, target, '?')) |index| target[0..index] else target;

    if (request.head.method == .OPTIONS) {
        try respond(request, .no_content, "", "text/plain");
    } else if (request.head.method == .GET and mem.eql(u8, path, "/health")) {
        try respond(request, .ok, "{\"status\":\"ok\",\"role\":\"api\"}", "application/json");
    } else if (request.head.method == .GET and mem.eql(u8, path, "/")) {
        try respond(request, .ok, "{\"name\":\"plyr.fm\",\"backend\":\"zig\"}", "application/json");
    } else {
        try respond(request, .not_found, "{\"detail\":\"Not Found\"}", "application/json");
    }
}

fn respond(
    request: *http.Server.Request,
    status: http.Status,
    body: []const u8,
    content_type: []const u8,
) !void {
    try request.respond(body, .{
        .status = status,
        .extra_headers = &.{
            .{ .name = "content-type", .value = content_type },
            .{ .name = "access-control-allow-origin", .value = "*" },
            .{ .name = "access-control-allow-methods", .value = "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
            .{ .name = "access-control-allow-headers", .value = "*" },
            .{ .name = "x-content-type-options", .value = "nosniff" },
            .{ .name = "referrer-policy", .value = "strict-origin-when-cross-origin" },
        },
    });
}

test "query strings do not participate in route matching" {
    const target = "/health?probe=fly";
    const index = mem.indexOfScalar(u8, target, '?').?;
    try std.testing.expectEqualStrings("/health", target[0..index]);
}
