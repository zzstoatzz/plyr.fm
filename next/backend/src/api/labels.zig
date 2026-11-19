//! `com.atproto.label.queryLabels`: next's labeler, read by anyone. Labels
//! come back in seq order with their signatures, so a reader can check each
//! one against the `#atproto_label` key in the labeler's DID document.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const query = @import("../internal/http/query.zig");
const PostgresModerationLog = @import("../internal/moderation/postgres_log.zig").PostgresModerationLog;
const LabelQuery = @import("../internal/moderation/postgres_log.zig").LabelQuery;

pub const path = "/xrpc/com.atproto.label.queryLabels";
const default_limit = 50;
const maximum_limit = 250;
const maximum_patterns = 50;

pub fn queryLabels(
    request: *Exchange,
    allocator: std.mem.Allocator,
    store: ?*PostgresModerationLog,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    if (request.method != .GET) {
        try xrpcError(request, .method_not_allowed, "InvalidRequest", "method not allowed", request_id, cors);
        return;
    }
    const labels_store = store orelse {
        try xrpcError(request, .service_unavailable, "ServiceUnavailable", "labels are temporarily unavailable", request_id, cors);
        return;
    };
    const params = parseParams(allocator, request.target) catch {
        try xrpcError(request, .bad_request, "InvalidRequest", "uriPatterns is required; limit 1-250; cursor is a number", request_id, cors);
        return;
    };
    const labels = labels_store.queryLabels(allocator, params) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => {
            try xrpcError(request, .service_unavailable, "ServiceUnavailable", "labels are temporarily unavailable", request_id, cors);
            return;
        },
    };

    var out: std.Io.Writer.Allocating = .init(allocator);
    var json: std.json.Stringify = .{ .writer = &out.writer };
    try json.beginObject();
    if (labels.len == params.limit) {
        try json.objectField("cursor");
        try json.write(try std.fmt.allocPrint(allocator, "{d}", .{labels[labels.len - 1].seq}));
    }
    try json.objectField("labels");
    try json.beginArray();
    for (labels) |label| {
        try json.beginObject();
        try json.objectField("ver");
        try json.write(1);
        try json.objectField("src");
        try json.write(label.src);
        try json.objectField("uri");
        try json.write(label.uri);
        if (label.cid) |cid| {
            try json.objectField("cid");
            try json.write(cid);
        }
        try json.objectField("val");
        try json.write(label.val);
        if (label.neg) {
            try json.objectField("neg");
            try json.write(true);
        }
        try json.objectField("cts");
        try json.write(label.cts);
        if (label.exp) |exp| {
            try json.objectField("exp");
            try json.write(exp);
        }
        // atproto's JSON form of bytes
        const encoded = try allocator.alloc(u8, std.base64.standard_no_pad.Encoder.calcSize(label.sig.len));
        try json.objectField("sig");
        try json.beginObject();
        try json.objectField("$bytes");
        try json.write(std.base64.standard_no_pad.Encoder.encode(encoded, label.sig));
        try json.endObject();
        try json.endObject();
    }
    try json.endArray();
    try json.endObject();
    var public = cors;
    public.public = true;
    try response.json(request, .ok, out.written(), request_id, public);
}

fn parseParams(allocator: std.mem.Allocator, target: []const u8) !LabelQuery {
    var exact: std.ArrayList([]const u8) = .empty;
    var prefixes: std.ArrayList([]const u8) = .empty;
    var sources: std.ArrayList([]const u8) = .empty;
    var limit: u16 = default_limit;
    var after: i64 = 0;
    var it = query.Iterator.init(allocator, target);
    while (try it.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "uriPatterns")) {
            if (exact.items.len + prefixes.items.len >= maximum_patterns) return error.InvalidQuery;
            const value = pair.value;
            if (value.len == 0) return error.InvalidQuery;
            // a trailing `*` is a prefix; a bare `*` would dump the table
            if (std.mem.endsWith(u8, value, "*")) {
                const prefix = value[0 .. value.len - 1];
                if (prefix.len == 0) return error.InvalidQuery;
                if (std.mem.indexOfScalar(u8, prefix, '*') != null) return error.InvalidQuery;
                try prefixes.append(allocator, prefix);
            } else {
                if (std.mem.indexOfScalar(u8, value, '*') != null) return error.InvalidQuery;
                try exact.append(allocator, value);
            }
        } else if (std.mem.eql(u8, pair.name, "sources")) {
            try sources.append(allocator, pair.value);
        } else if (std.mem.eql(u8, pair.name, "limit")) {
            limit = try query.parseDecimal(u16, pair.value);
            if (limit == 0 or limit > maximum_limit) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            after = try query.parseDecimal(i64, pair.value);
            if (after < 0) return error.InvalidQuery;
        } else return error.InvalidQuery;
    }
    if (exact.items.len + prefixes.items.len == 0) return error.InvalidQuery;
    return .{
        .exact = exact.items,
        .prefixes = prefixes.items,
        .sources = sources.items,
        .after_seq = after,
        .limit = limit,
    };
}

fn xrpcError(
    request: *Exchange,
    status: std.http.Status,
    comptime name: []const u8,
    comptime message: []const u8,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !void {
    try response.json(request, status, "{\"error\":\"" ++ name ++ "\",\"message\":\"" ++ message ++ "\"}", request_id, cors);
}

test "queryLabels takes exact URIs and trailing-star prefixes" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const params = try parseParams(arena, "/xrpc/x?uriPatterns=at%3A%2F%2Fdid%3Aplc%3Aa%2F*&uriPatterns=did%3Aplc%3Ab&limit=10&cursor=7");
    try std.testing.expectEqualStrings("at://did:plc:a/", params.prefixes[0]);
    try std.testing.expectEqualStrings("did:plc:b", params.exact[0]);
    try std.testing.expectEqual(@as(u16, 10), params.limit);
    try std.testing.expectEqual(@as(i64, 7), params.after_seq);
    // label_sync's own pattern ("at://*" and "did:*") stays valid
    const wide = try parseParams(arena, "/xrpc/x?uriPatterns=at%3A%2F%2F*&uriPatterns=did%3A*");
    try std.testing.expectEqual(@as(usize, 2), wide.prefixes.len);
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x"));
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?uriPatterns=*"));
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?uriPatterns=at*b"));
    try std.testing.expectError(error.InvalidQuery, parseParams(arena, "/xrpc/x?uriPatterns=did%3Aplc%3Aa&limit=999"));
}
