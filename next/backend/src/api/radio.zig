//! Radio over HTTP. `fm.plyr.unspecced.getRadioState` and `getRadioStations`
//! are next's methods; `/radio/state`, `/radio/state.json` and
//! `/radio/stations` answer the same at production's paths, for the external
//! clients, games and the plyr-radio adapter that already read them, so they
//! keep working when api.plyr.fm moves here. Public, credential-free reads.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const query = @import("../internal/http/query.zig");
const radio = @import("../internal/radio/service.zig");
const station_module = @import("../internal/radio/station.zig");
const xrpc = @import("xrpc.zig");

pub const Route = enum { state, stations, xrpc_state, xrpc_stations };

pub fn match(track_collection: []const u8, path: []const u8) ?Route {
    if (std.mem.eql(u8, path, "/radio/state") or std.mem.eql(u8, path, "/radio/state.json")) return .state;
    if (std.mem.eql(u8, path, "/radio/stations")) return .stations;
    const name = xrpc.unspeccedName(track_collection, path) orelse return null;
    if (std.mem.eql(u8, name, "getRadioState")) return .xrpc_state;
    if (std.mem.eql(u8, name, "getRadioStations")) return .xrpc_stations;
    return null;
}

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    service: ?radio.Service,
    route: Route,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    if (request.method != .GET) return response.apiError(request, .method_not_allowed, request_id, cors);
    switch (route) {
        .stations, .xrpc_stations => {
            const body = try std.json.Stringify.valueAlloc(allocator, try radio.lineup(allocator), .{});
            return response.json(request, .ok, body, request_id, cors);
        },
        .state, .xrpc_state => {
            const parsed = parse(allocator, request.target, route == .xrpc_state) catch |err| switch (err) {
                error.OutOfMemory => return err,
                error.UnknownStation => return notFound(request, route, request_id, cors),
                else => return response.apiError(request, .invalid_request, request_id, cors),
            };
            const configured = service orelse return response.apiError(request, .service_unavailable, request_id, cors);
            const now_us = std.Io.Timestamp.now(io, .real).toMicroseconds();
            const state = configured.state(allocator, parsed, now_us) catch |err| switch (err) {
                error.OutOfMemory => return err,
                error.CorruptProjection => return response.apiError(request, .internal_error, request_id, cors),
                else => return response.apiError(request, .service_unavailable, request_id, cors),
            };
            const body = try std.json.Stringify.valueAlloc(allocator, state, .{});
            // every listener polls; let shared caches hold an answer briefly
            return response.jsonWithHeaders(request, .ok, body, request_id, cors, &.{
                .{ .name = "cache-control", .value = "public, max-age=2" },
            });
        },
    }
}

fn notFound(request: *Exchange, route: Route, request_id: []const u8, cors: response.CorsPolicy) !void {
    if (route == .xrpc_state) return response.json(request, .bad_request, "{\"error\":\"UnknownStation\",\"message\":\"unknown station\"}", request_id, cors);
    return response.apiError(request, .not_found, request_id, cors);
}

/// Production's names (`station`, `limit`, `catalog_only`) or XRPC's
/// (`station`, `limit`, `catalogOnly`). Unknown parameters are ignored, as
/// both production and XRPC do.
pub fn parse(allocator: std.mem.Allocator, target: []const u8, xrpc_names: bool) !radio.Service.Request {
    var slug: ?[]const u8 = null;
    var size: usize = radio.default_size;
    var catalog_only = false;
    var seen: [3]bool = .{ false, false, false };
    const catalog_name = if (xrpc_names) "catalogOnly" else "catalog_only";
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "station")) {
            if (seen[0]) return error.InvalidQuery;
            seen[0] = true;
            slug = pair.value;
        } else if (std.mem.eql(u8, pair.name, "limit")) {
            if (seen[1] or pair.value.len == 0) return error.InvalidQuery;
            seen[1] = true;
            size = query.parseDecimal(usize, pair.value) catch return error.InvalidQuery;
            if (size < 1 or size > radio.max_size) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, catalog_name)) {
            if (seen[2]) return error.InvalidQuery;
            seen[2] = true;
            catalog_only = parseBool(pair.value) orelse return error.InvalidQuery;
        }
    }
    const station = station_module.get(slug) orelse return error.UnknownStation;
    return .{ .station = station, .size = size, .catalog_only = catalog_only };
}

fn parseBool(text: []const u8) ?bool {
    inline for (.{ "true", "1", "yes", "on" }) |word| if (std.ascii.eqlIgnoreCase(text, word)) return true;
    inline for (.{ "false", "0", "no", "off" }) |word| if (std.ascii.eqlIgnoreCase(text, word)) return false;
    return null;
}

test "radio answers at production's paths and as XRPC methods" {
    try std.testing.expectEqual(Route.state, match("fm.plyr.track", "/radio/state").?);
    try std.testing.expectEqual(Route.state, match("fm.plyr.track", "/radio/state.json").?);
    try std.testing.expectEqual(Route.stations, match("fm.plyr.track", "/radio/stations").?);
    try std.testing.expectEqual(Route.xrpc_state, match("fm.plyr.track", "/xrpc/fm.plyr.unspecced.getRadioState").?);
    try std.testing.expectEqual(Route.xrpc_stations, match("fm.plyr.track", "/xrpc/fm.plyr.unspecced.getRadioStations").?);
    try std.testing.expect(match("fm.plyr.track", "/radio/loved/listen") == null);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyr.dev.unspecced.getRadioState") == null);
}

test "state parameters: defaults, both spellings, and bounds" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const default = try parse(a, "/radio/state", false);
    try std.testing.expectEqualStrings("loved", default.station.slug);
    try std.testing.expectEqual(radio.default_size, default.size);
    try std.testing.expect(!default.catalog_only);
    const legacy = try parse(a, "/radio/state?station=deep-cuts&limit=10&catalog_only=true", false);
    try std.testing.expectEqualStrings("deep-cuts", legacy.station.slug);
    try std.testing.expectEqual(@as(usize, 10), legacy.size);
    try std.testing.expect(legacy.catalog_only);
    try std.testing.expect((try parse(a, "/x?station=firehose&catalogOnly=false&extra=1", true)).station.live != null);
    try std.testing.expectError(error.UnknownStation, parse(a, "/radio/state?station=jazz", false));
    try std.testing.expectError(error.InvalidQuery, parse(a, "/radio/state?limit=76", false));
    try std.testing.expectError(error.InvalidQuery, parse(a, "/radio/state?limit=0", false));
    try std.testing.expectError(error.InvalidQuery, parse(a, "/radio/state?catalog_only=maybe", false));
    try std.testing.expectError(error.InvalidQuery, parse(a, "/radio/state?station=a&station=b", false));
}
