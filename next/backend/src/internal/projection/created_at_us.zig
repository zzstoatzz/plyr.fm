//! Test fixture matching migrations/0028: the stored `record_created_at_us`
//! and the trigger that keeps it on every write.

const pg = @import("pg");

pub fn addTestColumn(pool: *pg.Pool, comptime table: []const u8) !void {
    _ = try pool.exec(
        \\CREATE OR REPLACE FUNCTION plyr_index.set_record_created_at_us() RETURNS trigger
        \\LANGUAGE plpgsql AS $$
        \\BEGIN
        \\    BEGIN
        \\        NEW.record_created_at_us :=
        \\            (extract(epoch FROM NEW.record_created_at::timestamptz) * 1000000)::bigint;
        \\    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
        \\        NEW.record_created_at_us := NULL;
        \\    END;
        \\    RETURN NEW;
        \\END
        \\$$
    , .{});
    _ = try pool.exec("ALTER TABLE plyr_index." ++ table ++ " ADD COLUMN record_created_at_us BIGINT", .{});
    _ = try pool.exec(
        "CREATE TRIGGER " ++ table ++ "_created_at_us BEFORE INSERT OR UPDATE OF record_created_at ON plyr_index." ++
            table ++ " FOR EACH ROW EXECUTE FUNCTION plyr_index.set_record_created_at_us()",
        .{},
    );
}
