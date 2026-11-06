const std = @import("std");
const zat = @import("zat");
const track_id = @import("../identity/track_id.zig");

pub const max_tracks = 200;
pub const max_counter = 9_007_199_254_740_991;
pub const max_position_ms = 24 * 60 * 60 * 1000;

pub const Track = struct {
    id: []const u8,
    uri: []const u8,
    cid: []const u8,
    durationMs: u64,
};

pub const State = struct {
    epoch: []const u8,
    revision: u64,
    queue: []const Track,
    index: u32,
    occurrence: u64,
    playing: bool,
    positionMs: u64,
    updatedAtMs: i64,
};

pub const Action = enum { play, pause, seek, replaceQueue, selectTrack };
pub const Command = struct {
    id: []const u8,
    epoch: []const u8,
    expectedRevision: u64,
    occurrence: u64,
    action: Action,
    playing: ?bool = null,
    positionMs: ?u64 = null,
    queue: ?[]const Track = null,
    index: ?u32 = null,
};

pub const Outcome = enum { applied, noop, duplicate, conflict, forbidden, invalid };
pub const Result = struct { outcome: Outcome, state: State };

pub fn boundedId(value: []const u8) bool {
    if (value.len == 0 or value.len > 64) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_') return false;
    return true;
}

pub fn validateQueue(allocator: std.mem.Allocator, queue: []const Track, collection: []const u8) !bool {
    if (queue.len > max_tracks) return false;
    for (queue) |track| {
        if (track.id.len > 2048 or track.uri.len > 1024 or track.cid.len > 128 or
            track.durationMs == 0 or track.durationMs > max_position_ms) return false;
        var uri_buffer: [1024]u8 = undefined;
        const uri = track_id.decode(&uri_buffer, track.id) catch return false;
        if (!std.mem.eql(u8, uri, track.uri)) return false;
        const parsed = zat.AtUri.parse(uri) orelse return false;
        if (!std.mem.eql(u8, parsed.collection() orelse return false, collection)) return false;
        const cid = zat.Cid.fromString(allocator, track.cid) catch |err| switch (err) {
            error.OutOfMemory => return err,
            else => return false,
        };
        defer allocator.free(cid.raw);
        if (cid.codec() != 0x71) return false;
    }
    return true;
}

pub fn validateState(allocator: std.mem.Allocator, state: State, collection: []const u8) !bool {
    if (!boundedId(state.epoch) or state.revision > max_counter or state.occurrence > max_counter or
        state.updatedAtMs < 0 or state.updatedAtMs > max_counter or !try validateQueue(allocator, state.queue, collection)) return false;
    if (state.queue.len == 0) return state.index == 0 and !state.playing and state.positionMs == 0;
    return state.index < state.queue.len and state.positionMs <= state.queue[state.index].durationMs;
}

pub fn positionAt(state: State, now_ms: i64) u64 {
    if (state.queue.len == 0) return 0;
    const elapsed: u64 = if (state.playing and now_ms > state.updatedAtMs) @intCast(now_ms - state.updatedAtMs) else 0;
    return @min(state.queue[state.index].durationMs, state.positionMs +| elapsed);
}

pub fn transition(allocator: std.mem.Allocator, state: State, command: Command, actor_did: []const u8, host_did: []const u8, now_ms: i64, collection: []const u8) !Result {
    if (!boundedId(command.id) or !boundedId(command.epoch) or command.expectedRevision > max_counter or
        command.occurrence > max_counter or now_ms < state.updatedAtMs) return .{ .outcome = .invalid, .state = state };
    if (!std.mem.eql(u8, state.epoch, command.epoch) or state.occurrence != command.occurrence)
        return .{ .outcome = .conflict, .state = state };
    if (command.action == .seek and !std.mem.eql(u8, actor_did, host_did))
        return .{ .outcome = .forbidden, .state = state };
    const clean = switch (command.action) {
        .play, .pause => command.playing == null and command.positionMs == null and command.queue == null and command.index == null,
        .seek => command.playing == null and command.positionMs != null and command.positionMs.? <= max_position_ms and command.queue == null and command.index == null,
        .replaceQueue => command.queue != null and command.index != null and command.positionMs == null,
        .selectTrack => command.index != null and command.queue == null and command.positionMs == null,
    };
    if (!clean) return .{ .outcome = .invalid, .state = state };
    if (command.expectedRevision > state.revision) return .{ .outcome = .conflict, .state = state };
    if (command.action == .selectTrack and state.queue.len > 0 and command.index.? == state.index and (command.playing == null or command.playing.? == state.playing))
        return .{ .outcome = .noop, .state = state };
    if ((command.action == .play and state.playing) or (command.action == .pause and !state.playing))
        return .{ .outcome = .noop, .state = state };
    if (command.expectedRevision != state.revision or state.revision >= max_counter or state.occurrence >= max_counter)
        return .{ .outcome = .conflict, .state = state };
    var next = state;
    next.revision += 1;
    next.positionMs = positionAt(state, now_ms);
    next.updatedAtMs = now_ms;
    switch (command.action) {
        .play => {
            if (state.queue.len == 0) return .{ .outcome = .invalid, .state = state };
            next.playing = true;
        },
        .pause => next.playing = false,
        .seek => {
            if (state.queue.len == 0) return .{ .outcome = .invalid, .state = state };
            next.positionMs = @min(command.positionMs.?, state.queue[state.index].durationMs);
        },
        .selectTrack => {
            if (command.index.? >= state.queue.len) return .{ .outcome = .invalid, .state = state };
            next.index = command.index.?;
            next.playing = command.playing orelse state.playing;
            if (next.index != state.index) {
                next.occurrence += 1;
                next.positionMs = 0;
            }
        },
        .replaceQueue => {
            const queue = command.queue.?;
            if (!try validateQueue(allocator, queue, collection) or
                (queue.len == 0 and command.index.? != 0) or
                (queue.len != 0 and command.index.? >= queue.len)) return .{ .outcome = .invalid, .state = state };
            const same = state.queue.len > 0 and queue.len > 0 and
                std.mem.eql(u8, state.queue[state.index].uri, queue[command.index.?].uri) and
                std.mem.eql(u8, state.queue[state.index].cid, queue[command.index.?].cid);
            next.queue = queue;
            next.playing = command.playing orelse state.playing;
            next.index = command.index.?;
            if (!same) {
                next.occurrence += 1;
                next.positionMs = 0;
            }
            if (queue.len == 0) next.playing = false else next.positionMs = @min(next.positionMs, queue[next.index].durationMs);
        },
    }
    return .{ .outcome = .applied, .state = next };
}

test "explicit pause converges but old track and epoch commands conflict" {
    const allocator = std.testing.allocator;
    const state: State = .{ .epoch = "epoch", .revision = 4, .queue = &.{}, .index = 0, .occurrence = 2, .playing = false, .positionMs = 0, .updatedAtMs = 100 };
    var command: Command = .{ .id = "pause1", .epoch = "epoch", .expectedRevision = 3, .occurrence = 2, .action = .pause };
    try std.testing.expectEqual(Outcome.noop, (try transition(allocator, state, command, "guest", "host", 150, "fm.plyr.dev.track")).outcome);
    command.occurrence = 1;
    try std.testing.expectEqual(Outcome.conflict, (try transition(allocator, state, command, "guest", "host", 150, "fm.plyr.dev.track")).outcome);
    command.occurrence = 2;
    command.epoch = "old";
    try std.testing.expectEqual(Outcome.conflict, (try transition(allocator, state, command, "guest", "host", 150, "fm.plyr.dev.track")).outcome);
}

test "selecting the current track cannot bypass host-only seek" {
    const a = std.testing.allocator;
    const queue = [_]Track{.{ .id = "unused", .uri = "unused", .cid = "unused", .durationMs = 60_000 }};
    const state: State = .{ .epoch = "epoch", .revision = 3, .queue = &queue, .index = 0, .occurrence = 1, .playing = false, .positionMs = 9000, .updatedAtMs = 100 };
    var command: Command = .{ .id = "select", .epoch = "epoch", .expectedRevision = 3, .occurrence = 1, .action = .selectTrack, .index = 0, .playing = true };
    const played = try transition(a, state, command, "guest", "host", 200, "fm.plyr.dev.track");
    try std.testing.expectEqual(Outcome.applied, played.outcome);
    try std.testing.expectEqual(@as(u64, 9000), played.state.positionMs);
    try std.testing.expectEqual(@as(u64, 1), played.state.occurrence);
    command.expectedRevision = 4;
    try std.testing.expectEqual(Outcome.noop, (try transition(a, played.state, command, "guest", "host", 250, "fm.plyr.dev.track")).outcome);
    command.action = .seek;
    command.positionMs = 0;
    command.index = null;
    command.playing = null;
    try std.testing.expectEqual(Outcome.forbidden, (try transition(a, played.state, command, "guest", "host", 250, "fm.plyr.dev.track")).outcome);
    command.action = .play;
    command.positionMs = null;
    command.expectedRevision = 99;
    try std.testing.expectEqual(Outcome.conflict, (try transition(a, played.state, command, "guest", "host", 250, "fm.plyr.dev.track")).outcome);
}

test "queue references require matching canonical IDs and record CIDs" {
    const a = std.testing.allocator;
    const uri = "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.dev.track/first";
    var encoded: [256]u8 = undefined;
    var queue = [_]Track{.{ .id = try track_id.encode(&encoded, uri), .uri = uri, .cid = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm", .durationMs = 1000 }};
    try std.testing.expect(try validateQueue(a, &queue, "fm.plyr.dev.track"));
    queue[0].uri = "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.dev.track/other";
    try std.testing.expect(!try validateQueue(a, &queue, "fm.plyr.dev.track"));
    queue[0].uri = uri;
    queue[0].cid = "bafy-not-a-cid";
    try std.testing.expect(!try validateQueue(a, &queue, "fm.plyr.dev.track"));
    queue[0].durationMs = 0;
    try std.testing.expect(!try validateQueue(a, &queue, "fm.plyr.dev.track"));
}
