//! Keeps `plyr_index.actor_identities` fresh for every DID that owns plyr
//! records, replacing python's `public.artists` as the source of handles,
//! display names, and avatars.
//!
//! handle: the DID document's alsoKnownAs, kept only if it resolves back to the
//! DID. display name / avatar: the actor's own `app.bsky.actor.profile/self`,
//! read from their current PDS (SSRF-pinned, no redirects). Runs as a side
//! thread of the ingester, like the blob mirror.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const pinned_tls = @import("../ingest/pinned_tls.zig");
const safe_endpoint = @import("../ingest/safe_endpoint.zig");
const store_module = @import("postgres_actor_identity_store.zig");

const log = std.log.scoped(.actor_identity);
const user_agent = "plyr.fm-zig-identity/0.1 (+https://plyr.fm)";
const avatar_cdn = "https://cdn.bsky.app/img/avatar/plain";
const max_profile_bytes = 64 * 1024;
const max_display_name_bytes = 640;

pub const Settings = struct {
    refresh_seconds: i64 = 6 * 60 * 60,
    batch_size: u32 = 16,
    idle_ms: i64 = 10_000,

    pub fn fromEnvironment() Settings {
        var settings: Settings = .{};
        if (std.c.getenv("IDENTITY_REFRESH_SECONDS")) |raw| {
            settings.refresh_seconds = std.fmt.parseInt(i64, std.mem.span(raw), 10) catch settings.refresh_seconds;
            if (settings.refresh_seconds < 60) settings.refresh_seconds = 60;
        }
        return settings;
    }
};

pub fn spawnBeside(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    const thread = std.Thread.spawn(.{}, backgroundMain, .{ io, allocator, pool }) catch |err| {
        log.err("identity refresher disabled, thread spawn failed: {}", .{err});
        return;
    };
    thread.detach();
}

fn backgroundMain(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) void {
    run(io, allocator, pool) catch |err| log.err("identity refresher stopped: {}", .{err});
}

pub fn run(io: std.Io, allocator: std.mem.Allocator, pool: *pg.Pool) !void {
    const settings = Settings.fromEnvironment();
    var did_resolver = zat.DidResolver.init(io, allocator);
    defer did_resolver.deinit();
    did_resolver.transport.user_agent = user_agent;
    var handle_resolver = zat.HandleResolver.init(io, allocator);
    defer handle_resolver.deinit();
    var pds_transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer pds_transport.deinit();
    var worker: Worker = .{
        .io = io,
        .allocator = allocator,
        .settings = settings,
        .store = .{ .pool = pool },
        .did_resolver = &did_resolver,
        .handle_resolver = &handle_resolver,
        .pds_transport = &pds_transport,
    };
    log.info("identity refresher running, refresh every {d}s", .{settings.refresh_seconds});
    while (true) {
        const refreshed = worker.batch() catch |err| blk: {
            log.err("identity batch failed: {}", .{err});
            break :blk 0;
        };
        if (refreshed == 0) try io.sleep(std.Io.Duration.fromMilliseconds(settings.idle_ms), .awake);
    }
}

const Worker = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    settings: Settings,
    store: store_module.PostgresActorIdentityStore,
    did_resolver: *zat.DidResolver,
    handle_resolver: *zat.HandleResolver,
    pds_transport: *zat.HttpTransport,

    fn batch(self: *Worker) !usize {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const now_us = try nowMicros(self.io);
        const dids = try self.store.due(arena.allocator(), now_us, self.settings.batch_size);
        for (dids) |did| {
            var item_arena = std.heap.ArenaAllocator.init(self.allocator);
            defer item_arena.deinit();
            if (self.resolve(item_arena.allocator(), did)) |identity| {
                const now = try nowMicros(self.io);
                try self.store.save(identity, now, now + self.settings.refresh_seconds * std.time.us_per_s);
            } else |err| {
                log.warn("identity refresh failed for {s}: {}", .{ did, err });
                try self.store.recordFailure(did, try nowMicros(self.io));
            }
        }
        return dids.len;
    }

    fn resolve(self: *Worker, arena: std.mem.Allocator, did_text: []const u8) !store_module.Identity {
        const did = zat.Did.parse(did_text) orelse return error.InvalidIdentity;
        var document = self.did_resolver.resolve(did) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.IdentityUnavailable,
        };
        defer document.deinit();
        if (!std.mem.eql(u8, document.id, did_text)) return error.IdentityUnavailable;

        const handle = try self.verifiedHandle(arena, did_text, document.handle());
        const pds_url = document.pdsEndpoint();
        var display_name: []const u8 = handle;
        var avatar_url: ?[]const u8 = null;
        var pds_origin: ?[]const u8 = null;
        if (pds_url) |url| {
            pds_origin = try arena.dupe(u8, url);
            // A missing or unreadable bsky profile is normal: keep the handle.
            if (self.fetchProfile(arena, did_text, url)) |profile| {
                if (profile.display_name) |name| display_name = name;
                avatar_url = profile.avatar_url;
            } else |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {},
            }
        }
        return .{
            .did = did_text,
            .handle = handle,
            .display_name = display_name,
            .avatar_url = avatar_url,
            .pds_origin = pds_origin,
        };
    }

    /// Bidirectional check per the atproto handle spec.
    fn verifiedHandle(self: *Worker, arena: std.mem.Allocator, did: []const u8, claimed: ?[]const u8) ![]const u8 {
        const raw = claimed orelse return store_module.invalid_handle;
        const lower = try std.ascii.allocLowerString(arena, raw);
        const handle = zat.Handle.parse(lower) orelse return store_module.invalid_handle;
        const resolved = self.handle_resolver.resolve(handle) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return store_module.invalid_handle,
        };
        defer self.handle_resolver.allocator.free(resolved);
        if (!std.mem.eql(u8, resolved, did)) return store_module.invalid_handle;
        return lower;
    }

    fn fetchProfile(self: *Worker, arena: std.mem.Allocator, did: []const u8, pds_url: []const u8) !Profile {
        var endpoint = try safe_endpoint.resolve(self.io, self.allocator, pds_url);
        defer endpoint.deinit(self.allocator);
        const url = try std.fmt.allocPrint(
            arena,
            "{s}/xrpc/com.atproto.repo.getRecord?repo={s}&collection=app.bsky.actor.profile&rkey=self",
            .{ endpoint.base_url, did },
        );
        try pinned_tls.prepare(self.io, self.pds_transport);
        const result = self.pds_transport.fetch(.{
            .url = url,
            .accept = "application/json",
            .max_response_size = max_profile_bytes,
            .on_redirect = .refuse,
            .resolved_connection = endpoint.connection(),
            .deadline_ns = 20 * std.time.ns_per_s,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.ProfileUnavailable,
        };
        defer self.pds_transport.allocator.free(result.body);
        if (result.status != .ok) return error.ProfileUnavailable;
        return parseProfile(arena, did, result.body);
    }
};

/// Pull displayName and the avatar blob CID out of a getRecord response.
pub const Profile = struct { display_name: ?[]const u8, avatar_url: ?[]const u8 };

pub fn parseProfile(arena: std.mem.Allocator, did: []const u8, body: []const u8) !Profile {
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{}) catch
        return error.InvalidProfile;
    if (parsed != .object) return error.InvalidProfile;
    const value = parsed.object.get("value") orelse return error.InvalidProfile;
    if (value != .object) return error.InvalidProfile;

    var display_name: ?[]const u8 = null;
    if (value.object.get("displayName")) |name| if (name == .string) {
        const trimmed = std.mem.trim(u8, name.string, " \t\r\n");
        if (trimmed.len > 0 and trimmed.len <= max_display_name_bytes and std.unicode.utf8ValidateSlice(trimmed))
            display_name = trimmed;
    };

    var avatar_url: ?[]const u8 = null;
    if (value.object.get("avatar")) |avatar| if (avatar == .object) {
        if (avatar.object.get("ref")) |ref| if (ref == .object) {
            if (ref.object.get("$link")) |link| if (link == .string) {
                const cid = zat.Cid.fromString(arena, link.string) catch null;
                if (cid != null)
                    avatar_url = try std.fmt.allocPrint(arena, "{s}/{s}/{s}@jpeg", .{ avatar_cdn, did, link.string });
            };
        };
    };
    return .{ .display_name = display_name, .avatar_url = avatar_url };
}

fn nowMicros(io: std.Io) !i64 {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse error.InvalidSystemClock;
}

test "bsky profile parsing keeps a trimmed name and a CDN avatar" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const blob = try zat.Cid.create(a, 1, 0x55, 0x12, "avatar");
    const cid = try blob.toString(a);
    const body = try std.fmt.allocPrint(a,
        \\{{"uri":"at://did:plc:x/app.bsky.actor.profile/self","value":{{"$type":"app.bsky.actor.profile",
        \\"displayName":"  zzstoatzz  ","avatar":{{"$type":"blob","ref":{{"$link":"{s}"}},"mimeType":"image/jpeg","size":1}}}}}}
    , .{cid});
    const profile = try parseProfile(a, "did:plc:x", body);
    try std.testing.expectEqualStrings("zzstoatzz", profile.display_name.?);
    const expected = try std.fmt.allocPrint(a, "{s}/did:plc:x/{s}@jpeg", .{ avatar_cdn, cid });
    try std.testing.expectEqualStrings(expected, profile.avatar_url.?);

    const bare = try parseProfile(a, "did:plc:x", "{\"value\":{\"displayName\":\"   \",\"avatar\":{\"ref\":{\"$link\":\"nope\"}}}}");
    try std.testing.expect(bare.display_name == null);
    try std.testing.expect(bare.avatar_url == null);
    try std.testing.expectError(error.InvalidProfile, parseProfile(a, "did:plc:x", "[]"));
}
