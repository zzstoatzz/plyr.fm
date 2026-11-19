//! The v1 public artist read model.
//!
//! Core profile fields remain flat for practical client compatibility. The
//! resource itself is admitted only through a verified authored profile and
//! current account-availability evidence. Transitional handle, display-name,
//! and preference fields retain field-level provenance instead of lending
//! legacy presentation state the profile record's authority.

const std = @import("std");

pub const Artist = struct {
    object: []const u8 = "artist",
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
    bio: ?[]const u8,
    avatar_url: ?[]const u8,
    show_liked_on_profile: bool,
    support_url: ?[]const u8,
    /// where the artist sells each release, from their plyr settings. plyr
    /// never sees the payment; these are links, not entitlements.
    offers: []const Offer = &.{},
    created_at: []const u8,
    updated_at: []const u8,
    record: Record,
    sources: Sources,
    projection: Projection,
};

pub const Offer = struct {
    /// the at-uri of the release or track this link sells
    subject: []const u8,
    url: []const u8,
    /// display price in the currency's smallest unit, when the artist gave one
    amount: ?i64 = null,
    currency: ?[]const u8 = null,
};

pub const max_offers = 200;

/// An https link a listener can open: no credentials, no spaces, at most 512
/// bytes. Support and buy links must pass this to be stored or shown.
pub fn validLink(value: []const u8) bool {
    if (value.len < 9 or value.len > 512) return false;
    if (!std.ascii.startsWithIgnoreCase(value, "https://")) return false;
    for (value) |byte| if (byte <= 0x20 or byte >= 0x7f) return false;
    const uri = std.Uri.parse(value) catch return false;
    if (uri.user != null or uri.password != null) return false;
    const host = uri.host orelse return false;
    return switch (host) {
        .raw, .percent_encoded => |text| text.len > 0 and std.mem.indexOfScalar(u8, text, '.') != null,
    };
}

pub fn validOffer(offer: Offer) bool {
    if (!std.mem.startsWith(u8, offer.subject, "at://") or offer.subject.len > 512) return false;
    if (!validLink(offer.url)) return false;
    if (offer.amount) |amount| if (amount < 0 or amount > 100_000_000) return false;
    if (offer.currency) |code| {
        if (code.len != 3) return false;
        for (code) |c| if (!std.ascii.isUpper(c)) return false;
    }
    if ((offer.amount == null) != (offer.currency == null)) return false;
    return true;
}

/// The stored buyLinks JSON array, keeping only well-formed offers. Anything
/// malformed reads as no offer rather than failing the artist read.
pub fn parseOffers(allocator: std.mem.Allocator, json: []const u8) ![]const Offer {
    const parsed = std.json.parseFromSliceLeaky([]const Offer, allocator, json, .{ .ignore_unknown_fields = true, .allocate = .alloc_always }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return &.{},
    };
    var kept: std.ArrayList(Offer) = .empty;
    for (parsed) |offer| {
        if (kept.items.len == max_offers) break;
        if (validOffer(offer)) try kept.append(allocator, offer);
    }
    return kept.toOwnedSlice(allocator);
}

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    revision: []const u8,
    collection: []const u8,
    rkey: []const u8,
};

pub const Sources = struct {
    did: ClaimSource,
    handle: ClaimSource,
    display_name: ClaimSource,
    profile: ClaimSource,
    avatar: ClaimSource = .legacy_projection,
    public_preferences: ClaimSource,
    account_availability: ClaimSource,
};

pub const ClaimSource = enum {
    legacy_projection,
    legacy_local,
    verified_repo,
    current_pds,
};

pub const Projection = struct {
    indexed_at: ?[]const u8,
    verification: ProjectionVerification,
};

pub const ProjectionVerification = enum {
    legacy_unverified,
    verified_repo,
};

test "offers keep only https links with a whole price" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const offers = try parseOffers(arena.allocator(),
        \\[{"subject":"at://did:plc:a/fm.plyr.list/1","url":"https://a.bandcamp.com/album/x","amount":800,"currency":"USD"},
        \\ {"subject":"at://did:plc:a/fm.plyr.track/2","url":"https://ko-fi.com/a"},
        \\ {"subject":"at://did:plc:a/fm.plyr.track/3","url":"javascript:alert(1)"},
        \\ {"subject":"at://did:plc:a/fm.plyr.track/4","url":"https://x.com/y","amount":5},
        \\ {"subject":"nope","url":"https://x.com/y"}]
    );
    try std.testing.expectEqual(@as(usize, 2), offers.len);
    try std.testing.expectEqual(@as(?i64, 800), offers[0].amount);
    try std.testing.expect(offers[1].amount == null);
    try std.testing.expectEqual(@as(usize, 0), (try parseOffers(arena.allocator(), "{}")).len);
}

test "links must be plain https with a host" {
    try std.testing.expect(validLink("https://ko-fi.com/dawn"));
    try std.testing.expect(!validLink("http://ko-fi.com/dawn"));
    try std.testing.expect(!validLink("https://user:pw@ko-fi.com/"));
    try std.testing.expect(!validLink("https://localhost/x"));
    try std.testing.expect(!validLink("https://ko-fi.com/a b"));
}
