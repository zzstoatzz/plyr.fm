//! MODE=space_consumer: keeps plyr's copy of every plyr space current from
//! plyr's space-stream. One socket per space, opened with a delegation token
//! the sync account (SPACE_SYNC_DID) mints on its own PDS and resumed from
//! the space's stored cursor. Admission lasts one space credential (ten
//! minutes); the stream then closes with 4401 and the follower reconnects
//! with a fresh token, which also makes the stream pull the space.

const std = @import("std");
const pg = @import("pg");
const websocket = @import("websocket");
const zat = @import("zat");
const sync = @import("sync.zig");
const postgres_sync_store = @import("postgres_sync_store.zig");

const log = std.log.scoped(.space_consumer);
const user_agent = "plyr.fm-zig-space-consumer/0.1 (+https://plyr.fm)";

/// close codes from space-stream's feed.ts
const close_deleted = 4404;

pub const Settings = struct {
    /// e.g. `plyr-space-stream.example.workers.dev`
    stream_host: []const u8,
    /// the sync account's PDS, e.g. `https://bsky.social`
    sync_pds: []const u8,
    sync_identifier: []const u8,
    sync_password: []const u8,
    space_type: []const u8,
    relist_ms: i64 = 60 * std.time.ms_per_s,
    max_backoff_ms: i64 = 10 * std.time.ms_per_min,
};

pub fn run(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, settings: Settings) !void {
    var account: Account = .{ .io = io, .allocator = allocator, .settings = settings };
    try account.login();
    var following: std.StringHashMapUnmanaged(void) = .empty;
    defer following.deinit(allocator);
    log.info("following plyr spaces on {s}", .{settings.stream_host});
    while (true) {
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const spaces = listSpaces(arena.allocator(), pool, settings.space_type) catch |err| blk: {
            log.err("could not list spaces: {}", .{err});
            break :blk &.{};
        };
        for (spaces) |space| {
            if (following.contains(space)) continue;
            const owned = try allocator.dupe(u8, space);
            const thread = std.Thread.spawn(.{}, follow, .{ io, allocator, pool, &account, owned }) catch |err| {
                log.err("could not follow {s}: {}", .{ space, err });
                allocator.free(owned);
                continue;
            };
            thread.detach();
            try following.put(allocator, owned, {});
        }
        try io.sleep(std.Io.Duration.fromMilliseconds(settings.relist_ms), .awake);
    }
}

/// every plyr space a public track points into
fn listSpaces(a: std.mem.Allocator, pool: *pg.Pool, space_type: []const u8) ![]const []const u8 {
    var result = try pool.query(list_spaces_sql, .{space_type});
    defer result.deinit();
    var out: std.ArrayList([]const u8) = .empty;
    while (try result.next()) |row| try out.append(a, try a.dupe(u8, try row.get([]const u8, 0)));
    return out.items;
}

const list_spaces_sql =
    \\SELECT DISTINCT substring(audio_space from '^(at://[^/]+/space/[^/]+/[^/]+)/')
    \\FROM plyr_index.track_records
    \\WHERE NOT deleted AND audio_space IS NOT NULL AND split_part(audio_space, '/', 5) = $1
    \\  AND substring(audio_space from '^(at://[^/]+/space/[^/]+/[^/]+)/') IS NOT NULL
;

fn follow(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, account: *Account, space: []const u8) void {
    var adapter: postgres_sync_store.PostgresSyncStore = .{ .pool = pool };
    const projector: sync.Projector = .{ .store = adapter.store() };
    var backoff_ms: i64 = std.time.ms_per_s;
    while (true) {
        const outcome = followOnce(io, allocator, account, projector, space) catch |err| blk: {
            log.warn("{s}: {}", .{ space, err });
            break :blk Connection.failed;
        };
        switch (outcome) {
            .deleted => {
                log.info("{s} was deleted; stopped following", .{space});
                return;
            },
            .expired => backoff_ms = std.time.ms_per_s,
            .failed => backoff_ms = @min(backoff_ms * 2, account.settings.max_backoff_ms),
        }
        io.sleep(std.Io.Duration.fromMilliseconds(backoff_ms), .awake) catch return;
    }
}

const Connection = enum { expired, deleted, failed };

fn followOnce(io: std.Io, allocator: std.mem.Allocator, account: *Account, projector: sync.Projector, space: []const u8) !Connection {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const token = try account.delegation(a, space);
    const held = try projector.store.cursor(space);
    var path: std.Io.Writer.Allocating = .init(a);
    try path.writer.writeAll("/subscribe?space=");
    try percentEncode(&path.writer, space);
    try path.writer.writeAll("&delegation=");
    try percentEncode(&path.writer, token);
    if (held) |cursor| try path.writer.print("&cursor={d}", .{cursor});

    const host = account.settings.stream_host;
    var client = try websocket.Client.init(io, allocator, .{ .host = host, .port = 443, .tls = true, .max_size = 4 * 1024 * 1024 });
    defer client.deinit();
    const host_header = try std.fmt.allocPrint(a, "Host: {s}\r\n", .{host});
    try client.handshake(path.written(), .{ .headers = host_header });
    configureKeepalive(&client);

    var handler: Handler = .{ .allocator = allocator, .projector = projector, .space = space, .held = held };
    try client.readLoop(&handler);
    if (handler.deleted) return .deleted;
    return .expired;
}

const Handler = struct {
    allocator: std.mem.Allocator,
    projector: sync.Projector,
    space: []const u8,
    held: ?u64,
    deleted: bool = false,

    pub fn serverMessage(self: *Handler, data: []u8) !void {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const event = sync.parseEvent(arena.allocator(), self.space, data) catch |err| {
            log.warn("{s}: unreadable stream event: {}", .{ self.space, err });
            return;
        } orelse return;
        // a projection failure ends the socket; the reconnect replays from `held`
        switch (try self.projector.handle(self.space, self.held, event)) {
            .dropped => {
                self.deleted = true;
                self.held = null;
            },
            .applied, .skipped => self.held = @max(self.held orelse 0, event.time_us),
        }
    }

    pub fn serverClose(self: *Handler, data: []u8) !void {
        if (data.len >= 2 and std.mem.readInt(u16, data[0..2], .big) == close_deleted) {
            // the feed keeps nothing about a deleted space; drop ours even if its event was missed
            if (!self.deleted) try self.projector.store.dropSpace(self.space);
            self.deleted = true;
        }
    }
};

/// The sync account's session, shared by every follower.
const Account = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    settings: Settings,
    mutex: std.Io.Mutex = .init,
    access_jwt: ?[]const u8 = null,

    fn login(self: *Account) !void {
        var transport = zat.HttpTransport.initWithUserAgent(self.io, self.allocator, user_agent);
        defer transport.deinit();
        const url = try std.fmt.allocPrint(self.allocator, "{s}/xrpc/com.atproto.server.createSession", .{self.settings.sync_pds});
        defer self.allocator.free(url);
        const body = try std.json.Stringify.valueAlloc(self.allocator, .{ .identifier = self.settings.sync_identifier, .password = self.settings.sync_password }, .{});
        defer self.allocator.free(body);
        var result = try transport.fetch(.{ .url = url, .method = .POST, .payload = body, .content_type = "application/json", .accept = "application/json", .on_redirect = .refuse });
        defer result.deinit(transport.allocator);
        if (result.status != .ok) {
            log.err("sync account login failed: {d}", .{@backingInt(result.status)});
            return error.SyncLoginFailed;
        }
        const Session = struct { accessJwt: []const u8 };
        const parsed = try std.json.parseFromSlice(Session, self.allocator, result.body, .{ .ignore_unknown_fields = true });
        defer parsed.deinit();
        const jwt = try self.allocator.dupe(u8, parsed.value.accessJwt);
        try self.mutex.lock(self.io);
        defer self.mutex.unlock(self.io);
        if (self.access_jwt) |old| self.allocator.free(old);
        self.access_jwt = jwt;
    }

    /// a single-use delegation token for `space`, logging in again once if the session lapsed
    fn delegation(self: *Account, a: std.mem.Allocator, space: []const u8) ![]const u8 {
        return self.mintDelegation(a, space) catch |err| switch (err) {
            error.SessionExpired => {
                try self.login();
                return self.mintDelegation(a, space);
            },
            else => err,
        };
    }

    fn mintDelegation(self: *Account, a: std.mem.Allocator, space: []const u8) ![]const u8 {
        const authorization = blk: {
            try self.mutex.lock(self.io);
            defer self.mutex.unlock(self.io);
            break :blk try std.fmt.allocPrint(a, "Bearer {s}", .{self.access_jwt orelse return error.SessionExpired});
        };
        var url: std.Io.Writer.Allocating = .init(a);
        try url.writer.print("{s}/xrpc/com.atproto.space.getDelegationToken?space=", .{self.settings.sync_pds});
        try percentEncode(&url.writer, space);
        var transport = zat.HttpTransport.initWithUserAgent(self.io, self.allocator, user_agent);
        defer transport.deinit();
        var result = try transport.fetch(.{ .url = url.written(), .authorization = authorization, .accept = "application/json", .on_redirect = .refuse });
        defer result.deinit(transport.allocator);
        switch (result.status) {
            .ok => {},
            .unauthorized, .bad_request => if (std.mem.indexOf(u8, result.body, "ExpiredToken") != null or result.status == .unauthorized) return error.SessionExpired else return error.DelegationRefused,
            else => return error.DelegationRefused,
        }
        const Token = struct { token: []const u8 };
        const parsed = try std.json.parseFromSliceLeaky(Token, a, result.body, .{ .ignore_unknown_fields = true, .allocate = .alloc_always });
        return parsed.token;
    }
};

fn percentEncode(writer: *std.Io.Writer, raw: []const u8) !void {
    for (raw) |byte| switch (byte) {
        'A'...'Z', 'a'...'z', '0'...'9', '-', '.', '_', '~' => try writer.writeByte(byte),
        else => try writer.print("%{X:0>2}", .{byte}),
    };
}

/// a dead peer surfaces as a read error within ~20s instead of a hang
fn configureKeepalive(client: *websocket.Client) void {
    const posix = std.posix;
    const fd = client.stream.stream.socket.handle;
    posix.setsockopt(fd, posix.SOL.SOCKET, posix.SO.KEEPALIVE, &std.mem.toBytes(@as(i32, 1))) catch return;
    const tcp: i32 = @intCast(posix.IPPROTO.TCP);
    if (@import("builtin").os.tag == .linux) {
        posix.setsockopt(fd, tcp, posix.TCP.KEEPIDLE, &std.mem.toBytes(@as(i32, 10))) catch return;
    }
    posix.setsockopt(fd, tcp, posix.TCP.KEEPINTVL, &std.mem.toBytes(@as(i32, 5))) catch return;
    posix.setsockopt(fd, tcp, posix.TCP.KEEPCNT, &std.mem.toBytes(@as(i32, 2))) catch return;
}

test "subscribe parameters are percent-encoded" {
    var out: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer out.deinit();
    try percentEncode(&out.writer, "at://did:plc:a/space/fm.plyr.next.audio/3k");
    try std.testing.expectEqualStrings("at%3A%2F%2Fdid%3Aplc%3Aa%2Fspace%2Ffm.plyr.next.audio%2F3k", out.written());
}

test "a deleted-space close drops the copy once" {
    const Fake = struct {
        drops: usize = 0,
        fn store(self: *@This()) sync.Store {
            return .{ .context = self, .cursor_fn = cursorFn, .apply_fn = applyFn, .drop_repo_fn = dropRepoFn, .drop_space_fn = dropSpaceFn, .advance_fn = advanceFn };
        }
        fn cursorFn(_: *anyopaque, _: []const u8) anyerror!?u64 {
            return null;
        }
        fn applyFn(_: *anyopaque, _: []const u8, _: u64, _: []const u8, _: []const u8, _: sync.Op) anyerror!void {}
        fn dropRepoFn(_: *anyopaque, _: []const u8, _: u64, _: []const u8) anyerror!void {}
        fn dropSpaceFn(c: *anyopaque, _: []const u8) anyerror!void {
            const self: *@This() = @ptrCast(@alignCast(c));
            self.drops += 1;
        }
        fn advanceFn(_: *anyopaque, _: []const u8, _: u64) anyerror!void {}
    };
    var fake: Fake = .{};
    const space = "at://did:plc:artist/space/fm.plyr.next.audio/3album";
    var handler: Handler = .{ .allocator = std.testing.allocator, .projector = .{ .store = fake.store() }, .space = space, .held = 3 };
    var event = "{\"did\":\"did:plc:artist\",\"time_us\":4,\"kind\":\"space_deleted\",\"space\":\"at://did:plc:artist/space/fm.plyr.next.audio/3album\"}".*;
    try handler.serverMessage(&event);
    var close = [_]u8{ 0x11, 0x34 } ++ "space deleted".*;
    try handler.serverClose(&close);
    try std.testing.expect(handler.deleted);
    try std.testing.expectEqual(@as(usize, 1), fake.drops);
    // a close for expiry (4401) is a reconnect, not a deletion
    var other: Handler = .{ .allocator = std.testing.allocator, .projector = .{ .store = fake.store() }, .space = space, .held = 3 };
    var expired = [_]u8{ 0x11, 0x31 };
    try other.serverClose(&expired);
    try std.testing.expect(!other.deleted);
}
