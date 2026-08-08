const std = @import("std");
const config = @import("config.zig");
const server = @import("server.zig");
const postgres = @import("internal/index/postgres_track_store.zig");

var threaded_io: std.Io.Threaded = undefined;
pub const std_options_debug_threaded_io: ?*std.Io.Threaded = &threaded_io;

pub fn main() !void {
    const allocator = std.heap.smp_allocator;
    threaded_io = std.Io.Threaded.init(allocator, .{});
    const io = threaded_io.io();

    const settings = config.Config.fromEnvironment() catch |err| {
        std.log.err("invalid configuration: {} (MODE must be api)", .{err});
        return err;
    };

    var postgres_store: ?postgres.PostgresTrackStore = if (settings.database_url) |url|
        try postgres.PostgresTrackStore.init(allocator, io, url)
    else
        null;
    defer if (postgres_store) |*store| store.deinit();

    const track_store = if (postgres_store) |*store| store.store() else null;
    switch (settings.role) {
        .api => try server.run(io, settings.port, .{
            .track_store = track_store,
            .track_collection = settings.track_collection,
            .cors = .{ .allowed_origins = settings.cors_allowed_origins },
        }),
    }
}

test {
    _ = @import("api/response.zig");
    _ = @import("api/router.zig");
    _ = @import("api/tracks.zig");
    _ = @import("config.zig");
    _ = @import("internal/application/get_track.zig");
    _ = @import("internal/content/cid.zig");
    _ = @import("internal/identity/track_id.zig");
    _ = @import("internal/index/postgres_track_store.zig");
    _ = @import("server.zig");
}
