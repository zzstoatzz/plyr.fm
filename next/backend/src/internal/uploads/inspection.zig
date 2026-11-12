const std = @import("std");
const zat = @import("zat");
const admission = @import("admission.zig");
const Repository = @import("../ingest/zat_pds_repository_source.zig").ZatPdsRepositorySource;
const Keys = @import("../ingest/zat_signing_key_resolver.zig").ZatSigningKeyResolver;
const verifier = @import("../projection/record_proof_verifier.zig");

pub const Request = struct { owner: []const u8, recordUri: []const u8, audioUrl: []const u8 };
pub const State = enum { published, absent, conflict };

pub fn inspect(a: std.mem.Allocator, io: std.Io, settings: admission.Settings, body: []const u8) !State {
    const request = std.json.parseFromSliceLeaky(Request, a, body, .{}) catch return error.InvalidUpload;
    const key = try admission.recordKey(request.recordUri, request.owner, settings.track_collection);
    const hash = admission.ownerHash(request.owner);
    const prefix = try std.fmt.allocPrint(a, "{s}/media/{s}/", .{ settings.base_url, hash });
    if (!std.mem.startsWith(u8, request.audioUrl, prefix) or !admission.validId(request.audioUrl[prefix.len..])) return error.InvalidUpload;
    try admission.requireAllowed(a, request.owner);
    var resolver = zat.DidResolver.init(io, a);
    defer resolver.deinit();
    resolver.plc_url = settings.auth_config.plc_url;
    var transport = zat.HttpTransport.init(io, a);
    defer transport.deinit();
    var source: Repository = .{ .io = io, .identity_resolver = &resolver, .transport = &transport };
    const proof = try source.fetchRecordProof(a, request.owner, settings.track_collection, key) orelse return error.AuthorityUnavailable;
    var keys: Keys = .{ .resolver = &resolver };
    const signing = try keys.port().resolve(a, request.owner, true);
    const path = try std.fmt.allocPrint(a, "{s}/{s}", .{ settings.track_collection, key });
    const state = try verifier.verifyRecord(a, proof, path, request.owner, signing.publicKey());
    const record = state.record orelse return .absent;
    return if (try publicRecord(a, record.value, request.audioUrl, settings.track_collection)) .published else .conflict;
}

pub fn publicRecord(a: std.mem.Allocator, value: zat.cbor.Value, url: []const u8, collection: []const u8) !bool {
    _ = @import("../atproto/track_record.zig").parse(a, value, collection) catch |err| return if (err == error.OutOfMemory) err else false;
    if (!std.mem.eql(u8, value.getString("$type") orelse "", collection) or
        !std.mem.eql(u8, value.getString("audioUrl") orelse "", url) or
        !std.mem.eql(u8, value.getString("downloadPolicy") orelse "", "open")) return false;
    for ([_][]const u8{ "audioBlob", "audioSpace", "audioFileId", "supportGate", "audioPayload", "privateAudio", "originalAudioBlob" }) |field| {
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
    fields[7].value = .null;
    fields[1].value = .{ .text = "" };
    try std.testing.expect(!try publicRecord(a, value, url, collection));
}
