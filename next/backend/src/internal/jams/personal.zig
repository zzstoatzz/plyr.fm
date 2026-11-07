const std = @import("std");
const p = @import("protocol.zig");
const track_id = @import("../identity/track_id.zig");

pub const key = "personal-queue";

pub fn validate(a: std.mem.Allocator, state: p.State, collection: []const u8) !bool {
    const personal = state.personal orelse return false;
    if (!p.boundedId(state.epoch) or state.revision > p.max_counter or state.occurrence > p.max_counter or
        state.updatedAtMs < 0 or state.updatedAtMs > p.max_counter or !try p.validateReferences(a, state.queue, collection, true)) return false;
    if (personal.explicitEnd > state.queue.len or (personal.tailKind == null and personal.explicitEnd != state.queue.len)) return false;
    if (personal.label) |label| if (label.len > 200 or !std.unicode.utf8ValidateSlice(label)) return false;
    if (personal.cursor) |cursor| if (cursor.len > 4096) return false;
    if (personal.output) |output| {
        if (!p.boundedId(output.clientId) or !p.boundedId(output.connectionId)) return false;
    } else if (state.playing) return false;
    for (state.queue, 0..) |entry, index| {
        if (!p.boundedId(entry.key orelse return false)) return false;
        for (state.queue[0..index]) |previous| if (std.mem.eql(u8, previous.key.?, entry.key.?)) return false;
    }
    if (state.queue.len == 0) return state.index == 0 and !state.playing and state.positionMs == 0;
    return state.index < state.queue.len and state.positionMs <= duration(state.queue[state.index]);
}

pub fn duration(track: p.Track) u64 {
    return if (track.durationMs == 0) p.max_position_ms else track.durationMs;
}

pub fn position(state: p.State, now: i64) u64 {
    if (state.queue.len == 0) return 0;
    const elapsed: u64 = if (state.playing and now > state.updatedAtMs) @intCast(now - state.updatedAtMs) else 0;
    const at = state.positionMs +| elapsed;
    const limit = duration(state.queue[state.index]);
    if (state.personal.?.repeat == .one and state.playing and state.queue[state.index].durationMs > 0) return at % limit;
    return @min(limit, at);
}

pub fn canRebase(action: p.Action) bool {
    return switch (action) {
        .enqueue, .removeEntry, .moveEntry, .playContext, .selectTrack, .setRepeat, .setContinuation, .connected, .disconnected => true,
        else => false,
    };
}

pub fn transition(a: std.mem.Allocator, state: p.State, command: p.Command, client: p.Client, now: i64, collection: []const u8) !p.Result {
    const old = state.personal orelse return .{ .outcome = .invalid, .state = state };
    if (!p.boundedId(client.id) or !p.boundedId(client.connection) or !p.boundedId(command.id) or
        !p.boundedId(command.epoch) or command.expectedRevision > state.revision or now < state.updatedAtMs)
        return .{ .outcome = .invalid, .state = state };
    if (!std.mem.eql(u8, state.epoch, command.epoch) or (!canRebase(command.action) and command.occurrence != state.occurrence))
        return .{ .outcome = .conflict, .state = state };
    if (state.revision >= p.max_counter or state.occurrence >= p.max_counter) return .{ .outcome = .conflict, .state = state };
    if ((command.action == .enqueue or command.action == .appendContinuation) and state.index > 0) {
        const wanted = if (command.action == .enqueue) 1 else @min(p.max_tracks, if (command.queue) |queue| queue.len else 0);
        const drop = @min(state.index, state.queue.len + wanted -| p.max_tracks);
        if (drop > 0) {
            var compacted = state;
            compacted.queue = state.queue[drop..];
            compacted.index -= @intCast(drop);
            compacted.personal.?.explicitEnd -|= @intCast(drop);
            return transition(a, compacted, command, client, now, collection);
        }
    }
    var next = state;
    next.revision += 1;
    next.positionMs = position(state, now);
    next.updatedAtMs = now;
    var personal = old;
    const controls = command.action == .play or command.action == .pause or command.action == .seek;
    if (controls and !sameOptional(command.expectedOutput, if (old.output) |output| output.connectionId else null))
        return .{ .outcome = .conflict, .state = state };
    switch (command.action) {
        .connected, .disconnected => {
            if (!client.internal) return .{ .outcome = .forbidden, .state = state };
            const output = old.output orelse return .{ .outcome = .noop, .state = state };
            if (!std.mem.eql(u8, output.clientId, client.id)) return .{ .outcome = .noop, .state = state };
            if (command.action == .connected) {
                if (std.mem.eql(u8, output.connectionId, client.connection)) return .{ .outcome = .noop, .state = state };
                personal.output = .{ .clientId = client.id, .connectionId = client.connection };
                if (old.disconnected and client.resumePlaying) next.playing = true;
                personal.disconnected = false;
            } else {
                if (!std.mem.eql(u8, output.connectionId, client.connection)) return .{ .outcome = .noop, .state = state };
                next.playing = false;
                personal.disconnected = true;
            }
        },
        .play, .pause, .seek, .progress, .advance => {
            if (state.queue.len == 0) return .{ .outcome = .invalid, .state = state };
            if ((command.action == .progress or command.action == .advance) and !owns(old, client)) return .{ .outcome = .forbidden, .state = state };
            switch (command.action) {
                .play => {
                    if (state.playing and owns(old, client)) return .{ .outcome = .noop, .state = state };
                    personal.output = .{ .clientId = client.id, .connectionId = client.connection };
                    personal.disconnected = false;
                    next.playing = true;
                    if (next.positionMs >= duration(state.queue[state.index])) {
                        next.positionMs = 0;
                        next.occurrence += 1;
                    }
                },
                .pause => {
                    if (!state.playing and !old.disconnected) return .{ .outcome = .noop, .state = state };
                    next.playing = false;
                    personal.disconnected = false;
                },
                .seek, .progress => {
                    const at = command.positionMs orelse return .{ .outcome = .invalid, .state = state };
                    if (command.action == .progress) if (command.entry) |entry| {
                        const current = state.queue[state.index];
                        if (entry.durationMs == 0 or entry.durationMs > p.max_position_ms or !sameOptional(entry.key, current.key) or
                            !std.mem.eql(u8, entry.id, current.id) or !std.mem.eql(u8, entry.uri, current.uri) or !std.mem.eql(u8, entry.cid, current.cid))
                            return .{ .outcome = .invalid, .state = state };
                        const tracks = try a.dupe(p.Track, state.queue);
                        tracks[state.index].durationMs = entry.durationMs;
                        next.queue = tracks;
                    };
                    next.positionMs = @min(at, duration(next.queue[state.index]));
                },
                .advance => {
                    if (state.index + 1 < state.queue.len) next.index += 1 else if (old.repeat == .all) next.index = 0 else {
                        next.playing = false;
                        next.positionMs = duration(state.queue[state.index]);
                    }
                    if (next.playing) {
                        next.positionMs = 0;
                        next.occurrence += 1;
                    }
                },
                else => unreachable,
            }
        },
        .enqueue => {
            const entry = command.entry orelse return .{ .outcome = .invalid, .state = state };
            if (entry.key == null) return .{ .outcome = .invalid, .state = state };
            if (find(state.queue, entry.key.?)) |_| return .{ .outcome = .noop, .state = state };
            const boundary = explicitEnd(state);
            next.queue = try insert(a, state.queue, boundary, entry);
            personal.explicitEnd = @intCast(boundary + 1);
        },
        .removeEntry => {
            const at = find(state.queue, command.entryKey orelse return .{ .outcome = .invalid, .state = state }) orelse return .{ .outcome = .noop, .state = state };
            if (at <= state.index) return .{ .outcome = .forbidden, .state = state };
            next.queue = try remove(a, state.queue, at);
            personal.explicitEnd = @intCast(explicitEnd(state) - @intFromBool(at < explicitEnd(state)));
        },
        .moveEntry => {
            const from = find(state.queue, command.entryKey orelse return .{ .outcome = .invalid, .state = state }) orelse return .{ .outcome = .noop, .state = state };
            if (from <= state.index) return .{ .outcome = .forbidden, .state = state };
            const boundary = explicitEnd(state);
            var to = if (command.beforeKey) |before| find(state.queue, before) orelse state.queue.len else state.queue.len;
            if (to <= state.index) return .{ .outcome = .forbidden, .state = state };
            if (from < to) to -= 1;
            if (from < boundary) to = @min(to, boundary - 1);
            if (from == to) return .{ .outcome = .noop, .state = state };
            next.queue = try insert(a, try remove(a, state.queue, from), to, state.queue[from]);
            personal.explicitEnd = @intCast(boundary + @intFromBool(from >= boundary and to <= boundary));
        },
        .playContext => {
            const queue = command.queue orelse return .{ .outcome = .invalid, .state = state };
            const at = command.index orelse 0;
            if (at >= queue.len) return .{ .outcome = .invalid, .state = state };
            var entries: std.ArrayList(p.Track) = .empty;
            try entries.append(a, queue[at]);
            try entries.appendSlice(a, state.queue[@min(state.index + 1, state.queue.len)..explicitEnd(state)]);
            personal.explicitEnd = @intCast(entries.items.len);
            if (command.label) |_| for (queue[at + 1 ..]) |entry| {
                var duplicate = false;
                for (entries.items[1..personal.explicitEnd]) |pick| if (std.mem.eql(u8, pick.id, entry.id)) {
                    duplicate = true;
                    break;
                };
                if (!duplicate and entries.items.len < p.max_tracks) try entries.append(a, entry);
            };
            next.queue = try entries.toOwnedSlice(a);
            next.index = 0;
            next.positionMs = command.positionMs orelse 0;
            next.playing = command.playing orelse true;
            next.occurrence += 1;
            personal.output = .{ .clientId = client.id, .connectionId = client.connection };
            personal.disconnected = false;
            personal.tailKind = if (next.queue.len > personal.explicitEnd) .collection else null;
            personal.label = if (personal.tailKind != null) command.label else null;
            personal.cursor = null;
        },
        .selectTrack => {
            const at = find(state.queue, command.entryKey orelse return .{ .outcome = .invalid, .state = state }) orelse return .{ .outcome = .invalid, .state = state };
            next.index = @intCast(at);
            if (next.index != state.index) {
                next.positionMs = 0;
                next.occurrence += 1;
            }
            next.playing = command.playing orelse true;
            personal.output = .{ .clientId = client.id, .connectionId = client.connection };
            personal.disconnected = false;
        },
        .clearPicks => {
            if (command.expectedRevision != state.revision) return .{ .outcome = .conflict, .state = state };
            const from = @min(state.index + 1, state.queue.len);
            const entries = try a.dupe(p.Track, state.queue);
            const boundary = explicitEnd(state);
            std.mem.copyForwards(p.Track, entries[from..], state.queue[boundary..]);
            next.queue = entries[0 .. from + state.queue.len - boundary];
            personal.explicitEnd = @intCast(from);
        },
        .setRepeat => personal.repeat = command.repeat orelse return .{ .outcome = .invalid, .state = state },
        .setContinuation => {
            personal.keepPlaying = command.keepPlaying orelse return .{ .outcome = .invalid, .state = state };
            if (!personal.keepPlaying and old.tailKind == .generated) {
                next.queue = state.queue[0..explicitEnd(state)];
                personal.tailKind = null;
                personal.label = null;
            }
        },
        .appendContinuation => {
            if (!owns(old, client)) return .{ .outcome = .forbidden, .state = state };
            if (!old.keepPlaying or (old.tailKind == .collection and state.index + 1 < state.queue.len)) return .{ .outcome = .noop, .state = state };
            var entries: std.ArrayList(p.Track) = .empty;
            try entries.appendSlice(a, state.queue);
            for (command.queue orelse return .{ .outcome = .invalid, .state = state }) |entry| {
                var duplicate = false;
                for (entries.items) |previous| if (std.mem.eql(u8, previous.id, entry.id)) {
                    duplicate = true;
                    break;
                };
                if (!duplicate and entries.items.len < p.max_tracks) try entries.append(a, entry);
            }
            next.queue = try entries.toOwnedSlice(a);
            personal.explicitEnd = @intCast(explicitEnd(state));
            personal.tailKind = .generated;
            personal.label = "latest tracks";
            personal.cursor = command.cursor;
        },
        .shufflePicks => {
            if (command.expectedRevision != state.revision) return .{ .outcome = .conflict, .state = state };
            const order = command.queue orelse return .{ .outcome = .invalid, .state = state };
            const from = @min(state.index + 1, state.queue.len);
            const boundary = explicitEnd(state);
            if (order.len != boundary - from) return .{ .outcome = .invalid, .state = state };
            const entries = try a.dupe(p.Track, state.queue);
            for (order, 0..) |entry, offset| {
                const at = find(state.queue, entry.key orelse return .{ .outcome = .invalid, .state = state }) orelse return .{ .outcome = .invalid, .state = state };
                if (at < from or at >= boundary) return .{ .outcome = .invalid, .state = state };
                entries[from + offset] = state.queue[at];
            }
            next.queue = entries;
        },
        .replaceQueue => return .{ .outcome = .invalid, .state = state },
    }
    next.personal = personal;
    if (!try validate(a, next, collection)) return .{ .outcome = .invalid, .state = state };
    return .{ .outcome = .applied, .state = next };
}

fn explicitEnd(state: p.State) usize {
    return @min(state.queue.len, @max(@min(state.index + 1, state.queue.len), state.personal.?.explicitEnd));
}
fn owns(personal: p.Personal, client: p.Client) bool {
    const output = personal.output orelse return false;
    return std.mem.eql(u8, output.clientId, client.id) and std.mem.eql(u8, output.connectionId, client.connection);
}
fn sameOptional(left: ?[]const u8, right: ?[]const u8) bool {
    return if (left) |value| if (right) |other| std.mem.eql(u8, value, other) else false else right == null;
}
fn find(queue: []const p.Track, key_value: []const u8) ?usize {
    for (queue, 0..) |entry, at| if (entry.key) |entry_key| if (std.mem.eql(u8, entry_key, key_value)) return at;
    return null;
}
fn insert(a: std.mem.Allocator, queue: []const p.Track, at: usize, entry: p.Track) ![]const p.Track {
    const result = try a.alloc(p.Track, queue.len + 1);
    @memcpy(result[0..at], queue[0..at]);
    result[at] = entry;
    @memcpy(result[at + 1 ..], queue[at..]);
    return result;
}
fn remove(a: std.mem.Allocator, queue: []const p.Track, at: usize) ![]const p.Track {
    const result = try a.alloc(p.Track, queue.len - 1);
    @memcpy(result[0..at], queue[0..at]);
    @memcpy(result[at..], queue[at + 1 ..]);
    return result;
}

const test_collection = "fm.plyr.dev.track";
const test_client: p.Client = .{ .id = "device-a", .connection = "socket-a" };

fn testTrack(a: std.mem.Allocator, entry_key: []const u8, record_key: []const u8) !p.Track {
    const uri = try std.fmt.allocPrint(a, "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/{s}/{s}", .{ test_collection, record_key });
    var buffer: [2048]u8 = undefined;
    return .{ .id = try a.dupe(u8, try track_id.encode(&buffer, uri)), .uri = uri, .cid = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm", .durationMs = 60_000, .key = entry_key };
}
fn testState(a: std.mem.Allocator) !p.State {
    const queue = try a.alloc(p.Track, 2);
    queue[0] = try testTrack(a, "current", "current");
    queue[1] = try testTrack(a, "tail", "tail");
    return .{ .epoch = "epoch", .revision = 0, .queue = queue, .index = 0, .occurrence = 1, .playing = true, .positionMs = 0, .updatedAtMs = 100, .personal = .{ .explicitEnd = 1, .tailKind = .collection, .label = "Album", .output = .{ .clientId = test_client.id, .connectionId = test_client.connection } } };
}
fn testCommand(state: p.State, action: p.Action) p.Command {
    return .{ .id = "command", .epoch = state.epoch, .expectedRevision = state.revision, .occurrence = state.occurrence, .action = action, .expectedOutput = if (state.personal.?.output) |output| output.connectionId else null };
}

test "concurrent queue additions preserve both intents and occurrence identity" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const state = try testState(a);
    var first = testCommand(state, .enqueue);
    first.entry = try testTrack(a, "pick-a", "same-song");
    var second = testCommand(state, .enqueue);
    second.entry = try testTrack(a, "pick-b", "same-song");
    const left = try transition(a, state, first, test_client, 200, test_collection);
    const right = try transition(a, left.state, second, .{ .id = "device-b", .connection = "socket-b" }, 200, test_collection);
    try std.testing.expectEqual(p.Outcome.applied, right.outcome);
    try std.testing.expectEqual(@as(usize, 4), right.state.queue.len);
    try std.testing.expectEqualStrings("pick-a", right.state.queue[1].key.?);
    try std.testing.expectEqualStrings("pick-b", right.state.queue[2].key.?);
    try std.testing.expectEqual(@as(u32, 3), right.state.personal.?.explicitEnd);
    try std.testing.expectEqual(p.Outcome.noop, (try transition(a, right.state, first, test_client, 300, test_collection)).outcome);
}

test "context switches preserve remote explicit picks and repeated collection tracks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const initial = try testState(a);
    var add = testCommand(initial, .enqueue);
    add.entry = try testTrack(a, "pick", "pick");
    const state = (try transition(a, initial, add, test_client, 150, test_collection)).state;
    const context = try a.alloc(p.Track, 3);
    context[0] = try testTrack(a, "new", "new");
    context[1] = try testTrack(a, "repeat-1", "repeated");
    context[2] = try testTrack(a, "repeat-2", "new");
    var command = testCommand(initial, .playContext);
    command.queue = context;
    command.label = "New album";
    const changed = try transition(a, state, command, test_client, 200, test_collection);
    try std.testing.expectEqual(p.Outcome.applied, changed.outcome);
    try std.testing.expectEqual(@as(usize, 4), changed.state.queue.len);
    try std.testing.expectEqualStrings("pick", changed.state.queue[1].key.?);
    try std.testing.expectEqualStrings("repeat-2", changed.state.queue[3].key.?);
    try std.testing.expectEqual(@as(u32, 2), changed.state.personal.?.explicitEnd);
}

test "output transfer fences late controls and old connection close without autoplaying a paused session" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const initial = try testState(a);
    const other: p.Client = .{ .id = "device-b", .connection = "socket-b" };
    var state = (try transition(a, initial, testCommand(initial, .play), other, 200, test_collection)).state;
    try std.testing.expectEqualStrings("device-b", state.personal.?.output.?.clientId);
    try std.testing.expectEqual(p.Outcome.conflict, (try transition(a, state, testCommand(initial, .pause), test_client, 210, test_collection)).outcome);
    var progress = testCommand(state, .progress);
    progress.positionMs = 900;
    try std.testing.expectEqual(p.Outcome.forbidden, (try transition(a, state, progress, test_client, 220, test_collection)).outcome);
    var old_close = test_client;
    old_close.internal = true;
    try std.testing.expectEqual(p.Outcome.noop, (try transition(a, state, testCommand(state, .disconnected), old_close, 230, test_collection)).outcome);
    var reconnect = other;
    reconnect.internal = true;
    reconnect.connection = "socket-b2";
    reconnect.resumePlaying = true;
    state = (try transition(a, state, testCommand(state, .connected), reconnect, 240, test_collection)).state;
    var previous = other;
    previous.internal = true;
    try std.testing.expectEqual(p.Outcome.noop, (try transition(a, state, testCommand(state, .disconnected), previous, 250, test_collection)).outcome);
    state = (try transition(a, state, testCommand(state, .disconnected), reconnect, 260, test_collection)).state;
    try std.testing.expect(!state.playing);
    state = (try transition(a, state, testCommand(state, .pause), other, 270, test_collection)).state;
    reconnect.connection = "socket-b3";
    state = (try transition(a, state, testCommand(state, .connected), reconnect, 280, test_collection)).state;
    try std.testing.expect(!state.playing);
    try std.testing.expectEqual(p.Outcome.forbidden, (try transition(a, state, testCommand(state, .connected), other, 290, test_collection)).outcome);
}

test "advancing repeated records creates a new occurrence exactly once" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var state = try testState(a);
    const queue = try a.alloc(p.Track, 2);
    queue[0] = try testTrack(a, "first", "same");
    queue[1] = try testTrack(a, "second", "same");
    state.queue = queue;
    state.personal.?.explicitEnd = 2;
    state.personal.?.tailKind = null;
    const command = testCommand(state, .advance);
    const next = try transition(a, state, command, test_client, 200, test_collection);
    try std.testing.expectEqual(@as(u64, 2), next.state.occurrence);
    try std.testing.expectEqualStrings("second", next.state.queue[next.state.index].key.?);
    try std.testing.expectEqual(p.Outcome.conflict, (try transition(a, next.state, command, test_client, 210, test_collection)).outcome);
}

test "continuation drops old history instead of stalling at the queue bound" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var state = try testState(a);
    const queue = try a.alloc(p.Track, p.max_tracks);
    for (queue, 0..) |*entry, index| entry.* = try testTrack(a, try std.fmt.allocPrint(a, "key-{d}", .{index}), "same");
    state.queue = queue;
    state.index = p.max_tracks - 1;
    state.personal.?.explicitEnd = p.max_tracks;
    state.personal.?.tailKind = null;
    state.personal.?.keepPlaying = true;
    var command = testCommand(state, .appendContinuation);
    const fresh = try a.alloc(p.Track, 5);
    for (fresh, 0..) |*entry, index| entry.* = try testTrack(a, try std.fmt.allocPrint(a, "new-{d}", .{index}), try std.fmt.allocPrint(a, "new-{d}", .{index}));
    command.queue = fresh;
    const next = try transition(a, state, command, test_client, 200, test_collection);
    try std.testing.expectEqual(p.Outcome.applied, next.outcome);
    try std.testing.expectEqual(@as(usize, p.max_tracks), next.state.queue.len);
    try std.testing.expectEqualStrings("key-199", next.state.queue[next.state.index].key.?);
    try std.testing.expectEqual(@as(u32, 195), next.state.personal.?.explicitEnd);
}

test "observed personal media duration bounds completion and explicit replay" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var initial = try testState(a);
    var track = initial.queue[0];
    track.durationMs = 0;
    initial.queue = try a.dupe(p.Track, &.{track});
    initial.playing = false;
    initial.personal = .{ .explicitEnd = 1 };
    var state = (try transition(a, initial, testCommand(initial, .play), test_client, 200, test_collection)).state;
    var progress = testCommand(state, .progress);
    var observed = track;
    observed.durationMs = 500;
    progress.entry = observed;
    progress.positionMs = 500;
    state = (try transition(a, state, progress, test_client, 300, test_collection)).state;
    try std.testing.expectEqual(@as(u64, 500), state.queue[0].durationMs);
    var stale = progress;
    stale.entry.?.key = "another-entry";
    try std.testing.expectEqual(p.Outcome.invalid, (try transition(a, state, stale, test_client, 310, test_collection)).outcome);
    state = (try transition(a, state, testCommand(state, .advance), test_client, 400, test_collection)).state;
    try std.testing.expect(!state.playing);
    try std.testing.expectEqual(@as(u64, 500), state.positionMs);
    const occurrence = state.occurrence;
    state = (try transition(a, state, testCommand(state, .play), test_client, 500, test_collection)).state;
    try std.testing.expectEqual(occurrence + 1, state.occurrence);
    try std.testing.expectEqual(@as(u64, 0), state.positionMs);
}

test "personal repeat and continuation settings survive concurrent track transitions" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const initial = try testState(a);
    var change = testCommand(initial, .playContext);
    change.queue = initial.queue;
    change.label = "Album";
    var state = (try transition(a, initial, change, test_client, 200, test_collection)).state;
    try std.testing.expect(state.occurrence > initial.occurrence);
    var setting = testCommand(initial, .setRepeat);
    setting.repeat = .all;
    var result = try transition(a, state, setting, test_client, 210, test_collection);
    try std.testing.expectEqual(p.Outcome.applied, result.outcome);
    try std.testing.expectEqual(p.Repeat.all, result.state.personal.?.repeat);
    state = result.state;
    setting = testCommand(initial, .setContinuation);
    setting.keepPlaying = true;
    result = try transition(a, state, setting, test_client, 220, test_collection);
    try std.testing.expectEqual(p.Outcome.applied, result.outcome);
    try std.testing.expect(result.state.personal.?.keepPlaying);
}

test "dragging the first tail boundary promotes a pick when no explicit future picks exist" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var state = try testState(a);
    const tracks = try a.alloc(p.Track, 3);
    tracks[0] = try testTrack(a, "current", "current");
    tracks[1] = try testTrack(a, "tail-a", "tail-a");
    tracks[2] = try testTrack(a, "tail-b", "tail-b");
    state.queue = tracks;
    var command = testCommand(state, .moveEntry);
    command.entryKey = "tail-b";
    command.beforeKey = "tail-a";
    const result = try transition(a, state, command, test_client, 200, test_collection);
    try std.testing.expectEqual(p.Outcome.applied, result.outcome);
    try std.testing.expectEqualStrings("tail-b", result.state.queue[1].key.?);
    try std.testing.expectEqual(@as(u32, 2), result.state.personal.?.explicitEnd);
}
