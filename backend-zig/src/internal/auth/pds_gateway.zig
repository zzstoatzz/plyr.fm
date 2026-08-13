//! Destination-pinned DPoP transport for authenticated PDS XRPC commands.

const std = @import("std");
const zat = @import("zat");
const oauth_state = @import("oauth_state.zig");
const pinned_tls = @import("../ingest/pinned_tls.zig");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");

pub const Response = struct {
    status: std.http.Status,
    body: []u8,
    pds_nonce: ?[]const u8,

    pub fn deinit(self: *Response, allocator: std.mem.Allocator) void {
        allocator.free(self.body);
        if (self.pds_nonce) |nonce| allocator.free(nonce);
        self.* = undefined;
    }
};

pub const Client = struct {
    context: *anyopaque,
    request_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        oauth_state.Credentials,
        std.http.Method,
        []const u8,
        ?[]const u8,
    ) anyerror!Response,

    pub fn request(
        self: Client,
        allocator: std.mem.Allocator,
        credentials: oauth_state.Credentials,
        method: std.http.Method,
        procedure: []const u8,
        payload: ?[]const u8,
    ) !Response {
        return self.request_fn(
            self.context,
            allocator,
            credentials,
            method,
            procedure,
            payload,
        );
    }
};

pub const Gateway = struct {
    io: std.Io,

    pub fn client(self: *Gateway) Client {
        return .{ .context = self, .request_fn = requestOpaque };
    }

    fn requestOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        credentials: oauth_state.Credentials,
        method: std.http.Method,
        procedure: []const u8,
        payload: ?[]const u8,
    ) !Response {
        const self: *Gateway = @ptrCast(@alignCast(context));
        return self.request(allocator, credentials, method, procedure, payload);
    }

    pub fn request(
        self: Gateway,
        allocator: std.mem.Allocator,
        credentials: oauth_state.Credentials,
        method: std.http.Method,
        procedure: []const u8,
        payload: ?[]const u8,
    ) !Response {
        if (zat.Nsid.parse(procedure) == null) return error.InvalidProcedure;
        var destination = try safe_endpoint.resolve(self.io, allocator, credentials.pds_url);
        defer destination.deinit(allocator);
        const url = try std.fmt.allocPrint(
            allocator,
            "{s}/xrpc/{s}",
            .{ destination.base_url, procedure },
        );
        var transport = zat.HttpTransport.init(self.io, allocator);
        defer transport.deinit();
        try pinned_tls.prepare(self.io, &transport);
        const dpop_keypair = try zat.Keypair.fromSecretKey(.p256, credentials.dpop_secret);
        var result = try zat.oauth.dpopRequest(allocator, self.io, &transport, .{
            .url = url,
            .method = method,
            .access_token = credentials.access_token,
            .dpop_keypair = &dpop_keypair,
            .dpop_nonce = credentials.pds_dpop_nonce,
            .payload = payload,
            .max_response_size = 1024 * 1024,
            .resolved_connection = destination.connection(),
        });
        errdefer result.deinit(allocator);
        const response: Response = .{
            .status = result.status,
            .body = result.body,
            .pds_nonce = result.dpop_nonce,
        };
        result.body = &.{};
        result.dpop_nonce = null;
        return response;
    }
};

test "PDS procedures must be canonical NSIDs" {
    try std.testing.expect(zat.Nsid.parse("com.atproto.repo.createRecord") != null);
    try std.testing.expect(zat.Nsid.parse("../metadata") == null);
}
