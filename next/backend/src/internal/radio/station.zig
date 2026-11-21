//! The station lineup: a small, curated set you flip between. A station is a
//! name, a lens (what it leans toward) and a corpus filter (what is eligible).
//! Ported from production's `backend/api/radio/stations.py` and `lenses.py`;
//! the slugs and the response shapes they feed are a public contract.

const std = @import("std");

/// One eligible track as the sampler sees it: the cheap columns only.
pub const Candidate = struct {
    uri: []const u8,
    owner_did: []const u8,
    handle: []const u8,
    duration_seconds: i64,
    created_at_us: i64,
    play_count: i64,
    like_count: i64,
    /// tagged or labeled with a default hidden tag (ai, suno, ...)
    hidden: bool,
};

pub const Lens = enum { loved, fresh, deep_cuts };

pub const Corpus = enum {
    /// keep the tracks the homepage hides by default out
    exclude_hidden,
    /// only those tracks, minus the plyr.fm account's own update posts
    only_hidden,
    /// only the account that broadcasts the sonified firehose
    firehose_publisher,
};

/// A broadcast that preempts a station's rotation while it airs. The rotation
/// keeps running underneath as the clock, so whatever resumes afterwards lands
/// where wall-clock time says it should, like real radio.
pub const LiveSource = struct {
    stream_url: []const u8,
    /// answers "is this airing right now" without pulling media
    health_url: []const u8,
    kind: []const u8 = "hls",
};

pub const Station = struct {
    slug: []const u8,
    name: []const u8,
    description: []const u8,
    lens: Lens,
    corpus: Corpus = .exclude_hidden,
    /// sampler weights decay as exp(-rank/scale): roughly the top ~3*scale ranks carry it
    rank_decay: f64 = 12.0,
    /// share of draws that ignore the lens, so the dormant tail cycles through
    exploration: f64 = 0.25,
    /// where the station's audio comes from, when it comes from elsewhere
    source_url: ?[]const u8 = null,
    /// who may preempt is a curation decision made here, not something a
    /// publisher can assert about itself
    live: ?LiveSource = null,
};

pub const plyr_account_handle = "plyr.fm";
pub const firehose_publisher_handle = "waow.tech";

pub const stations = [_]Station{
    .{ .slug = "loved", .name = "loved", .description = "the most-played tracks on plyr.fm", .lens = .loved },
    // fresh IS its head: a uniform draw would leak old tracks into "the newest uploads"
    .{ .slug = "fresh", .name = "fresh", .description = "the newest uploads on plyr.fm", .lens = .fresh, .exploration = 0.0 },
    // the long tail: lens scores are near-ties across hundreds of tracks, so reach deeper
    .{ .slug = "deep-cuts", .name = "deep cuts", .description = "underplayed tracks from the back catalog", .lens = .deep_cuts, .rank_decay = 48.0 },
    .{ .slug = "slop", .name = "slop", .description = "ai-generated tracks", .lens = .loved, .corpus = .only_hidden },
    // off air, the station plays the archived segments of the same signal
    .{
        .slug = "firehose",
        .name = "firehose",
        .description = "the atproto firehose, sonified",
        .lens = .fresh,
        .corpus = .firehose_publisher,
        .exploration = 0.0,
        .source_url = "https://relay-eval.waow.tech/sonify",
        .live = .{
            .stream_url = "https://relay-eval.waow.tech/sonify/live/index.m3u8",
            .health_url = "https://relay-eval.waow.tech/api/sonify/live",
        },
    },
};

pub const default_slug = "loved";

/// A null slug is the default station, the historical single-station contract.
pub fn get(slug: ?[]const u8) ?*const Station {
    const wanted = slug orelse default_slug;
    for (&stations) |*station| {
        if (std.mem.eql(u8, station.slug, wanted)) return station;
    }
    return null;
}

pub fn eligible(station: *const Station, candidate: Candidate) bool {
    return switch (station.corpus) {
        .exclude_hidden => !candidate.hidden,
        .only_hidden => candidate.hidden and !std.mem.eql(u8, candidate.handle, plyr_account_handle),
        .firehose_publisher => std.mem.eql(u8, candidate.handle, firehose_publisher_handle),
    };
}

/// days over which a track matures into deep-cut eligibility, so a
/// just-uploaded track belongs to fresh, not deep cuts
const deep_cut_maturity_days = 30.0;

/// Higher is more on-axis. Only the ordering matters: the sampler weights by rank.
/// `recency_rank` is the position in the station's newest-first pool.
pub fn score(lens: Lens, candidate: Candidate, recency_rank: usize, now_us: i64) f64 {
    const plays: f64 = @floatFromInt(@max(candidate.play_count, 0));
    const likes: f64 = @floatFromInt(@max(candidate.like_count, 0));
    return switch (lens) {
        .loved => likes * 3 + std.math.log1p(plays),
        // purely how recently it landed, by position, so it tracks whatever just landed
        .fresh => -@as(f64, @floatFromInt(recency_rank)),
        .deep_cuts => blk: {
            const age_us: f64 = @floatFromInt(@max(now_us - candidate.created_at_us, 0));
            const age_days = age_us / (86_400.0 * std.time.us_per_s);
            const obscurity = 1.0 / (1.0 + std.math.log1p(plays));
            const maturity = 1.0 - @exp(-age_days / deep_cut_maturity_days);
            break :blk obscurity * maturity + std.math.log1p(likes) * 0.1;
        },
    };
}

test "a missing slug is the default station and unknown slugs are refused" {
    try std.testing.expectEqualStrings("loved", get(null).?.slug);
    try std.testing.expectEqualStrings("deep cuts", get("deep-cuts").?.name);
    try std.testing.expect(get("jazz") == null);
}

test "corpus filters keep each station to its own tracks" {
    const base: Candidate = .{ .uri = "at://a", .owner_did = "did:plc:a", .handle = "someone.bsky.social", .duration_seconds = 100, .created_at_us = 0, .play_count = 0, .like_count = 0, .hidden = false };
    var hidden = base;
    hidden.hidden = true;
    var plyr = hidden;
    plyr.handle = plyr_account_handle;
    var firehose = base;
    firehose.handle = firehose_publisher_handle;
    try std.testing.expect(eligible(get("loved").?, base));
    try std.testing.expect(!eligible(get("loved").?, hidden));
    try std.testing.expect(eligible(get("slop").?, hidden));
    try std.testing.expect(!eligible(get("slop").?, plyr));
    try std.testing.expect(!eligible(get("slop").?, base));
    try std.testing.expect(eligible(get("firehose").?, firehose));
    try std.testing.expect(!eligible(get("firehose").?, base));
}

test "deep cuts prefers old, unplayed tracks over new or popular ones" {
    const day: i64 = 86_400 * std.time.us_per_s;
    const now = 400 * day;
    const old_quiet: Candidate = .{ .uri = "a", .owner_did = "d", .handle = "h", .duration_seconds = 1, .created_at_us = 0, .play_count = 0, .like_count = 0, .hidden = false };
    var new_quiet = old_quiet;
    new_quiet.created_at_us = now - day;
    var old_loud = old_quiet;
    old_loud.play_count = 500;
    try std.testing.expect(score(.deep_cuts, old_quiet, 0, now) > score(.deep_cuts, new_quiet, 0, now));
    try std.testing.expect(score(.deep_cuts, old_quiet, 0, now) > score(.deep_cuts, old_loud, 0, now));
    try std.testing.expect(score(.loved, old_loud, 0, now) > score(.loved, old_quiet, 0, now));
    try std.testing.expect(score(.fresh, old_quiet, 0, now) > score(.fresh, old_quiet, 3, now));
}
