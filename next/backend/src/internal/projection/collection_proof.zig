const std = @import("std");
const zat = @import("zat");

pub const max_records = 2000;
const max_nodes = 16_000;
const max_depth = 256;

pub const Selection = struct {
    entries: []const zat.mst.WalkEntry,
    missing: []const zat.Cid,
};

pub fn inspect(
    allocator: std.mem.Allocator,
    root: zat.Cid,
    reader: zat.mst.BlockReader,
    collections: []const []const u8,
) !Selection {
    const ranges = try allocator.alloc(Range, collections.len);
    for (collections, ranges) |collection, *range| {
        if (zat.Nsid.parse(collection) == null) return error.InvalidCollection;
        range.* = .{
            .start = try std.fmt.allocPrint(allocator, "{s}/", .{collection}),
            .end = try std.fmt.allocPrint(allocator, "{s}0", .{collection}),
        };
    }
    var scan: Scan = .{ .allocator = allocator, .reader = reader, .ranges = ranges };
    try scan.visit(root.raw, null, null, 0);
    return .{
        .entries = try scan.entries.toOwnedSlice(allocator),
        .missing = try scan.missing.toOwnedSlice(allocator),
    };
}

const Range = struct { start: []const u8, end: []const u8 };

const Scan = struct {
    allocator: std.mem.Allocator,
    reader: zat.mst.BlockReader,
    ranges: []const Range,
    entries: std.ArrayList(zat.mst.WalkEntry) = .empty,
    missing: std.ArrayList(zat.Cid) = .empty,
    missing_keys: std.StringHashMapUnmanaged(void) = .empty,
    visited: usize = 0,

    fn intersects(self: *const Scan, lower: ?[]const u8, upper: ?[]const u8) bool {
        for (self.ranges) |range| {
            if (lower) |bound| if (std.mem.order(u8, bound, range.end) != .lt) continue;
            if (upper) |bound| if (std.mem.order(u8, bound, range.start) != .gt) continue;
            return true;
        }
        return false;
    }

    fn selected(self: *const Scan, key: []const u8) bool {
        for (self.ranges) |range| {
            if (std.mem.order(u8, key, range.start) != .lt and
                std.mem.order(u8, key, range.end) == .lt) return true;
        }
        return false;
    }

    fn need(self: *Scan, raw: []const u8) !void {
        const entry = try self.missing_keys.getOrPut(self.allocator, raw);
        if (entry.found_existing) return;
        if (self.missing.items.len >= max_nodes) return error.RepositoryTooLarge;
        try self.missing.append(self.allocator, try zat.Cid.fromBytes(raw));
    }

    fn visit(self: *Scan, raw: []const u8, lower: ?[]const u8, upper: ?[]const u8, depth: usize) anyerror!void {
        if (!self.intersects(lower, upper)) return;
        self.visited += 1;
        if (depth > max_depth or self.visited > max_nodes) return error.RepositoryTooLarge;
        const bytes = (try self.reader.get(raw)) orelse return self.need(raw);
        const node = try zat.mst.decodeMstNode(self.allocator, bytes);
        const keys = try self.allocator.alloc([]const u8, node.entries.len);
        var previous: []const u8 = "";
        for (node.entries, keys) |entry, *key| {
            if (entry.prefix_len > previous.len or entry.prefix_len + entry.key_suffix.len > 1024)
                return error.InvalidMstNode;
            key.* = try std.mem.concat(self.allocator, u8, &.{ previous[0..entry.prefix_len], entry.key_suffix });
            if (key.len == 0 or (previous.len > 0 and std.mem.order(u8, previous, key.*) != .lt))
                return error.InvalidMstNode;
            if (lower) |bound| if (std.mem.order(u8, key.*, bound) != .gt) return error.InvalidMstNode;
            if (upper) |bound| if (std.mem.order(u8, key.*, bound) != .lt) return error.InvalidMstNode;
            previous = key.*;
        }
        if (node.left) |cid| try self.visit(cid, lower, if (keys.len > 0) keys[0] else upper, depth + 1);
        for (node.entries, keys, 0..) |entry, key, index| {
            if (self.selected(key)) {
                if (self.entries.items.len >= max_records) return error.RepositoryTooLarge;
                const cid = try zat.Cid.fromBytes(entry.value);
                try self.entries.append(self.allocator, .{ .key = key, .value = cid });
                if (try self.reader.get(cid.raw) == null) try self.need(cid.raw);
            }
            if (entry.tree) |cid| try self.visit(cid, key, if (index + 1 < keys.len) keys[index + 1] else upper, depth + 1);
        }
    }
};

test "collection coverage discovers omitted records and requires their blocks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fixture = try Fixture.init(a);
    const selection = try inspect(a, fixture.root, fixture.reader(), &.{"fm.plyr.track"});
    try std.testing.expectEqual(@as(usize, 2), selection.entries.len);
    try std.testing.expectEqual(@as(usize, 0), selection.missing.len);
    fixture.omit = selection.entries[1].value.raw;
    const incomplete = try inspect(a, fixture.root, fixture.reader(), &.{"fm.plyr.track"});
    try std.testing.expectEqual(@as(usize, 1), incomplete.missing.len);
    try std.testing.expectEqualSlices(u8, fixture.omit.?, incomplete.missing[0].raw);
}

test "sparse collection coverage skips unrelated subtrees and proves empty ranges" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fixture = try Fixture.init(a);
    const selection = try inspect(a, fixture.root, fixture.reader(), &.{ "fm.plyr.track", "fm.plyr.list" });
    try std.testing.expectEqual(@as(usize, 2), selection.entries.len);
    try std.testing.expectEqual(@as(usize, 0), selection.missing.len);
    try std.testing.expect(fixture.reads < fixture.blocks.len / 2);
    fixture.omit = fixture.root.raw;
    const incomplete = try inspect(a, fixture.root, fixture.reader(), &.{"fm.plyr.list"});
    try std.testing.expectEqual(@as(usize, 1), incomplete.missing.len);
}

const Fixture = struct {
    blocks: []const zat.car.Block,
    root: zat.Cid,
    reads: usize = 0,
    omit: ?[]const u8 = null,

    fn init(a: std.mem.Allocator) !Fixture {
        var tree = zat.mst.Mst.init(a);
        var blocks: std.ArrayList(zat.car.Block) = .empty;
        for (0..302) |index| {
            const key = if (index < 300)
                try std.fmt.allocPrint(a, "app.bsky.feed.post/{d:0>5}", .{index})
            else
                try std.fmt.allocPrint(a, "fm.plyr.track/{d}", .{index});
            const bytes = try zat.cbor.encodeAlloc(a, .{ .text = key });
            const cid = try zat.Cid.forDagCbor(a, bytes);
            try blocks.append(a, .{ .cid_raw = cid.raw, .data = bytes });
            try tree.put(key, cid);
        }
        const root = try tree.rootCid();
        try tree.collectBlocks(&blocks);
        return .{ .root = root, .blocks = try blocks.toOwnedSlice(a) };
    }

    fn reader(self: *Fixture) zat.mst.BlockReader {
        return .{ .ctx = self, .getFn = get };
    }

    fn get(context: *anyopaque, raw: []const u8) !?[]const u8 {
        const self: *Fixture = @ptrCast(@alignCast(context));
        self.reads += 1;
        if (self.omit) |omit| if (std.mem.eql(u8, omit, raw)) return null;
        for (self.blocks) |block| if (std.mem.eql(u8, block.cid_raw, raw)) return block.data;
        return null;
    }
};
