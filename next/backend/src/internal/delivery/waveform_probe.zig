//! Waveform prober.
//!
//! Clients draw a track's playing bars from how loud its bass, mids and
//! treble are over time. This worker downloads each public track version's
//! audio with HTTP ranges, decodes it with ffmpeg into four bands
//! (`waveform.zig`) and stores the levels for that record version. It sweeps
//! every track without levels, newest first, so the backfill and new uploads
//! share one queue.
//!
//! Only public audio is fetched, the way the duration prober does: the
//! mirrored copy, else the record's https `audioUrl`, at a pinned, checked
//! public address with redirects refused. ffmpeg reads only the local copy,
//! through the demuxers uploads admit.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const pinned_tls = @import("../net/pinned_tls.zig");
const safe_endpoint = @import("../net/safe_endpoint.zig");
const duration_probe = @import("duration_probe.zig");
const waveform = @import("waveform.zig");
const store_module = @import("postgres_waveform_store.zig");

const Io = std.Io;
const log = std.log.scoped(.waveform_probe);

const user_agent = "plyr.fm-zig-waveform-probe/0.1 (+https://plyr.fm)";
const window_bytes: u64 = 4 * 1024 * 1024;
/// the largest audio file worth decoding for bars
const max_audio_bytes: u64 = 400 * 1024 * 1024;
const batch_size: u32 = 4;
const sweep_ms: i64 = 60_000;
const decode_timeout: Io.Duration = .fromSeconds(300);

/// Decoding runs at low priority on one thread so ingestion keeps its pace.
const decoder_args = [_][]const u8{
    "nice",                                        "-n",        "10",
    "ffmpeg",                                      "-nostdin",  "-v",
    "error",                                       "-threads",  "1",
    "-protocol_whitelist",                         "file,pipe", "-format_whitelist",
    "mp3,wav,flac,ogg,mov,aac,aiff,matroska,webm",
};
const decoder_output_args = [_][]const u8{
    "-filter_complex", waveform.filter, "-map", "[out]", "-f", "s16le", "pipe:1",
};

/// Runs the prober on a detached thread beside another worker (the ingester).
pub fn spawnBeside(io: Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    const thread = std.Thread.spawn(.{}, backgroundMain, .{ io, allocator, pool }) catch |err| {
        log.err("waveform prober disabled, thread spawn failed: {}", .{err});
        return;
    };
    thread.detach();
}

fn backgroundMain(io: Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    run(io, allocator, pool) catch |err| log.err("waveform prober stopped: {}", .{err});
}

fn run(io: Io, allocator: std.mem.Allocator, pool: *pg.Pool) !void {
    var transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer transport.deinit();
    var worker: Worker = .{ .io = io, .allocator = allocator, .store = .{ .pool = pool }, .transport = &transport };
    while (true) {
        const attempted = worker.batch() catch |err| blk: {
            log.err("waveform batch failed: {}", .{err});
            break :blk 0;
        };
        if (attempted == 0) try io.sleep(Io.Duration.fromMilliseconds(sweep_ms), .awake);
    }
}

const Worker = struct {
    io: Io,
    allocator: std.mem.Allocator,
    store: store_module.PostgresWaveformStore,
    transport: *zat.HttpTransport,

    /// Returns how many candidates were attempted.
    fn batch(self: *Worker) !usize {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const items = try self.store.candidates(arena.allocator(), try nowMicros(self.io), batch_size);
        for (items) |candidate| {
            if (self.measure(candidate.audio_url)) |levels| {
                defer self.allocator.free(levels.levels);
                const measured: store_module.Waveform = .{ .fps = levels.fps, .bands = waveform.bands, .levels = levels.levels };
                if (try self.store.recordMeasured(candidate, measured, try nowMicros(self.io)))
                    log.info("measured {s}: {d} frames at {d} fps", .{ candidate.record_uri, levels.levels.len / waveform.bands, levels.fps })
                else
                    log.info("record moved on during probe: {s}", .{candidate.record_uri});
            } else |err| {
                log.warn("waveform probe failed for {s}: {}", .{ candidate.record_uri, err });
                try self.store.recordFailure(candidate, @errorName(err), try nowMicros(self.io));
            }
        }
        return items.len;
    }

    /// The levels, owned by `self.allocator`.
    fn measure(self: *Worker, url: []const u8) !waveform.Levels {
        var name_buffer: [64]u8 = undefined;
        var random: [8]u8 = undefined;
        self.io.random(&random);
        const name = try std.fmt.bufPrint(&name_buffer, "plyr-waveform-{x}", .{random});
        var scratch = try Io.Dir.cwd().openDir(self.io, if (std.c.getenv("TMPDIR")) |raw| std.mem.span(raw) else "/tmp", .{});
        defer scratch.close(self.io);
        defer scratch.deleteFile(self.io, name) catch |err| log.err("waveform scratch cleanup failed: {}", .{err});
        try self.download(url, scratch, name);
        return decode(self.io, self.allocator, scratch, name);
    }

    fn download(self: *Worker, url: []const u8, directory: Io.Dir, name: []const u8) !void {
        var endpoint = try safe_endpoint.resolve(self.io, self.allocator, try duration_probe.origin(url));
        defer endpoint.deinit(self.allocator);
        try pinned_tls.prepare(self.io, self.transport);
        var file = try directory.createFile(self.io, name, .{});
        defer file.close(self.io);
        var write_buffer: [64 * 1024]u8 = undefined;
        var writer = file.writer(self.io, &write_buffer);
        var offset: u64 = 0;
        while (true) {
            var result = try self.read(url, endpoint, offset);
            defer result.result.deinit(self.transport.allocator);
            if (result.span.total > max_audio_bytes) return error.AudioTooLarge;
            try writer.interface.writeAll(result.result.body);
            offset += result.result.body.len;
            if (offset >= result.span.total) break;
        }
        try writer.interface.flush();
    }

    const Window = struct { result: zat.HttpTransport.FetchResult, span: duration_probe.Span };

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
            .deadline_ns = 120 * std.time.ns_per_s,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.AudioUnavailable,
        };
        errdefer result.deinit(self.transport.allocator);
        if (result.status != .partial_content) return error.RangeUnsupported;
        const content_range = for (result.headers.entries) |header| {
            if (std.ascii.eqlIgnoreCase(header.name, "content-range")) break header.value;
        } else return error.RangeUnsupported;
        const span = duration_probe.parseContentRange(content_range) orelse return error.RangeUnsupported;
        if (span.first != offset or span.length != result.body.len or span.length == 0) return error.RangeUnsupported;
        return .{ .result = result, .span = span };
    }
};

/// Decodes the file `name` in `directory` into levels, owned by `allocator`.
/// ffmpeg is killed if it runs past its deadline.
pub fn decode(io: Io, allocator: std.mem.Allocator, directory: Io.Dir, name: []const u8) !waveform.Levels {
    var levels: waveform.Levels = undefined;
    const Race = union(enum) { done: anyerror!void, expired: Io.Cancelable!void };
    var buffer: [2]Race = undefined;
    var race: Io.Select(Race) = .init(io, &buffer);
    defer race.cancelDiscard();
    try race.concurrent(.done, decodeInto, .{ io, allocator, directory, name, &levels });
    try race.concurrent(.expired, Io.sleep, .{ io, decode_timeout, .awake });
    switch (try race.await()) {
        .done => |result| try result,
        .expired => return error.DecodeTimeout,
    }
    return levels;
}

fn decodeInto(io: Io, allocator: std.mem.Allocator, directory: Io.Dir, name: []const u8, out: *waveform.Levels) anyerror!void {
    var child = try std.process.spawn(io, .{
        .argv = &(decoder_args ++ .{ "-i", name } ++ decoder_output_args),
        .cwd = .{ .dir = directory },
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    // a canceled or failed decode never leaves ffmpeg running
    defer child.kill(io);
    var analyzer: waveform.Analyzer = .{};
    defer analyzer.deinit(allocator);
    var buffer: [64 * 1024]u8 = undefined;
    while (true) {
        const count = child.stdout.?.readStreaming(io, &.{&buffer}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        try analyzer.feed(allocator, buffer[0..count]);
    }
    if (!(try child.wait(io)).success()) return error.DecodeFailed;
    out.* = try analyzer.finish(allocator);
}

fn nowMicros(io: Io) !i64 {
    const nanoseconds = Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse error.InvalidSystemClock;
}

test "ffmpeg's bands decode into levels" {
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    // two seconds of a 110 Hz tone that sounds for the first second only
    var generator = std.process.spawn(io, .{
        .argv = &.{ "ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=f=110:d=2", "-af", "volume='if(lt(t,1),1,0)':eval=frame", "-f", "mp3", "tone.mp3" },
        .cwd = .{ .dir = tmp.dir },
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
    }) catch |err| switch (err) {
        error.FileNotFound => return error.SkipZigTest,
        else => return err,
    };
    if (!(try generator.wait(io)).success()) return error.SkipZigTest;

    const levels = try decode(io, allocator, tmp.dir, "tone.mp3");
    defer allocator.free(levels.levels);
    try std.testing.expectEqual(@as(u8, 20), levels.fps);
    const frames = levels.levels.len / waveform.bands;
    try std.testing.expect(frames >= 39 and frames <= 42);
    // the bass band carries the tone and goes quiet after a second
    try std.testing.expect(levels.levels[10 * waveform.bands] > 200);
    try std.testing.expectEqual(@as(u8, 0), levels.levels[30 * waveform.bands]);
    // the treble band hears nothing of a 110 Hz tone
    try std.testing.expect(levels.levels[10 * waveform.bands + 3] < 64);
}

test {
    _ = waveform;
    _ = store_module;
}
