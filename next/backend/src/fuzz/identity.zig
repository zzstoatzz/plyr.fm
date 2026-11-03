//! Public IDs and cursors arrive from clients. Each is base64url over a
//! canonical value, so the codec must round-trip, and a token it accepts
//! must be the one it would have issued: two tokens for one record split
//! caches and let a client mint IDs the server never handed out.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const record_id = @import("../internal/identity/record_id.zig");
const record_cursor = @import("../internal/identity/record_cursor.zig");
const scoped_record_cursor = @import("../internal/identity/scoped_record_cursor.zig");

const base64url = std.base64.url_safe_no_pad;
const prefixes = [_][]const u8{ "trk_", "alb_", "pls_" };

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "identity.id_round_trip", idRoundTrip },
        .{ "identity.id_canonical", idCanonical },
        .{ "identity.cursor_round_trip", cursorRoundTrip },
        .{ "identity.cursor_canonical", cursorCanonical },
        .{ "identity.scoped_cursor", scopedCursor },
    });
}

fn idRoundTrip(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const prefix = try gen.pick(case, []const u8, &prefixes);
    const uri = try gen.atUri(case, a);
    case.note("encode({s}, {s})", .{ prefix, uri });

    const buffer = try a.alloc(u8, record_id.encodedLength(prefix, uri));
    const id = record_id.encode(prefix, buffer, uri) catch {
        case.event("uri refused");
        const forged = try a.alloc(u8, prefix.len + base64url.Encoder.calcSize(uri.len));
        @memcpy(forged[0..prefix.len], prefix);
        _ = base64url.Encoder.encode(forged[prefix.len..], uri);
        const out = try a.alloc(u8, uri.len + 1);
        if (record_id.decode(prefix, out, forged)) |_|
            return case.fail("decode accepts an id for a uri encode refuses")
        else |_|
            return;
    };
    case.event("uri accepted");
    if (std.mem.indexOfAny(u8, id, "/+=") != null) return case.fail("id is not url-safe");
    const out = try a.alloc(u8, uri.len);
    const decoded = record_id.decode(prefix, out, id) catch return case.fail("an issued id does not decode");
    if (!std.mem.eql(u8, decoded, uri)) return case.fail("id does not round-trip");
    for (prefixes) |other| {
        if (std.mem.eql(u8, other, prefix)) continue;
        if (record_id.decode(other, out, id)) |_| return case.fail("id decodes under another prefix") else |_| {}
    }
}

/// a token derived from a valid id: dropped, flipped, or appended characters
fn mutatedToken(case: *hegel.TestCase, a: std.mem.Allocator, prefix: []const u8, payload: []const u8) ![]u8 {
    var token: std.ArrayList(u8) = .empty;
    try token.appendSlice(a, prefix);
    const encoded = try a.alloc(u8, base64url.Encoder.calcSize(payload.len));
    _ = base64url.Encoder.encode(encoded, payload);
    try token.appendSlice(a, encoded);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/";
    switch (try case.int(u8, 0, 6)) {
        0, 5, 6 => {},
        1 => if (token.items.len > prefix.len) {
            const at = prefix.len + try case.index(token.items.len - prefix.len);
            token.items[at] = alphabet[try case.index(alphabet.len)];
        },
        2 => if (token.items.len > prefix.len) {
            token.items[token.items.len - 1] = alphabet[try case.index(alphabet.len)];
        },
        3 => try gen.fromAlphabet(case, a, &token, alphabet, 1, 3),
        else => token.shrinkRetainingCapacity(prefix.len + try case.int(usize, 0, token.items.len - prefix.len)),
    }
    return token.toOwnedSlice(a);
}

fn idCanonical(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const prefix = try gen.pick(case, []const u8, &prefixes);
    const uri = try gen.atUri(case, a);
    const token = try mutatedToken(case, a, prefix, uri);
    case.note("decode({s}) from {s}", .{ token, uri });

    const out = try a.alloc(u8, token.len);
    const decoded = record_id.decode(prefix, out, token) catch return;
    case.event("token accepted");
    const again = try a.alloc(u8, record_id.encodedLength(prefix, decoded));
    const reissued = record_id.encode(prefix, again, decoded) catch return case.fail("accepted id names a uri encode refuses");
    case.note("decoded {s}, reissued {s}", .{ decoded, reissued });
    if (!std.mem.eql(u8, reissued, token)) {
        case.event("non-canonical token accepted");
        return case.fail("an accepted id is not the id the server issues for it");
    }
}

fn timestamp(case: *hegel.TestCase) !i64 {
    return switch (try case.int(u8, 0, 3)) {
        0, 3 => case.int(i64, 0, 2_000_000_000_000_000),
        1 => try gen.pick(case, i64, &.{ 0, 253_402_300_799_999_999, 253_402_300_800_000_000, -1, std.math.maxInt(i64), std.math.minInt(i64) }),
        else => case.int(i64, std.math.minInt(i64), std.math.maxInt(i64)),
    };
}

fn cursorRoundTrip(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const cursor: record_cursor.Cursor = .{ .created_at_us = try timestamp(case), .at_uri = try gen.atUri(case, a) };
    case.note("encode({d}, {s})", .{ cursor.created_at_us, cursor.at_uri });
    const token = record_cursor.encode(a, "trkcur_", cursor) catch {
        case.event("cursor refused");
        return;
    };
    case.event("cursor accepted");
    const storage = try a.alloc(u8, token.len);
    const decoded = record_cursor.decode(storage, "trkcur_", token) catch return case.fail("an issued cursor does not decode");
    if (decoded.created_at_us != cursor.created_at_us or !std.mem.eql(u8, decoded.at_uri, cursor.at_uri))
        return case.fail("cursor does not round-trip");
}

fn cursorCanonical(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    var raw: std.ArrayList(u8) = .empty;
    try raw.append(a, try gen.pick(case, u8, &.{ 1, 1, 1, 0, 2 }));
    var stamp: [8]u8 = undefined;
    std.mem.writeInt(i64, &stamp, try timestamp(case), .big);
    try raw.appendSlice(a, &stamp);
    try raw.appendSlice(a, try gen.atUri(case, a));
    const token = try mutatedToken(case, a, "trkcur_", raw.items);
    case.note("decode({s})", .{token});

    const storage = try a.alloc(u8, token.len);
    const decoded = record_cursor.decode(storage, "trkcur_", token) catch return;
    case.event("cursor accepted");
    const reissued = record_cursor.encode(a, "trkcur_", decoded) catch return case.fail("accepted cursor carries values encode refuses");
    if (!std.mem.eql(u8, reissued, token)) {
        case.event("non-canonical cursor accepted");
        return case.fail("an accepted cursor is not the cursor the server issues for it");
    }
}

fn scopedCursor(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const scope = try gen.pick(case, []const u8, &.{ "global", "owner:did:plc:owner", "owner:did:plc:other", "o" });
    const cursor: scoped_record_cursor.Cursor = .{ .created_at_us = try timestamp(case), .at_uri = try gen.atUri(case, a) };
    case.note("encode({s}, {d}, {s})", .{ scope, cursor.created_at_us, cursor.at_uri });
    const token = scoped_record_cursor.encode(a, "plscur_", scope, cursor) catch return;
    case.event("cursor accepted");
    const storage = try a.alloc(u8, token.len);
    const expected = try gen.pick(case, []const u8, &.{ scope, scope, "global", "owner:did:plc:owner" });
    case.note("decode under {s}", .{expected});
    if (scoped_record_cursor.decode(storage, "plscur_", expected, token)) |decoded| {
        if (!std.mem.eql(u8, expected, scope)) return case.fail("cursor decodes under another scope");
        if (decoded.created_at_us != cursor.created_at_us or !std.mem.eql(u8, decoded.at_uri, cursor.at_uri))
            return case.fail("scoped cursor does not round-trip");
    } else |err| {
        if (std.mem.eql(u8, expected, scope)) return case.fail("an issued scoped cursor does not decode");
        if (err != error.CursorScopeMismatch) return case.fail("cross-scope decode fails with the wrong error");
    }

    // arbitrary tokens under the prefix must not crash the decoder
    const token2 = try mutatedToken(case, a, "plscur_", try gen.bytes(case, a, 64));
    _ = scoped_record_cursor.decode(storage[0..@min(storage.len, token2.len)], "plscur_", scope, token2) catch {};
}
