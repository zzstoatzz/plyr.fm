//! Where the index's writers stand, for /v1/health/ingest.

const std = @import("std");

/// Times are microseconds since the epoch; null when that writer has never
/// checkpointed.
pub const Status = struct {
    /// event time of the last applied stream event
    stream_cursor_us: ?i64,
    /// when the stream runner last wrote its checkpoint
    stream_checkpointed_at_us: ?i64,
    /// when the last complete catalog reconciliation finished
    reconciled_at_us: ?i64,
    /// highest label sequence applied, over every labeler
    label_seq: ?i64,
    label_synced_at_us: ?i64,
    /// track versions the mirror still has to copy, at most `backlog_cap`
    mirror_pending: u64,
    /// of those, the ones that failed at least once
    mirror_retrying: u64,
};

pub const backlog_cap: u64 = 10_000;

pub const IngestStatusStore = struct {
    context: *anyopaque,
    get_fn: *const fn (*anyopaque) Error!Status,

    pub const Error = error{ IndexUnavailable, CorruptProjection };

    pub fn get(self: IngestStatusStore) Error!Status {
        return self.get_fn(self.context);
    }
};

test {
    _ = std;
}
