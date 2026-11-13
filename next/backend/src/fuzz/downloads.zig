const std = @import("std");
const zat = @import("zat");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const authorization = @import("../internal/downloads/authorization.zig");
const access = @import("../internal/space/access.zig");
const policy_rules = @import("../internal/space/policy.zig");
const proof = @import("../internal/projection/record_proof_verifier.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{.{ "downloads.policy_boundary", policyBoundary }});
}

fn payments(context: *anyopaque, _: std.mem.Allocator, _: []const u8, _: []const u8, _: policy_rules.Brokers) anyerror![]const policy_rules.Payment {
    return if (@as(*bool, @ptrCast(@alignCast(context))).*) &.{.{ .amount = 100, .currency = "USD" }} else &.{};
}

fn noSpaces(_: *anyopaque, _: std.mem.Allocator, _: access.Request) anyerror!bool {
    return error.NoSpaceExpected;
}

fn policyBoundary(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const policy = try gen.pick(case, []const u8, &.{ "supporters", "open", "ask", "off", "future" });
    const gate = try gen.pick(case, []const u8, &.{ "any", "owner", "future" });
    const owner = try case.int(u8, 0, 1) == 1;
    var supports = try case.int(u8, 0, 1) == 1;
    const stale = try case.int(u8, 0, 1) == 1;
    const json = try std.fmt.allocPrint(a, "{{\"$type\":\"fm.plyr.dev.track\",\"title\":\"x\",\"artist\":\"x\",\"fileType\":\"mp3\",\"createdAt\":\"2026-11-12T00:00:00Z\",\"audioUrl\":\"https://audio.example/x\",\"downloadPolicy\":\"{s}\",\"supportGate\":{{\"type\":\"{s}\"}}}}", .{ policy, gate });
    const value = try zat.cbor.fromJson(a, try std.json.parseFromSliceLeaky(std.json.Value, a, json, .{}));
    const cid = try zat.Cid.forDagCbor(a, try zat.cbor.encodeAlloc(a, value));
    const state: proof.RecordState = .{ .commit_cid = cid, .commit_rev = "3jqfcqzm3fo2j", .record = .{ .cid = cid, .value = value } };
    const requested = if (stale) try (try zat.Cid.forDagCbor(a, "other")).toString(a) else try cid.toString(a);
    const accepted = if (authorization.evaluate(a, state, requested, "did:plc:artist", if (owner) "did:plc:artist" else "did:plc:viewer", "fm.plyr.dev.track", null, .{ .context = &supports, .decide_fn = noSpaces }, .{ .context = &supports, .payments_fn = payments })) |_| true else |_| false;
    // the authored supportGate no longer decides anything
    const expected = !stale and std.mem.eql(u8, policy, "supporters") and (owner or supports);
    if (accepted != expected) return case.fail("download policy escaped CID/supporter boundary");
}
