//! The station loop as wall-clock arithmetic. Every listener computes the same
//! "now playing" for an instant from the pinned rotation and its anchor, the
//! instant the loop started from its first entry. Ported from production's
//! `backend/api/radio/state.py`; all times are unix microseconds.

const std = @import("std");
const Entry = @import("sampler.zig").Entry;

/// A rotation lasts one period, then reseeds. A few times a day rather than
/// daily, so a fixed daily listening window doesn't land on the same slice.
pub const period_seconds: i64 = 4 * 60 * 60;
pub const period_us: i64 = period_seconds * std.time.us_per_s;

pub fn periodIndex(now_us: i64) i64 {
    return @divFloor(now_us, period_us);
}

pub fn periodStart(index: i64) i64 {
    return index * period_us;
}

pub fn loopSeconds(rotation: []const Entry) i64 {
    var total: i64 = 0;
    for (rotation) |entry| total += entry.duration_seconds;
    return total;
}

pub const Window = struct {
    index: usize,
    progress_us: i64,
    started_at_us: i64,
    ends_at_us: i64,
};

/// The entry playing at `now_us` in the loop that started at `anchor_us`.
pub fn window(rotation: []const Entry, anchor_us: i64, now_us: i64) ?Window {
    const loop_us = loopSeconds(rotation) * std.time.us_per_s;
    if (rotation.len == 0 or loop_us <= 0) return null;
    const offset = @mod(now_us - anchor_us, loop_us);
    var cursor: i64 = 0;
    for (rotation, 0..) |entry, index| {
        const next = cursor + entry.duration_seconds * std.time.us_per_s;
        if (offset < next) {
            const progress = offset - cursor;
            const started = now_us - progress;
            return .{
                .index = index,
                .progress_us = progress,
                .started_at_us = started,
                .ends_at_us = started + entry.duration_seconds * std.time.us_per_s,
            };
        }
        cursor = next;
    }
    unreachable;
}

/// When the entry playing at `boundary_us` under this loop ends: the next
/// period's anchor, so a handover lands on a track boundary, never mid-song.
pub fn crossingEnd(rotation: []const Entry, anchor_us: i64, boundary_us: i64) i64 {
    const current = window(rotation, anchor_us, boundary_us) orelse return boundary_us;
    if (current.progress_us == 0) return boundary_us;
    return current.ends_at_us;
}

/// The next few entries after the current one. During a handover grace window
/// what actually plays next is the head of the new rotation.
pub fn upNext(rotation: []const Entry, current: ?usize, upcoming: ?[]const Entry, out: []Entry) []Entry {
    if (upcoming) |head| {
        const count = @min(head.len, out.len);
        @memcpy(out[0..count], head[0..count]);
        return out[0..count];
    }
    const index = current orelse return out[0..0];
    const count = @min(rotation.len -| 1, out.len);
    for (out[0..count], 1..) |*slot, offset| slot.* = rotation[(index + offset) % rotation.len];
    return out[0..count];
}

fn entries(comptime durations: []const i64) [durations.len]Entry {
    var result: [durations.len]Entry = undefined;
    for (durations, 0..) |duration, index| result[index] = .{ .uri = "at://x", .owner_did = "did:plc:x", .duration_seconds = duration };
    return result;
}

test "the window walks the loop and wraps" {
    const rotation = entries(&.{ 100, 50, 30 });
    const s = std.time.us_per_s;
    const anchor: i64 = 1_000 * s;
    const first = window(&rotation, anchor, anchor + 10 * s).?;
    try std.testing.expectEqual(@as(usize, 0), first.index);
    try std.testing.expectEqual(10 * s, first.progress_us);
    try std.testing.expectEqual(anchor + 100 * s, first.ends_at_us);
    try std.testing.expectEqual(@as(usize, 1), window(&rotation, anchor, anchor + 100 * s).?.index);
    try std.testing.expectEqual(@as(usize, 2), window(&rotation, anchor, anchor + 179 * s).?.index);
    const wrapped = window(&rotation, anchor, anchor + 185 * s).?;
    try std.testing.expectEqual(@as(usize, 0), wrapped.index);
    try std.testing.expectEqual(5 * s, wrapped.progress_us);
    // before the anchor is the end of the previous lap
    try std.testing.expectEqual(@as(usize, 2), window(&rotation, anchor, anchor - 1 * s).?.index);
    try std.testing.expect(window(&.{}, anchor, anchor) == null);
}

test "a handover waits for the crossing track to end" {
    const rotation = entries(&.{ 100, 50 });
    const s = std.time.us_per_s;
    try std.testing.expectEqual(120 * s + 30 * s, crossingEnd(&rotation, 0, 120 * s));
    try std.testing.expectEqual(150 * s, crossingEnd(&rotation, 0, 150 * s));
}

test "up next follows the loop, or the new rotation's head in a grace window" {
    const rotation = entries(&.{ 1, 2, 3 });
    var buffer: [4]Entry = undefined;
    const after = upNext(&rotation, 2, null, &buffer);
    try std.testing.expectEqual(@as(usize, 2), after.len);
    try std.testing.expectEqual(@as(i64, 1), after[0].duration_seconds);
    const head = entries(&.{ 9, 8, 7, 6, 5 });
    try std.testing.expectEqual(@as(i64, 9), upNext(&rotation, 0, &head, &buffer)[0].duration_seconds);
    try std.testing.expectEqual(@as(usize, 4), upNext(&rotation, 0, &head, &buffer).len);
    try std.testing.expectEqual(@as(usize, 0), upNext(&rotation, null, null, &buffer).len);
}
