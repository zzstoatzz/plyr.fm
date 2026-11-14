//! What reaches a jam from outside the process: queues in commands and the
//! ticket a websocket presents. A queue is accepted exactly when every track
//! is well formed (its id encodes its uri, the uri is in the track
//! collection, the CID is dag-cbor, the duration is in range, at most
//! `max_tracks` of them). A ticket that is not 64 hex digits is refused
//! before anything is asked of redis.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const protocol = @import("../internal/jams/protocol.zig");
const tickets = @import("../internal/jams/tickets.zig");
const track_id = @import("../internal/identity/track_id.zig");

const collection = "fm.plyr.dev.track";

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "jams.references", references },
        .{ "jams.ticket_token", ticketToken },
    });
}

const dag_cbor_cids = [_][]const u8{
    "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm",
    "bafyreia2kq243hqq3volwlzkbzzphoeqauk54sc5h7vgogq4ei5fjizxvy",
};
/// a well-formed CID of the raw codec, which a queue must refuse
const raw_cid = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

const Defect = enum { none, id_mismatch, other_collection, raw_codec, unparseable_cid, zero_duration, too_long };

fn defectOf(case: *hegel.TestCase) !Defect {
    // most tracks are fine, so a queue with several still reaches the later checks
    return if (try case.int(u8, 0, 3) != 0) .none else try gen.pick(case, Defect, std.enums.values(Defect));
}

fn track(a: std.mem.Allocator, case: *hegel.TestCase, defect: Defect) !protocol.Track {
    const rkey = try gen.pick(case, []const u8, &.{ "one", "two", "3m2k5i7xyzq2a" });
    const nsid = if (defect == .other_collection) "fm.plyr.dev.list" else collection;
    const uri = try std.fmt.allocPrint(a, "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/{s}/{s}", .{ nsid, rkey });
    const id_uri = if (defect == .id_mismatch) try std.fmt.allocPrint(a, "{s}x", .{uri}) else uri;
    const id_buffer = try a.alloc(u8, track_id.encodedLength(id_uri));
    return .{
        .id = try track_id.encode(id_buffer, id_uri),
        .uri = uri,
        .cid = switch (defect) {
            .raw_codec => raw_cid,
            .unparseable_cid => try gen.pick(case, []const u8, &.{ "", "bafy", "not a cid", dag_cbor_cids[0][0..40] }),
            else => try gen.pick(case, []const u8, &dag_cbor_cids),
        },
        .durationMs = switch (defect) {
            .zero_duration => 0,
            .too_long => protocol.max_position_ms + try case.int(u64, 1, 1_000),
            else => try case.int(u64, 1, protocol.max_position_ms),
        },
    };
}

fn references(_: void, case: *hegel.TestCase) !void {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.smp_allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    const allow_unknown_duration = try case.boolean();
    const oversized = try case.int(u8, 0, 19) == 0;
    const count = if (oversized) protocol.max_tracks + 1 else try case.int(usize, 0, 4);

    const queue = try a.alloc(protocol.Track, count);
    var expected = !oversized;
    var reason: Defect = .none;
    for (queue, 0..) |*slot, index| {
        // an oversized queue repeats one good track; only its length is wrong
        if (oversized and index > 0) {
            slot.* = queue[0];
            continue;
        }
        const defect = if (oversized) .none else try defectOf(case);
        slot.* = try track(a, case, defect);
        const refused = switch (defect) {
            .none => false,
            .zero_duration => !allow_unknown_duration,
            else => true,
        };
        if (refused) {
            expected = false;
            reason = defect;
        }
    }
    case.note("{d} tracks, unknown durations {s}, defect {s}", .{
        count, if (allow_unknown_duration) "allowed" else "refused", @tagName(reason),
    });
    const accepted = try protocol.validateReferences(std.heap.smp_allocator, queue, collection, allow_unknown_duration);
    if (accepted and !expected) return case.fail("a queue with a malformed track was accepted");
    if (!accepted and expected) return case.fail("a well-formed queue was refused");
    if (accepted) {
        case.event("accepted");
    } else if (oversized) {
        case.event("too many tracks");
    } else switch (reason) {
        inline else => |tag| case.event("refused: " ++ @tagName(tag)),
    }
}

fn ticketToken(_: void, case: *hegel.TestCase) !void {
    var arena_state = std.heap.ArenaAllocator.init(std.heap.smp_allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    const length = try gen.pick(case, usize, &.{ 0, 1, 63, 64, 64, 64, 65, 128 });
    // mostly hex, so 64-byte tokens that pass the gate are common
    const alphabet = try gen.pick(case, []const u8, &.{ "0123456789abcdefABCDEF", "0123456789abcdef-g\x00 " });
    const token = try gen.string(case, a, alphabet, length, length);
    case.note("token {s} ({d} bytes)", .{ token, token.len });
    var well_formed = token.len == 64;
    for (token) |byte| well_formed = well_formed and std.ascii.isHex(byte);

    var threaded = std.Io.Threaded.init(std.heap.smp_allocator, .{});
    defer threaded.deinit();
    // nothing listens on port 1: reaching redis shows up as a connection error
    var store = try tickets.Tickets.init(std.heap.smp_allocator, threaded.io(), "redis://127.0.0.1:1");
    defer store.deinit();
    if (store.consume(a, token)) |_| {
        return case.fail("a ticket was consumed with no redis to hold it");
    } else |err| switch (err) {
        error.InvalidTicket => if (well_formed) return case.fail("a 64-hex ticket was refused without asking redis"),
        else => if (!well_formed) return case.fail("a malformed ticket reached redis"),
    }
    if (well_formed) case.event("well formed") else case.event("malformed");
}
