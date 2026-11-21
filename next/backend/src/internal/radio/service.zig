//! Radio's use case: which station, which rotation governs this instant,
//! where the playhead is, and whether a broadcast preempts it. The answer keeps
//! production's `/radio/state` shape, which external clients, games and the
//! plyr-radio syndication adapter read.

const std = @import("std");
const station_module = @import("station.zig");
const sampler = @import("sampler.zig");
const clock = @import("clock.zig");
const live = @import("live.zig");
const store_module = @import("store.zig");
const tag_filter = @import("../domain/tag_filter.zig");
const track = @import("../domain/track.zig");

const Entry = sampler.Entry;
const RadioStore = store_module.RadioStore;
const Station = station_module.Station;

pub const default_size: usize = 40;
pub const max_size: usize = 75;

pub const Service = struct {
    store: RadioStore,
    collections: store_module.Collections,
    probe: *live.Probe,

    pub const Request = struct {
        station: *const Station,
        size: usize = default_size,
        catalog_only: bool = false,
    };

    pub fn state(self: Service, arena: std.mem.Allocator, request: Request, now_us: i64) !State {
        const governing = try self.stationClock(arena, request, now_us);

        var uris: std.ArrayList([]const u8) = .empty;
        for (governing.rotation) |entry| try uris.append(arena, entry.uri);
        if (governing.upcoming) |head| for (head) |entry| try uris.append(arena, entry.uri);
        const hydrated = try self.store.tracks(arena, self.collections, uris.items);
        var by_uri: std.StringHashMapUnmanaged(store_module.Hydrated) = .empty;
        for (hydrated) |value| try by_uri.put(arena, value.value.record.uri, value);

        // a track taken down, made private or gated since the pin drops out
        const rotation = try airable(arena, governing.rotation, &by_uri);
        const upcoming = if (governing.upcoming) |head| try airable(arena, head, &by_uri) else null;

        const current = clock.window(rotation, governing.anchor_us, now_us);
        var next_buffer: [4]Entry = undefined;
        const next = clock.upNext(rotation, if (current) |value| value.index else null, upcoming, &next_buffer);

        // the loop keeps running underneath a broadcast, as the clock, so
        // whatever resumes afterwards lands where wall-clock time says
        const broadcast = if (request.catalog_only) null else if (request.station.live) |source|
            try self.probe.get(arena, source)
        else
            null;

        const rendered = try arena.alloc(RadioTrack, rotation.len);
        for (rotation, rendered) |entry, *slot| slot.* = try render(arena, entry, by_uri.get(entry.uri).?);
        const rendered_next = try arena.alloc(RadioTrack, next.len);
        for (next, rendered_next) |entry, *slot| slot.* = try render(arena, entry, by_uri.get(entry.uri).?);

        return .{
            .station = request.station.name,
            .station_slug = request.station.slug,
            .generated_at = try formatTimestamp(arena, now_us),
            .loop_duration_seconds = clock.loopSeconds(rotation),
            .current_index = if (current) |value| value.index else null,
            .current_started_at = if (current) |value| try formatTimestamp(arena, value.started_at_us) else null,
            .current_ends_at = if (current) |value| try formatTimestamp(arena, value.ends_at_us) else null,
            .progress_seconds = if (current) |value| @divFloor(value.progress_us, std.time.us_per_s) else 0,
            .current = if (current) |value| rendered[value.index] else null,
            .up_next = rendered_next,
            .rotation = rendered,
            .live = if (broadcast) |value| .{
                .stream_url = value.stream_url,
                .kind = value.kind,
                .started_at = value.started_at,
                .artwork_url = value.artwork_url,
            } else null,
        };
    }

    const Governing = struct {
        rotation: []const Entry,
        anchor_us: i64,
        /// the next rotation's head, during a handover grace window
        upcoming: ?[]const Entry = null,
    };

    /// Handovers land on track boundaries: the first request of a period pins
    /// its anchor at the moment the previous period's in-flight track ends,
    /// and until then the previous rotation keeps playing.
    fn stationClock(self: Service, arena: std.mem.Allocator, request: Request, now_us: i64) !Governing {
        const period = clock.periodIndex(now_us);
        const period_start = clock.periodStart(period);
        const key: store_module.Key = .{ .station = request.station.slug, .size = request.size, .period = period };
        const previous_key: store_module.Key = .{ .station = request.station.slug, .size = request.size, .period = period - 1 };

        var anchor: ?i64 = null;
        const rotation = if (try self.store.peek(arena, key)) |pinned| blk: {
            anchor = pinned.anchor_us;
            break :blk pinned.entries;
        } else try self.draw(arena, request, key, now_us);
        if (rotation.len == 0) return .{ .rotation = rotation, .anchor_us = period_start };

        const previous = try self.store.peek(arena, previous_key);
        const previous_anchor = if (previous) |value| value.anchor_us orelse clock.periodStart(period - 1) else clock.periodStart(period - 1);
        if (anchor == null) {
            // only what actually aired can hand over; an unknown previous
            // period starts the new loop at the period boundary
            const proposed = if (previous) |value|
                if (value.entries.len > 0) clock.crossingEnd(value.entries, previous_anchor, period_start) else period_start
            else
                period_start;
            anchor = try self.store.pinAnchor(key, proposed) orelse period_start;
        }
        if (now_us < anchor.?) {
            if (previous) |value| if (value.entries.len > 0)
                return .{ .rotation = value.entries, .anchor_us = previous_anchor, .upcoming = rotation };
            return .{ .rotation = rotation, .anchor_us = period_start };
        }
        return .{ .rotation = rotation, .anchor_us = anchor.? };
    }

    /// The first draw in a period is the period's rotation; a concurrent draw
    /// gets the winner's back.
    fn draw(self: Service, arena: std.mem.Allocator, request: Request, key: store_module.Key, now_us: i64) ![]const Entry {
        const corpus = try self.store.corpus(arena, self.collections, tag_filter.defaults);
        const drawn = try sampler.select(arena, request.station, corpus, key.period, request.size, now_us);
        if (drawn.len == 0) return drawn;
        return self.store.pin(arena, key, drawn);
    }
};

fn airable(arena: std.mem.Allocator, entries: []const Entry, by_uri: *const std.StringHashMapUnmanaged(store_module.Hydrated)) ![]Entry {
    var kept: std.ArrayList(Entry) = .empty;
    for (entries) |entry| {
        const value = by_uri.get(entry.uri) orelse continue;
        if (streamOrigin(value.value) == null) continue;
        try kept.append(arena, entry);
    }
    return kept.toOwnedSlice(arena);
}

pub const RadioTrack = struct {
    id: i64,
    title: []const u8,
    artist: []const u8,
    artist_handle: []const u8,
    artist_did: []const u8,
    artist_avatar_url: ?[]const u8,
    stream_url: []const u8,
    file_type: []const u8,
    duration: i64,
    artwork_url: ?[]const u8,
    thumbnail_url: ?[]const u8,
    atproto_record_uri: []const u8,
    atproto_record_cid: ?[]const u8,
    created_at: []const u8,
    tags: []const []const u8,
    like_count: i64,
    play_count: i64,
    /// the anonymous rotation is shared; clients overlay their own likes
    liked: bool = false,
};

pub const LiveBroadcast = struct {
    stream_url: []const u8,
    kind: []const u8,
    started_at: ?[]const u8,
    artwork_url: ?[]const u8,
};

pub const State = struct {
    station: []const u8,
    station_slug: []const u8,
    generated_at: []const u8,
    loop_duration_seconds: i64,
    current_index: ?usize,
    current_started_at: ?[]const u8,
    current_ends_at: ?[]const u8,
    progress_seconds: i64,
    current: ?RadioTrack,
    up_next: []const RadioTrack,
    rotation: []const RadioTrack,
    /// set while a broadcast preempts the rotation, which then describes what resumes
    live: ?LiveBroadcast,
};

pub const StationSummary = struct {
    slug: []const u8,
    name: []const u8,
    description: []const u8,
    is_default: bool,
    source_url: ?[]const u8,
};

pub const Lineup = struct {
    default_slug: []const u8,
    stations: []const StationSummary,
};

pub fn lineup(arena: std.mem.Allocator) !Lineup {
    const summaries = try arena.alloc(StationSummary, station_module.stations.len);
    for (station_module.stations, summaries) |station, *summary| summary.* = .{
        .slug = station.slug,
        .name = station.name,
        .description = station.description,
        .is_default = std.mem.eql(u8, station.slug, station_module.default_slug),
        .source_url = station.source_url,
    };
    return .{ .default_slug = station_module.default_slug, .stations = summaries };
}

/// The origin playback would choose: a verified copy first, else what the
/// record names.
fn streamOrigin(value: track.Track) ?track.Origin {
    for (value.media.origins) |origin| if (origin.source == .verified_delivery) return origin;
    return if (value.media.origins.len > 0) value.media.origins[0] else null;
}

fn render(arena: std.mem.Allocator, entry: Entry, hydrated: store_module.Hydrated) !RadioTrack {
    const value = hydrated.value;
    const origin = streamOrigin(value).?;
    const artwork = if (value.media.artwork) |art| art.url else value.artist.profile.avatar_url;
    return .{
        .id = if (value.legacy_id) |id| id else stableId(value.record.uri),
        .title = value.metadata.title,
        .artist = value.artist.profile.display_name,
        .artist_handle = value.artist.profile.handle,
        .artist_did = value.artist.did,
        .artist_avatar_url = value.artist.profile.avatar_url,
        .stream_url = origin.url,
        .file_type = fileType(origin.media_type),
        // the pinned duration is what the clock runs on
        .duration = entry.duration_seconds,
        .artwork_url = artwork,
        .thumbnail_url = if (artwork) |url| try thumbnail(arena, url) else null,
        .atproto_record_uri = value.record.uri,
        .atproto_record_cid = value.record.cid,
        .created_at = value.metadata.created_at,
        .tags = hydrated.tags,
        .like_count = value.metrics.like_count,
        .play_count = value.metrics.play_count,
    };
}

/// Production's numeric ID where the track has one. Tracks first published on
/// next have none, so they get a stable number from their URI, above any
/// production ID and inside JavaScript's safe integers.
pub fn stableId(uri: []const u8) i64 {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(uri, &digest, .{});
    const low = std.mem.readInt(u48, digest[0..6], .big);
    return (@as(i64, 1) << 48) | @as(i64, low);
}

/// Records name a file type ("mp3"); verified copies carry a media type.
fn fileType(media_type: []const u8) []const u8 {
    const slash = std.mem.indexOfScalar(u8, media_type, '/') orelse return media_type;
    const subtype = media_type[slash + 1 ..];
    if (std.mem.eql(u8, subtype, "mpeg") or std.mem.eql(u8, subtype, "mp3")) return "mp3";
    if (std.mem.eql(u8, subtype, "mp4") or std.mem.eql(u8, subtype, "x-m4a") or std.mem.eql(u8, subtype, "aac")) return "m4a";
    if (std.mem.eql(u8, subtype, "x-wav") or std.mem.eql(u8, subtype, "wave")) return "wav";
    if (std.mem.eql(u8, subtype, "x-flac")) return "flac";
    return subtype;
}

/// plyr's image CDN resizes at the edge; anything else is used as is.
fn thumbnail(arena: std.mem.Allocator, url: []const u8) ![]const u8 {
    const host = "https://images.plyr.fm/";
    if (!std.mem.startsWith(u8, url, host) or std.mem.startsWith(u8, url, host ++ "cdn-cgi/")) return url;
    return std.fmt.allocPrint(arena, "{s}cdn-cgi/image/width=300,quality=82,format=auto/{s}", .{ host, url[host.len..] });
}

/// RFC 3339 in UTC with microseconds.
pub fn formatTimestamp(arena: std.mem.Allocator, us: i64) ![]const u8 {
    const seconds = @divFloor(us, std.time.us_per_s);
    const micros: u64 = @intCast(@mod(us, std.time.us_per_s));
    const epoch: std.time.epoch.EpochSeconds = .{ .secs = @intCast(seconds) };
    const day = epoch.getEpochDay().calculateYearDay();
    const month_day = day.calculateMonthDay();
    const time = epoch.getDaySeconds();
    return std.fmt.allocPrint(arena, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.{d:0>6}Z", .{
        day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        time.getHoursIntoDay(),
        time.getMinutesIntoHour(),
        time.getSecondsIntoMinute(),
        micros,
    });
}

test "timestamps format as RFC 3339 and parse back" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const text = try formatTimestamp(arena.allocator(), 1_795_239_898_843_123);
    try std.testing.expectEqualStrings("2026-11-21T05:44:58.843123Z", text);
    try std.testing.expectEqual(@as(?i64, 1_795_239_898_843_123), live.parseTimestampUs(text));
}

test "IDs: production's where there is one, a stable safe number otherwise" {
    const a = stableId("at://did:plc:a/fm.plyr.track/1");
    try std.testing.expectEqual(a, stableId("at://did:plc:a/fm.plyr.track/1"));
    try std.testing.expect(a != stableId("at://did:plc:a/fm.plyr.track/2"));
    try std.testing.expect(a > std.math.maxInt(i32));
    try std.testing.expect(a < (1 << 53));
}

test "file types and thumbnails" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqualStrings("mp3", fileType("audio/mpeg"));
    try std.testing.expectEqualStrings("m4a", fileType("audio/x-m4a"));
    try std.testing.expectEqualStrings("wav", fileType("wav"));
    try std.testing.expectEqualStrings(
        "https://images.plyr.fm/cdn-cgi/image/width=300,quality=82,format=auto/images/a.jpg",
        try thumbnail(arena.allocator(), "https://images.plyr.fm/images/a.jpg"),
    );
    try std.testing.expectEqualStrings("https://cdn.bsky.app/x.jpg", try thumbnail(arena.allocator(), "https://cdn.bsky.app/x.jpg"));
}

const FakeStore = struct {
    candidates: []const station_module.Candidate,
    pins: std.AutoHashMapUnmanaged(i64, RadioStore.Pinned) = .empty,
    /// URIs `tracks` leaves out, as if taken down since the pin
    gone: []const []const u8 = &.{},
    draws: usize = 0,

    const vtable: RadioStore.VTable = .{ .corpus = corpus, .tracks = tracks, .pin = pin, .peek = peek, .pinAnchor = pinAnchor };

    fn store(self: *FakeStore) RadioStore {
        return .{ .context = self, .vtable = &vtable };
    }

    fn corpus(context: *anyopaque, _: std.mem.Allocator, _: store_module.Collections, _: []const []const u8) store_module.Error![]station_module.Candidate {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        self.draws += 1;
        return @constCast(self.candidates);
    }

    fn tracks(context: *anyopaque, allocator: std.mem.Allocator, _: store_module.Collections, uris: []const []const u8) store_module.Error![]store_module.Hydrated {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        var out: std.ArrayList(store_module.Hydrated) = .empty;
        outer: for (uris) |uri| {
            for (self.gone) |gone| if (std.mem.eql(u8, gone, uri)) continue :outer;
            try out.append(allocator, .{ .value = fixtureTrack(uri), .tags = &.{} });
        }
        return out.toOwnedSlice(allocator);
    }

    fn pin(context: *anyopaque, allocator: std.mem.Allocator, key: store_module.Key, entries: []const Entry) store_module.Error![]Entry {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        const slot = try self.pins.getOrPut(allocator, key.period);
        if (!slot.found_existing) slot.value_ptr.* = .{ .entries = try allocator.dupe(Entry, entries), .anchor_us = null };
        return slot.value_ptr.entries;
    }

    fn peek(context: *anyopaque, _: std.mem.Allocator, key: store_module.Key) store_module.Error!?RadioStore.Pinned {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        return self.pins.get(key.period);
    }

    fn pinAnchor(context: *anyopaque, key: store_module.Key, anchor_us: i64) store_module.Error!?i64 {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        const value = self.pins.getPtr(key.period) orelse return null;
        if (value.anchor_us == null) value.anchor_us = anchor_us;
        return value.anchor_us;
    }

    fn fixtureTrack(uri: []const u8) track.Track {
        return .{
            .id = "trk_x",
            .record = .{ .uri = uri, .cid = "bafyrecord", .revision = null, .collection = "fm.plyr.track", .rkey = "x" },
            .metadata = .{ .title = "song", .description = null, .album = null, .duration_seconds = 100, .created_at = "2026-01-01T00:00:00Z" },
            .artist = .{ .did = "did:plc:a", .profile = .{ .handle = "a.test", .display_name = "a", .avatar_url = null } },
            .media = .{ .artifacts = &.{}, .origins = &.{.{ .url = "https://audio.plyr.fm/audio/x.mp3", .media_type = "mp3", .artifact_cid = null, .attestation = null, .source = .verified_repo }} },
            .access = .{ .visibility = .public, .in_discovery = true, .gate = null, .space_uri = null },
            .moderation = .{ .self_labels = &.{}, .operator_labels = &.{}, .override = null },
            .metrics = .{ .play_count = 0 },
            .projection = .{ .indexed_at = "2026-01-01T00:00:00Z", .verification = .verified_repo },
        };
    }
};

fn fakeCorpus(allocator: std.mem.Allocator, count: usize, duration: i64) ![]station_module.Candidate {
    const pool = try allocator.alloc(station_module.Candidate, count);
    for (pool, 0..) |*candidate, index| candidate.* = .{
        .uri = try std.fmt.allocPrint(allocator, "at://did:plc:{d}/fm.plyr.track/{d}", .{ index, index }),
        .owner_did = try std.fmt.allocPrint(allocator, "did:plc:{d}", .{index}),
        .handle = "someone.test",
        .duration_seconds = duration,
        .created_at_us = @intCast(count - index),
        .play_count = @intCast(index),
        .like_count = 0,
        .hidden = false,
    };
    return pool;
}

test "a period's first draw is pinned and every later request hears the same loop" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: FakeStore = .{ .candidates = try fakeCorpus(a, 30, 200) };
    var probe: live.Probe = .{ .io = std.testing.io, .allocator = std.testing.allocator };
    const service: Service = .{ .store = fake.store(), .collections = .{ .track = "fm.plyr.track", .profile = "p", .like = "l" }, .probe = &probe };
    const request: Service.Request = .{ .station = station_module.get("loved").?, .catalog_only = true };
    const s = std.time.us_per_s;
    const now = clock.periodStart(100) + 30 * s;
    const first = try service.state(a, request, now);
    const later = try service.state(a, request, now + 250 * s);
    try std.testing.expectEqual(@as(usize, 1), fake.draws);
    try std.testing.expectEqual(first.rotation.len, later.rotation.len);
    // nothing aired before, so the loop starts at the period boundary
    try std.testing.expectEqual(@as(?usize, 0), first.current_index);
    try std.testing.expectEqual(@as(i64, 30), first.progress_seconds);
    try std.testing.expectEqual(@as(?usize, 1), later.current_index);
    try std.testing.expectEqual(@as(i64, 80), later.progress_seconds);
    try std.testing.expectEqualStrings(first.rotation[1].atproto_record_uri, later.current.?.atproto_record_uri);
    try std.testing.expectEqualStrings(first.rotation[1].atproto_record_uri, first.up_next[0].atproto_record_uri);
    try std.testing.expect(first.live == null);
}

test "a new period waits for the crossing track, then starts its own loop" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: FakeStore = .{ .candidates = try fakeCorpus(a, 30, 7) };
    var probe: live.Probe = .{ .io = std.testing.io, .allocator = std.testing.allocator };
    const service: Service = .{ .store = fake.store(), .collections = .{ .track = "fm.plyr.track", .profile = "p", .like = "l" }, .probe = &probe };
    const request: Service.Request = .{ .station = station_module.get("loved").?, .catalog_only = true };
    const s = std.time.us_per_s;
    // durations of 7s never land exactly on a 4h boundary from the period start
    _ = try service.state(a, request, clock.periodStart(100) + 10 * s);
    const boundary = clock.periodStart(101);
    const handover = try service.state(a, request, boundary + 1);
    const previous = fake.pins.get(100).?;
    const crossing = clock.crossingEnd(previous.entries, previous.anchor_us.?, boundary);
    try std.testing.expect(crossing > boundary);
    // during the grace window the old loop plays on and the new head is up next
    try std.testing.expectEqualStrings(fake.pins.get(101).?.entries[0].uri, handover.up_next[0].atproto_record_uri);
    try std.testing.expectEqual(crossing, fake.pins.get(101).?.anchor_us.?);
    const after = try service.state(a, request, crossing);
    try std.testing.expectEqual(@as(?usize, 0), after.current_index);
    try std.testing.expectEqual(@as(i64, 0), after.progress_seconds);
}

test "a track taken down after the pin drops out of the loop" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: FakeStore = .{ .candidates = try fakeCorpus(a, 10, 100) };
    var probe: live.Probe = .{ .io = std.testing.io, .allocator = std.testing.allocator };
    const service: Service = .{ .store = fake.store(), .collections = .{ .track = "fm.plyr.track", .profile = "p", .like = "l" }, .probe = &probe };
    const request: Service.Request = .{ .station = station_module.get("loved").?, .catalog_only = true };
    const now = clock.periodStart(5) + 1;
    const before = try service.state(a, request, now);
    fake.gone = &.{before.rotation[0].atproto_record_uri};
    const after = try service.state(a, request, now);
    try std.testing.expectEqual(before.rotation.len - 1, after.rotation.len);
    for (after.rotation) |entry| try std.testing.expect(!std.mem.eql(u8, entry.atproto_record_uri, fake.gone[0]));
}

test "an empty station answers with nothing on air" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: FakeStore = .{ .candidates = &.{} };
    var probe: live.Probe = .{ .io = std.testing.io, .allocator = std.testing.allocator };
    const service: Service = .{ .store = fake.store(), .collections = .{ .track = "fm.plyr.track", .profile = "p", .like = "l" }, .probe = &probe };
    const state = try service.state(a, .{ .station = station_module.get("firehose").?, .catalog_only = true }, clock.periodStart(1));
    try std.testing.expect(state.current == null);
    try std.testing.expectEqual(@as(usize, 0), state.rotation.len);
    try std.testing.expectEqualStrings("firehose", state.station_slug);
}
