//! Serializes integration tests that intentionally rebuild one shared database.

const std = @import("std");

var mutex: std.Io.Mutex = .init;

pub fn lock(io: std.Io) void {
    mutex.lock(io) catch unreachable;
}

pub fn unlock(io: std.Io) void {
    mutex.unlock(io);
}
