//! What audio bytes are, decided once, from the bytes.
//!
//! A file's name, a picker's type, a record's `fileType` and a blob's
//! `mimeType` are claims: a WAV renamed `.m4a` claims to be AAC, and Safari
//! believes whatever type it is served. Legacy plyr.fm decided formats from
//! names and kept re-fixing the same bug (`.aif` vs `.aiff` in #797 and
//! #1413, ALAC in `.m4a` in #1598). Here the bytes decide (`sniff`); claims
//! parse into the same type only to be compared against it
//! (`Container.fromFileType`, `Container.fromContentType`); and every
//! consequence (the served type, a record's `fileType`, whether an upload is
//! processed) is an exhaustive switch over `Format`, so a new container is a
//! compile error everywhere it matters.
//!
//! `next/core/src/audio-format.gen.ts` is rendered from this file by
//! `zig build gen-audio-format`; a test fails while it is stale. Both sides'
//! sniffers run against the files in `next/core/tests/fixtures/audio`.

const std = @import("std");

pub const Container = enum {
    mp3,
    /// raw AAC frames (`.aac`)
    adts,
    /// ISO media (`.m4a`): AAC, ALAC or anything else inside
    mp4,
    wav,
    flac,
    aiff,
    ogg,
    webm,

    /// The type to serve, store and upload these bytes as.
    pub fn contentType(container: Container) []const u8 {
        return switch (container) {
            .mp3 => "audio/mpeg",
            .adts => "audio/aac",
            .mp4 => "audio/mp4",
            .wav => "audio/wav",
            .flac => "audio/flac",
            .aiff => "audio/aiff",
            .ogg => "audio/ogg",
            .webm => "audio/webm",
        };
    }

    /// A record's `fileType`, and the extension a file of these bytes gets.
    pub fn fileType(container: Container) []const u8 {
        return switch (container) {
            .mp3 => "mp3",
            .adts => "aac",
            .mp4 => "m4a",
            .wav => "wav",
            .flac => "flac",
            .aiff => "aiff",
            .ogg => "ogg",
            .webm => "webm",
        };
    }

    /// How people name it.
    pub fn label(container: Container) []const u8 {
        return switch (container) {
            .mp3 => "MP3",
            .adts => "AAC",
            .mp4 => "M4A",
            .wav => "WAV",
            .flac => "FLAC",
            .aiff => "AIFF",
            .ogg => "Ogg",
            .webm => "WebM",
        };
    }

    /// Other names pickers, records and older uploads use for it.
    pub fn fileTypeAliases(container: Container) []const []const u8 {
        return switch (container) {
            .mp3 => &.{ "mpeg", "mpga" },
            .adts => &.{},
            .mp4 => &.{ "mp4", "m4b", "alac" },
            .wav => &.{"wave"},
            .flac => &.{},
            .aiff => &.{ "aif", "aifc" },
            .ogg => &.{ "oga", "opus" },
            .webm => &.{"weba"},
        };
    }

    /// Other content types pickers and PDSes report for it.
    pub fn contentTypeAliases(container: Container) []const []const u8 {
        return switch (container) {
            .mp3 => &.{ "audio/mp3", "audio/x-mpeg", "audio/mpeg3", "audio/x-mp3" },
            .adts => &.{ "audio/x-aac", "audio/aacp" },
            // zds labels any non-M4A brand of ISO media video/mp4
            .mp4 => &.{ "audio/x-m4a", "audio/m4a", "video/mp4" },
            .wav => &.{ "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/x-pn-wav" },
            .flac => &.{"audio/x-flac"},
            .aiff => &.{"audio/x-aiff"},
            .ogg => &.{ "audio/opus", "audio/vorbis", "audio/x-opus+ogg", "application/ogg" },
            .webm => &.{"video/webm"},
        };
    }

    /// Whether browsers everywhere play the container as it is.
    pub fn rule(container: Container) Rule {
        return switch (container) {
            .mp3, .adts => .as_is,
            .mp4 => .by_codec,
            .wav, .flac, .aiff, .ogg, .webm => .process,
        };
    }

    /// For `.by_codec` containers, the codecs that play as they are.
    pub fn asIsCodecs(container: Container) []const Codec {
        return switch (container) {
            .mp4 => &.{.aac},
            .mp3, .adts, .wav, .flac, .aiff, .ogg, .webm => &.{},
        };
    }

    /// A claimed file type (`"aif"`, `".M4A"`), or null when it names no container.
    pub fn fromFileType(text: []const u8) ?Container {
        const name = if (std.mem.startsWith(u8, text, ".")) text[1..] else text;
        inline for (comptime std.enums.values(Container)) |container| {
            if (std.ascii.eqlIgnoreCase(name, container.fileType())) return container;
            for (container.fileTypeAliases()) |alias| if (std.ascii.eqlIgnoreCase(name, alias)) return container;
        }
        return null;
    }

    /// A claimed content type (`"audio/x-wav; codecs=1"`), or null when it names no container.
    pub fn fromContentType(text: []const u8) ?Container {
        const essence = std.mem.trim(u8, text[0 .. std.mem.indexOfScalar(u8, text, ';') orelse text.len], " \t");
        inline for (comptime std.enums.values(Container)) |container| {
            if (std.ascii.eqlIgnoreCase(essence, container.contentType())) return container;
            for (container.contentTypeAliases()) |alias| if (std.ascii.eqlIgnoreCase(essence, alias)) return container;
        }
        return null;
    }
};

pub const Codec = enum { mp3, aac, alac, pcm, flac, vorbis, opus, other, unknown };

pub const Rule = enum { as_is, process, by_codec };

pub const Route = enum {
    /// served as uploaded
    as_is,
    /// transcoded to the mp3 playback rendition first
    process,
};

pub const Format = struct {
    container: Container,
    codec: Codec,

    pub fn route(format: Format) Route {
        return switch (format.container.rule()) {
            .as_is => .as_is,
            .process => .process,
            .by_codec => for (format.container.asIsCodecs()) |codec| {
                if (codec == format.codec) break .as_is;
            } else .process,
        };
    }
};

/// Enough leading bytes to name any container, and an M4A's codec when its
/// `moov` comes first.
pub const head_bytes = 64 * 1024;

/// What `bytes` (a whole file, or its first bytes) are, or null when they
/// name no audio container. A codec that can't be read from what is given is
/// `.unknown`, which routes a `.by_codec` container to processing.
pub fn sniff(bytes: []const u8) ?Format {
    if (bytes.len >= 10 and std.mem.eql(u8, bytes[0..3], "ID3")) {
        // an ID3v2 tag can front MP3, ADTS or even FLAC: look past it
        const footer: usize = if (bytes[5] & 0x10 != 0) 10 else 0;
        const skip = 10 + footer + synchsafe(bytes[6..10]);
        if (skip < bytes.len) if (sniff(bytes[skip..])) |format| return format;
        return .{ .container = .mp3, .codec = .mp3 };
    }
    if (bytes.len >= 2 and bytes[0] == 0xff) {
        if (bytes[1] & 0xe0 == 0xe0 and bytes[1] & 0x06 != 0) return .{ .container = .mp3, .codec = .mp3 };
        if (bytes[1] & 0xf6 == 0xf0) return .{ .container = .adts, .codec = .aac };
    }
    if (bytes.len >= 12) {
        if (std.mem.eql(u8, bytes[4..8], "ftyp")) return .{ .container = .mp4, .codec = mp4Codec(bytes) };
        if (std.mem.eql(u8, bytes[0..4], "RIFF") and std.mem.eql(u8, bytes[8..12], "WAVE")) return .{ .container = .wav, .codec = wavCodec(bytes) };
        if (std.mem.eql(u8, bytes[0..4], "FORM") and std.mem.eql(u8, bytes[8..12], "AIFF")) return .{ .container = .aiff, .codec = .pcm };
        if (std.mem.eql(u8, bytes[0..4], "FORM") and std.mem.eql(u8, bytes[8..12], "AIFC")) return .{ .container = .aiff, .codec = .unknown };
    }
    if (bytes.len >= 4) {
        if (std.mem.eql(u8, bytes[0..4], "fLaC")) return .{ .container = .flac, .codec = .flac };
        if (std.mem.eql(u8, bytes[0..4], "OggS")) return .{ .container = .ogg, .codec = oggCodec(bytes) };
        if (std.mem.eql(u8, bytes[0..4], "\x1a\x45\xdf\xa3")) return .{ .container = .webm, .codec = webmCodec(bytes) };
    }
    return null;
}

fn synchsafe(size: *const [4]u8) usize {
    return @as(usize, size[0] & 0x7f) << 21 | @as(usize, size[1] & 0x7f) << 14 | @as(usize, size[2] & 0x7f) << 7 | @as(usize, size[3] & 0x7f);
}

fn wavCodec(bytes: []const u8) Codec {
    // the fmt chunk nearly always follows the RIFF header directly
    if (bytes.len < 22 or !std.mem.eql(u8, bytes[12..16], "fmt ")) return .unknown;
    return switch (std.mem.readInt(u16, bytes[20..22], .little)) {
        1, 3, 0xfffe => .pcm,
        else => .other,
    };
}

fn oggCodec(bytes: []const u8) Codec {
    // the first page carries one packet: the codec's identification header
    if (bytes.len < 27) return .unknown;
    const packet = 27 + @as(usize, bytes[26]);
    if (packet > bytes.len) return .unknown;
    const first = bytes[packet..];
    if (std.mem.startsWith(u8, first, "OpusHead")) return .opus;
    if (std.mem.startsWith(u8, first, "\x01vorbis")) return .vorbis;
    if (std.mem.startsWith(u8, first, "\x7fFLAC")) return .flac;
    return .unknown;
}

fn webmCodec(bytes: []const u8) Codec {
    // the codec ID is a plain string in the track entry near the start
    if (std.mem.indexOf(u8, bytes, "A_OPUS") != null) return .opus;
    if (std.mem.indexOf(u8, bytes, "A_VORBIS") != null) return .vorbis;
    return .unknown;
}

const Box = struct { kind: [4]u8, body: []const u8, end: usize };

/// The box starting at `at`, or null when its header or body runs past `bytes`.
fn box(bytes: []const u8, at: usize) ?Box {
    if (at > bytes.len or bytes.len - at < 8) return null;
    const size32 = std.mem.readInt(u32, bytes[at..][0..4], .big);
    var header: usize = 8;
    const size: u64 = switch (size32) {
        0 => bytes.len - at,
        1 => large: {
            if (bytes.len - at < 16) return null;
            header = 16;
            break :large std.mem.readInt(u64, bytes[at + 8 ..][0..8], .big);
        },
        else => size32,
    };
    if (size < header or size > bytes.len - at) return null;
    const end = at + @as(usize, @intCast(size));
    return .{ .kind = bytes[at + 4 ..][0..4].*, .body = bytes[at + header .. end], .end = end };
}

fn child(parent: []const u8, kind: *const [4]u8) ?[]const u8 {
    var at: usize = 0;
    while (box(parent, at)) |found| : (at = found.end) {
        if (std.mem.eql(u8, &found.kind, kind)) return found.body;
    }
    return null;
}

/// The audio track's sample entry in an ISO media file's `moov`, when the
/// whole `moov` is in `bytes`.
pub fn mp4Codec(bytes: []const u8) Codec {
    const moov = child(bytes, "moov") orelse return .unknown;
    return moovCodec(moov);
}

/// The audio codec named in a `moov` box's body.
pub fn moovCodec(moov: []const u8) Codec {
    var at: usize = 0;
    while (box(moov, at)) |trak| : (at = trak.end) {
        if (!std.mem.eql(u8, &trak.kind, "trak")) continue;
        const mdia = child(trak.body, "mdia") orelse continue;
        const hdlr = child(mdia, "hdlr") orelse continue;
        if (hdlr.len < 12 or !std.mem.eql(u8, hdlr[8..12], "soun")) continue;
        const stsd = child(child(child(mdia, "minf") orelse continue, "stbl") orelse continue, "stsd") orelse continue;
        // version and flags, entry count, then the first entry's size and type
        if (stsd.len < 16) return .unknown;
        const entry = stsd[12..16];
        inline for (.{
            .{ "mp4a", Codec.aac }, .{ "alac", Codec.alac }, .{ "fLaC", Codec.flac }, .{ "Opus", Codec.opus },
            .{ ".mp3", Codec.mp3 }, .{ "lpcm", Codec.pcm },  .{ "sowt", Codec.pcm },  .{ "twos", Codec.pcm },
            .{ "ipcm", Codec.pcm }, .{ "fpcm", Codec.pcm },
        }) |pair| if (std.mem.eql(u8, entry, pair[0])) return pair[1];
        return .other;
    }
    return .unknown;
}

/// Where an ISO media file's `moov` box is, given the header of the top-level
/// box at `offset`: callers holding only the first bytes walk box headers
/// with this until `moov` turns up, then read it and pass it to `moovCodec`.
pub const TopBox = struct { kind: [4]u8, offset: u64, size: u64 };

/// The top-level box whose 16-byte header starts `header`, sitting at
/// `offset` in a file of `total` bytes, or null when the header is invalid.
pub fn topBox(header: []const u8, offset: u64, total: u64) ?TopBox {
    if (header.len < 8 or offset >= total) return null;
    const size32 = std.mem.readInt(u32, header[0..4], .big);
    const size: u64 = switch (size32) {
        0 => total - offset,
        1 => if (header.len >= 16) std.mem.readInt(u64, header[8..16], .big) else return null,
        else => size32,
    };
    if (size < 8 or size > total - offset) return null;
    return .{ .kind = header[4..8].*, .offset = offset, .size = size };
}

/// `next/core/src/audio-format.gen.ts`: the tables above, for the TS side.
pub fn renderTypeScript(allocator: std.mem.Allocator) ![]u8 {
    var out: std.Io.Writer.Allocating = .init(allocator);
    defer out.deinit();
    const w = &out.writer;
    try w.writeAll(
        \\// Generated from next/backend/src/internal/media/audio_format.zig by
        \\// `zig build gen-audio-format`. Do not edit: change the zig and regenerate.
        \\
        \\
    );
    try w.writeAll("export type AudioContainer = ");
    inline for (comptime std.enums.values(Container), 0..) |container, index| try w.print("{s}'{t}'", .{ if (index == 0) "" else " | ", container });
    try w.writeAll(";\nexport type AudioCodec = ");
    inline for (comptime std.enums.values(Codec), 0..) |codec, index| try w.print("{s}'{t}'", .{ if (index == 0) "" else " | ", codec });
    try w.writeAll(";\nexport type AudioRule = 'as_is' | 'process' | 'by_codec';\n\n");
    try w.writeAll(
        \\export type AudioContainerInfo = {
        \\  contentType: string; fileType: string; label: string;
        \\  fileTypeAliases: readonly string[]; contentTypeAliases: readonly string[];
        \\  rule: AudioRule; asIsCodecs: readonly AudioCodec[];
        \\};
        \\
        \\export const AUDIO_CONTAINERS: Readonly<Record<AudioContainer, AudioContainerInfo>> = {
        \\
    );
    inline for (comptime std.enums.values(Container)) |container| {
        try w.print("  {t}: {{ contentType: '{s}', fileType: '{s}', label: '{s}', fileTypeAliases: [", .{ container, container.contentType(), container.fileType(), container.label() });
        try list(w, container.fileTypeAliases());
        try w.writeAll("], contentTypeAliases: [");
        try list(w, container.contentTypeAliases());
        try w.print("], rule: '{t}', asIsCodecs: [", .{container.rule()});
        for (container.asIsCodecs(), 0..) |codec, index| try w.print("{s}'{t}'", .{ if (index == 0) "" else ", ", codec });
        try w.writeAll("] },\n");
    }
    try w.print("}};\n\nexport const AUDIO_HEAD_BYTES = {d};\n", .{head_bytes});
    return out.toOwnedSlice();
}

fn list(w: *std.Io.Writer, items: []const []const u8) !void {
    for (items, 0..) |item, index| try w.print("{s}'{s}'", .{ if (index == 0) "" else ", ", item });
}

test "claims parse into containers, aliases included" {
    try std.testing.expectEqual(Container.aiff, Container.fromFileType("aif").?);
    try std.testing.expectEqual(Container.aiff, Container.fromFileType(".AIFF").?);
    try std.testing.expectEqual(Container.mp4, Container.fromFileType("m4a").?);
    try std.testing.expectEqual(Container.ogg, Container.fromFileType("opus").?);
    try std.testing.expectEqual(@as(?Container, null), Container.fromFileType("txt"));
    try std.testing.expectEqual(Container.wav, Container.fromContentType("audio/vnd.wave").?);
    try std.testing.expectEqual(Container.wav, Container.fromContentType(" Audio/X-WAV ; codecs=1").?);
    try std.testing.expectEqual(Container.mp4, Container.fromContentType("video/mp4").?);
    try std.testing.expectEqual(@as(?Container, null), Container.fromContentType("application/octet-stream"));
    // every name maps back to the container that owns it, so no alias is shared
    inline for (comptime std.enums.values(Container)) |container| {
        try std.testing.expectEqual(container, Container.fromFileType(container.fileType()).?);
        try std.testing.expectEqual(container, Container.fromContentType(container.contentType()).?);
        for (container.fileTypeAliases()) |alias| try std.testing.expectEqual(container, Container.fromFileType(alias).?);
        for (container.contentTypeAliases()) |alias| try std.testing.expectEqual(container, Container.fromContentType(alias).?);
    }
}

test "routes: only MP3, AAC and AAC in M4A play everywhere as they are" {
    try std.testing.expectEqual(Route.as_is, (Format{ .container = .mp3, .codec = .mp3 }).route());
    try std.testing.expectEqual(Route.as_is, (Format{ .container = .adts, .codec = .aac }).route());
    try std.testing.expectEqual(Route.as_is, (Format{ .container = .mp4, .codec = .aac }).route());
    try std.testing.expectEqual(Route.process, (Format{ .container = .mp4, .codec = .alac }).route());
    try std.testing.expectEqual(Route.process, (Format{ .container = .mp4, .codec = .unknown }).route());
    try std.testing.expectEqual(Route.process, (Format{ .container = .wav, .codec = .pcm }).route());
    try std.testing.expectEqual(Route.process, (Format{ .container = .aiff, .codec = .pcm }).route());
}

test "sniffing names nothing in bytes that aren't audio" {
    try std.testing.expectEqual(@as(?Format, null), sniff(""));
    try std.testing.expectEqual(@as(?Format, null), sniff("not audio at all, just text"));
    try std.testing.expectEqual(@as(?Format, null), sniff("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"));
}

test "a truncated or lying box never reads past the bytes" {
    var bytes = [_]u8{ 0, 0, 0, 24, 'f', 't', 'y', 'p', 'M', '4', 'A', ' ', 0xff, 0xff, 0xff, 0xff, 'm', 'o', 'o', 'v' };
    try std.testing.expectEqual(Format{ .container = .mp4, .codec = .unknown }, sniff(&bytes).?);
    bytes[3] = 1; // a 1 here means a 64-bit size follows, which doesn't fit
    try std.testing.expectEqual(Format{ .container = .mp4, .codec = .unknown }, sniff(&bytes).?);
}
