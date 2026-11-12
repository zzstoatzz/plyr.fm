const std = @import("std");
const zat = @import("zat");
const auth = @import("../jams/auth.zig");
const track_record = @import("../atproto/track_record.zig");
const managed_space = @import("../space/managed_space.zig");
const Network = @import("../space/network.zig").Network;
const Repository = @import("../ingest/zat_pds_repository_source.zig").ZatPdsRepositorySource;
const Keys = @import("../ingest/zat_signing_key_resolver.zig").ZatSigningKeyResolver;
const verifier = @import("../projection/record_proof_verifier.zig");

pub const Request = struct { serviceToken: []const u8, recordUri: []const u8, recordCid: []const u8 };
pub const Settings = struct {
    auth_config: auth.Config,
    track_collection: []const u8,
    audio_space_type: ?[]const u8 = null,
    budget_ns: u64 = 15 * std.time.ns_per_s,
};
pub const Decision = struct {
    viewer: []const u8,
    recordUri: []const u8,
    recordCid: []const u8,
    downloadPolicy: []const u8 = "supporters",
    expiresAt: i64,
};

pub fn authorize(a: std.mem.Allocator, io: std.Io, settings: Settings, body: []const u8) ![]const u8 {
    const request = std.json.parseFromSliceLeaky(Request, a, body, .{}) catch return error.InvalidRequest;
    const at = zat.AtUri.parse(request.recordUri) orelse return error.InvalidRequest;
    if (zat.Did.parse(at.authority()) == null or
        !std.mem.eql(u8, at.collection() orelse return error.InvalidRequest, settings.track_collection) or
        zat.Rkey.parse(at.rkey() orelse return error.InvalidRequest) == null) return error.InvalidRequest;
    const cid = zat.Cid.fromString(a, request.recordCid) catch return error.InvalidRequest;
    if (cid.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidRequest;
    const Outcome = union(enum) { decision: anyerror!Decision, timeout: std.Io.Cancelable!void };
    var buffer: [2]Outcome = undefined;
    var select = std.Io.Select(Outcome).init(io, &buffer);
    defer select.cancelDiscard();
    try select.concurrent(.timeout, waitBudget, .{ io, settings.budget_ns });
    try select.concurrent(.decision, execute, .{ a, io, settings, request });
    const decision = switch (try select.await()) {
        .decision => |value| try value,
        .timeout => return error.AuthorizationUnavailable,
    };
    return std.json.Stringify.valueAlloc(a, decision, .{});
}

fn waitBudget(io: std.Io, ns: u64) std.Io.Cancelable!void {
    try std.Io.Clock.Duration.sleep(.{ .raw = .fromNanoseconds(ns), .clock = .awake }, io);
}

fn execute(a: std.mem.Allocator, io: std.Io, settings: Settings, request: Request) anyerror!Decision {
    const started = std.Io.Clock.awake.now(io).nanoseconds;
    const viewer = try auth.admitOwner(a, io, settings.auth_config, request.serviceToken);
    try io.checkCancel();
    const at = zat.AtUri.parse(request.recordUri).?;
    var network = Network.init(io, a, settings.auth_config.plc_url);
    defer network.deinit();
    network.deadline_ns = started + settings.budget_ns;
    try network.checkDeadline();
    var source: Repository = .{ .io = io, .identity_resolver = &network.resolver, .transport = &network.transport };
    const proof = try source.fetchRecordProof(a, at.authority(), settings.track_collection, at.rkey().?) orelse return error.AuthorizationUnavailable;
    try network.checkDeadline();
    var keys: Keys = .{ .resolver = &network.resolver };
    const signing = try keys.port().resolve(a, at.authority(), true);
    try network.checkDeadline();
    const path = try std.fmt.allocPrint(a, "{s}/{s}", .{ settings.track_collection, at.rkey().? });
    const state = try verifier.verifyRecord(a, proof, path, at.authority(), signing.publicKey());
    try evaluate(a, state, request.recordCid, at.authority(), viewer.actor, settings.track_collection, settings.audio_space_type, network.supporters());
    try network.checkDeadline();
    return .{ .viewer = viewer.actor, .recordUri = request.recordUri, .recordCid = request.recordCid, .expiresAt = (std.Io.Timestamp.now(io, .real).toSeconds() + 30) * 1000 };
}

pub fn evaluate(a: std.mem.Allocator, state: verifier.RecordState, cid: []const u8, artist: []const u8, viewer: []const u8, collection: []const u8, audio_space_type: ?[]const u8, supporters: managed_space.SupporterCheck) !void {
    const record = state.record orelse return error.TrackChanged;
    const expected = zat.Cid.fromString(a, cid) catch return error.InvalidRequest;
    if (!std.mem.eql(u8, record.cid.raw, expected.raw)) return error.TrackChanged;
    const track = track_record.parse(a, record.value, collection) catch return error.DownloadDenied;
    if (!std.mem.eql(u8, track.download_policy, "supporters")) return error.DownloadDenied;
    if (track.support_gate_type) |gate| if (!std.mem.eql(u8, gate, "any")) return error.DownloadDenied;
    if (track.audio_space) |space| {
        const expected_type = audio_space_type orelse return error.DownloadDenied;
        if (!std.mem.eql(u8, space.space.space_type, expected_type)) return error.DownloadDenied;
        if (!std.mem.eql(u8, space.space.authority, artist) or !std.mem.eql(u8, space.repo, artist) or
            !std.mem.eql(u8, space.collection, collection) or managed_space.Gate.parse(space.space.skey) == null) return error.DownloadDenied;
    }
    for ([_][]const u8{ "privateAudio", "audioPayload" }) |field| if (record.value.get(field) != null) return error.DownloadDenied;
    for (track.self_labels) |label| if (std.mem.eql(u8, label, "copyright")) return error.DownloadDenied;
    if (!std.mem.eql(u8, viewer, artist) and !try supporters.check(a, viewer, artist)) return error.DownloadDenied;
}

const FakeSupporters = struct {
    allowed: bool = true,
    calls: usize = 0,
    unavailable: bool = false,

    fn port(self: *FakeSupporters) managed_space.SupporterCheck {
        return .{ .context = self, .check_fn = check };
    }
    fn check(context: *anyopaque, _: std.mem.Allocator, viewer: []const u8, artist: []const u8) !bool {
        const self: *FakeSupporters = @ptrCast(@alignCast(context));
        try std.testing.expectEqualStrings("did:plc:viewer", viewer);
        try std.testing.expectEqualStrings("did:plc:artist", artist);
        self.calls += 1;
        if (self.unavailable) return error.UpstreamUnavailable;
        return self.allowed;
    }
};

test "supporter download decision binds signed canonical CID policy and viewer" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fields = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "fixture" } },
        .{ .key = "artist", .value = .{ .text = "fixture" } },
        .{ .key = "fileType", .value = .{ .text = "mp3" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-11-12T00:00:00Z" } },
        .{ .key = "audioUrl", .value = .{ .text = "https://audio.example/fixture.mp3" } },
        .{ .key = "downloadPolicy", .value = .{ .text = "supporters" } },
        .{ .key = "supportGate", .value = .{ .map = &.{.{ .key = "type", .value = .{ .text = "any" } }} } },
    };
    const value: zat.cbor.Value = .{ .map = &fields };
    const bytes = try zat.cbor.encodeAlloc(a, value);
    const cid = try zat.Cid.forDagCbor(a, bytes);
    const text = try cid.toString(a);
    const pair = try zat.Keypair.fromSecretKey(.p256, @as([32]u8, @splat(31)));
    const pubkey = try pair.publicKey();
    var tree = zat.mst.Mst.init(a);
    try tree.put("fm.plyr.dev.track/3abc", cid);
    const commit = try zat.signCommit(a, .{ .did = "did:plc:artist", .rev = "3jqfcqzm3fo2j", .data = try tree.rootCid() }, &pair);
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    try blocks.append(a, .{ .cid_raw = commit.cid.raw, .data = commit.bytes });
    try tree.collectBlocks(&blocks);
    try blocks.append(a, .{ .cid_raw = cid.raw, .data = bytes });
    const car = try zat.car.writeAlloc(a, .{ .roots = &.{commit.cid}, .blocks = blocks.items });
    const signed = try verifier.verifyRecord(a, car, "fm.plyr.dev.track/3abc", "did:plc:artist", .{ .key_type = .p256, .raw = &pubkey });
    var supporters: FakeSupporters = .{};
    try evaluate(a, signed, text, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", null, supporters.port());
    try std.testing.expectEqual(@as(usize, 1), supporters.calls);
    supporters.allowed = false;
    try std.testing.expectError(error.DownloadDenied, evaluate(a, signed, text, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", null, supporters.port()));
    try evaluate(a, signed, text, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.port());
    try std.testing.expectEqual(@as(usize, 2), supporters.calls);
    supporters.unavailable = true;
    try std.testing.expectError(error.UpstreamUnavailable, evaluate(a, signed, text, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", null, supporters.port()));
    try std.testing.expectError(error.TrackChanged, evaluate(a, signed, try commit.cid.toString(a), "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.port()));
    var changed = signed;
    changed.record.?.value = value;
    fields[6].value = .{ .text = "off" };
    try std.testing.expectError(error.DownloadDenied, evaluate(a, changed, text, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.port()));
    fields[6].value = .{ .text = "supporters" };
    for ([_][]const u8{ "owner", "unknown" }) |gate| {
        fields[7].value = .{ .map = &.{.{ .key = "type", .value = .{ .text = gate } }} };
        try std.testing.expectError(error.DownloadDenied, evaluate(a, changed, text, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.port()));
    }
}
