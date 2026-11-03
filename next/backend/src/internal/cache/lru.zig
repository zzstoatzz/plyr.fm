//! Bounded thread-safe string-key LRU shared by runtime adapters.

const std = @import("std");

pub fn Lru(comptime Value: type) type {
    return struct {
        const Self = @This();
        const Node = struct {
            key: []const u8,
            value: Value,
            previous: ?*Node = null,
            next: ?*Node = null,
        };

        allocator: std.mem.Allocator,
        io: std.Io,
        capacity: usize,
        entries: std.StringHashMapUnmanaged(*Node) = .empty,
        most_recent: ?*Node = null,
        least_recent: ?*Node = null,
        mutex: std.Io.Mutex = .init,

        pub fn init(
            allocator: std.mem.Allocator,
            io: std.Io,
            capacity: usize,
        ) Self {
            return .{
                .allocator = allocator,
                .io = io,
                .capacity = @max(capacity, 1),
            };
        }

        pub fn deinit(self: *Self) void {
            var current = self.most_recent;
            while (current) |node| {
                const next = node.next;
                self.allocator.free(node.key);
                self.allocator.destroy(node);
                current = next;
            }
            self.entries.deinit(self.allocator);
            self.* = undefined;
        }

        pub fn get(self: *Self, key: []const u8) ?Value {
            self.mutex.lockUncancelable(self.io);
            defer self.mutex.unlock(self.io);
            const node = self.entries.get(key) orelse return null;
            self.promote(node);
            return node.value;
        }

        pub fn put(self: *Self, key: []const u8, value: Value) !void {
            self.mutex.lockUncancelable(self.io);
            defer self.mutex.unlock(self.io);
            if (self.entries.get(key)) |node| {
                node.value = value;
                self.promote(node);
                return;
            }
            if (self.entries.count() >= self.capacity) self.evict();
            const owned_key = try self.allocator.dupe(u8, key);
            errdefer self.allocator.free(owned_key);
            const node = try self.allocator.create(Node);
            errdefer self.allocator.destroy(node);
            node.* = .{ .key = owned_key, .value = value, .next = self.most_recent };
            try self.entries.put(self.allocator, owned_key, node);
            if (self.most_recent) |head| head.previous = node;
            self.most_recent = node;
            if (self.least_recent == null) self.least_recent = node;
        }

        pub fn remove(self: *Self, key: []const u8) bool {
            self.mutex.lockUncancelable(self.io);
            defer self.mutex.unlock(self.io);
            const node = self.entries.get(key) orelse return false;
            self.unlink(node);
            _ = self.entries.remove(node.key);
            self.allocator.free(node.key);
            self.allocator.destroy(node);
            return true;
        }

        fn promote(self: *Self, node: *Node) void {
            if (self.most_recent == node) return;
            self.unlink(node);
            node.next = self.most_recent;
            if (self.most_recent) |head| head.previous = node;
            self.most_recent = node;
            if (self.least_recent == null) self.least_recent = node;
        }

        fn unlink(self: *Self, node: *Node) void {
            if (node.previous) |previous| {
                previous.next = node.next;
            } else {
                self.most_recent = node.next;
            }
            if (node.next) |next| {
                next.previous = node.previous;
            } else {
                self.least_recent = node.previous;
            }
            node.previous = null;
            node.next = null;
        }

        fn evict(self: *Self) void {
            const node = self.least_recent orelse return;
            self.unlink(node);
            _ = self.entries.remove(node.key);
            self.allocator.free(node.key);
            self.allocator.destroy(node);
        }
    };
}

test "LRU promotes reads, evicts the least recent key, and removes explicitly" {
    var cache = Lru(u8).init(std.testing.allocator, std.testing.io, 2);
    defer cache.deinit();
    try cache.put("a", 1);
    try cache.put("b", 2);
    try std.testing.expectEqual(@as(u8, 1), cache.get("a").?);
    try cache.put("c", 3);
    try std.testing.expect(cache.get("b") == null);
    try std.testing.expectEqual(@as(u8, 1), cache.get("a").?);
    try std.testing.expect(cache.remove("a"));
    try std.testing.expect(cache.get("a") == null);
}
