const std = @import("std");
const config = @import("config.zig");
const server = @import("server.zig");

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

    switch (settings.role) {
        .api => try server.run(io, settings.port),
    }
}

test {
    _ = @import("api/response.zig");
    _ = @import("api/router.zig");
    _ = @import("config.zig");
    _ = @import("server.zig");
}
