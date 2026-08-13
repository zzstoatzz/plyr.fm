const std = @import("std");

/// Ephemeral admission for a listener/record/window tuple. A failure is not a
/// correctness failure: the application deliberately counts rather than
/// making Redis part of playback availability.
pub const PlayDedupStore = struct {
    context: *anyopaque,
    claim_fn: *const fn (*anyopaque, []const u8, []const u8, u32) Error!bool,

    pub const Error = error{
        DedupUnavailable,
        OutOfMemory,
    };

    pub fn claim(
        self: PlayDedupStore,
        listener_key: []const u8,
        record_uri: []const u8,
        ttl_seconds: u32,
    ) Error!bool {
        return self.claim_fn(self.context, listener_key, record_uri, ttl_seconds);
    }
};
