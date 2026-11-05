//! Structural decoder for an authored `fm.plyr.track` DAG-CBOR record.
//!
//! This preserves claims made by the repository separately from app-view
//! attestations. In particular, `audio_url` and `image_url` are declarations;
//! parsing them does not establish origin trust, object existence, or serving
//! availability. The caller must first authenticate the repository and record
//! CID before treating this value as an authored record.

const std = @import("std");
const zat = @import("zat");
const lexicon_value = @import("lexicon_value.zig");
const managed_space = @import("../space/managed_space.zig");

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
    /// gated audio: the artist's space record holding the audio blob
    audio_space: ?managed_space.SpaceRecordUri = null,
    description: ?[]const u8,
    self_labels: []const []const u8,
    tags: []const []const u8 = &.{},
    tags_present: bool = false,
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
    InvalidAudioSpace,
    TooManyLabels,
    InvalidLabels,
    InvalidTags,
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
    if (!lexicon_value.validDatetime(created_at)) return error.InvalidDatetime;

    const audio_url = try optionalUri(value, "audioUrl");
    const audio_blob = try optionalBlob(value, "audioBlob");
    const audio_space = try parseAudioSpace(value);
    if (audio_url == null and audio_blob == null and audio_space == null)
        return error.MissingAudioSource;

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
        .audio_space = audio_space,
        .description = try optionalBoundedString(value, "description", 0, 5000),
        .self_labels = try parseLabels(allocator, value),
        .tags = try parseTags(allocator, value),
        .tags_present = value.get("tags") != null,
    };
}

fn parseTags(allocator: std.mem.Allocator, value: zat.cbor.Value) Error![]const []const u8 {
    const field = value.get("tags") orelse return &.{};
    const array = switch (field) {
        .array => |items| items,
        else => return error.InvalidTags,
    };
    if (array.len > 20) return error.InvalidTags;
    const tags = try allocator.alloc([]const u8, array.len);
    for (array, tags) |item, *tag| {
        const text = switch (item) {
            .text => |text| text,
            else => return error.InvalidTags,
        };
        try validateString(text, 0, 50);
        if (std.mem.indexOfScalar(u8, text, 0) != null) return error.InvalidTags;
        tag.* = text;
    }
    return tags;
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
    if (!lexicon_value.validUri(text)) return error.InvalidUri;
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

fn parseAudioSpace(value: zat.cbor.Value) Error!?managed_space.SpaceRecordUri {
    const field = value.get("audioSpace") orelse return null;
    const text = switch (field) {
        .text => |text| text,
        else => return error.InvalidAudioSpace,
    };
    if (text.len > 2048) return error.InvalidAudioSpace;
    return managed_space.SpaceRecordUri.parse(text) orelse error.InvalidAudioSpace;
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

test "gated tracks carry their audio in a space record" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const gated_map = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "One" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "mp3" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
        .{ .key = "supportGate", .value = .{ .map = &.{.{ .key = "type", .value = .{ .text = "any" } }} } },
        .{ .key = "audioSpace", .value = .{ .text = "at://did:plc:artist/space/fm.plyr.dev.audio/supporters/did:plc:artist/fm.plyr.dev.track/3l2abc" } },
    };
    const record = try parse(a, .{ .map = &gated_map }, "fm.plyr.dev.track");
    try std.testing.expectEqualStrings("supporters", record.audio_space.?.space.skey);
    try std.testing.expect(record.audio_url == null and record.audio_blob == null);

    var bad_map = gated_map;
    bad_map[6].value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/3l2abc" };
    try std.testing.expectError(error.InvalidAudioSpace, parse(a, .{ .map = &bad_map }, "fm.plyr.dev.track"));
}

test "datetime validation follows ATProto capitalization and offset semantics" {
    try std.testing.expect(lexicon_value.validDatetime("0000-01-01T00:00:00.000Z"));
    try std.testing.expect(lexicon_value.validDatetime("1985-04-12T23:20:50.123+01:45"));
    try std.testing.expect(!lexicon_value.validDatetime("1985-04-12t23:20:50.123Z"));
    try std.testing.expect(!lexicon_value.validDatetime("1985-04-12T23:20:50.123z"));
    try std.testing.expect(!lexicon_value.validDatetime("1985-04-12T23:20:50.123-00:00"));
}

test "authored tags retain claims and reject out-of-bounds arrays" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var entries = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "Track" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "mp3" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
        .{ .key = "audioUrl", .value = .{ .text = "https://media.example/audio" } },
        .{ .key = "tags", .value = .{ .array = &.{ .{ .text = "Hip-Hop" }, .{ .text = "ambient" } } } },
    };
    const parsed = try parse(a, .{ .map = &entries }, "fm.plyr.dev.track");
    try std.testing.expectEqual(@as(usize, 2), parsed.tags.len);
    try std.testing.expectEqualStrings("Hip-Hop", parsed.tags[0]);
    try std.testing.expect(parsed.tags_present);
    entries[entries.len - 1].value = .{ .array = &.{} };
    const cleared = try parse(a, .{ .map = &entries }, "fm.plyr.dev.track");
    try std.testing.expect(cleared.tags_present);
    try std.testing.expectEqual(@as(usize, 0), cleared.tags.len);
    const absent = try parse(a, .{ .map = entries[0 .. entries.len - 1] }, "fm.plyr.dev.track");
    try std.testing.expect(!absent.tags_present);

    entries[entries.len - 1].value = .{ .array = &.{.{ .unsigned = 3 }} };
    try std.testing.expectError(error.InvalidTags, parse(a, .{ .map = &entries }, "fm.plyr.dev.track"));
    entries[entries.len - 1].value = .{ .array = &.{.{ .text = "bad\x00tag" }} };
    try std.testing.expectError(error.InvalidTags, parse(a, .{ .map = &entries }, "fm.plyr.dev.track"));
    var too_many: [21]zat.cbor.Value = undefined;
    @memset(&too_many, .{ .text = "tag" });
    entries[entries.len - 1].value = .{ .array = &too_many };
    try std.testing.expectError(error.InvalidTags, parse(a, .{ .map = &entries }, "fm.plyr.dev.track"));
    var long_tag: [51]u8 = undefined;
    @memset(&long_tag, 'a');
    entries[entries.len - 1].value = .{ .array = &.{.{ .text = &long_tag }} };
    try std.testing.expectError(error.InvalidString, parse(a, .{ .map = &entries }, "fm.plyr.dev.track"));
}
