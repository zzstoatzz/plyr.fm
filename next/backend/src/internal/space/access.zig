//! The one access question plyr answers for a gated space: may this account
//! read (or write) it? `checkUserAccess` and supporter downloads both ask it
//! through `Decider`, so neither knows how the answer is reached.
//!
//! `Core` answers from the space authority's policy records (see policy.zig)
//! and attested payment evidence. The authority always passes; nobody else
//! writes; a space of another type, or one with no policy, stays closed.

const std = @import("std");
const managed_space = @import("managed_space.zig");
const policy = @import("policy.zig");

pub const SpaceUri = managed_space.SpaceUri;
pub const Access = managed_space.Access;

pub const Request = struct {
    space: SpaceUri,
    user: []const u8,
    access: Access = .read,
};

/// The interface the HTTP edges use. `decide` errors mean "could not tell";
/// callers fail closed.
pub const Decider = struct {
    context: *anyopaque,
    decide_fn: *const fn (*anyopaque, std.mem.Allocator, Request) anyerror!bool,

    pub fn decide(self: Decider, a: std.mem.Allocator, request: Request) !bool {
        return self.decide_fn(self.context, a, request);
    }
};

/// Where a space authority's policies come from (their public repo).
pub const PolicySource = struct {
    context: *anyopaque,
    list_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8, []const u8, []const u8) anyerror![]const policy.Policy,

    /// every policy `authority` wrote in `collection` for spaces of `space_type`
    pub fn list(self: PolicySource, a: std.mem.Allocator, authority: []const u8, collection: []const u8, space_type: []const u8) ![]const policy.Policy {
        return self.list_fn(self.context, a, authority, collection, space_type);
    }
};

pub const Core = struct {
    /// the space type plyr manages, e.g. `fm.plyr.stg.audio`
    space_type: []const u8,
    /// where policies live, e.g. `fm.plyr.policy`
    policy_collection: []const u8,
    policies: PolicySource,
    evidence: policy.Evidence,

    pub fn decider(self: *Core) Decider {
        return .{ .context = self, .decide_fn = decideErased };
    }

    fn decideErased(context: *anyopaque, a: std.mem.Allocator, request: Request) anyerror!bool {
        const self: *Core = @ptrCast(@alignCast(context));
        return self.decide(a, request);
    }

    pub fn decide(self: *Core, a: std.mem.Allocator, request: Request) !bool {
        const space = request.space;
        if (!std.mem.eql(u8, space.space_type, self.space_type)) return false;
        if (std.mem.eql(u8, request.user, space.authority)) return true;
        if (request.access == .write) return false;
        const space_uri = try std.fmt.allocPrint(a, "at://{s}/space/{s}/{s}", .{ space.authority, space.space_type, space.skey });
        const all = try self.policies.list(a, space.authority, self.policy_collection, self.space_type);
        var matching: std.ArrayList(policy.Policy) = .empty;
        for (all) |entry| {
            if (std.mem.eql(u8, entry.space, space_uri)) try matching.append(a, entry);
        }
        if (matching.items.len == 0) {
            const rule = policy.implicit(space) orelse return false;
            try matching.append(a, .{ .uri = space_uri, .space = space_uri, .rule = rule });
        }
        return policy.allows(a, matching.items, request.user, space.authority, self.evidence);
    }
};

/// `fm.plyr.stg.track` → `fm.plyr.stg.policy`: policies sit beside the tracks.
pub fn policyCollection(a: std.mem.Allocator, track_collection: []const u8) ![]const u8 {
    if (!std.mem.endsWith(u8, track_collection, ".track")) return error.InvalidTrackCollection;
    return std.fmt.allocPrint(a, "{s}.policy", .{track_collection[0 .. track_collection.len - ".track".len]});
}

// --- tests -----------------------------------------------------------------

const Fixture = struct {
    policies: []const policy.Policy = &.{},
    payments: []const policy.Payment = &.{},
    listed: usize = 0,

    fn source(self: *Fixture) PolicySource {
        return .{ .context = self, .list_fn = list };
    }
    fn evidence(self: *Fixture) policy.Evidence {
        return .{ .context = self, .payments_fn = load };
    }
    fn list(context: *anyopaque, _: std.mem.Allocator, authority: []const u8, collection: []const u8, space_type: []const u8) anyerror![]const policy.Policy {
        const self: *Fixture = @ptrCast(@alignCast(context));
        try std.testing.expectEqualStrings("did:plc:artist", authority);
        try std.testing.expectEqualStrings("fm.plyr.dev.policy", collection);
        try std.testing.expectEqualStrings("fm.plyr.dev.audio", space_type);
        self.listed += 1;
        return self.policies;
    }
    fn load(context: *anyopaque, _: std.mem.Allocator, _: []const u8, _: []const u8, _: policy.Brokers) anyerror![]const policy.Payment {
        const self: *Fixture = @ptrCast(@alignCast(context));
        return self.payments;
    }
    fn core(self: *Fixture) Core {
        return .{ .space_type = "fm.plyr.dev.audio", .policy_collection = "fm.plyr.dev.policy", .policies = self.source(), .evidence = self.evidence() };
    }
};

fn ask(core: *Core, a: std.mem.Allocator, space: []const u8, user: []const u8, access: Access) !bool {
    return core.decider().decide(a, .{ .space = SpaceUri.parse(space).?, .user = user, .access = access });
}

test "the authority always passes, writers never do, foreign types stay closed" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fixture: Fixture = .{ .policies = &.{.{ .uri = "at://did:plc:artist/fm.plyr.dev.policy/3o", .space = "at://did:plc:artist/space/fm.plyr.dev.audio/3album", .rule = .signed_in }} };
    var core = fixture.core();
    try std.testing.expect(try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/3album", "did:plc:artist", .write));
    try std.testing.expect(try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/3album", "did:plc:fan", .read));
    try std.testing.expect(!try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/3album", "did:plc:fan", .write));
    try std.testing.expect(!try ask(&core, a, "at://did:plc:artist/space/com.example.space/3album", "did:plc:fan", .read));
    try std.testing.expectEqual(@as(usize, 1), fixture.listed);
}

test "policies open only the space they name; an unnamed space stays closed" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fixture: Fixture = .{ .policies = &.{.{ .uri = "at://did:plc:artist/fm.plyr.dev.policy/3o", .space = "at://did:plc:artist/space/fm.plyr.dev.audio/3album", .rule = .signed_in }} };
    var core = fixture.core();
    try std.testing.expect(!try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/3other", "did:plc:fan", .read));
}

test "legacy gate names keep working until their artist writes a policy" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var fixture: Fixture = .{};
    var core = fixture.core();
    try std.testing.expect(try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/signed-in", "did:plc:fan", .read));
    try std.testing.expect(!try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/supporters", "did:plc:fan", .read));
    fixture.payments = &.{.{ .amount = 100, .currency = "USD" }};
    try std.testing.expect(try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/supporters", "did:plc:fan", .read));
    // an explicit policy replaces the legacy reading
    const members = [_][]const u8{"did:plc:friend"};
    fixture.policies = &.{.{ .uri = "at://did:plc:artist/fm.plyr.dev.policy/3m", .space = "at://did:plc:artist/space/fm.plyr.dev.audio/supporters", .rule = .{ .members = &members } }};
    try std.testing.expect(!try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/supporters", "did:plc:fan", .read));
    try std.testing.expect(try ask(&core, a, "at://did:plc:artist/space/fm.plyr.dev.audio/supporters", "did:plc:friend", .read));
}

test "policy collections sit beside the track collection" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqualStrings("fm.plyr.stg.policy", try policyCollection(arena.allocator(), "fm.plyr.stg.track"));
    try std.testing.expectError(error.InvalidTrackCollection, policyCollection(arena.allocator(), "fm.plyr.stg.list"));
}
