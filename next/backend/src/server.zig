const std = @import("std");
const router = @import("api/router.zig");

const Io = std.Io;
const http = std.http;

const buffer_size = 16 * 1024;
var request_sequence = std.atomic.Value(u64).init(0);

pub fn run(io: Io, port: u16, max_connections: usize, app: router.App) !void {
    const address = Io.net.Ip4Address.unspecified(port);
    var listener = try (Io.net.IpAddress{ .ip4 = address }).listen(io, .{
        .reuse_address = true,
    });
    defer listener.deinit(io);

    std.log.info("plyr api listening on port {d} (max connections: {d})", .{ port, max_connections });

    var capacity: Io.Semaphore = .{ .permits = max_connections };

    while (true) {
        // Stop accepting before allocating another thread. The kernel backlog
        // supplies bounded backpressure while all permits are in use.
        capacity.waitUncancelable(io);
        const stream = listener.accept(io) catch |err| {
            capacity.post(io);
            std.log.err("accept failed: {}", .{err});
            continue;
        };

        const thread = std.Thread.spawn(.{}, handleConnection, .{ stream, io, app, &capacity }) catch |err| {
            capacity.post(io);
            std.log.err("failed to spawn connection handler: {}", .{err});
            stream.close(io);
            continue;
        };
        thread.detach();
    }
}

fn handleConnection(stream: Io.net.Stream, io: Io, app: router.App, capacity: *Io.Semaphore) void {
    defer capacity.post(io);
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

        var request_id_buffer: [64]u8 = undefined;
        const request_id = makeRequestId(io, &request_id_buffer) catch {
            std.log.err("request id generation failed", .{});
            return;
        };

        var request_arena = std.heap.ArenaAllocator.init(std.heap.smp_allocator);
        defer request_arena.deinit();

        router.handle(&request, request_arena.allocator(), app, request_id) catch |err| {
            std.log.err("request failed: {}", .{err});
            return;
        };

        if (!request.head.keep_alive) return;
    }
}

fn makeRequestId(io: Io, buffer: []u8) ![]const u8 {
    const timestamp = Io.Timestamp.now(io, .real).toMicroseconds();
    const sequence = request_sequence.fetchAdd(1, .monotonic);
    return std.fmt.bufPrint(buffer, "req_{x}_{x}", .{ timestamp, sequence });
}
