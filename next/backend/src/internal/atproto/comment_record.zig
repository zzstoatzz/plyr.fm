//! Strict decoder for an authored `fm.plyr.comment` DAG-CBOR record: a
//! timed comment on a track, anchored to a playback position.

const std = @import("std");
const zat = @import("zat");
const lexicon_value = @import("lexicon_value.zig");
const track_record = @import("track_record.zig");

pub const max_text_bytes: usize = 1000;

pub const Record = struct {
    subject_uri: []const u8,
    subject_cid: zat.Cid,
    text: []const u8,
    timestamp_ms: u64,
    created_at: []const u8,
    updated_at: ?[]const u8,
};

pub const Error = error{
    InvalidRecord,
    WrongRecordType,
    InvalidSubject,
    InvalidSubjectUri,
    InvalidSubjectCid,
    WrongSubjectCollection,
    InvalidText,
    InvalidTimestamp,
    InvalidDatetime,
    OutOfMemory,
};

pub fn parse(
    allocator: std.mem.Allocator,
    value: zat.cbor.Value,
    comment_collection: []const u8,
    track_collection: []const u8,
) Error!Record {
    const record_type = value.getString("$type") orelse return error.InvalidRecord;
    if (!std.mem.eql(u8, record_type, comment_collection)) return error.WrongRecordType;
    const subject = value.get("subject") orelse return error.InvalidSubject;
    const subject_uri = subject.getString("uri") orelse return error.InvalidSubjectUri;
    const parsed_uri = zat.AtUri.parse(subject_uri) orelse return error.InvalidSubjectUri;
    if (zat.Did.parse(parsed_uri.authority()) == null or !parsed_uri.hasRkey())
        return error.InvalidSubjectUri;
    if (!std.mem.eql(
        u8,
        parsed_uri.collection() orelse return error.InvalidSubjectUri,
        track_collection,
    )) return error.WrongSubjectCollection;
    const subject_cid = lexicon_value.strongRefCid(allocator, subject) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.InvalidCid => return error.InvalidSubjectCid,
    };
    const text = switch (value.get("text") orelse return error.InvalidText) {
        .text => |text| text,
        else => return error.InvalidText,
    };
    if (!std.unicode.utf8ValidateSlice(text) or text.len == 0 or text.len > max_text_bytes)
        return error.InvalidText;
    const timestamp_ms: u64 = switch (value.get("timestampMs") orelse return error.InvalidTimestamp) {
        .unsigned => |ms| if (ms <= track_record.max_lexicon_integer) ms else return error.InvalidTimestamp,
        else => return error.InvalidTimestamp,
    };
    const created_at = value.getString("createdAt") orelse return error.InvalidRecord;
    if (!lexicon_value.validDatetime(created_at)) return error.InvalidDatetime;
    const updated_at: ?[]const u8 = if (value.get("updatedAt")) |field| switch (field) {
        .text => |stamp| if (lexicon_value.validDatetime(stamp)) stamp else return error.InvalidDatetime,
        else => return error.InvalidDatetime,
    } else null;
    return .{
        .subject_uri = subject_uri,
        .subject_cid = subject_cid,
        .text = text,
        .timestamp_ms = timestamp_ms,
        .created_at = created_at,
        .updated_at = updated_at,
    };
}

fn fixture(a: std.mem.Allocator, overrides: []const zat.cbor.Value.MapEntry) !zat.cbor.Value {
    const cid = try zat.Cid.forDagCbor(a, "track");
    var entries: std.ArrayList(zat.cbor.Value.MapEntry) = .empty;
    try entries.appendSlice(a, &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.comment" } },
        .{ .key = "subject", .value = .{ .map = try a.dupe(zat.cbor.Value.MapEntry, &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/one" } },
            .{ .key = "cid", .value = .{ .text = try cid.toString(a) } },
        }) } },
        .{ .key = "text", .value = .{ .text = "the sax here" } },
        .{ .key = "timestampMs", .value = .{ .unsigned = 250_000 } },
        .{ .key = "createdAt", .value = .{ .text = "2026-11-14T09:00:00Z" } },
    });
    for (overrides) |override| {
        for (entries.items) |*entry| {
            if (std.mem.eql(u8, entry.key, override.key)) {
                entry.value = override.value;
                break;
            }
        } else try entries.append(a, override);
    }
    return .{ .map = entries.items };
}

test "comment records keep the track strong reference, text and position" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record = try parse(a, try fixture(a, &.{}), "fm.plyr.dev.comment", "fm.plyr.dev.track");
    try std.testing.expectEqualStrings("at://did:plc:artist/fm.plyr.dev.track/one", record.subject_uri);
    try std.testing.expectEqualStrings("the sax here", record.text);
    try std.testing.expectEqual(@as(u64, 250_000), record.timestamp_ms);
    try std.testing.expect(record.updated_at == null);
    const edited = try parse(a, try fixture(a, &.{
        .{ .key = "updatedAt", .value = .{ .text = "2026-11-14T10:00:00Z" } },
    }), "fm.plyr.dev.comment", "fm.plyr.dev.track");
    try std.testing.expectEqualStrings("2026-11-14T10:00:00Z", edited.updated_at.?);
}

test "comment records reject empty or oversized text, bad positions and foreign subjects" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const c = "fm.plyr.dev.comment";
    const t = "fm.plyr.dev.track";
    try std.testing.expectError(error.InvalidText, parse(a, try fixture(a, &.{.{ .key = "text", .value = .{ .text = "" } }}), c, t));
    const long = try a.alloc(u8, max_text_bytes + 1);
    @memset(long, 'a');
    try std.testing.expectError(error.InvalidText, parse(a, try fixture(a, &.{.{ .key = "text", .value = .{ .text = long } }}), c, t));
    try std.testing.expectError(error.InvalidTimestamp, parse(a, try fixture(a, &.{.{ .key = "timestampMs", .value = .{ .negative = 1 } }}), c, t));
    try std.testing.expectError(error.InvalidTimestamp, parse(a, try fixture(a, &.{.{ .key = "timestampMs", .value = .{ .text = "12" } }}), c, t));
    try std.testing.expectError(error.InvalidDatetime, parse(a, try fixture(a, &.{.{ .key = "updatedAt", .value = .{ .text = "later" } }}), c, t));
    const cid = try zat.Cid.forDagCbor(a, "track");
    try std.testing.expectError(error.WrongSubjectCollection, parse(a, try fixture(a, &.{.{ .key = "subject", .value = .{ .map = try a.dupe(zat.cbor.Value.MapEntry, &.{
        .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.track/one" } },
        .{ .key = "cid", .value = .{ .text = try cid.toString(a) } },
    }) } }}), c, t));
}
