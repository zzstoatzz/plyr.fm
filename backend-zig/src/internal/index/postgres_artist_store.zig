//! PostgreSQL adapter for the rebuildable public artist projection.
//!
//! A public artist exists here only when a verified profile record and
//! affirmative account evidence exist. The legacy artist row supplies a handle
//! alias and display-name compatibility, while local preferences remain
//! explicitly attributed; neither can admit an artist by itself.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const artist = @import("../domain/artist.zig");
const artist_index = @import("artist_store.zig");
const ArtistStore = artist_index.ArtistStore;

pub const PostgresArtistStore = struct {
    pool: *pg.Pool,
    profile_collection: []const u8,

    pub fn store(self: *PostgresArtistStore) ArtistStore {
        return .{ .context = self, .get_fn = getOpaque };
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
            .did => |did| self.pool.query(detail_by_did_query, .{ did, self.profile_collection }),
            .handle => |handle| self.pool.query(detail_by_handle_query, .{ handle, self.profile_collection }),
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
    \\  p.avatar,
    \\  COALESCE(prefs.show_liked_on_profile, false),
    \\  prefs.support_url,
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
    \\  aa.evidence_source
    \\FROM plyr_index.profile_records AS p
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = p.owner_did AND aa.available
    \\JOIN artists AS a ON a.did = p.owner_did
    \\LEFT JOIN user_preferences AS prefs ON prefs.did = a.did
;

const detail_by_did_query = select_fields ++ "\n" ++
    \\WHERE a.did = $1
    \\  AND a.deactivated = false
    \\  AND p.collection = $2
    \\  AND p.rkey = 'self'
    \\  AND NOT p.deleted
    \\LIMIT 2
;

const detail_by_handle_query = select_fields ++ "\n" ++
    \\WHERE lower(a.handle) = $1
    \\  AND a.deactivated = false
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
