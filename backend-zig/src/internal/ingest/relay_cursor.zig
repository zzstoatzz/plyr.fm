//! Durable relay checkpoint with bounded, replay-safe write coalescing.

const std = @import("std");

pub const default_flush_interval_us: i64 = 4 * std.time.us_per_s;

pub const Store = struct {
    context: *anyopaque,
    load_fn: *const fn (*anyopaque, []const u8) Error!?i64,
    save_fn: *const fn (*anyopaque, []const u8, i64, i64) Error!void,

    pub fn load(self: Store, source: []const u8) Error!?i64 {
        if (!validSource(source)) return error.InvalidSource;
        const seq = try self.load_fn(self.context, source);
        if (seq) |value| if (value < 0) return error.CorruptCursor;
        return seq;
    }

    pub fn save(self: Store, source: []const u8, seq: i64, now_us: i64) Error!void {
        if (!validSource(source)) return error.InvalidSource;
        if (seq < 0 or now_us < 0) return error.InvalidCursor;
        try self.save_fn(self.context, source, seq, now_us);
    }
};

pub const Checkpoint = struct {
    store: Store,
    source: []const u8,
    accepted: ?i64,
    persisted: ?i64,
    pending: bool = false,
    last_flush_us: i64,
    flush_interval_us: i64 = default_flush_interval_us,

    pub fn init(
        store: Store,
        source: []const u8,
        now_us: i64,
    ) Error!Checkpoint {
        if (now_us < 0) return error.InvalidCursor;
        const loaded = try store.load(source);
        return .{
            .store = store,
            .source = source,
            .accepted = loaded,
            .persisted = loaded,
            .last_flush_us = now_us,
        };
    }

    /// Accept only completed work. A lower replay never regresses the cursor.
    /// Persistence may lag; after a crash that lag causes replay, never loss.
    pub fn accept(self: *Checkpoint, seq: i64, now_us: i64) Error!void {
        if (seq < 0 or now_us < 0) return error.InvalidCursor;
        if (self.accepted == null or seq > self.accepted.?) {
            self.accepted = seq;
            self.pending = self.persisted == null or seq > self.persisted.?;
        }
        if (self.pending and now_us - self.last_flush_us >= self.flush_interval_us)
            try self.flush(now_us);
    }

    pub fn flush(self: *Checkpoint, now_us: i64) Error!void {
        if (now_us < 0) return error.InvalidCursor;
        if (!self.pending) return;
        const seq = self.accepted orelse return;
        try self.store.save(self.source, seq, now_us);
        self.persisted = seq;
        self.pending = false;
        self.last_flush_us = now_us;
    }
};

pub const Error = error{
    InvalidSource,
    InvalidCursor,
    CorruptCursor,
    CursorUnavailable,
};

fn validSource(source: []const u8) bool {
    return source.len > 0 and source.len <= 255;
}

test "checkpoint coalesces writes without regressing on replay" {
    const Fake = struct {
        loaded: ?i64 = null,
        saved: ?i64 = null,
        saves: usize = 0,

        fn port(self: *@This()) Store {
            return .{ .context = self, .load_fn = load, .save_fn = save };
        }

        fn load(context: *anyopaque, _: []const u8) Error!?i64 {
            return (@as(*@This(), @ptrCast(@alignCast(context)))).loaded;
        }

        fn save(context: *anyopaque, _: []const u8, seq: i64, _: i64) Error!void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.saved = seq;
            self.saves += 1;
        }
    };
    var fake: Fake = .{ .loaded = 100 };
    var checkpoint = try Checkpoint.init(fake.port(), "bsky", 1_000);
    checkpoint.flush_interval_us = 100;
    try checkpoint.accept(90, 1_100);
    try std.testing.expectEqual(@as(usize, 0), fake.saves);
    try checkpoint.accept(101, 1_150);
    try std.testing.expectEqual(@as(?i64, 101), fake.saved);
    try checkpoint.accept(102, 1_160);
    try checkpoint.accept(103, 1_170);
    try std.testing.expectEqual(@as(usize, 1), fake.saves);
    try checkpoint.flush(1_171);
    try std.testing.expectEqual(@as(?i64, 103), fake.saved);
    try std.testing.expectEqual(@as(usize, 2), fake.saves);
}

test "checkpoint retains pending state after a failed write" {
    const Fake = struct {
        fail: bool = true,

        fn load(_: *anyopaque, _: []const u8) Error!?i64 {
            return null;
        }

        fn save(context: *anyopaque, _: []const u8, _: i64, _: i64) Error!void {
            if ((@as(*@This(), @ptrCast(@alignCast(context)))).fail)
                return error.CursorUnavailable;
        }
    };
    var fake: Fake = .{};
    const store: Store = .{ .context = &fake, .load_fn = Fake.load, .save_fn = Fake.save };
    var checkpoint = try Checkpoint.init(store, "relay", 0);
    checkpoint.flush_interval_us = 1;
    try std.testing.expectError(error.CursorUnavailable, checkpoint.accept(7, 1));
    try std.testing.expect(checkpoint.pending);
    fake.fail = false;
    try checkpoint.flush(2);
    try std.testing.expectEqual(@as(?i64, 7), checkpoint.persisted);
}

test "cursor validates source values and storage output" {
    const Fake = struct {
        fn load(_: *anyopaque, _: []const u8) Error!?i64 {
            return -1;
        }
        fn save(_: *anyopaque, _: []const u8, _: i64, _: i64) Error!void {}
    };
    var fake: u8 = 0;
    const store: Store = .{ .context = &fake, .load_fn = Fake.load, .save_fn = Fake.save };
    try std.testing.expectError(error.InvalidSource, store.load(""));
    try std.testing.expectError(error.CorruptCursor, store.load("relay"));
    try std.testing.expectError(error.InvalidCursor, store.save("relay", -1, 0));
}
