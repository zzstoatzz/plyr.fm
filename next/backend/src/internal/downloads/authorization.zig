const std = @import("std");
const zat = @import("zat");
const auth = @import("../jams/auth.zig");
const track_record = @import("../atproto/track_record.zig");
const access = @import("../space/access.zig");
const policy = @import("../space/policy.zig");
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
    var core: access.Core = .{
        .space_type = settings.audio_space_type orelse "",
        .policy_collection = try access.policyCollection(a, settings.track_collection),
        .policies = network.policies(),
        .evidence = network.evidence(),
    };
    try evaluate(a, state, request.recordCid, at.authority(), viewer.actor, settings.track_collection, settings.audio_space_type, core.decider(), network.evidence());
    try network.checkDeadline();
    return .{ .viewer = viewer.actor, .recordUri = request.recordUri, .recordCid = request.recordCid, .expiresAt = (std.Io.Timestamp.now(io, .real).toSeconds() + 30) * 1000 };
}

/// May `viewer` download this exact record through plyr? The record must
/// still be the requested CID and ask for `supporters` downloads. Audio in a
/// space downloads for whoever may read that space; audio outside one, for
/// any broker-verified supporter of the artist. The artist always may.
pub fn evaluate(a: std.mem.Allocator, state: verifier.RecordState, cid: []const u8, artist: []const u8, viewer: []const u8, collection: []const u8, audio_space_type: ?[]const u8, spaces: access.Decider, evidence: policy.Evidence) !void {
    const record = state.record orelse return error.TrackChanged;
    const expected = zat.Cid.fromString(a, cid) catch return error.InvalidRequest;
    if (!std.mem.eql(u8, record.cid.raw, expected.raw)) return error.TrackChanged;
    const track = track_record.parse(a, record.value, collection) catch return error.DownloadDenied;
    if (!std.mem.eql(u8, track.download_policy, "supporters")) return error.DownloadDenied;
    if (track.audio_space) |space| {
        const expected_type = audio_space_type orelse return error.DownloadDenied;
        if (!std.mem.eql(u8, space.space.space_type, expected_type)) return error.DownloadDenied;
        if (!std.mem.eql(u8, space.space.authority, artist) or !std.mem.eql(u8, space.repo, artist) or
            !std.mem.eql(u8, space.collection, collection)) return error.DownloadDenied;
    }
    for ([_][]const u8{ "privateAudio", "audioPayload" }) |field| if (record.value.get(field) != null) return error.DownloadDenied;
    for (track.self_labels) |label| if (std.mem.eql(u8, label, "copyright")) return error.DownloadDenied;
    if (std.mem.eql(u8, viewer, artist)) return;
    const allowed = if (track.audio_space) |space|
        try spaces.decide(a, .{ .space = space.space, .user = viewer })
    else
        try policy.allows(a, &.{.{ .uri = "", .spaces = &.{}, .rule = .{ .supporter = null } }}, viewer, artist, evidence);
    if (!allowed) return error.DownloadDenied;
}

const FakeSupporters = struct {
    allowed: bool = true,
    calls: usize = 0,
    unavailable: bool = false,
    spaces: usize = 0,

    fn evidence(self: *FakeSupporters) policy.Evidence {
        return .{ .context = self, .payments_fn = payments };
    }
    fn decider(self: *FakeSupporters) access.Decider {
        return .{ .context = self, .decide_fn = decide };
    }
    fn payments(context: *anyopaque, _: std.mem.Allocator, viewer: []const u8, artist: []const u8, brokers: policy.Brokers) anyerror![]const policy.Payment {
        const self: *FakeSupporters = @ptrCast(@alignCast(context));
        try std.testing.expectEqualStrings("did:plc:viewer", viewer);
        try std.testing.expectEqualStrings("did:plc:artist", artist);
        try std.testing.expect(brokers == null);
        self.calls += 1;
        if (self.unavailable) return error.UpstreamUnavailable;
        return if (self.allowed) &.{.{ .amount = 100, .currency = "USD" }} else &.{};
    }
    fn decide(context: *anyopaque, _: std.mem.Allocator, request: access.Request) anyerror!bool {
        const self: *FakeSupporters = @ptrCast(@alignCast(context));
        try std.testing.expectEqualStrings("did:plc:viewer", request.user);
        try std.testing.expectEqualStrings("3album", request.space.skey);
        try std.testing.expectEqual(access.Access.read, request.access);
        self.spaces += 1;
        return self.allowed;
    }
};

fn signedTrack(a: std.mem.Allocator, value: zat.cbor.Value) !struct { state: verifier.RecordState, cid: []const u8, commit: []const u8 } {
    const bytes = try zat.cbor.encodeAlloc(a, value);
    const cid = try zat.Cid.forDagCbor(a, bytes);
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
    return .{
        .state = try verifier.verifyRecord(a, car, "fm.plyr.dev.track/3abc", "did:plc:artist", .{ .key_type = .p256, .raw = &pubkey }),
        .cid = try cid.toString(a),
        .commit = try commit.cid.toString(a),
    };
}

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
    };
    const value: zat.cbor.Value = .{ .map = &fields };
    const track = try signedTrack(a, value);
    const signed = track.state;
    const text = track.cid;
    var supporters: FakeSupporters = .{};
    try evaluate(a, signed, text, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", null, supporters.decider(), supporters.evidence());
    try std.testing.expectEqual(@as(usize, 1), supporters.calls);
    supporters.allowed = false;
    try std.testing.expectError(error.DownloadDenied, evaluate(a, signed, text, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", null, supporters.decider(), supporters.evidence()));
    try evaluate(a, signed, text, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.decider(), supporters.evidence());
    try std.testing.expectEqual(@as(usize, 2), supporters.calls);
    supporters.unavailable = true;
    try std.testing.expectError(error.UpstreamUnavailable, evaluate(a, signed, text, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", null, supporters.decider(), supporters.evidence()));
    try std.testing.expectError(error.TrackChanged, evaluate(a, signed, track.commit, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.decider(), supporters.evidence()));
    var changed = signed;
    changed.record.?.value = value;
    fields[6].value = .{ .text = "off" };
    try std.testing.expectError(error.DownloadDenied, evaluate(a, changed, text, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, supporters.decider(), supporters.evidence()));
    try std.testing.expectEqual(@as(usize, 0), supporters.spaces);
}

test "audio in a space downloads for whoever its policies let read it" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fields = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "fixture" } },
        .{ .key = "artist", .value = .{ .text = "fixture" } },
        .{ .key = "fileType", .value = .{ .text = "mp3" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-11-12T00:00:00Z" } },
        .{ .key = "audioSpace", .value = .{ .text = "at://did:plc:artist/space/fm.plyr.dev.audio/3album/did:plc:artist/fm.plyr.dev.track/3abc" } },
        .{ .key = "downloadPolicy", .value = .{ .text = "supporters" } },
    };
    const track = try signedTrack(a, .{ .map = &fields });
    var spaces: FakeSupporters = .{};
    try evaluate(a, track.state, track.cid, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", "fm.plyr.dev.audio", spaces.decider(), spaces.evidence());
    try std.testing.expectEqual(@as(usize, 1), spaces.spaces);
    try std.testing.expectEqual(@as(usize, 0), spaces.calls);
    spaces.allowed = false;
    try std.testing.expectError(error.DownloadDenied, evaluate(a, track.state, track.cid, "did:plc:artist", "did:plc:viewer", "fm.plyr.dev.track", "fm.plyr.dev.audio", spaces.decider(), spaces.evidence()));
    // a space of a type plyr does not manage never downloads
    try std.testing.expectError(error.DownloadDenied, evaluate(a, track.state, track.cid, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", "fm.plyr.dev.other", spaces.decider(), spaces.evidence()));
    try std.testing.expectError(error.DownloadDenied, evaluate(a, track.state, track.cid, "did:plc:artist", "did:plc:artist", "fm.plyr.dev.track", null, spaces.decider(), spaces.evidence()));
}
