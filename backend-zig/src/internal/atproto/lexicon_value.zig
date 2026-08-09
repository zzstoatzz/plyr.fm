//! Shared validation for AT Protocol Lexicon scalar formats.

const std = @import("std");

pub fn validUri(value: []const u8) bool {
    if (!std.unicode.utf8ValidateSlice(value) or value.len == 0) return false;
    const uri = std.Uri.parse(value) catch return false;
    return uri.scheme.len != 0;
}

pub fn validDatetime(value: []const u8) bool {
    // RFC 3339's Internet profile: YYYY-MM-DDTHH:MM:SS[.fraction](Z|+HH:MM).
    if (value.len < 20 or value[4] != '-' or value[7] != '-' or
        value[10] != 'T' or value[13] != ':' or value[16] != ':')
        return false;
    const year = parseDecimal(value[0..4]) orelse return false;
    const month = parseDecimal(value[5..7]) orelse return false;
    const day = parseDecimal(value[8..10]) orelse return false;
    const hour = parseDecimal(value[11..13]) orelse return false;
    const minute = parseDecimal(value[14..16]) orelse return false;
    const second = parseDecimal(value[17..19]) orelse return false;
    if (month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59)
        return false;
    const month_days = [_]u16{ 31, if (isLeapYear(year)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    if (day < 1 or day > month_days[month - 1]) return false;

    var offset: usize = 19;
    if (offset < value.len and value[offset] == '.') {
        offset += 1;
        const fraction_start = offset;
        while (offset < value.len and std.ascii.isDigit(value[offset])) : (offset += 1) {}
        if (offset == fraction_start) return false;
    }
    if (offset + 1 == value.len and value[offset] == 'Z') return true;
    if (offset + 6 != value.len or (value[offset] != '+' and value[offset] != '-') or
        value[offset + 3] != ':') return false;
    const zone_hour = parseDecimal(value[offset + 1 .. offset + 3]) orelse return false;
    const zone_minute = parseDecimal(value[offset + 4 .. offset + 6]) orelse return false;
    if (year == 0 or (value[offset] == '-' and zone_hour == 0 and zone_minute == 0))
        return false;
    return zone_hour <= 23 and zone_minute <= 59;
}

fn parseDecimal(value: []const u8) ?u16 {
    if (value.len == 0) return null;
    var result: u16 = 0;
    for (value) |character| {
        if (!std.ascii.isDigit(character)) return null;
        result = result * 10 + character - '0';
    }
    return result;
}

fn isLeapYear(year: u16) bool {
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0);
}

test "datetime uses the ATProto RFC 3339 profile" {
    try std.testing.expect(validDatetime("0000-01-01T00:00:00.000Z"));
    try std.testing.expect(validDatetime("1985-04-12T23:20:50.123+01:45"));
    try std.testing.expect(!validDatetime("1985-04-12t23:20:50.123Z"));
    try std.testing.expect(!validDatetime("1985-04-12T23:20:50.123z"));
    try std.testing.expect(!validDatetime("1985-04-12T23:20:50.123-00:00"));
    try std.testing.expect(!validDatetime("2025-02-29T00:00:00Z"));
}

test "URI format requires an absolute valid UTF-8 URI" {
    try std.testing.expect(validUri("https://media.example/avatar.png"));
    try std.testing.expect(validUri("did:plc:alice"));
    try std.testing.expect(!validUri("/relative/avatar.png"));
    try std.testing.expect(!validUri("\xff"));
}
