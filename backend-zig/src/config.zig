const std = @import("std");

pub const Role = enum {
    api,

    pub fn parse(value: []const u8) !Role {
        return std.meta.stringToEnum(Role, value) orelse error.InvalidRole;
    }
};

pub const Config = struct {
    role: Role,
    port: u16,

    pub fn fromEnvironment() !Config {
        const role_value = getenv("MODE") orelse return error.RoleRequired;
        const port_value = getenv("PORT") orelse "8001";

        return .{
            .role = try Role.parse(role_value),
            .port = std.fmt.parseInt(u16, port_value, 10) catch return error.InvalidPort,
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
