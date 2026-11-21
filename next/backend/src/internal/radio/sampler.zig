//! Turns a station's scored pool into a rotation that no one artist can stack.
//! Ported from production's `backend/api/radio/sampler.py`:
//!
//! - deterministic per (station, period): seeded by the slug and the period,
//!   so a rebuild inside a period draws the same way from the same pool;
//! - per-artist airtime budget: past ~20 minutes an artist stops being drawn
//!   (one budget-crossing track is allowed, since a track can't be split);
//! - artist spacing: no artist within three entries of their last one, relaxed
//!   only when nobody else is drawable;
//! - weighted draw without replacement, by rank-decay weight;
//! - an exploration floor of uniform draws, so the dormant tail cycles through.

const std = @import("std");
const station_module = @import("station.zig");

const Candidate = station_module.Candidate;
const Station = station_module.Station;

pub const default_track_seconds: i64 = 180;
pub const artist_airtime_cap_seconds: i64 = 20 * 60;
pub const target_rotation_seconds: i64 = 4 * 60 * 60;
pub const artist_spacing: usize = 3;

/// One slot of a rotation: what the clock needs, without the track's data.
pub const Entry = struct {
    uri: []const u8,
    owner_did: []const u8,
    duration_seconds: i64,
};

pub fn trackSeconds(duration_seconds: i64) i64 {
    return if (duration_seconds > 0) duration_seconds else default_track_seconds;
}

/// Filters the newest-first `corpus` to the station, ranks it through the
/// station's lens and draws a rotation of at most `max_tracks` entries.
pub fn select(
    allocator: std.mem.Allocator,
    station: *const Station,
    corpus: []const Candidate,
    period: i64,
    max_tracks: usize,
    now_us: i64,
) ![]Entry {
    var pool: std.ArrayList(Candidate) = .empty;
    for (corpus) |candidate| {
        if (station_module.eligible(station, candidate)) try pool.append(allocator, candidate);
    }
    if (pool.items.len == 0) return &.{};

    // the pool keeps the corpus's newest-first order, so its index is the recency rank
    const Ranked = struct { index: usize, score: f64 };
    const ranked = try allocator.alloc(Ranked, pool.items.len);
    for (pool.items, 0..) |candidate, index| ranked[index] = .{
        .index = index,
        .score = station_module.score(station.lens, candidate, index, now_us),
    };
    std.sort.pdq(Ranked, ranked, {}, struct {
        fn lessThan(_: void, a: Ranked, b: Ranked) bool {
            if (a.score != b.score) return a.score > b.score;
            return a.index < b.index;
        }
    }.lessThan);
    // weight by rank, not raw score: the tail's total mass stays ~scale however
    // long the catalog, so hundreds of old tracks can't outweigh a fresh few
    const weights = try allocator.alloc(f64, pool.items.len);
    for (ranked, 0..) |item, rank| {
        weights[item.index] = @exp(-@as(f64, @floatFromInt(rank)) / station.rank_decay);
    }
    return build(allocator, pool.items, weights, seed(station.slug, period), .{
        .max_tracks = max_tracks,
        .exploration = station.exploration,
    });
}

pub const Options = struct {
    max_tracks: usize,
    target_seconds: i64 = target_rotation_seconds,
    artist_airtime_cap_seconds: i64 = artist_airtime_cap_seconds,
    exploration: f64 = 0.25,
    artist_spacing: usize = artist_spacing,
};

pub fn seed(slug: []const u8, period: i64) u64 {
    var hasher = std.crypto.hash.blake2.Blake2s256.init(.{});
    hasher.update(slug);
    var buffer: [24]u8 = undefined;
    hasher.update(std.fmt.bufPrint(&buffer, ":{d}", .{period}) catch unreachable);
    var digest: [32]u8 = undefined;
    hasher.final(&digest);
    return std.mem.readInt(u64, digest[0..8], .big);
}

/// `weights[i]` belongs to `pool[i]`; a non-positive weight is never drawn.
pub fn build(
    allocator: std.mem.Allocator,
    pool: []const Candidate,
    weights: []const f64,
    rng_seed: u64,
    options: Options,
) ![]Entry {
    var prng = std.Random.Xoshiro256.init(rng_seed);
    const random = prng.random();

    var remaining: std.ArrayList(usize) = .empty;
    for (weights, 0..) |weight, index| {
        if (weight > 0) try remaining.append(allocator, index);
    }

    var rotation: std.ArrayList(Entry) = .empty;
    var airtime: std.StringHashMapUnmanaged(i64) = .empty;
    var total_seconds: i64 = 0;
    var eligible: std.ArrayList(usize) = .empty;

    while (remaining.items.len > 0 and rotation.items.len < options.max_tracks and total_seconds < options.target_seconds) {
        // draw from the eligible subset rather than draw-then-reject, so a
        // dominant artist can't burn the draws that should have aired others
        const recent = rotation.items[rotation.items.len -| options.artist_spacing..];
        eligible.clearRetainingCapacity();
        for (remaining.items, 0..) |pool_index, position| {
            const candidate = pool[pool_index];
            if ((airtime.get(candidate.owner_did) orelse 0) >= options.artist_airtime_cap_seconds) continue;
            if (airedIn(recent, candidate.owner_did)) continue;
            try eligible.append(allocator, position);
        }
        if (eligible.items.len == 0) {
            for (remaining.items, 0..) |pool_index, position| {
                if ((airtime.get(pool[pool_index].owner_did) orelse 0) < options.artist_airtime_cap_seconds)
                    try eligible.append(allocator, position);
            }
        }
        if (eligible.items.len == 0) break;

        const chosen_position = if (random.float(f64) < options.exploration)
            eligible.items[random.uintLessThan(usize, eligible.items.len)]
        else
            eligible.items[weightedPick(random, weights, remaining.items, eligible.items)];
        const pool_index = remaining.orderedRemove(chosen_position);
        const candidate = pool[pool_index];
        const seconds = trackSeconds(candidate.duration_seconds);
        try rotation.append(allocator, .{ .uri = candidate.uri, .owner_did = candidate.owner_did, .duration_seconds = seconds });
        const entry = try airtime.getOrPut(allocator, candidate.owner_did);
        entry.value_ptr.* = (if (entry.found_existing) entry.value_ptr.* else 0) + seconds;
        total_seconds += seconds;
    }

    // the rotation is a loop: trim tail entries that would collide with its
    // head across the seam. a one-artist corpus has no seam worth fixing.
    var trims: usize = 0;
    while (trims < options.artist_spacing) : (trims += 1) {
        if (rotation.items.len <= options.artist_spacing + 1 or
            !hasTwoArtists(rotation.items) or
            !seamCollides(rotation.items, options.artist_spacing)) break;
        _ = rotation.pop();
    }
    return rotation.toOwnedSlice(allocator);
}

fn airedIn(entries: []const Entry, did: []const u8) bool {
    for (entries) |entry| if (std.mem.eql(u8, entry.owner_did, did)) return true;
    return false;
}

fn hasTwoArtists(entries: []const Entry) bool {
    for (entries[1..]) |entry| if (!std.mem.eql(u8, entry.owner_did, entries[0].owner_did)) return true;
    return false;
}

/// Whether the loop's tail repeats an artist within `spacing` of its head.
pub fn seamCollides(rotation: []const Entry, spacing: usize) bool {
    var tail: usize = 1;
    while (tail <= spacing) : (tail += 1) {
        var head: usize = 0;
        while (head + tail <= spacing) : (head += 1) {
            if (std.mem.eql(u8, rotation[rotation.len - tail].owner_did, rotation[head].owner_did)) return true;
        }
    }
    return false;
}

/// Index into `eligible` of a draw weighted by each position's pool weight.
fn weightedPick(random: std.Random, weights: []const f64, remaining: []const usize, eligible: []const usize) usize {
    var total: f64 = 0;
    for (eligible) |position| total += weights[remaining[position]];
    const target = random.float(f64) * total;
    var cumulative: f64 = 0;
    for (eligible, 0..) |position, index| {
        cumulative += weights[remaining[position]];
        if (target < cumulative) return index;
    }
    return eligible.len - 1;
}

fn fixture(allocator: std.mem.Allocator, artists: usize, per_artist: usize, duration: i64) ![]Candidate {
    const pool = try allocator.alloc(Candidate, artists * per_artist);
    for (pool, 0..) |*candidate, index| candidate.* = .{
        .uri = try std.fmt.allocPrint(allocator, "at://did:plc:{d}/fm.plyr.track/{d}", .{ index % artists, index }),
        .owner_did = try std.fmt.allocPrint(allocator, "did:plc:{d}", .{index % artists}),
        .handle = "someone.test",
        .duration_seconds = duration,
        .created_at_us = @intCast(1_000_000 * (pool.len - index)),
        .play_count = @intCast(index),
        .like_count = 0,
        .hidden = false,
    };
    return pool;
}

test "the same station and period always draws the same rotation" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const pool = try fixture(a, 12, 6, 200);
    const loved = station_module.get("loved").?;
    const first = try select(a, loved, pool, 7, 40, 0);
    const again = try select(a, loved, pool, 7, 40, 0);
    const later = try select(a, loved, pool, 8, 40, 0);
    try std.testing.expectEqual(first.len, again.len);
    for (first, again) |x, y| try std.testing.expectEqualStrings(x.uri, y.uri);
    var same = first.len == later.len;
    if (same) for (first, later) |x, y| {
        if (!std.mem.eql(u8, x.uri, y.uri)) same = false;
    };
    try std.testing.expect(!same);
}

test "no artist airs twice within the spacing or past the airtime budget" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const pool = try fixture(a, 30, 4, 240);
    for ([_]u64{ 1, 2, 3, 99, 12345 }) |s| {
        const weights = try a.alloc(f64, pool.len);
        for (weights, 0..) |*w, i| w.* = @exp(-@as(f64, @floatFromInt(i)) / 12.0);
        const rotation = try build(a, pool, weights, s, .{ .max_tracks = 75 });
        try std.testing.expect(rotation.len > artist_spacing);
        var airtime: std.StringHashMapUnmanaged(i64) = .empty;
        for (rotation, 0..) |entry, index| {
            const start = index -| artist_spacing;
            for (rotation[start..index]) |earlier| try std.testing.expect(!std.mem.eql(u8, earlier.owner_did, entry.owner_did));
            const slot = try airtime.getOrPut(a, entry.owner_did);
            const before = if (slot.found_existing) slot.value_ptr.* else 0;
            try std.testing.expect(before < artist_airtime_cap_seconds);
            slot.value_ptr.* = before + entry.duration_seconds;
        }
        try std.testing.expect(!seamCollides(rotation, artist_spacing));
    }
}

test "a one-artist corpus still fills a rotation" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const pool = try fixture(a, 1, 10, 60);
    const weights = try a.alloc(f64, pool.len);
    @memset(weights, 1);
    const rotation = try build(a, pool, weights, 4, .{ .max_tracks = 40 });
    try std.testing.expectEqual(@as(usize, 10), rotation.len);
}

test "an empty station draws nothing" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const pool = try fixture(a, 3, 3, 60);
    try std.testing.expectEqual(@as(usize, 0), (try select(a, station_module.get("firehose").?, pool, 1, 40, 0)).len);
}

test "fresh without exploration draws only from its newest tracks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const pool = try fixture(a, 40, 10, 200);
    const rotation = try select(a, station_module.get("fresh").?, pool, 3, 40, 0);
    // rank-decay 12 puts essentially all mass in the first ~100 of 400
    for (rotation) |entry| {
        var position: usize = 0;
        for (pool, 0..) |candidate, index| if (std.mem.eql(u8, candidate.uri, entry.uri)) {
            position = index;
        };
        try std.testing.expect(position < 150);
    }
}
