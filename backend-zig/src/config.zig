const std = @import("std");
const zat = @import("zat");
const sealed_secret = @import("internal/auth/sealed_secret.zig");
const client_identity = @import("internal/http/client_identity.zig");

pub const AuthConfig = struct {
    client_id: []const u8,
    client_uri: []const u8,
    redirect_uri: []const u8,
    frontend_origin: []const u8,
    scope: []const u8,
    client_keypair: zat.Keypair,
    encryption_key: sealed_secret.Key,

    fn fromValues(values: struct {
        client_id: []const u8,
        redirect_uri: []const u8,
        frontend_origin: []const u8,
        scope: []const u8,
        client_private_key: []const u8,
        encryption_key: []const u8,
    }) !AuthConfig {
        const metadata_suffix = "/oauth-client-metadata.json";
        if (!std.mem.endsWith(u8, values.client_id, metadata_suffix))
            return error.InvalidOauthClientId;
        try validateHttpsUrl(values.client_id, false);
        try validateHttpsUrl(values.redirect_uri, false);
        try validateHttpsUrl(values.frontend_origin, true);
        const client_uri = values.client_id[0 .. values.client_id.len - metadata_suffix.len];
        const callback_suffix = "/auth/callback";
        if (values.redirect_uri.len != client_uri.len + callback_suffix.len or
            !std.mem.startsWith(u8, values.redirect_uri, client_uri) or
            !std.mem.endsWith(u8, values.redirect_uri, callback_suffix))
            return error.OauthRedirectMismatch;
        if (!scopeContains(values.scope, "atproto")) return error.InvalidOauthScope;
        const client_secret = try sealed_secret.parseKey(values.client_private_key);
        const encryption_key = try sealed_secret.parseKey(values.encryption_key);
        if (std.mem.eql(u8, &client_secret, &encryption_key))
            return error.ReusedAuthKey;
        return .{
            .client_id = values.client_id,
            .client_uri = client_uri,
            .redirect_uri = values.redirect_uri,
            .frontend_origin = values.frontend_origin,
            .scope = values.scope,
            .client_keypair = try zat.Keypair.fromSecretKey(.p256, client_secret),
            .encryption_key = encryption_key,
        };
    }
};

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
    database_pool_size: u16,
    redis_url: ?[]const u8,
    max_connections: usize,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    cors_allowed_origins: []const u8,
    repair_did: ?[]const u8,
    relay_hosts: []const u8,
    relay_name: []const u8,
    account_check_interval_us: i64,
    account_check_retry_us: i64,
    account_check_lease_us: i64,
    account_check_seed_us: i64,
    account_check_idle_ms: i64,
    auth_start_client_limit: u32,
    auth_start_subject_limit: u32,
    auth_start_global_limit: u32,
    auth_start_window_seconds: u32,
    auth_trusted_proxy_cidrs: []const u8,
    auth: ?AuthConfig,

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
        const like_collection = getenv("LIKE_COLLECTION_NSID") orelse
            return error.LikeCollectionRequired;
        if (zat.Nsid.parse(like_collection) == null) return error.InvalidLikeCollection;
        try validateDistinctCollections(.{
            track_collection,
            list_collection,
            profile_collection,
            like_collection,
        });
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

        const auth_trusted_proxy_cidrs = getenv("AUTH_TRUSTED_PROXY_CIDRS") orelse "";
        try client_identity.validateTrustedProxyCidrs(auth_trusted_proxy_cidrs);

        return .{
            .role = role,
            .port = std.fmt.parseInt(u16, port_value, 10) catch return error.InvalidPort,
            .database_url = database_url,
            .database_role = database_role,
            .index_mode = index_mode,
            .database_pool_size = try parsePositiveU16(getenv("DATABASE_POOL_SIZE") orelse "8"),
            .redis_url = getenv("DOCKET_URL"),
            .max_connections = try parsePositiveUsize(getenv("MAX_CONNECTIONS") orelse "128"),
            .track_collection = track_collection,
            .list_collection = list_collection,
            .profile_collection = profile_collection,
            .like_collection = like_collection,
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
            .auth_start_client_limit = try parsePositiveU32(
                getenv("AUTH_START_CLIENT_LIMIT") orelse "10",
            ),
            .auth_start_subject_limit = try parsePositiveU32(
                getenv("AUTH_START_SUBJECT_LIMIT") orelse "10",
            ),
            .auth_start_global_limit = try parsePositiveU32(
                getenv("AUTH_START_GLOBAL_LIMIT") orelse "120",
            ),
            .auth_start_window_seconds = try parsePositiveU32(
                getenv("AUTH_START_WINDOW_SECONDS") orelse "60",
            ),
            .auth_trusted_proxy_cidrs = auth_trusted_proxy_cidrs,
            .auth = try authFromEnvironment(),
        };
    }
};

fn authFromEnvironment() !?AuthConfig {
    const client_id = getenv("ZIG_OAUTH_CLIENT_ID");
    const redirect_uri = getenv("ZIG_OAUTH_REDIRECT_URI");
    const frontend_origin = getenv("ZIG_OAUTH_FRONTEND_ORIGIN");
    const scope = getenv("ZIG_OAUTH_SCOPE");
    const client_private_key = getenv("ZIG_OAUTH_CLIENT_PRIVATE_KEY");
    const encryption_key = getenv("ZIG_AUTH_ENCRYPTION_KEY");
    const configured = presentCount(.{
        client_id != null,
        redirect_uri != null,
        frontend_origin != null,
        scope != null,
        client_private_key != null,
        encryption_key != null,
    });
    if (configured == 0) return null;
    if (configured != 6)
        return error.PartialAuthConfiguration;
    return try AuthConfig.fromValues(.{
        .client_id = client_id.?,
        .redirect_uri = redirect_uri.?,
        .frontend_origin = frontend_origin.?,
        .scope = scope.?,
        .client_private_key = client_private_key.?,
        .encryption_key = encryption_key.?,
    });
}

fn presentCount(values: [6]bool) u8 {
    var count: u8 = 0;
    for (values) |present| count += @intFromBool(present);
    return count;
}

fn validateHttpsUrl(value: []const u8, origin_only: bool) !void {
    const uri = std.Uri.parse(value) catch return error.InvalidHttpsUrl;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "https") or uri.host == null or
        uri.user != null or uri.password != null or uri.query != null or uri.fragment != null)
        return error.InvalidHttpsUrl;
    if (origin_only and !std.mem.eql(u8, uri.path.percent_encoded, ""))
        return error.InvalidHttpsOrigin;
}

fn scopeContains(scope: []const u8, expected: []const u8) bool {
    var parts = std.mem.tokenizeScalar(u8, scope, ' ');
    while (parts.next()) |part| {
        if (std.mem.eql(u8, part, expected)) return true;
    }
    return false;
}

fn getenv(name: [*:0]const u8) ?[]const u8 {
    const value = std.c.getenv(name) orelse return null;
    return std.mem.span(value);
}

fn parsePositiveUsize(value: []const u8) !usize {
    const parsed = std.fmt.parseInt(usize, value, 10) catch return error.InvalidPositiveInteger;
    if (parsed == 0) return error.InvalidPositiveInteger;
    return parsed;
}

fn parsePositiveU16(value: []const u8) !u16 {
    const parsed = std.fmt.parseInt(u16, value, 10) catch return error.InvalidPositiveInteger;
    if (parsed == 0) return error.InvalidPositiveInteger;
    return parsed;
}

fn parsePositiveU32(value: []const u8) !u32 {
    const parsed = std.fmt.parseInt(u32, value, 10) catch return error.InvalidPositiveInteger;
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

fn validateDistinctCollections(collections: [4][]const u8) !void {
    for (collections, 0..) |collection, index| {
        for (collections[0..index]) |prior| {
            if (std.mem.eql(u8, collection, prior)) return error.DuplicateCollection;
        }
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
    try std.testing.expectEqual(@as(u16, 16), try parsePositiveU16("16"));
    try std.testing.expectEqual(@as(u32, 60), try parsePositiveU32("60"));
    try std.testing.expectEqual(@as(i64, 6_000_000), try parseSecondsMicros("6"));
    try std.testing.expectError(error.InvalidPositiveInteger, parsePositiveUsize("0"));
    try std.testing.expectError(error.InvalidPositiveInteger, parsePositiveU16("65536"));
    try std.testing.expectError(error.InvalidPositiveInteger, parsePositiveU32("0"));
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

test "record collections are distinct routing keys" {
    try validateDistinctCollections(.{ "a.b.track", "a.b.list", "a.b.profile", "a.b.like" });
    try std.testing.expectError(
        error.DuplicateCollection,
        validateDistinctCollections(.{ "a.b.track", "a.b.list", "a.b.profile", "a.b.track" }),
    );
}

test "auth configuration is exact, confidential, and uses separate keys" {
    try std.testing.expectEqual(@as(u8, 0), presentCount(.{false} ** 6));
    try std.testing.expectEqual(
        @as(u8, 1),
        presentCount(.{ true, false, false, false, false, false }),
    );
    try std.testing.expectEqual(@as(u8, 6), presentCount(.{true} ** 6));

    const client_key = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=";
    const encryption_key = "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=";
    const auth = try AuthConfig.fromValues(.{
        .client_id = "https://api.next.plyr.fm/oauth-client-metadata.json",
        .redirect_uri = "https://api.next.plyr.fm/auth/callback",
        .frontend_origin = "https://next.plyr.fm",
        .scope = "atproto transition:generic",
        .client_private_key = client_key,
        .encryption_key = encryption_key,
    });
    try std.testing.expectEqualStrings("https://api.next.plyr.fm", auth.client_uri);
    try std.testing.expectEqualStrings("ES256", @tagName(auth.client_keypair.algorithm()));
    try std.testing.expectError(error.InvalidOauthScope, AuthConfig.fromValues(.{
        .client_id = auth.client_id,
        .redirect_uri = auth.redirect_uri,
        .frontend_origin = auth.frontend_origin,
        .scope = "transition:generic",
        .client_private_key = client_key,
        .encryption_key = encryption_key,
    }));
    try std.testing.expectError(error.ReusedAuthKey, AuthConfig.fromValues(.{
        .client_id = auth.client_id,
        .redirect_uri = auth.redirect_uri,
        .frontend_origin = auth.frontend_origin,
        .scope = auth.scope,
        .client_private_key = client_key,
        .encryption_key = client_key,
    }));
}
