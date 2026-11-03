//! Jetstream records arrive as atproto JSON. This maps them back onto the
//! DAG-CBOR data model the record parsers read, and checks the result hashes
//! to the CID the stream reported, so a record is only projected when its
//! JSON round-trips to exactly the bytes the author signed.

const std = @import("std");
const zat = @import("zat");

const cbor = zat.cbor;

pub const Error = error{ OutOfMemory, InvalidRecord, RecordCidMismatch };

/// Convert an atproto-JSON value: `{"$link": cid}` becomes a CID link and
/// `{"$bytes": base64}` becomes bytes. Floats are rejected (not in the atproto
/// data model).
pub fn toCbor(arena: std.mem.Allocator, value: std.json.Value) Error!cbor.Value {
    return switch (value) {
        .null => .null,
        .bool => |b| .{ .boolean = b },
        .integer => |i| if (i >= 0)
            .{ .unsigned = @intCast(i) }
        else
            .{ .negative = i },
        .float, .number_string => error.InvalidRecord,
        .string => |text| .{ .text = text },
        .array => |items| blk: {
            const out = try arena.alloc(cbor.Value, items.items.len);
            for (items.items, 0..) |item, index| out[index] = try toCbor(arena, item);
            break :blk .{ .array = out };
        },
        .object => |object| blk: {
            if (object.count() == 1) {
                if (object.get("$link")) |link| {
                    if (link != .string) return error.InvalidRecord;
                    const cid = zat.Cid.fromString(arena, link.string) catch return error.InvalidRecord;
                    break :blk .{ .cid = cid };
                }
                if (object.get("$bytes")) |encoded| {
                    if (encoded != .string) return error.InvalidRecord;
                    break :blk .{ .bytes = try decodeBase64(arena, encoded.string) };
                }
            }
            const entries = try arena.alloc(cbor.Value.MapEntry, object.count());
            var iterator = object.iterator();
            var index: usize = 0;
            while (iterator.next()) |entry| : (index += 1) {
                entries[index] = .{
                    .key = entry.key_ptr.*,
                    .value = try toCbor(arena, entry.value_ptr.*),
                };
            }
            break :blk .{ .map = entries };
        },
    };
}

/// Convert and check the record against the CID the stream reported.
pub fn verified(arena: std.mem.Allocator, value: std.json.Value, cid_text: []const u8) Error!struct {
    value: cbor.Value,
    cid: zat.Cid,
} {
    const record = try toCbor(arena, value);
    const claimed = zat.Cid.fromString(arena, cid_text) catch return error.InvalidRecord;
    const encoded = cbor.encodeAlloc(arena, record) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidRecord,
    };
    const computed = try zat.Cid.forDagCbor(arena, encoded);
    if (!std.mem.eql(u8, computed.raw, claimed.raw)) return error.RecordCidMismatch;
    return .{ .value = record, .cid = claimed };
}

fn decodeBase64(arena: std.mem.Allocator, text: []const u8) Error![]const u8 {
    // atproto JSON uses unpadded standard base64; accept padded input too.
    const trimmed = std.mem.trimEnd(u8, text, "=");
    const decoder = std.base64.standard_no_pad.Decoder;
    const size = decoder.calcSizeForSlice(trimmed) catch return error.InvalidRecord;
    const out = try arena.alloc(u8, size);
    decoder.decode(out, trimmed) catch return error.InvalidRecord;
    return out;
}

test "jetstream JSON round-trips to the record CID" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const record: cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.stg.track" } },
        .{ .key = "title", .value = .{ .text = "a song" } },
        .{ .key = "duration", .value = .{ .unsigned = 180 } },
        .{ .key = "offset", .value = .{ .negative = -3 } },
        .{ .key = "explicit", .value = .{ .boolean = false } },
        .{ .key = "sig", .value = .{ .bytes = "\x01\x02\x03" } },
        .{ .key = "audioBlob", .value = .{ .map = &.{
            .{ .key = "$type", .value = .{ .text = "blob" } },
            .{ .key = "ref", .value = .{ .cid = try zat.Cid.forDagCbor(arena, "audio") } },
            .{ .key = "mimeType", .value = .{ .text = "audio/mpeg" } },
            .{ .key = "size", .value = .{ .unsigned = 1234 } },
        } } },
    } };
    const encoded = try cbor.encodeAlloc(arena, record);
    const cid_text = try (try zat.Cid.forDagCbor(arena, encoded)).toString(arena);
    const link = try (try zat.Cid.forDagCbor(arena, "audio")).toString(arena);
    const json_text = try std.fmt.allocPrint(arena,
        \\{{"title":"a song","$type":"fm.plyr.stg.track","duration":180,"offset":-3,
        \\"explicit":false,"sig":{{"$bytes":"AQID"}},
        \\"audioBlob":{{"$type":"blob","ref":{{"$link":"{s}"}},"mimeType":"audio/mpeg","size":1234}}}}
    , .{link});
    const parsed = try std.json.parseFromSliceLeaky(std.json.Value, arena, json_text, .{});
    const result = try verified(arena, parsed, cid_text);
    try std.testing.expectEqualStrings("a song", result.value.getString("title").?);

    const tampered = try std.json.parseFromSliceLeaky(std.json.Value, arena,
        \\{"title":"another song","$type":"fm.plyr.stg.track"}
    , .{});
    try std.testing.expectError(error.RecordCidMismatch, verified(arena, tampered, cid_text));
}
