//! An audio file's running time, read from its first bytes.
//!
//! Track records may leave `duration` out (prod's early uploads never wrote
//! it, and a client that can't measure a file publishes without it), so the
//! duration prober measures the file itself. This module is the pure part:
//! given a window of the file at some offset and the file's total size, it
//! either answers, names the next window to read, or gives up. It understands
//! MP3 (Xing/Info and VBRI headers, else constant bitrate), MP4/M4A (`mvhd`),
//! WAV (`data` over the byte rate) and FLAC (STREAMINFO).

const std = @import("std");
const audio_format = @import("../media/audio_format.zig");

/// The longest running time accepted; anything longer is a misread header.
pub const max_seconds: u64 = 48 * 3600;

pub const Format = enum { unknown, mp3, mp4 };

pub const Step = union(enum) {
    seconds: u64,
    /// Read the file again from `offset` and step on with `format`.
    read: struct { format: Format, offset: u64 },
    unsupported,
};

/// `window` is the file's bytes from `offset`; `total` is the file's size.
pub fn step(format: Format, window: []const u8, offset: u64, total: u64) Step {
    if (offset >= total or window.len == 0) return .unsupported;
    return switch (format) {
        .mp3 => mp3(window, offset, total),
        .mp4 => mp4(window, offset, total),
        .unknown => detect(window, offset, total),
    };
}

fn detect(window: []const u8, offset: u64, total: u64) Step {
    if (offset != 0 or window.len < 12) return .unsupported;
    // bytes that name no container may still be MP3 frames after junk, so
    // they get the MP3 frame scan; a container read here is never guessed at
    const format = audio_format.sniff(window) orelse return mp3(window, offset, total);
    return switch (format.container) {
        .mp3 => mp3(window, offset, total),
        .wav => wav(window, total),
        .flac => flac(window),
        .mp4 => mp4(window, offset, total),
        .adts, .aiff, .ogg, .webm => .unsupported,
    };
}

fn seconds(numerator: u128, denominator: u128) Step {
    if (denominator == 0 or numerator == 0) return .unsupported;
    const rounded = @max(1, (numerator + denominator / 2) / denominator);
    return if (rounded <= max_seconds) .{ .seconds = @intCast(rounded) } else .unsupported;
}

fn be32(bytes: []const u8) u32 {
    return std.mem.readInt(u32, bytes[0..4], .big);
}

fn le32(bytes: []const u8) u32 {
    return std.mem.readInt(u32, bytes[0..4], .little);
}

// ---- WAV: the data chunk's size over the format chunk's byte rate

fn wav(window: []const u8, total: u64) Step {
    var byte_rate: u32 = 0;
    var pos: usize = 12;
    while (pos + 8 <= window.len) {
        const size = le32(window[pos + 4 ..]);
        const body = pos + 8;
        if (std.mem.eql(u8, window[pos..][0..4], "fmt ")) {
            if (body + 12 > window.len) return .unsupported;
            byte_rate = le32(window[body + 8 ..]);
        } else if (std.mem.eql(u8, window[pos..][0..4], "data")) {
            // streamed writers leave the size 0 or all ones; the rest of the file is audio
            const bytes: u64 = if (size == 0 or size == std.math.maxInt(u32)) total -| body else @min(size, total -| body);
            return seconds(bytes, byte_rate);
        }
        pos = body + size + (size & 1);
    }
    return .unsupported;
}

// ---- FLAC: total samples over the sample rate, from STREAMINFO

fn flac(window: []const u8) Step {
    if (window.len < 26 or window[4] & 0x7f != 0) return .unsupported;
    const info = window[8..];
    const rate = (@as(u32, info[10]) << 12) | (@as(u32, info[11]) << 4) | (info[12] >> 4);
    const samples = (@as(u64, info[13] & 0x0f) << 32) | be32(info[14..]);
    return seconds(samples, rate);
}

// ---- MP4/M4A: the movie header's duration over its timescale

fn mp4(window: []const u8, offset: u64, total: u64) Step {
    var pos: usize = 0;
    while (pos + 8 <= window.len) {
        const header = boxHeader(window[pos..], offset + pos, total) orelse return .unsupported;
        if (std.mem.eql(u8, window[pos + 4 ..][0..4], "moov")) {
            const end = @min(window.len, pos + header.size);
            var child = pos + header.len;
            while (child + 8 <= end) {
                const inner = boxHeader(window[child..], offset + child, total) orelse return .unsupported;
                if (std.mem.eql(u8, window[child + 4 ..][0..4], "mvhd")) return mvhd(window[child + inner.len .. @min(end, child + inner.size)]);
                child += inner.size;
            }
            // mvhd is moov's first child in practice; if the window cut it off, read from the box
            return if (pos == 0) .unsupported else .{ .read = .{ .format = .mp4, .offset = offset + pos } };
        }
        if (pos + header.size > window.len) {
            const next = offset + pos + header.size;
            return if (next < total) .{ .read = .{ .format = .mp4, .offset = next } } else .unsupported;
        }
        pos += header.size;
    }
    return if (pos > 0 and offset + pos < total) .{ .read = .{ .format = .mp4, .offset = offset + pos } } else .unsupported;
}

const BoxHeader = struct { len: usize, size: usize };

fn boxHeader(bytes: []const u8, at: u64, total: u64) ?BoxHeader {
    const small = be32(bytes);
    const size: u64, const len: usize = switch (small) {
        0 => .{ total - at, 8 },
        1 => if (bytes.len < 16) return null else .{ std.mem.readInt(u64, bytes[8..16], .big), 16 },
        else => .{ small, 8 },
    };
    if (size < len or size > total - at) return null;
    return .{ .len = len, .size = std.math.cast(usize, size) orelse return null };
}

fn mvhd(body: []const u8) Step {
    if (body.len < 4) return .unsupported;
    if (body[0] == 1) {
        if (body.len < 32) return .unsupported;
        return seconds(std.mem.readInt(u64, body[24..32], .big), be32(body[20..]));
    }
    if (body.len < 20) return .unsupported;
    const duration = be32(body[16..]);
    if (duration == std.math.maxInt(u32)) return .unsupported;
    return seconds(duration, be32(body[12..]));
}

// ---- MP3: the Xing/Info or VBRI frame count, else the bitrate over the audio's size

const Frame = struct { version: u2, layer: u2, bitrate: u32, rate: u32, padding: u32, mono: bool };

fn mp3(window: []const u8, offset: u64, total: u64) Step {
    var pos: usize = 0;
    // an ID3v2 tag (cover art and all) comes before the audio
    if (window.len >= 10 and std.mem.eql(u8, window[0..3], "ID3")) {
        var size: u64 = 0;
        for (window[6..10]) |b| {
            if (b & 0x80 != 0) return .unsupported;
            size = (size << 7) | b;
        }
        size += if (window[5] & 0x10 != 0) 20 else 10;
        if (size + 1024 > window.len) {
            const next = offset + size;
            return if (next < total) .{ .read = .{ .format = .mp3, .offset = next } } else .unsupported;
        }
        pos = @intCast(size);
    }
    const limit = @min(window.len, pos + 64 * 1024);
    while (pos + 4 <= limit) : (pos += 1) {
        const frame = parseFrame(window[pos..][0..4]) orelse continue;
        const length = frameLength(frame);
        // a real frame is followed by another of the same kind
        if (pos + length + 4 <= window.len) {
            const next = parseFrame(window[pos + length ..][0..4]) orelse continue;
            if (next.version != frame.version or next.layer != frame.layer or next.rate != frame.rate) continue;
        }
        const spf = samplesPerFrame(frame);
        if (frameCount(window[pos..], frame)) |frames| return seconds(@as(u128, frames) * spf, frame.rate);
        return seconds(@as(u128, total - (offset + pos)) * 8, @as(u128, frame.bitrate) * 1000);
    }
    return .unsupported;
}

const bitrates = [5][14]u16{
    .{ 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448 }, // MPEG-1 layer I
    .{ 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384 }, // MPEG-1 layer II
    .{ 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320 }, // MPEG-1 layer III
    .{ 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256 }, // MPEG-2/2.5 layer I
    .{ 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160 }, // MPEG-2/2.5 layers II, III
};

fn parseFrame(h: *const [4]u8) ?Frame {
    if (h[0] != 0xff or h[1] & 0xe0 != 0xe0) return null;
    const version: u2 = @intCast((h[1] >> 3) & 3); // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layer: u2 = @intCast((h[1] >> 1) & 3); // 3 = I, 2 = II, 1 = III
    const bitrate_index = h[2] >> 4;
    const rate_index = (h[2] >> 2) & 3;
    if (version == 1 or layer == 0 or bitrate_index == 0 or bitrate_index == 15 or rate_index == 3) return null;
    const table: usize = if (version == 3) @as(usize, 3) - layer else if (layer == 3) 3 else 4;
    const rates = [3]u32{ 44100, 48000, 32000 };
    const base = rates[rate_index];
    return .{
        .version = version,
        .layer = layer,
        .bitrate = bitrates[table][bitrate_index - 1],
        .rate = switch (version) {
            3 => base,
            2 => base / 2,
            else => base / 4,
        },
        .padding = (h[2] >> 1) & 1,
        .mono = h[3] >> 6 == 3,
    };
}

fn samplesPerFrame(frame: Frame) u32 {
    return switch (frame.layer) {
        3 => 384,
        2 => 1152,
        else => if (frame.version == 3) 1152 else 576,
    };
}

fn frameLength(frame: Frame) usize {
    if (frame.layer == 3) return (12 * frame.bitrate * 1000 / frame.rate + frame.padding) * 4;
    return samplesPerFrame(frame) / 8 * frame.bitrate * 1000 / frame.rate + frame.padding;
}

/// The frame count a VBR header in the first frame states, if it has one.
fn frameCount(bytes: []const u8, frame: Frame) ?u32 {
    const side: usize = if (frame.version == 3) (if (frame.mono) 17 else 32) else (if (frame.mono) 9 else 17);
    const xing = 4 + side;
    if (bytes.len >= xing + 12) {
        const tag = bytes[xing..][0..4];
        if ((std.mem.eql(u8, tag, "Xing") or std.mem.eql(u8, tag, "Info")) and be32(bytes[xing + 4 ..]) & 1 != 0) {
            const frames = be32(bytes[xing + 8 ..]);
            if (frames > 0) return frames;
        }
    }
    if (bytes.len >= 36 + 18 and std.mem.eql(u8, bytes[36..40], "VBRI")) {
        const frames = be32(bytes[36 + 14 ..]);
        if (frames > 0) return frames;
    }
    return null;
}

// ---- tests

const testing = std.testing;

/// An MPEG-1 layer III, 128 kbps, 44.1 kHz stereo frame header.
const mp3_header = [4]u8{ 0xff, 0xfb, 0x90, 0x00 };
const mp3_frame_len = 417;

fn cbrFrames(allocator: std.mem.Allocator, count: usize) ![]u8 {
    const bytes = try allocator.alloc(u8, count * mp3_frame_len);
    @memset(bytes, 0);
    for (0..count) |i| @memcpy(bytes[i * mp3_frame_len ..][0..4], &mp3_header);
    return bytes;
}

test "a constant bitrate mp3 runs its audio bytes over its bitrate" {
    const window = try cbrFrames(testing.allocator, 8);
    defer testing.allocator.free(window);
    // 3:00 of 128 kbps audio is 2,880,000 bytes
    try testing.expectEqual(Step{ .seconds = 180 }, step(.unknown, window, 0, 2_880_000));
}

test "an mp3 with a Xing header runs its frame count" {
    const window = try cbrFrames(testing.allocator, 4);
    defer testing.allocator.free(window);
    @memcpy(window[36..40], "Xing");
    std.mem.writeInt(u32, window[40..44], 0x0f, .big);
    std.mem.writeInt(u32, window[44..48], 10_000, .big); // 10,000 × 1152 / 44100 ≈ 261 s
    try testing.expectEqual(Step{ .seconds = 261 }, step(.unknown, window, 0, 99_999_999));
}

test "an ID3 tag longer than the window asks for the audio after it" {
    var window: [2048]u8 = @splat(0);
    @memcpy(window[0..3], "ID3");
    window[3] = 4;
    window[8] = 0x20; // syncsafe 0x20 << 7 = 4096 bytes of tag
    try testing.expectEqual(Step{ .read = .{ .format = .mp3, .offset = 4106 } }, step(.unknown, &window, 0, 3_000_000));
    const audio = try cbrFrames(testing.allocator, 4);
    defer testing.allocator.free(audio);
    try testing.expectEqual(Step{ .seconds = 187 }, step(.mp3, audio, 4106, 3_000_000));
}

test "a lone sync pattern isn't mistaken for a frame" {
    var window: [4096]u8 = @splat(0);
    @memcpy(window[100..104], &mp3_header); // no second frame where the first one ends
    try testing.expectEqual(Step.unsupported, step(.unknown, &window, 0, 1_000_000));
}

test "a wav runs its data over its byte rate" {
    var window: [64]u8 = @splat(0);
    @memcpy(window[0..4], "RIFF");
    @memcpy(window[8..12], "WAVE");
    @memcpy(window[12..16], "fmt ");
    std.mem.writeInt(u32, window[16..20], 16, .little);
    std.mem.writeInt(u32, window[28..32], 176_400, .little); // 44.1 kHz, 16-bit stereo
    @memcpy(window[36..40], "data");
    std.mem.writeInt(u32, window[40..44], 176_400 * 95, .little);
    try testing.expectEqual(Step{ .seconds = 95 }, step(.unknown, &window, 0, 44 + 176_400 * 95));
    // a streamed writer's unknown size: the rest of the file
    std.mem.writeInt(u32, window[40..44], 0xffff_ffff, .little);
    try testing.expectEqual(Step{ .seconds = 10 }, step(.unknown, &window, 0, 44 + 1_764_000));
}

test "a flac runs its STREAMINFO samples over its rate" {
    var window: [42]u8 = @splat(0);
    @memcpy(window[0..4], "fLaC");
    window[7] = 34;
    // 44100 Hz in 20 bits at STREAMINFO byte 10
    const rate: u32 = 44100;
    window[18] = @intCast(rate >> 12);
    window[19] = @intCast((rate >> 4) & 0xff);
    window[20] = @intCast((rate & 0x0f) << 4);
    std.mem.writeInt(u32, window[22..26], 44100 * 200, .big);
    try testing.expectEqual(Step{ .seconds = 200 }, step(.unknown, &window, 0, 1_000_000));
}

fn box(writer: *std.ArrayList(u8), kind: *const [4]u8, body: []const u8) !void {
    var size: [4]u8 = undefined;
    std.mem.writeInt(u32, &size, @intCast(8 + body.len), .big);
    try writer.appendSlice(testing.allocator, &size);
    try writer.appendSlice(testing.allocator, kind);
    try writer.appendSlice(testing.allocator, body);
}

fn mvhdBody() [100]u8 {
    var body: [100]u8 = @splat(0);
    std.mem.writeInt(u32, body[12..16], 1000, .big); // timescale
    std.mem.writeInt(u32, body[16..20], 3_838_400, .big); // 3,838.4 s
    return body;
}

test "an m4a with moov up front runs its movie header" {
    var file: std.ArrayList(u8) = .empty;
    defer file.deinit(testing.allocator);
    try box(&file, "ftyp", "M4A isom");
    var moov: std.ArrayList(u8) = .empty;
    defer moov.deinit(testing.allocator);
    const body = mvhdBody();
    try box(&moov, "mvhd", &body);
    try box(&file, "moov", moov.items);
    try testing.expectEqual(Step{ .seconds = 3838 }, step(.unknown, file.items, 0, file.items.len + 5_000_000));
}

test "an m4a with moov at the end asks for it, then reads it" {
    var head: std.ArrayList(u8) = .empty;
    defer head.deinit(testing.allocator);
    try box(&head, "ftyp", "M4A isom");
    var mdat = [_]u8{ 0, 0x10, 0, 0, 'm', 'd', 'a', 't' }; // 1 MiB of audio
    try head.appendSlice(testing.allocator, &mdat);
    var moov: std.ArrayList(u8) = .empty;
    defer moov.deinit(testing.allocator);
    var inner: std.ArrayList(u8) = .empty;
    defer inner.deinit(testing.allocator);
    const body = mvhdBody();
    try box(&inner, "mvhd", &body);
    try box(&moov, "moov", inner.items);
    const moov_at: u64 = head.items.len - 8 + 0x100000;
    const total = moov_at + moov.items.len;
    try testing.expectEqual(Step{ .read = .{ .format = .mp4, .offset = moov_at } }, step(.unknown, head.items, 0, total));
    try testing.expectEqual(Step{ .seconds = 3838 }, step(.mp4, moov.items, moov_at, total));
}

test "a box that claims more than the file is refused" {
    var file = [_]u8{ 0, 0, 0, 16, 'f', 't', 'y', 'p', 'M', '4', 'A', ' ', 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xf0, 'm', 'd', 'a', 't' };
    try testing.expectEqual(Step.unsupported, step(.unknown, &file, 0, 100));
}

test "garbage is unsupported, never a duration" {
    var prng = std.Random.DefaultPrng.init(0x706c7972);
    var window: [4096]u8 = undefined;
    for (0..200) |_| {
        prng.random().bytes(&window);
        switch (step(.unknown, &window, 0, 10_000_000)) {
            .seconds => |s| try testing.expect(s > 0 and s <= max_seconds),
            .read => |r| try testing.expect(r.offset < 10_000_000),
            .unsupported => {},
        }
    }
}
