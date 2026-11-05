const std = @import("std");
const pg = @import("pg");
const PlayMetricStore = @import("play_metric_store.zig").PlayMetricStore;

pub const PostgresPlayMetricStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresPlayMetricStore) PlayMetricStore {
        return .{ .context = self, .record_fn = recordOpaque };
    }

    fn recordOpaque(context: *anyopaque, record_uri: []const u8, occurrence: []const u8, listener: []const u8) PlayMetricStore.Error!PlayMetricStore.Outcome {
        const self: *PostgresPlayMetricStore = @ptrCast(@alignCast(context));
        return self.record(record_uri, occurrence, listener);
    }

    fn record(self: *PostgresPlayMetricStore, record_uri: []const u8, occurrence: []const u8, listener: []const u8) PlayMetricStore.Error!PlayMetricStore.Outcome {
        const conn = self.pool.acquire() catch return error.MetricsUnavailable;
        defer self.pool.release(conn);
        var listener_hash: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(listener, &listener_hash, .{});
        _ = conn.exec("BEGIN READ WRITE", .{}) catch return error.MetricsUnavailable;
        var committed = false;
        defer if (!committed) {
            _ = conn.exec("ROLLBACK", .{}) catch {};
        };
        var row = conn.row(
            "SELECT status, total, counted, window_seconds FROM plyr_index.record_play($1::uuid, $2, $3::bytea)",
            .{ occurrence, record_uri, &listener_hash },
        ) catch |err| {
            if (conn.err) |pg_err| std.log.err("play transaction failed: {}: {s}", .{ err, pg_err.message });
            return error.MetricsUnavailable;
        } orelse return error.CorruptMetrics;
        var row_active = true;
        defer if (row_active) finishQueryRow(&row) catch {};
        const status = row.get([]const u8, 0) catch return error.CorruptMetrics;
        const outcome: PlayMetricStore.Outcome = if (std.mem.eql(u8, status, "not_found")) .not_found else if (std.mem.eql(u8, status, "conflict")) .conflict else blk: {
            const count = row.get(i64, 1) catch return error.CorruptMetrics;
            const counted = row.get(bool, 2) catch return error.CorruptMetrics;
            const window = row.get(i32, 3) catch return error.CorruptMetrics;
            if (count < 0 or window < 30 or window > 3600) return error.CorruptMetrics;
            const parsed_status = std.meta.stringToEnum(@FieldType(PlayMetricStore.Receipt, "status"), status) orelse return error.CorruptMetrics;
            break :blk .{ .recorded = .{ .play_count = count, .counted = counted, .status = parsed_status, .window_seconds = @intCast(window) } };
        };
        row_active = false;
        finishQueryRow(&row) catch return error.MetricsUnavailable;
        _ = conn.exec("COMMIT", .{}) catch return error.MetricsUnavailable;
        committed = true;
        return outcome;
    }
};

fn finishQueryRow(row: *pg.QueryRow) !void {
    row.deinit() catch |err| {
        row.result.deinit();
        return err;
    };
}
