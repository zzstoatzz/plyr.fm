//! Benchmark the synchronous raw-frame decode and collection discovery path.

const std = @import("std");
const zat = @import("zat");

const iterations = 1_000_000;

pub fn main() !void {
    const allocator = std.heap.smp_allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var fixture_arena = std.heap.ArenaAllocator.init(allocator);
    defer fixture_arena.deinit();
    const commit_cid = try zat.Cid.forDagCbor(fixture_arena.allocator(), "commit");
    const operations = [_]zat.firehose.CommitEventOp{.{
        .action = .delete,
        .collection = "app.bsky.feed.post",
        .rkey = "benchmark",
    }};
    const frame = try zat.firehose.encodeCommitEvent(fixture_arena.allocator(), .{
        .seq = 42,
        .repo_did = "did:plc:benchmark",
        .commit_cid = commit_cid,
        .rev = "3jqfcqzm3fo2j",
        .blocks = &.{},
        .ops = &operations,
        .time = "2026-08-08T00:00:00Z",
    });

    var iteration_arena = std.heap.ArenaAllocator.init(allocator);
    defer iteration_arena.deinit();
    const started = std.Io.Timestamp.now(io, .awake);
    var relevant: usize = 0;
    for (0..iterations) |_| {
        _ = iteration_arena.reset(.retain_capacity);
        const event = try zat.firehose.decodeFrame(iteration_arena.allocator(), frame);
        const commit = switch (event) {
            .commit => |value| value,
            else => return error.BadBenchmarkFixture,
        };
        for (commit.ops) |operation| {
            if (std.mem.eql(u8, operation.collection, "fm.plyr.dev.list") or
                std.mem.eql(u8, operation.collection, "fm.plyr.dev.track")) relevant += 1;
        }
        std.mem.doNotOptimizeAway(commit.seq);
    }
    if (relevant != 0) return error.BadBenchmarkFixture;
    const elapsed_ns: u64 = @intCast(@max(
        started.durationTo(std.Io.Timestamp.now(io, .awake)).nanoseconds,
        1,
    ));
    const ns_per_frame = @divTrunc(elapsed_ns, iterations);
    const frames_per_second = @as(f64, @floatFromInt(std.time.ns_per_s)) /
        @as(f64, @floatFromInt(ns_per_frame));
    var output_buffer: [1024]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(io, &output_buffer);
    try stdout.interface.print(
        "frame_bytes={d} iterations={d} ns/frame={d} frames/s={d:.2}\n",
        .{ frame.len, iterations, ns_per_frame, frames_per_second },
    );
    try stdout.interface.flush();
}
