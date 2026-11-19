//! Next's labeler identity: the DID labels are signed as, its secp256k1
//! `#atproto_label` key, and where `queryLabels` is served.
//!
//! Until cutover the labeler is `did:web:api.next.plyr.fm` itself: its DID
//! document (served by the API) carries the label key and an
//! `#atproto_labeler` service. A DID points at one labeler endpoint, and
//! `moderation.plyr.fm`'s still points at prod's service, so taking over that
//! identity is a cutover step: set LABELER_DID and LABELER_SIGNING_KEY to its
//! values and point its DID document here.

const std = @import("std");
const zat = @import("zat");

pub const Labeler = struct {
    did: []const u8,
    keypair: zat.Keypair,

    /// LABELER_SIGNING_KEY: 64 hex chars (a secp256k1 secret, the format
    /// prod's labeler keeps). Unset disables the labeler.
    pub fn fromEnvironment(default_did: []const u8) !?Labeler {
        const raw = std.c.getenv("LABELER_SIGNING_KEY") orelse return null;
        const hex = std.mem.trim(u8, std.mem.span(raw), " \t\r\n");
        if (hex.len == 0) return null;
        const did = if (std.c.getenv("LABELER_DID")) |value| std.mem.span(value) else default_did;
        return try fromHex(did, hex);
    }

    pub fn fromHex(did: []const u8, hex: []const u8) !Labeler {
        if (hex.len != 64) return error.InvalidLabelerKey;
        var secret: [32]u8 = undefined;
        _ = std.fmt.hexToBytes(&secret, hex) catch return error.InvalidLabelerKey;
        return .{ .did = did, .keypair = zat.Keypair.fromSecretKey(.secp256k1, secret) catch return error.InvalidLabelerKey };
    }

    /// The key as a DID document's `publicKeyMultibase` (`z…`).
    pub fn publicKeyMultibase(self: *const Labeler, allocator: std.mem.Allocator) ![]const u8 {
        const did_key = try self.keypair.did(allocator);
        return did_key["did:key:".len..];
    }

    /// A signed label for `uri`, timestamped `now_ms`. Slices borrow from
    /// the arguments and `allocator`.
    pub fn sign(self: *const Labeler, allocator: std.mem.Allocator, uri: []const u8, value: []const u8, negate: bool, now_ms: i64) !zat.Label {
        var label: zat.Label = .{
            .src = self.did,
            .uri = uri,
            .val = value,
            .neg = negate,
            .cts = try formatTimestamp(allocator, now_ms),
        };
        const signature = try label.sign(allocator, &self.keypair);
        label.sig = try allocator.dupe(u8, &signature.bytes);
        return label;
    }
};

/// `2026-11-19T05:30:00.000Z`
pub fn formatTimestamp(allocator: std.mem.Allocator, ms: i64) ![]const u8 {
    const seconds: u64 = @intCast(@divFloor(ms, 1000));
    const millis: u64 = @intCast(@mod(ms, 1000));
    const epoch: std.time.epoch.EpochSeconds = .{ .secs = seconds };
    const day = epoch.getEpochDay().calculateYearDay();
    const month = day.calculateMonthDay();
    const clock = epoch.getDaySeconds();
    return std.fmt.allocPrint(allocator, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.{d:0>3}Z", .{
        day.year,
        month.month.numeric(),
        month.day_index + 1,
        clock.getHoursIntoDay(),
        clock.getMinutesIntoHour(),
        clock.getSecondsIntoMinute(),
        millis,
    });
}

test "labels are signed by the label key and verify against its did:key" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const labeler = try Labeler.fromHex("did:web:api.next.plyr.fm", "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d");
    const label = try labeler.sign(arena, "at://did:plc:a/fm.plyr.track/3k1", "copyright-violation", false, 1_795_066_200_000);
    try std.testing.expectEqualStrings("did:web:api.next.plyr.fm", label.src);
    try std.testing.expectEqual(@as(usize, 64), label.sig.?.len);
    const did_key = try labeler.keypair.did(arena);
    try label.verify(arena, did_key);
    try std.testing.expect(std.mem.startsWith(u8, try labeler.publicKeyMultibase(arena), "zQ3s"));

    var tampered = label;
    tampered.val = "porn";
    try std.testing.expectError(error.SignatureVerificationFailed, tampered.verify(arena, did_key));
    try std.testing.expectError(error.InvalidLabelerKey, Labeler.fromHex("did:x", "abc"));
}

test "label timestamps are RFC 3339 UTC with milliseconds" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    try std.testing.expectEqualStrings("1970-01-01T00:00:00.000Z", try formatTimestamp(arena_state.allocator(), 0));
    try std.testing.expectEqualStrings("2026-01-01T00:00:00.007Z", try formatTimestamp(arena_state.allocator(), 1_767_225_600_007));
}
