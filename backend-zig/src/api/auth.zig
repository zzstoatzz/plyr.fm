//! Browser authentication protocol endpoints.
//!
//! OAuth ceremony is delegated to Zat. This layer owns only plyr's HTTP
//! contract, redirects, cookies, and application session boundary.

const std = @import("std");
const zat = @import("zat");
const config = @import("../config.zig");
const response = @import("response.zig");
const bearer = @import("../internal/auth/bearer_token.zig");
const sealed_secret = @import("../internal/auth/sealed_secret.zig");
const PostgresAuthStore = @import("../internal/auth/postgres_store.zig").PostgresAuthStore;

const http = std.http;

pub fn clientMetadata(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    auth: ?config.AuthConfig,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const settings = auth orelse {
        try response.apiError(request, .not_found, request_id, cors);
        return;
    };
    const body = zat.oauth.clientMetadataJson(allocator, .{
        .client_id = settings.client_id,
        .client_name = "plyr.fm",
        .client_uri = settings.client_uri,
        .redirect_uris = &.{settings.redirect_uri},
        .scope = settings.scope,
        .keypair = &settings.client_keypair,
    }) catch |err| {
        std.log.err("OAuth client metadata generation failed: {}", .{err});
        try response.apiError(request, .internal_error, request_id, cors);
        return;
    };
    defer allocator.free(body);
    try response.jsonWithHeaders(request, .ok, body, request_id, cors, &.{.{
        .name = "cache-control",
        .value = "public, max-age=300",
    }});
}

pub fn pdsOptions(
    request: *http.Server.Request,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    // Account creation is intentionally deferred; login works against every
    // standards-conforming PDS without blessing a hosting provider here.
    try response.json(request, .ok, "{\"enabled\":false,\"options\":[]}", request_id, cors);
}

pub fn exchange(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    auth: ?config.AuthConfig,
    store: ?PostgresAuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const settings = auth orelse return unavailable(request, request_id, cors);
    const auth_store = store orelse return unavailable(request, request_id, cors);
    const body_reader = request.readerExpectContinue(&.{}) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const body = body_reader.allocRemaining(allocator, std.Io.Limit.limited(2048)) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const parsed = std.json.parseFromSliceLeaky(
        struct { exchange_token: []const u8 },
        allocator,
        body,
        .{ .ignore_unknown_fields = false },
    ) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    if (!bearer.isCanonical(parsed.exchange_token)) {
        try response.apiError(request, .authentication_required, request_id, cors);
        return;
    }
    const sealed_token = auth_store.consumeExchange(
        allocator,
        bearer.digest(parsed.exchange_token),
    ) catch {
        try response.apiError(request, .service_unavailable, request_id, cors);
        return;
    } orelse {
        try response.apiError(request, .authentication_required, request_id, cors);
        return;
    };
    const session_token = sealed_secret.open(
        allocator,
        settings.encryption_key,
        "plyr/auth/exchange/v1",
        sealed_token,
    ) catch {
        std.log.err("auth exchange ciphertext failed authentication", .{});
        try response.apiError(request, .internal_error, request_id, cors);
        return;
    };
    if (!bearer.isCanonical(session_token)) {
        std.log.err("auth exchange decrypted an invalid session token", .{});
        try response.apiError(request, .internal_error, request_id, cors);
        return;
    }
    const cookie = try std.fmt.allocPrint(
        allocator,
        "session_id={s}; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
        .{session_token},
    );
    try response.jsonWithHeaders(request, .ok, "{}", request_id, cors, &.{.{
        .name = "set-cookie",
        .value = cookie,
    }});
}

pub fn me(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?PostgresAuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const auth_store = store orelse return unavailable(request, request_id, cors);
    const token = sessionCookie(request) orelse {
        try response.apiError(request, .authentication_required, request_id, cors);
        return;
    };
    var session = auth_store.getSession(allocator, bearer.digest(token)) catch {
        try response.apiError(request, .service_unavailable, request_id, cors);
        return;
    } orelse {
        try response.apiError(request, .authentication_required, request_id, cors);
        return;
    };
    defer session.deinit(allocator);
    var body: std.Io.Writer.Allocating = .init(allocator);
    defer body.deinit();
    try body.writer.print(
        "{{\"did\":{f},\"handle\":{f},\"linked_accounts\":[],\"enabled_flags\":[],\"permissioned_spaces\":{{\"supported\":false}}}}",
        .{ std.json.fmt(session.did, .{}), std.json.fmt(session.handle, .{}) },
    );
    try response.json(request, .ok, body.written(), request_id, cors);
}

pub fn logout(
    request: *http.Server.Request,
    store: ?PostgresAuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    if (sessionCookie(request)) |token| {
        if (store) |auth_store| {
            _ = auth_store.revokeSession(bearer.digest(token)) catch {
                try response.apiError(request, .service_unavailable, request_id, cors);
                return;
            };
        }
    }
    try response.jsonWithHeaders(request, .ok, "{\"message\":\"logged out\"}", request_id, cors, &.{.{
        .name = "set-cookie",
        .value = "session_id=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    }});
}

fn unavailable(
    request: *http.Server.Request,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !void {
    try response.apiError(request, .service_unavailable, request_id, cors);
}

fn sessionCookie(request: *const http.Server.Request) ?[]const u8 {
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (!std.ascii.eqlIgnoreCase(header.name, "cookie")) continue;
        var cookies = std.mem.splitScalar(u8, header.value, ';');
        while (cookies.next()) |raw| {
            const cookie = std.mem.trim(u8, raw, " \t");
            const equals = std.mem.indexOfScalar(u8, cookie, '=') orelse continue;
            if (!std.mem.eql(u8, cookie[0..equals], "session_id")) continue;
            const value = cookie[equals + 1 ..];
            return if (bearer.isCanonical(value)) value else null;
        }
    }
    return null;
}

test "Zat emits confidential ATProto OAuth metadata for the browser client" {
    const key = try zat.Keypair.fromSecretKey(.p256, .{0x42} ** 32);
    const body = try zat.oauth.clientMetadataJson(std.testing.allocator, .{
        .client_id = "https://api.next.plyr.fm/oauth-client-metadata.json",
        .client_name = "plyr.fm",
        .client_uri = "https://api.next.plyr.fm",
        .redirect_uris = &.{"https://api.next.plyr.fm/auth/callback"},
        .scope = "atproto transition:generic",
        .keypair = &key,
    });
    defer std.testing.allocator.free(body);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, body, .{});
    defer parsed.deinit();
    try std.testing.expectEqualStrings(
        "private_key_jwt",
        parsed.value.object.get("token_endpoint_auth_method").?.string,
    );
    try std.testing.expect(parsed.value.object.get("jwks") != null);
    try std.testing.expectEqual(true, parsed.value.object.get("dpop_bound_access_tokens").?.bool);
}
