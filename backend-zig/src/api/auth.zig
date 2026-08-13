//! Browser authentication protocol endpoints.
//!
//! OAuth ceremony is delegated to Zat. This layer owns only plyr's HTTP
//! contract, redirects, cookies, and application session boundary.

const std = @import("std");
const zat = @import("zat");
const config = @import("../config.zig");
const response = @import("response.zig");
const bearer = @import("../internal/auth/bearer_token.zig");
const login_identifier = @import("../internal/auth/login_identifier.zig");
const oauth_gateway = @import("../internal/auth/oauth_gateway.zig");
const sealed_secret = @import("../internal/auth/sealed_secret.zig");
const AuthStore = @import("../internal/auth/store.zig").Store;
const StartAdmission = @import("../internal/auth/start_admission.zig").Store;
const browser_login = @import("../internal/application/browser_login.zig");
const client_identity = @import("../internal/http/client_identity.zig");
const query = @import("../internal/http/query.zig");

const http = std.http;
const session_cookie_name = "__Host-plyr_session";
const oauth_cookie_name = "__Host-plyr_oauth";
const clear_oauth_cookie = oauth_cookie_name ++ "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
const no_store_headers = [_]http.Header{
    .{ .name = "cache-control", .value = "no-store" },
    .{ .name = "pragma", .value = "no-cache" },
};

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

pub fn start(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    io: std.Io,
    auth: ?config.AuthConfig,
    store: ?AuthStore,
    oauth: ?oauth_gateway.Client,
    start_admission: ?StartAdmission,
    start_client_limit: u32,
    start_subject_limit: u32,
    start_global_limit: u32,
    start_window_seconds: u32,
    trusted_proxy_cidrs: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const settings = auth orelse return unavailable(request, request_id, cors);
    const auth_store = store orelse return unavailable(request, request_id, cors);
    const client = oauth orelse return unavailable(request, request_id, cors);
    const identifier = parseStartIdentifier(allocator, request.head.target) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const limiter = start_admission orelse return unavailable(request, request_id, cors);
    const client_key = client_identity.rateLimitKey(request, trusted_proxy_cidrs) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const decision = limiter.admit(client_key, identifier.text(), .{
        .client_limit = start_client_limit,
        .subject_limit = start_subject_limit,
        .global_limit = start_global_limit,
        .window_seconds = start_window_seconds,
    }) catch {
        try response.apiError(request, .service_unavailable, request_id, cors);
        return;
    };
    switch (decision) {
        .allowed => {},
        .denied => |retry_after| {
            var retry_buffer: [10]u8 = undefined;
            const retry = try std.fmt.bufPrint(&retry_buffer, "{d}", .{retry_after});
            try response.apiErrorWithHeaders(
                request,
                .rate_limited,
                request_id,
                cors,
                &.{.{ .name = "retry-after", .value = retry }},
            );
            return;
        },
    }
    const service: browser_login.Service = .{
        .io = io,
        .settings = settings,
        .store = auth_store,
        .oauth = client,
    };
    const begun = service.start(allocator, identifier) catch |err| {
        std.log.warn("OAuth start failed: {}", .{err});
        const kind: response.ApiError = switch (err) {
            error.AuthStoreUnavailable => .service_unavailable,
            error.OauthStartFailed => .upstream_failure,
            else => .internal_error,
        };
        try response.apiError(request, kind, request_id, cors);
        return;
    };
    const cookie = try std.fmt.allocPrint(
        allocator,
        "{s}={s}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
        .{ oauth_cookie_name, begun.state },
    );
    try response.redirectWithHeaders(request, begun.redirect_url, request_id, &.{.{
        .name = "set-cookie",
        .value = cookie,
    }});
}

pub fn callback(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    io: std.Io,
    auth: ?config.AuthConfig,
    store: ?AuthStore,
    oauth: ?oauth_gateway.Client,
    request_id: []const u8,
) !void {
    const settings = auth orelse {
        try response.apiError(request, .service_unavailable, request_id, .{ .allowed_origins = "" });
        return;
    };
    const auth_store = store orelse return callbackError(request, allocator, settings, "failed", request_id);
    const client = oauth orelse return callbackError(request, allocator, settings, "failed", request_id);
    const callback_query = parseCallback(allocator, request.head.target) catch {
        return callbackError(request, allocator, settings, "expired", request_id);
    };
    const callback_state = switch (callback_query) {
        .success => |value| value.state,
        .failure => |value| value.state,
    };
    if (!oauthStateMatchesBrowser(request, callback_state))
        return callbackError(request, allocator, settings, "expired", request_id);

    const service: browser_login.Service = .{
        .io = io,
        .settings = settings,
        .store = auth_store,
        .oauth = client,
    };
    const params = switch (callback_query) {
        .success => |value| value,
        .failure => |failure| {
            service.cancel(allocator, failure.state, failure.issuer) catch |err| {
                std.log.warn("OAuth cancellation state failed: {}", .{err});
            };
            return callbackError(request, allocator, settings, "failed", request_id);
        },
    };
    const exchange_token = service.callback(allocator, .{
        .code = params.code,
        .state = params.state,
        .issuer = params.issuer,
    }) catch |err| {
        std.log.warn("OAuth callback failed: {}", .{err});
        return callbackError(request, allocator, settings, "failed", request_id);
    };
    const location = try callbackLocation(
        allocator,
        settings.frontend_origin,
        exchange_token,
    );
    try response.redirectWithHeaders(request, location, request_id, &.{.{
        .name = "set-cookie",
        .value = clear_oauth_cookie,
    }});
}

pub fn exchange(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    auth: ?config.AuthConfig,
    store: ?AuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const settings = auth orelse return unavailable(request, request_id, cors);
    if (!try requireBrowserOrigin(request, settings.frontend_origin, cors, request_id)) return;
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
        "{s}={s}; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax",
        .{ session_cookie_name, session_token },
    );
    try response.jsonWithHeaders(request, .ok, "{}", request_id, cors, &.{
        .{ .name = "set-cookie", .value = cookie },
        no_store_headers[0],
        no_store_headers[1],
    });
}

pub fn me(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?AuthStore,
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
    try response.jsonWithHeaders(
        request,
        .ok,
        body.written(),
        request_id,
        cors,
        &no_store_headers,
    );
}

pub const MutationIdentity = struct {
    session_digest: bearer.Digest,
    session: @import("../internal/auth/store.zig").Session,

    pub fn deinit(self: *MutationIdentity, allocator: std.mem.Allocator) void {
        self.session.deinit(allocator);
        self.* = undefined;
    }
};

/// Authenticate a browser mutation only after binding it to the one configured
/// frontend origin. The caller never receives or persists the bearer cookie.
pub fn requireMutationIdentity(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    auth: ?config.AuthConfig,
    store: ?AuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !?MutationIdentity {
    const settings = auth orelse {
        try unavailable(request, request_id, cors);
        return null;
    };
    if (!try requireBrowserOrigin(request, settings.frontend_origin, cors, request_id))
        return null;
    return requireIdentity(request, allocator, store, cors, request_id);
}

/// Authenticate a browser read without requiring an Origin header. Viewer
/// resources remain no-store; unlike mutations, reads do not need CSRF proof.
pub fn requireIdentity(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?AuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !?MutationIdentity {
    const token = sessionCookie(request) orelse {
        try response.apiError(request, .authentication_required, request_id, cors);
        return null;
    };
    const auth_store = store orelse {
        try unavailable(request, request_id, cors);
        return null;
    };
    const digest = bearer.digest(token);
    const session = auth_store.getSession(allocator, digest) catch {
        try unavailable(request, request_id, cors);
        return null;
    } orelse {
        try response.apiError(request, .authentication_required, request_id, cors);
        return null;
    };
    return .{ .session_digest = digest, .session = session };
}

pub fn logout(
    request: *http.Server.Request,
    auth: ?config.AuthConfig,
    store: ?AuthStore,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const settings = auth orelse return unavailable(request, request_id, cors);
    if (!try requireBrowserOrigin(request, settings.frontend_origin, cors, request_id)) return;
    if (sessionCookie(request)) |token| {
        if (store) |auth_store| {
            _ = auth_store.revokeSession(bearer.digest(token)) catch {
                try response.apiError(request, .service_unavailable, request_id, cors);
                return;
            };
        }
    }
    try response.jsonWithHeaders(request, .ok, "{\"message\":\"logged out\"}", request_id, cors, &.{
        .{
            .name = "set-cookie",
            .value = session_cookie_name ++ "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
        },
        no_store_headers[0],
        no_store_headers[1],
    });
}

fn unavailable(
    request: *http.Server.Request,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !void {
    try response.apiError(request, .service_unavailable, request_id, cors);
}

fn requireBrowserOrigin(
    request: *http.Server.Request,
    expected: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !bool {
    if (response.hasExactRequestOrigin(request, expected)) return true;
    try response.apiError(request, .forbidden, request_id, cors);
    return false;
}

const CallbackParams = struct {
    code: []const u8,
    state: []const u8,
    issuer: []const u8,
};

const CallbackFailure = struct {
    state: []const u8,
    issuer: []const u8,
};

const CallbackQuery = union(enum) {
    success: CallbackParams,
    failure: CallbackFailure,
};

fn parseStartIdentifier(
    allocator: std.mem.Allocator,
    target: []const u8,
) !login_identifier.Identifier {
    var iterator = query.Iterator.init(allocator, target);
    var handle: ?[]const u8 = null;
    while (try iterator.next()) |pair| {
        if (!std.mem.eql(u8, pair.name, "handle") or handle != null)
            return error.InvalidQuery;
        handle = pair.value;
    }
    const value = handle orelse return error.InvalidQuery;
    return login_identifier.parse(allocator, value) catch return error.InvalidQuery;
}

fn parseCallback(allocator: std.mem.Allocator, target: []const u8) !CallbackQuery {
    var iterator = query.Iterator.init(allocator, target);
    var code: ?[]const u8 = null;
    var state: ?[]const u8 = null;
    var issuer: ?[]const u8 = null;
    var oauth_error: ?[]const u8 = null;
    var error_description: ?[]const u8 = null;
    var error_uri: ?[]const u8 = null;
    while (try iterator.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "code") and code == null) {
            code = pair.value;
        } else if (std.mem.eql(u8, pair.name, "state") and state == null) {
            state = pair.value;
        } else if (std.mem.eql(u8, pair.name, "iss") and issuer == null) {
            issuer = pair.value;
        } else if (std.mem.eql(u8, pair.name, "error") and oauth_error == null) {
            oauth_error = pair.value;
        } else if (std.mem.eql(u8, pair.name, "error_description") and error_description == null) {
            error_description = pair.value;
        } else if (std.mem.eql(u8, pair.name, "error_uri") and error_uri == null) {
            error_uri = pair.value;
        } else {
            return error.InvalidQuery;
        }
    }
    const state_value = state orelse return error.InvalidQuery;
    const issuer_value = issuer orelse return error.InvalidQuery;
    if (!browser_login.isCanonicalState(state_value) or
        issuer_value.len == 0 or issuer_value.len > 2048)
        return error.InvalidQuery;
    if (oauth_error) |error_value| {
        if (code != null or error_value.len == 0 or error_value.len > 256 or
            optionalTooLong(error_description, 2048) or
            optionalTooLong(error_uri, 2048))
            return error.InvalidQuery;
        return .{ .failure = .{ .state = state_value, .issuer = issuer_value } };
    }
    if (error_description != null or error_uri != null) return error.InvalidQuery;
    const code_value = code orelse return error.InvalidQuery;
    if (code_value.len == 0 or code_value.len > 2048) return error.InvalidQuery;
    return .{ .success = .{
        .code = code_value,
        .state = state_value,
        .issuer = issuer_value,
    } };
}

fn optionalTooLong(value: ?[]const u8, maximum: usize) bool {
    return if (value) |bytes| bytes.len > maximum else false;
}

fn callbackError(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    settings: config.AuthConfig,
    code: []const u8,
    request_id: []const u8,
) !void {
    const location = try std.fmt.allocPrint(
        allocator,
        "{s}/?auth_error={s}",
        .{ settings.frontend_origin, code },
    );
    try response.redirectWithHeaders(request, location, request_id, &.{.{
        .name = "set-cookie",
        .value = clear_oauth_cookie,
    }});
}

fn callbackLocation(
    allocator: std.mem.Allocator,
    frontend_origin: []const u8,
    exchange_token: []const u8,
) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "{s}/portal#exchange_token={s}",
        .{ frontend_origin, exchange_token },
    );
}

fn sessionCookie(request: *const http.Server.Request) ?[]const u8 {
    return canonicalCookie(request, session_cookie_name, .bearer);
}

fn oauthStateMatchesBrowser(
    request: *const http.Server.Request,
    callback_state: []const u8,
) bool {
    const browser_state = canonicalCookie(request, oauth_cookie_name, .oauth_state) orelse
        return false;
    return std.mem.eql(u8, browser_state, callback_state);
}

const CookieValueKind = enum {
    bearer,
    oauth_state,

    fn isCanonical(self: CookieValueKind, value: []const u8) bool {
        return switch (self) {
            .bearer => bearer.isCanonical(value),
            .oauth_state => browser_login.isCanonicalState(value),
        };
    }
};

fn canonicalCookie(
    request: *const http.Server.Request,
    name: []const u8,
    kind: CookieValueKind,
) ?[]const u8 {
    var candidate: ?[]const u8 = null;
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (!std.ascii.eqlIgnoreCase(header.name, "cookie")) continue;
        if (!consumeCookieHeader(&candidate, header.value, name, kind)) return null;
    }
    return candidate;
}

fn consumeCookieHeader(
    candidate: *?[]const u8,
    header_value: []const u8,
    name: []const u8,
    kind: CookieValueKind,
) bool {
    var cookies = std.mem.splitScalar(u8, header_value, ';');
    while (cookies.next()) |raw| {
        const cookie = std.mem.trim(u8, raw, " \t");
        const equals = std.mem.indexOfScalar(u8, cookie, '=') orelse continue;
        if (!std.mem.eql(u8, cookie[0..equals], name)) continue;
        const value = cookie[equals + 1 ..];
        if (candidate.* != null or !kind.isCanonical(value)) return false;
        candidate.* = value;
    }
    return true;
}

test "Zat emits confidential ATProto OAuth metadata for the browser client" {
    const key = try zat.Keypair.fromSecretKey(.p256, .{0x42} ** 32);
    const body = try zat.oauth.clientMetadataJson(std.testing.allocator, .{
        .client_id = "https://api.next.plyr.fm/oauth-client-metadata.json",
        .client_name = "plyr.fm",
        .client_uri = "https://api.next.plyr.fm",
        .redirect_uris = &.{"https://api.next.plyr.fm/auth/callback"},
        .scope = "atproto repo:fm.plyr.like?action=create&action=update&action=delete",
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

test "OAuth HTTP queries accept handles and DIDs strictly and state is canonical" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    try std.testing.expectEqualStrings(
        "artist.example",
        (try parseStartIdentifier(allocator, "/auth/start?handle=Artist.Example")).handle,
    );
    try std.testing.expectEqualStrings(
        "did:plc:AbC123",
        (try parseStartIdentifier(allocator, "/auth/start?handle=did%3Aplc%3AAbC123")).did,
    );
    try std.testing.expectError(
        error.InvalidQuery,
        parseStartIdentifier(allocator, "/auth/start?handle=a.test&handle=b.test"),
    );
    const state = "QkJCQkJCQkJCQkJCQkJCQg";
    try std.testing.expect(browser_login.isCanonicalState(state));
    const parsed = (try parseCallback(
        allocator,
        "/auth/callback?code=abc&state=QkJCQkJCQkJCQkJCQkJCQg&iss=https%3A%2F%2Fauth.example",
    )).success;
    try std.testing.expectEqualStrings("https://auth.example", parsed.issuer);
    const denied = (try parseCallback(
        allocator,
        "/auth/callback?error=access_denied&error_description=nope&state=QkJCQkJCQkJCQkJCQkJCQg&iss=https%3A%2F%2Fauth.example",
    )).failure;
    try std.testing.expectEqualStrings("https://auth.example", denied.issuer);
    try std.testing.expectError(
        error.InvalidQuery,
        parseCallback(
            allocator,
            "/auth/callback?code=abc&state=bad&iss=https%3A%2F%2Fauth.example",
        ),
    );
}

test "browser exchange capability stays out of HTTP request targets" {
    const location = try callbackLocation(
        std.testing.allocator,
        "https://next.plyr.fm",
        "secret-capability",
    );
    defer std.testing.allocator.free(location);
    try std.testing.expectEqualStrings(
        "https://next.plyr.fm/portal#exchange_token=secret-capability",
        location,
    );
    try std.testing.expect(std.mem.indexOfScalar(u8, location, '?') == null);
}

test "browser OAuth binding accepts exactly one canonical host cookie" {
    const state = "QkJCQkJCQkJCQkJCQkJCQg";
    var candidate: ?[]const u8 = null;
    try std.testing.expect(consumeCookieHeader(
        &candidate,
        "unrelated=value; __Host-plyr_oauth=" ++ state,
        oauth_cookie_name,
        .oauth_state,
    ));
    try std.testing.expectEqualStrings(state, candidate.?);
    try std.testing.expect(!consumeCookieHeader(
        &candidate,
        "__Host-plyr_oauth=" ++ state,
        oauth_cookie_name,
        .oauth_state,
    ));

    candidate = null;
    try std.testing.expect(!consumeCookieHeader(
        &candidate,
        "__Host-plyr_oauth=not-canonical",
        oauth_cookie_name,
        .oauth_state,
    ));
}
