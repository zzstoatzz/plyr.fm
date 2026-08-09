//! Reproducible authenticated full-repository projection benchmark.

const std = @import("std");
const zat = @import("zat");
const snapshot_verifier = @import("internal/projection/snapshot_verifier.zig");

const list_record_count = 100;
const track_record_count = 100;
const profile_record_count = 1;
const record_count = list_record_count + track_record_count + profile_record_count;
const iterations = 50;

pub fn main() !void {
    const allocator = std.heap.smp_allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var fixture_arena = std.heap.ArenaAllocator.init(allocator);
    defer fixture_arena.deinit();
    const fixture = try buildFixture(fixture_arena.allocator());

    // Warm cryptographic and allocator paths before the measured loop.
    {
        var warmup = std.heap.ArenaAllocator.init(allocator);
        defer warmup.deinit();
        _ = try snapshot_verifier.verify(
            warmup.allocator(),
            fixture.car_bytes,
            fixture.did,
            fixture.public_key,
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            "fm.plyr.dev.actor.profile",
            1,
        );
    }

    var iteration_arena = std.heap.ArenaAllocator.init(allocator);
    defer iteration_arena.deinit();
    const started = std.Io.Timestamp.now(io, .awake);
    for (0..iterations) |_| {
        _ = iteration_arena.reset(.retain_capacity);
        const snapshot = try snapshot_verifier.verify(
            iteration_arena.allocator(),
            fixture.car_bytes,
            fixture.did,
            fixture.public_key,
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            "fm.plyr.dev.actor.profile",
            1,
        );
        if (snapshot.list_changes.len != list_record_count or
            snapshot.track_changes.len != track_record_count or
            snapshot.profile_changes.len != profile_record_count) return error.BadBenchmarkFixture;
    }
    const elapsed_ns: u64 = @intCast(@max(
        started.durationTo(std.Io.Timestamp.now(io, .awake)).nanoseconds,
        1,
    ));
    const ns_per_repo = @divTrunc(elapsed_ns, iterations);
    const repos_per_second = @as(f64, @floatFromInt(std.time.ns_per_s)) /
        @as(f64, @floatFromInt(ns_per_repo));
    const records_per_second = repos_per_second * record_count;

    var output_buffer: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(io, &output_buffer);
    try stdout.interface.print(
        "records={d} car_bytes={d} iterations={d} ns/repo={d} repos/s={d:.2} records/s={d:.2}\n",
        .{
            record_count,
            fixture.car_bytes.len,
            iterations,
            ns_per_repo,
            repos_per_second,
            records_per_second,
        },
    );
    try stdout.interface.flush();
}

const Fixture = struct {
    car_bytes: []const u8,
    did: []const u8,
    public_key: zat.multicodec.PublicKey,
};

fn buildFixture(allocator: std.mem.Allocator) !Fixture {
    const keypair = try zat.Keypair.fromSecretKey(.p256, .{31} ** 32);
    const did = try keypair.did(allocator);
    const public_key_bytes = try keypair.publicKey();
    const public_key = try allocator.dupe(u8, &public_key_bytes);
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "items", .value = .{ .array = &.{} } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const record_bytes = try zat.cbor.encodeAlloc(allocator, record);
    const record_cid = try zat.Cid.forDagCbor(allocator, record_bytes);
    const blob_cid = try zat.Cid.create(
        allocator,
        1,
        zat.cbor.Codec.raw,
        zat.cbor.HashFn.sha2_256,
        "audio",
    );
    const track_record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "Benchmark Track" } },
        .{ .key = "artist", .value = .{ .text = "Benchmark Artist" } },
        .{ .key = "fileType", .value = .{ .text = "flac" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
        .{ .key = "audioBlob", .value = .{ .map = &.{
            .{ .key = "$type", .value = .{ .text = "blob" } },
            .{ .key = "ref", .value = .{ .cid = blob_cid } },
            .{ .key = "mimeType", .value = .{ .text = "audio/flac" } },
            .{ .key = "size", .value = .{ .unsigned = 5 } },
        } } },
    } };
    const track_bytes = try zat.cbor.encodeAlloc(allocator, track_record);
    const track_cid = try zat.Cid.forDagCbor(allocator, track_bytes);
    const profile_record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.actor.profile" } },
        .{ .key = "bio", .value = .{ .text = "Benchmark artist profile" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const profile_bytes = try zat.cbor.encodeAlloc(allocator, profile_record);
    const profile_cid = try zat.Cid.forDagCbor(allocator, profile_bytes);
    var tree = zat.mst.Mst.init(allocator);
    for (0..list_record_count) |index| {
        const path = try std.fmt.allocPrint(
            allocator,
            "fm.plyr.dev.list/bench-{d:0>8}",
            .{index},
        );
        try tree.put(path, record_cid);
    }
    for (0..track_record_count) |index| {
        const path = try std.fmt.allocPrint(
            allocator,
            "fm.plyr.dev.track/bench-{d:0>8}",
            .{index},
        );
        try tree.put(path, track_cid);
    }
    try tree.put("fm.plyr.dev.actor.profile/self", profile_cid);
    const root = try tree.rootCid();
    const signed = try zat.signCommit(allocator, .{
        .did = did,
        .rev = "3jqfcqzm3fo2j",
        .data = root,
    }, &keypair);
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    try blocks.append(allocator, .{ .cid_raw = signed.cid.raw, .data = signed.bytes });
    try tree.collectBlocks(&blocks);
    try blocks.append(allocator, .{ .cid_raw = record_cid.raw, .data = record_bytes });
    try blocks.append(allocator, .{ .cid_raw = track_cid.raw, .data = track_bytes });
    try blocks.append(allocator, .{ .cid_raw = profile_cid.raw, .data = profile_bytes });
    return .{
        .car_bytes = try zat.car.writeAlloc(allocator, .{
            .roots = &.{signed.cid},
            .blocks = blocks.items,
        }),
        .did = did,
        .public_key = .{ .key_type = .p256, .raw = public_key },
    };
}
