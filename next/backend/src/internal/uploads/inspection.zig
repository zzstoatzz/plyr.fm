const std = @import("std");
const zat = @import("zat");
const logfire = @import("logfire");
const admission = @import("admission.zig");
const Repository = @import("../ingest/zat_pds_repository_source.zig").ZatPdsRepositorySource;
const Keys = @import("../ingest/zat_signing_key_resolver.zig").ZatSigningKeyResolver;
const verifier = @import("../projection/record_proof_verifier.zig");

pub const Request = struct { owner: []const u8, recordUri: []const u8, audioUrl: []const u8 };
pub const State = enum { published, absent, conflict };

pub fn inspect(a: std.mem.Allocator, io: std.Io, settings: admission.Settings, body: []const u8) !State {
    const span = logfire.span("upload.inspect", .{});
    defer span.end();
    const state = inspectTraced(span, a, io, settings, body) catch |err| {
        span.recordError(err);
        return err;
    };
    span.setAttribute("upload.state", @tagName(state));
    return state;
}

fn inspectTraced(span: logfire.Span, a: std.mem.Allocator, io: std.Io, settings: admission.Settings, body: []const u8) !State {
    const request = std.json.parseFromSliceLeaky(Request, a, body, .{}) catch return error.InvalidUpload;
    span.setAttribute("upload.owner_did", request.owner);
    span.setAttribute("upload.record_uri", request.recordUri);
    const key = try admission.recordKey(request.recordUri, request.owner, settings.track_collection);
    const hash = admission.ownerHash(request.owner);
    const prefix = try std.fmt.allocPrint(a, "{s}/media/{s}/", .{ settings.base_url, hash });
    if (!std.mem.startsWith(u8, request.audioUrl, prefix) or !admission.validId(request.audioUrl[prefix.len..])) return error.InvalidUpload;
    try admission.requireAllowed(a, request.owner);
    var resolver = zat.DidResolver.init(io, a);
    defer resolver.deinit();
    resolver.plc_url = settings.identity.plc_url;
    var transport = zat.HttpTransport.init(io, a);
    defer transport.deinit();
    var source: Repository = .{ .io = io, .identity_resolver = &resolver, .transport = &transport };
    const proof = try source.fetchRecordProof(a, request.owner, settings.track_collection, key) orelse return error.AuthorityUnavailable;
    var keys: Keys = .{ .resolver = &resolver };
    const signing = try keys.port().resolve(a, request.owner, true);
    const path = try std.fmt.allocPrint(a, "{s}/{s}", .{ settings.track_collection, key });
    return inspectProof(a, proof, path, request.owner, signing.publicKey(), request.audioUrl, settings.track_collection);
}

fn inspectProof(a: std.mem.Allocator, proof: []const u8, path: []const u8, owner: []const u8, key: zat.multicodec.PublicKey, url: []const u8, collection: []const u8) !State {
    const state = try verifier.verifyRecord(a, proof, path, owner, key);
    const record = state.record orelse return .absent;
    return if (try publicRecord(a, record.value, url, collection)) .published else .conflict;
}

const SignedFixture = struct { bytes: []const u8, key: zat.multicodec.PublicKey };

fn signedFixture(a: std.mem.Allocator, policy: []const u8, include_record: bool) !SignedFixture {
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const keypair = try zat.Keypair.fromSecretKey(.p256, @as([32]u8, @splat(23)));
    const public_key = try keypair.publicKey();
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "signed public audio" } },
        .{ .key = "artist", .value = .{ .text = "fixture artist" } },
        .{ .key = "fileType", .value = .{ .text = "mp3" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-11-12T00:00:00Z" } },
        .{ .key = "audioUrl", .value = .{ .text = "https://audio.example/media/owner/upload" } },
        .{ .key = "downloadPolicy", .value = .{ .text = policy } },
    } };
    const bytes = try zat.cbor.encodeAlloc(a, record);
    const cid = try zat.Cid.forDagCbor(a, bytes);
    var tree = zat.mst.Mst.init(a);
    try tree.put("fm.plyr.dev.track/3mtest", cid);
    const signed = try zat.signCommit(a, .{ .did = owner, .rev = "3jqfcqzm3fo2j", .data = try tree.rootCid() }, &keypair);
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    try blocks.append(a, .{ .cid_raw = signed.cid.raw, .data = signed.bytes });
    try tree.collectBlocks(&blocks);
    if (include_record) try blocks.append(a, .{ .cid_raw = cid.raw, .data = bytes });
    return .{
        .bytes = try zat.car.writeAlloc(a, .{ .roots = &.{signed.cid}, .blocks = blocks.items }),
        .key = .{ .key_type = .p256, .raw = try a.dupe(u8, &public_key) },
    };
}

test "activation accepts signed owner proof and rejects incomplete or unauthorized proofs" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const path = "fm.plyr.dev.track/3mtest";
    const url = "https://audio.example/media/owner/upload";
    const collection = "fm.plyr.dev.track";
    const proof = try signedFixture(a, "open", true);
    try std.testing.expectEqual(State.published, try inspectProof(a, proof.bytes, path, owner, proof.key, url, collection));
    try std.testing.expectEqual(State.conflict, try inspectProof(a, proof.bytes, path, owner, proof.key, "https://audio.example/other", collection));
    try std.testing.expectEqual(State.absent, try inspectProof(a, proof.bytes, "fm.plyr.dev.track/absent", owner, proof.key, url, collection));
    const restricted = try signedFixture(a, "supporters", true);
    try std.testing.expectEqual(State.conflict, try inspectProof(a, restricted.bytes, path, owner, restricted.key, url, collection));
    const incomplete = try signedFixture(a, "open", false);
    try std.testing.expectError(error.IncompleteRepo, inspectProof(a, incomplete.bytes, path, owner, incomplete.key, url, collection));
    const wrong_pair = try zat.Keypair.fromSecretKey(.p256, @as([32]u8, @splat(24)));
    const wrong_bytes = try wrong_pair.publicKey();
    try std.testing.expectError(error.SignatureVerificationFailed, inspectProof(a, proof.bytes, path, owner, .{ .key_type = .p256, .raw = &wrong_bytes }, url, collection));
    try std.testing.expectError(error.InvalidCommit, inspectProof(a, proof.bytes, path, "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", proof.key, url, collection));
}

pub fn publicRecord(a: std.mem.Allocator, value: zat.cbor.Value, url: []const u8, collection: []const u8) !bool {
    _ = @import("../atproto/track_record.zig").parse(a, value, collection) catch |err| return if (err == error.OutOfMemory) err else false;
    if (!std.mem.eql(u8, value.getString("$type") orelse "", collection) or
        !std.mem.eql(u8, value.getString("audioUrl") orelse "", url) or
        !std.mem.eql(u8, value.getString("downloadPolicy") orelse "", "open")) return false;
    // an `audioBlob` beside the URL is the original the artist keeps on their PDS; it stays public
    for ([_][]const u8{ "audioSpace", "audioFileId", "supportGate", "audioPayload", "privateAudio", "originalAudioBlob" }) |field| {
        if (value.get(field)) |present| if (present != .null) return false;
    }
    return true;
}

test "publication requires a valid public open track and exact reserved URL" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const collection = "fm.plyr.dev.track";
    const url = "https://audio.example/media/owner/upload";
    var fields = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = collection } },
        .{ .key = "title", .value = .{ .text = "track" } },
        .{ .key = "artist", .value = .{ .text = "artist" } },
        .{ .key = "fileType", .value = .{ .text = "mp3" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-11-12T00:00:00Z" } },
        .{ .key = "audioUrl", .value = .{ .text = url } },
        .{ .key = "downloadPolicy", .value = .{ .text = "open" } },
        .{ .key = "unused", .value = .null },
    };
    const value: zat.cbor.Value = .{ .map = &fields };
    try std.testing.expect(try publicRecord(a, value, url, collection));
    try std.testing.expect(!try publicRecord(a, value, "https://audio.example/other", collection));
    fields[6].value = .{ .text = "off" };
    try std.testing.expect(!try publicRecord(a, value, url, collection));
    fields[6].value = .{ .text = "open" };
    fields[7] = .{ .key = "supportGate", .value = .{ .text = "supporters" } };
    try std.testing.expect(!try publicRecord(a, value, url, collection));
    fields[7] = .{ .key = "audioSpace", .value = .{ .text = "at://did:plc:artist/space/x/supporters" } };
    try std.testing.expect(!try publicRecord(a, value, url, collection));
    const blob_cid = try zat.Cid.create(a, 1, zat.cbor.Codec.raw, zat.cbor.HashFn.sha2_256, "audio");
    var blob = [_]zat.cbor.Value.MapEntry{
        .{ .key = "$type", .value = .{ .text = "blob" } },
        .{ .key = "ref", .value = .{ .cid = blob_cid } },
        .{ .key = "mimeType", .value = .{ .text = "audio/wav" } },
        .{ .key = "size", .value = .{ .unsigned = 1024 } },
    };
    fields[7] = .{ .key = "audioBlob", .value = .{ .map = &blob } };
    try std.testing.expect(try publicRecord(a, value, url, collection));
    fields[7].value = .null;
    fields[1].value = .{ .text = "" };
    try std.testing.expect(!try publicRecord(a, value, url, collection));
}
