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
const sigv4 = @import("sigv4.zig");
const store_module = @import("postgres_mirror_store.zig");

const log = std.log.scoped(.blob_mirror);

/// track lexicon `audioBlob.maxSize`
pub const max_blob_bytes: usize = 104_857_600;
const user_agent = "plyr.fm-zig-blob-mirror/0.1 (+https://plyr.fm)";

pub const Settings = struct {
    /// e.g. https://<account>.r2.cloudflarestorage.com
    endpoint: []const u8,
    bucket: []const u8,
    access_key_id: []const u8,
    secret_access_key: []const u8,
    region: []const u8 = "auto",
    /// public, range-capable base for the bucket, e.g. https://audio-next.plyr.fm
    public_base_url: []const u8,
    key_prefix: []const u8 = "audio",
    batch_size: u32 = 8,
    idle_ms: i64 = 15_000,

    pub fn fromEnvironment() ?Settings {
        const endpoint = getenv("MIRROR_S3_ENDPOINT");
        const bucket = getenv("MIRROR_S3_BUCKET");
        const access_key_id = getenv("MIRROR_S3_ACCESS_KEY_ID");
        const secret_access_key = getenv("MIRROR_S3_SECRET_ACCESS_KEY");
        const public_base_url = getenv("MIRROR_PUBLIC_BASE_URL");
        if (endpoint == null or bucket == null or access_key_id == null or
            secret_access_key == null or public_base_url == null) return null;
        return .{
            .endpoint = std.mem.trimEnd(u8, endpoint.?, "/"),
            .bucket = bucket.?,
            .access_key_id = access_key_id.?,
            .secret_access_key = secret_access_key.?,
            .region = getenv("MIRROR_S3_REGION") orelse "auto",
            .public_base_url = std.mem.trimEnd(u8, public_base_url.?, "/"),
            .key_prefix = getenv("MIRROR_KEY_PREFIX") orelse "audio",
        };
    }

    pub fn validate(self: Settings) !void {
        const endpoint = std.Uri.parse(self.endpoint) catch return error.InvalidMirrorEndpoint;
        if (!std.mem.eql(u8, endpoint.scheme, "https") or endpoint.host == null)
            return error.InvalidMirrorEndpoint;
        const public = std.Uri.parse(self.public_base_url) catch return error.InvalidMirrorPublicUrl;
        if (!std.mem.eql(u8, public.scheme, "https") or public.host == null)
            return error.InvalidMirrorPublicUrl;
        if (!safeSegment(self.bucket) or !safeSegment(self.key_prefix)) return error.InvalidMirrorBucket;
    }
};

pub fn run(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) !void {
    const settings = Settings.fromEnvironment() orelse {
        log.warn("MIRROR_S3_* / MIRROR_PUBLIC_BASE_URL not set; blob mirror is idle", .{});
        while (true) try io.sleep(std.Io.Duration.fromSeconds(3600), .awake);
    };
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
    log.info("blob mirror writing to {s}/{s}, served from {s}", .{
        settings.endpoint, settings.bucket, settings.public_base_url,
    });
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
        return std.fmt.allocPrint(self.allocator, "{s}/{s}", .{ self.settings.public_base_url, key });
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
        const endpoint = try std.Uri.parse(self.settings.endpoint);
        const host = switch (endpoint.host.?) {
            .raw, .percent_encoded => |text| text,
        };
        const path = try std.fmt.allocPrint(self.allocator, "/{s}/{s}", .{ self.settings.bucket, key });
        defer self.allocator.free(path);
        const url = try std.fmt.allocPrint(self.allocator, "{s}{s}", .{ self.settings.endpoint, path });
        defer self.allocator.free(url);

        var payload_hash: [64]u8 = undefined;
        sigv4.hexSha256(&payload_hash, body);
        var amz_date: [16]u8 = undefined;
        const seconds = @divFloor(try nowMicros(self.io), std.time.us_per_s);
        sigv4.formatAmzDate(&amz_date, @intCast(seconds));
        const auth = try sigv4.authorization(self.allocator, .{
            .access_key_id = self.settings.access_key_id,
            .secret_access_key = self.settings.secret_access_key,
            .region = self.settings.region,
        }, .{
            .method = "PUT",
            .canonical_path = path,
            .headers = &.{
                .{ .name = "host", .value = host },
                .{ .name = "x-amz-content-sha256", .value = &payload_hash },
                .{ .name = "x-amz-date", .value = &amz_date },
            },
            .payload_sha256_hex = &payload_hash,
            .amz_date = &amz_date,
        });
        defer self.allocator.free(auth);
        var result = self.bucket_transport.fetch(.{
            .url = url,
            .method = .PUT,
            .payload = body,
            .content_type = media_type,
            .authorization = auth,
            .extra_headers = &.{
                .{ .name = "x-amz-content-sha256", .value = &payload_hash },
                .{ .name = "x-amz-date", .value = &amz_date },
                // content-addressed key: the bytes behind it never change
                .{ .name = "cache-control", .value = "public, max-age=31536000, immutable" },
            },
            .max_response_size = 64 * 1024,
            .on_redirect = .refuse,
            .deadline_ns = 5 * std.time.ns_per_min,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.BucketUnavailable,
        };
        defer result.deinit(self.bucket_transport.allocator);
        if (result.status != .ok) {
            log.warn("bucket PUT {s}: {d}", .{ key, @backingInt(result.status) });
            return error.BucketRejected;
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

test "mirror settings require https and plain bucket names" {
    var settings: Settings = .{
        .endpoint = "https://acct.r2.cloudflarestorage.com",
        .bucket = "audio-next",
        .access_key_id = "a",
        .secret_access_key = "b",
        .public_base_url = "https://audio-next.plyr.fm",
    };
    try settings.validate();
    settings.endpoint = "http://acct.r2.cloudflarestorage.com";
    try std.testing.expectError(error.InvalidMirrorEndpoint, settings.validate());
    settings.endpoint = "https://acct.r2.cloudflarestorage.com";
    settings.bucket = "../etc";
    try std.testing.expectError(error.InvalidMirrorBucket, settings.validate());
}
