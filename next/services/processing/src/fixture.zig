//! A test-only HTTP/1.1 origin standing in for the owner Durable Object. Each
//! connection gets its own thread, so a held source body and a concurrent
//! heartbeat can be in flight together, and each test answers with whatever
//! status, headers or partial body it needs.

const std = @import("std");
const Io = std.Io;

pub const Request = struct {
    method: []const u8,
    path: []const u8,
    head: []const u8,
    body: []const u8,

    /// case-insensitive header lookup
    pub fn header(r: Request, name: []const u8) ?[]const u8 {
        var lines = std.mem.splitSequence(u8, r.head, "\r\n");
        _ = lines.next();
        while (lines.next()) |line| {
            const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
            if (std.ascii.eqlIgnoreCase(line[0..colon], name)) return std.mem.trim(u8, line[colon + 1 ..], " ");
        }
        return null;
    }

    /// `/v1/processing/{id}/{generation}/{action}` → action
    pub fn action(r: Request) []const u8 {
        var slashes: usize = 0;
        for (r.path, 0..) |c, i| if (c == '/') {
            slashes += 1;
            if (slashes == 5) return r.path[i + 1 ..];
        };
        return "";
    }
};

pub const Connection = struct {
    io: Io,
    stream: Io.net.Stream,

    pub fn respond(c: Connection, status: u16, headers: []const u8, body: []const u8) void {
        var buffer: [512]u8 = undefined;
        var writer = c.stream.writer(c.io, &buffer);
        writer.interface.print("HTTP/1.1 {d} X\r\ncontent-length: {d}\r\nconnection: close\r\n{s}\r\n", .{ status, body.len, headers }) catch return;
        writer.interface.writeAll(body) catch return;
        writer.interface.flush() catch return;
    }

    pub fn raw(c: Connection, bytes: []const u8) void {
        var buffer: [512]u8 = undefined;
        var writer = c.stream.writer(c.io, &buffer);
        writer.interface.writeAll(bytes) catch return;
        writer.interface.flush() catch return;
    }

    /// Blocks until the client closes its side.
    pub fn awaitClose(c: Connection) void {
        var buffer: [64]u8 = undefined;
        var reader = c.stream.reader(c.io, &buffer);
        while (true) _ = reader.interface.takeByte() catch return;
    }
};

pub fn Server(comptime Context: type) type {
    return struct {
        const Self = @This();

        io: Io,
        gpa: std.mem.Allocator,
        listener: Io.net.Server,
        context: *Context,
        thread: std.Thread,
        origin_buffer: [64]u8 = undefined,
        origin_len: usize = 0,
        open: std.atomic.Value(usize) = .init(0),

        pub fn start(self: *Self, io: Io, gpa: std.mem.Allocator, context: *Context) !void {
            const address = try Io.net.IpAddress.parse("127.0.0.1", 0);
            self.* = .{ .io = io, .gpa = gpa, .context = context, .listener = try address.listen(io, .{ .reuse_address = true }), .thread = undefined };
            const port = self.listener.socket.address.getPort();
            self.origin_len = (try std.fmt.bufPrint(&self.origin_buffer, "http://127.0.0.1:{d}", .{port})).len;
            self.thread = try std.Thread.spawn(.{}, acceptLoop, .{self});
        }

        pub fn origin(self: *const Self) []const u8 {
            return self.origin_buffer[0..self.origin_len];
        }

        pub fn stop(self: *Self) void {
            _ = std.os.linux.shutdown(self.listener.socket.handle, std.os.linux.SHUT.RDWR);
            self.thread.join();
            self.listener.deinit(self.io);
            while (self.open.load(.acquire) != 0) self.io.sleep(.fromMilliseconds(2), .awake) catch {};
        }

        fn acceptLoop(self: *Self) void {
            while (true) {
                const stream = self.listener.accept(self.io) catch return;
                _ = self.open.fetchAdd(1, .acq_rel);
                const thread = std.Thread.spawn(.{}, serve, .{ self, stream }) catch {
                    stream.close(self.io);
                    _ = self.open.fetchSub(1, .acq_rel);
                    continue;
                };
                thread.detach();
            }
        }

        fn serve(self: *Self, stream: Io.net.Stream) void {
            defer _ = self.open.fetchSub(1, .acq_rel);
            defer stream.close(self.io);
            var buffer: [16 * 1024]u8 = undefined;
            var reader = stream.reader(self.io, &buffer);
            const r = &reader.interface;
            var head: std.ArrayList(u8) = .empty;
            defer head.deinit(self.gpa);
            while (!std.mem.endsWith(u8, head.items, "\r\n\r\n")) {
                const byte = r.takeByte() catch return;
                head.append(self.gpa, byte) catch return;
            }
            var request: Request = .{ .method = "", .path = "", .head = head.items[0 .. head.items.len - 4], .body = "" };
            var first = std.mem.splitScalar(u8, request.head[0 .. std.mem.indexOf(u8, request.head, "\r\n") orelse request.head.len], ' ');
            request.method = first.next() orelse return;
            request.path = first.next() orelse return;
            const length = std.fmt.parseInt(usize, request.header("content-length") orelse "0", 10) catch return;
            const body = self.gpa.alloc(u8, length) catch return;
            defer self.gpa.free(body);
            r.readSliceAll(body) catch return;
            request.body = body;
            self.context.handle(request, .{ .io = self.io, .stream = stream });
        }
    };
}
