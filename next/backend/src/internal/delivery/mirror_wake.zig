//! Lets the ingester tell the blob mirror, running beside it in the same
//! process, that a track version was just verified, so a fresh upload is
//! copied right away instead of after the mirror's idle sleep.
const std = @import("std");

var pending = std.atomic.Value(bool).init(false);

pub fn signal() void {
    pending.store(true, .release);
}

/// True once per signal.
pub fn take() bool {
    return pending.swap(false, .acq_rel);
}

test "a signal is taken once" {
    try std.testing.expect(!take());
    signal();
    signal();
    try std.testing.expect(take());
    try std.testing.expect(!take());
}
