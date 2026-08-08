const std = @import("std");
const config = @import("config.zig");
const server = @import("server.zig");
const postgres = @import("internal/index/postgres_track_store.zig");
const postgres_artists = @import("internal/index/postgres_artist_store.zig");
const postgres_albums = @import("internal/index/postgres_album_store.zig");

var threaded_io: std.Io.Threaded = undefined;
pub const std_options_debug_threaded_io: ?*std.Io.Threaded = &threaded_io;

pub fn main() !void {
    const allocator = std.heap.smp_allocator;
    threaded_io = std.Io.Threaded.init(allocator, .{});
    const io = threaded_io.io();

    const settings = config.Config.fromEnvironment() catch |err| {
        std.log.err("invalid configuration: {}", .{err});
        return err;
    };

    var postgres_store: ?postgres.PostgresTrackStore = if (settings.database_url) |url|
        try postgres.PostgresTrackStore.init(allocator, io, url)
    else
        null;
    defer if (postgres_store) |*store| store.deinit();

    const track_store = if (postgres_store) |*store| store.store() else null;
    var postgres_artist_store: ?postgres_artists.PostgresArtistStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const artist_store = if (postgres_artist_store) |*store| store.store() else null;
    var postgres_album_store: ?postgres_albums.PostgresAlbumStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const album_store = if (postgres_album_store) |*store| store.store() else null;
    switch (settings.role) {
        .api => try server.run(io, settings.port, settings.max_connections, .{
            .track_store = track_store,
            .artist_store = artist_store,
            .album_store = album_store,
            .track_collection = settings.track_collection,
            .list_collection = settings.list_collection,
            .cors = .{ .allowed_origins = settings.cors_allowed_origins },
        }),
    }
}

test {
    _ = @import("api/response.zig");
    _ = @import("api/router.zig");
    _ = @import("api/artists.zig");
    _ = @import("api/albums.zig");
    _ = @import("api/tracks.zig");
    _ = @import("config.zig");
    _ = @import("internal/application/get_artist.zig");
    _ = @import("internal/application/list_albums.zig");
    _ = @import("internal/application/get_track.zig");
    _ = @import("internal/application/list_tracks.zig");
    _ = @import("internal/domain/artist.zig");
    _ = @import("internal/domain/album.zig");
    _ = @import("internal/domain/album_list.zig");
    _ = @import("internal/index/artist_store.zig");
    _ = @import("internal/index/album_store.zig");
    _ = @import("internal/index/postgres_album_store.zig");
    _ = @import("internal/index/postgres_artist_store.zig");
    _ = @import("internal/identity/track_id.zig");
    _ = @import("internal/identity/track_cursor.zig");
    _ = @import("internal/identity/record_id.zig");
    _ = @import("internal/identity/record_cursor.zig");
    _ = @import("internal/identity/album_id.zig");
    _ = @import("internal/http/query.zig");
    _ = @import("internal/index/postgres_track_store.zig");
    _ = @import("server.zig");
}
