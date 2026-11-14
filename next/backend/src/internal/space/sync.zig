//! Keeping plyr's copy of a space's records current. The engine that talks to
//! hosts (credential, listWriters, listRepoOps/getRepo, LtHash checks) sits
//! behind `Source`; what plyr keeps sits behind `Store`. `Syncer` only decides
//! what to fetch and what to drop, so either side can be swapped.

const std = @import("std");

/// One repo the space host says has written to the space.
pub const Writer = struct {
    repo: []const u8,
    /// absent when the host reports the repo removed from the space
    repo_rev: ?[]const u8,
};

pub const Op = union(enum) {
    put: struct { collection: []const u8, rkey: []const u8, cid: []const u8, value_json: []const u8 },
    delete: struct { collection: []const u8, rkey: []const u8 },
};

/// Ops from a `since` rev up to `rev`, already verified against the repo's commit.
pub const Ops = struct { rev: []const u8, ops: []const Op };

/// A repo's full verified state at `rev`, for when the op log can't bridge.
pub const Snapshot = struct {
    rev: []const u8,
    records: []const Record,

    pub const Record = struct { collection: []const u8, rkey: []const u8, cid: []const u8, value_json: []const u8 };
};

pub const SourceError = error{
    /// the only signal that the space is gone and its copy should be dropped
    SpaceDeleted,
    /// `since` is older than the host's op log; fetch a snapshot
    SinceUnavailable,
    /// the space refused plyr; keep the copy, try again later
    Unauthorized,
    Unavailable,
    Unverified,
    OutOfMemory,
};

/// The host-facing sync engine. Implementations verify before returning.
pub const Source = struct {
    context: *anyopaque,
    writers_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) SourceError![]const Writer,
    ops_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8, []const u8, ?[]const u8) SourceError!Ops,
    snapshot_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8, []const u8) SourceError!Snapshot,

    /// every writer of `space`, complete (implementations page internally)
    pub fn writers(self: Source, a: std.mem.Allocator, space: []const u8) SourceError![]const Writer {
        return self.writers_fn(self.context, a, space);
    }
    /// `repo`'s ops in `space` after `since` (null: from the start)
    pub fn ops(self: Source, a: std.mem.Allocator, space: []const u8, repo: []const u8, since: ?[]const u8) SourceError!Ops {
        return self.ops_fn(self.context, a, space, repo, since);
    }
    pub fn snapshot(self: Source, a: std.mem.Allocator, space: []const u8, repo: []const u8) SourceError!Snapshot {
        return self.snapshot_fn(self.context, a, space, repo);
    }
};

/// plyr's copy. Each call is one transaction: a rev only moves with its records.
pub const Store = struct {
    context: *anyopaque,
    rev_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8, []const u8) anyerror!?[]const u8,
    apply_fn: *const fn (*anyopaque, []const u8, []const u8, Ops) anyerror!void,
    replace_fn: *const fn (*anyopaque, []const u8, []const u8, Snapshot) anyerror!void,
    drop_repo_fn: *const fn (*anyopaque, []const u8, []const u8) anyerror!void,
    drop_space_fn: *const fn (*anyopaque, []const u8) anyerror!void,
    repos_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) anyerror![]const []const u8,

    pub fn rev(self: Store, a: std.mem.Allocator, space: []const u8, repo: []const u8) !?[]const u8 {
        return self.rev_fn(self.context, a, space, repo);
    }
    pub fn apply(self: Store, space: []const u8, repo: []const u8, ops: Ops) !void {
        return self.apply_fn(self.context, space, repo, ops);
    }
    pub fn replace(self: Store, space: []const u8, repo: []const u8, snapshot: Snapshot) !void {
        return self.replace_fn(self.context, space, repo, snapshot);
    }
    pub fn dropRepo(self: Store, space: []const u8, repo: []const u8) !void {
        return self.drop_repo_fn(self.context, space, repo);
    }
    pub fn dropSpace(self: Store, space: []const u8) !void {
        return self.drop_space_fn(self.context, space);
    }
    /// repos plyr holds a copy of in `space`
    pub fn repos(self: Store, a: std.mem.Allocator, space: []const u8) ![]const []const u8 {
        return self.repos_fn(self.context, a, space);
    }
};

pub const Outcome = enum { current, synced, dropped, unavailable };

pub const Syncer = struct {
    source: Source,
    store: Store,

    /// Bring `space` current. Called on a schedule, after a notification, or
    /// after a `spaceRev` gap; it reconciles the full writer set each time.
    pub fn sync(self: Syncer, a: std.mem.Allocator, space: []const u8) !Outcome {
        const writers = self.source.writers(a, space) catch |err| return self.failed(space, err);
        var changed = false;
        for (writers) |writer| {
            const held = try self.store.rev(a, space, writer.repo);
            const target = writer.repo_rev orelse {
                if (held != null) {
                    try self.store.dropRepo(space, writer.repo);
                    changed = true;
                }
                continue;
            };
            if (held) |h| if (std.mem.eql(u8, h, target)) continue;
            if (self.source.ops(a, space, writer.repo, held)) |ops| {
                try self.store.apply(space, writer.repo, ops);
            } else |err| switch (err) {
                error.SinceUnavailable => try self.store.replace(space, writer.repo, self.source.snapshot(a, space, writer.repo) catch |e| return self.failed(space, e)),
                else => return self.failed(space, err),
            }
            changed = true;
        }
        // a repo the host no longer lists at all left the space too
        for (try self.store.repos(a, space)) |repo| {
            const listed = for (writers) |writer| {
                if (std.mem.eql(u8, writer.repo, repo)) break true;
            } else false;
            if (!listed) {
                try self.store.dropRepo(space, repo);
                changed = true;
            }
        }
        return if (changed) .synced else .current;
    }

    fn failed(self: Syncer, space: []const u8, err: SourceError) !Outcome {
        return switch (err) {
            error.SpaceDeleted => {
                try self.store.dropSpace(space);
                return .dropped;
            },
            error.OutOfMemory => error.OutOfMemory,
            // keep what we have: a stale copy hides new records, it never shows revoked ones,
            // because reads still pass through the access Decider
            error.Unauthorized, error.Unavailable, error.Unverified, error.SinceUnavailable => .unavailable,
        };
    }
};

// --- tests -----------------------------------------------------------------

const Fake = struct {
    writers: []const Writer = &.{},
    log_from: ?[]const u8 = null,
    deleted: bool = false,
    unavailable: bool = false,
    snapshots: usize = 0,
    held: std.StringHashMapUnmanaged([]const u8) = .empty,
    records: std.StringHashMapUnmanaged(void) = .empty,
    dropped_space: bool = false,
    gpa: std.mem.Allocator,

    fn source(self: *Fake) Source {
        return .{ .context = self, .writers_fn = writersFn, .ops_fn = opsFn, .snapshot_fn = snapshotFn };
    }
    fn store(self: *Fake) Store {
        return .{ .context = self, .rev_fn = revFn, .apply_fn = applyFn, .replace_fn = replaceFn, .drop_repo_fn = dropRepoFn, .drop_space_fn = dropSpaceFn, .repos_fn = reposFn };
    }
    fn of(c: *anyopaque) *Fake {
        return @ptrCast(@alignCast(c));
    }
    fn writersFn(c: *anyopaque, _: std.mem.Allocator, _: []const u8) SourceError![]const Writer {
        const self = of(c);
        if (self.deleted) return error.SpaceDeleted;
        if (self.unavailable) return error.Unavailable;
        return self.writers;
    }
    fn opsFn(c: *anyopaque, _: std.mem.Allocator, _: []const u8, repo: []const u8, since: ?[]const u8) SourceError!Ops {
        const self = of(c);
        if (self.log_from) |floor| if (since == null or !std.mem.eql(u8, since.?, floor)) return error.SinceUnavailable;
        const rev = for (self.writers) |w| {
            if (std.mem.eql(u8, w.repo, repo)) break w.repo_rev.?;
        } else unreachable;
        const ops = [_]Op{.{ .put = .{ .collection = "fm.plyr.track", .rkey = "3new", .cid = "c", .value_json = "{}" } }};
        return .{ .rev = rev, .ops = self.gpa.dupe(Op, &ops) catch return error.OutOfMemory };
    }
    fn snapshotFn(c: *anyopaque, _: std.mem.Allocator, _: []const u8, repo: []const u8) SourceError!Snapshot {
        const self = of(c);
        self.snapshots += 1;
        const rev = for (self.writers) |w| {
            if (std.mem.eql(u8, w.repo, repo)) break w.repo_rev.?;
        } else unreachable;
        return .{ .rev = rev, .records = &.{} };
    }
    fn revFn(c: *anyopaque, _: std.mem.Allocator, _: []const u8, repo: []const u8) anyerror!?[]const u8 {
        return of(c).held.get(repo);
    }
    fn applyFn(c: *anyopaque, _: []const u8, repo: []const u8, ops: Ops) anyerror!void {
        const self = of(c);
        self.gpa.free(ops.ops);
        try self.held.put(self.gpa, repo, ops.rev);
        try self.records.put(self.gpa, repo, {});
    }
    fn replaceFn(c: *anyopaque, _: []const u8, repo: []const u8, snapshot: Snapshot) anyerror!void {
        const self = of(c);
        try self.held.put(self.gpa, repo, snapshot.rev);
    }
    fn dropRepoFn(c: *anyopaque, _: []const u8, repo: []const u8) anyerror!void {
        const self = of(c);
        _ = self.held.remove(repo);
        _ = self.records.remove(repo);
    }
    fn dropSpaceFn(c: *anyopaque, _: []const u8) anyerror!void {
        const self = of(c);
        self.held.clearRetainingCapacity();
        self.dropped_space = true;
    }
    fn reposFn(c: *anyopaque, a: std.mem.Allocator, _: []const u8) anyerror![]const []const u8 {
        const self = of(c);
        var out: std.ArrayList([]const u8) = .empty;
        var it = self.held.keyIterator();
        while (it.next()) |key| try out.append(a, key.*);
        return out.items;
    }
    fn deinit(self: *Fake) void {
        self.held.deinit(self.gpa);
        self.records.deinit(self.gpa);
    }
};

const space_uri = "at://did:plc:artist/space/fm.plyr.stg.audio/3album";

test "writers are synced from their held rev and left alone once current" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var fake: Fake = .{ .gpa = std.testing.allocator, .writers = &.{.{ .repo = "did:plc:artist", .repo_rev = "r2" }} };
    defer fake.deinit();
    const syncer: Syncer = .{ .source = fake.source(), .store = fake.store() };
    try std.testing.expectEqual(Outcome.synced, try syncer.sync(arena.allocator(), space_uri));
    try std.testing.expectEqualStrings("r2", fake.held.get("did:plc:artist").?);
    try std.testing.expectEqual(Outcome.current, try syncer.sync(arena.allocator(), space_uri));
}

test "a truncated op log falls back to a snapshot" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var fake: Fake = .{ .gpa = std.testing.allocator, .writers = &.{.{ .repo = "did:plc:artist", .repo_rev = "r9" }}, .log_from = "r5" };
    defer fake.deinit();
    try fake.held.put(fake.gpa, "did:plc:artist", "r1");
    const syncer: Syncer = .{ .source = fake.source(), .store = fake.store() };
    try std.testing.expectEqual(Outcome.synced, try syncer.sync(arena.allocator(), space_uri));
    try std.testing.expectEqual(@as(usize, 1), fake.snapshots);
    try std.testing.expectEqualStrings("r9", fake.held.get("did:plc:artist").?);
}

test "removed and unlisted repos are dropped; a deleted space drops everything" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var fake: Fake = .{ .gpa = std.testing.allocator, .writers = &.{.{ .repo = "did:plc:gone", .repo_rev = null }} };
    defer fake.deinit();
    try fake.held.put(fake.gpa, "did:plc:gone", "r1");
    try fake.held.put(fake.gpa, "did:plc:unlisted", "r1");
    const syncer: Syncer = .{ .source = fake.source(), .store = fake.store() };
    try std.testing.expectEqual(Outcome.synced, try syncer.sync(arena.allocator(), space_uri));
    try std.testing.expectEqual(@as(usize, 0), fake.held.count());
    try fake.held.put(fake.gpa, "did:plc:artist", "r1");
    fake.deleted = true;
    try std.testing.expectEqual(Outcome.dropped, try syncer.sync(arena.allocator(), space_uri));
    try std.testing.expect(fake.dropped_space);
    try std.testing.expectEqual(@as(usize, 0), fake.held.count());
}

test "an unavailable host keeps the copy" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var fake: Fake = .{ .gpa = std.testing.allocator, .unavailable = true };
    defer fake.deinit();
    try fake.held.put(fake.gpa, "did:plc:artist", "r1");
    const syncer: Syncer = .{ .source = fake.source(), .store = fake.store() };
    try std.testing.expectEqual(Outcome.unavailable, try syncer.sync(arena.allocator(), space_uri));
    try std.testing.expectEqual(@as(usize, 1), fake.held.count());
}
