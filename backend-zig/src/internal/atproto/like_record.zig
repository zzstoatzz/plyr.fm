//! Strict decoder for an authored `fm.plyr.like` DAG-CBOR record.

const std = @import("std");
const zat = @import("zat");
const lexicon_value = @import("lexicon_value.zig");

pub const Record = struct {
    subject_uri: []const u8,
    subject_cid: zat.Cid,
    created_at: []const u8,
};

pub const Error = error{
    InvalidRecord,
    WrongRecordType,
    InvalidSubject,
    InvalidSubjectUri,
    InvalidSubjectCid,
    WrongSubjectCollection,
    InvalidDatetime,
};

pub fn parse(
    value: zat.cbor.Value,
    like_collection: []const u8,
    track_collection: []const u8,
) Error!Record {
    const record_type = value.getString("$type") orelse return error.InvalidRecord;
    if (!std.mem.eql(u8, record_type, like_collection)) return error.WrongRecordType;
    const subject = value.get("subject") orelse return error.InvalidSubject;
    const subject_uri = subject.getString("uri") orelse return error.InvalidSubjectUri;
    const subject_cid = subject.getCid("cid") orelse return error.InvalidSubjectCid;
    const parsed_uri = zat.AtUri.parse(subject_uri) orelse return error.InvalidSubjectUri;
    if (zat.Did.parse(parsed_uri.authority()) == null or !parsed_uri.hasRkey())
        return error.InvalidSubjectUri;
    if (!std.mem.eql(
        u8,
        parsed_uri.collection() orelse return error.InvalidSubjectUri,
        track_collection,
    )) return error.WrongSubjectCollection;
    const parsed_cid = zat.Cid.fromBytes(subject_cid.raw) catch
        return error.InvalidSubjectCid;
    if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor)
        return error.InvalidSubjectCid;
    const created_at = value.getString("createdAt") orelse return error.InvalidRecord;
    if (!lexicon_value.validDatetime(created_at)) return error.InvalidDatetime;
    return .{
        .subject_uri = subject_uri,
        .subject_cid = subject_cid,
        .created_at = created_at,
    };
}

fn fixture(subject: zat.cbor.Value, entries: *[3]zat.cbor.Value.MapEntry) zat.cbor.Value {
    entries.* = .{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.like" } },
        .{ .key = "subject", .value = subject },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-09T12:00:00Z" } },
    };
    return .{ .map = entries };
}

test "like records preserve an exact track strong reference" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const cid = try zat.Cid.forDagCbor(arena.allocator(), "track");
    const subject: zat.cbor.Value = .{ .map = &.{
        .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/one" } },
        .{ .key = "cid", .value = .{ .cid = cid } },
    } };
    var entries: [3]zat.cbor.Value.MapEntry = undefined;
    const record = try parse(
        fixture(subject, &entries),
        "fm.plyr.dev.like",
        "fm.plyr.dev.track",
    );
    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.track/one",
        record.subject_uri,
    );
    try std.testing.expectEqualSlices(u8, cid.raw, record.subject_cid.raw);
}

test "like records reject text CIDs, cross-environment subjects, and invalid time" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const cid = try zat.Cid.forDagCbor(a, "track");
    const text_cid: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.like" } },
        .{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/one" } },
            .{ .key = "cid", .value = .{ .text = "bafy-not-a-link" } },
        } } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-09T12:00:00Z" } },
    } };
    try std.testing.expectError(
        error.InvalidSubjectCid,
        parse(text_cid, "fm.plyr.dev.like", "fm.plyr.dev.track"),
    );
    const foreign: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.like" } },
        .{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.track/one" } },
            .{ .key = "cid", .value = .{ .cid = cid } },
        } } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-09T12:00:00Z" } },
    } };
    try std.testing.expectError(
        error.WrongSubjectCollection,
        parse(foreign, "fm.plyr.dev.like", "fm.plyr.dev.track"),
    );
    const subject: zat.cbor.Value = .{ .map = &.{
        .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/one" } },
        .{ .key = "cid", .value = .{ .cid = cid } },
    } };
    var entries: [3]zat.cbor.Value.MapEntry = undefined;
    var invalid_time = fixture(subject, &entries);
    invalid_time = .{ .map = &.{
        invalid_time.map[0],
        invalid_time.map[1],
        .{ .key = "createdAt", .value = .{ .text = "yesterday" } },
    } };
    try std.testing.expectError(
        error.InvalidDatetime,
        parse(invalid_time, "fm.plyr.dev.like", "fm.plyr.dev.track"),
    );
}
