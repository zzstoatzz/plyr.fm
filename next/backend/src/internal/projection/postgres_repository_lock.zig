const pg = @import("pg");

pub fn acquire(conn: *pg.Conn, did: []const u8) !void {
    var row = (try conn.row("SELECT pg_advisory_xact_lock(hashtextextended($1, 1881820018))", .{did})) orelse return error.CorruptProjection;
    try row.deinit();
}
