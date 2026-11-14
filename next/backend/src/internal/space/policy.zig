//! Space access policies.
//!
//! An artist opens a space by writing public policy records in their own repo
//! (`{namespace}.policy`). Each policy names the spaces it opens (`spaces`,
//! or the older single `space`) and one rule a reader can satisfy; a space
//! may carry any number of policies, of any kinds, and passing one is enough.
//! One policy over several spaces lets one purchase open, say, an album and
//! the single it shares a track with. What sits in the space (a track, an album's tracks,
//! a playlist) is the artist's choice: the policy only answers who may read it.
//!
//! Rules:
//!   - `#signedIn`: any signed-in account.
//!   - `#members`: the listed accounts.
//!   - `#supporter`: any broker-verified payment to the space authority.
//!   - `#purchase`: a broker-verified payment to the authority whose
//!     `entitlements` include this policy, at or above its price.
//!
//! Payments are attested.network records in the reader's repo; the proofs are
//! checked by the `Evidence` port. An unknown rule opens nothing.

const std = @import("std");
const zat = @import("zat");
const SpaceUri = @import("managed_space.zig").SpaceUri;

pub const max_members = 512;
pub const max_brokers = 16;
pub const max_spaces = 16;

pub const Rule = union(enum) {
    signed_in,
    members: []const []const u8,
    supporter: Brokers,
    purchase: Purchase,
};

/// Broker DIDs whose proofs count; null means the deployment's trusted set.
pub const Brokers = ?[]const []const u8;

pub const Purchase = struct {
    /// smallest currency unit, as attested.network records it
    amount: i64,
    currency: []const u8,
    brokers: Brokers = null,
};

pub const Policy = struct {
    /// the policy record itself; a purchase's entitlement points here
    uri: []const u8,
    /// the spaces it opens, each `at://{authority}/space/{type}/{skey}`
    spaces: []const []const u8,
    rule: Rule,
};

/// A broker-verified payment from the reader to the space authority.
pub const Payment = struct {
    amount: ?i64 = null,
    currency: ?[]const u8 = null,
    /// at-uris of the records the payment entitles the payer to
    entitlements: []const []const u8 = &.{},
};

/// Where verified payments come from. Called only when a payment rule is
/// reached, once per distinct broker set.
pub const Evidence = struct {
    context: *anyopaque,
    payments_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8, []const u8, Brokers) anyerror![]const Payment,

    pub fn payments(self: Evidence, a: std.mem.Allocator, payer: []const u8, recipient: []const u8, brokers: Brokers) ![]const Payment {
        return self.payments_fn(self.context, a, payer, recipient, brokers);
    }
};

/// The policies a legacy space carries when its authority wrote none: the
/// skey used to name the gate before policies existed.
pub fn implicit(space: SpaceUri) ?Rule {
    if (std.mem.eql(u8, space.skey, "supporters")) return .{ .supporter = null };
    if (std.mem.eql(u8, space.skey, "signed-in")) return .signed_in;
    return null;
}

/// Does `reader` pass any of `policies` for a space owned by `authority`?
/// Rules needing no evidence are tried first. An evidence failure is returned
/// only when nothing else allowed: an unreachable broker is not a denial.
pub fn allows(a: std.mem.Allocator, policies: []const Policy, reader: []const u8, authority: []const u8, evidence: Evidence) !bool {
    for (policies) |policy| switch (policy.rule) {
        .signed_in => return true,
        .members => |members| for (members) |member| {
            if (std.mem.eql(u8, member, reader)) return true;
        },
        .supporter, .purchase => {},
    };
    var failure: ?anyerror = null;
    var fetched: std.ArrayList(struct { brokers: Brokers, payments: []const Payment }) = .empty;
    for (policies) |policy| {
        const brokers: Brokers = switch (policy.rule) {
            .supporter => |brokers| brokers,
            .purchase => |purchase| purchase.brokers,
            else => continue,
        };
        var cached: ?[]const Payment = null;
        for (fetched.items) |entry| {
            if (sameBrokers(entry.brokers, brokers)) cached = entry.payments;
        }
        const payments = cached orelse evidence.payments(a, reader, authority, brokers) catch |err| {
            if (err == error.OutOfMemory or err == error.Canceled) return err;
            failure = err;
            continue;
        };
        if (cached == null) try fetched.append(a, .{ .brokers = brokers, .payments = payments });
        if (satisfied(policy, payments)) return true;
    }
    if (failure) |err| return err;
    return false;
}

fn satisfied(policy: Policy, payments: []const Payment) bool {
    switch (policy.rule) {
        .supporter => return payments.len > 0,
        .purchase => |purchase| for (payments) |payment| {
            const amount = payment.amount orelse continue;
            const currency = payment.currency orelse continue;
            if (amount < purchase.amount or !std.ascii.eqlIgnoreCase(currency, purchase.currency)) continue;
            for (payment.entitlements) |entitlement| {
                if (std.mem.eql(u8, entitlement, policy.uri)) return true;
            }
        },
        else => {},
    }
    return false;
}

fn sameBrokers(left: Brokers, right: Brokers) bool {
    const l = left orelse return right == null;
    const r = right orelse return false;
    if (l.len != r.len) return false;
    for (l, r) |x, y| if (!std.mem.eql(u8, x, y)) return false;
    return true;
}

/// One listRecords item (`{uri, value}`) as a policy, or null when it is not a
/// well-formed policy of `collection` that opens a space of `space_type`
/// owned by the record's own author.
pub fn parse(a: std.mem.Allocator, item: std.json.Value, collection: []const u8, space_type: []const u8) !?Policy {
    const uri = stringField(item, "uri") orelse return null;
    const at = zat.AtUri.parse(uri) orelse return null;
    if (!std.mem.eql(u8, at.collection() orelse return null, collection)) return null;
    if (zat.Rkey.parse(at.rkey() orelse return null) == null) return null;
    const value = (if (item == .object) item.object.get("value") else null) orelse return null;
    if (!std.mem.eql(u8, stringField(value, "$type") orelse return null, collection)) return null;
    const spaces = (try spaceList(a, value)) orelse return null;
    for (spaces) |text| {
        const space = SpaceUri.parse(text) orelse return null;
        // an artist can only open their own spaces
        if (!std.mem.eql(u8, space.authority, at.authority())) return null;
        if (!std.mem.eql(u8, space.space_type, space_type)) return null;
    }
    const rule_value = value.object.get("rule") orelse return null;
    const rule_type = stringField(rule_value, "$type") orelse return null;
    const hash = std.mem.indexOfScalar(u8, rule_type, '#') orelse return null;
    if (!std.mem.eql(u8, rule_type[0..hash], collection)) return null;
    const kind = rule_type[hash + 1 ..];
    const rule: Rule = if (std.mem.eql(u8, kind, "signedIn"))
        .signed_in
    else if (std.mem.eql(u8, kind, "members"))
        .{ .members = (try dids(a, rule_value, "members", max_members)) orelse return null }
    else if (std.mem.eql(u8, kind, "supporter"))
        .{ .supporter = try optionalDids(a, rule_value, "brokers") orelse return null }
    else if (std.mem.eql(u8, kind, "purchase")) blk: {
        const amount = intField(rule_value, "amount") orelse return null;
        const currency = stringField(rule_value, "currency") orelse return null;
        if (amount < 1 or currency.len != 3) return null;
        break :blk .{ .purchase = .{
            .amount = amount,
            .currency = currency,
            .brokers = try optionalDids(a, rule_value, "brokers") orelse return null,
        } };
    } else return null;
    return .{ .uri = uri, .spaces = spaces, .rule = rule };
}

/// `spaces` (1..max_spaces strings), else the single `space` older records
/// carry; null when neither is well formed or both are present.
fn spaceList(a: std.mem.Allocator, value: std.json.Value) !?[]const []const u8 {
    const many = value.object.get("spaces");
    const one = value.object.get("space");
    if (many != null and one != null) return null;
    if (one) |field| {
        if (field != .string) return null;
        const out = try a.alloc([]const u8, 1);
        out[0] = field.string;
        return out;
    }
    const field = many orelse return null;
    if (field != .array or field.array.items.len == 0 or field.array.items.len > max_spaces) return null;
    const out = try a.alloc([]const u8, field.array.items.len);
    for (field.array.items, out) |entry, *text| {
        if (entry != .string) return null;
        text.* = entry.string;
    }
    return out;
}

/// Does `policy` name `space`?
pub fn opens(policy: Policy, space: []const u8) bool {
    for (policy.spaces) |entry| if (std.mem.eql(u8, entry, space)) return true;
    return false;
}

/// `null` when the field is malformed; `.{null}` when absent.
fn optionalDids(a: std.mem.Allocator, value: std.json.Value, key: []const u8) !?Brokers {
    if (value.object.get(key) == null) return @as(?Brokers, @as(Brokers, null));
    const list = (try dids(a, value, key, max_brokers)) orelse return null;
    if (list.len == 0) return null;
    return @as(?Brokers, list);
}

fn dids(a: std.mem.Allocator, value: std.json.Value, key: []const u8, max: usize) !?[]const []const u8 {
    const field = value.object.get(key) orelse return null;
    if (field != .array or field.array.items.len > max) return null;
    const out = try a.alloc([]const u8, field.array.items.len);
    for (field.array.items, out) |entry, *did| {
        if (entry != .string or zat.Did.parse(entry.string) == null) return null;
        did.* = entry.string;
    }
    return out;
}

fn stringField(value: std.json.Value, key: []const u8) ?[]const u8 {
    if (value != .object) return null;
    const field = value.object.get(key) orelse return null;
    return if (field == .string) field.string else null;
}

fn intField(value: std.json.Value, key: []const u8) ?i64 {
    if (value != .object) return null;
    const field = value.object.get(key) orelse return null;
    return if (field == .integer) field.integer else null;
}

// --- tests -----------------------------------------------------------------

const FakeEvidence = struct {
    payments: []const Payment = &.{},
    fail: bool = false,
    calls: usize = 0,

    fn port(self: *FakeEvidence) Evidence {
        return .{ .context = self, .payments_fn = load };
    }

    fn load(context: *anyopaque, _: std.mem.Allocator, payer: []const u8, recipient: []const u8, _: Brokers) anyerror![]const Payment {
        const self: *FakeEvidence = @ptrCast(@alignCast(context));
        try std.testing.expectEqualStrings("did:plc:fan", payer);
        try std.testing.expectEqualStrings("did:plc:artist", recipient);
        self.calls += 1;
        if (self.fail) return error.BrokerUnavailable;
        return self.payments;
    }
};

const space_uri = "at://did:plc:artist/space/fm.plyr.dev.audio/3album";
const offer = "at://did:plc:artist/fm.plyr.dev.policy/3offer";

test "rules without evidence never touch the network" {
    var evidence: FakeEvidence = .{ .fail = true };
    const a = std.testing.allocator;
    try std.testing.expect(try allows(a, &.{.{ .uri = offer, .spaces = &.{space_uri}, .rule = .signed_in }}, "did:plc:fan", "did:plc:artist", evidence.port()));
    const members = [_][]const u8{ "did:plc:friend", "did:plc:fan" };
    try std.testing.expect(try allows(a, &.{.{ .uri = offer, .spaces = &.{space_uri}, .rule = .{ .members = &members } }}, "did:plc:fan", "did:plc:artist", evidence.port()));
    try std.testing.expectEqual(@as(usize, 0), evidence.calls);
    try std.testing.expect(!try allows(a, &.{}, "did:plc:fan", "did:plc:artist", evidence.port()));
}

test "a purchase needs an entitlement to this policy at its price" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const policies = [_]Policy{.{ .uri = offer, .spaces = &.{space_uri}, .rule = .{ .purchase = .{ .amount = 800, .currency = "USD" } } }};
    var evidence: FakeEvidence = .{ .payments = &.{
        .{ .amount = 2500, .currency = "USD", .entitlements = &.{} },
        .{ .amount = 800, .currency = "EUR", .entitlements = &.{offer} },
        .{ .amount = 799, .currency = "USD", .entitlements = &.{offer} },
        .{ .amount = 800, .currency = "USD", .entitlements = &.{"at://did:plc:artist/fm.plyr.dev.policy/3other"} },
    } };
    try std.testing.expect(!try allows(a, &policies, "did:plc:fan", "did:plc:artist", evidence.port()));
    evidence.payments = &.{.{ .amount = 1000, .currency = "usd", .entitlements = &.{offer} }};
    try std.testing.expect(try allows(a, &policies, "did:plc:fan", "did:plc:artist", evidence.port()));
}

test "a supporter rule takes any verified payment and payments load once per broker set" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const policies = [_]Policy{
        .{ .uri = offer, .spaces = &.{space_uri}, .rule = .{ .purchase = .{ .amount = 800, .currency = "USD" } } },
        .{ .uri = "at://did:plc:artist/fm.plyr.dev.policy/3sup", .spaces = &.{space_uri}, .rule = .{ .supporter = null } },
    };
    var evidence: FakeEvidence = .{ .payments = &.{.{ .amount = 100, .currency = "USD" }} };
    try std.testing.expect(try allows(a, &policies, "did:plc:fan", "did:plc:artist", evidence.port()));
    try std.testing.expectEqual(@as(usize, 1), evidence.calls);
    evidence.payments = &.{};
    try std.testing.expect(!try allows(a, &policies, "did:plc:fan", "did:plc:artist", evidence.port()));
}

test "an unreachable broker is unavailable, not a denial, unless another policy allows" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var evidence: FakeEvidence = .{ .fail = true };
    const supporter = Policy{ .uri = offer, .spaces = &.{space_uri}, .rule = .{ .supporter = null } };
    try std.testing.expectError(error.BrokerUnavailable, allows(a, &.{supporter}, "did:plc:fan", "did:plc:artist", evidence.port()));
    const members = [_][]const u8{"did:plc:fan"};
    try std.testing.expect(try allows(a, &.{ supporter, .{ .uri = offer, .spaces = &.{space_uri}, .rule = .{ .members = &members } } }, "did:plc:fan", "did:plc:artist", evidence.port()));
}

test "legacy skeys keep their old meaning" {
    try std.testing.expectEqual(Rule.signed_in, implicit(SpaceUri.parse("at://did:plc:artist/space/fm.plyr.dev.audio/signed-in").?).?);
    try std.testing.expect(implicit(SpaceUri.parse("at://did:plc:artist/space/fm.plyr.dev.audio/supporters").?).?.supporter == null);
    try std.testing.expect(implicit(SpaceUri.parse(space_uri).?) == null);
}

test "policy records parse strictly" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const cases = .{
        .{ true, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3offer\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#purchase\",\"amount\":800,\"currency\":\"USD\"}}}" },
        .{ true, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3m\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#members\",\"members\":[\"did:plc:fan\"]}}}" },
        .{ true, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3s\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#supporter\",\"brokers\":[\"did:plc:broker\"]}}}" },
        .{ true, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#signedIn\"}}}" },
        // several spaces, one purchase opens them all
        .{ true, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3both\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"spaces\":[\"" ++ space_uri ++ "\",\"at://did:plc:artist/space/fm.plyr.dev.audio/3single\"],\"subject\":\"at://did:plc:artist/fm.plyr.dev.release/3album\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#purchase\",\"amount\":800,\"currency\":\"USD\"}}}" },
        // both fields, an empty list, one space that is not the author's
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"spaces\":[\"" ++ space_uri ++ "\"],\"rule\":{\"$type\":\"fm.plyr.dev.policy#signedIn\"}}}" },
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"spaces\":[],\"rule\":{\"$type\":\"fm.plyr.dev.policy#signedIn\"}}}" },
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"spaces\":[\"" ++ space_uri ++ "\",\"at://did:plc:mallory/space/fm.plyr.dev.audio/x\"],\"rule\":{\"$type\":\"fm.plyr.dev.policy#signedIn\"}}}" },
        // someone else's space
        .{ false, "{\"uri\":\"at://did:plc:mallory/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#signedIn\"}}}" },
        // a space type plyr does not manage
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"at://did:plc:artist/space/com.example.space/x\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#signedIn\"}}}" },
        // unknown rule, wrong rule namespace, bad price, bad member, empty broker list
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#everyone\"}}}" },
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"com.example#signedIn\"}}}" },
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#purchase\",\"amount\":0,\"currency\":\"USD\"}}}" },
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#members\",\"members\":[\"fan\"]}}}" },
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.policy/3o\",\"value\":{\"$type\":\"fm.plyr.dev.policy\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.policy#supporter\",\"brokers\":[]}}}" },
        // a record of another collection
        .{ false, "{\"uri\":\"at://did:plc:artist/fm.plyr.dev.track/3o\",\"value\":{\"$type\":\"fm.plyr.dev.track\",\"space\":\"" ++ space_uri ++ "\",\"rule\":{\"$type\":\"fm.plyr.dev.track#signedIn\"}}}" },
    };
    inline for (cases) |case| {
        const item = try std.json.parseFromSliceLeaky(std.json.Value, a, case[1], .{});
        const parsed = try parse(a, item, "fm.plyr.dev.policy", "fm.plyr.dev.audio");
        try std.testing.expectEqual(case[0], parsed != null);
    }
    const item = try std.json.parseFromSliceLeaky(std.json.Value, a, cases[0][1], .{});
    const purchase = (try parse(a, item, "fm.plyr.dev.policy", "fm.plyr.dev.audio")).?;
    try std.testing.expectEqualStrings(offer, purchase.uri);
    try std.testing.expectEqual(@as(i64, 800), purchase.rule.purchase.amount);
    try std.testing.expect(purchase.rule.purchase.brokers == null);
    try std.testing.expectEqual(@as(usize, 1), purchase.spaces.len);
    const both_item = try std.json.parseFromSliceLeaky(std.json.Value, a, cases[4][1], .{});
    const both = (try parse(a, both_item, "fm.plyr.dev.policy", "fm.plyr.dev.audio")).?;
    try std.testing.expect(opens(both, space_uri));
    try std.testing.expect(opens(both, "at://did:plc:artist/space/fm.plyr.dev.audio/3single"));
    try std.testing.expect(!opens(both, "at://did:plc:artist/space/fm.plyr.dev.audio/3other"));
}
