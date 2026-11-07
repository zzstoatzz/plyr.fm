const std = @import("std");
const redis = @import("redis");
const model = @import("model.zig");
const protocol = @import("protocol.zig");
const personal = @import("personal.zig");
const ConnectionConfig = @import("../redis/connection_config.zig").ConnectionConfig;

pub const global_stream = "plyr:next:jams:events";
pub const room_ttl_seconds = 24 * 60 * 60;
pub const room_event_limit = 8;
pub const command_limit = 256;
pub const global_event_limit = 1024;

pub const Snapshot = struct {
    arena: std.heap.ArenaAllocator,
    state: model.State,
    serverTimeMs: i64,
    lastEventId: []const u8,
    pub fn deinit(self: *Snapshot) void {
        self.arena.deinit();
    }
};
pub const Applied = struct {
    snapshot: Snapshot,
    outcome: model.Outcome,
    commandRevision: u64,
    pub fn deinit(self: *Applied) void {
        self.snapshot.deinit();
    }
};
pub const Event = struct { id: []const u8, room: []const u8, state: model.State, serverTimeMs: i64 };
pub const Events = struct {
    arena: std.heap.ArenaAllocator,
    events: []const Event,
    lastEventId: []const u8,
    pub fn deinit(self: *Events) void {
        self.arena.deinit();
    }
};

pub const GlobalEvent = struct { id: []const u8, room: []const u8, epoch: []const u8, revision: u64, serverTimeMs: i64 };
pub const GlobalEvents = struct {
    needsResync: bool = false,
    arena: std.heap.ArenaAllocator,
    events: []const GlobalEvent,
    lastEventId: []const u8,
    pub fn deinit(self: *GlobalEvents) void {
        self.arena.deinit();
    }
};

// Every returned snapshot/event owns its strings and must be deinitialized.
pub const Store = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    connection: ConnectionConfig,
    collection: []const u8,
    event_stream: []const u8,
    writer: ?redis.Client = null,
    reader: ?redis.Client = null,
    write_mutex: std.Io.Mutex = .init,
    read_mutex: std.Io.Mutex = .init,

    pub fn init(allocator: std.mem.Allocator, io: std.Io, url: []const u8, collection: []const u8) !Store {
        return initWithStream(allocator, io, url, collection, global_stream);
    }
    pub fn initWithStream(allocator: std.mem.Allocator, io: std.Io, url: []const u8, collection: []const u8, stream: []const u8) !Store {
        if (stream.len == 0 or stream.len > 256) return error.InvalidStream;
        var connection = try ConnectionConfig.parse(allocator, url);
        errdefer connection.deinit();
        const owned_collection = try allocator.dupe(u8, collection);
        errdefer allocator.free(owned_collection);
        return .{ .allocator = allocator, .io = io, .connection = connection, .collection = owned_collection, .event_stream = try allocator.dupe(u8, stream) };
    }
    pub fn deinit(self: *Store) void {
        if (self.writer) |*client| client.close();
        if (self.reader) |*client| client.close();
        self.connection.deinit();
        self.allocator.free(self.collection);
        self.allocator.free(self.event_stream);
    }
    pub fn nowMs(self: *Store) !i64 {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const reply = try self.send(arena.allocator(), &.{"TIME"}, false);
        const parts = try array(reply);
        if (parts.len != 2) return error.InvalidRedisReply;
        return (try std.fmt.parseInt(i64, try string(parts[0]), 10)) * 1000 +
            @divTrunc(try std.fmt.parseInt(i64, try string(parts[1]), 10), 1000);
    }
    pub fn read(self: *Store, allocator: std.mem.Allocator, room: []const u8) !?Snapshot {
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        const keys = try roomKeys(a, room);
        const reply = try self.send(a, &.{ "EVAL", read_script, "4", keys[0], keys[1], keys[2], keys[3] }, false);
        if (reply == .nil or (reply == .bulk and reply.bulk == null)) {
            arena.deinit();
            return null;
        }
        return try self.snapshot(&arena, reply);
    }
    pub fn create(self: *Store, allocator: std.mem.Allocator, room: []const u8, epoch: []const u8, queue: []const model.Track) !Snapshot {
        return self.createAt(allocator, room, .{ .epoch = epoch, .revision = 0, .queue = queue, .index = 0, .occurrence = if (queue.len == 0) 0 else 1, .playing = false, .positionMs = 0, .updatedAtMs = 0 });
    }
    pub fn createAt(self: *Store, allocator: std.mem.Allocator, room: []const u8, state: model.State) !Snapshot {
        if (state.revision != 0 or state.occurrence != @as(u64, if (state.queue.len == 0) 0 else 1) or
            !try model.validateState(allocator, state, self.collection)) return error.InvalidRoom;
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        const json = try std.json.Stringify.valueAlloc(a, state, .{});
        const keys = try roomKeys(a, room);
        const reply = try self.send(a, &.{ "EVAL", create_script, "5", keys[0], keys[1], keys[2], keys[3], self.event_stream, room, json }, false);
        return self.snapshot(&arena, reply);
    }
    pub fn apply(self: *Store, allocator: std.mem.Allocator, room: []const u8, actor_did: []const u8, host_did: []const u8, command: model.Command) !Applied {
        return self.applyAsClient(allocator, room, actor_did, host_did, command, .{});
    }
    pub fn applyAsClient(self: *Store, allocator: std.mem.Allocator, room: []const u8, actor_did: []const u8, host_did: []const u8, command: model.Command, client: protocol.Client) !Applied {
        if (!model.boundedId(command.id) or room.len == 0 or room.len > 2048 or actor_did.len > 512 or host_did.len > 512) return error.InvalidCommand;
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        const keys = try roomKeys(a, room);
        const command_json = try commandJson(a, command);
        const fingerprint = try digest(a, command_json);
        const identity = try std.fmt.allocPrint(a, "{s}\x00{s}", .{ actor_did, command.id });
        const dedup = try digest(a, identity);
        for (0..8) |_| {
            var current = try self.read(allocator, room) orelse return error.RoomNotFound;
            defer current.deinit();
            const decision = try model.transitionAsClient(a, current.state, command, actor_did, host_did, @max(current.serverTimeMs, current.state.updatedAtMs), self.collection, client);
            const candidate = try std.json.Stringify.valueAlloc(a, decision.state, .{});
            const revision = try std.fmt.allocPrint(a, "{d}", .{current.state.revision});
            const occurrence = try std.fmt.allocPrint(a, "{d}", .{command.occurrence});
            const reply = try self.send(a, &.{ "EVAL", apply_script, "5", keys[0], keys[1], keys[2], keys[3], self.event_stream, room, current.state.epoch, revision, dedup, fingerprint, @tagName(decision.outcome), candidate, @tagName(command.action), command.epoch, occurrence, if (current.state.personal != null and personal.canRebase(command.action)) "rebase" else "strict" }, false);
            const fields = try array(reply);
            if (fields.len == 1) {
                if (std.mem.eql(u8, try string(fields[0]), "missing")) return error.RoomNotFound;
                continue;
            }
            if (fields.len != 6) return error.InvalidRedisReply;
            const outcome = std.meta.stringToEnum(model.Outcome, try string(fields[0])) orelse return error.InvalidRedisReply;
            const value = try self.snapshot(&arena, .{ .array = fields[1..4] });
            return .{ .snapshot = value, .outcome = outcome, .commandRevision = try std.fmt.parseInt(u64, try string(fields[4]), 10) };
        }
        return error.RoomBusy;
    }
    pub fn readEvents(self: *Store, allocator: std.mem.Allocator, room: []const u8, after_id: []const u8) !Events {
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        const keys = try roomKeys(a, room);
        if (!validCursor(after_id)) return error.InvalidCursor;
        const start = try std.fmt.allocPrint(a, "({s}", .{after_id});
        const reply = try self.send(a, &.{ "XRANGE", keys[3], start, "+", "COUNT", "1" }, true);
        return self.events(&arena, try array(reply), room, after_id);
    }
    // One dedicated blocking reader per backend instance, never the writer socket.
    pub fn readGlobalEvents(self: *Store, allocator: std.mem.Allocator, after_id: []const u8) !GlobalEvents {
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        if (!validCursor(after_id)) return error.InvalidCursor;
        var reply = try self.send(a, &.{ "EVAL", global_read_script, "1", self.event_stream, after_id }, true);
        var parts = try array(reply);
        if (parts.len != 3) return error.InvalidRedisReply;
        if (std.mem.eql(u8, try string(parts[0]), "events") and (try array(parts[2])).len == 0) {
            _ = try self.send(a, &.{ "XREAD", "BLOCK", "250", "COUNT", "1", "STREAMS", self.event_stream, after_id }, true);
            reply = try self.send(a, &.{ "EVAL", global_read_script, "1", self.event_stream, after_id }, true);
            parts = try array(reply);
            if (parts.len != 3) return error.InvalidRedisReply;
        }
        if (std.mem.eql(u8, try string(parts[0]), "reset")) return .{ .arena = arena, .events = &.{}, .lastEventId = try a.dupe(u8, try string(parts[1])), .needsResync = true };
        const entries = try array(parts[2]);
        const result = try a.alloc(GlobalEvent, entries.len);
        var last = try a.dupe(u8, after_id);
        for (entries, 0..) |entry, index| {
            const entry_parts = try array(entry);
            if (entry_parts.len != 2) return error.InvalidRedisReply;
            const fields = try array(entry_parts[1]);
            last = try a.dupe(u8, try string(entry_parts[0]));
            const epoch = try eventField(fields, "epoch");
            if (!model.boundedId(epoch)) return error.InvalidRedisReply;
            result[index] = .{
                .id = last,
                .room = try eventField(fields, "room"),
                .epoch = epoch,
                .revision = try std.fmt.parseInt(u64, try eventField(fields, "revision"), 10),
                .serverTimeMs = try std.fmt.parseInt(i64, try eventField(fields, "time"), 10),
            };
        }
        return .{ .arena = arena, .events = result, .lastEventId = last };
    }
    fn snapshot(self: *Store, arena: *std.heap.ArenaAllocator, reply: redis.Value) !Snapshot {
        const a = arena.allocator();
        const values = try array(reply);
        if (values.len != 3) return error.InvalidRedisReply;
        const state = try std.json.parseFromSliceLeaky(model.State, a, try string(values[0]), .{ .allocate = .alloc_always });
        if (!try model.validateState(a, state, self.collection)) return error.InvalidRoomState;
        return .{ .arena = arena.*, .state = state, .serverTimeMs = try std.fmt.parseInt(i64, try string(values[1]), 10), .lastEventId = try a.dupe(u8, try string(values[2])) };
    }
    fn events(self: *Store, arena: *std.heap.ArenaAllocator, entries: []const redis.Value, room: ?[]const u8, after_id: []const u8) !Events {
        const a = arena.allocator();
        const result = try a.alloc(Event, entries.len);
        var last = try a.dupe(u8, after_id);
        for (entries, 0..) |entry, index| {
            const parts = try array(entry);
            if (parts.len != 2) return error.InvalidRedisReply;
            const fields = try array(parts[1]);
            var state_json: ?[]const u8 = null;
            var event_room = room;
            var event_time: ?[]const u8 = null;
            if (fields.len % 2 != 0) return error.InvalidRedisReply;
            var offset: usize = 0;
            while (offset < fields.len) : (offset += 2) {
                const field = try string(fields[offset]);
                const value = try string(fields[offset + 1]);
                if (std.mem.eql(u8, field, "state")) state_json = value;
                if (std.mem.eql(u8, field, "room")) event_room = value;
                if (std.mem.eql(u8, field, "time")) event_time = value;
            }
            const state = try std.json.parseFromSliceLeaky(model.State, a, state_json orelse return error.InvalidRedisReply, .{ .allocate = .alloc_always });
            if (!try model.validateState(a, state, self.collection)) return error.InvalidRoomState;
            last = try a.dupe(u8, try string(parts[0]));
            result[index] = .{ .id = last, .room = try a.dupe(u8, event_room orelse return error.InvalidRedisReply), .state = state, .serverTimeMs = try std.fmt.parseInt(i64, event_time orelse return error.InvalidRedisReply, 10) };
        }
        return .{ .arena = arena.*, .events = result, .lastEventId = last };
    }
    fn send(self: *Store, allocator: std.mem.Allocator, args: []const []const u8, reading: bool) !redis.Value {
        const mutex = if (reading) &self.read_mutex else &self.write_mutex;
        const connection = if (reading) &self.reader else &self.writer;
        mutex.lockUncancelable(self.io);
        defer mutex.unlock(self.io);
        if (connection.* == null) connection.* = if (!reading) try self.connection.connect(self.io, self.allocator) else try redis.Client.connectWithConfig(self.io, self.allocator, .{
            .host = self.connection.host,
            .port = self.connection.port,
            .username = self.connection.username,
            .password = self.connection.password,
            .db = self.connection.db,
            .read_timeout_ms = 1000,
            .write_timeout_ms = 250,
        });
        const reply = connection.*.?.sendCommand(args) catch |err| {
            connection.*.?.close();
            connection.* = null;
            return err;
        };
        return copyReply(allocator, reply);
    }
};

fn array(value: redis.Value) ![]const redis.Value {
    return switch (value) {
        .array => |v| v,
        else => error.InvalidRedisReply,
    };
}
fn string(value: redis.Value) ![]const u8 {
    return switch (value) {
        .string => |v| v,
        .bulk => |v| v orelse error.InvalidRedisReply,
        else => error.InvalidRedisReply,
    };
}
fn validCursor(cursor: []const u8) bool {
    if (cursor.len == 0 or cursor.len > 41) return false;
    const split = std.mem.indexOfScalar(u8, cursor, '-') orelse return false;
    if (split == 0 or split + 1 == cursor.len) return false;
    if ((split > 1 and cursor[0] == '0') or (cursor.len - split > 2 and cursor[split + 1] == '0')) return false;
    for (cursor[0..split]) |byte| if (!std.ascii.isDigit(byte)) return false;
    for (cursor[split + 1 ..]) |byte| if (!std.ascii.isDigit(byte)) return false;
    _ = std.fmt.parseInt(u64, cursor[0..split], 10) catch return false;
    _ = std.fmt.parseInt(u64, cursor[split + 1 ..], 10) catch return false;
    return true;
}

fn eventField(fields: []const redis.Value, key: []const u8) ![]const u8 {
    if (fields.len % 2 != 0) return error.InvalidRedisReply;
    var index: usize = 0;
    while (index < fields.len) : (index += 2) {
        if (std.mem.eql(u8, try string(fields[index]), key)) return string(fields[index + 1]);
    }
    return error.InvalidRedisReply;
}
fn copyReply(allocator: std.mem.Allocator, value: redis.Value) !redis.Value {
    return switch (value) {
        .string => |v| .{ .string = try allocator.dupe(u8, v) },
        .bulk => |v| .{ .bulk = if (v) |text| try allocator.dupe(u8, text) else null },
        .integer, .nil => value,
        .err => error.RedisRejected,
        .array => |v| blk: {
            const items = try allocator.alloc(redis.Value, v.len);
            for (v, 0..) |item, i| items[i] = try copyReply(allocator, item);
            break :blk .{ .array = items };
        },
    };
}
fn digest(allocator: std.mem.Allocator, text: []const u8) ![]const u8 {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(text, &hash, .{});
    return std.fmt.allocPrint(allocator, "{x}", .{hash});
}
const LegacyTrack = struct { id: []const u8, uri: []const u8, cid: []const u8, durationMs: u64 };

fn commandJson(a: std.mem.Allocator, command: model.Command) ![]const u8 {
    const legacy_action = switch (command.action) {
        .play, .pause, .seek, .replaceQueue, .selectTrack => true,
        else => false,
    };
    var legacy = legacy_action and command.entry == null and command.entryKey == null and command.beforeKey == null and
        command.label == null and command.repeat == null and command.keepPlaying == null and command.cursor == null and command.expectedOutput == null;
    if (command.queue) |queue| for (queue) |entry| {
        if (entry.key != null) {
            legacy = false;
            break;
        }
    };
    if (!legacy) return std.json.Stringify.valueAlloc(a, command, .{});
    const queue: ?[]LegacyTrack = if (command.queue) |entries| blk: {
        const converted = try a.alloc(LegacyTrack, entries.len);
        for (entries, converted) |entry, *out| out.* = .{ .id = entry.id, .uri = entry.uri, .cid = entry.cid, .durationMs = entry.durationMs };
        break :blk converted;
    } else null;
    return std.json.Stringify.valueAlloc(a, .{ .id = command.id, .epoch = command.epoch, .expectedRevision = command.expectedRevision, .occurrence = command.occurrence, .action = command.action, .playing = command.playing, .positionMs = command.positionMs, .queue = queue, .index = command.index }, .{});
}

test "legacy command fingerprints survive rolling coordinator upgrades" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const command: model.Command = .{ .id = "legacy", .epoch = "epoch", .expectedRevision = 0, .occurrence = 1, .action = .pause };
    try std.testing.expectEqualStrings(
        "{\"id\":\"legacy\",\"epoch\":\"epoch\",\"expectedRevision\":0,\"occurrence\":1,\"action\":\"pause\",\"playing\":null,\"positionMs\":null,\"queue\":null,\"index\":null}",
        try commandJson(arena.allocator(), command),
    );
}

fn roomKeys(allocator: std.mem.Allocator, room: []const u8) ![4][]const u8 {
    if (room.len == 0 or room.len > 2048) return error.InvalidRoom;
    const hash = try digest(allocator, room);
    var keys: [4][]const u8 = undefined;
    for ([_][]const u8{ "state", "commands", "command-order", "events" }, 0..) |suffix, i| keys[i] = try std.fmt.allocPrint(allocator, "plyr:next:jam:{s}:{s}", .{ hash, suffix });
    return keys;
}

const global_read_script =
    \\local first=redis.call('XRANGE',KEYS[1],'-','+','COUNT',1)
    \\if #first==0 then if ARGV[1]~='0-0' then return {'reset','0-0',{}} end; return {'events',ARGV[1],{}} end
    \\local last=redis.call('XREVRANGE',KEYS[1],'+','-','COUNT',1)[1][1]
    \\local function smaller(a,b)
    \\ local am,as=string.match(a,'^(%d+)%-(%d+)$'); local bm,bs=string.match(b,'^(%d+)%-(%d+)$')
    \\ if #am~=#bm then return #am<#bm end; if am~=bm then return am<bm end
    \\ if #as~=#bs then return #as<#bs end; return as<bs
    \\end
    \\if smaller(ARGV[1],first[1][1]) or smaller(last,ARGV[1]) then return {'reset',last,{}} end
    \\local entries=redis.call('XRANGE',KEYS[1],'('..ARGV[1],'+','COUNT',1)
    \\local cursor=ARGV[1]; if #entries>0 then cursor=entries[1][1] end; return {'events',cursor,entries}
;

// Redis cjson loses empty-array shape; encode the state envelope explicitly.
const lua_common =
    \\local function nowms()
    \\ local t=redis.call('TIME'); return tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
    \\end
    \\local function lastid(key)
    \\ local e=redis.call('XREVRANGE',key,'+','-','COUNT',1); if #e==0 then return '0-0' end; return e[1][1]
    \\end
    \\local function typesok()
    \\ local expected={'string','hash','list','stream','stream'}
    \\ for i,key in ipairs(KEYS) do local t=redis.call('TYPE',key).ok; if t~='none' and t~=expected[i] then return false end end
    \\ return true
    \\end
    \\local function encode(s)
    \\ local q={}; for i,t in ipairs(s.queue) do if type(s.personal)=='table' then q[i]=cjson.encode(t) else q[i]=cjson.encode({id=t.id,uri=t.uri,cid=t.cid,durationMs=t.durationMs}) end end
    \\ return '{"epoch":'..cjson.encode(s.epoch)..',"revision":'..string.format('%.0f',s.revision)..',"queue":['..table.concat(q,',')..'],"index":'..s.index..',"occurrence":'..string.format('%.0f',s.occurrence)..',"playing":'..tostring(s.playing)..',"positionMs":'..string.format('%.0f',s.positionMs)..',"updatedAtMs":'..string.format('%.0f',s.updatedAtMs)..(type(s.personal)=='table' and ',"personal":'..cjson.encode(s.personal) or '')..'}'
    \\end
    \\
;
const read_script = lua_common ++
    \\local raw=redis.call('GET',KEYS[1]); if not raw then return false end
    \\local s=cjson.decode(raw)
    \\for i,key in ipairs(KEYS) do if i==1 and type(s.personal)=='table' then redis.call('PERSIST',key) else redis.call('EXPIRE',key,86400) end end
    \\return {raw,tostring(math.max(nowms(),s.updatedAtMs)),lastid(KEYS[4])}
;
const create_script = lua_common ++
    \\if not typesok() then return redis.error_reply('invalid room keys') end
    \\local raw=redis.call('GET',KEYS[1]); if raw then local s=cjson.decode(raw); return {raw,tostring(math.max(nowms(),s.updatedAtMs)),lastid(KEYS[4])} end
    \\local s=cjson.decode(ARGV[2]); s.updatedAtMs=nowms(); raw=encode(s)
    \\redis.call('DEL',KEYS[2],KEYS[3],KEYS[4]); redis.call('SET',KEYS[1],raw,'EX',86400); if type(s.personal)=='table' then redis.call('PERSIST',KEYS[1]) end
    \\local id=redis.call('XADD',KEYS[4],'MAXLEN',8,'*','state',raw,'time',tostring(s.updatedAtMs))
    \\redis.call('EXPIRE',KEYS[4],86400)
    \\redis.call('XADD',KEYS[5],'MAXLEN',1024,'*','room',ARGV[1],'epoch',s.epoch,'revision',string.format('%.0f',s.revision),'time',tostring(s.updatedAtMs))
    \\return {raw,tostring(s.updatedAtMs),id}
;
const apply_script = lua_common ++
    \\if not typesok() then return redis.error_reply('invalid room keys') end
    \\local raw=redis.call('GET',KEYS[1]); if not raw then return {'missing'} end
    \\local s=cjson.decode(raw); local now=math.max(nowms(),s.updatedAtMs)
    \\local function result(outcome,rev) return {outcome,raw,tostring(now),lastid(KEYS[4]),rev,'ok'} end
    \\if s.epoch~=ARGV[9] or (type(s.personal)~='table' and ARGV[11]~='rebase' and s.occurrence~=tonumber(ARGV[10])) then return result('conflict',string.format('%.0f',s.revision)) end
    \\local cached=redis.call('HGET',KEYS[2],ARGV[4])
    \\if cached then local fingerprint,outcome,rev=string.match(cached,'([^|]+)|([^|]+)|([^|]+)'); if fingerprint~=ARGV[5] then return result('invalid',string.format('%.0f',s.revision)) end; if outcome=='applied' or outcome=='noop' then return result('duplicate',rev) end; return result(outcome,rev) end
    \\if type(s.personal)=='table' and ARGV[11]~='rebase' and s.occurrence~=tonumber(ARGV[10]) then return result('conflict',string.format('%.0f',s.revision)) end
    \\if s.epoch~=ARGV[2] or s.revision~=tonumber(ARGV[3]) then return {'retry'} end
    \\local outcome=ARGV[6]
    \\if outcome=='applied' then
    \\ local n=cjson.decode(ARGV[7]); if ARGV[8]~='seek' and ARGV[8]~='progress' and ARGV[8]~='advance' and n.occurrence==s.occurrence then
    \\  local elapsed=0; if s.playing then elapsed=math.max(0,now-s.updatedAtMs) end
    \\  local duration=0; if #n.queue>0 then duration=n.queue[n.index+1].durationMs; if duration==0 and type(n.personal)=='table' then duration=86400000 end end
    \\  n.positionMs=math.min(duration,s.positionMs+elapsed); if type(s.personal)=='table' and s.personal['repeat']=='one' and s.playing and duration>0 and s.queue[s.index+1].durationMs>0 then n.positionMs=(s.positionMs+elapsed)%duration end
    \\ end
    \\ n.updatedAtMs=now; raw=encode(n); s=n; redis.call('SET',KEYS[1],raw,'EX',86400); if type(s.personal)=='table' then redis.call('PERSIST',KEYS[1]) end
    \\ redis.call('XADD',KEYS[4],'MAXLEN',8,'*','state',raw,'time',tostring(now)); redis.call('EXPIRE',KEYS[4],86400)
    \\ redis.call('XADD',KEYS[5],'MAXLEN',1024,'*','room',ARGV[1],'epoch',s.epoch,'revision',string.format('%.0f',s.revision),'time',tostring(now))
    \\end
    \\redis.call('HSET',KEYS[2],ARGV[4],ARGV[5]..'|'..outcome..'|'..string.format('%.0f',s.revision)); redis.call('RPUSH',KEYS[3],ARGV[4])
    \\while redis.call('LLEN',KEYS[3])>256 do redis.call('HDEL',KEYS[2],redis.call('LPOP',KEYS[3])) end
    \\redis.call('EXPIRE',KEYS[2],86400); redis.call('EXPIRE',KEYS[3],86400)
    \\return result(outcome,string.format('%.0f',s.revision))
;

const fixture_cid = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const fixture_collection = "fm.plyr.dev.track";
const fixture_host = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const fixture_guest = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";

fn fixtureTrack(allocator: std.mem.Allocator, rkey: []const u8) !model.Track {
    const track_id = @import("../identity/track_id.zig");
    const uri = try std.fmt.allocPrint(allocator, "at://{s}/{s}/{s}", .{ fixture_host, fixture_collection, rkey });
    const id = try allocator.alloc(u8, track_id.encodedLength(uri));
    return .{ .id = try track_id.encode(id, uri), .uri = uri, .cid = fixture_cid, .durationMs = 300_000 };
}

const Race = struct {
    store: *Store,
    room: []const u8,
    command: model.Command,
    ready: *std.atomic.Value(u8),
    go: *std.atomic.Value(bool),
    actor: []const u8 = fixture_host,
    client: protocol.Client = .{},
    outcome: ?model.Outcome = null,
    failure: ?anyerror = null,
    fn run(self: *Race) void {
        _ = self.ready.fetchAdd(1, .release);
        while (!self.go.load(.acquire)) std.atomic.spinLoopHint();
        var result = self.store.applyAsClient(std.heap.page_allocator, self.room, self.actor, fixture_host, self.command, self.client) catch |err| {
            self.failure = err;
            return;
        };
        defer result.deinit();
        self.outcome = result.outcome;
    }
};

test "Redis sequences two instances, deduplicates commands, and preserves epochs and permissions" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var left = try Store.init(allocator, io, std.mem.span(url_z), fixture_collection);
    defer left.deinit();
    var right = try Store.init(allocator, io, std.mem.span(url_z), fixture_collection);
    defer right.deinit();
    var random: [16]u8 = undefined;
    io.random(&random);
    const room = try std.fmt.allocPrint(a, "integration:jam:{x}", .{random});
    const keys = try roomKeys(a, room);
    defer _ = left.send(a, &.{ "DEL", keys[0], keys[1], keys[2], keys[3] }, false) catch {};
    const tracks = [_]model.Track{ try fixtureTrack(a, "first"), try fixtureTrack(a, "second") };
    const at_room = try std.fmt.allocPrint(a, "{s}:initial", .{room});
    const at_keys = try roomKeys(a, at_room);
    defer _ = left.send(a, &.{ "DEL", at_keys[0], at_keys[1], at_keys[2], at_keys[3] }, false) catch {};
    const before_create = try left.nowMs();
    var inherited = try left.createAt(allocator, at_room, .{ .epoch = "inherited", .revision = 0, .queue = &tracks, .index = 1, .occurrence = 1, .playing = true, .positionMs = 5432, .updatedAtMs = 0 });
    defer inherited.deinit();
    try std.testing.expectEqual(@as(u32, 1), inherited.state.index);
    try std.testing.expect(inherited.state.playing);
    try std.testing.expectEqual(@as(u64, 5432), inherited.state.positionMs);
    try std.testing.expect(inherited.state.updatedAtMs >= before_create);
    _ = try left.send(a, &.{ "DEL", at_keys[0], at_keys[1], at_keys[2], at_keys[3] }, false);
    var empty = try right.create(allocator, at_room, "empty", &.{});
    defer empty.deinit();
    try std.testing.expectEqual(@as(usize, 0), empty.state.queue.len);
    try std.testing.expect(!empty.state.playing);
    var initial = try left.create(allocator, room, "initial-epoch", &tracks);
    defer initial.deinit();
    try std.testing.expect(initial.serverTimeMs > 0);
    var preserved = try right.create(allocator, room, "other-epoch", &.{});
    defer preserved.deinit();
    try std.testing.expectEqualStrings("initial-epoch", preserved.state.epoch);
    try std.testing.expectEqual(@as(usize, 2), preserved.state.queue.len);
    var ready = std.atomic.Value(u8).init(0);
    var go = std.atomic.Value(bool).init(false);
    var first: Race = .{ .store = &left, .room = room, .ready = &ready, .go = &go, .command = .{ .id = "seek-left", .epoch = "initial-epoch", .expectedRevision = 0, .occurrence = 1, .action = .seek, .positionMs = 1000 } };
    var second = first;
    second.store = &right;
    second.command.id = "seek-right";
    second.command.positionMs = 2000;
    const first_thread = try std.Thread.spawn(.{}, Race.run, .{&first});
    const second_thread = try std.Thread.spawn(.{}, Race.run, .{&second});
    while (ready.load(.acquire) != 2) std.atomic.spinLoopHint();
    go.store(true, .release);
    first_thread.join();
    second_thread.join();
    try std.testing.expect(first.failure == null and second.failure == null);
    const winner = if (first.outcome == .applied) first.command else second.command;
    try std.testing.expect(first.outcome == .applied and second.outcome == .conflict or first.outcome == .conflict and second.outcome == .applied);
    var duplicate = try right.apply(allocator, room, fixture_host, fixture_host, winner);
    defer duplicate.deinit();
    try std.testing.expectEqual(model.Outcome.duplicate, duplicate.outcome);
    try std.testing.expectEqual(@as(u64, 1), duplicate.commandRevision);
    var changed = winner;
    changed.positionMs = 9999;
    var collision = try left.apply(allocator, room, fixture_host, fixture_host, changed);
    defer collision.deinit();
    try std.testing.expectEqual(model.Outcome.invalid, collision.outcome);
    var command: model.Command = .{ .id = "guest-seek", .epoch = "initial-epoch", .expectedRevision = 1, .occurrence = 1, .action = .seek, .positionMs = 50 };
    var forbidden = try left.apply(allocator, room, fixture_guest, fixture_host, command);
    defer forbidden.deinit();
    try std.testing.expectEqual(model.Outcome.forbidden, forbidden.outcome);
    command.id = "guest-play";
    command.action = .play;
    command.positionMs = null;
    var playing = try right.apply(allocator, room, fixture_guest, fixture_host, command);
    defer playing.deinit();
    try std.testing.expectEqual(model.Outcome.applied, playing.outcome);
    command.id = "pause-one";
    command.action = .pause;
    command.expectedRevision = 2;
    ready.store(0, .release);
    go.store(false, .release);
    var pause_left: Race = .{ .store = &left, .room = room, .ready = &ready, .go = &go, .command = command, .actor = fixture_guest };
    var pause_right = pause_left;
    pause_right.store = &right;
    pause_right.actor = fixture_host;
    pause_right.command.id = "pause-two";
    const pause_thread_left = try std.Thread.spawn(.{}, Race.run, .{&pause_left});
    const pause_thread_right = try std.Thread.spawn(.{}, Race.run, .{&pause_right});
    while (ready.load(.acquire) != 2) std.atomic.spinLoopHint();
    go.store(true, .release);
    pause_thread_left.join();
    pause_thread_right.join();
    try std.testing.expect(pause_left.failure == null and pause_right.failure == null);
    try std.testing.expect(pause_left.outcome == .applied and pause_right.outcome == .noop or pause_left.outcome == .noop and pause_right.outcome == .applied);
    var same = (try right.read(allocator, room)).?;
    defer same.deinit();
    try std.testing.expectEqual(@as(u64, 3), same.state.revision);
    try std.testing.expect(!same.state.playing);
    command.id = "late-play";
    command.action = .play;
    var delayed = try left.apply(allocator, room, fixture_guest, fixture_host, command);
    defer delayed.deinit();
    try std.testing.expectEqual(model.Outcome.conflict, delayed.outcome);
    command.id = "next-track";
    command.action = .selectTrack;
    command.index = 1;
    command.playing = true;
    command.expectedRevision = 3;
    var selected = try right.apply(allocator, room, fixture_guest, fixture_host, command);
    defer selected.deinit();
    try std.testing.expectEqual(model.Outcome.applied, selected.outcome);
    try std.testing.expectEqual(@as(u64, 2), selected.snapshot.state.occurrence);
    try std.testing.expect(selected.snapshot.state.playing);
    command.id = "late-pause";
    command.action = .pause;
    command.index = null;
    command.playing = null;
    command.expectedRevision = 4;
    var late = try left.apply(allocator, room, fixture_guest, fixture_host, command);
    defer late.deinit();
    try std.testing.expectEqual(model.Outcome.conflict, late.outcome);
    var events = try right.readEvents(allocator, room, initial.lastEventId);
    defer events.deinit();
    try std.testing.expectEqual(@as(usize, 1), events.events.len);
    try std.testing.expectEqual(@as(u64, 1), events.events[0].state.revision);
    try std.testing.expectEqualStrings(room, events.events[0].room);
    const tail = try left.send(a, &.{ "XREVRANGE", global_stream, "+", "-", "COUNT", "1" }, false);
    const tail_entries = try array(tail);
    const cursor = try string((try array(tail_entries[0]))[0]);
    command = .{ .id = "host-seek", .epoch = "initial-epoch", .expectedRevision = 4, .occurrence = 2, .action = .seek, .positionMs = 5000 };
    var seek = try left.apply(allocator, room, fixture_host, fixture_host, command);
    defer seek.deinit();
    var global_cursor = cursor;
    var observed = false;
    for (0..32) |_| {
        var global = try right.readGlobalEvents(allocator, global_cursor);
        defer global.deinit();
        for (global.events) |event| if (std.mem.eql(u8, event.room, room) and event.revision == 5) {
            try std.testing.expectEqualStrings("initial-epoch", event.epoch);
            observed = true;
        };
        if (observed) break;
        global_cursor = try a.dupe(u8, global.lastEventId);
    }
    try std.testing.expect(observed);
    _ = try left.send(a, &.{ "DEL", keys[1] }, false);
    _ = try left.send(a, &.{ "SET", keys[1], "wrong-type" }, false);
    command.id = "wrong-type-preflight";
    command.expectedRevision = 5;
    try std.testing.expectError(error.RedisRejected, left.apply(allocator, room, fixture_host, fixture_host, command));
    var unchanged = (try right.read(allocator, room)).?;
    defer unchanged.deinit();
    try std.testing.expectEqual(@as(u64, 5), unchanged.state.revision);
    _ = try left.send(a, &.{ "EXPIRE", keys[0], "1" }, false);
    var renewed = (try right.read(allocator, room)).?;
    defer renewed.deinit();
    const remaining = try left.send(a, &.{ "TTL", keys[0] }, false);
    try std.testing.expect(remaining.integer > room_ttl_seconds - 10);
    _ = try left.send(a, &.{ "DEL", keys[1] }, false);
    for (0..270) |index| {
        command.id = try std.fmt.allocPrint(a, "bounded-{d}", .{index});
        command.expectedRevision = 5 + index;
        command.positionMs = index;
        var result = try left.apply(allocator, room, fixture_host, fixture_host, command);
        defer result.deinit();
        try std.testing.expectEqual(model.Outcome.applied, result.outcome);
    }
    const event_count = try left.send(a, &.{ "XLEN", keys[3] }, false);
    const command_count = try left.send(a, &.{ "HLEN", keys[1] }, false);
    const command_order = try left.send(a, &.{ "LLEN", keys[2] }, false);
    try std.testing.expectEqual(@as(i64, room_event_limit), event_count.integer);
    try std.testing.expectEqual(@as(i64, command_limit), command_count.integer);
    try std.testing.expectEqual(@as(i64, command_limit), command_order.integer);
}

test "Redis reader resyncs trimmed and reset streams, reconnects, and rejects expired-room commands" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var random: [16]u8 = undefined;
    io.random(&random);
    const stream = try std.fmt.allocPrint(a, "integration:jam-events:{x}", .{random});
    const room = try std.fmt.allocPrint(a, "integration:jam-quiet:{x}", .{random});
    const noisy = try std.fmt.allocPrint(a, "integration:jam-noisy:{x}", .{random});
    var left = try Store.initWithStream(allocator, io, std.mem.span(url_z), fixture_collection, stream);
    defer left.deinit();
    var right = try Store.initWithStream(allocator, io, std.mem.span(url_z), fixture_collection, stream);
    defer right.deinit();
    const keys = try roomKeys(a, room);
    const noisy_keys = try roomKeys(a, noisy);
    defer _ = left.send(a, &.{ "DEL", keys[0], keys[1], keys[2], keys[3], noisy_keys[0], noisy_keys[1], noisy_keys[2], noisy_keys[3], stream }, false) catch {};
    const tracks = [_]model.Track{try fixtureTrack(a, "recovery")};
    var initial = try left.create(allocator, room, "original", &tracks);
    defer initial.deinit();
    var command: model.Command = .{ .id = "play", .epoch = "original", .expectedRevision = 0, .occurrence = 1, .action = .play };
    var played = try left.apply(allocator, room, fixture_guest, fixture_host, command);
    defer played.deinit();
    const tail = try left.send(a, &.{ "XREVRANGE", stream, "+", "-", "COUNT", "1" }, false);
    const cursor = try string((try array((try array(tail))[0]))[0]);
    command = .{ .id = "pause", .epoch = "original", .expectedRevision = 1, .occurrence = 1, .action = .pause };
    var paused = try left.apply(allocator, room, fixture_guest, fixture_host, command);
    defer paused.deinit();
    var noise = try left.create(allocator, noisy, "noise", &tracks);
    defer noise.deinit();
    _ = try left.send(a, &.{ "XTRIM", stream, "MAXLEN", "1" }, false);
    var trimmed = try right.readGlobalEvents(allocator, cursor);
    defer trimmed.deinit();
    try std.testing.expect(trimmed.needsResync and trimmed.events.len == 0);
    var recovered = (try right.read(allocator, room)).?;
    defer recovered.deinit();
    try std.testing.expectEqual(@as(u64, 2), recovered.state.revision);
    try std.testing.expect(!recovered.state.playing);
    command = .{ .id = "stale-seek", .epoch = "original", .expectedRevision = 1, .occurrence = 1, .action = .seek, .positionMs = 1000 };
    var stale = try left.apply(allocator, room, fixture_host, fixture_host, command);
    defer stale.deinit();
    try std.testing.expectEqual(model.Outcome.conflict, stale.outcome);
    const reader_id = try right.send(a, &.{ "CLIENT", "ID" }, true);
    const reader_text = try std.fmt.allocPrint(a, "{d}", .{reader_id.integer});
    _ = try left.send(a, &.{ "CLIENT", "KILL", "ID", reader_text }, false);
    var disconnected = false;
    if (right.readGlobalEvents(allocator, trimmed.lastEventId)) |value| {
        var result = value;
        result.deinit();
    } else |_| disconnected = true;
    try std.testing.expect(disconnected and right.reader == null);
    command.id = "fresh-seek";
    command.expectedRevision = 2;
    var sought = try left.apply(allocator, room, fixture_host, fixture_host, command);
    defer sought.deinit();
    var resumed = try right.readGlobalEvents(allocator, trimmed.lastEventId);
    defer resumed.deinit();
    try std.testing.expect(!resumed.needsResync and resumed.events.len == 1);
    try std.testing.expectEqualStrings(room, resumed.events[0].room);
    _ = try left.send(a, &.{ "DEL", stream }, false);
    var reset = try right.readGlobalEvents(allocator, resumed.lastEventId);
    defer reset.deinit();
    try std.testing.expect(reset.needsResync);
    try std.testing.expectEqualStrings("0-0", reset.lastEventId);
    _ = try left.send(a, &.{ "XADD", stream, "1-0", "room", room, "epoch", "original", "revision", "3", "time", "1" }, false);
    var rolled_back = try right.readGlobalEvents(allocator, resumed.lastEventId);
    defer rolled_back.deinit();
    try std.testing.expect(rolled_back.needsResync);
    try std.testing.expectEqualStrings("1-0", rolled_back.lastEventId);
    _ = try left.send(a, &.{ "PEXPIRE", keys[0], "20" }, false);
    try std.Io.sleep(io, .fromMilliseconds(40), .awake);
    try std.testing.expect(try right.read(allocator, room) == null);
    var reborn = try right.create(allocator, room, "replacement", &tracks);
    defer reborn.deinit();
    var old = try left.apply(allocator, room, fixture_host, fixture_host, command);
    defer old.deinit();
    try std.testing.expectEqual(model.Outcome.conflict, old.outcome);
    try std.testing.expectEqualStrings("replacement", old.snapshot.state.epoch);
    try std.testing.expectEqual(@as(u64, 0), old.snapshot.state.revision);
}

const latency_samples = 128;
const Observer = struct {
    store: *Store,
    room: []const u8,
    cursor: []const u8,
    ready: std.atomic.Value(bool) = .init(false),
    stop: std.atomic.Value(bool) = .init(false),
    failed: std.atomic.Value(bool) = .init(false),
    seen: std.atomic.Value(usize) = .init(0),
    failure: ?anyerror = null,
    event_us: [latency_samples]i64 = undefined,
    state_us: [latency_samples]i64 = undefined,
    fn run(self: *Observer) void {
        self.collect() catch |err| {
            self.failure = err;
            self.failed.store(true, .release);
        };
    }
    fn collect(self: *Observer) !void {
        const a = std.heap.smp_allocator;
        var cursor = try a.dupe(u8, self.cursor);
        defer a.free(cursor);
        self.ready.store(true, .release);
        while (self.seen.load(.monotonic) < latency_samples and !self.stop.load(.acquire)) {
            var events = try self.store.readGlobalEvents(a, cursor);
            defer events.deinit();
            if (events.needsResync) return error.UnexpectedResync;
            for (events.events) |event| {
                if (!std.mem.eql(u8, event.room, self.room) or event.revision == 0 or event.revision > latency_samples) return error.UnexpectedEvent;
                const index: usize = @intCast(event.revision - 1);
                self.event_us[index] = std.Io.Timestamp.now(self.store.io, .awake).toMicroseconds();
                var state = (try self.store.read(a, self.room)) orelse return error.RoomNotFound;
                defer state.deinit();
                if (state.state.revision != event.revision) return error.UnexpectedRevision;
                self.state_us[index] = std.Io.Timestamp.now(self.store.io, .awake).toMicroseconds();
                const next = try a.dupe(u8, events.lastEventId);
                a.free(cursor);
                cursor = next;
                self.seen.store(index + 1, .release);
            }
        }
    }
};

fn percentiles(values: *[latency_samples]i64) struct { p50: i64, p95: i64 } {
    std.mem.sort(i64, values, {}, std.sort.asc(i64));
    return .{ .p50 = values[latency_samples / 2], .p95 = values[latency_samples * 95 / 100] };
}

test "measure local Redis cross-store command to event and fresh-state latency" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    for ([_]usize{ 1, 200 }) |track_count| {
        var random: [16]u8 = undefined;
        io.random(&random);
        const room = try std.fmt.allocPrint(a, "integration:jam-latency:{x}", .{random});
        const stream = try std.fmt.allocPrint(a, "integration:jam-latency-events:{x}", .{random});
        var producer = try Store.initWithStream(allocator, io, std.mem.span(url_z), fixture_collection, stream);
        defer producer.deinit();
        var consumer = try Store.initWithStream(allocator, io, std.mem.span(url_z), fixture_collection, stream);
        defer consumer.deinit();
        const keys = try roomKeys(a, room);
        defer _ = producer.send(a, &.{ "DEL", keys[0], keys[1], keys[2], keys[3], stream }, false) catch {};
        const queue = try a.alloc(model.Track, track_count);
        for (queue, 0..) |*track, index| track.* = try fixtureTrack(a, try std.fmt.allocPrint(a, "latency-{d}", .{index}));
        var initial = try producer.create(allocator, room, "latency", queue);
        defer initial.deinit();
        const tail = try producer.send(a, &.{ "XREVRANGE", stream, "+", "-", "COUNT", "1" }, false);
        const cursor = try string((try array((try array(tail))[0]))[0]);
        var observer: Observer = .{ .store = &consumer, .room = room, .cursor = cursor };
        const thread = try std.Thread.spawn(.{}, Observer.run, .{&observer});
        defer {
            observer.stop.store(true, .release);
            thread.join();
        }
        while (!observer.ready.load(.acquire) and !observer.failed.load(.acquire)) std.atomic.spinLoopHint();
        var event_latency: [latency_samples]i64 = undefined;
        var snapshot_latency: [latency_samples]i64 = undefined;
        var acknowledgement: [latency_samples]i64 = undefined;
        var after_ack: [latency_samples]i64 = undefined;
        for (0..latency_samples) |index| {
            try std.Io.sleep(io, .fromMilliseconds(1), .awake);
            const command: model.Command = .{ .id = try std.fmt.allocPrint(a, "latency-{d}", .{index}), .epoch = "latency", .expectedRevision = index, .occurrence = 1, .action = .seek, .positionMs = index * 1000 };
            const started = std.Io.Timestamp.now(io, .awake).toMicroseconds();
            var applied = try producer.apply(std.heap.smp_allocator, room, fixture_host, fixture_host, command);
            const acknowledged = std.Io.Timestamp.now(io, .awake).toMicroseconds();
            applied.deinit();
            while (observer.seen.load(.acquire) <= index and !observer.failed.load(.acquire)) try std.Io.sleep(io, .fromMicroseconds(50), .awake);
            if (observer.failed.load(.acquire)) return observer.failure.?;
            event_latency[index] = observer.event_us[index] - started;
            snapshot_latency[index] = observer.state_us[index] - started;
            acknowledgement[index] = acknowledged - started;
            after_ack[index] = observer.event_us[index] - acknowledged;
        }
        const event = percentiles(&event_latency);
        const snapshot = percentiles(&snapshot_latency);
        const ack = percentiles(&acknowledgement);
        const relative = percentiles(&after_ack);
        std.debug.print("Jam local Redis {s} tracks={d} n={d}: request->event p50={d}us p95={d}us; request->fresh-state p50={d}us p95={d}us; apply-ack p50={d}us p95={d}us; ack->event p50={d}us p95={d}us\n", .{ @tagName(@import("builtin").mode), track_count, latency_samples, event.p50, event.p95, snapshot.p50, snapshot.p95, ack.p50, ack.p95, relative.p50, relative.p95 });
    }
}

test "personal queues persist idle state and merge concurrent edits across Redis clients" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var left = try Store.init(allocator, io, std.mem.span(url_z), fixture_collection);
    defer left.deinit();
    var right = try Store.init(allocator, io, std.mem.span(url_z), fixture_collection);
    defer right.deinit();
    var random: [16]u8 = undefined;
    io.random(&random);
    const room = try std.fmt.allocPrint(a, "integration:personal:{x}", .{random});
    const keys = try roomKeys(a, room);
    defer _ = left.send(a, &.{ "DEL", keys[0], keys[1], keys[2], keys[3] }, false) catch {};
    var current = try fixtureTrack(a, "current");
    current.key = "current";
    var initial = try left.createAt(allocator, room, .{ .epoch = "personal", .revision = 0, .queue = &.{current}, .index = 0, .occurrence = 1, .playing = false, .positionMs = 5432, .updatedAtMs = 0, .personal = .{ .explicitEnd = 1 } });
    defer initial.deinit();
    try std.testing.expectEqual(@as(i64, -1), (try left.send(a, &.{ "TTL", keys[0] }, false)).integer);
    var first = try fixtureTrack(a, "same");
    first.key = "pick-a";
    var second = first;
    second.key = "pick-b";
    var ready: std.atomic.Value(u8) = .init(0);
    var go: std.atomic.Value(bool) = .init(false);
    var one: Race = .{ .store = &left, .room = room, .ready = &ready, .go = &go, .client = .{ .id = "a", .connection = "a1" }, .command = .{ .id = "add-a", .epoch = "personal", .expectedRevision = 0, .occurrence = 1, .action = .enqueue, .entry = first } };
    var two: Race = .{ .store = &right, .room = room, .ready = &ready, .go = &go, .client = .{ .id = "b", .connection = "b1" }, .command = .{ .id = "add-b", .epoch = "personal", .expectedRevision = 0, .occurrence = 1, .action = .enqueue, .entry = second } };
    const one_thread = try std.Thread.spawn(.{}, Race.run, .{&one});
    const two_thread = try std.Thread.spawn(.{}, Race.run, .{&two});
    while (ready.load(.acquire) != 2) std.atomic.spinLoopHint();
    go.store(true, .release);
    one_thread.join();
    two_thread.join();
    try std.testing.expectEqual(@as(?anyerror, null), one.failure);
    try std.testing.expectEqual(@as(?anyerror, null), two.failure);
    try std.testing.expectEqual(model.Outcome.applied, one.outcome.?);
    try std.testing.expectEqual(model.Outcome.applied, two.outcome.?);
    var snapshot = (try right.read(allocator, room)).?;
    defer snapshot.deinit();
    try std.testing.expectEqual(@as(usize, 3), snapshot.state.queue.len);
    try std.testing.expectEqual(@as(u64, 2), snapshot.state.revision);
    try std.testing.expectEqual(@as(u32, 3), snapshot.state.personal.?.explicitEnd);
    try std.testing.expectEqual(@as(u64, 5432), snapshot.state.positionMs);
    try std.testing.expect(!std.mem.eql(u8, snapshot.state.queue[1].key.?, snapshot.state.queue[2].key.?));
    var duplicate = try right.applyAsClient(allocator, room, fixture_host, fixture_host, one.command, .{ .id = "a", .connection = "reconnected" });
    defer duplicate.deinit();
    try std.testing.expectEqual(model.Outcome.duplicate, duplicate.outcome);
    var forbidden = try right.applyAsClient(allocator, room, fixture_guest, fixture_host, .{ .id = "foreign", .epoch = "personal", .expectedRevision = 2, .occurrence = 1, .action = .enqueue, .entry = first }, two.client);
    defer forbidden.deinit();
    try std.testing.expectEqual(model.Outcome.forbidden, forbidden.outcome);
    const repeat_command: model.Command = .{ .id = "repeat-once", .epoch = "personal", .expectedRevision = 2, .occurrence = 1, .action = .setRepeat, .repeat = .one };
    var repeated = try left.applyAsClient(allocator, room, fixture_host, fixture_host, repeat_command, one.client);
    defer repeated.deinit();
    try std.testing.expectEqual(model.Outcome.applied, repeated.outcome);
    var selected = try right.applyAsClient(allocator, room, fixture_host, fixture_host, .{ .id = "select-next", .epoch = "personal", .expectedRevision = 3, .occurrence = 1, .action = .selectTrack, .entryKey = snapshot.state.queue[1].key, .playing = false }, two.client);
    defer selected.deinit();
    try std.testing.expectEqual(model.Outcome.applied, selected.outcome);
    var repeat_retry = try right.applyAsClient(allocator, room, fixture_host, fixture_host, repeat_command, one.client);
    defer repeat_retry.deinit();
    try std.testing.expectEqual(model.Outcome.duplicate, repeat_retry.outcome);
    _ = try left.send(a, &.{ "DEL", keys[1], keys[2], keys[3] }, false);
    _ = try left.send(a, &.{ "EXPIRE", keys[0], "10" }, false);
    var recovered = (try right.read(allocator, room)).?;
    defer recovered.deinit();
    try std.testing.expectEqual(@as(usize, 3), recovered.state.queue.len);
    try std.testing.expectEqual(@as(i64, -1), (try left.send(a, &.{ "TTL", keys[0] }, false)).integer);
    try std.testing.expectEqualStrings("0-0", recovered.lastEventId);
}

test "personal repeat-one queue edits preserve wrapped timeline position in Redis" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return;
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var store = try Store.init(allocator, io, std.mem.span(url_z), fixture_collection);
    defer store.deinit();
    var random: [16]u8 = undefined;
    io.random(&random);
    const room = try std.fmt.allocPrint(a, "integration:personal-loop:{x}", .{random});
    const keys = try roomKeys(a, room);
    defer _ = store.send(a, &.{ "DEL", keys[0], keys[1], keys[2], keys[3] }, false) catch {};
    var current = try fixtureTrack(a, "loop");
    current.key = "current";
    current.durationMs = 60000;
    const state: model.State = .{ .epoch = "loop", .revision = 0, .queue = &.{current}, .index = 0, .occurrence = 1, .playing = true, .positionMs = 1000, .updatedAtMs = (try store.nowMs()) - 65000, .personal = .{ .explicitEnd = 1, .repeat = .one, .output = .{ .clientId = "a", .connectionId = "a1" } } };
    _ = try store.send(a, &.{ "SET", keys[0], try std.json.Stringify.valueAlloc(a, state, .{}) }, false);
    var entry = current;
    entry.key = "next";
    var result = try store.applyAsClient(allocator, room, fixture_host, fixture_host, .{ .id = "enqueue-after-loop", .epoch = "loop", .expectedRevision = 0, .occurrence = 1, .action = .enqueue, .entry = entry }, .{ .id = "a", .connection = "a1" });
    defer result.deinit();
    try std.testing.expectEqual(model.Outcome.applied, result.outcome);
    try std.testing.expect(result.snapshot.state.positionMs >= 6000 and result.snapshot.state.positionMs < 10000);
}
