const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const attested = @import("../internal/space/attested.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{.{ "attested.payment_binding", paymentBinding }});
}

fn paymentBinding(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const fixture = try std.json.parseFromSliceLeaky(std.json.Value, a, attested.fixture_json, .{});
    const refs = try attested.proofRefs(a, fixture.object.get("page").?, "did:plc:fan", "did:plc:artist", &attested.default_trusted_brokers);
    var proof = refs[0];
    const replay = try case.int(u8, 0, 1) == 1;
    const changed_amount = try case.int(u32, 0, 100_000);
    if (replay) proof.payer = "did:plc:thief";
    try proof.payment.object.put(a, "amount", .{ .integer = changed_amount });
    const accepted = try attested.proofVerifies(a, fixture.object.get("proof").?, proof);
    if (accepted != (!replay and changed_amount == 2500)) return case.fail("broker proof authorized a changed payer or payment");
}
