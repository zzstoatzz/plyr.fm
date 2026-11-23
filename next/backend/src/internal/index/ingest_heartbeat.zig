//! The ingester's heartbeat: every few minutes, one `ingester.heartbeat`
//! span carrying where the index's writers stand (ingest_status_store).
//!
//! The ingester only logs when something fails, so silence used to mean
//! either "healthy and quiet" or "dead". The heartbeat tells them apart: a
//! Logfire alert fires when no heartbeat arrives, and the attributes show how
//! far behind the stream and the mirror are.

const std = @import("std");
const pg = @import("pg");
const logfire = @import("logfire");
const PostgresIngestStatusStore = @import("postgres_ingest_status_store.zig").PostgresIngestStatusStore;
const IngestStatusStore = @import("ingest_status_store.zig").IngestStatusStore;

const log = std.log.scoped(.ingest_heartbeat);

const interval_ms: i64 = 5 * 60 * 1000;

/// Runs the heartbeat on a detached thread beside the ingester.
pub fn spawnBeside(io: std.Io, pool: *pg.Pool) void {
    const thread = std.Thread.spawn(.{}, run, .{ io, pool }) catch |err| {
        log.err("ingester heartbeat disabled, thread spawn failed: {}", .{err});
        return;
    };
    thread.detach();
}

fn run(io: std.Io, pool: *pg.Pool) void {
    var source: PostgresIngestStatusStore = .{ .pool = pool };
    const store = source.store();
    while (true) {
        beat(io, store);
        io.sleep(std.Io.Duration.fromMilliseconds(interval_ms), .awake) catch return;
    }
}

fn beat(io: std.Io, store: IngestStatusStore) void {
    const span = logfire.span("ingester.heartbeat", .{});
    defer span.end();
    const status = store.get() catch |err| {
        span.recordError(err);
        return;
    };
    const now_us: i64 = @intCast(@divFloor(std.Io.Timestamp.now(io, .real).nanoseconds, std.time.ns_per_us));
    if (status.stream_cursor_us) |at| span.setAttribute("stream.lag_seconds", @divFloor(now_us - at, std.time.us_per_s));
    if (status.stream_checkpointed_at_us) |at| span.setAttribute("stream.checkpoint_age_seconds", @divFloor(now_us - at, std.time.us_per_s));
    if (status.label_synced_at_us) |at| span.setAttribute("labels.sync_age_seconds", @divFloor(now_us - at, std.time.us_per_s));
    span.setAttribute("mirror.pending", @as(i64, @intCast(status.mirror_pending)));
    span.setAttribute("mirror.retrying", @as(i64, @intCast(status.mirror_retrying)));
}
