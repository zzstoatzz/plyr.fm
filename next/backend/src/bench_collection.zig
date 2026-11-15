const std = @import("std");
const zat = @import("zat");
const repository = @import("internal/ingest/zat_pds_repository_source.zig");
const signing_key = @import("internal/ingest/zat_signing_key_resolver.zig");
const verifier = @import("internal/projection/record_proof_verifier.zig");

pub fn main() !void {
    const did = std.mem.span(std.c.getenv("PROOF_BENCH_DID") orelse return error.SetProofBenchDid);
    const prefix = if (std.c.getenv("PROOF_BENCH_NSID")) |value| std.mem.span(value) else "fm.plyr";
    var threaded = std.Io.Threaded.init(std.heap.smp_allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    var resolver = zat.DidResolver.init(io, std.heap.smp_allocator);
    defer resolver.deinit();
    var transport = zat.HttpTransport.initWithUserAgent(io, std.heap.smp_allocator, "plyr-proof-bench/0.1");
    defer transport.deinit();
    for (0..3) |iteration| {
        var arena = std.heap.ArenaAllocator.init(std.heap.smp_allocator);
        defer arena.deinit();
        const a = arena.allocator();
        const track = try std.fmt.allocPrint(a, "{s}.track", .{prefix});
        const list = try std.fmt.allocPrint(a, "{s}.list", .{prefix});
        const profile = try std.fmt.allocPrint(a, "{s}.actor.profile", .{prefix});
        const like = try std.fmt.allocPrint(a, "{s}.like", .{prefix});
        const comment = try std.fmt.allocPrint(a, "{s}.comment", .{prefix});
        const started = std.Io.Timestamp.now(io, .awake);
        var keys: signing_key.ZatSigningKeyResolver = .{ .resolver = &resolver };
        const key = try keys.port().resolve(a, did, true);
        var source: repository.ZatPdsRepositorySource = .{
            .io = io,
            .identity_resolver = &resolver,
            .transport = &transport,
            .collections = &.{ track, list, profile, like, comment },
        };
        const fetched = try source.fetchCollections(a, did);
        defer fetched.release();
        const fetched_at = std.Io.Timestamp.now(io, .awake);
        const snapshot = try verifier.verifyProofs(a, fetched.proofs.?, did, key.publicKey(), list, track, profile, like, comment, 1);
        const verified_at = std.Io.Timestamp.now(io, .awake);
        std.log.info("sample {d}: fetch {d}ms, verify {d}us, car {d} bytes, tracks {d}, lists {d}, likes {d}", .{
            iteration + 1,
            @divFloor(started.durationTo(fetched_at).nanoseconds, std.time.ns_per_ms),
            @divFloor(fetched_at.durationTo(verified_at).nanoseconds, std.time.ns_per_us),
            fetched.bytes.len,
            snapshot.track_changes.len,
            snapshot.list_changes.len,
            snapshot.like_changes.len,
        });
    }
}
