const std = @import("std");
const zat = @import("zat");

pub const Role = enum {
    api,
    repair,

    pub fn parse(value: []const u8) !Role {
        return std.meta.stringToEnum(Role, value) orelse error.InvalidRole;
    }
};

pub const IndexMode = enum {
    required,
    disabled,

    pub fn parse(value: []const u8) !IndexMode {
        return std.meta.stringToEnum(IndexMode, value) orelse error.InvalidIndexMode;
    }
};

pub const Config = struct {
    role: Role,
    port: u16,
    database_url: ?[]const u8,
    index_mode: IndexMode,
    max_connections: usize,
    track_collection: []const u8,
    list_collection: []const u8,
    cors_allowed_origins: []const u8,
    repair_did: ?[]const u8,

    pub fn fromEnvironment() !Config {
        const role_value = getenv("MODE") orelse return error.RoleRequired;
        const role = try Role.parse(role_value);
        const port_value = getenv("PORT") orelse "8001";
        const track_collection = getenv("TRACK_COLLECTION_NSID") orelse
            return error.TrackCollectionRequired;
        if (zat.Nsid.parse(track_collection) == null) return error.InvalidTrackCollection;
        const list_collection = getenv("LIST_COLLECTION_NSID") orelse
            return error.ListCollectionRequired;
        if (zat.Nsid.parse(list_collection) == null) return error.InvalidListCollection;
        const index_mode = try IndexMode.parse(getenv("INDEX_MODE") orelse "required");
        const database_url = getenv("DATABASE_URL");
        if (index_mode == .required and database_url == null) return error.DatabaseUrlRequired;
        const repair_did = getenv("INGEST_REPAIR_DID");
        if (role == .repair) {
            if (database_url == null or index_mode != .required)
                return error.RepairDatabaseRequired;
            if (repair_did == null) return error.RepairDidRequired;
            if (zat.Did.parse(repair_did.?) == null) return error.InvalidRepairDid;
        }

        return .{
            .role = role,
            .port = std.fmt.parseInt(u16, port_value, 10) catch return error.InvalidPort,
            .database_url = database_url,
            .index_mode = index_mode,
            .max_connections = try parsePositiveUsize(getenv("MAX_CONNECTIONS") orelse "128"),
            .track_collection = track_collection,
            .list_collection = list_collection,
            .cors_allowed_origins = getenv("CORS_ALLOWED_ORIGINS") orelse "",
            .repair_did = repair_did,
        };
    }
};

fn getenv(name: [*:0]const u8) ?[]const u8 {
    const value = std.c.getenv(name) orelse return null;
    return std.mem.span(value);
}

fn parsePositiveUsize(value: []const u8) !usize {
    const parsed = std.fmt.parseInt(usize, value, 10) catch return error.InvalidPositiveInteger;
    if (parsed == 0) return error.InvalidPositiveInteger;
    return parsed;
}

test "process roles are explicit" {
    try std.testing.expectEqual(Role.api, try Role.parse("api"));
    try std.testing.expectEqual(Role.repair, try Role.parse("repair"));
    try std.testing.expectError(error.InvalidRole, Role.parse("ingester"));
    try std.testing.expectError(error.InvalidRole, Role.parse("worker"));
    try std.testing.expectError(error.InvalidRole, Role.parse("all"));
}

test "index mode and connection bounds are explicit" {
    try std.testing.expectEqual(IndexMode.required, try IndexMode.parse("required"));
    try std.testing.expectEqual(IndexMode.disabled, try IndexMode.parse("disabled"));
    try std.testing.expectError(error.InvalidIndexMode, IndexMode.parse("optional"));
    try std.testing.expectEqual(@as(usize, 128), try parsePositiveUsize("128"));
    try std.testing.expectError(error.InvalidPositiveInteger, parsePositiveUsize("0"));
}
