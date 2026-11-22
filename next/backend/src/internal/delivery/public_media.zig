//! plyr's public R2 buckets were first exposed on `r2.dev` hosts, which
//! Cloudflare rate-limits and never caches. Records written then still name
//! those hosts; the same objects are served, edge-cached, from the CDN domains.

const std = @import("std");

const Rewrite = struct { from: []const u8, to: []const u8 };

const rewrites = [_]Rewrite{
    .{ .from = "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/", .to = "https://audio.plyr.fm/" },
    .{ .from = "https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/", .to = "https://images.plyr.fm/" },
};

/// The CDN address for a public bucket URL; any other URL is returned as is.
pub fn canonical(allocator: std.mem.Allocator, url: []const u8) std.mem.Allocator.Error![]const u8 {
    for (rewrites) |rewrite| {
        if (std.mem.startsWith(u8, url, rewrite.from))
            return std.mem.concat(allocator, u8, &.{ rewrite.to, url[rewrite.from.len..] });
    }
    return url;
}

/// next's cover art worker (next/services/audio/src/images.ts): copies a cover off
/// its PDS on first request, keeps it only if it hashes to the CID, and serves
/// sized variants with `&w=`.
pub const image_origin = "https://plyr-next-audio.n8-3e9.workers.dev/images/";

/// Like `canonical`, and a PDS `getBlob` cover moves to next's image worker: a PDS
/// serves only the full-size original and may drop a blob nothing references.
/// Only for image fields: audio keeps its own delivery path.
pub fn canonicalImage(allocator: std.mem.Allocator, url: []const u8) std.mem.Allocator.Error![]const u8 {
    const blob = getBlob(url) orelse return canonical(allocator, url);
    // PDSes write the DID either plain or with its colons escaped
    const did = try std.mem.replaceOwned(u8, allocator, blob.did, "%3A", ":");
    defer allocator.free(did);
    const plain = try std.mem.replaceOwned(u8, allocator, did, "%3a", ":");
    defer allocator.free(plain);
    if (!plainDid(plain)) return canonical(allocator, url);
    return std.fmt.allocPrint(allocator, "{s}{s}?did={s}", .{ image_origin, blob.cid, plain });
}

/// Like `canonicalImage` for a URL the caller allocated with `allocator`.
pub fn canonicalImageOwned(allocator: std.mem.Allocator, url: ?[]const u8) std.mem.Allocator.Error!?[]const u8 {
    const value = url orelse return null;
    const result = try canonicalImage(allocator, value);
    if (result.ptr != value.ptr) allocator.free(value);
    return result;
}

const Blob = struct { did: []const u8, cid: []const u8 };

/// The DID and raw CID of an https `com.atproto.sync.getBlob` URL.
fn getBlob(url: []const u8) ?Blob {
    if (!std.mem.startsWith(u8, url, "https://")) return null;
    const marker = "/xrpc/com.atproto.sync.getBlob?";
    const at = std.mem.indexOf(u8, url, marker) orelse return null;
    if (std.mem.indexOfAny(u8, url["https://".len..at], "/?#@") != null) return null;
    var did: ?[]const u8 = null;
    var cid: ?[]const u8 = null;
    var params = std.mem.splitScalar(u8, url[at + marker.len ..], '&');
    while (params.next()) |param| {
        if (std.mem.startsWith(u8, param, "did=")) did = param[4..];
        if (std.mem.startsWith(u8, param, "cid=")) cid = param[4..];
    }
    const d = did orelse return null;
    const c = cid orelse return null;
    if (d.len == 0 or !rawCid(c)) return null;
    return .{ .did = d, .cid = c };
}

fn plainDid(value: []const u8) bool {
    if (!std.mem.startsWith(u8, value, "did:plc:") and !std.mem.startsWith(u8, value, "did:web:")) return false;
    if (value.len > 256) return false;
    for (value) |c| switch (c) {
        'a'...'z', 'A'...'Z', '0'...'9', ':', '.', '-' => {},
        else => return false,
    };
    return true;
}

/// CIDv1, raw codec, sha2-256, base32: what the worker can verify.
fn rawCid(value: []const u8) bool {
    if (value.len != 59 or !std.mem.startsWith(u8, value, "bafkrei")) return false;
    for (value) |c| switch (c) {
        'a'...'z', '2'...'7' => {},
        else => return false,
    };
    return true;
}

/// Like `canonical` for a URL the caller allocated with `allocator`: a
/// rewritten URL replaces it and the original is freed.
pub fn canonicalOwned(allocator: std.mem.Allocator, url: ?[]const u8) std.mem.Allocator.Error!?[]const u8 {
    const value = url orelse return null;
    const result = try canonical(allocator, value);
    if (result.ptr != value.ptr) allocator.free(value);
    return result;
}

test "public bucket hosts move to their CDN domains" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    try std.testing.expectEqualStrings(
        "https://audio.plyr.fm/audio/89d18ada205c48ad.mp3",
        try canonical(allocator, "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/audio/89d18ada205c48ad.mp3"),
    );
    try std.testing.expectEqualStrings(
        "https://images.plyr.fm/images/398147982ab1d2b0.png",
        try canonical(allocator, "https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/398147982ab1d2b0.png"),
    );
    for ([_][]const u8{
        "https://audio.plyr.fm/audio/a.mp3",
        "https://pub-68f2c7379f204d81bdf65152b0ff0207.r2.dev/costs.json",
        "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:a&cid=b",
    }) |url| try std.testing.expectEqualStrings(url, try canonical(allocator, url));
}

test "PDS getBlob covers move to next's image worker" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const cid = "bafkreifbec5sqkptigb5akdpouwbpw3loe44blnlsquk3spgt6ezeefyuq";
    try std.testing.expectEqualStrings(
        image_origin ++ cid ++ "?did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
        try canonicalImage(allocator, "https://zds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa&cid=" ++ cid),
    );
    try std.testing.expectEqualStrings(
        image_origin ++ cid ++ "?did=did:web:artist.example",
        try canonicalImage(allocator, "https://pds.example/xrpc/com.atproto.sync.getBlob?cid=" ++ cid ++ "&did=did:web:artist.example"),
    );
    try std.testing.expectEqualStrings(
        image_origin ++ cid ++ "?did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
        try canonicalImage(allocator, "https://zds.example/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa&cid=" ++ cid),
    );
    try std.testing.expectEqualStrings(
        "https://images.plyr.fm/images/a.png",
        try canonicalImage(allocator, "https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/a.png"),
    );
    for ([_][]const u8{
        "http://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:a&cid=" ++ cid,
        "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:a&cid=bafyreibad",
        "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:key:z6Mk&cid=" ++ cid,
        "https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:a%26w%3D1&cid=" ++ cid,
        "https://user@pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:a&cid=" ++ cid,
        "https://images.plyr.fm/images/a.png",
    }) |url| try std.testing.expectEqualStrings(url, try canonicalImage(allocator, url));
    const owned = try canonicalImageOwned(std.testing.allocator, try std.testing.allocator.dupe(u8, "https://zds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:aaaaaaaaaaaaaaaaaaaaaaaa&cid=" ++ cid));
    defer std.testing.allocator.free(owned.?);
    try std.testing.expect(std.mem.startsWith(u8, owned.?, image_origin));
}

test "an owned URL is replaced without leaking" {
    const allocator = std.testing.allocator;
    const owned = try canonicalOwned(allocator, try allocator.dupe(u8, "https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/a.png"));
    defer allocator.free(owned.?);
    try std.testing.expectEqualStrings("https://images.plyr.fm/images/a.png", owned.?);
    const kept = try canonicalOwned(allocator, try allocator.dupe(u8, "https://images.plyr.fm/images/a.png"));
    defer allocator.free(kept.?);
    try std.testing.expectEqual(@as(?[]const u8, null), try canonicalOwned(allocator, null));
}
