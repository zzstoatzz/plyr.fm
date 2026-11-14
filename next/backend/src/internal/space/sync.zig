//! Keeping plyr's copy of a space's records current from a space-stream
//! (next/services/space-stream). The stream does the host work (credential,
//! listWriters, listRepoOps with its commit MAC) and emits each verified op
//! in order with a `time_us` cursor; `Projector` turns one event into one
//! `Store` transaction that also moves the cursor, so a replay from the
//! stored cursor rebuilds the copy.

const std = @import("std");

pub const Op = union(enum) {
    put: struct { collection: []const u8, rkey: []const u8, cid: []const u8, value_json: []const u8 },
    delete: struct { collection: []const u8, rkey: []const u8 },
};

pub const Event = struct {
    /// the stream's cursor for this event
    time_us: u64,
    body: Body,

    pub const Body = union(enum) {
        commit: struct { repo: []const u8, rev: []const u8, op: Op },
        /// a write the stream saw but sent without its record value
        incomplete: struct { repo: []const u8, collection: []const u8, rkey: []const u8 },
        writer_removed: []const u8,
        space_deleted,
    };
};

/// plyr's copy. Each call is one transaction and leaves `cursor` at the
/// given value, so a cursor only moves with its records.
pub const Store = struct {
    context: *anyopaque,
    cursor_fn: *const fn (*anyopaque, []const u8) anyerror!?u64,
    apply_fn: *const fn (*anyopaque, []const u8, u64, []const u8, []const u8, Op) anyerror!void,
    drop_repo_fn: *const fn (*anyopaque, []const u8, u64, []const u8) anyerror!void,
    drop_space_fn: *const fn (*anyopaque, []const u8) anyerror!void,
    advance_fn: *const fn (*anyopaque, []const u8, u64) anyerror!void,

    /// where to resume `space` (null: from the start)
    pub fn cursor(self: Store, space: []const u8) !?u64 {
        return self.cursor_fn(self.context, space);
    }
    pub fn apply(self: Store, space: []const u8, at: u64, repo: []const u8, rev: []const u8, op: Op) !void {
        return self.apply_fn(self.context, space, at, repo, rev, op);
    }
    pub fn dropRepo(self: Store, space: []const u8, at: u64, repo: []const u8) !void {
        return self.drop_repo_fn(self.context, space, at, repo);
    }
    /// forgets the space and its cursor
    pub fn dropSpace(self: Store, space: []const u8) !void {
        return self.drop_space_fn(self.context, space);
    }
    /// moves the cursor past an event that changes no records
    pub fn advance(self: Store, space: []const u8, at: u64) !void {
        return self.advance_fn(self.context, space, at);
    }
};

pub const Outcome = enum { applied, dropped, skipped };

pub const Projector = struct {
    store: Store,

    /// Apply one event of `space`. Events arrive in cursor order; anything at
    /// or before the stored cursor was already applied.
    pub fn handle(self: Projector, space: []const u8, held: ?u64, event: Event) !Outcome {
        if (held) |cursor| if (event.time_us <= cursor) return .skipped;
        switch (event.body) {
            .commit => |commit| try self.store.apply(space, event.time_us, commit.repo, commit.rev, commit.op),
            .writer_removed => |repo| try self.store.dropRepo(space, event.time_us, repo),
            .space_deleted => {
                try self.store.dropSpace(space);
                return .dropped;
            },
            .incomplete => |write| {
                // reads of the copy still pass the access Decider, so a missing record only hides
                std.log.warn("space write without a record: {s} {s}/{s}/{s}", .{ space, write.repo, write.collection, write.rkey });
                try self.store.advance(space, event.time_us);
                return .skipped;
            },
        }
        return .applied;
    }
};

/// One space-stream event (src/wire.ts `StreamEvent`); null for kinds plyr
/// does not project (`authorized`, `sync_error`) or a different space.
pub fn parseEvent(a: std.mem.Allocator, space: []const u8, text: []const u8) !?Event {
    const value = std.json.parseFromSliceLeaky(std.json.Value, a, text, .{}) catch return error.InvalidEvent;
    const object = switch (value) {
        .object => |o| o,
        else => return error.InvalidEvent,
    };
    const kind = string(object, "kind") orelse return error.InvalidEvent;
    const known = std.meta.stringToEnum(enum { commit, writer, space_deleted }, kind) orelse return null;
    if (!std.mem.eql(u8, string(object, "space") orelse return error.InvalidEvent, space)) return null;
    const time_us: u64 = switch (object.get("time_us") orelse return error.InvalidEvent) {
        .integer => |n| std.math.cast(u64, n) orelse return error.InvalidEvent,
        else => return error.InvalidEvent,
    };
    const repo = string(object, "did") orelse return error.InvalidEvent;
    const body: Event.Body = switch (known) {
        .space_deleted => .space_deleted,
        .writer => blk: {
            const writer = switch (object.get("writer") orelse return error.InvalidEvent) {
                .object => |o| o,
                else => return error.InvalidEvent,
            };
            if (!std.mem.eql(u8, string(writer, "status") orelse "", "removed")) return null;
            break :blk .{ .writer_removed = repo };
        },
        .commit => blk: {
            const commit = switch (object.get("commit") orelse return error.InvalidEvent) {
                .object => |o| o,
                else => return error.InvalidEvent,
            };
            const rev = string(commit, "rev") orelse return error.InvalidEvent;
            const collection = string(commit, "collection") orelse return error.InvalidEvent;
            const rkey = string(commit, "rkey") orelse return error.InvalidEvent;
            const operation = string(commit, "operation") orelse return error.InvalidEvent;
            if (std.mem.eql(u8, operation, "delete")) break :blk .{ .commit = .{ .repo = repo, .rev = rev, .op = .{ .delete = .{ .collection = collection, .rkey = rkey } } } };
            if (!std.mem.eql(u8, operation, "create") and !std.mem.eql(u8, operation, "update")) return error.InvalidEvent;
            const cid = string(commit, "cid") orelse return error.InvalidEvent;
            const record = commit.get("record") orelse break :blk .{ .incomplete = .{ .repo = repo, .collection = collection, .rkey = rkey } };
            if (record != .object) return error.InvalidEvent;
            const value_json = try std.json.Stringify.valueAlloc(a, record, .{});
            break :blk .{ .commit = .{ .repo = repo, .rev = rev, .op = .{ .put = .{ .collection = collection, .rkey = rkey, .cid = cid, .value_json = value_json } } } };
        },
    };
    return .{ .time_us = time_us, .body = body };
}

fn string(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    return switch (object.get(key) orelse return null) {
        .string => |s| s,
        else => null,
    };
}

// --- tests -----------------------------------------------------------------

const Fake = struct {
    gpa: std.mem.Allocator,
    cursor: ?u64 = null,
    records: std.StringHashMapUnmanaged(void) = .empty,
    dropped_space: bool = false,

    fn store(self: *Fake) Store {
        return .{ .context = self, .cursor_fn = cursorFn, .apply_fn = applyFn, .drop_repo_fn = dropRepoFn, .drop_space_fn = dropSpaceFn, .advance_fn = advanceFn };
    }
    fn of(c: *anyopaque) *Fake {
        return @ptrCast(@alignCast(c));
    }
    fn cursorFn(c: *anyopaque, _: []const u8) anyerror!?u64 {
        return of(c).cursor;
    }
    fn applyFn(c: *anyopaque, _: []const u8, at: u64, repo: []const u8, _: []const u8, op: Op) anyerror!void {
        const self = of(c);
        switch (op) {
            .put => try self.records.put(self.gpa, repo, {}),
            .delete => _ = self.records.remove(repo),
        }
        self.cursor = at;
    }
    fn dropRepoFn(c: *anyopaque, _: []const u8, at: u64, repo: []const u8) anyerror!void {
        const self = of(c);
        _ = self.records.remove(repo);
        self.cursor = at;
    }
    fn dropSpaceFn(c: *anyopaque, _: []const u8) anyerror!void {
        const self = of(c);
        self.records.clearRetainingCapacity();
        self.cursor = null;
        self.dropped_space = true;
    }
    fn advanceFn(c: *anyopaque, _: []const u8, at: u64) anyerror!void {
        of(c).cursor = at;
    }
};

const space_uri = "at://did:plc:artist/space/fm.plyr.next.audio/3album";

fn feed(projector: Projector, fake: *Fake, a: std.mem.Allocator, line: []const u8) !Outcome {
    const event = (try parseEvent(a, space_uri, line)) orelse return .skipped;
    return projector.handle(space_uri, fake.cursor, event);
}

test "commits move records and the cursor together; a replay is skipped" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: Fake = .{ .gpa = std.testing.allocator };
    defer fake.records.deinit(fake.gpa);
    const projector: Projector = .{ .store = fake.store() };
    const put =
        \\{"did":"did:plc:artist","time_us":10,"kind":"commit","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album",
        \\ "commit":{"rev":"r1","operation":"create","collection":"fm.plyr.track","rkey":"3song","cid":"bafy","record":{"title":"song"}}}
    ;
    try std.testing.expectEqual(Outcome.applied, try feed(projector, &fake, a, put));
    try std.testing.expectEqual(@as(?u64, 10), fake.cursor);
    try std.testing.expect(fake.records.contains("did:plc:artist"));
    try std.testing.expectEqual(Outcome.skipped, try feed(projector, &fake, a, put));
    const delete =
        \\{"did":"did:plc:artist","time_us":11,"kind":"commit","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album",
        \\ "commit":{"rev":"r2","operation":"delete","collection":"fm.plyr.track","rkey":"3song"}}
    ;
    try std.testing.expectEqual(Outcome.applied, try feed(projector, &fake, a, delete));
    try std.testing.expect(!fake.records.contains("did:plc:artist"));
}

test "removed writers and deleted spaces drop the copy" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: Fake = .{ .gpa = std.testing.allocator };
    defer fake.records.deinit(fake.gpa);
    try fake.records.put(fake.gpa, "did:plc:fan", {});
    try fake.records.put(fake.gpa, "did:plc:artist", {});
    const projector: Projector = .{ .store = fake.store() };
    try std.testing.expectEqual(Outcome.applied, try feed(projector, &fake, a,
        \\{"did":"did:plc:fan","time_us":5,"kind":"writer","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album","writer":{"status":"removed"}}
    ));
    try std.testing.expect(!fake.records.contains("did:plc:fan"));
    try std.testing.expectEqual(Outcome.dropped, try feed(projector, &fake, a,
        \\{"did":"did:plc:artist","time_us":6,"kind":"space_deleted","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album"}
    ));
    try std.testing.expect(fake.dropped_space);
    try std.testing.expectEqual(@as(?u64, null), fake.cursor);
}

test "a write without its record only advances the cursor" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fake: Fake = .{ .gpa = std.testing.allocator };
    defer fake.records.deinit(fake.gpa);
    const projector: Projector = .{ .store = fake.store() };
    try std.testing.expectEqual(Outcome.skipped, try feed(projector, &fake, a,
        \\{"did":"did:plc:artist","time_us":7,"kind":"commit","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album",
        \\ "commit":{"rev":"r1","operation":"update","collection":"fm.plyr.track","rkey":"3song","cid":"bafy"}}
    ));
    try std.testing.expectEqual(@as(?u64, 7), fake.cursor);
    try std.testing.expectEqual(@as(usize, 0), fake.records.count());
}

test "stream events plyr does not project, or for another space, are ignored; malformed ones are refused" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try std.testing.expectEqual(@as(?Event, null), try parseEvent(a, space_uri, "{\"kind\":\"authorized\",\"expires_at\":\"2026-11-14T00:00:00Z\"}"));
    try std.testing.expectEqual(@as(?Event, null), try parseEvent(a, space_uri, "{\"kind\":\"sync_error\",\"message\":\"listWriters 502\"}"));
    try std.testing.expectEqual(@as(?Event, null), try parseEvent(a, space_uri,
        \\{"did":"did:plc:x","time_us":1,"kind":"space_deleted","space":"at://did:plc:x/space/fm.plyr.next.audio/other"}
    ));
    try std.testing.expectError(error.InvalidEvent, parseEvent(a, space_uri, "[1]"));
    try std.testing.expectError(error.InvalidEvent, parseEvent(a, space_uri,
        \\{"did":"did:plc:artist","time_us":-1,"kind":"space_deleted","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album"}
    ));
    try std.testing.expectError(error.InvalidEvent, parseEvent(a, space_uri,
        \\{"did":"did:plc:artist","time_us":2,"kind":"commit","space":"at://did:plc:artist/space/fm.plyr.next.audio/3album",
        \\ "commit":{"rev":"r1","operation":"create","collection":"fm.plyr.track","rkey":"3song","cid":"bafy","record":"nope"}}
    ));
}
