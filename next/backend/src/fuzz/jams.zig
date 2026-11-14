//! A shared jam is one queue that a host and guests change through
//! revision-checked commands. Random command sequences from two people,
//! with stale revisions, wrong epochs, out-of-range indexes and clocks that
//! run backwards, must keep the state valid and the rules exact: only an
//! applied command changes anything, it bumps the revision by one, it was
//! written against the revision it replaced, and only the host seeks.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const model = @import("../internal/jams/model.zig");
const track_id = @import("../internal/identity/track_id.zig");

const collection = "fm.plyr.dev.track";
const host = "did:plc:host";
const guest = "did:plc:guest";

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "jams.transition", transition },
        .{ "jams.position", position },
    });
}

/// dag-cbor CIDs, the only codec a queue accepts
const cids = [_][]const u8{
    "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm",
    "bafyreia2kq243hqq3volwlzkbzzphoeqauk54sc5h7vgogq4ei5fjizxvy",
};

fn track(arena: std.mem.Allocator, case: *hegel.TestCase) !model.Track {
    const rkey = try gen.pick(case, []const u8, &.{ "one", "two", "three", "four" });
    const uri = try std.fmt.allocPrint(arena, "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/{s}/{s}", .{ collection, rkey });
    const id_buffer = try arena.alloc(u8, track_id.encodedLength(uri));
    return .{
        .id = try track_id.encode(id_buffer, uri),
        .uri = uri,
        .cid = try gen.pick(case, []const u8, &cids),
        .durationMs = try case.int(u64, 1, 600_000),
    };
}

fn queue(arena: std.mem.Allocator, case: *hegel.TestCase, max: usize) ![]const model.Track {
    const tracks = try arena.alloc(model.Track, try case.int(usize, 0, max));
    for (tracks) |*t| t.* = try track(arena, case);
    return tracks;
}

fn initialState(arena: std.mem.Allocator, case: *hegel.TestCase) !model.State {
    const tracks = try queue(arena, case, 4);
    if (tracks.len == 0) return .{ .epoch = "e1", .revision = try case.int(u64, 0, 5), .queue = tracks, .index = 0, .occurrence = try case.int(u64, 0, 5), .playing = false, .positionMs = 0, .updatedAtMs = 1_000 };
    const index: u32 = @intCast(try case.index(tracks.len));
    return .{
        .epoch = "e1",
        .revision = try case.int(u64, 0, 5),
        .queue = tracks,
        .index = index,
        .occurrence = try case.int(u64, 0, 5),
        .playing = try case.boolean(),
        .positionMs = try case.int(u64, 0, tracks[index].durationMs),
        .updatedAtMs = 1_000,
    };
}

fn near(case: *hegel.TestCase, value: u64) !u64 {
    return switch (try case.int(u8, 0, 5)) {
        0 => value -| 1,
        1 => value + 1,
        else => value,
    };
}

fn command(arena: std.mem.Allocator, case: *hegel.TestCase, state: model.State, n: usize) !model.Command {
    const action = try gen.pick(case, model.Action, &.{ .play, .pause, .seek, .replaceQueue, .selectTrack, .enqueue });
    var c: model.Command = .{
        .id = try std.fmt.allocPrint(arena, "cmd{d}", .{n}),
        .epoch = if (try case.int(u8, 0, 9) == 0) "e0" else state.epoch,
        .expectedRevision = try near(case, state.revision),
        .occurrence = try near(case, state.occurrence),
        .action = action,
    };
    switch (action) {
        .seek => c.positionMs = try case.int(u64, 0, 700_000),
        .selectTrack => {
            c.index = try case.int(u32, 0, @intCast(state.queue.len + 1));
            if (try case.boolean()) c.playing = try case.boolean();
        },
        .replaceQueue => {
            const tracks = try queue(arena, case, 4);
            c.queue = tracks;
            c.index = try case.int(u32, 0, @intCast(tracks.len));
            if (try case.boolean()) c.playing = try case.boolean();
        },
        else => {},
    }
    // a stray field makes a command unclean
    if (try case.int(u8, 0, 19) == 0) c.positionMs = 1;
    return c;
}

fn same(a: model.State, b: model.State) bool {
    return std.mem.eql(u8, a.epoch, b.epoch) and a.revision == b.revision and a.queue.ptr == b.queue.ptr and
        a.queue.len == b.queue.len and a.index == b.index and a.occurrence == b.occurrence and
        a.playing == b.playing and a.positionMs == b.positionMs and a.updatedAtMs == b.updatedAtMs;
}

fn currentTrack(state: model.State) ?model.Track {
    return if (state.queue.len == 0) null else state.queue[state.index];
}

fn sameTrack(a: ?model.Track, b: ?model.Track) bool {
    if (a == null or b == null) return a == null and b == null;
    return std.mem.eql(u8, a.?.uri, b.?.uri) and std.mem.eql(u8, a.?.cid, b.?.cid);
}

fn transition(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena_state = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var state = try initialState(arena, case);
    var now: i64 = state.updatedAtMs;
    var steps = try case.steps(1, 30);
    var n: usize = 0;
    while (try steps.next()) : (n += 1) {
        now += switch (try case.int(u8, 0, 9)) {
            0 => -5,
            1 => 0,
            else => try case.int(i64, 1, 120_000),
        };
        const actor = if (try case.boolean()) host else guest;
        const c = try command(arena, case, state, n);
        case.note("{s} {s} expected {d} at {d}", .{ actor, @tagName(c.action), c.expectedRevision, now });
        const result = try model.transition(arena, state, c, actor, host, now, collection);

        if (result.outcome != .applied) {
            if (!same(result.state, state)) return case.fail("a command that did not apply changed the state");
            continue;
        }
        const next = result.state;
        if (c.expectedRevision != state.revision) return case.fail("a command applied against a revision it did not see");
        if (next.revision != state.revision + 1) return case.fail("an applied command did not bump the revision by one");
        if (next.updatedAtMs != now) return case.fail("an applied command did not stamp the time");
        if (c.action == .seek and !std.mem.eql(u8, actor, host)) return case.fail("a guest seeked");
        if (!try model.validateState(arena, next, collection)) return case.fail("an applied command left an invalid state");
        switch (c.action) {
            .play, .pause, .seek => {
                if (next.queue.ptr != state.queue.ptr or next.index != state.index or next.occurrence != state.occurrence)
                    return case.fail("play, pause or seek changed the queue or the track");
                if (next.playing != (c.action == .play) and c.action != .seek) return case.fail("play or pause did not set playing");
            },
            .selectTrack, .replaceQueue => {
                // replacing an empty queue counts as a new track even when
                // the new queue is empty too: the model only keeps the
                // occurrence when both queues play the same track
                const moved = switch (c.action) {
                    .selectTrack => next.index != state.index,
                    else => currentTrack(state) == null or currentTrack(next) == null or
                        !sameTrack(currentTrack(state), currentTrack(next)),
                };
                if (moved != (next.occurrence == state.occurrence + 1)) return case.fail("occurrence moved without the track changing, or not with it");
                if (moved and next.positionMs != 0) return case.fail("a new track does not start from zero");
            },
            else => return case.fail("an unsupported action applied"),
        }
        case.event("applied");
        state = next;
    }
}

fn position(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena_state = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena_state.deinit();
    const state = try initialState(arena_state.allocator(), case);
    const t1 = try case.int(i64, -10_000, 1_000_000);
    const t2 = t1 + try case.int(i64, 0, 1_000_000);
    const p1 = model.positionAt(state, t1);
    const p2 = model.positionAt(state, t2);
    const duration = if (currentTrack(state)) |t| t.durationMs else 0;
    if (p1 > p2) return case.fail("position runs backwards");
    if (p2 > duration) return case.fail("position passes the end of the track");
    if (!state.playing and p2 != state.positionMs) return case.fail("a paused jam moves");
}
