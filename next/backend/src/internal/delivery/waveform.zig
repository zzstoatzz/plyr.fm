//! Playing-bar levels from decoded audio.
//!
//! ffmpeg splits a track into four bands (bass to treble) and hands them over
//! as interleaved 16-bit samples at 16 kHz (`filter`). This keeps each band's
//! mean power per 50 ms frame, then turns power into a level from 0 to 255
//! relative to that band's own loud passages, so quiet recordings move as
//! much as loud ones. A band far quieter than the loudest one stays quiet
//! instead of being lifted to match.

const std = @import("std");

pub const bands = 4;
pub const sample_rate = 16_000;
pub const max_fps = 20;
const frame_samples = sample_rate / max_fps;
const sample_bytes = bands * 2;
/// past this many frames, frames merge (a long mix keeps a small envelope)
pub const max_frames = 36_000;
/// the frame merges whose rates stay whole numbers: 20, 10, 5, 4, 2 and 1 fps
const merges = [_]u32{ 1, 2, 4, 5, 10, 20 };
/// a level spans this many dB below the band's reference
const range_db: f32 = 30;
/// a band's reference is never more than this far under the loudest band's
const band_spread_db: f32 = 18;
/// a track whose loudest band never gets above this is treated as silence
const silence_db: f32 = -70;

/// ffmpeg's filter graph: mono at 16 kHz, split into four bands, joined into
/// one four-channel stream.
pub const filter = "[0:a:0]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono,asplit=4[a][b][c][d];" ++
    "[a]lowpass=f=180,lowpass=f=180[o0];" ++
    "[b]bandpass=f=550:width_type=q:w=0.8[o1];" ++
    "[c]bandpass=f=1800:width_type=q:w=0.8[o2];" ++
    "[d]highpass=f=4500,highpass=f=4500[o3];" ++
    "[o0][o1][o2][o3]join=inputs=4:channel_layout=4.0[out]";

pub const Levels = struct {
    fps: u8,
    /// `bands` bytes per frame
    levels: []u8,
};

pub const Analyzer = struct {
    power: std.ArrayList([bands]f32) = .empty,
    sums: [bands]f64 = @splat(0),
    count: u32 = 0,
    carry: [sample_bytes]u8 = undefined,
    carry_len: usize = 0,

    pub fn deinit(self: *Analyzer, allocator: std.mem.Allocator) void {
        self.power.deinit(allocator);
    }

    /// Takes the next bytes of ffmpeg's output, split anywhere.
    pub fn feed(self: *Analyzer, allocator: std.mem.Allocator, bytes: []const u8) !void {
        var rest = bytes;
        if (self.carry_len > 0) {
            const take = @min(sample_bytes - self.carry_len, rest.len);
            @memcpy(self.carry[self.carry_len..][0..take], rest[0..take]);
            self.carry_len += take;
            rest = rest[take..];
            if (self.carry_len < sample_bytes) return;
            try self.sample(allocator, &self.carry);
            self.carry_len = 0;
        }
        while (rest.len >= sample_bytes) : (rest = rest[sample_bytes..]) {
            try self.sample(allocator, rest[0..sample_bytes]);
        }
        @memcpy(self.carry[0..rest.len], rest);
        self.carry_len = rest.len;
    }

    fn sample(self: *Analyzer, allocator: std.mem.Allocator, bytes: *const [sample_bytes]u8) !void {
        inline for (0..bands) |band| {
            const value: f64 = @floatFromInt(std.mem.readInt(i16, bytes[band * 2 ..][0..2], .little));
            const scaled = value / 32768.0;
            self.sums[band] += scaled * scaled;
        }
        self.count += 1;
        if (self.count == frame_samples) try self.close(allocator);
    }

    fn close(self: *Analyzer, allocator: std.mem.Allocator) !void {
        if (self.power.items.len >= max_frames * merges[merges.len - 1]) return error.AudioTooLong;
        var frame: [bands]f32 = undefined;
        const count: f64 = @floatFromInt(self.count);
        for (&frame, self.sums) |*value, sum| value.* = @floatCast(sum / count);
        try self.power.append(allocator, frame);
        self.sums = @splat(0);
        self.count = 0;
    }

    /// The levels, owned by `allocator`. Fails for audio with no frames.
    pub fn finish(self: *Analyzer, allocator: std.mem.Allocator) !Levels {
        if (self.count >= frame_samples / 2) try self.close(allocator);
        const frames = self.power.items;
        if (frames.len == 0) return error.NoAudio;
        const merge = for (merges) |candidate| {
            if ((std.math.divCeil(usize, frames.len, candidate) catch unreachable) <= max_frames) break candidate;
        } else return error.AudioTooLong;
        const count = std.math.divCeil(usize, frames.len, merge) catch unreachable;

        // mean power of each merged frame, in dB
        const db = try allocator.alloc([bands]f32, count);
        defer allocator.free(db);
        for (db, 0..) |*out, index| {
            const group = frames[index * merge .. @min(frames.len, (index + 1) * merge)];
            for (out, 0..) |*value, band| {
                var sum: f32 = 0;
                for (group) |frame| sum += frame[band];
                value.* = decibels(sum / @as(f32, @floatFromInt(group.len)));
            }
        }

        var reference: [bands]f32 = undefined;
        const scratch = try allocator.alloc(f32, count);
        defer allocator.free(scratch);
        for (&reference, 0..) |*value, band| {
            for (scratch, db) |*item, frame| item.* = frame[band];
            std.mem.sort(f32, scratch, {}, std.sort.asc(f32));
            value.* = scratch[@min(count - 1, count * 95 / 100)];
        }
        const loudest = std.mem.max(f32, &reference);
        for (&reference) |*value| value.* = @max(value.*, loudest - band_spread_db);

        const levels = try allocator.alloc(u8, count * bands);
        errdefer allocator.free(levels);
        for (db, 0..) |frame, index| {
            for (frame, reference, 0..) |value, top, band| {
                const level = if (loudest < silence_db) 0 else std.math.clamp((value - (top - range_db)) / range_db, 0, 1);
                levels[index * bands + band] = @intFromFloat(@round(level * 255));
            }
        }
        return .{ .fps = @intCast(max_fps / merge), .levels = levels };
    }
};

fn decibels(power: f32) f32 {
    return 10 * std.math.log10(power + 1e-12);
}

fn samples(allocator: std.mem.Allocator, count: usize, comptime band_value: fn (usize, usize) i16) ![]u8 {
    const bytes = try allocator.alloc(u8, count * sample_bytes);
    for (0..count) |index| {
        inline for (0..bands) |band| std.mem.writeInt(i16, bytes[index * sample_bytes + band * 2 ..][0..2], band_value(index, band), .little);
    }
    return bytes;
}

fn pulse(index: usize, band: usize) i16 {
    // bass beats twice a second, the other bands hold steady at different loudness
    if (band == 0) return if ((index / (sample_rate / 4)) % 2 == 0) 16000 else 0;
    const amplitude: i16 = switch (band) {
        1 => 8000,
        2 => 800,
        else => 4,
    };
    return if (index % 2 == 0) amplitude else -amplitude;
}

test "levels follow each band's loudness, split anywhere" {
    const allocator = std.testing.allocator;
    const bytes = try samples(allocator, sample_rate * 2, pulse);
    defer allocator.free(bytes);
    var analyzer: Analyzer = .{};
    defer analyzer.deinit(allocator);
    // odd-sized chunks cross sample boundaries
    var offset: usize = 0;
    while (offset < bytes.len) : (offset += 1237) try analyzer.feed(allocator, bytes[offset..@min(bytes.len, offset + 1237)]);
    const result = try analyzer.finish(allocator);
    defer allocator.free(result.levels);
    try std.testing.expectEqual(@as(u8, 20), result.fps);
    try std.testing.expectEqual(@as(usize, 40 * bands), result.levels.len);
    // bass: loud for 5 frames, silent for 5
    try std.testing.expectEqual(@as(u8, 255), result.levels[0]);
    try std.testing.expectEqual(@as(u8, 0), result.levels[5 * bands]);
    try std.testing.expectEqual(@as(u8, 255), result.levels[10 * bands]);
    // a steady band sits at its own reference
    try std.testing.expectEqual(@as(u8, 255), result.levels[bands + 1]);
    // 20 dB under the loudest band: held down, not lifted to the top
    const quiet = result.levels[bands + 2];
    try std.testing.expect(quiet > 0 and quiet < 255);
    // far under the loudest band: nothing
    try std.testing.expectEqual(@as(u8, 0), result.levels[bands + 3]);
}

fn silent(_: usize, _: usize) i16 {
    return 0;
}

test "silence reads as silence and no audio is refused" {
    const allocator = std.testing.allocator;
    const bytes = try samples(allocator, sample_rate, silent);
    defer allocator.free(bytes);
    var analyzer: Analyzer = .{};
    defer analyzer.deinit(allocator);
    try analyzer.feed(allocator, bytes);
    const result = try analyzer.finish(allocator);
    defer allocator.free(result.levels);
    for (result.levels) |level| try std.testing.expectEqual(@as(u8, 0), level);

    var empty: Analyzer = .{};
    defer empty.deinit(allocator);
    try empty.feed(allocator, bytes[0..100]);
    try std.testing.expectError(error.NoAudio, empty.finish(allocator));
}

test "long audio merges frames at a whole frame rate" {
    const allocator = std.testing.allocator;
    var analyzer: Analyzer = .{};
    defer analyzer.deinit(allocator);
    // 2.5 hours of frames at 20 fps, without decoding any samples
    for (0..max_fps * 9000) |_| try analyzer.power.append(allocator, .{ 0.1, 0.01, 0.001, 0.0001 });
    const result = try analyzer.finish(allocator);
    defer allocator.free(result.levels);
    try std.testing.expectEqual(@as(u8, 4), result.fps);
    try std.testing.expectEqual(@as(usize, 36_000 * bands), result.levels.len);
}
