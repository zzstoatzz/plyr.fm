//! Blob mirror worker.
//!
//! The read-only appview never holds audio, but a PDS `getBlob` is a poor
//! delivery endpoint (no Range, so no seeking). This worker copies each track
//! record's audio blob from the owner's current PDS into an S3-compatible
//! bucket (R2), only after the bytes hash to the record's blob CID, and records
//! the object URL as a `verified_blob_cid` delivery origin. Playback then
//! prefers that URL, and anyone can re-check it against the signed record.
//!
//! Unconfigured, the worker idles instead of crash-looping so the process
//! group can be deployed before the bucket credentials exist.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const pinned_tls = @import("../ingest/pinned_tls.zig");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");
const store_module = @import("postgres_mirror_store.zig");

const log = std.log.scoped(.blob_mirror);

/// track lexicon `audioBlob.maxSize`
pub const max_blob_bytes: usize = 104_857_600;
const user_agent = "plyr.fm-zig-blob-mirror/0.1 (+https://plyr.fm)";

pub const Settings = struct {
    /// the audio worker's origin, e.g. https://plyr-next-audio.<sub>.workers.dev;
    /// uploads PUT here and objects are served from here
    base_url: []const u8,
    /// bearer secret shared with the worker (`UPLOAD_TOKEN`)
    upload_token: []const u8,
    key_prefix: []const u8 = "audio",
    batch_size: u32 = 8,
    idle_ms: i64 = 15_000,

    pub fn fromEnvironment() ?Settings {
        const base_url = getenv("MIRROR_BASE_URL") orelse return null;
        const upload_token = getenv("MIRROR_UPLOAD_TOKEN") orelse return null;
        return .{
            .base_url = std.mem.trimEnd(u8, base_url, "/"),
            .upload_token = upload_token,
            .key_prefix = getenv("MIRROR_KEY_PREFIX") orelse "audio",
        };
    }

    pub fn validate(self: Settings) !void {
        const base = std.Uri.parse(self.base_url) catch return error.InvalidMirrorBaseUrl;
        if (!std.mem.eql(u8, base.scheme, "https") or base.host == null)
            return error.InvalidMirrorBaseUrl;
        if (self.upload_token.len < 32) return error.InvalidMirrorUploadToken;
        if (!safeSegment(self.key_prefix)) return error.InvalidMirrorPrefix;
    }
};

pub fn run(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) !void {
    const settings = Settings.fromEnvironment() orelse {
        log.warn("MIRROR_BASE_URL / MIRROR_UPLOAD_TOKEN not set; blob mirror is idle", .{});
        while (true) try io.sleep(std.Io.Duration.fromSeconds(3600), .awake);
    };
    try runWith(io, allocator, pool, settings);
}

/// Runs the mirror on a detached thread beside another worker (the ingester),
/// so it needs no machine of its own. Unconfigured or invalid settings leave
/// the host worker untouched.
pub fn spawnBeside(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    const settings = Settings.fromEnvironment() orelse {
        log.info("MIRROR_BASE_URL / MIRROR_UPLOAD_TOKEN not set; blob mirror disabled", .{});
        return;
    };
    settings.validate() catch |err| {
        log.err("blob mirror disabled, invalid settings: {}", .{err});
        return;
    };
    const thread = std.Thread.spawn(.{}, backgroundMain, .{ io, allocator, pool, settings }) catch |err| {
        log.err("blob mirror disabled, thread spawn failed: {}", .{err});
        return;
    };
    thread.detach();
}

fn backgroundMain(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, settings: Settings) void {
    runWith(io, allocator, pool, settings) catch |err| log.err("blob mirror stopped: {}", .{err});
}

fn runWith(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool, settings: Settings) !void {
    try settings.validate();

    var identity = zat.DidResolver.init(io, allocator);
    defer identity.deinit();
    identity.transport.user_agent = user_agent;
    var pds_transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer pds_transport.deinit();
    var bucket_transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer bucket_transport.deinit();

    var worker: Worker = .{
        .io = io,
        .allocator = allocator,
        .settings = settings,
        .store = .{ .pool = pool },
        .identity = &identity,
        .pds_transport = &pds_transport,
        .bucket_transport = &bucket_transport,
    };
    log.info("blob mirror writing to {s}/{s}", .{ settings.base_url, settings.key_prefix });
    while (true) {
        const copied = worker.batch() catch |err| blk: {
            log.err("mirror batch failed: {}", .{err});
            break :blk 0;
        };
        if (copied == 0) try io.sleep(std.Io.Duration.fromMilliseconds(settings.idle_ms), .awake);
    }
}

const Worker = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    settings: Settings,
    store: store_module.PostgresMirrorStore,
    identity: *zat.DidResolver,
    pds_transport: *zat.HttpTransport,
    bucket_transport: *zat.HttpTransport,

    /// Returns how many candidates were attempted.
    fn batch(self: *Worker) !usize {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const now_us = try nowMicros(self.io);
        const items = try self.store.candidates(arena.allocator(), now_us, self.settings.batch_size);
        for (items) |candidate| {
            if (self.mirror(candidate)) |origin_url| {
                defer self.allocator.free(origin_url);
                const current = try self.store.recordMirrored(candidate, origin_url, try nowMicros(self.io));
                if (current)
                    log.info("mirrored {s} ({s})", .{ candidate.record_uri, candidate.blob_cid })
                else
                    log.info("record moved on during mirror: {s}", .{candidate.record_uri});
            } else |err| {
                log.warn("mirror failed for {s}: {}", .{ candidate.record_uri, err });
                try self.store.recordFailure(candidate, @errorName(err), try nowMicros(self.io));
            }
        }
        return items.len;
    }

    /// Fetch, verify, upload. Returns the public URL (owned by self.allocator).
    fn mirror(self: *Worker, candidate: store_module.Candidate) ![]u8 {
        if (candidate.byte_length) |size| if (size < 0 or size > max_blob_bytes) return error.BlobTooLarge;
        const blob = try self.fetchBlob(candidate);
        defer self.pds_transport.allocator.free(blob);
        try verifyBlob(self.allocator, candidate.blob_cid, blob);
        const key = try std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ self.settings.key_prefix, candidate.blob_cid });
        defer self.allocator.free(key);
        try self.put(key, candidate.media_type, blob);
        return std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ self.settings.base_url, key });
    }

    fn fetchBlob(self: *Worker, candidate: store_module.Candidate) ![]u8 {
        const did = zat.Did.parse(candidate.owner_did) orelse return error.InvalidIdentity;
        var document = self.identity.resolve(did) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.IdentityUnavailable,
        };
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, candidate.owner_did)) return error.IdentityUnavailable;
        const pds_url = document.pdsEndpoint() orelse return error.EndpointMissing;
        var endpoint = try safe_endpoint.resolve(self.io, self.allocator, pds_url);
        defer endpoint.deinit(self.allocator);
        const url = try std.fmt.allocPrint(
            self.allocator,
            "{s}/xrpc/com.atproto.sync.getBlob?did={s}&cid={s}",
            .{ endpoint.base_url, candidate.owner_did, candidate.blob_cid },
        );
        defer self.allocator.free(url);
        try pinned_tls.prepare(self.io, self.pds_transport);
        const result = self.pds_transport.fetch(.{
            .url = url,
            .accept = "*/*",
            .accept_encoding = "identity",
            .max_response_size = max_blob_bytes,
            .on_redirect = .refuse,
            .resolved_connection = endpoint.connection(),
            .deadline_ns = 5 * std.time.ns_per_min,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.BlobUnavailable,
        };
        if (result.status != .ok) {
            self.pds_transport.allocator.free(result.body);
            return error.BlobUnavailable;
        }
        return result.body;
    }

    fn put(self: *Worker, key: []const u8, media_type: []const u8, body: []const u8) !void {
        const url = try std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ self.settings.base_url, key });
        defer self.allocator.free(url);
        const auth = try std.fmt.allocPrint(self.allocator, "Bearer {s}", .{self.settings.upload_token});
        defer self.allocator.free(auth);
        var digest: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(body, &digest, .{});
        const digest_hex = std.fmt.bytesToHex(digest, .lower);
        var result = self.bucket_transport.fetch(.{
            .url = url,
            .method = .PUT,
            .payload = body,
            .content_type = media_type,
            .authorization = auth,
            // the worker hands this to R2, which rejects the write on mismatch
            .extra_headers = &.{.{ .name = "x-content-sha256", .value = &digest_hex }},
            .max_response_size = 64 * 1024,
            .on_redirect = .refuse,
            .deadline_ns = 5 * std.time.ns_per_min,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.BucketUnavailable,
        };
        defer result.deinit(self.bucket_transport.allocator);
        switch (result.status) {
            .ok, .created, .no_content => {},
            else => {
                log.warn("bucket PUT {s}: {d}", .{ key, @backingInt(result.status) });
                return error.BucketRejected;
            },
        }
    }
};

/// The bytes must hash to the record's blob CID (raw codec, sha2-256).
pub fn verifyBlob(allocator: std.mem.Allocator, cid_text: []const u8, bytes: []const u8) !void {
    const cid = zat.Cid.fromString(allocator, cid_text) catch return error.InvalidBlobCid;
    defer allocator.free(cid.raw);
    if (cid.version() != 1 or cid.codec() != 0x55 or cid.hashFn() != 0x12) return error.UnsupportedBlobCid;
    const expected = cid.digest() orelse return error.InvalidBlobCid;
    var actual: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &actual, .{});
    if (!std.mem.eql(u8, expected, &actual)) return error.BlobDigestMismatch;
}

fn safeSegment(value: []const u8) bool {
    if (value.len == 0 or value.len > 63) return false;
    for (value) |c| switch (c) {
        'a'...'z', '0'...'9', '-', '_', '.' => {},
        else => return false,
    };
    return true;
}

fn nowMicros(io: std.Io) !i64 {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse error.InvalidSystemClock;
}

fn getenv(name: [*:0]const u8) ?[]const u8 {
    const value = std.c.getenv(name) orelse return null;
    return std.mem.span(value);
}

test "blob bytes must match the record's raw sha256 CID" {
    const allocator = std.testing.allocator;
    const bytes = "plyr.fm blob mirror";
    const cid = try zat.Cid.create(allocator, 1, 0x55, 0x12, bytes);
    defer allocator.free(cid.raw);
    const text = try cid.toString(allocator);
    defer allocator.free(text);
    try verifyBlob(allocator, text, bytes);
    try std.testing.expectError(error.BlobDigestMismatch, verifyBlob(allocator, text, "tampered"));
    const dag = try zat.Cid.forDagCbor(allocator, bytes);
    defer allocator.free(dag.raw);
    const dag_text = try dag.toString(allocator);
    defer allocator.free(dag_text);
    try std.testing.expectError(error.UnsupportedBlobCid, verifyBlob(allocator, dag_text, bytes));
}

test "mirror settings require https, a real token, and a plain prefix" {
    var settings: Settings = .{
        .base_url = "https://plyr-next-audio.example.workers.dev",
        .upload_token = "0123456789abcdef0123456789abcdef",
    };
    try settings.validate();
    settings.base_url = "http://plyr-next-audio.example.workers.dev";
    try std.testing.expectError(error.InvalidMirrorBaseUrl, settings.validate());
    settings.base_url = "https://plyr-next-audio.example.workers.dev";
    settings.upload_token = "short";
    try std.testing.expectError(error.InvalidMirrorUploadToken, settings.validate());
    settings.upload_token = "0123456789abcdef0123456789abcdef";
    settings.key_prefix = "../etc";
    try std.testing.expectError(error.InvalidMirrorPrefix, settings.validate());
}
