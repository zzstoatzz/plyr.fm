//! attested.network payment attestations (https://attested.network): the
//! payer keeps a `network.attested.payment.{oneTime,recurring}` record whose
//! `subject` is the artist, cross-signed by a proof record (same rkey) in a
//! trusted broker's repo with `status: "verified"`. The payer's signature
//! strongRef must match the proof record's actual CID.

const std = @import("std");
const zat = @import("zat");

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
};

/// From one listRecords page, the broker proofs that would attest support of
/// `artist` by a trusted broker.
pub fn proofRefs(
    allocator: std.mem.Allocator,
    page: std.json.Value,
    artist: []const u8,
    trusted: []const []const u8,
) ![]ProofRef {
    var out: std.ArrayList(ProofRef) = .empty;
    const records = (if (page == .object) page.object.get("records") else null) orelse return out.toOwnedSlice(allocator);
    if (records != .array) return out.toOwnedSlice(allocator);
    for (records.array.items) |record| {
        if (record != .object) continue;
        const uri = stringField(record, "uri") orelse continue;
        const rkey = uri[(std.mem.lastIndexOfScalar(u8, uri, '/') orelse continue) + 1 ..];
        const value = record.object.get("value") orelse continue;
        if (!std.mem.eql(u8, stringField(value, "subject") orelse continue, artist)) continue;
        const signatures = (if (value == .object) value.object.get("signatures") else null) orelse continue;
        if (signatures != .array) continue;
        for (signatures.array.items) |signature| {
            const sig_uri = stringField(signature, "uri") orelse continue;
            const cid = stringField(signature, "cid") orelse continue;
            const at = zat.AtUri.parse(sig_uri) orelse continue;
            const collection = at.collection() orelse continue;
            const proof_rkey = at.rkey() orelse continue;
            const broker = at.authority();
            if (!std.mem.eql(u8, collection, proof_collection)) continue;
            if (!std.mem.eql(u8, proof_rkey, rkey)) continue;
            if (!contains(trusted, broker)) continue;
            try out.append(allocator, .{ .broker = broker, .rkey = rkey, .cid = cid });
        }
    }
    return out.toOwnedSlice(allocator);
}

/// The broker's getRecord answer verifies the proof.
pub fn proofVerifies(record: std.json.Value, expected_cid: []const u8) bool {
    const cid = stringField(record, "cid") orelse return false;
    if (!std.mem.eql(u8, cid, expected_cid)) return false;
    const value = (if (record == .object) record.object.get("value") else null) orelse return false;
    return std.mem.eql(u8, stringField(value, "status") orelse return false, "verified");
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

test "payment records yield proofs only from trusted brokers for the artist" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const page = try std.json.parseFromSliceLeaky(std.json.Value, arena,
        \\{"records":[
        \\ {"uri":"at://did:plc:fan/network.attested.payment.oneTime/3abc","value":{"subject":"did:plc:artist","signatures":[
        \\   {"uri":"at://did:plc:7srqsetux75b6flzbbyag2ro/network.attested.payment.proof/3abc","cid":"bafyproof"},
        \\   {"uri":"at://did:plc:shady/network.attested.payment.proof/3abc","cid":"bafyshady"},
        \\   {"uri":"at://did:plc:7srqsetux75b6flzbbyag2ro/network.attested.payment.proof/other","cid":"bafyother"}]}},
        \\ {"uri":"at://did:plc:fan/network.attested.payment.oneTime/3def","value":{"subject":"did:plc:someoneelse","signatures":[
        \\   {"uri":"at://did:plc:7srqsetux75b6flzbbyag2ro/network.attested.payment.proof/3def","cid":"bafyx"}]}}
        \\],"cursor":"next"}
    , .{});
    const refs = try proofRefs(arena, page, "did:plc:artist", &default_trusted_brokers);
    try std.testing.expectEqual(@as(usize, 1), refs.len);
    try std.testing.expectEqualStrings("bafyproof", refs[0].cid);
    try std.testing.expectEqualStrings("3abc", refs[0].rkey);
    try std.testing.expectEqualStrings("next", cursor(page).?);

    const good = try std.json.parseFromSliceLeaky(std.json.Value, arena, "{\"cid\":\"bafyproof\",\"value\":{\"status\":\"verified\"}}", .{});
    const pending = try std.json.parseFromSliceLeaky(std.json.Value, arena, "{\"cid\":\"bafyproof\",\"value\":{\"status\":\"pending\"}}", .{});
    try std.testing.expect(proofVerifies(good, "bafyproof"));
    try std.testing.expect(!proofVerifies(good, "bafyelse"));
    try std.testing.expect(!proofVerifies(pending, "bafyproof"));
}
