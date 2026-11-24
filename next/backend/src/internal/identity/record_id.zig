//! Reversible REST identifiers for canonical ATProto records.
//!
//! Resource-specific wrappers supply a short prefix (`trk_`, `alb_`, ...).
//! A record in plyr.fm's own collection from a did:plc account gets the short
//! form, `trk_<plc id>.<rkey>`: the collection is implied by the prefix, so the
//! id is still the whole AT-URI and another index rebuilds the same one. Every
//! other record keeps the long form, base64url of the complete AT-URI. Each
//! record has exactly one id: decode refuses the long form of a record that
//! has a short one. `decodeAnyForm` also takes those older long ids, for
//! clients that still hold them.

const std = @import("std");
const zat = @import("zat");

const encoder = std.base64.url_safe_no_pad.Encoder;
const decoder = std.base64.url_safe_no_pad.Decoder;

const plc_authority = "did:plc:";
const plc_id_len = 24;
const uri_scheme = "at://";

/// The collection a prefix's short form stands for. These are the published
/// NSIDs, not the deployment's configured ones, so a short id means the same
/// record wherever it is read.
fn shortCollection(prefix: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, prefix, "trk_")) return "fm.plyr.track";
    if (std.mem.eql(u8, prefix, "alb_") or std.mem.eql(u8, prefix, "pls_")) return "fm.plyr.list";
    return null;
}

/// Room `decode` needs for `id`: a short id expands to a longer AT-URI.
pub fn decodedLength(id: []const u8) usize {
    return id.len + uri_scheme.len + plc_authority.len + "/fm.plyr.track/".len;
}

pub fn encodedLength(prefix: []const u8, at_uri: []const u8) usize {
    if (shortParts(prefix, at_uri)) |parts| return prefix.len + parts.plc.len + 1 + parts.rkey.len;
    return prefix.len + encoder.calcSize(at_uri.len);
}

pub fn encode(prefix: []const u8, destination: []u8, at_uri: []const u8) ![]const u8 {
    try validateRecordUri(at_uri);
    const required = encodedLength(prefix, at_uri);
    if (destination.len < required) return error.NoSpaceLeft;

    @memcpy(destination[0..prefix.len], prefix);
    if (shortParts(prefix, at_uri)) |parts| {
        var at = prefix.len;
        @memcpy(destination[at..][0..parts.plc.len], parts.plc);
        at += parts.plc.len;
        destination[at] = '.';
        at += 1;
        @memcpy(destination[at..][0..parts.rkey.len], parts.rkey);
    } else {
        _ = encoder.encode(destination[prefix.len..required], at_uri);
    }
    return destination[0..required];
}

/// The AT-URI of an id this codec issues, and only of one it issues.
pub fn decode(prefix: []const u8, destination: []u8, id: []const u8) ![]const u8 {
    const at_uri = try decodeAnyForm(prefix, destination, id);
    if (!isShort(id[prefix.len..]) and shortParts(prefix, at_uri) != null) return error.InvalidRecordId;
    return at_uri;
}

/// Like `decode`, but also accepts the long form of a record that now has a
/// short id, so ids issued before the short form keep resolving.
pub fn decodeAnyForm(prefix: []const u8, destination: []u8, id: []const u8) ![]const u8 {
    if (!std.mem.startsWith(u8, id, prefix)) return error.InvalidRecordId;
    const payload = id[prefix.len..];
    if (isShort(payload)) return decodeShort(prefix, destination, payload);

    const required = decoder.calcSizeForSlice(payload) catch return error.InvalidRecordId;
    if (destination.len < required) return error.NoSpaceLeft;
    decoder.decode(destination[0..required], payload) catch return error.InvalidRecordId;

    const at_uri = destination[0..required];
    validateRecordUri(at_uri) catch return error.InvalidRecordId;
    return at_uri;
}

const ShortParts = struct { plc: []const u8, rkey: []const u8 };

fn shortParts(prefix: []const u8, at_uri: []const u8) ?ShortParts {
    const collection = shortCollection(prefix) orelse return null;
    const parsed = zat.AtUri.parse(at_uri) orelse return null;
    const authority = parsed.authority();
    if (!std.mem.startsWith(u8, authority, plc_authority)) return null;
    const plc = authority[plc_authority.len..];
    if (!isPlcId(plc)) return null;
    if (!std.mem.eql(u8, parsed.collection() orelse return null, collection)) return null;
    const rkey = parsed.rkey() orelse return null;
    if (!isShortRkey(rkey)) return null;
    // the short form must name exactly this uri, nothing after the rkey
    if (at_uri.len != uri_scheme.len + authority.len + 1 + collection.len + 1 + rkey.len) return null;
    return .{ .plc = plc, .rkey = rkey };
}

fn isShort(payload: []const u8) bool {
    // base64url never contains '.', so the separator alone tells the forms apart
    return payload.len > plc_id_len + 1 and payload[plc_id_len] == '.';
}

fn decodeShort(prefix: []const u8, destination: []u8, payload: []const u8) ![]const u8 {
    const collection = shortCollection(prefix) orelse return error.InvalidRecordId;
    const plc = payload[0..plc_id_len];
    const rkey = payload[plc_id_len + 1 ..];
    if (!isPlcId(plc) or !isShortRkey(rkey)) return error.InvalidRecordId;
    const at_uri = std.fmt.bufPrint(destination, uri_scheme ++ plc_authority ++ "{s}/{s}/{s}", .{ plc, collection, rkey }) catch
        return error.NoSpaceLeft;
    validateRecordUri(at_uri) catch return error.InvalidRecordId;
    if (shortParts(prefix, at_uri) == null) return error.InvalidRecordId;
    return at_uri;
}

fn isPlcId(value: []const u8) bool {
    if (value.len != plc_id_len) return false;
    for (value) |byte| switch (byte) {
        'a'...'z', '2'...'7' => {},
        else => return false,
    };
    return true;
}

/// Record keys that read cleanly in a URL path. Others (with ':') keep the long form.
fn isShortRkey(value: []const u8) bool {
    if (value.len == 0 or value.len > 512) return false;
    if (std.mem.eql(u8, value, ".") or std.mem.eql(u8, value, "..")) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '.' and byte != '_' and byte != '~' and byte != '-') return false;
    return true;
}

fn validateRecordUri(uri: []const u8) !void {
    const parsed = zat.AtUri.parse(uri) orelse return error.InvalidAtUri;
    if (!parsed.hasRkey()) return error.RecordUriRequired;
    if (zat.Did.parse(parsed.authority()) == null) return error.DidAuthorityRequired;
}

test "resource prefixes share one canonical record identifier codec" {
    const uri = "at://did:plc:artist/fm.plyr.list/3m123abc";
    var id_buffer: [256]u8 = undefined;
    const id = try encode("alb_", &id_buffer, uri);
    try std.testing.expect(std.mem.startsWith(u8, id, "alb_"));
    try std.testing.expect(std.mem.indexOfAny(u8, id, "/+=") == null);

    var uri_buffer: [256]u8 = undefined;
    try std.testing.expectEqualStrings(uri, try decode("alb_", &uri_buffer, id));
    try std.testing.expectError(error.InvalidRecordId, decode("trk_", &uri_buffer, id));
}

test "plyr.fm records from plc accounts get the short id" {
    const uri = "at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/3n2zqt7q3v522";
    var id_buffer: [256]u8 = undefined;
    const id = try encode("trk_", &id_buffer, uri);
    try std.testing.expectEqualStrings("trk_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522", id);
    try std.testing.expectEqual(id.len, encodedLength("trk_", uri));

    var uri_buffer: [256]u8 = undefined;
    try std.testing.expectEqualStrings(uri, try decode("trk_", &uri_buffer, id));
    try std.testing.expectError(error.InvalidRecordId, decode("alb_", &uri_buffer, id));

    const list = "at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.list/3n2zqt7q3v522";
    const album = try encode("alb_", &id_buffer, list);
    try std.testing.expectEqualStrings("alb_a3vq3hjlkz2nbf67bpv5z6qs.3n2zqt7q3v522", album);
    try std.testing.expectEqualStrings(list, try decode("alb_", &uri_buffer, album));
}

test "the long id of a record with a short id resolves only through decodeAnyForm" {
    const long = "trk_YXQ6Ly9kaWQ6cGxjOmEzdnEzaGpsa3oybmJmNjdicHY1ejZxcy9mbS5wbHlyLnRyYWNrLzNuMnpxdDdxM3Y1MjI";
    var uri_buffer: [256]u8 = undefined;
    try std.testing.expectError(error.InvalidRecordId, decode("trk_", &uri_buffer, long));
    try std.testing.expectEqualStrings(
        "at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/3n2zqt7q3v522",
        try decodeAnyForm("trk_", &uri_buffer, long),
    );
}

test "other accounts and collections keep the long id" {
    var id_buffer: [256]u8 = undefined;
    var uri_buffer: [256]u8 = undefined;
    for ([_][]const u8{
        "at://did:web:plyr.fm/fm.plyr.track/live-radio",
        "at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.dev.track/3n2zqt7q3v522",
        "at://did:plc:a3vq3hjlkz2nbf67bpv5z6qs/fm.plyr.track/key:with:colons",
        "at://did:plc:short/fm.plyr.track/3n2zqt7q3v522",
    }) |uri| {
        const id = try encode("trk_", &id_buffer, uri);
        try std.testing.expect(std.mem.indexOfScalar(u8, id, '.') == null);
        try std.testing.expectEqualStrings(uri, try decode("trk_", &uri_buffer, id));
    }
    // a short id for a key the short form does not cover is not one we issue
    try std.testing.expectError(error.InvalidRecordId, decode("trk_", &uri_buffer, "trk_a3vq3hjlkz2nbf67bpv5z6qs.a:b"));
    try std.testing.expectError(error.InvalidRecordId, decode("trk_", &uri_buffer, "trk_A3VQ3HJLKZ2NBF67BPV5Z6QS.3n2zqt7q3v522"));
    try std.testing.expectError(error.InvalidRecordId, decode("trk_", &uri_buffer, "trk_a3vq3hjlkz2nbf67bpv5z6qs.."));
}
