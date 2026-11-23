//! The one execution slot and an attempt's lifecycle: claim the slot, hold
//! the lease with heartbeats while the transfer runs, and report a bounded
//! failure reason when it stops. Losing the lease or the two-hour deadline
//! cancels the transfer, which interrupts its blocked I/O and kills ffmpeg.

const std = @import("std");
const attempt_module = @import("attempt.zig");
const transfer = @import("transfer.zig");

const Io = std.Io;
const Attempt = attempt_module.Attempt;
const log = std.log.scoped(.processing);

pub const job_timeout: Io.Duration = .fromSeconds(2 * 60 * 60);
const callback_timeout: Io.Duration = .fromSeconds(15);

pub const Runner = struct {
    io: Io,
    gpa: std.mem.Allocator,
    /// `https://host`, no trailing slash (tests use plain http)
    origin: []const u8,
    /// the token the owner DO sends in `X-Processing-Key`
    auth: []const u8,
    client: *std.http.Client,
    /// directory the per-attempt scratch directories are made in
    scratch: []const u8,
    heartbeat_interval: Io.Duration = .fromSeconds(20),
    /// no source bytes for this long fails the download
    stall_timeout: Io.Duration = .fromSeconds(60),

    mutex: Io.Mutex = .init,
    active: ?Attempt = null,

    pub const Dispatch = enum(u16) {
        accepted = 202,
        bad_request = 400,
        unauthorized = 401,
        busy = 429,
        unavailable = 503,
    };

    /// Handles `POST /v1/processing`. A repeat of the active attempt is
    /// idempotent; any other attempt waits for the slot.
    pub fn start(r: *Runner, key: ?[]const u8, body: []const u8) Dispatch {
        const given = key orelse return .unauthorized;
        if (given.len != r.auth.len or !timingSafeEql(given, r.auth)) return .unauthorized;

        var arena = std.heap.ArenaAllocator.init(r.gpa);
        defer arena.deinit();
        const parsed = attempt_module.parse(arena.allocator(), body) orelse return .bad_request;

        r.mutex.lockUncancelable(r.io);
        defer r.mutex.unlock(r.io);
        if (r.active) |current| return if (current.eql(parsed)) .accepted else .busy;
        const owned = parsed.dupe(r.gpa) catch return .unavailable;
        r.active = owned;
        const thread = std.Thread.spawn(.{}, job, .{ r, owned }) catch {
            r.active = null;
            owned.free(r.gpa);
            return .unavailable;
        };
        thread.detach();
        return .accepted;
    }

    fn job(r: *Runner, attempt: Attempt) void {
        execute(r, attempt) catch log.warn("processing attempt stopped; owner reconciliation required upload_id={s} generation={d}", .{ attempt.uploadId, attempt.generation });
        r.mutex.lockUncancelable(r.io);
        defer r.mutex.unlock(r.io);
        r.active = null;
        attempt.free(r.gpa);
    }

    /// Blocks until no attempt holds the slot (tests and shutdown).
    pub fn waitIdle(r: *Runner) void {
        while (true) {
            {
                r.mutex.lockUncancelable(r.io);
                defer r.mutex.unlock(r.io);
                if (r.active == null) return;
            }
            r.io.sleep(.fromMilliseconds(5), .awake) catch {};
        }
    }

    /// POSTs or PUTs one callback for this attempt; anything but 2xx fails.
    /// Redirects are refused, never followed.
    pub fn callback(
        r: *Runner,
        attempt: Attempt,
        method: std.http.Method,
        action: []const u8,
        payload: []const u8,
        content_type: ?[]const u8,
        extra: []const std.http.Header,
    ) anyerror!void {
        var url_buffer: [1024]u8 = undefined;
        const target = try r.url(&url_buffer, attempt, action);
        var bearer_buffer: [4200]u8 = undefined;
        const bearer = try std.fmt.bufPrint(&bearer_buffer, "Bearer {s}", .{attempt.capability});
        const result = try r.client.fetch(.{
            .location = .{ .url = target },
            .method = method,
            .payload = payload,
            .keep_alive = false,
            .redirect_behavior = .unhandled,
            .headers = .{
                .authorization = .{ .override = bearer },
                .content_type = if (content_type) |value| .{ .override = value } else .omit,
                .accept_encoding = .omit,
            },
            .extra_headers = extra,
        });
        if (result.status.class() != .success) return error.CallbackRejected;
    }

    pub fn url(r: *Runner, buffer: []u8, attempt: Attempt, action: []const u8) ![]const u8 {
        var path_buffer: [256]u8 = undefined;
        const path = try attempt.path(&path_buffer, action);
        return std.fmt.bufPrint(buffer, "{s}{s}", .{ r.origin, path });
    }

    fn heartbeat(r: *Runner, attempt: Attempt) anyerror!void {
        try timed(r.io, callback_timeout, callback, .{ r, attempt, .POST, "heartbeat", "", null, &.{} });
    }
};

/// Runs an attempt to completion, deadline or lost lease, and tells the owner
/// why it failed: only `output_budget_exceeded` or `executor_failed`.
pub fn execute(r: *Runner, attempt: Attempt) anyerror!void {
    timed(r.io, job_timeout, run, .{ r, attempt }) catch |err| {
        const reason = if (err == error.OutputBudgetExceeded) "output_budget_exceeded" else "executor_failed";
        log.info("processing attempt failed upload_id={s} generation={d} error={s} reason={s}", .{ attempt.uploadId, attempt.generation, @errorName(err), reason });
        var body_buffer: [64]u8 = undefined;
        const body = try std.fmt.bufPrint(&body_buffer, "{{\"reason\":\"{s}\"}}", .{reason});
        timed(r.io, callback_timeout, Runner.callback, .{ r, attempt, .POST, "failed", body, "application/json", &.{} }) catch
            log.warn("processing failure acknowledgement unavailable upload_id={s} generation={d}", .{ attempt.uploadId, attempt.generation });
        return err;
    };
}

/// The first heartbeat proves the lease before any source byte is read; then
/// the transfer races the heartbeat monitor and whichever ends first wins.
pub fn run(r: *Runner, attempt: Attempt) anyerror!void {
    try r.heartbeat(attempt);
    const Race = union(enum) { work: anyerror!void, monitor: anyerror!void };
    var buffer: [2]Race = undefined;
    var race: Io.Select(Race) = .init(r.io, &buffer);
    defer race.cancelDiscard();
    try race.concurrent(.work, transfer.process, .{ r, attempt });
    try race.concurrent(.monitor, monitor, .{ r, attempt });
    return switch (try race.await()) {
        inline else => |result| result,
    };
}

fn monitor(r: *Runner, attempt: Attempt) anyerror!void {
    while (true) {
        try r.io.sleep(r.heartbeat_interval, .awake);
        r.heartbeat(attempt) catch |err| {
            log.warn("processing authority unavailable upload_id={s} generation={d} error={s}", .{ attempt.uploadId, attempt.generation, @errorName(err) });
            return error.LeaseLost;
        };
    }
}

/// Runs `function` with a deadline. On expiry the call is canceled, which
/// interrupts whatever I/O it is blocked in, and `error.Timeout` is returned.
pub fn timed(io: Io, timeout: Io.Duration, comptime function: anytype, args: std.meta.ArgsTuple(@TypeOf(function))) anyerror!void {
    const Race = union(enum) { done: anyerror!void, expired: Io.Cancelable!void };
    var buffer: [2]Race = undefined;
    var race: Io.Select(Race) = .init(io, &buffer);
    defer race.cancelDiscard();
    try race.concurrent(.done, function, args);
    try race.concurrent(.expired, Io.sleep, .{ io, timeout, .awake });
    return switch (try race.await()) {
        .done => |result| result,
        .expired => error.Timeout,
    };
}

fn timingSafeEql(a: []const u8, b: []const u8) bool {
    var difference: u8 = 0;
    for (a, b) |x, y| difference |= x ^ y;
    return difference == 0;
}
