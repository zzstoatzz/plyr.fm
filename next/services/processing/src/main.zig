//! Next's upload processing executor.
//!
//! The audio Worker's owner Durable Object dispatches one attempt at a time;
//! this service pulls the retained source, encodes the playback rendition and
//! uploads it back through per-attempt callbacks. See
//! `next/backend/docs/upload-processing.md` for the protocol. It owns no PDS
//! credentials, knows no user identity, and shares nothing with the legacy
//! transcoder.

const std = @import("std");
const httpz = @import("httpz");
const attempt_module = @import("attempt.zig");
const runner_module = @import("runner.zig");

const Runner = runner_module.Runner;

pub const std_options: std.Options = .{ .log_level = .info };

const Handler = struct {
    runner: *Runner,

    pub fn handle(self: *Handler, req: *httpz.Request, res: *httpz.Response) void {
        res.status, res.body = route(self.runner, req);
    }
};

fn route(runner: *Runner, req: *httpz.Request) struct { u16, []const u8 } {
    const path = req.url.path;
    if (std.mem.eql(u8, path, "/health")) {
        if (req.method != .GET and req.method != .HEAD) return .{ 405, "" };
        return .{ 200, "{\"status\":\"ok\"}" };
    }
    if (std.mem.eql(u8, path, "/v1/processing")) {
        if (req.method != .POST) return .{ 405, "" };
        const status = runner.start(req.header("x-processing-key"), req.body() orelse "");
        return .{ @backingInt(status), "" };
    }
    return .{ 404, "" };
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const env = init.environ_map;
    const origin_value = env.get("NEXT_PROCESSING_ORIGIN");
    const auth = env.get("NEXT_PROCESSING_AUTH_TOKEN");
    if (origin_value == null or auth == null) {
        std.log.err("NEXT_PROCESSING_ORIGIN and NEXT_PROCESSING_AUTH_TOKEN are required", .{});
        return error.MissingConfiguration;
    }
    if (!std.mem.eql(u8, env.get("FLY_APP_NAME") orelse "", "plyr-next-processing")) {
        std.log.err("Next processing runs only in the plyr-next-processing app", .{});
        return error.WrongApp;
    }
    const origin = attempt_module.callbackOrigin(origin_value.?) catch {
        std.log.err("Next processing callback must be an HTTPS origin", .{});
        return error.InvalidOrigin;
    };
    if (auth.?.len < 32 or !printable(auth.?)) {
        std.log.err("invalid Next processing authentication configuration", .{});
        return error.InvalidAuth;
    }
    const port = std.fmt.parseInt(u16, env.get("PORT") orelse "8080", 10) catch 8080;
    const host = env.get("HOST") orelse "127.0.0.1";
    const address = try std.Io.net.IpAddress.parse(host, port);

    var client: std.http.Client = .{ .allocator = init.gpa, .io = io };
    defer client.deinit();
    var runner: Runner = .{
        .io = io,
        .gpa = init.gpa,
        .origin = origin,
        .auth = auth.?,
        .client = &client,
        .scratch = env.get("TMPDIR") orelse "/tmp",
    };
    var handler: Handler = .{ .runner = &runner };
    var server = try httpz.Server(*Handler).init(io, init.gpa, .{
        .address = .{ .ip = address },
        .workers = .{ .count = 1, .max_conn = 64 },
        .thread_pool = .{ .count = 4 },
        .request = .{ .max_body_size = attempt_module.max_body_bytes },
        .timeout = .{ .request = 10, .keepalive = 30 },
    }, &handler);
    defer server.deinit();
    std.log.info("next processing listening on {f}", .{address});
    try server.listen();
}

fn printable(value: []const u8) bool {
    for (value) |c| if (c <= ' ' or c >= 0x7f) return false;
    return true;
}

test {
    _ = attempt_module;
    _ = runner_module;
    _ = @import("transfer.zig");
    _ = @import("tests.zig");
}
