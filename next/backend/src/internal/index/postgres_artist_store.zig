//! PostgreSQL adapter for the rebuildable public artist projection.
//!
//! A public artist exists here only when a verified profile record and
//! affirmative account evidence exist. The legacy artist row supplies a handle
//! alias and display-name compatibility, while local preferences remain
//! explicitly attributed; neither can admit an artist by itself.

const std = @import("std");
const pg = @import("pg");
const postgres_read = @import("postgres_read.zig");
const zat = @import("zat");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const artist = @import("../domain/artist.zig");
const artist_index = @import("artist_store.zig");
const ArtistStore = artist_index.ArtistStore;
const composed = @import("postgres_composed_track_store.zig");

pub const PostgresArtistStore = struct {
    pool: *pg.Pool,
    profile_collection: []const u8,

    pub fn store(self: *PostgresArtistStore) ArtistStore {
        return .{ .context = self, .get_fn = getOpaque, .resolve_fn = resolveOpaque };
    }

    fn resolveOpaque(context: *anyopaque, allocator: std.mem.Allocator, dids: []const []const u8, collection: []const u8) ArtistStore.Error![]const artist_index.Summary {
        const self: *PostgresArtistStore = @ptrCast(@alignCast(context));
        var result = postgres_read.query(self.pool, "artist.resolve_query", resolve_query, .{ collection, dids, self.profile_collection }) catch |err| {
            std.log.err("PostgreSQL artist batch lookup failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();
        var items: std.ArrayList(artist_index.Summary) = .empty;
        while (result.next() catch return error.IndexUnavailable) |row| {
            const count = row.get(i64, 4) catch return error.CorruptProjection;
            if (count <= 0) return error.CorruptProjection;
            const did = row.get([]const u8, 0) catch return error.CorruptProjection;
            const handle = row.get([]const u8, 1) catch return error.CorruptProjection;
            const avatar = row.get(?[]const u8, 3) catch return error.CorruptProjection;
            if (zat.Did.parse(did) == null or zat.Handle.parse(handle) == null) return error.CorruptProjection;
            if (avatar) |url| if (!lexicon_value.validUri(url)) return error.CorruptProjection;
            try items.append(allocator, .{
                .did = try duplicate(allocator, did),
                .handle = try duplicate(allocator, handle),
                .display_name = try duplicate(allocator, row.get([]const u8, 2) catch return error.CorruptProjection),
                .avatar_url = try duplicateOptional(allocator, avatar),
                .track_count = count,
            });
        }
        return items.toOwnedSlice(allocator);
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        identifier: artist_index.Identifier,
    ) ArtistStore.Error!?artist.Artist {
        const self: *PostgresArtistStore = @ptrCast(@alignCast(context));
        return self.get(allocator, identifier);
    }

    fn get(
        self: *PostgresArtistStore,
        allocator: std.mem.Allocator,
        identifier: artist_index.Identifier,
    ) ArtistStore.Error!?artist.Artist {
        var result = switch (identifier) {
            .did => |did| postgres_read.query(self.pool, "artist.detail_by_did_query", detail_by_did_query, .{ did, self.profile_collection }),
            .handle => |handle| postgres_read.query(self.pool, "artist.detail_by_handle_query", detail_by_handle_query, .{ handle, self.profile_collection }),
        } catch |err| {
            std.log.err("PostgreSQL artist lookup failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();

        const first = result.next() catch |err| {
            std.log.err("PostgreSQL artist result read failed: {}", .{err});
            return error.IndexUnavailable;
        } orelse return null;
        const value = decodeRow(allocator, &first) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                std.log.err("artist projection decode failed: {}", .{err});
                return error.CorruptProjection;
            },
        };

        // A handle is an alias for one DID. Treat an ambiguous legacy
        // projection as corruption rather than returning an arbitrary owner.
        if (result.next() catch |err| {
            std.log.err("PostgreSQL artist uniqueness check failed: {}", .{err});
            return error.IndexUnavailable;
        } != null) return error.CorruptProjection;

        return value;
    }

    fn decodeRow(allocator: std.mem.Allocator, row: anytype) !artist.Artist {
        const did = try duplicate(allocator, try row.get([]const u8, 0));
        if (zat.Did.parse(did) == null) return error.CorruptArtistDid;
        const handle = try duplicate(allocator, try row.get([]const u8, 1));
        if (zat.Handle.parse(handle) == null) return error.CorruptArtistHandle;

        const record_uri = try duplicate(allocator, try row.get([]const u8, 9));
        const parsed_uri = zat.AtUri.parse(record_uri) orelse return error.CorruptProfileUri;
        const collection = try duplicate(allocator, try row.get([]const u8, 12));
        const rkey = try duplicate(allocator, try row.get([]const u8, 13));
        if (!std.mem.eql(u8, parsed_uri.authority(), did) or
            !std.mem.eql(u8, parsed_uri.collection() orelse return error.CorruptProfileUri, collection) or
            !std.mem.eql(u8, parsed_uri.rkey() orelse return error.CorruptProfileUri, rkey) or
            !std.mem.eql(u8, rkey, "self")) return error.CorruptProfileUri;
        const record_cid = try duplicate(allocator, try row.get([]const u8, 10));
        const parsed_cid = zat.Cid.fromString(allocator, record_cid) catch
            return error.CorruptProfileCid;
        defer allocator.free(parsed_cid.raw);
        if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor) return error.CorruptProfileCid;
        const revision = try duplicate(allocator, try row.get([]const u8, 11));
        if (zat.Tid.parse(revision) == null) return error.CorruptProfileRevision;

        const bio = try duplicateOptional(allocator, try row.get(?[]const u8, 3));
        const avatar_url = try duplicateOptional(allocator, try row.get(?[]const u8, 4));
        if (avatar_url) |url| if (!lexicon_value.validUri(url)) return error.CorruptAvatar;
        const created_at = try duplicate(allocator, try row.get([]const u8, 7));
        if (!lexicon_value.validDatetime(created_at)) return error.CorruptCreatedAt;
        const updated_at = try duplicate(allocator, try row.get([]const u8, 8));
        if (!lexicon_value.validDatetime(updated_at)) return error.CorruptUpdatedAt;
        const availability_source = try parseClaimSource(try row.get([]const u8, 15));

        return .{
            .did = did,
            .handle = handle,
            .display_name = try duplicate(allocator, try row.get([]const u8, 2)),
            .bio = bio,
            .avatar_url = avatar_url,
            .show_liked_on_profile = try row.get(bool, 5),
            .support_url = try duplicateOptional(allocator, try row.get(?[]const u8, 6)),
            .created_at = created_at,
            .updated_at = updated_at,
            .record = .{
                .uri = record_uri,
                .cid = record_cid,
                .revision = revision,
                .collection = collection,
                .rkey = rkey,
            },
            .sources = .{
                .did = .verified_repo,
                .handle = .legacy_projection,
                .display_name = .legacy_local,
                .profile = .verified_repo,
                .avatar = if (try row.get(bool, 16)) .verified_repo else .legacy_projection,
                .public_preferences = .legacy_local,
                .account_availability = availability_source,
            },
            .projection = .{
                .indexed_at = try duplicate(allocator, try row.get([]const u8, 14)),
                .verification = .verified_repo,
            },
        };
    }
};

const select_fields =
    \\SELECT
    \\  a.did,
    \\  lower(a.handle),
    \\  a.display_name,
    \\  p.bio,
    \\  COALESCE(NULLIF(p.avatar, ''), a.avatar_url),
    \\  false,
    \\  NULL::text,
    \\  p.record_created_at,
    \\  COALESCE(p.record_updated_at, p.record_created_at),
    \\  p.record_uri,
    \\  p.record_cid,
    \\  p.commit_rev,
    \\  p.collection,
    \\  p.rkey,
    \\  to_char(
    \\    TIMESTAMPTZ 'epoch' + (p.indexed_at_us * INTERVAL '1 microsecond'),
    \\    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    \\  ),
    \\  aa.evidence_source,
    \\  p.avatar IS NOT NULL AND p.avatar <> ''
    \\FROM plyr_index.profile_records AS p
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = p.owner_did AND aa.available
    \\JOIN plyr_index.actor_identities AS a ON a.did = p.owner_did
;

const detail_by_did_query = select_fields ++ "\n" ++
    \\WHERE a.did = $1
    \\  AND p.collection = $2
    \\  AND p.rkey = 'self'
    \\  AND NOT p.deleted
    \\LIMIT 2
;

const detail_by_handle_query = select_fields ++ "\n" ++
    \\WHERE lower(a.handle) = $1
    \\  AND p.collection = $2
    \\  AND p.rkey = 'self'
    \\  AND NOT p.deleted
    \\LIMIT 2
;

fn parseClaimSource(value: []const u8) !artist.ClaimSource {
    if (std.mem.eql(u8, value, "verified_repository")) return .verified_repo;
    if (std.mem.eql(u8, value, "current_pds")) return .current_pds;
    return error.CorruptAvailabilitySource;
}

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

const resolve_query =
    \\SELECT identity.did, lower(identity.handle), identity.display_name,
    \\       COALESCE(NULLIF(profile.avatar, ''), identity.avatar_url), counts.track_count
    \\FROM unnest($2::text[]) WITH ORDINALITY AS requested(did, position)
    \\JOIN plyr_index.actor_identities AS identity ON identity.did = requested.did
    \\LEFT JOIN plyr_index.profile_records AS profile
    \\  ON profile.owner_did = identity.did AND profile.collection = $3
    \\  AND profile.rkey = 'self' AND NOT profile.deleted
    \\JOIN LATERAL (
    \\  SELECT count(*)::bigint AS track_count
++ "\n" ++ composed.page_from ++ "\nWHERE v.owner_did = requested.did AND v.record_created_at_us IS NOT NULL\n" ++ composed.discovery_policy ++ "\n" ++
    \\) AS counts ON counts.track_count > 0
    \\ORDER BY requested.position
;

test "artist resolution returns ordered visible music and current profile artwork" {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    const PostgresTrackStore = @import("postgres_track_store.zig").PostgresTrackStore;
    var postgres = try PostgresTrackStore.init(allocator, io, std.mem.span(url), 2);
    defer postgres.deinit();
    var database = (try postgres.pool.row("SELECT current_database()", .{})).?;
    const safe = std.mem.eql(u8, try database.get([]const u8, 0), "zig_test");
    try database.deinit();
    if (!safe) return error.UnsafeTestDatabase;
    _ = try postgres.pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    _ = try postgres.pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try postgres.pool.exec("CREATE TABLE plyr_index.actor_identities (did text PRIMARY KEY, handle text, display_name text, avatar_url text)", .{});
    _ = try postgres.pool.exec("CREATE TABLE plyr_index.profile_records (owner_did text, collection text, rkey text, deleted boolean, avatar text)", .{});
    _ = try postgres.pool.exec("CREATE TABLE plyr_index.account_availability (repo_did text PRIMARY KEY, available boolean, evidence_source text DEFAULT 'verified_repository')", .{});
    _ = try postgres.pool.exec("CREATE TABLE plyr_index.track_records (record_uri text PRIMARY KEY, owner_did text, collection text, deleted boolean DEFAULT false, record_created_at_us bigint DEFAULT 1, self_labels text[] DEFAULT '{}')", .{});
    _ = try postgres.pool.exec("CREATE TABLE plyr_index.track_policies (record_uri text PRIMARY KEY, visibility text, moderation_decision text, operator_labels jsonb DEFAULT '[]')", .{});
    const owners = [_][]const u8{ "did:plc:first", "did:plc:second", "did:plc:hidden", "did:plc:offline", "did:plc:empty" };
    for (owners) |did| {
        _ = try postgres.pool.exec("INSERT INTO plyr_index.actor_identities VALUES ($1, 'Artist.Example', 'Artist', 'https://example.com/fallback')", .{did});
        _ = try postgres.pool.exec("INSERT INTO plyr_index.account_availability(repo_did,available) VALUES ($1, $2)", .{ did, !std.mem.eql(u8, did, "did:plc:offline") });
    }
    _ = try postgres.pool.exec("INSERT INTO plyr_index.profile_records VALUES ('did:plc:second', 'fm.plyr.dev.actor.profile', 'self', false, 'https://example.com/profile')", .{});
    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_records(record_uri,owner_did,collection,self_labels) VALUES ('public','did:plc:first','fm.plyr.dev.track','{}'), ('supporters','did:plc:second','fm.plyr.dev.track','{}'), ('private','did:plc:hidden','fm.plyr.dev.track','{}'), ('excluded','did:plc:hidden','fm.plyr.dev.track','{}'), ('sexual','did:plc:hidden','fm.plyr.dev.track','{sexual}'), ('copyright','did:plc:hidden','fm.plyr.dev.track','{copyright-violation}'), ('offline','did:plc:offline','fm.plyr.dev.track','{}'), ('wrongcollection','did:plc:empty','fm.plyr.track','{}')", .{});
    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_policies(record_uri,visibility,moderation_decision) VALUES ('supporters','supporters',NULL), ('private','private',NULL), ('excluded','public','exclude')", .{});
    _ = try postgres.pool.exec("CREATE INDEX owner_page ON plyr_index.track_records(owner_did, collection, record_created_at_us DESC, record_uri DESC) WHERE NOT deleted AND record_created_at_us IS NOT NULL", .{});
    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_records(record_uri,owner_did,collection) SELECT 'noise-' || n, 'did:plc:noise', 'fm.plyr.dev.track' FROM generate_series(1, 10000) n", .{});
    _ = try postgres.pool.exec("ANALYZE plyr_index.track_records", .{});
    var plan = (try postgres.pool.row("EXPLAIN (ANALYZE, FORMAT JSON) " ++ resolve_query, .{ "fm.plyr.dev.track", &[_][]const u8{"did:plc:second"}, "fm.plyr.dev.actor.profile" })).?;
    const plan_json = try plan.get([]const u8, 0);
    try std.testing.expect(std.mem.indexOf(u8, plan_json, "owner_page") != null);
    try plan.deinit();
    var implementation: PostgresArtistStore = .{ .pool = postgres.pool, .profile_collection = "fm.plyr.dev.actor.profile" };
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const application = @import("../application/resolve_artists.zig");
    const result = application.execute(arena.allocator(), implementation.store(), "fm.plyr.dev.track", &.{ "did:plc:second", "did:plc:hidden", "did:plc:first", "did:plc:offline", "did:plc:empty", "did:plc:second" });
    const data = result.found.data;
    try std.testing.expectEqual(@as(usize, 2), data.len);
    try std.testing.expectEqualStrings("did:plc:second", data[0].did);
    try std.testing.expectEqualStrings("did:plc:first", data[1].did);
    try std.testing.expectEqualStrings("artist.example", data[0].handle);
    try std.testing.expectEqualStrings("https://example.com/profile", data[0].avatar_url.?);
    try std.testing.expectEqual(@as(i64, 1), data[0].track_count);
    _ = try postgres.pool.exec("UPDATE plyr_index.track_policies SET visibility='private' WHERE record_uri='supporters'", .{});
    const changed = application.execute(arena.allocator(), implementation.store(), "fm.plyr.dev.track", &.{"did:plc:second"});
    try std.testing.expectEqual(@as(usize, 0), changed.found.data.len);
    _ = try postgres.pool.exec("ALTER TABLE plyr_index.profile_records ADD COLUMN bio text, ADD COLUMN record_created_at text DEFAULT '2026-11-05T00:00:00Z', ADD COLUMN record_updated_at text, ADD COLUMN record_uri text, ADD COLUMN record_cid text DEFAULT 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ADD COLUMN commit_rev text DEFAULT '3jzfcijpj2z2a', ADD COLUMN indexed_at_us bigint DEFAULT 1", .{});
    _ = try postgres.pool.exec("UPDATE plyr_index.profile_records SET record_uri='at://' || owner_did || '/' || collection || '/' || rkey", .{});
    const authored = (try implementation.get(arena.allocator(), .{ .did = "did:plc:second" })).?;
    try std.testing.expectEqualStrings("https://example.com/profile", authored.avatar_url.?);
    try std.testing.expectEqual(artist.ClaimSource.verified_repo, authored.sources.avatar);
    _ = try postgres.pool.exec("UPDATE plyr_index.profile_records SET avatar=NULL", .{});
    const fallback = (try implementation.get(arena.allocator(), .{ .did = "did:plc:second" })).?;
    try std.testing.expect(fallback.avatar_url != null);
    try std.testing.expectEqualStrings("https://example.com/fallback", fallback.avatar_url.?);
    try std.testing.expectEqual(artist.ClaimSource.legacy_projection, fallback.sources.avatar);
    _ = try postgres.pool.exec("UPDATE plyr_index.profile_records SET avatar=''; UPDATE plyr_index.actor_identities SET avatar_url=NULL", .{});
    const absent = (try implementation.get(arena.allocator(), .{ .did = "did:plc:second" })).?;
    try std.testing.expectEqual(@as(?[]const u8, null), absent.avatar_url);
    _ = try postgres.pool.exec("UPDATE plyr_index.account_availability SET available=false WHERE repo_did='did:plc:second'", .{});
    try std.testing.expectEqual(@as(?artist.Artist, null), try implementation.get(arena.allocator(), .{ .did = "did:plc:second" }));
}
