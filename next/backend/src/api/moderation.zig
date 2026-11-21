//! HTTP surface of the moderation log: four XRPC methods, each authenticated
//! by the caller's own service JWT the way notifications are. Anyone signed
//! in may report; only the configured operator DIDs may read the queue or
//! record a decision, so `actor` on every entry is a verified DID rather
//! than a claim (prod's shared token could only record a claim).

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const bearer = @import("bearer.zig");
const response = @import("response.zig");
const query = @import("../internal/http/query.zig");
const service_auth = @import("../internal/atproto/service_auth.zig");
const Network = @import("../internal/space/network.zig").Network;
const log = @import("../internal/moderation/log.zig");
const PostgresModerationLog = @import("../internal/moderation/postgres_log.zig").PostgresModerationLog;

const maximum_body_bytes = 8 * 1024;
const default_queue_limit = 50;
const maximum_queue_limit = 200;

pub const Method = enum { create_report, get_queue, get_subject, emit_event };

pub const Config = struct {
    audiences: []const []const u8,
    plc_url: []const u8,
    operators: []const []const u8,
    track_collection: []const u8,
    create_report: []const u8,
    get_queue: []const u8,
    get_subject: []const u8,
    emit_event: []const u8,

    /// Method names follow the record namespace, like notifications:
    /// `fm.plyr.track` gives `fm.plyr.moderation.createReport`.
    pub fn init(
        allocator: std.mem.Allocator,
        audiences: []const []const u8,
        plc_url: []const u8,
        track_collection: []const u8,
        operators: []const []const u8,
    ) !Config {
        const suffix = ".track";
        if (!std.mem.endsWith(u8, track_collection, suffix) or track_collection.len == suffix.len)
            return error.UnsupportedTrackCollection;
        const prefix = track_collection[0 .. track_collection.len - suffix.len];
        return .{
            .audiences = audiences,
            .plc_url = plc_url,
            .operators = operators,
            .track_collection = track_collection,
            .create_report = try std.fmt.allocPrint(allocator, "{s}.moderation.createReport", .{prefix}),
            .get_queue = try std.fmt.allocPrint(allocator, "{s}.moderation.getQueue", .{prefix}),
            .get_subject = try std.fmt.allocPrint(allocator, "{s}.moderation.getSubject", .{prefix}),
            .emit_event = try std.fmt.allocPrint(allocator, "{s}.moderation.emitEvent", .{prefix}),
        };
    }

    fn nsid(self: Config, method: Method) []const u8 {
        return switch (method) {
            .create_report => self.create_report,
            .get_queue => self.get_queue,
            .get_subject => self.get_subject,
            .emit_event => self.emit_event,
        };
    }

    pub fn isOperator(self: Config, did: []const u8) bool {
        for (self.operators) |operator| if (std.mem.eql(u8, operator, did)) return true;
        return false;
    }
};

/// Comma-separated DIDs, as `MODERATION_OPERATOR_DIDS` holds them.
pub fn parseOperators(allocator: std.mem.Allocator, raw: []const u8) ![]const []const u8 {
    var out: std.ArrayList([]const u8) = .empty;
    var it = std.mem.tokenizeAny(u8, raw, ", \t\n");
    while (it.next()) |did| {
        if (!std.mem.startsWith(u8, did, "did:")) return error.InvalidOperatorDid;
        try out.append(allocator, did);
    }
    return out.toOwnedSlice(allocator);
}

pub fn match(config: Config, path: []const u8) ?Method {
    const xrpc = "/xrpc/";
    if (!std.mem.startsWith(u8, path, xrpc)) return null;
    const name = path[xrpc.len..];
    for (std.enums.values(Method)) |method| {
        if (std.mem.eql(u8, name, config.nsid(method))) return method;
    }
    return null;
}

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: Config,
    store: ?*PostgresModerationLog,
    method: Method,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const expected: @import("exchange.zig").Method = switch (method) {
        .create_report, .emit_event => .POST,
        .get_queue, .get_subject => .GET,
    };
    if (request.method != expected) {
        try xrpcError(request, .method_not_allowed, "InvalidRequest", "method not allowed", request_id, cors);
        return;
    }
    const response_cors = try response.captureCors(request, allocator, cors);
    const token = try allocator.dupe(u8, bearer.fromRequest(request) orelse {
        try xrpcError(request, .unauthorized, "AuthenticationRequired", "service auth required", request_id, response_cors);
        return;
    });
    const caller = (try authenticate(request, allocator, io, config, config.nsid(method), token, request_id, response_cors)) orelse return;
    if (method != .create_report and !config.isOperator(caller)) {
        try xrpcError(request, .forbidden, "Forbidden", "only moderators can do this", request_id, response_cors);
        return;
    }
    const moderation = store orelse {
        try xrpcError(request, .service_unavailable, "ServiceUnavailable", "moderation is temporarily unavailable", request_id, response_cors);
        return;
    };

    switch (method) {
        .create_report => {
            const body = request.readBody(maximum_body_bytes) catch {
                try xrpcError(request, .bad_request, "InvalidRequest", "unreadable body", request_id, response_cors);
                return;
            };
            const input = parseReport(allocator, body) orelse {
                try xrpcError(request, .bad_request, "InvalidRequest", "a report needs a subject and a reasonType", request_id, response_cors);
                return;
            };
            const outcome = moderation.report(.{
                .subject = input.subject,
                .action = .reported,
                .actor = caller,
                .reason_type = input.reason_type,
                .reason = input.reason,
            }) catch |err| return unavailable(request, err, request_id, response_cors);
            switch (outcome) {
                // a duplicate looks the same as a new report to the reporter
                .recorded, .duplicate => try response.json(request, .ok, "{}", request_id, response_cors),
                .unknown => try xrpcError(request, .bad_request, "UnknownSubject", "we couldn't find what you're reporting", request_id, response_cors),
                .limited => try xrpcError(request, .too_many_requests, "RateLimitExceeded", "too many reports for now. try again in a while", request_id, response_cors),
            }
        },
        .emit_event => {
            const body = request.readBody(maximum_body_bytes) catch {
                try xrpcError(request, .bad_request, "InvalidRequest", "unreadable body", request_id, response_cors);
                return;
            };
            const input = parseEvent(allocator, body) orelse {
                try xrpcError(request, .bad_request, "InvalidRequest", "an event needs a subject and a decision", request_id, response_cors);
                return;
            };
            // decisions only project onto tracks so far; refusing them
            // elsewhere keeps an operator from thinking an account is hidden
            if (input.action.decision() != null and !log.isTrack(input.subject, config.track_collection)) {
                try xrpcError(request, .bad_request, "UnsupportedSubject", "allow and exclude only apply to tracks for now", request_id, response_cors);
                return;
            }
            const id = moderation.record(.{
                .subject = input.subject,
                .action = input.action,
                .actor = caller,
                .reason = input.reason,
                .label_value = input.value,
            }, std.Io.Timestamp.now(io, .real).toMilliseconds()) catch |err| switch (err) {
                error.LabelNotAllowed => {
                    try xrpcError(request, .bad_request, "InvalidLabel", "that label does not apply to this subject", request_id, response_cors);
                    return;
                },
                error.LabelerUnavailable => {
                    try xrpcError(request, .service_unavailable, "LabelerUnavailable", "the labeler is not set up", request_id, response_cors);
                    return;
                },
                else => return unavailable(request, err, request_id, response_cors),
            };
            const out = try std.fmt.allocPrint(allocator, "{{\"id\":{d}}}", .{id});
            try response.json(request, .ok, out, request_id, response_cors);
        },
        .get_queue => {
            const page = queuePage(allocator, request.target) orelse {
                try xrpcError(request, .bad_request, "InvalidRequest", "invalid limit or cursor", request_id, response_cors);
                return;
            };
            const items = moderation.queue(allocator, page.limit, page.after) catch |err| return unavailable(request, err, request_id, response_cors);
            const cursor: ?[]const u8 = if (items.len == page.limit) try std.fmt.allocPrint(allocator, "{d}", .{items[items.len - 1].cursor}) else null;
            const out = try std.json.Stringify.valueAlloc(allocator, .{ .items = items, .cursor = cursor }, .{ .emit_null_optional_fields = false });
            try response.json(request, .ok, out, request_id, response_cors);
        },
        .get_subject => {
            const subject = subjectParam(allocator, request.target) orelse {
                try xrpcError(request, .bad_request, "InvalidRequest", "subject must be an AT URI or DID", request_id, response_cors);
                return;
            };
            const entries = moderation.history(allocator, subject) catch |err| return unavailable(request, err, request_id, response_cors);
            const out = try std.json.Stringify.valueAlloc(allocator, .{ .subject = subject, .events = entries }, .{});
            try response.json(request, .ok, out, request_id, response_cors);
        },
    }
}

const ReportInput = struct { subject: []const u8, reason_type: log.ReasonType, reason: ?[]const u8 };
const EventInput = struct { subject: []const u8, action: log.Action, reason: ?[]const u8, value: ?[]const u8 = null };

fn parseReport(allocator: std.mem.Allocator, body: []const u8) ?ReportInput {
    const Raw = struct { subject: []const u8, reasonType: []const u8, reason: ?[]const u8 = null };
    const raw = std.json.parseFromSliceLeaky(Raw, allocator, body, .{}) catch return null;
    if (!log.validSubject(raw.subject)) return null;
    const reason_type = log.ReasonType.parse(raw.reasonType) orelse return null;
    return .{ .subject = raw.subject, .reason_type = reason_type, .reason = optionalReason(raw.reason) orelse return null };
}

fn parseEvent(allocator: std.mem.Allocator, body: []const u8) ?EventInput {
    const Raw = struct { subject: []const u8, action: []const u8, reason: ?[]const u8 = null, value: ?[]const u8 = null };
    const raw = std.json.parseFromSliceLeaky(Raw, allocator, body, .{}) catch return null;
    if (!log.validSubject(raw.subject)) return null;
    const action = log.Action.parse(raw.action) orelse return null;
    if (!action.operatorMay()) return null;
    // a label action names its value; nothing else carries one
    if (action.isLabel() != (raw.value != null)) return null;
    return .{ .subject = raw.subject, .action = action, .reason = optionalReason(raw.reason) orelse return null, .value = raw.value };
}

/// Outer null = invalid; inner null = no reason given (blank counts as none).
fn optionalReason(reason: ?[]const u8) ??[]const u8 {
    const text = reason orelse return @as(?[]const u8, null);
    const trimmed = std.mem.trim(u8, text, " \t\r\n");
    if (trimmed.len == 0) return @as(?[]const u8, null);
    if (!log.validReason(trimmed)) return null;
    return trimmed;
}

const QueuePage = struct { limit: u16, after: i64 };

fn queuePage(allocator: std.mem.Allocator, target: []const u8) ?QueuePage {
    var it = query.Iterator.init(allocator, target);
    var page: QueuePage = .{ .limit = default_queue_limit, .after = 0 };
    while (it.next() catch return null) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            page.limit = query.parseDecimal(u16, pair.value) catch return null;
            if (page.limit == 0 or page.limit > maximum_queue_limit) return null;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            page.after = query.parseDecimal(i64, pair.value) catch return null;
            if (page.after < 0) return null;
        } else return null;
    }
    return page;
}

fn subjectParam(allocator: std.mem.Allocator, target: []const u8) ?[]const u8 {
    var it = query.Iterator.init(allocator, target);
    var subject: ?[]const u8 = null;
    while (it.next() catch return null) |pair| {
        if (!std.mem.eql(u8, pair.name, "subject") or subject != null) return null;
        subject = pair.value;
    }
    const value = subject orelse return null;
    return if (log.validSubject(value)) value else null;
}

fn unavailable(request: *Exchange, err: anyerror, request_id: []const u8, cors: response.CorsPolicy) !void {
    if (err == error.OutOfMemory) return error.OutOfMemory;
    try xrpcError(request, .service_unavailable, "ServiceUnavailable", "moderation is temporarily unavailable", request_id, cors);
}

fn authenticate(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    config: Config,
    nsid: []const u8,
    token: []const u8,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !?[]const u8 {
    var network = Network.init(io, allocator, config.plc_url);
    defer network.deinit();
    const now = std.Io.Timestamp.now(io, .real).toSeconds();
    return service_auth.verify(allocator, now, token, .{
        .audiences = config.audiences,
        .method = nsid,
    }, network.keys()) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.BadAudience => {
            try xrpcError(request, .unauthorized, "BadJwtAudience", "jwt audience does not match this service", request_id, cors);
            return null;
        },
        error.BadMethod => {
            try xrpcError(request, .unauthorized, "BadJwtLexiconMethod", "jwt lxm does not match", request_id, cors);
            return null;
        },
        error.Expired => {
            try xrpcError(request, .unauthorized, "JwtExpired", "jwt expired", request_id, cors);
            return null;
        },
        else => {
            std.log.info("moderation auth rejected: {s}", .{@errorName(err)});
            try xrpcError(request, .unauthorized, "AuthenticationRequired", "invalid service auth", request_id, cors);
            return null;
        },
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

test "moderation methods follow the record namespace" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const operators = try parseOperators(arena, "did:plc:nate, did:web:mod.example");
    const config = try Config.init(arena, &.{"did:web:api.next.plyr.fm"}, "https://plc.directory", "fm.plyr.track", operators);
    try std.testing.expectEqual(Method.create_report, match(config, "/xrpc/fm.plyr.moderation.createReport").?);
    try std.testing.expectEqual(Method.emit_event, match(config, "/xrpc/fm.plyr.moderation.emitEvent").?);
    try std.testing.expectEqual(@as(?Method, null), match(config, "/xrpc/fm.plyr.moderation.takedown"));
    try std.testing.expect(config.isOperator("did:web:mod.example"));
    try std.testing.expect(!config.isOperator("did:plc:someone"));
    try std.testing.expectError(error.InvalidOperatorDid, parseOperators(arena, "nate"));
    try std.testing.expectEqual(@as(usize, 0), (try parseOperators(arena, "")).len);
}

test "reports and events reject what the log cannot hold" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const subject = "at://did:plc:a/fm.plyr.track/3k1";
    const report = parseReport(arena, "{\"subject\":\"" ++ subject ++ "\",\"reasonType\":\"copyright\",\"reason\":\"  \"}").?;
    try std.testing.expectEqual(log.ReasonType.copyright, report.reason_type);
    try std.testing.expectEqual(@as(?[]const u8, null), report.reason);
    try std.testing.expectEqual(@as(?ReportInput, null), parseReport(arena, "{\"subject\":\"" ++ subject ++ "\",\"reasonType\":\"vibes\"}"));
    try std.testing.expectEqual(@as(?ReportInput, null), parseReport(arena, "{\"subject\":\"nope\",\"reasonType\":\"spam\"}"));
    const event = parseEvent(arena, "{\"subject\":\"" ++ subject ++ "\",\"action\":\"override_allow\",\"reason\":\"licensed cover\"}").?;
    try std.testing.expectEqual(log.Action.override_allow, event.action);
    try std.testing.expectEqualStrings("licensed cover", event.reason.?);
    // operators decide; they cannot forge a report or a scanner flag
    try std.testing.expectEqual(@as(?EventInput, null), parseEvent(arena, "{\"subject\":\"" ++ subject ++ "\",\"action\":\"reported\"}"));
    try std.testing.expectEqual(@as(?EventInput, null), parseEvent(arena, "{\"subject\":\"" ++ subject ++ "\",\"action\":\"flagged_by_scan\"}"));
    const label = parseEvent(arena, "{\"subject\":\"" ++ subject ++ "\",\"action\":\"label_applied\",\"value\":\"copyright-violation\"}").?;
    try std.testing.expectEqualStrings("copyright-violation", label.value.?);
    try std.testing.expectEqual(@as(?EventInput, null), parseEvent(arena, "{\"subject\":\"" ++ subject ++ "\",\"action\":\"label_applied\"}"));
    try std.testing.expectEqual(@as(?EventInput, null), parseEvent(arena, "{\"subject\":\"" ++ subject ++ "\",\"action\":\"acknowledged\",\"value\":\"porn\"}"));
    const long = try arena.alloc(u8, log.max_reason_bytes + 1);
    @memset(long, 'x');
    const body = try std.fmt.allocPrint(arena, "{{\"subject\":\"{s}\",\"action\":\"acknowledged\",\"reason\":\"{s}\"}}", .{ subject, long });
    try std.testing.expectEqual(@as(?EventInput, null), parseEvent(arena, body));
}

test "queue and subject parameters are strict" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    try std.testing.expectEqual(@as(u16, 50), queuePage(arena, "/xrpc/x").?.limit);
    try std.testing.expectEqual(@as(u16, 10), queuePage(arena, "/xrpc/x?limit=10").?.limit);
    try std.testing.expectEqual(@as(i64, 42), queuePage(arena, "/xrpc/x?limit=10&cursor=42").?.after);
    try std.testing.expectEqual(@as(?QueuePage, null), queuePage(arena, "/xrpc/x?limit=0"));
    try std.testing.expectEqual(@as(?QueuePage, null), queuePage(arena, "/xrpc/x?limit=999"));
    try std.testing.expectEqual(@as(?QueuePage, null), queuePage(arena, "/xrpc/x?cursor=-1"));
    try std.testing.expectEqual(@as(?QueuePage, null), queuePage(arena, "/xrpc/x?page=2"));
    try std.testing.expectEqualStrings("at://did:plc:a/fm.plyr.track/3k1", subjectParam(arena, "/xrpc/x?subject=at%3A%2F%2Fdid%3Aplc%3Aa%2Ffm.plyr.track%2F3k1").?);
    try std.testing.expectEqual(@as(?[]const u8, null), subjectParam(arena, "/xrpc/x?subject=did:plc:a&subject=did:plc:b"));
    try std.testing.expectEqual(@as(?[]const u8, null), subjectParam(arena, "/xrpc/x"));
}
