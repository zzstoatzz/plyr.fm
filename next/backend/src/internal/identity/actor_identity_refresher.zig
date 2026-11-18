//! Keeps `plyr_index.actor_identities` fresh for every DID that owns plyr
//! records, replacing python's `public.artists` as the source of handles,
//! display names, and avatars.
//!
//! Primary source: typeahead (`app.bsky.actor.getProfiles`, 25 actors a call),
//! which already follows the firehose for profile and identity events and
//! verifies handles bidirectionally. Calls are paced under its 60/min limit.
//!
//! Fallback, per DID typeahead does not return: the DID document's
//! alsoKnownAs, kept only if it resolves back to the DID, plus the actor's own
//! `app.bsky.actor.profile/self` read from their current PDS (SSRF-pinned, no
//! redirects). Runs as a side thread of the ingester, like the blob mirror.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const pinned_tls = @import("../net/pinned_tls.zig");
const safe_endpoint = @import("../net/safe_endpoint.zig");
const store_module = @import("postgres_actor_identity_store.zig");

const log = std.log.scoped(.actor_identity);
const user_agent = "plyr.fm-zig-identity/0.1 (+https://plyr.fm)";
const avatar_cdn = "https://cdn.bsky.app/img/avatar/plain";
const max_profile_bytes = 64 * 1024;
const max_display_name_bytes = 640;

pub const Settings = struct {
    refresh_seconds: i64 = 6 * 60 * 60,
    /// typeahead's getProfiles cap
    batch_size: u32 = 25,
    idle_ms: i64 = 10_000,
    /// empty disables typeahead (PDS fallback only)
    typeahead_url: []const u8 = "https://typeahead.waow.tech",
    /// keeps one ingester under typeahead's 60 requests/min per IP
    typeahead_spacing_ms: i64 = 1_100,

    pub fn fromEnvironment() Settings {
        var settings: Settings = .{};
        if (std.c.getenv("IDENTITY_TYPEAHEAD_URL")) |raw|
            settings.typeahead_url = std.mem.trimEnd(u8, std.mem.span(raw), "/");
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
    var typeahead_transport = zat.HttpTransport.initWithUserAgent(io, allocator, user_agent);
    defer typeahead_transport.deinit();
    var worker: Worker = .{
        .io = io,
        .allocator = allocator,
        .settings = settings,
        .store = .{ .pool = pool },
        .did_resolver = &did_resolver,
        .handle_resolver = &handle_resolver,
        .pds_transport = &pds_transport,
        .typeahead_transport = &typeahead_transport,
    };
    log.info("identity refresher running, refresh every {d}s, typeahead {s}", .{
        settings.refresh_seconds,
        if (settings.typeahead_url.len == 0) "off" else settings.typeahead_url,
    });
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
    typeahead_transport: *zat.HttpTransport,

    fn batch(self: *Worker) !usize {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const now_us = try nowMicros(self.io);
        const dids = try self.store.due(arena.allocator(), now_us, self.settings.batch_size);
        if (dids.len == 0) return 0;

        const found = self.fromTypeahead(arena.allocator(), dids) catch |err| blk: {
            log.warn("typeahead batch failed, using PDS fallback: {}", .{err});
            break :blk &.{};
        };
        const next_us = now_us + self.settings.refresh_seconds * std.time.us_per_s;
        for (found) |identity| try self.store.save(identity, now_us, next_us);

        for (dids) |did| {
            if (contains(found, did)) continue;
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

    /// One getProfiles call for the whole batch, paced for typeahead's limit.
    fn fromTypeahead(self: *Worker, arena: std.mem.Allocator, dids: []const []const u8) ![]store_module.Identity {
        if (self.settings.typeahead_url.len == 0) return &.{};
        var url: std.ArrayList(u8) = .empty;
        try url.print(arena, "{s}/xrpc/app.bsky.actor.getProfiles?", .{self.settings.typeahead_url});
        for (dids, 0..) |did, i| try url.print(arena, "{s}actors={s}", .{ if (i == 0) "" else "&", did });
        defer self.io.sleep(std.Io.Duration.fromMilliseconds(self.settings.typeahead_spacing_ms), .awake) catch {};
        const result = self.typeahead_transport.fetch(.{
            .url = url.items,
            .accept = "application/json",
            .max_response_size = 512 * 1024,
            .on_redirect = .refuse,
            .deadline_ns = 20 * std.time.ns_per_s,
        }) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.TypeaheadUnavailable,
        };
        defer self.typeahead_transport.allocator.free(result.body);
        if (result.status != .ok) return error.TypeaheadUnavailable;
        return parseTypeaheadProfiles(arena, dids, result.body);
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

fn contains(found: []const store_module.Identity, did: []const u8) bool {
    for (found) |identity| if (std.mem.eql(u8, identity.did, did)) return true;
    return false;
}

/// Keep only profiles for DIDs we asked about, with a syntactically valid
/// handle (typeahead verifies handles; `handle.invalid` passes through).
pub fn parseTypeaheadProfiles(
    arena: std.mem.Allocator,
    asked: []const []const u8,
    body: []const u8,
) ![]store_module.Identity {
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{}) catch
        return error.InvalidTypeaheadResponse;
    if (parsed != .object) return error.InvalidTypeaheadResponse;
    const profiles = parsed.object.get("profiles") orelse return error.InvalidTypeaheadResponse;
    if (profiles != .array) return error.InvalidTypeaheadResponse;
    var out: std.ArrayList(store_module.Identity) = .empty;
    for (profiles.array.items) |item| {
        if (item != .object) continue;
        const did = stringField(item, "did") orelse continue;
        var wanted: ?[]const u8 = null;
        for (asked) |candidate| if (std.mem.eql(u8, candidate, did)) {
            wanted = candidate;
        };
        if (wanted == null or contains(out.items, did)) continue;
        const raw_handle = stringField(item, "handle") orelse continue;
        const handle = try std.ascii.allocLowerString(arena, raw_handle);
        if (!std.mem.eql(u8, handle, store_module.invalid_handle) and zat.Handle.parse(handle) == null) continue;
        var display_name: []const u8 = handle;
        if (stringField(item, "displayName")) |name| {
            const trimmed = std.mem.trim(u8, name, " \t\r\n");
            if (trimmed.len > 0 and trimmed.len <= max_display_name_bytes and std.unicode.utf8ValidateSlice(trimmed))
                display_name = trimmed;
        }
        var avatar_url: ?[]const u8 = null;
        if (stringField(item, "avatar")) |avatar| {
            if (std.mem.startsWith(u8, avatar, "https://") and avatar.len <= 2048) avatar_url = avatar;
        }
        try out.append(arena, .{
            .did = wanted.?,
            .handle = handle,
            .display_name = display_name,
            .avatar_url = avatar_url,
            .pds_origin = null,
        });
    }
    return out.toOwnedSlice(arena);
}

fn stringField(value: std.json.Value, name: []const u8) ?[]const u8 {
    const field = value.object.get(name) orelse return null;
    return if (field == .string) field.string else null;
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

test "typeahead profiles map to identities for asked DIDs only" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const asked = [_][]const u8{ "did:plc:one", "did:plc:two", "did:plc:three" };
    const body =
        \\{"profiles":[
        \\ {"did":"did:plc:one","handle":"One.Example","displayName":" Uno ","avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:one/x@jpeg"},
        \\ {"did":"did:plc:two","handle":"handle.invalid","avatar":"http://insecure.example/a.jpg"},
        \\ {"did":"did:plc:stranger","handle":"stranger.example"},
        \\ {"did":"did:plc:three","handle":"not a handle"}
        \\]}
    ;
    const found = try parseTypeaheadProfiles(a, &asked, body);
    try std.testing.expectEqual(@as(usize, 2), found.len);
    try std.testing.expectEqualStrings("one.example", found[0].handle);
    try std.testing.expectEqualStrings("Uno", found[0].display_name);
    try std.testing.expect(found[0].avatar_url != null);
    try std.testing.expectEqualStrings("handle.invalid", found[1].handle);
    try std.testing.expectEqualStrings("handle.invalid", found[1].display_name);
    try std.testing.expect(found[1].avatar_url == null);
    try std.testing.expect(contains(found, "did:plc:two"));
    try std.testing.expect(!contains(found, "did:plc:three"));
    try std.testing.expectError(error.InvalidTypeaheadResponse, parseTypeaheadProfiles(a, &asked, "{}"));
}
