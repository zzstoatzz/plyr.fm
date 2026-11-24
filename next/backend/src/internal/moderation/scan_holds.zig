//! Scan holds (`plyr_moderation.scan_holds`, migration 0065): tracks the
//! Osprey worker hasn't fingerprinted yet because their account, or everyone
//! together, is out of the day's scan budget. The worker writes them; this
//! backend only reads them, to keep held tracks out of discovery (feeds,
//! search, radio, charts) while they still play from the artist's page and
//! their own link.

const pg = @import("pg");

/// A discovery filter on the track aliased `v`.
pub const not_held =
    \\  AND NOT EXISTS (SELECT 1 FROM plyr_moderation.scan_holds AS hold WHERE hold.record_uri = v.record_uri)
;

/// Migration 0065 on an empty table, for tests whose queries read it.
pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec("CREATE SCHEMA IF NOT EXISTS plyr_moderation", .{});
    _ = try pool.exec(@embedFile("migration_0065_scan_holds"), .{});
    _ = try pool.exec("DELETE FROM plyr_moderation.scan_holds", .{});
}
