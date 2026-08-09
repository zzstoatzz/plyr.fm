//! Structural decoder for an authored `fm.plyr.track` DAG-CBOR record.
//!
//! This preserves claims made by the repository separately from app-view
//! attestations. In particular, `audio_url` and `image_url` are declarations;
//! parsing them does not establish origin trust, object existence, or serving
//! availability. The caller must first authenticate the repository and record
//! CID before treating this value as an authored record.

const std = @import("std");
const zat = @import("zat");

pub const max_features: usize = 10;
pub const max_labels: usize = 10;
pub const max_blob_size: u64 = 100 * 1024 * 1024;
pub const max_lexicon_integer: u64 = 9_007_199_254_740_991;
pub const max_unbounded_string: usize = 1_000_000;

pub const Blob = struct {
    cid: zat.Cid,
    media_type: []const u8,
    size: u64,
};

pub const Record = struct {
    title: []const u8,
    artist_name: []const u8,
    file_type: []const u8,
    created_at: []const u8,
    audio_url: ?[]const u8,
    audio_blob: ?Blob,
    album: ?[]const u8,
    duration_seconds: ?u64,
    featured_dids: []const []const u8,
    image_url: ?[]const u8,
    support_gate_type: ?[]const u8,
    description: ?[]const u8,
    self_labels: []const []const u8,
};

pub const Error = error{
    InvalidRecord,
    WrongRecordType,
    MissingAudioSource,
    InvalidString,
    InvalidUri,
    InvalidDatetime,
    InvalidDuration,
    TooManyFeatures,
    InvalidFeature,
    InvalidSupportGate,
    TooManyLabels,
    InvalidLabels,
    InvalidBlob,
    OutOfMemory,
};

pub fn parse(
    allocator: std.mem.Allocator,
    value: zat.cbor.Value,
    track_collection: []const u8,
) Error!Record {
    const record_type = value.getString("$type") orelse return error.InvalidRecord;
    if (!std.mem.eql(u8, record_type, track_collection)) return error.WrongRecordType;

    const title = try requiredBoundedString(value, "title", 1, 256);
    const artist_name = try requiredBoundedString(value, "artist", 1, 256);
    const file_type = try requiredBoundedString(value, "fileType", 1, 16);
    const created_at = value.getString("createdAt") orelse return error.InvalidRecord;
    if (!validDatetime(created_at)) return error.InvalidDatetime;

    const audio_url = try optionalUri(value, "audioUrl");
    const audio_blob = try optionalBlob(value, "audioBlob");
    if (audio_url == null and audio_blob == null) return error.MissingAudioSource;

    return .{
        .title = title,
        .artist_name = artist_name,
        .file_type = file_type,
        .created_at = created_at,
        .audio_url = audio_url,
        .audio_blob = audio_blob,
        .album = try optionalBoundedString(value, "album", 0, 256),
        .duration_seconds = try optionalDuration(value),
        .featured_dids = try parseFeatures(allocator, value),
        .image_url = try optionalUri(value, "imageUrl"),
        .support_gate_type = try parseSupportGate(value),
        .description = try optionalBoundedString(value, "description", 0, 5000),
        .self_labels = try parseLabels(allocator, value),
    };
}

fn requiredBoundedString(
    value: zat.cbor.Value,
    key: []const u8,
    minimum: usize,
    maximum: usize,
) Error![]const u8 {
    const text = value.getString(key) orelse return error.InvalidRecord;
    try validateString(text, minimum, maximum);
    return text;
}

fn optionalBoundedString(
    value: zat.cbor.Value,
    key: []const u8,
    minimum: usize,
    maximum: usize,
) Error!?[]const u8 {
    const field = value.get(key) orelse return null;
    const text = switch (field) {
        .text => |text| text,
        else => return error.InvalidRecord,
    };
    try validateString(text, minimum, maximum);
    return text;
}

fn validateString(text: []const u8, minimum: usize, maximum: usize) Error!void {
    if (!std.unicode.utf8ValidateSlice(text) or text.len < minimum or text.len > maximum)
        return error.InvalidString;
}

fn optionalUri(value: zat.cbor.Value, key: []const u8) Error!?[]const u8 {
    const text = (try optionalBoundedString(value, key, 1, max_unbounded_string)) orelse return null;
    const uri = std.Uri.parse(text) catch return error.InvalidUri;
    if (uri.scheme.len == 0) return error.InvalidUri;
    return text;
}

fn optionalDuration(value: zat.cbor.Value) Error!?u64 {
    const field = value.get("duration") orelse return null;
    return switch (field) {
        .unsigned => |duration| if (duration <= max_lexicon_integer)
            duration
        else
            error.InvalidDuration,
        else => error.InvalidDuration,
    };
}

fn parseFeatures(allocator: std.mem.Allocator, value: zat.cbor.Value) Error![]const []const u8 {
    const field = value.get("features") orelse return &.{};
    const raw = switch (field) {
        .array => |items| items,
        else => return error.InvalidFeature,
    };
    if (raw.len > max_features) return error.TooManyFeatures;
    const dids = try allocator.alloc([]const u8, raw.len);
    for (raw, dids) |feature, *did| {
        const text = feature.getString("did") orelse return error.InvalidFeature;
        if (zat.Did.parse(text) == null) return error.InvalidFeature;
        if (feature.get("handle")) |handle_field| {
            const handle = switch (handle_field) {
                .text => |handle| handle,
                else => return error.InvalidFeature,
            };
            if (zat.Handle.parse(handle) == null) return error.InvalidFeature;
        }
        _ = optionalBoundedString(feature, "displayName", 0, 256) catch
            return error.InvalidFeature;
        did.* = text;
    }
    return dids;
}

fn parseSupportGate(value: zat.cbor.Value) Error!?[]const u8 {
    const field = value.get("supportGate") orelse return null;
    const gate_type = field.getString("type") orelse return error.InvalidSupportGate;
    // `knownValues` is deliberately not a closed enum in an ATProto lexicon.
    // Keep forward-compatible authored values, bounded by the record envelope.
    try validateString(gate_type, 1, max_unbounded_string);
    return gate_type;
}

fn parseLabels(allocator: std.mem.Allocator, value: zat.cbor.Value) Error![]const []const u8 {
    const field = value.get("labels") orelse return &.{};
    const label_type = field.getString("$type") orelse return error.InvalidLabels;
    if (!std.mem.eql(u8, label_type, "com.atproto.label.defs#selfLabels"))
        return error.InvalidLabels;
    const raw = field.getArray("values") orelse return error.InvalidLabels;
    if (raw.len > max_labels) return error.TooManyLabels;
    const labels = try allocator.alloc([]const u8, raw.len);
    for (raw, labels) |item, *label| {
        const text = item.getString("val") orelse return error.InvalidLabels;
        try validateString(text, 1, 128);
        label.* = text;
    }
    return labels;
}

fn optionalBlob(value: zat.cbor.Value, key: []const u8) Error!?Blob {
    const field = value.get(key) orelse return null;
    const blob_type = field.getString("$type") orelse return error.InvalidBlob;
    if (!std.mem.eql(u8, blob_type, "blob")) return error.InvalidBlob;
    const cid = field.getCid("ref") orelse return error.InvalidBlob;
    const parsed_cid = zat.Cid.fromBytes(cid.raw) catch return error.InvalidBlob;
    if (parsed_cid.codec() != zat.cbor.Codec.raw) return error.InvalidBlob;
    const media_type = field.getString("mimeType") orelse return error.InvalidBlob;
    if (!validAudioMediaType(media_type))
        return error.InvalidBlob;
    const size = field.getUint("size") orelse return error.InvalidBlob;
    if (size > max_blob_size) return error.InvalidBlob;
    return .{ .cid = cid, .media_type = media_type, .size = size };
}

fn validAudioMediaType(value: []const u8) bool {
    if (!std.mem.startsWith(u8, value, "audio/") or
        value.len == "audio/".len or value.len > 255) return false;
    for (value) |character| {
        if (character <= 0x20 or character >= 0x7f) return false;
    }
    return true;
}

fn validDatetime(value: []const u8) bool {
    // RFC 3339's Internet profile: YYYY-MM-DDTHH:MM:SS[.fraction](Z|+HH:MM).
    if (value.len < 20 or value[4] != '-' or value[7] != '-' or
        value[10] != 'T' or value[13] != ':' or value[16] != ':')
        return false;
    const year = parseDecimal(value[0..4]) orelse return false;
    const month = parseDecimal(value[5..7]) orelse return false;
    const day = parseDecimal(value[8..10]) orelse return false;
    const hour = parseDecimal(value[11..13]) orelse return false;
    const minute = parseDecimal(value[14..16]) orelse return false;
    const second = parseDecimal(value[17..19]) orelse return false;
    if (month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59)
        return false;
    const month_days = [_]u16{ 31, if (isLeapYear(year)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    if (day < 1 or day > month_days[month - 1]) return false;

    var offset: usize = 19;
    if (offset < value.len and value[offset] == '.') {
        offset += 1;
        const fraction_start = offset;
        while (offset < value.len and std.ascii.isDigit(value[offset])) : (offset += 1) {}
        if (offset == fraction_start) return false;
    }
    if (offset + 1 == value.len and value[offset] == 'Z') return true;
    if (offset + 6 != value.len or (value[offset] != '+' and value[offset] != '-') or
        value[offset + 3] != ':') return false;
    const zone_hour = parseDecimal(value[offset + 1 .. offset + 3]) orelse return false;
    const zone_minute = parseDecimal(value[offset + 4 .. offset + 6]) orelse return false;
    if (year == 0 or (value[offset] == '-' and zone_hour == 0 and zone_minute == 0))
        return false;
    return zone_hour <= 23 and zone_minute <= 59;
}

fn parseDecimal(value: []const u8) ?u16 {
    if (value.len == 0) return null;
    var result: u16 = 0;
    for (value) |character| {
        if (!std.ascii.isDigit(character)) return null;
        result = result * 10 + character - '0';
    }
    return result;
}

fn isLeapYear(year: u16) bool {
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0);
}

fn fixture(blob_cid: zat.Cid) zat.cbor.Value {
    return .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "One" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "flac" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00.123+00:00" } },
        .{ .key = "audioUrl", .value = .{ .text = "https://media.example/audio.flac" } },
        .{ .key = "audioBlob", .value = .{ .map = &.{
            .{ .key = "$type", .value = .{ .text = "blob" } },
            .{ .key = "ref", .value = .{ .cid = blob_cid } },
            .{ .key = "mimeType", .value = .{ .text = "audio/flac" } },
            .{ .key = "size", .value = .{ .unsigned = 42 } },
        } } },
        .{ .key = "duration", .value = .{ .unsigned = 123 } },
        .{ .key = "features", .value = .{ .array = &.{.{ .map = &.{
            .{ .key = "did", .value = .{ .text = "did:plc:featured" } },
            .{ .key = "displayName", .value = .{ .text = "Old snapshot" } },
        } }} } },
        .{ .key = "supportGate", .value = .{ .map = &.{
            .{ .key = "type", .value = .{ .text = "future-gate" } },
        } } },
        .{ .key = "labels", .value = .{ .map = &.{
            .{ .key = "$type", .value = .{ .text = "com.atproto.label.defs#selfLabels" } },
            .{ .key = "values", .value = .{ .array = &.{.{ .map = &.{
                .{ .key = "val", .value = .{ .text = "porn" } },
            } }} } },
        } } },
    } };
}

test "track record preserves authored claims without attesting delivery" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const blob_cid = try zat.Cid.create(a, 1, zat.cbor.Codec.raw, zat.cbor.HashFn.sha2_256, "audio");
    const record = try parse(a, fixture(blob_cid), "fm.plyr.dev.track");
    try std.testing.expectEqualStrings("One", record.title);
    try std.testing.expectEqualStrings("https://media.example/audio.flac", record.audio_url.?);
    try std.testing.expectEqualSlices(u8, blob_cid.raw, record.audio_blob.?.cid.raw);
    try std.testing.expectEqual(@as(u64, 42), record.audio_blob.?.size);
    try std.testing.expectEqualStrings("did:plc:featured", record.featured_dids[0]);
    try std.testing.expectEqualStrings("future-gate", record.support_gate_type.?);
    try std.testing.expectEqualStrings("porn", record.self_labels[0]);
}

test "track record rejects missing audio, wrong blob codec, and invalid datetime" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const raw_cid = try zat.Cid.create(a, 1, zat.cbor.Codec.raw, zat.cbor.HashFn.sha2_256, "audio");
    const dag_cid = try zat.Cid.forDagCbor(a, "not-a-blob");

    var no_audio = fixture(raw_cid);
    const no_audio_map = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "One" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "flac" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    };
    no_audio = .{ .map = &no_audio_map };
    try std.testing.expectError(error.MissingAudioSource, parse(a, no_audio, "fm.plyr.dev.track"));

    try std.testing.expectError(error.InvalidBlob, parse(a, fixture(dag_cid), "fm.plyr.dev.track"));

    const bad_date_map = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "One" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "flac" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-02-30T12:00:00Z" } },
        .{ .key = "audioUrl", .value = .{ .text = "https://example.com/audio" } },
    };
    try std.testing.expectError(
        error.InvalidDatetime,
        parse(a, .{ .map = &bad_date_map }, "fm.plyr.dev.track"),
    );
}

test "datetime validation follows ATProto capitalization and offset semantics" {
    try std.testing.expect(validDatetime("0000-01-01T00:00:00.000Z"));
    try std.testing.expect(validDatetime("1985-04-12T23:20:50.123+01:45"));
    try std.testing.expect(!validDatetime("1985-04-12t23:20:50.123Z"));
    try std.testing.expect(!validDatetime("1985-04-12T23:20:50.123z"));
    try std.testing.expect(!validDatetime("1985-04-12T23:20:50.123-00:00"));
}
