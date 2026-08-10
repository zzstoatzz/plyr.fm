//! Destination-safe ATProto OAuth adapter.
//!
//! Zat owns protocol ceremony. This adapter adds plyr's identity binding and
//! SSRF policy: every untrusted PDS/auth-server origin is resolved, all DNS
//! answers are classified, and the selected public address is pinned while
//! retaining the original TLS identity.

const std = @import("std");
const zat = @import("zat");
const config = @import("../../config.zig");
const oauth_state = @import("oauth_state.zig");
const pinned_tls = @import("../ingest/pinned_tls.zig");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");

pub const BeginResult = struct {
    state: []const u8,
    redirect_url: []const u8,
    request: oauth_state.Request,
};

pub const ExchangeResult = struct {
    scope: []const u8,
    credentials: oauth_state.Credentials,
};

/// Application-facing port. HTTP tests can exercise state/session semantics
/// without weakening production SSRF checks or reaching the public network.
pub const Client = struct {
    context: *anyopaque,
    begin_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        config.AuthConfig,
        []const u8,
    ) anyerror!BeginResult,
    exchange_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        config.AuthConfig,
        oauth_state.Request,
        []const u8,
    ) anyerror!ExchangeResult,

    pub fn begin(
        self: Client,
        allocator: std.mem.Allocator,
        settings: config.AuthConfig,
        handle: []const u8,
    ) !BeginResult {
        return self.begin_fn(self.context, allocator, settings, handle);
    }

    pub fn exchangeCode(
        self: Client,
        allocator: std.mem.Allocator,
        settings: config.AuthConfig,
        request: oauth_state.Request,
        code: []const u8,
    ) !ExchangeResult {
        return self.exchange_fn(self.context, allocator, settings, request, code);
    }
};

pub const OAuthGateway = struct {
    io: std.Io,

    pub fn client(self: *OAuthGateway) Client {
        return .{
            .context = self,
            .begin_fn = beginOpaque,
            .exchange_fn = exchangeOpaque,
        };
    }

    fn beginOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        settings: config.AuthConfig,
        handle: []const u8,
    ) !BeginResult {
        const self: *OAuthGateway = @ptrCast(@alignCast(context));
        return self.begin(allocator, settings, handle);
    }

    fn exchangeOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        settings: config.AuthConfig,
        request: oauth_state.Request,
        code: []const u8,
    ) !ExchangeResult {
        const self: *OAuthGateway = @ptrCast(@alignCast(context));
        return self.exchangeCode(allocator, settings, request, code);
    }

    pub fn begin(
        self: OAuthGateway,
        allocator: std.mem.Allocator,
        settings: config.AuthConfig,
        raw_handle: []const u8,
    ) !BeginResult {
        const handle_text = try asciiLower(allocator, raw_handle);
        const handle = zat.Handle.parse(handle_text) orelse return error.InvalidHandle;

        var handle_resolver = zat.HandleResolver.init(self.io, allocator);
        defer handle_resolver.deinit();
        const did_text = try handle_resolver.resolve(handle);
        const did = zat.Did.parse(did_text) orelse return error.InvalidResolvedDid;

        var did_resolver = zat.DidResolver.init(self.io, allocator);
        defer did_resolver.deinit();
        var document = try did_resolver.resolve(did);
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text)) return error.DidDocumentMismatch;
        if (!documentClaimsHandle(document, handle_text)) return error.HandleDidMismatch;
        const pds_url = pdsService(document) orelse return error.MissingPdsService;

        var pds = try safe_endpoint.resolve(self.io, allocator, pds_url);
        defer pds.deinit(allocator);
        var transport = zat.HttpTransport.init(self.io, allocator);
        defer transport.deinit();
        try pinned_tls.prepare(self.io, &transport);
        const issuer = try zat.oauth.discoverAuthorizationServerResolved(
            allocator,
            &transport,
            pds.base_url,
            pds.connection(),
        );

        var auth_server = try safe_endpoint.resolve(self.io, allocator, issuer);
        defer auth_server.deinit(allocator);
        var metadata = try zat.oauth.fetchAuthorizationServerMetadataResolved(
            allocator,
            &transport,
            auth_server.base_url,
            auth_server.connection(),
        );
        defer metadata.deinit(allocator);
        const authorization_origin = try endpointOrigin(
            allocator,
            metadata.authorization_endpoint,
        );
        var authorization_destination = try safe_endpoint.resolve(
            self.io,
            allocator,
            authorization_origin,
        );
        defer authorization_destination.deinit(allocator);
        const par_origin = try endpointOrigin(
            allocator,
            metadata.pushed_authorization_request_endpoint,
        );
        var par_destination = try safe_endpoint.resolve(
            self.io,
            allocator,
            par_origin,
        );
        defer par_destination.deinit(allocator);
        const token_origin = try endpointOrigin(allocator, metadata.token_endpoint);
        var token_destination = try safe_endpoint.resolve(
            self.io,
            allocator,
            token_origin,
        );
        defer token_destination.deinit(allocator);

        var secrets = try zat.oauth.prepareAuthRequestSecrets(allocator, self.io);
        defer secrets.deinit(allocator);
        var par = try zat.oauth.sendParRequest(allocator, self.io, &transport, .{
            .par_url = metadata.pushed_authorization_request_endpoint,
            .authserver_issuer = metadata.issuer,
            .client_id = settings.client_id,
            .redirect_uri = settings.redirect_uri,
            .scope = settings.scope,
            .state = secrets.state,
            .pkce_challenge = secrets.pkce_challenge,
            .login_hint = handle_text,
            .client_keypair = &settings.client_keypair,
            .dpop_keypair = &secrets.dpop_keypair,
            .resolved_connection = par_destination.connection(),
        });
        defer par.deinit(allocator);

        return .{
            .state = try allocator.dupe(u8, secrets.state),
            .redirect_url = try zat.oauth.authorizationUrl(
                allocator,
                metadata.authorization_endpoint,
                par.request_uri,
                settings.client_id,
                secrets.state,
            ),
            .request = .{
                .did = try allocator.dupe(u8, did_text),
                .handle = try allocator.dupe(u8, handle_text),
                .pds_url = try allocator.dupe(u8, pds.base_url),
                .issuer = try allocator.dupe(u8, metadata.issuer),
                .token_endpoint = try allocator.dupe(u8, metadata.token_endpoint),
                .pkce_verifier = try allocator.dupe(u8, secrets.pkce_verifier),
                .dpop_secret = secrets.dpop_keypair.secret_key,
                .dpop_nonce = if (par.dpop_nonce) |nonce| try allocator.dupe(u8, nonce) else null,
            },
        };
    }

    pub fn exchangeCode(
        self: OAuthGateway,
        allocator: std.mem.Allocator,
        settings: config.AuthConfig,
        request: oauth_state.Request,
        code: []const u8,
    ) !ExchangeResult {
        const token_origin = try endpointOrigin(allocator, request.token_endpoint);
        var token_destination = try safe_endpoint.resolve(self.io, allocator, token_origin);
        defer token_destination.deinit(allocator);
        var transport = zat.HttpTransport.init(self.io, allocator);
        defer transport.deinit();
        try pinned_tls.prepare(self.io, &transport);
        const dpop_keypair = try zat.Keypair.fromSecretKey(.p256, request.dpop_secret);
        var tokens = try zat.oauth.exchangeCodeForToken(allocator, self.io, &transport, .{
            .token_url = request.token_endpoint,
            .authserver_issuer = request.issuer,
            .client_id = settings.client_id,
            .redirect_uri = settings.redirect_uri,
            .code = code,
            .pkce_verifier = request.pkce_verifier,
            .client_keypair = &settings.client_keypair,
            .dpop_keypair = &dpop_keypair,
            .dpop_nonce = request.dpop_nonce,
            .resolved_connection = token_destination.connection(),
        });
        defer tokens.deinit(allocator);
        try requireTokenSubject(request.did, tokens.sub);

        return .{
            .scope = try allocator.dupe(u8, tokens.scope),
            .credentials = .{
                .issuer = try allocator.dupe(u8, request.issuer),
                .token_endpoint = try allocator.dupe(u8, request.token_endpoint),
                .pds_url = try allocator.dupe(u8, request.pds_url),
                .access_token = try allocator.dupe(u8, tokens.access_token),
                .refresh_token = try allocator.dupe(u8, tokens.refresh_token),
                .scope = try allocator.dupe(u8, tokens.scope),
                .dpop_secret = request.dpop_secret,
                .dpop_nonce = if (tokens.dpop_nonce) |nonce| try allocator.dupe(u8, nonce) else null,
            },
        };
    }
};

fn asciiLower(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const normalized = try allocator.alloc(u8, value.len);
    for (value, normalized) |source, *destination| destination.* = std.ascii.toLower(source);
    return normalized;
}

fn documentClaimsHandle(document: zat.DidDocument, expected: []const u8) bool {
    for (document.handles) |candidate| {
        if (std.ascii.eqlIgnoreCase(candidate, expected)) return true;
    }
    return false;
}

fn pdsService(document: zat.DidDocument) ?[]const u8 {
    for (document.services) |service| {
        if (isAtprotoPdsServiceId(document.id, service.id) and
            std.mem.eql(u8, service.type, "AtprotoPersonalDataServer"))
            return service.service_endpoint;
    }
    return null;
}

fn isAtprotoPdsServiceId(did: []const u8, service_id: []const u8) bool {
    const fragment = "#atproto_pds";
    if (std.mem.eql(u8, service_id, fragment)) return true;
    return service_id.len == did.len + fragment.len and
        std.mem.startsWith(u8, service_id, did) and
        std.mem.eql(u8, service_id[did.len..], fragment);
}

fn endpointOrigin(allocator: std.mem.Allocator, endpoint: []const u8) ![]u8 {
    const uri = std.Uri.parse(endpoint) catch return error.InvalidOauthEndpoint;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "https") or
        uri.user != null or uri.password != null or uri.fragment != null)
        return error.InvalidOauthEndpoint;
    const host = switch (uri.host orelse return error.InvalidOauthEndpoint) {
        .raw => |value| value,
        .percent_encoded => |value| if (std.mem.indexOfScalar(u8, value, '%') == null)
            value
        else
            return error.InvalidOauthEndpoint,
    };
    if (host.len == 0) return error.InvalidOauthEndpoint;
    return if (uri.port) |port|
        std.fmt.allocPrint(allocator, "https://{s}:{d}", .{ host, port })
    else
        std.fmt.allocPrint(allocator, "https://{s}", .{host});
}

fn requireTokenSubject(expected_did: []const u8, subject: ?[]const u8) !void {
    const actual = subject orelse return error.MissingTokenSubject;
    if (!std.mem.eql(u8, actual, expected_did)) return error.TokenSubjectMismatch;
}

test "identity binding requires the resolved DID document to claim the handle" {
    const json =
        \\{"id":"did:plc:test","alsoKnownAs":["at://Artist.Example"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}
    ;
    var document = try zat.DidDocument.parse(std.testing.allocator, json);
    defer document.deinit();
    try std.testing.expect(documentClaimsHandle(document, "artist.example"));
    try std.testing.expect(!documentClaimsHandle(document, "attacker.example"));
    try std.testing.expectEqualStrings("https://pds.example", pdsService(document).?);
}

test "PDS selection rejects a service with only a lookalike id" {
    const json =
        \\{"id":"did:plc:test","alsoKnownAs":["at://artist.example"],"service":[{"id":"did:plc:attacker#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://attacker.example"},{"id":"#atproto_pds","type":"OtherService","serviceEndpoint":"https://pds.example"}]}
    ;
    var document = try zat.DidDocument.parse(std.testing.allocator, json);
    defer document.deinit();
    try std.testing.expect(pdsService(document) == null);
}

test "PDS selection accepts an absolute service id owned by the DID" {
    const json =
        \\{"id":"did:plc:test","alsoKnownAs":["at://artist.example"],"service":[{"id":"did:plc:test#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}
    ;
    var document = try zat.DidDocument.parse(std.testing.allocator, json);
    defer document.deinit();
    try std.testing.expectEqualStrings("https://pds.example", pdsService(document).?);
}

test "token subject is mandatory and bound to the login DID" {
    try requireTokenSubject("did:plc:artist", "did:plc:artist");
    try std.testing.expectError(
        error.MissingTokenSubject,
        requireTokenSubject("did:plc:artist", null),
    );
    try std.testing.expectError(
        error.TokenSubjectMismatch,
        requireTokenSubject("did:plc:artist", "did:plc:attacker"),
    );
}

test "OAuth endpoints are independently reduced to safe-resolution origins" {
    const allocator = std.testing.allocator;
    const token_origin = try endpointOrigin(
        allocator,
        "https://tokens.example:8443/oauth/token?tenant=one",
    );
    defer allocator.free(token_origin);
    try std.testing.expectEqualStrings("https://tokens.example:8443", token_origin);
    try std.testing.expectError(
        error.InvalidOauthEndpoint,
        endpointOrigin(allocator, "http://tokens.example/oauth/token"),
    );
    try std.testing.expectError(
        error.InvalidOauthEndpoint,
        endpointOrigin(allocator, "https://user@tokens.example/oauth/token"),
    );
}
