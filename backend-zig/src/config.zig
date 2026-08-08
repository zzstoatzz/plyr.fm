const std = @import("std");
const zat = @import("zat");

pub const Role = enum {
    api,

    pub fn parse(value: []const u8) !Role {
        return std.meta.stringToEnum(Role, value) orelse error.InvalidRole;
    }
};

pub const Config = struct {
    role: Role,
    port: u16,
    database_url: ?[]const u8,
    track_collection: []const u8,
    cors_allowed_origins: []const u8,

    pub fn fromEnvironment() !Config {
        const role_value = getenv("MODE") orelse return error.RoleRequired;
        const port_value = getenv("PORT") orelse "8001";
        const track_collection = getenv("TRACK_COLLECTION_NSID") orelse
            return error.TrackCollectionRequired;
        if (zat.Nsid.parse(track_collection) == null) return error.InvalidTrackCollection;

        return .{
            .role = try Role.parse(role_value),
            .port = std.fmt.parseInt(u16, port_value, 10) catch return error.InvalidPort,
            .database_url = getenv("DATABASE_URL"),
            .track_collection = track_collection,
            .cors_allowed_origins = getenv("CORS_ALLOWED_ORIGINS") orelse "",
        };
    }
};

fn getenv(name: [*:0]const u8) ?[]const u8 {
    const value = std.c.getenv(name) orelse return null;
    return std.mem.span(value);
}

test "process roles are explicit" {
    try std.testing.expectEqual(Role.api, try Role.parse("api"));
    try std.testing.expectError(error.InvalidRole, Role.parse("ingester"));
    try std.testing.expectError(error.InvalidRole, Role.parse("worker"));
    try std.testing.expectError(error.InvalidRole, Role.parse("all"));
}
