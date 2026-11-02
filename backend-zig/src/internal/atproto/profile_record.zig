//! Strict decoder for the authored `fm.plyr.actor.profile/self` record.
//!
//! These are repository-authored profile claims. DID-document identity,
//! current-PDS availability, and local account preferences are deliberately
//! separate projections.

const std = @import("std");
const zat = @import("zat");
const lexicon_value = @import("lexicon_value.zig");
const lexicon_string = @import("../text/lexicon_string.zig");

pub const max_uri_bytes: usize = 1_000_000;

pub const Record = struct {
    avatar: ?[]const u8,
    bio: ?[]const u8,
    created_at: []const u8,
    updated_at: ?[]const u8,
};

pub const Error = error{
    InvalidRecord,
    WrongRecordType,
    InvalidAvatar,
    InvalidBio,
    InvalidDatetime,
};

pub fn parse(value: zat.cbor.Value, profile_collection: []const u8) Error!Record {
    const record_type = value.getString("$type") orelse return error.InvalidRecord;
    if (!std.mem.eql(u8, record_type, profile_collection)) return error.WrongRecordType;

    const created_at = value.getString("createdAt") orelse return error.InvalidRecord;
    if (!lexicon_value.validDatetime(created_at)) return error.InvalidDatetime;
    const updated_at = try optionalText(value, "updatedAt");
    if (updated_at) |timestamp| {
        if (!lexicon_value.validDatetime(timestamp)) return error.InvalidDatetime;
    }
    const avatar = try optionalText(value, "avatar");
    if (avatar) |uri| {
        if (uri.len > max_uri_bytes or !lexicon_value.validUri(uri))
            return error.InvalidAvatar;
    }
    const bio = try optionalText(value, "bio");
    if (bio) |text| {
        lexicon_string.validate(text, 2560, 256) catch return error.InvalidBio;
    }

    return .{
        .avatar = avatar,
        .bio = bio,
        .created_at = created_at,
        .updated_at = updated_at,
    };
}

fn optionalText(value: zat.cbor.Value, key: []const u8) Error!?[]const u8 {
    const field = value.get(key) orelse return null;
    return switch (field) {
        .text => |text| text,
        else => error.InvalidRecord,
    };
}

fn fixture(bio: []const u8) zat.cbor.Value {
    return .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.actor.profile" } },
        .{ .key = "avatar", .value = .{ .text = "https://media.example/avatar.png" } },
        .{ .key = "bio", .value = .{ .text = bio } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
        .{ .key = "updatedAt", .value = .{ .text = "2026-08-08T13:00:00+01:00" } },
    } };
}

test "profile record preserves authored fields" {
    const record = try parse(fixture("artist bio"), "fm.plyr.dev.actor.profile");
    try std.testing.expectEqualStrings("https://media.example/avatar.png", record.avatar.?);
    try std.testing.expectEqualStrings("artist bio", record.bio.?);
    try std.testing.expectEqualStrings("2026-08-08T13:00:00+01:00", record.updated_at.?);
}

test "profile bio counts graphemes and bytes independently" {
    var bio: std.ArrayList(u8) = .empty;
    defer bio.deinit(std.testing.allocator);
    for (0..256) |_| try bio.appendSlice(std.testing.allocator, "e\u{301}");
    _ = try parse(fixture(bio.items), "fm.plyr.dev.actor.profile");
    try bio.appendSlice(std.testing.allocator, "x");
    try std.testing.expectError(
        error.InvalidBio,
        parse(fixture(bio.items), "fm.plyr.dev.actor.profile"),
    );
}

test "profile rejects relative avatars and invalid timestamps" {
    const relative: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.actor.profile" } },
        .{ .key = "avatar", .value = .{ .text = "/avatar.png" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    try std.testing.expectError(
        error.InvalidAvatar,
        parse(relative, "fm.plyr.dev.actor.profile"),
    );
    const invalid_time: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.actor.profile" } },
        .{ .key = "createdAt", .value = .{ .text = "2025-02-29T12:00:00Z" } },
    } };
    try std.testing.expectError(
        error.InvalidDatetime,
        parse(invalid_time, "fm.plyr.dev.actor.profile"),
    );
}
