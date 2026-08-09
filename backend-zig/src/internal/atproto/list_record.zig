//! Structural decoder for an `fm.plyr.list` DAG-CBOR record.
//!
//! This intentionally consumes `zat.cbor.Value`, not Jetstream's Lex-JSON
//! representation. The caller must obtain the value from a content-addressed
//! CAR block after repository verification; parsing is not itself proof that
//! a repository contained the record.

const std = @import("std");
const zat = @import("zat");
const lexicon_string = @import("../text/lexicon_string.zig");

pub const max_items: usize = 500;

pub const ListType = enum {
    album,
    playlist,
    liked,

    fn parse(value: []const u8) ?ListType {
        return std.meta.stringToEnum(ListType, value);
    }
};

pub const StrongRef = struct {
    uri: []const u8,
    cid: zat.Cid,
};

pub const Record = struct {
    list_type: ListType,
    name: ?[]const u8,
    items: []StrongRef,
    created_at: []const u8,
    updated_at: ?[]const u8,
};

pub const Error = error{
    InvalidRecord,
    WrongRecordType,
    UnknownListType,
    InvalidName,
    TooManyItems,
    InvalidStrongRefSubject,
    InvalidStrongRefUri,
    InvalidStrongRefCid,
    WrongItemCollection,
    OutOfMemory,
};

pub fn parse(
    allocator: std.mem.Allocator,
    value: zat.cbor.Value,
    list_collection: []const u8,
    track_collection: []const u8,
) Error!Record {
    const record_type = value.getString("$type") orelse return error.InvalidRecord;
    if (!std.mem.eql(u8, record_type, list_collection)) return error.WrongRecordType;

    const raw_list_type = value.getString("listType") orelse return error.UnknownListType;
    const list_type = ListType.parse(raw_list_type) orelse return error.UnknownListType;
    const raw_items = value.getArray("items") orelse return error.InvalidRecord;
    if (raw_items.len > max_items) return error.TooManyItems;

    const created_at = value.getString("createdAt") orelse return error.InvalidRecord;
    if (created_at.len == 0) return error.InvalidRecord;
    const updated_at = optionalString(value, "updatedAt") catch return error.InvalidRecord;
    const name = optionalString(value, "name") catch return error.InvalidRecord;
    if (name) |text| {
        lexicon_string.validate(text, 256, 64) catch return error.InvalidName;
    }

    const items = try allocator.alloc(StrongRef, raw_items.len);
    for (raw_items, items) |raw_item, *item| {
        item.* = try parseItem(raw_item, track_collection);
    }

    return .{
        .list_type = list_type,
        .name = name,
        .items = items,
        .created_at = created_at,
        .updated_at = updated_at,
    };
}

fn optionalString(value: zat.cbor.Value, key: []const u8) !?[]const u8 {
    const field = value.get(key) orelse return null;
    return switch (field) {
        .text => |text| text,
        else => error.InvalidRecord,
    };
}

fn parseItem(value: zat.cbor.Value, track_collection: []const u8) Error!StrongRef {
    const subject = value.get("subject") orelse return error.InvalidStrongRefSubject;
    const uri = subject.getString("uri") orelse return error.InvalidStrongRefUri;
    const cid = subject.getCid("cid") orelse return error.InvalidStrongRefCid;

    const parsed_uri = zat.AtUri.parse(uri) orelse return error.InvalidStrongRefUri;
    if (zat.Did.parse(parsed_uri.authority()) == null or !parsed_uri.hasRkey())
        return error.InvalidStrongRefUri;
    const collection = parsed_uri.collection() orelse return error.InvalidStrongRefUri;
    if (!std.mem.eql(u8, collection, track_collection)) return error.WrongItemCollection;
    const parsed_cid = zat.Cid.fromBytes(cid.raw) catch return error.InvalidStrongRefCid;
    if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor)
        return error.InvalidStrongRefCid;

    return .{ .uri = uri, .cid = cid };
}

fn fixtureRecord(items: []const zat.cbor.Value) zat.cbor.Value {
    return .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "name", .value = .{ .text = "An Album" } },
        .{ .key = "items", .value = .{ .array = items } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
}

test "list record preserves verified strong-reference order" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const cid_a = try zat.Cid.forDagCbor(a, "track-a");
    const cid_b = try zat.Cid.forDagCbor(a, "track-b");
    const items = [_]zat.cbor.Value{
        .{ .map = &.{.{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:a/fm.plyr.dev.track/a" } },
            .{ .key = "cid", .value = .{ .cid = cid_a } },
        } } }} },
        .{ .map = &.{.{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:b/fm.plyr.dev.track/b" } },
            .{ .key = "cid", .value = .{ .cid = cid_b } },
        } } }} },
    };

    const record = try parse(a, fixtureRecord(&items), "fm.plyr.dev.list", "fm.plyr.dev.track");
    try std.testing.expectEqual(ListType.album, record.list_type);
    try std.testing.expectEqual(@as(usize, 2), record.items.len);
    try std.testing.expectEqualStrings("at://did:plc:a/fm.plyr.dev.track/a", record.items[0].uri);
    try std.testing.expectEqualStrings("at://did:plc:b/fm.plyr.dev.track/b", record.items[1].uri);
}

test "list record rejects text CIDs and cross-environment members" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const cid = try zat.Cid.forDagCbor(a, "track");

    const text_cid_items = [_]zat.cbor.Value{.{ .map = &.{.{ .key = "subject", .value = .{ .map = &.{
        .{ .key = "uri", .value = .{ .text = "at://did:plc:a/fm.plyr.dev.track/a" } },
        .{ .key = "cid", .value = .{ .text = "bafy-not-a-link" } },
    } } }} }};
    try std.testing.expectError(
        error.InvalidStrongRefCid,
        parse(a, fixtureRecord(&text_cid_items), "fm.plyr.dev.list", "fm.plyr.dev.track"),
    );

    const foreign_items = [_]zat.cbor.Value{.{ .map = &.{.{ .key = "subject", .value = .{ .map = &.{
        .{ .key = "uri", .value = .{ .text = "at://did:plc:a/fm.plyr.track/a" } },
        .{ .key = "cid", .value = .{ .cid = cid } },
    } } }} }};
    try std.testing.expectError(
        error.WrongItemCollection,
        parse(a, fixtureRecord(&foreign_items), "fm.plyr.dev.list", "fm.plyr.dev.track"),
    );
}

test "list name observes lexicon byte and grapheme limits" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var combining_name: std.ArrayList(u8) = .empty;
    defer combining_name.deinit(a);
    for (0..64) |_| try combining_name.appendSlice(a, "e\u{301}");

    const valid: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "name", .value = .{ .text = combining_name.items } },
        .{ .key = "items", .value = .{ .array = &.{} } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    _ = try parse(a, valid, "fm.plyr.dev.list", "fm.plyr.dev.track");

    try combining_name.appendSlice(a, "x");
    const too_many: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "name", .value = .{ .text = combining_name.items } },
        .{ .key = "items", .value = .{ .array = &.{} } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    try std.testing.expectError(
        error.InvalidName,
        parse(a, too_many, "fm.plyr.dev.list", "fm.plyr.dev.track"),
    );

    const too_wide = "x" ** 257;
    const too_wide_record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "name", .value = .{ .text = too_wide } },
        .{ .key = "items", .value = .{ .array = &.{} } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    try std.testing.expectError(
        error.InvalidName,
        parse(a, too_wide_record, "fm.plyr.dev.list", "fm.plyr.dev.track"),
    );
}
