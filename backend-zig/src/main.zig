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
        std.log.err("invalid configuration: {} (MODE must be api, ingester, or worker)", .{err});
        return err;
    };

    switch (settings.role) {
        .api => try server.run(io, settings.port),
        .ingester, .worker => {
            std.log.err("MODE={s} is scaffolded but not implemented", .{@tagName(settings.role)});
            return error.RoleNotImplemented;
        },
    }
}

test {
    _ = @import("config.zig");
    _ = @import("server.zig");
}
