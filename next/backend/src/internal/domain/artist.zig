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
    /// links the artist shows on their page, from their plyr settings
    links: []const ProfileLink = &.{},
    /// what sits behind the artist's page; null is the default, their photo blurred
    backdrop: ?Backdrop = null,
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

/// A link on the artist's page, like a profile link on Bluesky: an https url and
/// an optional short label (the page shows the site name without one).
pub const ProfileLink = struct {
    url: []const u8,
    label: ?[]const u8 = null,
};

pub const max_profile_links = 6;
pub const max_link_label = 64;

pub fn validProfileLink(link: ProfileLink) bool {
    if (!validLink(link.url)) return false;
    if (link.label) |label| {
        if (label.len == 0 or label.len > max_link_label) return false;
        if (!std.unicode.utf8ValidateSlice(label)) return false;
        for (label) |byte| if (byte < 0x20 or byte == 0x7f) return false;
    }
    return true;
}

/// The stored profileLinks JSON array, keeping only well-formed links. One bad
/// entry drops that link, not the list.
pub fn parseProfileLinks(allocator: std.mem.Allocator, json: []const u8) ![]const ProfileLink {
    const parsed = std.json.parseFromSliceLeaky([]const std.json.Value, allocator, json, .{ .allocate = .alloc_always }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return &.{},
    };
    var kept: std.ArrayList(ProfileLink) = .empty;
    for (parsed) |value| {
        if (kept.items.len == max_profile_links) break;
        const link = std.json.parseFromValueLeaky(ProfileLink, allocator, value, .{ .ignore_unknown_fields = true }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => continue,
        };
        if (validProfileLink(link)) try kept.append(allocator, link);
    }
    return kept.toOwnedSlice(allocator);
}

/// What sits behind an artist's page: their photo blurred (the default), one of
/// their covers, a color, or nothing.
pub const Backdrop = struct {
    kind: []const u8,
    /// "#rrggbb", for kind "color"
    color: ?[]const u8 = null,
    /// a plyr.fm-hosted image url, for kind "image"
    image: ?[]const u8 = null,
};

/// images the page may show: the ones plyr.fm already hosts (covers), never an
/// arbitrary site, so a backdrop can't track visitors or swap under moderation.
const image_hosts = [_][]const u8{
    "https://plyr-next-audio.n8-3e9.workers.dev/images/",
    "https://images.plyr.fm/",
    "https://images-stg.plyr.fm/",
};

pub fn validColor(value: []const u8) bool {
    if (value.len != 7 or value[0] != '#') return false;
    for (value[1..]) |digit| if (!std.ascii.isHex(digit)) return false;
    return true;
}

pub fn validBackdrop(backdrop: Backdrop) bool {
    const kind = backdrop.kind;
    if (std.mem.eql(u8, kind, "photo") or std.mem.eql(u8, kind, "plain"))
        return backdrop.color == null and backdrop.image == null;
    if (std.mem.eql(u8, kind, "color"))
        return backdrop.image == null and validColor(backdrop.color orelse return false);
    if (std.mem.eql(u8, kind, "image")) {
        if (backdrop.color != null) return false;
        const image = backdrop.image orelse return false;
        if (!validLink(image)) return false;
        for (image_hosts) |host| if (std.mem.startsWith(u8, image, host)) return true;
        return false;
    }
    return false;
}

/// The stored backdrop JSON object; anything malformed reads as the default.
pub fn parseBackdrop(allocator: std.mem.Allocator, json: ?[]const u8) !?Backdrop {
    const text = json orelse return null;
    const parsed = std.json.parseFromSliceLeaky(Backdrop, allocator, text, .{ .ignore_unknown_fields = true, .allocate = .alloc_always }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return null,
    };
    if (!validBackdrop(parsed) or std.mem.eql(u8, parsed.kind, "photo")) return null;
    return parsed;
}

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

test "profile links keep https urls and short labels" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const links = try parseProfileLinks(arena.allocator(),
        \\[{"url":"https://dawn.bandcamp.com","label":"bandcamp"},{"url":"https://dawn.example"},{"url":"javascript:alert(1)","label":"x"},{"url":"https://dawn.example/a","label":""},{"label":"no url"}]
    );
    try std.testing.expectEqual(@as(usize, 2), links.len);
    try std.testing.expectEqualStrings("bandcamp", links[0].label.?);
    try std.testing.expect(links[1].label == null);
    try std.testing.expectEqual(@as(usize, 0), (try parseProfileLinks(arena.allocator(), "{}")).len);
}

test "a backdrop is a known kind with only the field it needs" {
    try std.testing.expect(validBackdrop(.{ .kind = "plain" }));
    try std.testing.expect(validBackdrop(.{ .kind = "color", .color = "#1f7a55" }));
    try std.testing.expect(!validBackdrop(.{ .kind = "color", .color = "green" }));
    try std.testing.expect(!validBackdrop(.{ .kind = "color" }));
    try std.testing.expect(validBackdrop(.{ .kind = "image", .image = "https://images.plyr.fm/images/abc.png" }));
    try std.testing.expect(!validBackdrop(.{ .kind = "image", .image = "https://tracker.example/pixel.png" }));
    try std.testing.expect(!validBackdrop(.{ .kind = "plain", .color = "#000000" }));
    try std.testing.expect(!validBackdrop(.{ .kind = "video" }));
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expect((try parseBackdrop(arena.allocator(), "{\"kind\":\"photo\"}")) == null);
    try std.testing.expect((try parseBackdrop(arena.allocator(), "{\"kind\":\"neon\"}")) == null);
    try std.testing.expectEqualStrings("#1f7a55", (try parseBackdrop(arena.allocator(), "{\"kind\":\"color\",\"color\":\"#1f7a55\"}")).?.color.?);
}
