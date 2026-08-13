//! Discovery hints for one-time authenticated catalog reconciliation.
//!
//! A candidate DID says only which repository to inspect. It carries no
//! authority about records, account state, or content visibility.

const std = @import("std");

pub const CandidateSet = struct {
    items: [][]u8,

    pub fn deinit(self: *CandidateSet, allocator: std.mem.Allocator) void {
        for (self.items) |item| allocator.free(item);
        allocator.free(self.items);
        self.* = undefined;
    }
};

pub const Error = error{
    OutOfMemory,
    SourceUnavailable,
    CorruptSource,
};

pub const Source = struct {
    context: *anyopaque,
    list_fn: *const fn (*anyopaque, std.mem.Allocator) Error!CandidateSet,

    pub fn list(self: Source, allocator: std.mem.Allocator) Error!CandidateSet {
        return self.list_fn(self.context, allocator);
    }
};

test "candidate source owns every returned DID" {
    const Fake = struct {
        fn list(_: *anyopaque, allocator: std.mem.Allocator) Error!CandidateSet {
            const items = allocator.alloc([]u8, 2) catch return error.OutOfMemory;
            errdefer allocator.free(items);
            items[0] = allocator.dupe(u8, "did:plc:one") catch return error.OutOfMemory;
            errdefer allocator.free(items[0]);
            items[1] = allocator.dupe(u8, "did:web:two.example") catch return error.OutOfMemory;
            return .{ .items = items };
        }
    };
    var context: u8 = 0;
    const source: Source = .{ .context = &context, .list_fn = Fake.list };
    var candidates = try source.list(std.testing.allocator);
    defer candidates.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("did:plc:one", candidates.items[0]);
    try std.testing.expectEqualStrings("did:web:two.example", candidates.items[1]);
}
