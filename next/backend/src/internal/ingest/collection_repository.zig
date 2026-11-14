const std = @import("std");
const zat = @import("zat");
const snapshot_verifier = @import("../projection/snapshot_verifier.zig");
const record_verifier = @import("../projection/record_proof_verifier.zig");
const coverage = @import("../projection/collection_proof.zig");

pub const max_bytes = 64 * 1024 * 1024;
const batch_size = 64;
const max_requests = 512;
const max_blocks = 16_000;

pub const Blocks = struct {
    context: *anyopaque,
    fetch_fn: *const fn (*anyopaque, std.mem.Allocator, []const zat.Cid) anyerror![]const u8,
};

pub const Result = struct { bytes: []const u8, requests: usize, received_bytes: usize };

pub fn fetch(
    a: std.mem.Allocator,
    root: zat.Cid,
    collections: []const []const u8,
    source: Blocks,
) !Result {
    var bundle: Bundle = .{ .allocator = a, .source = source, .root = root };
    try bundle.load(&.{root});
    const commit_bytes = bundle.blocks.get(root.raw) orelse return error.IncompleteRepo;
    const commit = try zat.cbor.decodeAll(a, commit_bytes);
    const data = switch (commit.get("data") orelse return error.InvalidCommit) {
        .cid => |cid| cid,
        else => return error.InvalidCommit,
    };
    while (true) {
        var scan_arena = std.heap.ArenaAllocator.init(a);
        defer scan_arena.deinit();
        const selected = try coverage.inspect(scan_arena.allocator(), data, bundle.reader(), collections);
        if (selected.missing.len == 0) break;
        var offset: usize = 0;
        while (offset < selected.missing.len) {
            const end = @min(offset + batch_size, selected.missing.len);
            try bundle.load(selected.missing[offset..end]);
            offset = end;
        }
    }
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    var iterator = bundle.blocks.iterator();
    while (iterator.next()) |entry| try blocks.append(a, .{ .cid_raw = entry.key_ptr.*, .data = entry.value_ptr.* });
    const bytes = try zat.car.writeAlloc(a, .{ .roots = &.{root}, .blocks = blocks.items });
    if (bytes.len > max_bytes) return error.RepositoryTooLarge;
    return .{ .bytes = bytes, .requests = bundle.requests, .received_bytes = bundle.received };
}

const Bundle = struct {
    allocator: std.mem.Allocator,
    source: Blocks,
    root: zat.Cid,
    blocks: std.StringHashMapUnmanaged([]const u8) = .empty,
    received: usize = 0,
    requests: usize = 0,

    fn load(self: *Bundle, cids: []const zat.Cid) !void {
        if (self.requests >= max_requests) return error.RepositoryTooLarge;
        self.requests += 1;
        const bytes = try self.source.fetch_fn(self.source.context, self.allocator, cids);
        if (bytes.len > max_bytes - self.received) return error.RepositoryTooLarge;
        self.received += bytes.len;
        const rooted = try rootBlocks(self.allocator, bytes, self.root);
        const parsed = try zat.car.readWithOptions(self.allocator, rooted, .{ .max_size = max_bytes, .max_blocks = max_blocks });
        for (parsed.blocks) |block| {
            try self.blocks.put(self.allocator, block.cid_raw, block.data);
            if (self.blocks.count() > max_blocks) return error.RepositoryTooLarge;
        }
        for (cids) |cid| if (!self.blocks.contains(cid.raw)) return error.IncompleteRepo;
    }

    fn reader(self: *Bundle) zat.mst.BlockReader {
        return .{ .ctx = self, .getFn = get };
    }

    fn get(context: *anyopaque, raw: []const u8) !?[]const u8 {
        const self: *Bundle = @ptrCast(@alignCast(context));
        return self.blocks.get(raw);
    }
};

fn rootBlocks(a: std.mem.Allocator, bytes: []const u8, root: zat.Cid) ![]const u8 {
    var offset: usize = 0;
    const length = zat.cbor.readUvarint(bytes, &offset) orelse return error.InvalidHeader;
    if (length > bytes.len - offset) return error.InvalidHeader;
    const end = offset + @as(usize, @intCast(length));
    const header = try zat.cbor.decodeAll(a, bytes[offset..end]);
    if (header.getInt("version") != 1) return error.InvalidHeader;
    const roots = header.get("roots") orelse return error.InvalidHeader;
    if (roots != .array) return error.InvalidHeader;
    if (roots.array.len != 0) return bytes;
    const prefix = try zat.car.writeAlloc(a, .{ .roots = &.{root}, .blocks = &.{} });
    return std.mem.concat(a, u8, &.{ prefix, bytes[end..] });
}

test "collection repository fetches hash-linked ranges without a record listing" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var source = try Fixture.init(a);
    const result = try fetch(a, source.car.roots[0], &.{ "fm.plyr.dev.track", "fm.plyr.dev.list", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", "fm.plyr.dev.comment" }, source.port());
    const snapshot = try record_verifier.verifyProofs(a, &.{result.bytes}, source.fixture.did, source.fixture.public_key, "fm.plyr.dev.list", "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", "fm.plyr.dev.comment", 42);
    try std.testing.expectEqual(@as(usize, 1), snapshot.track_changes.len);
    try std.testing.expectEqual(@as(usize, 1), snapshot.list_changes.len);
    try std.testing.expect(source.calls > 1 and source.calls < 10);
}

test "a missing requested block refuses the repair instead of authorizing deletion" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var source = try Fixture.init(a);
    source.omit = source.car.roots[0].raw;
    try std.testing.expectError(error.IncompleteRepo, fetch(a, source.car.roots[0], &.{"fm.plyr.dev.track"}, source.port()));
    try std.testing.expectEqual(@as(usize, 1), source.calls);
    source.calls = 0;
    source.omit = source.car.blocks[source.car.blocks.len - 1].cid_raw;
    try std.testing.expectError(error.IncompleteRepo, fetch(a, source.car.roots[0], &.{ "fm.plyr.dev.track", "fm.plyr.dev.like", "fm.plyr.dev.comment" }, source.port()));
    try std.testing.expect(source.calls > 1);
}

test "collection repository refuses tampered block responses" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var source = try Fixture.init(a);
    source.tamper = true;
    try std.testing.expectError(error.BadBlockHash, fetch(a, source.car.roots[0], &.{"fm.plyr.dev.track"}, source.port()));
}

test "empty collections are established from the tree rather than an empty listing" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var source = try Fixture.init(a);
    const result = try fetch(a, source.car.roots[0], &.{ "fm.other.track", "fm.other.list", "fm.other.actor.profile", "fm.other.like", "fm.other.comment" }, source.port());
    const snapshot = try record_verifier.verifyProofs(a, &.{result.bytes}, source.fixture.did, source.fixture.public_key, "fm.other.list", "fm.other.track", "fm.other.actor.profile", "fm.other.like", "fm.other.comment", 42);
    try std.testing.expectEqual(@as(usize, 0), snapshot.track_changes.len);
    try std.testing.expectEqual(@as(usize, 0), snapshot.list_changes.len);
}

test "block response headers must be valid CAR v1" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const root = try zat.Cid.forDagCbor(a, "root");
    try std.testing.expectError(error.InvalidHeader, rootBlocks(a, &.{0xff}, root));
    try std.testing.expectError(error.InvalidHeader, rootBlocks(a, &.{ 0x7f, 0 }, root));
}

const Fixture = struct {
    fixture: snapshot_verifier.Fixture,
    car: zat.car.Car,
    calls: usize = 0,
    omit: ?[]const u8 = null,
    tamper: bool = false,

    fn init(a: std.mem.Allocator) !Fixture {
        const fixture = try snapshot_verifier.buildFixture(a, true, false);
        return .{ .fixture = fixture, .car = try zat.car.read(a, fixture.car_bytes) };
    }

    fn port(self: *Fixture) Blocks {
        return .{ .context = self, .fetch_fn = get };
    }

    fn get(context: *anyopaque, a: std.mem.Allocator, cids: []const zat.Cid) ![]const u8 {
        const self: *Fixture = @ptrCast(@alignCast(context));
        self.calls += 1;
        var blocks: std.ArrayList(zat.car.Block) = .empty;
        for (cids) |cid| {
            if (self.omit) |omit| if (std.mem.eql(u8, cid.raw, omit)) continue;
            const data = zat.car.findBlock(self.car, cid.raw) orelse continue;
            try blocks.append(a, .{ .cid_raw = cid.raw, .data = data });
        }
        const result = try zat.car.writeAlloc(a, .{ .roots = &.{}, .blocks = blocks.items });
        if (self.tamper) result[result.len - 1] ^= 1;
        return result;
    }
};
