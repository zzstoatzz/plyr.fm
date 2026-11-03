//! Atomic PostgreSQL persistence for malformed authenticated app records.

const std = @import("std");
const pg = @import("pg");
const rejection = @import("record_rejection.zig");

pub const PostgresRecordRejectionStore = struct {
    pool: *pg.Pool,

    pub fn replaceForCommit(
        _: *PostgresRecordRejectionStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        resolved_uris: []const []const u8,
        rejected: []const rejection.Rejection,
    ) Error!void {
        if (resolved_uris.len > 0) {
            _ = conn.exec(clear_touched_sql, .{resolved_uris}) catch |err| {
                std.log.err("record rejection resolution failed: {}", .{err});
                return error.ProjectionUnavailable;
            };
        }
        for (rejected) |item| try upsert(conn, allocator, item);
    }

    pub fn replaceForSnapshot(
        _: *PostgresRecordRejectionStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        owner_did: []const u8,
        collections: []const []const u8,
        rejected: []const rejection.Rejection,
    ) Error!void {
        const current = allocator.alloc([]const u8, rejected.len) catch return error.OutOfMemory;
        defer allocator.free(current);
        for (rejected, current) |item, *uri| uri.* = item.record_uri;
        _ = conn.exec(reconcile_snapshot_sql, .{ owner_did, collections, current }) catch |err| {
            std.log.err("snapshot rejection reconciliation failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        for (rejected) |item| try upsert(conn, allocator, item);
    }
};

pub const Error = error{
    InvalidRejection,
    RevisionConflict,
    ProjectionUnavailable,
    CorruptProjection,
    OutOfMemory,
};

pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.record_rejections (
        \\  record_uri text PRIMARY KEY,
        \\  record_cid text NOT NULL,
        \\  owner_did text NOT NULL,
        \\  collection text NOT NULL,
        \\  rkey text NOT NULL,
        \\  reason text NOT NULL,
        \\  detail text NOT NULL,
        \\  commit_cid text NOT NULL,
        \\  commit_rev text NOT NULL,
        \\  indexed_at_us bigint NOT NULL,
        \\  UNIQUE (owner_did, collection, rkey)
        \\)
    , .{});
}

fn upsert(
    conn: *pg.Conn,
    allocator: std.mem.Allocator,
    item: rejection.Rejection,
) Error!void {
    item.validate() catch return error.InvalidRejection;
    const commit_cid = item.proof.commit_cid.toString(allocator) catch
        return error.OutOfMemory;
    defer allocator.free(commit_cid);
    const record_cid = item.record_cid.toString(allocator) catch
        return error.OutOfMemory;
    defer allocator.free(record_cid);
    const affected = conn.exec(upsert_sql, .{
        item.record_uri,
        record_cid,
        item.owner_did,
        item.collection,
        item.rkey,
        @tagName(item.reason),
        item.detail,
        commit_cid,
        item.proof.commit_rev,
        item.proof.indexed_at_us,
    }) catch |err| {
        std.log.err("record rejection upsert failed: {}", .{err});
        return error.ProjectionUnavailable;
    };
    if (affected == 1) return;
    if (affected != 0) return error.CorruptProjection;
    var row = conn.row(classify_sql, .{item.record_uri}) catch |err| {
        std.log.err("record rejection replay classification failed: {}", .{err});
        return error.ProjectionUnavailable;
    } orelse return error.CorruptProjection;
    defer row.deinit() catch {};
    const current_rev = row.get([]const u8, 0) catch return error.CorruptProjection;
    const current_commit = row.get([]const u8, 1) catch return error.CorruptProjection;
    const current_record = row.get([]const u8, 2) catch return error.CorruptProjection;
    if (std.mem.order(u8, current_rev, item.proof.commit_rev) == .gt) return;
    if (!std.mem.eql(u8, current_rev, item.proof.commit_rev) or
        !std.mem.eql(u8, current_commit, commit_cid) or
        !std.mem.eql(u8, current_record, record_cid))
        return error.RevisionConflict;
}

const upsert_sql =
    \\INSERT INTO plyr_index.record_rejections (
    \\  record_uri, record_cid, owner_did, collection, rkey, reason, detail,
    \\  commit_cid, commit_rev, indexed_at_us
    \\) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  reason = EXCLUDED.reason,
    \\  detail = EXCLUDED.detail,
    \\  commit_cid = EXCLUDED.commit_cid,
    \\  commit_rev = EXCLUDED.commit_rev,
    \\  indexed_at_us = EXCLUDED.indexed_at_us
    \\WHERE plyr_index.record_rejections.commit_rev < EXCLUDED.commit_rev
;

const classify_sql =
    \\SELECT commit_rev, commit_cid, record_cid
    \\FROM plyr_index.record_rejections WHERE record_uri = $1
;

const clear_touched_sql =
    \\DELETE FROM plyr_index.record_rejections
    \\WHERE record_uri = ANY($1::text[])
;

const reconcile_snapshot_sql =
    \\DELETE FROM plyr_index.record_rejections
    \\WHERE owner_did = $1 AND collection = ANY($2::text[])
    \\  AND NOT (record_uri = ANY($3::text[]))
;
