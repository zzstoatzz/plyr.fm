//! Is a station's broadcast airing right now? Asked server-side, once per
//! cache window for everyone, rather than pointing every listener at the
//! broadcaster's origin. Ported from production's `backend/api/radio/live.py`.
//!
//! Fails closed: a broadcaster we can't reach counts as off air, so the
//! station falls back to its rotation instead of handing out a stream that
//! won't load. Dead air is the one outcome radio must never produce.

const std = @import("std");
const zat = @import("zat");
const LiveSource = @import("station.zig").LiveSource;

const log = std.log.scoped(.radio_live);

/// short enough to notice going on or off air promptly; long enough that the
/// broadcaster sees a trickle
const cache_us: i64 = 5 * std.time.us_per_s;
const probe_timeout_ns: u64 = 3 * std.time.ns_per_s;
/// how stale the newest segment may be before the stream counts as stopped;
/// generous next to a 4s segment so a slow encoder tick isn't an outage
pub const segment_freshness_us: i64 = 45 * std.time.us_per_s;
const user_agent = "plyr.fm-radio/1.0 (+https://plyr.fm)";

pub const Broadcast = struct {
    stream_url: []const u8,
    kind: []const u8,
    started_at: ?[]const u8 = null,
    artwork_url: ?[]const u8 = null,
};

const Cached = struct {
    checked_us: i64,
    on_air: bool,
    started_at: ?[]u8 = null,
    artwork_url: ?[]u8 = null,
};

pub const Probe = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    mutex: std.Io.Mutex = .init,
    /// keyed by health URL; the lineup has one broadcasting station
    cached: std.StringHashMapUnmanaged(Cached) = .empty,

    /// The broadcast if it is airing, copied into `arena`; null when off air.
    pub fn get(self: *Probe, arena: std.mem.Allocator, source: LiveSource) !?Broadcast {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        const now_us = std.Io.Timestamp.now(self.io, .real).toMicroseconds();
        const slot = try self.cached.getOrPut(self.allocator, source.health_url);
        if (!slot.found_existing or now_us - slot.value_ptr.checked_us >= cache_us) {
            if (slot.found_existing) self.release(slot.value_ptr.*);
            // one probe per window: the lock holds concurrent requests until it lands
            slot.value_ptr.* = self.probe(source);
            slot.value_ptr.checked_us = std.Io.Timestamp.now(self.io, .real).toMicroseconds();
        }
        const value = slot.value_ptr.*;
        if (!value.on_air) return null;
        return .{
            .stream_url = source.stream_url,
            .kind = source.kind,
            .started_at = if (value.started_at) |text| try arena.dupe(u8, text) else null,
            .artwork_url = if (value.artwork_url) |text| try arena.dupe(u8, text) else null,
        };
    }

    fn release(self: *Probe, value: Cached) void {
        if (value.started_at) |text| self.allocator.free(text);
        if (value.artwork_url) |text| self.allocator.free(text);
    }

    fn probe(self: *Probe, source: LiveSource) Cached {
        var arena_state = std.heap.ArenaAllocator.init(self.allocator);
        defer arena_state.deinit();
        const arena = arena_state.allocator();
        var transport = zat.HttpTransport.initWithUserAgent(self.io, arena, user_agent);
        defer transport.deinit();

        const off_air: Cached = .{ .checked_us = 0, .on_air = false };
        const health = fetch(&transport, source.health_url, "application/json") orelse {
            log.warn("live health probe failed for {s}, treating as off air", .{source.health_url});
            return off_air;
        };
        const status = parseHealth(arena, health) orelse return off_air;
        if (!status.live) {
            // a broadcaster can report itself down while its playlist keeps
            // advancing (seen 2026-07-30); the playlist is what a listener
            // actually plays, so it gets the last word
            const playlist = fetch(&transport, source.stream_url, "application/vnd.apple.mpegurl") orelse return off_air;
            const now_us = std.Io.Timestamp.now(self.io, .real).toMicroseconds();
            if (!playlistAdvancing(playlist, now_us)) return off_air;
            log.info("broadcaster reports down but its playlist is live, airing it", .{});
        }
        return .{
            .checked_us = 0,
            .on_air = true,
            .started_at = if (status.started_at) |text| self.allocator.dupe(u8, text) catch null else null,
            .artwork_url = if (status.artwork_url) |text| self.allocator.dupe(u8, text) catch null else null,
        };
    }
};

fn fetch(transport: *zat.HttpTransport, url: []const u8, accept: []const u8) ?[]const u8 {
    const result = transport.fetch(.{
        .url = url,
        .accept = accept,
        .max_response_size = 256 * 1024,
        .on_redirect = .refuse,
        .deadline_ns = probe_timeout_ns,
    }) catch return null;
    if (result.status != .ok) return null;
    // the transport allocates from the probe's arena, freed with it
    return result.body;
}

pub const Health = struct {
    live: bool,
    started_at: ?[]const u8 = null,
    artwork_url: ?[]const u8 = null,
};

pub fn parseHealth(arena: std.mem.Allocator, body: []const u8) ?Health {
    const value = std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{}) catch return null;
    if (value != .object) return null;
    const live = value.object.get("live") orelse std.json.Value{ .bool = false };
    return .{
        .live = live == .bool and live.bool,
        .started_at = nonEmptyString(value, "started_at"),
        // the broadcaster owns its artwork: a sonification renders a cover per interval
        .artwork_url = httpsString(value, "artwork_url"),
    };
}

fn nonEmptyString(value: std.json.Value, key: []const u8) ?[]const u8 {
    const field = value.object.get(key) orelse return null;
    if (field != .string or field.string.len == 0 or field.string.len > 512) return null;
    return field.string;
}

fn httpsString(value: std.json.Value, key: []const u8) ?[]const u8 {
    const text = nonEmptyString(value, key) orelse return null;
    return if (std.mem.startsWith(u8, text, "https://")) text else null;
}

/// Ground truth for "can someone hear this now": a live playlist has no
/// ENDLIST and stamps each segment with wall-clock time; a recent newest
/// stamp means audio exists.
pub fn playlistAdvancing(body: []const u8, now_us: i64) bool {
    if (std.mem.indexOf(u8, body, "#EXT-X-ENDLIST") != null) return false;
    const tag = "#EXT-X-PROGRAM-DATE-TIME:";
    var newest: ?i64 = null;
    var lines = std.mem.splitScalar(u8, body, '\n');
    while (lines.next()) |raw| {
        const line = std.mem.trim(u8, raw, " \r\t");
        if (!std.mem.startsWith(u8, line, tag)) continue;
        newest = parseTimestampUs(line[tag.len..]);
    }
    const stamp = newest orelse return false;
    return now_us - stamp <= segment_freshness_us;
}

/// `YYYY-MM-DDTHH:MM:SS[.fff…](Z|±HH:MM)` to unix microseconds.
pub fn parseTimestampUs(text: []const u8) ?i64 {
    if (text.len < 20 or text[4] != '-' or text[7] != '-' or (text[10] != 'T' and text[10] != ' ') or
        text[13] != ':' or text[16] != ':') return null;
    const year = std.fmt.parseInt(i64, text[0..4], 10) catch return null;
    const month = std.fmt.parseInt(u8, text[5..7], 10) catch return null;
    const day = std.fmt.parseInt(u8, text[8..10], 10) catch return null;
    const hour = std.fmt.parseInt(i64, text[11..13], 10) catch return null;
    const minute = std.fmt.parseInt(i64, text[14..16], 10) catch return null;
    const second = std.fmt.parseInt(i64, text[17..19], 10) catch return null;
    if (month < 1 or month > 12 or day < 1 or day > 31 or hour > 23 or minute > 59 or second > 60) return null;
    var rest = text[19..];
    var fraction_us: i64 = 0;
    if (rest.len > 0 and rest[0] == '.') {
        var digits: usize = 1;
        var scale: i64 = 100_000;
        while (digits < rest.len and std.ascii.isDigit(rest[digits])) : (digits += 1) {
            fraction_us += (rest[digits] - '0') * scale;
            scale = @divTrunc(scale, 10);
        }
        if (digits == 1) return null;
        rest = rest[digits..];
    }
    var offset_seconds: i64 = 0;
    if (std.mem.eql(u8, rest, "Z") or std.mem.eql(u8, rest, "z")) {} else if (rest.len == 6 and (rest[0] == '+' or rest[0] == '-') and rest[3] == ':') {
        const offset_hours = std.fmt.parseInt(i64, rest[1..3], 10) catch return null;
        const offset_minutes = std.fmt.parseInt(i64, rest[4..6], 10) catch return null;
        offset_seconds = (offset_hours * 60 + offset_minutes) * 60;
        if (rest[0] == '-') offset_seconds = -offset_seconds;
    } else return null;
    // days from civil (Howard Hinnant)
    const y = if (month <= 2) year - 1 else year;
    const era = @divFloor(y, 400);
    const yoe = y - era * 400;
    const m: i64 = month;
    const doy = @divFloor(153 * (if (m > 2) m - 3 else m + 9) + 2, 5) + day - 1;
    const doe = yoe * 365 + @divFloor(yoe, 4) - @divFloor(yoe, 100) + doy;
    const days = era * 146097 + doe - 719468;
    const seconds = ((days * 24 + hour) * 60 + minute) * 60 + second - offset_seconds;
    return seconds * std.time.us_per_s + fraction_us;
}

test "timestamps parse with fractions and offsets" {
    try std.testing.expectEqual(@as(?i64, 0), parseTimestampUs("1970-01-01T00:00:00Z"));
    try std.testing.expectEqual(@as(?i64, 1_500_000), parseTimestampUs("1970-01-01T00:00:01.5Z"));
    try std.testing.expectEqual(@as(?i64, 3600 * std.time.us_per_s), parseTimestampUs("1970-01-01T02:00:00+01:00"));
    try std.testing.expectEqual(@as(?i64, 1_795_239_898_843_000), parseTimestampUs("2026-11-21T05:44:58.843Z"));
    try std.testing.expect(parseTimestampUs("2026-11-21") == null);
    try std.testing.expect(parseTimestampUs("2026-11-21T05:44:58") == null);
}

test "a playlist is live only while its newest segment is recent and it hasn't ended" {
    const playlist =
        \\#EXTM3U
        \\#EXT-X-TARGETDURATION:4
        \\#EXT-X-PROGRAM-DATE-TIME:2026-11-21T05:44:50.000Z
        \\#EXTINF:4.0,
        \\seg1.ts
        \\#EXT-X-PROGRAM-DATE-TIME:2026-11-21T05:44:54.000Z
        \\#EXTINF:4.0,
        \\seg2.ts
    ;
    const newest = parseTimestampUs("2026-11-21T05:44:54Z").?;
    try std.testing.expect(playlistAdvancing(playlist, newest + 10 * std.time.us_per_s));
    try std.testing.expect(!playlistAdvancing(playlist, newest + 60 * std.time.us_per_s));
    try std.testing.expect(!playlistAdvancing(playlist ++ "\n#EXT-X-ENDLIST\n", newest));
    try std.testing.expect(!playlistAdvancing("#EXTM3U\nseg.ts\n", newest));
}

test "health answers keep only what we trust" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const on = parseHealth(arena.allocator(), "{\"live\":true,\"started_at\":\"2026-11-21T05:00:00Z\",\"artwork_url\":\"https://relay-eval.waow.tech/sonify/cover.png\"}").?;
    try std.testing.expect(on.live);
    try std.testing.expectEqualStrings("https://relay-eval.waow.tech/sonify/cover.png", on.artwork_url.?);
    const odd = parseHealth(arena.allocator(), "{\"live\":\"yes\",\"artwork_url\":\"http://x\"}").?;
    try std.testing.expect(!odd.live);
    try std.testing.expect(odd.artwork_url == null);
    try std.testing.expect(parseHealth(arena.allocator(), "[]") == null);
}
