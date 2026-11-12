//! Records come from any repository on the network. Arbitrary DAG-CBOR must
//! never crash a parser, and a track record built field by field from
//! `lexicons/track.json` must be accepted exactly when every field is.

const std = @import("std");
const hegel = @import("hegel");
const zat = @import("zat");
const gen = @import("gen.zig");
const track_record = @import("../internal/atproto/track_record.zig");
const list_record = @import("../internal/atproto/list_record.zig");
const like_record = @import("../internal/atproto/like_record.zig");
const profile_record = @import("../internal/atproto/profile_record.zig");
const json_record = @import("../internal/atproto/json_record.zig");

const cbor = zat.cbor;
const track_nsid = "fm.plyr.dev.track";
const list_nsid = "fm.plyr.dev.list";
const like_nsid = "fm.plyr.dev.like";
const profile_nsid = "fm.plyr.dev.actor.profile";

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "records.track_model", trackModel },
        .{ "records.cbor_bytes", cborBytes },
        .{ "records.cbor_values", cborValues },
        .{ "records.jetstream_json", jetstreamJson },
    });
}

const Kind = enum { absent, valid, invalid };

const Field = struct {
    key: []const u8,
    kind: Kind,
    value: cbor.Value,
};

fn kindOf(case: *hegel.TestCase, required: bool) !Kind {
    // invalid fields are rarer, so most cases reach the checks after them
    return switch (try case.int(u8, 0, 9)) {
        0 => .invalid,
        1, 2, 3 => if (required) .valid else .absent,
        else => .valid,
    };
}

fn utf8Max(case: *hegel.TestCase, a: std.mem.Allocator, min: usize, max: usize) ![]const u8 {
    var text = try gen.utf8(case, a, 8);
    while (text.len > max) {
        var end = text.len - 1;
        while (end > 0 and (text[end] & 0xc0) == 0x80) end -= 1;
        text = text[0..end];
    }
    if (text.len < min) return try gen.pick(case, []const u8, &.{ "x", "Song", "é" });
    return text;
}

fn repeated(a: std.mem.Allocator, n: usize) ![]const u8 {
    const out = try a.alloc(u8, n);
    @memset(out, 'a');
    return out;
}

fn boundedString(case: *hegel.TestCase, a: std.mem.Allocator, kind: Kind, min: usize, max: usize) !cbor.Value {
    return switch (kind) {
        .valid => .{ .text = if (try case.int(u8, 0, 5) == 0) try repeated(a, if (try case.boolean()) max else @max(min, 1)) else try utf8Max(case, a, min, max) },
        else => switch (try case.int(u8, 0, 2)) {
            0 => .{ .text = try repeated(a, max + 1) },
            1 => if (min > 0) .{ .text = "" } else .{ .unsigned = 1 },
            else => .{ .unsigned = 7 },
        },
    };
}

fn uriValue(case: *hegel.TestCase, kind: Kind) !cbor.Value {
    return switch (kind) {
        .valid => .{ .text = try gen.pick(case, []const u8, &.{ "https://media.example/a.flac", "at://did:plc:a/fm.plyr.dev.track/r", "did:plc:alice", "https://x.example/%20?q=1#f" }) },
        else => try gen.pick(case, cbor.Value, &.{ .{ .text = "relative/path" }, .{ .text = "" }, .{ .text = "://nope" }, .{ .boolean = true } }),
    };
}

fn blobValue(case: *hegel.TestCase, a: std.mem.Allocator, kind: Kind) !cbor.Value {
    const raw_cid = try zat.Cid.create(a, 1, cbor.Codec.raw, cbor.HashFn.sha2_256, "audio");
    const dag_cid = try zat.Cid.forDagCbor(a, "audio");
    var type_name: []const u8 = "blob";
    var cid = raw_cid;
    var mime: []const u8 = try gen.pick(case, []const u8, &.{ "audio/flac", "audio/mpeg", "audio/x-wav" });
    var size: u64 = try case.int(u64, 0, track_record.max_blob_size);
    if (kind == .invalid) switch (try case.int(u8, 0, 4)) {
        0 => type_name = "blub",
        1 => cid = dag_cid,
        2 => mime = try gen.pick(case, []const u8, &.{ "image/png", "audio/", "audio/a b", "audio" }),
        3 => size = track_record.max_blob_size + 1,
        else => return .{ .text = "blob" },
    };
    const entries = try a.dupe(cbor.Value.MapEntry, &.{
        .{ .key = "$type", .value = .{ .text = type_name } },
        .{ .key = "ref", .value = .{ .cid = cid } },
        .{ .key = "mimeType", .value = .{ .text = mime } },
        .{ .key = "size", .value = .{ .unsigned = size } },
    });
    return .{ .map = entries };
}

fn datetimeValue(case: *hegel.TestCase, kind: Kind) !cbor.Value {
    return switch (kind) {
        .valid => .{ .text = try gen.pick(case, []const u8, &.{ "2026-08-08T12:00:00Z", "2024-02-29T23:59:59.123456+05:30", "1985-04-12T23:20:50.1Z" }) },
        else => try gen.pick(case, cbor.Value, &.{ .{ .text = "2026-02-30T00:00:00Z" }, .{ .text = "yesterday" }, .{ .text = "2026-08-08T12:00:00" }, .{ .unsigned = 1 } }),
    };
}

fn featuresValue(case: *hegel.TestCase, a: std.mem.Allocator, kind: Kind) !cbor.Value {
    const count: usize = if (kind == .invalid and try case.boolean()) 11 else try case.int(usize, 0, 10);
    const bad = if (kind == .invalid and count > 0 and count <= 10) try case.index(count) else count;
    const items = try a.alloc(cbor.Value, count);
    for (items, 0..) |*item, i| {
        var did: []const u8 = "did:plc:featured";
        var extra: cbor.Value.MapEntry = .{ .key = "displayName", .value = .{ .text = "Old" } };
        if (i == bad) switch (try case.int(u8, 0, 3)) {
            0 => did = "not-a-did",
            1 => extra = .{ .key = "handle", .value = .{ .text = "-bad-.example" } },
            2 => extra = .{ .key = "displayName", .value = .{ .text = try repeated(a, 257) } },
            else => extra = .{ .key = "handle", .value = .{ .unsigned = 1 } },
        } else if (try case.boolean()) {
            extra = .{ .key = "handle", .value = .{ .text = "artist.example" } };
        }
        item.* = .{ .map = try a.dupe(cbor.Value.MapEntry, &.{
            .{ .key = "did", .value = .{ .text = did } },
            extra,
        }) };
    }
    if (kind == .invalid and count == 0) return .{ .text = "features" };
    return .{ .array = items };
}

fn labelsValue(case: *hegel.TestCase, a: std.mem.Allocator, kind: Kind) !cbor.Value {
    var type_name: []const u8 = "com.atproto.label.defs#selfLabels";
    const count: usize = if (kind == .invalid and try case.boolean()) 11 else try case.int(usize, 0, 10);
    const bad = if (kind == .invalid and count > 0 and count <= 10) try case.index(count) else count;
    if (kind == .invalid and count == 0) type_name = "com.atproto.label.defs#label";
    const values = try a.alloc(cbor.Value, count);
    for (values, 0..) |*value, i| {
        const val: []const u8 = if (i == bad) (if (try case.boolean()) "" else try repeated(a, 129)) else "nudity";
        value.* = .{ .map = try a.dupe(cbor.Value.MapEntry, &.{.{ .key = "val", .value = .{ .text = val } }}) };
    }
    return .{ .map = try a.dupe(cbor.Value.MapEntry, &.{
        .{ .key = "$type", .value = .{ .text = type_name } },
        .{ .key = "values", .value = .{ .array = values } },
    }) };
}

fn trackFields(case: *hegel.TestCase, a: std.mem.Allocator) !std.ArrayList(Field) {
    var fields: std.ArrayList(Field) = .empty;
    const Spec = struct { key: []const u8, required: bool };
    const specs = [_]Spec{
        .{ .key = "title", .required = true },
        .{ .key = "artist", .required = true },
        .{ .key = "fileType", .required = true },
        .{ .key = "createdAt", .required = true },
        .{ .key = "audioUrl", .required = false },
        .{ .key = "audioBlob", .required = false },
        .{ .key = "audioSpace", .required = false },
        .{ .key = "album", .required = false },
        .{ .key = "duration", .required = false },
        .{ .key = "features", .required = false },
        .{ .key = "imageUrl", .required = false },
        .{ .key = "supportGate", .required = false },
        .{ .key = "description", .required = false },
        .{ .key = "downloadPolicy", .required = false },
        .{ .key = "labels", .required = false },
    };
    for (specs) |spec| {
        const kind = try kindOf(case, spec.required);
        if (kind == .absent) {
            try fields.append(a, .{ .key = spec.key, .kind = .absent, .value = .null });
            continue;
        }
        const key = spec.key;
        const value: cbor.Value = if (std.mem.eql(u8, key, "title") or std.mem.eql(u8, key, "artist"))
            try boundedString(case, a, kind, 1, 256)
        else if (std.mem.eql(u8, key, "fileType"))
            try boundedString(case, a, kind, 1, 16)
        else if (std.mem.eql(u8, key, "album"))
            try boundedString(case, a, kind, 0, 256)
        else if (std.mem.eql(u8, key, "downloadPolicy"))
            (if (kind == .valid) cbor.Value{ .text = try gen.pick(case, []const u8, &.{ "open", "ask", "off", "supporters", "future" }) } else cbor.Value{ .boolean = false })
        else if (std.mem.eql(u8, key, "description"))
            try boundedString(case, a, kind, 0, 5000)
        else if (std.mem.eql(u8, key, "createdAt"))
            try datetimeValue(case, kind)
        else if (std.mem.eql(u8, key, "audioUrl") or std.mem.eql(u8, key, "imageUrl"))
            try uriValue(case, kind)
        else if (std.mem.eql(u8, key, "audioBlob"))
            try blobValue(case, a, kind)
        else if (std.mem.eql(u8, key, "audioSpace"))
            (if (kind == .valid)
                cbor.Value{ .text = "at://did:plc:artist/space/fm.plyr.dev.audio/supporters/did:plc:artist/fm.plyr.dev.track/3l2abc" }
            else
                try gen.pick(case, cbor.Value, &.{ .{ .text = "at://did:plc:artist/fm.plyr.dev.track/3l2abc" }, .{ .unsigned = 3 } }))
        else if (std.mem.eql(u8, key, "duration"))
            (if (kind == .valid)
                cbor.Value{ .unsigned = try gen.pick(case, u64, &.{ 0, 1, 180, track_record.max_lexicon_integer }) }
            else
                try gen.pick(case, cbor.Value, &.{ .{ .negative = -1 }, .{ .text = "180" }, .{ .unsigned = track_record.max_lexicon_integer + 1 } }))
        else if (std.mem.eql(u8, key, "features"))
            try featuresValue(case, a, kind)
        else if (std.mem.eql(u8, key, "labels"))
            try labelsValue(case, a, kind)
        else if (std.mem.eql(u8, key, "supportGate"))
            (if (kind == .valid)
                cbor.Value{ .map = try a.dupe(cbor.Value.MapEntry, &.{.{ .key = "type", .value = .{ .text = try gen.pick(case, []const u8, &.{ "any", "future" }) } }}) }
            else
                try gen.pick(case, cbor.Value, &.{ .{ .map = &.{} }, .{ .map = &.{.{ .key = "type", .value = .{ .text = "" } }} }, .{ .text = "any" } }))
        else
            unreachable;
        try fields.append(a, .{ .key = key, .kind = kind, .value = value });
    }
    return fields;
}

fn trackModel(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    var fields = try trackFields(case, a);
    var entries: std.ArrayList(cbor.Value.MapEntry) = .empty;
    try entries.append(a, .{ .key = "$type", .value = .{ .text = track_nsid } });
    var expect_ok = true;
    var has_audio = false;
    for (fields.items) |field| {
        case.note("{s}: {s}", .{ field.key, @tagName(field.kind) });
        if (field.kind == .absent) continue;
        try entries.append(a, .{ .key = field.key, .value = field.value });
        if (field.kind == .invalid) expect_ok = false;
        if (field.kind == .valid and (std.mem.eql(u8, field.key, "audioUrl") or
            std.mem.eql(u8, field.key, "audioBlob") or std.mem.eql(u8, field.key, "audioSpace")))
            has_audio = true;
    }
    for (fields.items[0..4]) |field| if (field.kind != .valid) {
        expect_ok = false;
    };
    if (!has_audio) expect_ok = false;
    fields.deinit(a);

    // through the wire format, as the ingester sees it
    const record: cbor.Value = .{ .map = entries.items };
    const encoded = try cbor.encodeAlloc(a, record);
    const decoded = cbor.decodeAll(a, encoded) catch return case.fail("zat cannot decode what it encoded");
    if (track_record.parse(a, decoded, track_nsid)) |_| {
        case.event("record accepted");
        if (!expect_ok) return case.fail("parser accepts a record the lexicon rejects");
    } else |err| {
        case.note("parse -> {s}", .{@errorName(err)});
        if (expect_ok) return case.fail("parser rejects a record the lexicon accepts");
    }
}

fn parseAll(a: std.mem.Allocator, value: cbor.Value) void {
    _ = track_record.parse(a, value, track_nsid) catch {};
    _ = list_record.parse(a, value, list_nsid, track_nsid) catch {};
    _ = like_record.parse(a, value, like_nsid, track_nsid) catch {};
    _ = profile_record.parse(value, profile_nsid) catch {};
}

fn cborBytes(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const data = try gen.bytes(case, a, 96);
    case.note("decodeAll({x})", .{data});
    const value = cbor.decodeAll(a, data) catch return;
    case.event("bytes decode");
    parseAll(a, value);
}

/// a random data-model value whose map keys are the ones parsers look up
fn randomValue(case: *hegel.TestCase, a: std.mem.Allocator, depth: u8) !cbor.Value {
    const keys = [_][]const u8{ "$type", "title", "artist", "fileType", "createdAt", "audioUrl", "audioBlob", "subject", "uri", "cid", "items", "values", "val", "did", "ref", "size", "mimeType", "displayName", "avatar", "bio", "name", "listType", "labels", "features", "supportGate", "type" };
    const texts = [_][]const u8{ track_nsid, list_nsid, like_nsid, profile_nsid, "blob", "2026-08-08T12:00:00Z", "at://did:plc:a/fm.plyr.dev.track/r", "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm", "did:plc:a", "audio/mpeg", "https://x.example/a", "", "album" };
    const choice = if (depth >= 4) try case.int(u8, 0, 4) else try case.int(u8, 0, 7);
    return switch (choice) {
        0 => .{ .unsigned = @as(u64, try case.int(u63, 0, std.math.maxInt(u63))) * 2 + @intFromBool(try case.boolean()) },
        1 => .{ .negative = try case.int(i64, std.math.minInt(i64), -1) },
        2 => .{ .text = try gen.pick(case, []const u8, &texts) },
        3 => .{ .boolean = try case.boolean() },
        4 => .{ .bytes = try gen.bytes(case, a, 8) },
        5 => .null,
        6 => blk: {
            const items = try a.alloc(cbor.Value, try case.int(usize, 0, 3));
            for (items) |*item| item.* = try randomValue(case, a, depth + 1);
            break :blk .{ .array = items };
        },
        else => blk: {
            var entries: std.ArrayList(cbor.Value.MapEntry) = .empty;
            const n = try case.int(usize, 0, 6);
            outer: for (0..n) |_| {
                const key = try gen.pick(case, []const u8, &keys);
                for (entries.items) |entry| if (std.mem.eql(u8, entry.key, key)) continue :outer;
                try entries.append(a, .{ .key = key, .value = try randomValue(case, a, depth + 1) });
            }
            break :blk .{ .map = entries.items };
        },
    };
}

fn cborValues(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const value = try randomValue(case, a, 0);
    const encoded = try cbor.encodeAlloc(a, value);
    case.note("value {x}", .{encoded});
    const decoded = cbor.decodeAll(a, encoded) catch return case.fail("zat cannot decode what it encoded");
    const again = try cbor.encodeAlloc(a, decoded);
    if (!std.mem.eql(u8, encoded, again)) return case.fail("dag-cbor does not round-trip");
    parseAll(a, decoded);
}

fn writeJson(a: std.mem.Allocator, out: *std.ArrayList(u8), value: cbor.Value) !void {
    switch (value) {
        .unsigned => |v| try out.print(a, "{d}", .{v}),
        .negative => |v| try out.print(a, "{d}", .{v}),
        .boolean => |v| try out.appendSlice(a, if (v) "true" else "false"),
        .null => try out.appendSlice(a, "null"),
        .text => |v| try out.print(a, "{f}", .{std.json.fmt(v, .{})}),
        .bytes => |v| {
            const encoded = try a.alloc(u8, std.base64.standard_no_pad.Encoder.calcSize(v.len));
            _ = std.base64.standard_no_pad.Encoder.encode(encoded, v);
            try out.print(a, "{{\"$bytes\":\"{s}\"}}", .{encoded});
        },
        .cid => |v| try out.print(a, "{{\"$link\":\"{s}\"}}", .{try v.toString(a)}),
        .array => |items| {
            try out.append(a, '[');
            for (items, 0..) |item, i| {
                if (i > 0) try out.append(a, ',');
                try writeJson(a, out, item);
            }
            try out.append(a, ']');
        },
        .map => |entries| {
            try out.append(a, '{');
            for (entries, 0..) |entry, i| {
                if (i > 0) try out.append(a, ',');
                try out.print(a, "{f}:", .{std.json.fmt(entry.key, .{})});
                try writeJson(a, out, entry.value);
            }
            try out.append(a, '}');
        },
        .float => unreachable,
    }
}

fn jetstreamJson(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const value = try randomValue(case, a, 0);
    const encoded = try cbor.encodeAlloc(a, value);
    const cid = try (try zat.Cid.forDagCbor(a, encoded)).toString(a);
    var text: std.ArrayList(u8) = .empty;
    try writeJson(a, &text, value);
    case.note("json {s}", .{text.items});

    const parsed = std.json.parseFromSliceLeaky(std.json.Value, a, text.items, .{}) catch
        return case.fail("record json does not parse");
    const ours = json_record.verified(a, parsed, cid) catch |err| {
        case.note("verified -> {s}", .{@errorName(err)});
        // the upstream converter is the reference for which json is a record
        if (cbor.fromJson(a, parsed)) |reference| {
            const reference_bytes = cbor.encodeAlloc(a, reference) catch return;
            if (std.mem.eql(u8, reference_bytes, encoded))
                return case.fail("a record's own json fails verification");
        } else |_| {}
        case.event("json the reference also rejects");
        return;
    };
    case.event("json verified");
    if (!std.mem.eql(u8, try cbor.encodeAlloc(a, ours.value), encoded))
        return case.fail("verified json decodes to a different record");

    // the same json must not verify against another record's cid
    const other = try cbor.encodeAlloc(a, try randomValue(case, a, 0));
    if (std.mem.eql(u8, other, encoded)) return;
    const other_cid = try (try zat.Cid.forDagCbor(a, other)).toString(a);
    if (json_record.verified(a, parsed, other_cid)) |_| {
        return case.fail("json verifies against another record's cid");
    } else |_| case.event("tampered cid refused");
}
