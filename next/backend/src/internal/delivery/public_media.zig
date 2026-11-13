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

test "an owned URL is replaced without leaking" {
    const allocator = std.testing.allocator;
    const owned = try canonicalOwned(allocator, try allocator.dupe(u8, "https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/images/a.png"));
    defer allocator.free(owned.?);
    try std.testing.expectEqualStrings("https://images.plyr.fm/images/a.png", owned.?);
    const kept = try canonicalOwned(allocator, try allocator.dupe(u8, "https://images.plyr.fm/images/a.png"));
    defer allocator.free(kept.?);
    try std.testing.expectEqual(@as(?[]const u8, null), try canonicalOwned(allocator, null));
}
