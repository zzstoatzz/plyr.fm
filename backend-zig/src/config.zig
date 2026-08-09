const std = @import("std");
const zat = @import("zat");

pub const Role = enum {
    account_reconciler,
    api,
    catalog_reconciler,
    ingester,
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
    database_role: ?[]const u8,
    index_mode: IndexMode,
    max_connections: usize,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    cors_allowed_origins: []const u8,
    repair_did: ?[]const u8,
    relay_hosts: []const u8,
    relay_name: []const u8,
    account_check_interval_us: i64,
    account_check_retry_us: i64,
    account_check_lease_us: i64,
    account_check_seed_us: i64,
    account_check_idle_ms: i64,

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
        const profile_collection = getenv("PROFILE_COLLECTION_NSID") orelse
            return error.ProfileCollectionRequired;
        if (zat.Nsid.parse(profile_collection) == null) return error.InvalidProfileCollection;
        const index_mode = try IndexMode.parse(getenv("INDEX_MODE") orelse "required");
        const database_url = getenv("DATABASE_URL");
        if (index_mode == .required and database_url == null) return error.DatabaseUrlRequired;
        const database_role = getenv("DATABASE_ROLE");
        if (database_role) |value| {
            if (database_url == null) return error.DatabaseRoleWithoutDatabase;
            try validateDatabaseRole(value);
        }
        const repair_did = getenv("INGEST_REPAIR_DID");
        if (role == .repair) {
            if (database_url == null or index_mode != .required)
                return error.RepairDatabaseRequired;
            if (repair_did == null) return error.RepairDidRequired;
            if (zat.Did.parse(repair_did.?) == null) return error.InvalidRepairDid;
        }
        if (role == .ingester and (database_url == null or index_mode != .required))
            return error.IngesterDatabaseRequired;
        if (role == .account_reconciler and (database_url == null or index_mode != .required))
            return error.AccountReconcilerDatabaseRequired;
        if (role == .catalog_reconciler and (database_url == null or index_mode != .required))
            return error.CatalogReconcilerDatabaseRequired;

        return .{
            .role = role,
            .port = std.fmt.parseInt(u16, port_value, 10) catch return error.InvalidPort,
            .database_url = database_url,
            .database_role = database_role,
            .index_mode = index_mode,
            .max_connections = try parsePositiveUsize(getenv("MAX_CONNECTIONS") orelse "128"),
            .track_collection = track_collection,
            .list_collection = list_collection,
            .profile_collection = profile_collection,
            .cors_allowed_origins = getenv("CORS_ALLOWED_ORIGINS") orelse "",
            .repair_did = repair_did,
            .relay_hosts = getenv("INGEST_RELAY_HOSTS") orelse "wss://bsky.network",
            .relay_name = getenv("INGEST_RELAY_NAME") orelse "bsky.network",
            .account_check_interval_us = try parseSecondsMicros(
                getenv("ACCOUNT_CHECK_INTERVAL_SECONDS") orelse "21600",
            ),
            .account_check_retry_us = try parseSecondsMicros(
                getenv("ACCOUNT_CHECK_RETRY_SECONDS") orelse "300",
            ),
            .account_check_lease_us = try parseSecondsMicros(
                getenv("ACCOUNT_CHECK_LEASE_SECONDS") orelse "120",
            ),
            .account_check_seed_us = try parseSecondsMicros(
                getenv("ACCOUNT_CHECK_SEED_SECONDS") orelse "300",
            ),
            .account_check_idle_ms = try parsePositiveI64(
                getenv("ACCOUNT_CHECK_IDLE_MILLISECONDS") orelse "1000",
            ),
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

fn parsePositiveI64(value: []const u8) !i64 {
    const parsed = std.fmt.parseInt(i64, value, 10) catch return error.InvalidPositiveInteger;
    if (parsed <= 0) return error.InvalidPositiveInteger;
    return parsed;
}

fn parseSecondsMicros(value: []const u8) !i64 {
    const seconds = std.fmt.parseInt(i64, value, 10) catch return error.InvalidPositiveInteger;
    if (seconds <= 0) return error.InvalidPositiveInteger;
    return std.math.mul(i64, seconds, std.time.us_per_s) catch
        error.InvalidPositiveInteger;
}

fn validateDatabaseRole(value: []const u8) !void {
    if (value.len == 0 or value.len > 63) return error.InvalidDatabaseRole;
    if (!(std.ascii.isLower(value[0]) or value[0] == '_'))
        return error.InvalidDatabaseRole;
    for (value[1..]) |byte| {
        if (!(std.ascii.isLower(byte) or std.ascii.isDigit(byte) or byte == '_'))
            return error.InvalidDatabaseRole;
    }
}

test "process roles are explicit" {
    try std.testing.expectEqual(Role.api, try Role.parse("api"));
    try std.testing.expectEqual(Role.account_reconciler, try Role.parse("account_reconciler"));
    try std.testing.expectEqual(Role.catalog_reconciler, try Role.parse("catalog_reconciler"));
    try std.testing.expectEqual(Role.repair, try Role.parse("repair"));
    try std.testing.expectEqual(Role.ingester, try Role.parse("ingester"));
    try std.testing.expectError(error.InvalidRole, Role.parse("worker"));
    try std.testing.expectError(error.InvalidRole, Role.parse("all"));
}

test "index mode and connection bounds are explicit" {
    try std.testing.expectEqual(IndexMode.required, try IndexMode.parse("required"));
    try std.testing.expectEqual(IndexMode.disabled, try IndexMode.parse("disabled"));
    try std.testing.expectError(error.InvalidIndexMode, IndexMode.parse("optional"));
    try std.testing.expectEqual(@as(usize, 128), try parsePositiveUsize("128"));
    try std.testing.expectEqual(@as(i64, 6_000_000), try parseSecondsMicros("6"));
    try std.testing.expectError(error.InvalidPositiveInteger, parsePositiveUsize("0"));
}

test "database role expectations use unquoted PostgreSQL identifiers" {
    try validateDatabaseRole("plyr_zig_canary");
    try validateDatabaseRole("_service2");
    try std.testing.expectError(error.InvalidDatabaseRole, validateDatabaseRole(""));
    try std.testing.expectError(error.InvalidDatabaseRole, validateDatabaseRole("Owner"));
    try std.testing.expectError(error.InvalidDatabaseRole, validateDatabaseRole("plyr-zig"));
    try std.testing.expectError(
        error.InvalidDatabaseRole,
        validateDatabaseRole("a" ** 64),
    );
}
