//! One attempt's bytes: pull the retained source into scratch, encode the
//! MP3 rendition with ffmpeg, probe its duration, and upload it back as
//! sequential 10 MiB parts. Nothing is ever held whole in memory, and the
//! scratch directory is removed however the attempt ends.

const std = @import("std");
const builtin = @import("builtin");
const attempt_module = @import("attempt.zig");
const runner_module = @import("runner.zig");

const Io = std.Io;
const Attempt = attempt_module.Attempt;
const Runner = runner_module.Runner;
const Sha256 = std.crypto.hash.sha2.Sha256;
const log = std.log.scoped(.processing);

const part_bytes = attempt_module.part_bytes;
const probe_timeout: Io.Duration = .fromSeconds(15);
const part_timeout: Io.Duration = .fromSeconds(120);
const complete_timeout: Io.Duration = .fromSeconds(30);

/// The encoder: only local file/pipe protocols and the demuxers the upload
/// contract admits, so playlists, concat manifests and MOV external
/// references cannot make ffmpeg open anything else.
pub const encoder_args = [_][]const u8{
    "ffmpeg",              "-nostdin",
    "-v",                  "error",
    "-protocol_whitelist", "file,pipe",
    "-format_whitelist",   "mp3,wav,flac,ogg,mov,aac,aiff,matroska,webm",
};
const encoder_output_args = [_][]const u8{
    "-map", "0:a:0", "-vn", "-acodec", "libmp3lame", "-b:a", "320k",
    "-ar",  "44100", "-f",  "mp3",     "pipe:1",
};
const probe_args = [_][]const u8{
    "ffprobe",             "-v",                                 "error",
    "-protocol_whitelist", "file,pipe",                          "-format_whitelist",
    "mp3",                 "-show_entries",                      "format=duration",
    "-of",                 "default=noprint_wrappers=1:nokey=1",
};

pub fn process(r: *Runner, attempt: Attempt) anyerror!void {
    const io = r.io;
    var name_buffer: [128]u8 = undefined;
    var random: [8]u8 = undefined;
    io.random(&random);
    const name = try std.fmt.bufPrint(&name_buffer, "next-processing-{s}-{d}-{x}", .{ attempt.uploadId, attempt.generation, random });
    var parent = try Io.Dir.cwd().openDir(io, r.scratch, .{});
    defer parent.close(io);
    var directory = try parent.createDirPathOpen(io, name, .{});
    defer {
        // cleanup runs even when the attempt was canceled
        const protection = io.swapCancelProtection(.blocked);
        defer _ = io.swapCancelProtection(protection);
        directory.close(io);
        parent.deleteTree(io, name) catch |err| log.err("scratch cleanup failed dir={s} error={s}", .{ name, @errorName(err) });
    }

    const available = try availableBytes(directory);
    log.info("processing scratch baseline upload_id={s} generation={d} scratch_available_bytes={d}", .{ attempt.uploadId, attempt.generation, available });
    try requireScratch(available, attempt.sourceBytes, attempt.outputBudget);

    const started = Io.Clock.awake.now(io);
    try download(r, attempt, directory);
    const downloaded = Io.Clock.awake.now(io);
    const encoded = encode(io, directory, "source", "rendition.mp3", attempt.outputBudget);
    const output_bytes: u64 = if (directory.statFile(io, "rendition.mp3", .{})) |stat| stat.size else |_| 0;
    log.info("processing scratch peak upload_id={s} generation={d} owned_scratch_peak_file_bytes={d}", .{ attempt.uploadId, attempt.generation, attempt.sourceBytes + output_bytes });
    try encoded;
    const encode_done = Io.Clock.awake.now(io);
    const seconds = try duration(io, directory, "rendition.mp3");
    try upload(r, attempt, directory, "rendition.mp3", seconds);
    // one line per finished job: what a quota or a bill would count
    log.info("processing usage upload_id={s} generation={d} recipe={s} source_bytes={d} output_bytes={d} duration_s={d} download_ms={d} encode_ms={d} total_ms={d}", .{
        attempt.uploadId,                                attempt.generation,                                  attempt.recipe,
        attempt.sourceBytes,                             output_bytes,                                        seconds,
        started.durationTo(downloaded).toMilliseconds(), downloaded.durationTo(encode_done).toMilliseconds(), started.durationTo(Io.Clock.awake.now(io)).toMilliseconds(),
    });
}

/// The whole admitted source and output budget must fit before a byte is read.
pub fn requireScratch(available: u64, source: u64, output: u64) !void {
    const needed = std.math.add(u64, source, output) catch return error.InvalidReservation;
    if (available < needed) return error.InsufficientScratch;
}

fn availableBytes(directory: Io.Dir) !u64 {
    if (builtin.os.tag != .linux) return std.math.maxInt(u64);
    const linux = std.os.linux;
    // struct statfs on 64-bit linux: f_type, f_bsize, f_blocks, f_bfree, f_bavail, ...
    var buffer: [15]u64 = undefined;
    const rc = linux.syscall2(.fstatfs, @as(usize, @bitCast(@as(isize, directory.handle))), @intFromPtr(&buffer));
    if (linux.errno(rc) != .SUCCESS) return error.ScratchUnavailable;
    return std.math.mul(u64, buffer[4], buffer[1]) catch std.math.maxInt(u64);
}

// -- source

fn download(r: *Runner, attempt: Attempt, directory: Io.Dir) anyerror!void {
    var progress: std.atomic.Value(u64) = .init(0);
    const Race = union(enum) { transfer: anyerror!void, stalled: anyerror!void };
    var buffer: [2]Race = undefined;
    var race: Io.Select(Race) = .init(r.io, &buffer);
    defer race.cancelDiscard();
    try race.concurrent(.transfer, pull, .{ r, attempt, directory, &progress });
    try race.concurrent(.stalled, watchdog, .{ r.io, r.stall_timeout, &progress });
    return switch (try race.await()) {
        inline else => |result| result,
    };
}

/// Fails once a whole interval passes with no new source bytes, which covers
/// a connect, a head or a body read that never answers.
fn watchdog(io: Io, interval: Io.Duration, progress: *std.atomic.Value(u64)) anyerror!void {
    var last: u64 = std.math.maxInt(u64);
    while (true) {
        try io.sleep(interval, .awake);
        const now = progress.load(.monotonic);
        if (now == last) return error.SourceStalled;
        last = now;
    }
}

fn pull(r: *Runner, attempt: Attempt, directory: Io.Dir, progress: *std.atomic.Value(u64)) anyerror!void {
    const io = r.io;
    var url_buffer: [1024]u8 = undefined;
    const uri = try std.Uri.parse(try r.url(&url_buffer, attempt, "source"));
    var bearer_buffer: [4200]u8 = undefined;
    var request = try r.client.request(.GET, uri, .{
        .keep_alive = false,
        .redirect_behavior = .unhandled,
        .headers = .{
            .authorization = .{ .override = try std.fmt.bufPrint(&bearer_buffer, "Bearer {s}", .{attempt.capability}) },
            .accept_encoding = .omit,
        },
    });
    defer request.deinit();
    try request.sendBodiless();
    var response = try request.receiveHead(&.{});
    _ = progress.fetchAdd(1, .monotonic);
    if (response.head.status.class() != .success) return error.CallbackRejected;
    if (response.head.content_length != attempt.sourceBytes) return error.SourceLengthMismatch;

    var file = try directory.createFile(io, "source", .{});
    defer file.close(io);
    var write_buffer: [64 * 1024]u8 = undefined;
    var writer = file.writer(io, &write_buffer);
    var transfer_buffer: [64 * 1024]u8 = undefined;
    const body = response.reader(&transfer_buffer);
    var size: u64 = 0;
    while (true) {
        const chunk = body.peekGreedy(1) catch |err| switch (err) {
            error.EndOfStream => break,
            error.ReadFailed => return response.bodyErr() orelse error.SourceUnavailable,
        };
        size += chunk.len;
        if (size > attempt.sourceBytes) return error.SourceExceedsReservation;
        try writer.interface.writeAll(chunk);
        body.toss(chunk.len);
        _ = progress.fetchAdd(chunk.len, .monotonic);
    }
    if (size != attempt.sourceBytes) return error.IncompleteSource;
    try writer.interface.flush();
}

// -- encoder

/// Encodes `input` to `output`, refusing to write past `budget`: a
/// rendition over its budget fails as a whole, never as a truncated success.
pub fn encode(io: Io, directory: Io.Dir, input: []const u8, output: []const u8, budget: u64) anyerror!void {
    var child = try std.process.spawn(io, .{
        .argv = &(encoder_args ++ .{ "-i", input } ++ encoder_output_args),
        .cwd = .{ .dir = directory },
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    // a canceled or failed encode never leaves ffmpeg running
    defer child.kill(io);
    var file = try directory.createFile(io, output, .{});
    defer file.close(io);
    const size = try copyBounded(io, child.stdout.?, file, budget);
    const term = try child.wait(io);
    if (!term.success() or size == 0) return error.EncodingFailed;
}

pub fn copyBounded(io: Io, source: Io.File, destination: Io.File, budget: u64) anyerror!u64 {
    var buffer: [64 * 1024]u8 = undefined;
    var write_buffer: [64 * 1024]u8 = undefined;
    var writer = destination.writer(io, &write_buffer);
    var size: u64 = 0;
    while (true) {
        const count = source.readStreaming(io, &.{&buffer}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        size += count;
        if (size > budget) return error.OutputBudgetExceeded;
        try writer.interface.writeAll(buffer[0..count]);
    }
    try writer.interface.flush();
    return size;
}

// -- duration

/// The rendition's running time in whole seconds, from ffprobe, with its own
/// deadline and at most 64 bytes of output.
pub fn duration(io: Io, directory: Io.Dir, path: []const u8) anyerror!u32 {
    var seconds: u32 = 0;
    try runner_module.timed(io, probe_timeout, probe, .{ io, directory, path, &seconds });
    return seconds;
}

fn probe(io: Io, directory: Io.Dir, path: []const u8, seconds: *u32) anyerror!void {
    var child = try std.process.spawn(io, .{
        .argv = &(probe_args ++ .{path}),
        .cwd = .{ .dir = directory },
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
    });
    defer child.kill(io);
    var output: [65]u8 = undefined;
    var length: usize = 0;
    while (length < output.len) {
        length += child.stdout.?.readStreaming(io, &.{output[length..]}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
    }
    if (length > 64) return error.ProbeOutputTooLong;
    if (!(try child.wait(io)).success()) return error.DurationUnavailable;
    seconds.* = try parseSeconds(output[0..length]);
}

pub fn parseSeconds(text: []const u8) !u32 {
    const value = std.fmt.parseFloat(f64, std.mem.trim(u8, text, " \t\r\n")) catch return error.InvalidDuration;
    if (!std.math.isFinite(value) or value <= 0) return error.InvalidDuration;
    const rounded = @round(value);
    if (rounded > std.math.maxInt(u32)) return error.InvalidDuration;
    return @intFromFloat(rounded);
}

// -- rendition upload

pub fn upload(r: *Runner, attempt: Attempt, directory: Io.Dir, path: []const u8, seconds: u32) anyerror!void {
    const io = r.io;
    var file = try directory.openFile(io, path, .{});
    defer file.close(io);
    const size = try file.length(io);
    if (size > attempt.outputBudget) return error.OutputBudgetExceeded;
    if (size == 0) return error.InvalidRenditionSize;

    var arena = std.heap.ArenaAllocator.init(r.gpa);
    defer arena.deinit();
    const a = arena.allocator();
    const bytes = try a.alloc(u8, @min(size, part_bytes));
    const Receipt = struct { number: usize, sha256: []const u8 };
    var parts: std.ArrayList(Receipt) = .empty;
    var offset: u64 = 0;
    while (offset < size) {
        const length: usize = @intCast(@min(size - offset, part_bytes));
        if (try file.readPositionalAll(io, bytes[0..length], offset) != length) return error.RenditionShortRead;
        var digest: [Sha256.digest_length]u8 = undefined;
        Sha256.hash(bytes[0..length], &digest, .{});
        const hex = try a.dupe(u8, &std.fmt.bytesToHex(digest, .lower));
        const number = parts.items.len + 1;
        var action_buffer: [32]u8 = undefined;
        const action = try std.fmt.bufPrint(&action_buffer, "parts/{d}", .{number});
        try runner_module.timed(io, part_timeout, Runner.callback, .{
            r,                                                               attempt, .PUT, action, bytes[0..length], "application/octet-stream",
            &[_]std.http.Header{.{ .name = "X-Part-SHA256", .value = hex }},
        });
        try parts.append(a, .{ .number = number, .sha256 = hex });
        offset += length;
    }
    const completion = try std.json.Stringify.valueAlloc(a, .{
        .sizeBytes = size,
        .duration = seconds,
        .contentType = "audio/mpeg",
        .parts = parts.items,
    }, .{});
    try runner_module.timed(io, complete_timeout, Runner.callback, .{ r, attempt, .POST, "complete", completion, "application/json", &.{} });
}

test "scratch must hold both the source and the rendition" {
    try requireScratch(300, 150, 150);
    try std.testing.expectError(error.InsufficientScratch, requireScratch(299, 150, 150));
    try std.testing.expectError(error.InvalidReservation, requireScratch(std.math.maxInt(u64), std.math.maxInt(u64), 1));
}

test "probe output parses to whole seconds" {
    try std.testing.expectEqual(@as(u32, 2), try parseSeconds("1.5\n"));
    try std.testing.expectEqual(@as(u32, 1), try parseSeconds(" 0.6 "));
    for ([_][]const u8{ "", "0", "-1", "nan", "inf", "N/A", "1e20" }) |bad|
        try std.testing.expectError(error.InvalidDuration, parseSeconds(bad));
}
