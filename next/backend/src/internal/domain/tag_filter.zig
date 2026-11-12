const std = @import("std");

pub const defaults: []const []const u8 = &.{ "ai", "ai-slop", "suno" };
pub const max_bytes = 200;
pub const max_count = 10;

pub fn valid(raw: []const u8) bool {
    return std.mem.trim(u8, raw, " \t\r\n\x0b\x0c-").len > 0 and raw.len <= max_bytes and std.mem.indexOfScalar(u8, raw, 0) == null and std.unicode.utf8ValidateSlice(raw);
}

pub fn normalize(allocator: std.mem.Allocator, raw: []const u8) ![]const u8 {
    var result: std.ArrayList(u8) = .empty;
    var space = false;
    for (std.mem.trim(u8, raw, " \t\r\n")) |byte| {
        if (std.ascii.isWhitespace(byte)) {
            space = true;
            continue;
        }
        if (space and result.items.len > 0) try result.append(allocator, ' ');
        try result.append(allocator, std.ascii.toLower(byte));
        space = false;
    }
    return std.mem.trim(u8, result.items, " -");
}

pub fn canonical(allocator: std.mem.Allocator, values: []const []const u8) ![]const []const u8 {
    var result: std.ArrayList([]const u8) = .empty;
    for (values) |raw| {
        if (!valid(raw)) return error.InvalidTags;
        const value = try normalize(allocator, raw);
        if (value.len == 0) return error.InvalidTags;
        var seen = false;
        for (result.items) |existing| if (std.mem.eql(u8, existing, value)) {
            seen = true;
            break;
        };
        if (!seen) try result.append(allocator, value);
        if (result.items.len > max_count) return error.InvalidTags;
    }
    std.mem.sort([]const u8, result.items, {}, struct {
        fn less(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.lessThan(u8, a, b);
        }
    }.less);
    return result.toOwnedSlice(allocator);
}
