const std = @import("std");
const zat = @import("zat");
const json_record = @import("../atproto/json_record.zig");

pub const proof_collection = "network.attested.payment.proof";
pub const payment_collections = [_][]const u8{
    "network.attested.payment.oneTime",
    "network.attested.payment.recurring",
};
/// broker.atmosphere.money
pub const default_trusted_brokers = [_][]const u8{"did:plc:7srqsetux75b6flzbbyag2ro"};

/// A broker proof to fetch and compare.
pub const ProofRef = struct {
    broker: []const u8,
    rkey: []const u8,
    /// the CID the payer's record claims for the proof
    cid: []const u8,
    payer: []const u8,
    payment: std.json.Value,
};

/// From one listRecords page, the broker proofs that would attest support of
/// `artist` by a trusted broker.
pub fn proofRefs(
    allocator: std.mem.Allocator,
    page: std.json.Value,
    payer: []const u8,
    artist: []const u8,
    trusted: []const []const u8,
) ![]ProofRef {
    var out: std.ArrayList(ProofRef) = .empty;
    const records = (if (page == .object) page.object.get("records") else null) orelse return out.toOwnedSlice(allocator);
    if (records != .array) return out.toOwnedSlice(allocator);
    for (records.array.items) |record| {
        if (record != .object) continue;
        const uri = stringField(record, "uri") orelse continue;
        const payment_at = zat.AtUri.parse(uri) orelse continue;
        if (!std.mem.eql(u8, payment_at.authority(), payer)) continue;
        const collection = payment_at.collection() orelse continue;
        if (!contains(&payment_collections, collection)) continue;
        const rkey = payment_at.rkey() orelse continue;
        const value = record.object.get("value") orelse continue;
        if (!std.mem.eql(u8, stringField(value, "$type") orelse continue, collection)) continue;
        if (!std.mem.eql(u8, stringField(value, "subject") orelse continue, artist)) continue;
        const signatures = (if (value == .object) value.object.get("signatures") else null) orelse continue;
        if (signatures != .array) continue;
        for (signatures.array.items) |signature| {
            const sig_uri = stringField(signature, "uri") orelse continue;
            const cid = stringField(signature, "cid") orelse continue;
            const at = zat.AtUri.parse(sig_uri) orelse continue;
            const proof_type = at.collection() orelse continue;
            const proof_rkey = at.rkey() orelse continue;
            const broker = at.authority();
            if (!std.mem.eql(u8, proof_type, proof_collection)) continue;
            if (!std.mem.eql(u8, proof_rkey, rkey)) continue;
            if (!contains(trusted, broker)) continue;
            try out.append(allocator, .{ .broker = broker, .rkey = rkey, .cid = cid, .payer = payer, .payment = value });
        }
    }
    return out.toOwnedSlice(allocator);
}

pub fn proofVerifies(allocator: std.mem.Allocator, record: std.json.Value, proof: ProofRef) !bool {
    const uri = stringField(record, "uri") orelse return false;
    const at = zat.AtUri.parse(uri) orelse return false;
    if (!std.mem.eql(u8, at.authority(), proof.broker) or
        !std.mem.eql(u8, at.collection() orelse return false, proof_collection) or
        !std.mem.eql(u8, at.rkey() orelse return false, proof.rkey)) return false;
    if (!std.mem.eql(u8, stringField(record, "cid") orelse return false, proof.cid)) return false;
    const value = record.object.get("value") orelse return false;
    if (!std.mem.eql(u8, stringField(value, "$type") orelse return false, proof_collection) or
        !std.mem.eql(u8, stringField(value, "status") orelse return false, "verified")) return false;
    _ = json_record.verified(allocator, value, proof.cid) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return false,
    };
    // atprotofans proofs commit to the payment (without its signatures) plus
    // `$sig: {repo: payer}`; checked against live broker proofs on 2026-11-13.
    const expected = stringField(value, "cid") orelse return false;
    var sig: std.json.ObjectMap = .empty;
    try sig.put(allocator, "repo", .{ .string = proof.payer });
    var payment = try proof.payment.object.clone(allocator);
    _ = payment.swapRemove("signatures");
    try payment.put(allocator, "$sig", .{ .object = sig });
    _ = json_record.verified(allocator, .{ .object = payment }, expected) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return false,
    };
    return true;
}

pub fn cursor(page: std.json.Value) ?[]const u8 {
    return stringField(page, "cursor");
}

fn stringField(value: std.json.Value, key: []const u8) ?[]const u8 {
    if (value != .object) return null;
    const field = value.object.get(key) orelse return null;
    return if (field == .string) field.string else null;
}

fn contains(list: []const []const u8, item: []const u8) bool {
    for (list) |entry| if (std.mem.eql(u8, entry, item)) return true;
    return false;
}

pub const fixture_json = @embedFile("fixtures/attested.json");

test "attested binds broker proof to the exact payer and payment" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    const fixture = try std.json.parseFromSliceLeaky(std.json.Value, a, fixture_json, .{});
    const page = fixture.object.get("page").?;
    const record = fixture.object.get("proof").?;
    const refs = try proofRefs(a, page, "did:plc:fan", "did:plc:artist", &default_trusted_brokers);
    try std.testing.expectEqual(@as(usize, 1), refs.len);
    try std.testing.expect(try proofVerifies(a, record, refs[0]));
    var replay = refs[0];
    replay.payer = "did:plc:thief";
    try std.testing.expect(!try proofVerifies(a, record, replay));
    try std.testing.expectEqual(@as(usize, 0), (try proofRefs(a, page, "did:plc:thief", "did:plc:artist", &default_trusted_brokers)).len);
    try std.testing.expectEqual(@as(usize, 0), (try proofRefs(a, page, "did:plc:fan", "did:plc:other", &default_trusted_brokers)).len);
    try std.testing.expectEqual(@as(usize, 0), (try proofRefs(a, page, "did:plc:fan", "did:plc:artist", &.{})).len);
    var changed = refs[0].payment;
    changed.object = try changed.object.clone(a);
    try changed.object.put(a, "subject", .{ .string = "did:plc:other" });
    replay = refs[0];
    replay.payment = changed;
    try std.testing.expect(!try proofVerifies(a, record, replay));
    var forged = record;
    forged.object = try record.object.clone(a);
    var proof_value = record.object.get("value").?;
    proof_value.object = try proof_value.object.clone(a);
    try proof_value.object.put(a, "status", .{ .string = "pending" });
    try forged.object.put(a, "value", proof_value);
    try std.testing.expect(!try proofVerifies(a, forged, refs[0]));
    try proof_value.object.put(a, "status", .{ .string = "verified" });
    try proof_value.object.put(a, "issuedAt", .{ .string = "forged metadata" });
    try forged.object.put(a, "value", proof_value);
    try std.testing.expect(!try proofVerifies(a, forged, refs[0]));
    try forged.object.put(a, "value", record.object.get("value").?);
    try forged.object.put(a, "uri", .{ .string = "at://did:plc:other/network.attested.payment.proof/3abc" });
    try std.testing.expect(!try proofVerifies(a, forged, refs[0]));
}
