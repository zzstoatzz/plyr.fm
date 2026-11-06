const std = @import("std");
const websocket = @import("websocket");
const auth = @import("auth.zig");
const model = @import("model.zig");
const room_store = @import("store.zig");
const tickets = @import("tickets.zig");
const config = @import("../../config.zig");

const allocator = std.heap.smp_allocator;
const max_outbox_bytes = 512 * 1024;

pub fn run(a: std.mem.Allocator, io: std.Io, settings: config.Config) !void {
    if (env("FLY_APP_NAME") != null and std.mem.eql(u8, env("JAM_TEST_MODE") orelse "", "1")) return error.TestModeForbidden;
    const url = settings.redis_url orelse return error.RedisRequired;
    var context: Context = .{
        .io = io,
        .store = try room_store.Store.init(a, io, url, settings.track_collection),
        .tickets = try tickets.Tickets.init(a, io, url),
        .auth_config = .{
            .audience = env("JAM_SERVICE_AUDIENCE") orelse "did:web:plyr-jams-next.fly.dev#jams",
            .method = env("JAM_JOIN_METHOD") orelse "fm.plyr.stg.jam.join",
            .space_type = env("JAM_SPACE_TYPE") orelse "fm.plyr.stg.jam",
            .plc_url = env("PLC_DIRECTORY_URL") orelse "https://plc.directory",
            .test_pds_origin = if (std.mem.eql(u8, env("JAM_TEST_MODE") orelse "", "1")) env("JAM_TEST_PDS_ORIGIN") else null,
        },
        .origins = settings.cors_allowed_origins,
    };
    defer context.store.deinit();
    defer context.tickets.deinit();
    const cursor = try context.tickets.latestEvent(a);
    defer a.free(cursor);
    const fanout = try std.Thread.spawn(.{}, Context.tail, .{ &context, cursor });
    defer {
        context.stopping.store(true, .release);
        fanout.join();
    }
    var server = try websocket.Server(Handler).init(a, io, .{
        .address = "0.0.0.0",
        .port = settings.port,
        .max_conn = settings.max_connections,
        .max_message_size = 64 * 1024,
        .handshake = .{ .timeout = 5, .max_size = 65535, .max_headers = 40 },
        .thread_pool = .{ .count = 8, .backlog = 128 },
        .worker_count = 1,
    });
    defer server.deinit();
    std.log.info("Jam coordinator listening on {d}", .{settings.port});
    try server.listen(&context);
}

const Context = struct {
    io: std.Io,
    store: room_store.Store,
    tickets: tickets.Tickets,
    auth_config: auth.Config,
    origins: []const u8,
    admissions: std.atomic.Value(u8) = .init(0),
    peers: std.ArrayList(*Peer) = .empty,
    mutex: std.Io.Mutex = .init,
    stopping: std.atomic.Value(bool) = .init(false),

    fn allowed(self: *Context, origin: []const u8) bool {
        if (origin.len == 0) return true;
        var values = std.mem.splitScalar(u8, self.origins, ',');
        while (values.next()) |value| if (std.mem.eql(u8, std.mem.trim(u8, value, " "), origin)) return true;
        return false;
    }
    fn broadcast(self: *Context, room: []const u8, body: []const u8) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        for (self.peers.items) |peer| if (std.mem.eql(u8, peer.ticket.admission.room, room)) peer.enqueue(body);
    }
    fn expire(self: *Context) void {
        const now = self.store.nowMs() catch return;
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        for (self.peers.items) |peer| if (now >= peer.ticket.admission.expires_ms) peer.stop();
    }
    fn tail(self: *Context, start: []const u8) void {
        var cursor = allocator.dupe(u8, start) catch return;
        defer allocator.free(cursor);
        while (!self.stopping.load(.acquire)) {
            var events = self.store.readGlobalEvents(allocator, cursor) catch |err| {
                std.log.warn("Jam event reader reconnecting: {s}", .{@errorName(err)});
                self.resync();
                std.Io.sleep(self.io, .fromMilliseconds(100), .awake) catch {};
                continue;
            };
            defer events.deinit();
            if (events.needsResync) self.resync();
            for (events.events) |event| {
                var snapshot = (self.store.read(allocator, event.room) catch continue) orelse continue;
                defer snapshot.deinit();
                const body = std.json.Stringify.valueAlloc(allocator, .{ .type = "state", .state = snapshot.state, .serverTimeMs = snapshot.serverTimeMs }, .{}) catch continue;
                defer allocator.free(body);
                self.broadcast(event.room, body);
            }
            if (!std.mem.eql(u8, cursor, events.lastEventId)) {
                const next = allocator.dupe(u8, events.lastEventId) catch continue;
                allocator.free(cursor);
                cursor = next;
            }
            self.expire();
        }
    }
    fn resync(self: *Context) void {
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const a = arena.allocator();
        var rooms: std.StringHashMapUnmanaged(void) = .empty;
        self.mutex.lockUncancelable(self.io);
        for (self.peers.items) |peer| {
            const room = peer.ticket.admission.room;
            if (!rooms.contains(room)) rooms.put(a, a.dupe(u8, room) catch continue, {}) catch {};
        }
        self.mutex.unlock(self.io);
        var keys = rooms.keyIterator();
        while (keys.next()) |key| {
            const room = key.*;
            var snapshot = (self.store.read(a, room) catch continue) orelse continue;
            defer snapshot.deinit();
            const body = std.json.Stringify.valueAlloc(a, .{ .type = "state", .state = snapshot.state, .serverTimeMs = snapshot.serverTimeMs }, .{}) catch continue;
            self.broadcast(room, body);
        }
    }
};

const Peer = struct {
    context: *Context,
    conn: *websocket.Conn,
    arena: std.heap.ArenaAllocator,
    ticket: tickets.Ticket,
    writer: ?std.Thread = null,
    mutex: std.Io.Mutex = .init,
    changed: std.Io.Condition = .init,
    outbox: [16]?[]u8 = @splat(null),
    count: usize = 0,
    bytes: usize = 0,
    stopped: bool = false,
    window_ms: i64 = 0,
    messages: usize = 0,

    fn enqueue(self: *Peer, body: []const u8) void {
        const io = self.context.io;
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        if (self.stopped) return;
        if (self.count == self.outbox.len or self.bytes + body.len > max_outbox_bytes) {
            self.stopped = true;
            self.changed.signal(io);
            self.conn.interruptRead();
            return;
        }
        self.outbox[self.count] = allocator.dupe(u8, body) catch {
            self.stopped = true;
            self.changed.signal(io);
            self.conn.interruptRead();
            return;
        };
        self.count += 1;
        self.bytes += body.len;
        self.changed.signal(io);
    }
    fn stop(self: *Peer) void {
        self.mutex.lockUncancelable(self.context.io);
        self.stopped = true;
        self.changed.signal(self.context.io);
        self.mutex.unlock(self.context.io);
        self.conn.interruptRead();
    }
    fn send(self: *Peer) void {
        const io = self.context.io;
        while (true) {
            self.mutex.lockUncancelable(io);
            while (!self.stopped and self.count == 0) self.changed.waitUncancelable(io, &self.mutex);
            if (self.stopped) {
                self.mutex.unlock(io);
                return;
            }
            const body = self.outbox[0].?;
            self.count -= 1;
            for (0..self.count) |index| self.outbox[index] = self.outbox[index + 1];
            self.outbox[self.count] = null;
            self.bytes -= body.len;
            self.mutex.unlock(io);
            defer allocator.free(body);
            self.conn.writeText(body) catch {
                self.stop();
                return;
            };
        }
    }
};

const Handler = struct {
    peer: *Peer,

    pub fn init(handshake: *const websocket.Handshake, conn: *websocket.Conn, context: *Context) !Handler {
        const origin = handshake.headers.get("origin") orelse "";
        if (!context.allowed(origin) or !std.mem.startsWith(u8, handshake.url, "/v1/jams/socket?")) return error.AccessDenied;
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        const token = query(handshake.url, "ticket") orelse return error.InvalidTicket;
        const ticket = try context.tickets.consume(a, token);
        if (!std.mem.eql(u8, ticket.origin, origin) or ticket.admission.expires_ms <= try context.store.nowMs()) return error.AccessDenied;
        const peer = try allocator.create(Peer);
        errdefer allocator.destroy(peer);
        peer.* = .{ .context = context, .conn = conn, .arena = arena, .ticket = ticket };
        try conn.writeTimeout(500);
        context.mutex.lockUncancelable(context.io);
        defer context.mutex.unlock(context.io);
        if (context.peers.items.len >= 128) return error.Capacity;
        try context.peers.append(allocator, peer);
        return .{ .peer = peer };
    }
    pub fn afterInit(self: *Handler) !void {
        self.peer.writer = try std.Thread.spawn(.{}, Peer.send, .{self.peer});
        var snapshot = (try self.peer.context.store.read(allocator, self.peer.ticket.admission.room)) orelse return error.RoomNotStarted;
        defer snapshot.deinit();
        const body = try std.json.Stringify.valueAlloc(allocator, .{ .type = "state", .state = snapshot.state, .serverTimeMs = snapshot.serverTimeMs }, .{});
        defer allocator.free(body);
        self.peer.enqueue(body);
    }
    pub fn clientMessage(self: *Handler, data: []const u8) !void {
        const peer = self.peer;
        const context = peer.context;
        const now = try context.store.nowMs();
        if (now >= peer.ticket.admission.expires_ms) return error.AccessDenied;
        if (now - peer.window_ms >= 1000) {
            peer.window_ms = now;
            peer.messages = 0;
        }
        peer.messages += 1;
        if (peer.messages > 30) return error.RateLimited;
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const a = arena.allocator();
        const value = try std.json.parseFromSliceLeaky(std.json.Value, a, data, .{});
        if (std.mem.eql(u8, auth.string(value, "type") orelse "", "ping")) {
            var snapshot = (try context.store.read(a, peer.ticket.admission.room)) orelse return error.RoomNotStarted;
            defer snapshot.deinit();
            const current = try std.json.Stringify.valueAlloc(a, .{ .type = "state", .state = snapshot.state, .serverTimeMs = snapshot.serverTimeMs }, .{});
            peer.enqueue(current);
            const body = try std.json.Stringify.valueAlloc(a, .{ .type = "pong", .id = auth.string(value, "id") orelse "", .serverTimeMs = now, .clientTimeMs = if (value == .object) value.object.get("clientTimeMs") else null }, .{});
            peer.enqueue(body);
            return;
        }
        const command = try std.json.parseFromValueLeaky(model.Command, a, value, .{ .ignore_unknown_fields = true });
        var applied = try context.store.apply(a, peer.ticket.admission.room, peer.ticket.admission.actor, peer.ticket.admission.host, command);
        defer applied.deinit();
        const body = try std.json.Stringify.valueAlloc(a, .{ .type = "result", .id = command.id, .outcome = applied.outcome, .state = applied.snapshot.state, .serverTimeMs = applied.snapshot.serverTimeMs }, .{});
        peer.enqueue(body);
    }
    pub fn close(self: *Handler) void {
        const peer = self.peer;
        const context = peer.context;
        context.mutex.lockUncancelable(context.io);
        for (context.peers.items, 0..) |candidate, index| if (candidate == peer) {
            _ = context.peers.swapRemove(index);
            break;
        };
        context.mutex.unlock(context.io);
        peer.stop();
        if (peer.writer) |writer| writer.join();
        for (peer.outbox) |body| if (body) |bytes| allocator.free(bytes);
        peer.arena.deinit();
        allocator.destroy(peer);
    }
    pub fn httpFallback(conn: *websocket.Conn, method: []const u8, url: []const u8, body: []const u8, headers: *websocket.Handshake.KeyValue, context: *Context) void {
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const a = arena.allocator();
        const origin = headers.get("origin") orelse "";
        if (!context.allowed(origin)) return http(conn, a, 403, "{}", "");
        if (std.mem.eql(u8, method, "OPTIONS")) return http(conn, a, 204, "", origin);
        if (std.mem.eql(u8, url, "/health") or std.mem.eql(u8, url, "/ready")) {
            _ = context.store.nowMs() catch return http(conn, a, 503, "{}", origin);
            return http(conn, a, 200, "{\"status\":\"ok\",\"role\":\"jams\"}", origin);
        }
        if (std.mem.eql(u8, url, "/.well-known/did.json")) {
            const did = context.auth_config.audience[0 .. std.mem.indexOfScalar(u8, context.auth_config.audience, '#') orelse context.auth_config.audience.len];
            const result = std.json.Stringify.valueAlloc(a, .{ .id = did, .service = .{.{ .id = context.auth_config.audience, .type = "PlyrJamCoordinator", .serviceEndpoint = env("JAM_PUBLIC_URL") orelse "https://plyr-jams-next.fly.dev" }} }, .{}) catch return;
            return http(conn, a, 200, result, origin);
        }
        if (!std.mem.eql(u8, method, "POST") or !std.mem.eql(u8, url, "/v1/jams/join") or body.len > 60 * 1024) return http(conn, a, 404, "{}", origin);
        if (context.admissions.fetchAdd(1, .acq_rel) >= 2) {
            _ = context.admissions.fetchSub(1, .acq_rel);
            return http(conn, a, 503, "{}", origin);
        }
        defer _ = context.admissions.fetchSub(1, .acq_rel);
        join(conn, a, body, origin, context) catch |err| {
            std.log.warn("Jam admission failed: {s}", .{@errorName(err)});
            const result = std.json.Stringify.valueAlloc(a, .{ .@"error" = .{ .message = if (err == error.RoomNotStarted) "The host needs to start this Jam" else "Could not authorize this Jam" } }, .{}) catch return;
            const status: u16 = switch (err) {
                error.RoomNotStarted => 409,
                error.InvalidRoom, error.InvalidIdentity, error.InvalidDelegation, error.InvalidCredential, error.AccessDenied => 403,
                else => 503,
            };
            http(conn, a, status, result, origin);
        };
    }
};

fn join(conn: *websocket.Conn, a: std.mem.Allocator, body: []const u8, origin: []const u8, context: *Context) !void {
    const Request = struct {
        host: []const u8,
        key: []const u8,
        serviceToken: []const u8,
        delegationToken: []const u8,
        initial: ?struct { queue: []model.Track, index: u32 = 0, playing: bool = false, positionMs: u64 = 0 } = null,
    };
    const request = try std.json.parseFromSliceLeaky(Request, a, body, .{ .ignore_unknown_fields = true });
    const admission = try auth.admit(a, context.io, context.auth_config, request.host, request.key, request.serviceToken, request.delegationToken);
    var snapshot = try context.store.read(a, admission.room);
    defer if (snapshot) |*value| value.deinit();
    if (snapshot == null) {
        if (!std.mem.eql(u8, admission.actor, admission.host)) return error.RoomNotStarted;
        const initial = request.initial orelse return error.RoomNotStarted;
        var bytes: [16]u8 = undefined;
        context.io.random(&bytes);
        const epoch = try std.fmt.allocPrint(a, "{x}", .{bytes});
        snapshot = try context.store.createAt(a, admission.room, .{
            .epoch = epoch,
            .revision = 0,
            .queue = initial.queue,
            .index = initial.index,
            .occurrence = if (initial.queue.len == 0) 0 else 1,
            .playing = initial.playing,
            .positionMs = initial.positionMs,
            .updatedAtMs = 0,
        });
    }
    const token = try context.tickets.issue(a, admission, origin);
    http(conn, a, 200, try std.json.Stringify.valueAlloc(a, .{ .ticket = token }, .{}), origin);
}

fn http(conn: *websocket.Conn, a: std.mem.Allocator, status: u16, body: []const u8, origin: []const u8) void {
    const headers = std.fmt.allocPrint(a, "HTTP/1.1 {d} OK\r\nContent-Type: application/json\r\nContent-Length: {d}\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: {s}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\n\r\n", .{ status, body.len, origin }) catch return;
    var buffer: [4096]u8 = undefined;
    var writer = conn.stream.writer(conn.io, &buffer);
    writer.interface.writeAll(headers) catch return;
    writer.interface.writeAll(body) catch return;
    writer.interface.flush() catch return;
}

fn query(url: []const u8, key: []const u8) ?[]const u8 {
    const start = (std.mem.indexOfScalar(u8, url, '?') orelse return null) + 1;
    var parts = std.mem.splitScalar(u8, url[start..], '&');
    while (parts.next()) |part| {
        const equal = std.mem.indexOfScalar(u8, part, '=') orelse continue;
        if (std.mem.eql(u8, part[0..equal], key)) return part[equal + 1 ..];
    }
    return null;
}
fn env(key: [:0]const u8) ?[]const u8 {
    const value = std.c.getenv(key) orelse return null;
    return std.mem.span(value);
}
