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
    key: ?[]const u8 = null,
};

pub const Repeat = enum { off, all, one };
pub const TailKind = enum { collection, generated };
pub const Output = struct { clientId: []const u8, connectionId: []const u8 };
pub const Personal = struct {
    explicitEnd: u32,
    tailKind: ?TailKind = null,
    label: ?[]const u8 = null,
    repeat: Repeat = .off,
    keepPlaying: bool = false,
    cursor: ?[]const u8 = null,
    output: ?Output = null,
    disconnected: bool = false,
};
pub const Client = struct {
    id: []const u8 = "",
    connection: []const u8 = "",
    internal: bool = false,
    resumePlaying: bool = false,
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
    personal: ?Personal = null,
};

pub const Action = enum { play, pause, seek, replaceQueue, selectTrack, enqueue, removeEntry, moveEntry, playContext, clearPicks, shufflePicks, setRepeat, setContinuation, appendContinuation, advance, progress, connected, disconnected };
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
    entry: ?Track = null,
    entryKey: ?[]const u8 = null,
    beforeKey: ?[]const u8 = null,
    label: ?[]const u8 = null,
    repeat: ?Repeat = null,
    keepPlaying: ?bool = null,
    cursor: ?[]const u8 = null,
    expectedOutput: ?[]const u8 = null,
};

pub const Outcome = enum { applied, noop, duplicate, conflict, forbidden, invalid };
pub const Result = struct { outcome: Outcome, state: State };

pub fn boundedId(value: []const u8) bool {
    if (value.len == 0 or value.len > 64) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_') return false;
    return true;
}

pub fn validateQueue(allocator: std.mem.Allocator, queue: []const Track, collection: []const u8) !bool {
    return validateReferences(allocator, queue, collection, false);
}

pub fn validateReferences(allocator: std.mem.Allocator, queue: []const Track, collection: []const u8, allow_unknown_duration: bool) !bool {
    if (queue.len > max_tracks) return false;
    for (queue) |track| {
        if (track.id.len > 2048 or track.uri.len > 1024 or track.cid.len > 128 or
            (!allow_unknown_duration and track.durationMs == 0) or track.durationMs > max_position_ms) return false;
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
