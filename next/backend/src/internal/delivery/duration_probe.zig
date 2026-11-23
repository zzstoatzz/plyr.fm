//! Duration prober.
//!
//! Some track records leave `duration` out: prod's early uploads never wrote
//! it, and a client that can't measure a file publishes without one. Without
//! it a track shows `-:--`, artist totals undercount, and radio skips it. This
//! worker reads the first bytes of each such version's public audio with HTTP
//! ranges (`audio_duration.zig` names any further window, e.g. an m4a's moov
//! at the end) and stores the running time for that record version. Reads
//! prefer the record's own duration and fall back to this one.
//!
//! Only public audio is fetched: the mirrored copy, else the record's https
//! `audioUrl`. That URL is the artist's to set, so every fetch pins a checked
//! public address and refuses redirects.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const pinned_tls = @import("../net/pinned_tls.zig");
const safe_endpoint = @import("../net/safe_endpoint.zig");
const audio_duration = @import("audio_duration.zig");
const store_module = @import("postgres_duration_store.zig");

const log = std.log.scoped(.duration_probe);

const user_agent = "plyr.fm-zig-duration-probe/0.1 (+https://plyr.fm)";
const window_bytes: u64 = 256 * 1024;
const max_reads = 4;
const batch_size: u32 = 8;
const sweep_ms: i64 = 60_000;

/// Runs the prober on a detached thread beside another worker (the ingester).
pub fn spawnBeside(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    const thread = std.Thread.spawn(.{}, backgroundMain, .{ io, allocator, pool }) catch |err| {
        log.err("duration prober disabled, thread spawn failed: {}", .{err});
        return;
    };
    thread.detach();
}

fn backgroundMain(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    run(io, allocator, pool) catch |err| log.err("duration prober stopped: {}", .{err});
}

fn run(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) !void {
    var transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer transport.deinit();
    var worker: Worker = .{ .io = io, .allocator = allocator, .store = .{ .pool = pool }, .transport = &transport };
    while (true) {
        const attempted = worker.batch() catch |err| blk: {
            log.err("duration batch failed: {}", .{err});
            break :blk 0;
        };
        if (attempted == 0) try io.sleep(std.Io.Duration.fromMilliseconds(sweep_ms), .awake);
    }
}

const Worker = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    store: store_module.PostgresDurationStore,
    transport: *zat.HttpTransport,

    /// Returns how many candidates were attempted.
    fn batch(self: *Worker) !usize {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const items = try self.store.candidates(arena.allocator(), try nowMicros(self.io), batch_size);
        for (items) |candidate| {
            if (self.measure(candidate.audio_url)) |seconds| {
                if (try self.store.recordMeasured(candidate, seconds, try nowMicros(self.io)))
                    log.info("measured {s}: {d}s", .{ candidate.record_uri, seconds })
                else
                    log.info("record moved on during probe: {s}", .{candidate.record_uri});
            } else |err| {
                log.warn("duration probe failed for {s}: {}", .{ candidate.record_uri, err });
                try self.store.recordFailure(candidate, @errorName(err), try nowMicros(self.io));
            }
        }
        return items.len;
    }

    fn measure(self: *Worker, url: []const u8) !u64 {
        var endpoint = try safe_endpoint.resolve(self.io, self.allocator, try origin(url));
        defer endpoint.deinit(self.allocator);
        try pinned_tls.prepare(self.io, self.transport);
        var format: audio_duration.Format = .unknown;
        var offset: u64 = 0;
        for (0..max_reads) |_| {
            var window = try self.read(url, endpoint, offset);
            defer window.deinit(self.transport.allocator);
            switch (audio_duration.step(format, window.bytes, offset, window.total)) {
                .seconds => |seconds| return seconds,
                .unsupported => return error.UnsupportedAudio,
                .read => |next| {
                    format = next.format;
                    offset = next.offset;
                },
            }
        }
        return error.UnsupportedAudio;
    }

    const Window = struct {
        result: zat.HttpTransport.FetchResult,
        bytes: []const u8,
        total: u64,

        fn deinit(self: *Window, allocator: std.mem.Allocator) void {
            self.result.deinit(allocator);
        }
    };

    fn read(self: *Worker, url: []const u8, endpoint: safe_endpoint.Endpoint, offset: u64) !Window {
        var range_buffer: [64]u8 = undefined;
        const range = try std.fmt.bufPrint(&range_buffer, "bytes={d}-{d}", .{ offset, offset + window_bytes - 1 });
        var result = self.transport.fetch(.{
            .url = url,
            .accept = "*/*",
            .accept_encoding = "identity",
            .extra_headers = &.{.{ .name = "range", .value = range }},
            .capture_headers = &.{"content-range"},
            .max_response_size = window_bytes,
            .on_redirect = .refuse,
            .resolved_connection = endpoint.connection(),
            .deadline_ns = 60 * std.time.ns_per_s,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.AudioUnavailable,
        };
        errdefer result.deinit(self.transport.allocator);
        // only a ranged answer says how big the file is
        if (result.status != .partial_content) return error.RangeUnsupported;
        const content_range = for (result.headers.entries) |header| {
            if (std.ascii.eqlIgnoreCase(header.name, "content-range")) break header.value;
        } else return error.RangeUnsupported;
        const span = parseContentRange(content_range) orelse return error.RangeUnsupported;
        if (span.first != offset or span.length != result.body.len) return error.RangeUnsupported;
        return .{ .result = result, .bytes = result.body, .total = span.total };
    }
};

/// `scheme://host[:port]` of an https URL, for endpoint resolution.
pub fn origin(url: []const u8) ![]const u8 {
    if (!std.ascii.startsWithIgnoreCase(url, "https://")) return error.InvalidAudioUrl;
    const rest = url["https://".len..];
    const end = std.mem.indexOfAny(u8, rest, "/?#") orelse rest.len;
    if (end == 0) return error.InvalidAudioUrl;
    return url[0 .. "https://".len + end];
}

pub const Span = struct { first: u64, length: usize, total: u64 };

/// `bytes first-last/total`; an unknown total (`*`) isn't enough to measure.
pub fn parseContentRange(value: []const u8) ?Span {
    const text = std.mem.trim(u8, value, " ");
    if (!std.ascii.startsWithIgnoreCase(text, "bytes ")) return null;
    const rest = text["bytes ".len..];
    const dash = std.mem.indexOfScalar(u8, rest, '-') orelse return null;
    const slash = std.mem.indexOfScalar(u8, rest, '/') orelse return null;
    if (slash < dash) return null;
    const first = std.fmt.parseInt(u64, rest[0..dash], 10) catch return null;
    const last = std.fmt.parseInt(u64, rest[dash + 1 .. slash], 10) catch return null;
    const total = std.fmt.parseInt(u64, rest[slash + 1 ..], 10) catch return null;
    if (last < first or last >= total) return null;
    return .{ .first = first, .length = std.math.cast(usize, last - first + 1) orelse return null, .total = total };
}

fn nowMicros(io: std.Io) !i64 {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse error.InvalidSystemClock;
}

test "content ranges must name a known total" {
    try std.testing.expectEqual(Span{ .first = 0, .length = 262144, .total = 7498231 }, parseContentRange("bytes 0-262143/7498231").?);
    try std.testing.expectEqual(Span{ .first = 7400000, .length = 98231, .total = 7498231 }, parseContentRange("bytes 7400000-7498230/7498231").?);
    try std.testing.expect(parseContentRange("bytes 0-262143/*") == null);
    try std.testing.expect(parseContentRange("bytes 10-5/100") == null);
    try std.testing.expect(parseContentRange("bytes 0-100/100") == null);
    try std.testing.expect(parseContentRange("items 0-1/2") == null);
}

test "the endpoint resolved is the audio URL's own origin" {
    try std.testing.expectEqualStrings("https://audio.plyr.fm", try origin("https://audio.plyr.fm/audio/7c965a515525b2fe.mp3"));
    try std.testing.expectEqualStrings("https://cdn.example:8443", try origin("https://cdn.example:8443/a?b"));
    try std.testing.expectError(error.InvalidAudioUrl, origin("http://audio.plyr.fm/a.mp3"));
    try std.testing.expectError(error.InvalidAudioUrl, origin("https:///a.mp3"));
}

test {
    _ = audio_duration;
    _ = store_module;
}
