const std = @import("std");
const zat = @import("zat");
const auth = @import("../jams/auth.zig");

pub const max_bytes = 1_610_612_736;
pub const Processing = struct { recipe: []const u8, outputBudget: u64 };
pub const Request = struct {
    serviceToken: []const u8,
    uploadId: []const u8,
    recordUri: []const u8,
    sizeBytes: u64,
    contentType: []const u8,
    fileType: []const u8,
    visibility: []const u8,
    downloadPolicy: []const u8,
    processing: ?Processing = null,
};
pub const Claim = struct {
    version: u8 = 1,
    owner: []const u8,
    uploadId: []const u8,
    recordUri: []const u8,
    sizeBytes: u64,
    contentType: []const u8,
    fileType: []const u8,
    visibility: []const u8,
    downloadPolicy: []const u8,
    expiresAt: i64,
    processing: ?Processing = null,
};
pub const Settings = struct {
    base_url: []const u8,
    secret: []const u8,
    track_collection: []const u8,
    auth_config: auth.Config,
    processing_enabled: bool = false,
};

pub fn validId(id: []const u8) bool {
    if (id.len != 36 or id[14] != '4' or std.mem.indexOfScalar(u8, "89ab", id[19]) == null) return false;
    for (id, 0..) |char, index| {
        if (index == 8 or index == 13 or index == 18 or index == 23) {
            if (char != '-') return false;
        } else if (!std.ascii.isDigit(char) and !(char >= 'a' and char <= 'f')) return false;
    }
    return true;
}

pub fn recordKey(uri: []const u8, owner: []const u8, collection: []const u8) ![]const u8 {
    if (!std.mem.startsWith(u8, uri, "at://")) return error.InvalidUpload;
    var parts = std.mem.splitScalar(u8, uri[5..], '/');
    if (!std.mem.eql(u8, parts.next() orelse "", owner) or !std.mem.eql(u8, parts.next() orelse "", collection)) return error.InvalidUpload;
    const key = parts.next() orelse return error.InvalidUpload;
    if (parts.next() != null or zat.Rkey.parse(key) == null) return error.InvalidUpload;
    return key;
}

pub fn validate(request: Request, owner: []const u8, collection: []const u8) !void {
    if (!validId(request.uploadId) or request.sizeBytes == 0 or request.sizeBytes > max_bytes or
        !std.mem.eql(u8, request.visibility, "public") or !std.mem.eql(u8, request.downloadPolicy, "open")) return error.InvalidUpload;
    _ = try recordKey(request.recordUri, owner, collection);
    if (request.processing) |processing| {
        if (!std.mem.eql(u8, processing.recipe, "mp3-320k-44100-v1") or processing.outputBudget == 0 or processing.outputBudget > 2 * max_bytes - request.sizeBytes) return error.InvalidUpload;
    }
    const formats = .{ .{ "mp3", "audio/mpeg" }, .{ "wav", "audio/wav" }, .{ "flac", "audio/flac" }, .{ "ogg", "audio/ogg" }, .{ "m4a", "audio/mp4" }, .{ "aac", "audio/aac" } };
    inline for (formats) |format| {
        if (std.mem.eql(u8, request.fileType, format[0]) and std.mem.eql(u8, request.contentType, format[1])) return;
    }
    if (request.processing != null) {
        const processing_formats = .{ .{ "aif", "audio/aiff" }, .{ "aiff", "audio/aiff" }, .{ "webm", "audio/webm" } };
        inline for (processing_formats) |format| {
            if (std.mem.eql(u8, request.fileType, format[0]) and std.mem.eql(u8, request.contentType, format[1])) return;
        }
    }
    return error.InvalidUpload;
}

pub fn ownerHash(owner: []const u8) [64]u8 {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(owner, &digest, .{});
    return std.fmt.bytesToHex(digest, .lower);
}

pub fn sign(a: std.mem.Allocator, claim: Claim, secret: []const u8) ![]const u8 {
    if (secret.len < 32) return error.UploadUnavailable;
    const body = try std.json.Stringify.valueAlloc(a, claim, .{});
    const encoder = std.base64.url_safe_no_pad.Encoder;
    const payload = try a.alloc(u8, encoder.calcSize(body.len));
    _ = encoder.encode(payload, body);
    var digest: [32]u8 = undefined;
    std.crypto.auth.hmac.sha2.HmacSha256.create(&digest, payload, secret);
    var signature: [43]u8 = undefined;
    _ = encoder.encode(&signature, &digest);
    return std.fmt.allocPrint(a, "{s}.{s}", .{ payload, signature });
}

pub fn authorize(a: std.mem.Allocator, io: std.Io, settings: Settings, body: []const u8) ![]const u8 {
    const request = std.json.parseFromSliceLeaky(Request, a, body, .{}) catch return error.InvalidUpload;
    if (request.processing != null and !settings.processing_enabled) return error.UploadUnavailable;
    const owner = try auth.admitOwner(a, io, settings.auth_config, request.serviceToken);
    try requireAllowed(a, owner.actor);
    try validate(request, owner.actor, settings.track_collection);
    const expiry = (std.Io.Timestamp.now(io, .real).toSeconds() + 300) * 1000;
    const claim: Claim = .{
        .owner = owner.actor,
        .uploadId = request.uploadId,
        .recordUri = request.recordUri,
        .sizeBytes = request.sizeBytes,
        .contentType = request.contentType,
        .fileType = request.fileType,
        .visibility = request.visibility,
        .downloadPolicy = request.downloadPolicy,
        .expiresAt = expiry,
        .processing = request.processing,
    };
    const hash = ownerHash(owner.actor);
    return std.json.Stringify.valueAlloc(a, .{
        .uploadUrl = try std.fmt.allocPrint(a, "{s}/v1/uploads/{s}/{s}", .{ settings.base_url, hash, request.uploadId }),
        .capability = try sign(a, claim, settings.secret),
        .expiresAt = expiry,
    }, .{});
}

test "upload reservation binds owner collection size and public open policy" {
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    var request: Request = .{ .serviceToken = "", .uploadId = "12345678-1234-4123-8123-123456789abc", .recordUri = "at://" ++ owner ++ "/fm.plyr.dev.track/3mtest", .sizeBytes = max_bytes, .contentType = "audio/mpeg", .fileType = "mp3", .visibility = "public", .downloadPolicy = "open" };
    try validate(request, owner, "fm.plyr.dev.track");
    try std.testing.expectError(error.InvalidUpload, validate(request, "did:plc:other", "fm.plyr.dev.track"));
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.track"));
    request.sizeBytes += 1;
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.dev.track"));
    request.sizeBytes = 1;
    request.downloadPolicy = "off";
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.dev.track"));
    request.downloadPolicy = "open";
    request.visibility = "private";
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.dev.track"));
}

test "processing admits legacy inputs only with bounded source and output reservation" {
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    var request: Request = .{ .serviceToken = "", .uploadId = "12345678-1234-4123-8123-123456789abc", .recordUri = "at://" ++ owner ++ "/fm.plyr.dev.track/3mtest", .sizeBytes = max_bytes, .contentType = "audio/aiff", .fileType = "aiff", .visibility = "public", .downloadPolicy = "open" };
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.dev.track"));
    request.processing = .{ .recipe = "mp3-320k-44100-v1", .outputBudget = max_bytes };
    try validate(request, owner, "fm.plyr.dev.track");
    request.processing.?.outputBudget += 1;
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.dev.track"));
    request.processing.?.outputBudget = max_bytes;
    request.processing.?.recipe = "wav";
    try std.testing.expectError(error.InvalidUpload, validate(request, owner, "fm.plyr.dev.track"));
    request.processing.?.recipe = "mp3-320k-44100-v1";
    request.fileType = "webm";
    request.contentType = "audio/webm";
    try validate(request, owner, "fm.plyr.dev.track");
}

pub fn requireAllowed(a: std.mem.Allocator, owner: []const u8) !void {
    const policy = try std.json.parseFromSliceLeaky(struct { paused_upload_dids: []const []const u8 }, a, @embedFile("upload_contract"), .{ .ignore_unknown_fields = true });
    for (policy.paused_upload_dids) |did| if (std.mem.eql(u8, owner, did)) return error.UploadPaused;
}

test "operator upload pause remains enforced independently of record replay" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectError(error.UploadPaused, requireAllowed(arena.allocator(), "did:plc:so3ysj7gypel6w7mixdfjhkh"));
    try requireAllowed(arena.allocator(), "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa");
}

pub fn fromEnvironment(a: std.mem.Allocator, track_collection: []const u8, identity: auth.Config) !?Settings {
    const base = env("UPLOAD_BASE_URL") orelse return null;
    const secret = env("UPLOAD_CAPABILITY_SECRET") orelse return null;
    const parsed = std.Uri.parse(base) catch return error.InvalidUploadSettings;
    if (!std.mem.eql(u8, parsed.scheme, "https") or parsed.host == null or secret.len < 32 or !std.mem.endsWith(u8, track_collection, ".track")) return error.InvalidUploadSettings;
    var upload_auth = identity;
    upload_auth.method = try std.fmt.allocPrint(a, "{s}.upload.authorize", .{track_collection[0 .. track_collection.len - ".track".len]});
    return .{ .base_url = std.mem.trimEnd(u8, base, "/"), .secret = secret, .track_collection = track_collection, .auth_config = upload_auth, .processing_enabled = std.mem.eql(u8, env("UPLOAD_PROCESSING_ENABLED") orelse "", "true") };
}

pub fn authorizedInternal(header: []const u8, secret: []const u8) bool {
    if (!std.mem.startsWith(u8, header, "Bearer ") or secret.len < 32) return false;
    var given: [32]u8 = undefined;
    var expected: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(header[7..], &given, .{});
    std.crypto.hash.sha2.Sha256.hash(secret, &expected, .{});
    return std.crypto.timing_safe.eql([32]u8, given, expected);
}

fn env(key: [:0]const u8) ?[]const u8 {
    return if (std.c.getenv(key)) |value| std.mem.span(value) else null;
}
