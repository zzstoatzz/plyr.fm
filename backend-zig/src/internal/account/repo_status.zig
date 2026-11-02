//! Semantic boundary for `com.atproto.sync.getRepoStatus`.
//!
//! The response comes from the DID document's current PDS, not from a relay.
//! Even there, infrastructure statuses do not prove account-level absence and
//! therefore produce no canonical availability change.

const std = @import("std");
const zat = @import("zat");
const availability = @import("availability.zig");

pub const NonAuthoritativeReason = enum {
    desynchronized,
    throttled,
    missing_status,
    unknown_status,
};

pub const Outcome = union(enum) {
    available: struct { repository_rev: ?[]const u8 },
    unavailable: availability.UnavailableReason,
    non_authoritative: NonAuthoritativeReason,
};

pub const Error = error{
    InvalidResponse,
    IdentityMismatch,
    OutOfMemory,
};

pub fn parse(
    allocator: std.mem.Allocator,
    expected_did: []const u8,
    body: []const u8,
) Error!Outcome {
    if (zat.Did.parse(expected_did) == null) return error.IdentityMismatch;
    const Response = struct {
        did: []const u8,
        active: bool,
        status: ?[]const u8 = null,
        rev: ?[]const u8 = null,
    };
    const response = std.json.parseFromSliceLeaky(Response, allocator, body, .{
        .ignore_unknown_fields = true,
    }) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidResponse,
    };
    if (!std.mem.eql(u8, response.did, expected_did)) return error.IdentityMismatch;
    if (response.rev) |rev| {
        if (zat.Tid.parse(rev) == null) return error.InvalidResponse;
    }
    if (response.active) {
        if (response.status != null) return error.InvalidResponse;
        return .{ .available = .{ .repository_rev = response.rev } };
    }
    if (response.rev != null) return error.InvalidResponse;
    const status = response.status orelse
        return .{ .non_authoritative = .missing_status };
    if (std.mem.eql(u8, status, "deactivated")) return .{ .unavailable = .deactivated };
    if (std.mem.eql(u8, status, "deleted")) return .{ .unavailable = .deleted };
    if (std.mem.eql(u8, status, "takendown")) return .{ .unavailable = .takendown };
    if (std.mem.eql(u8, status, "suspended")) return .{ .unavailable = .suspended };
    if (std.mem.eql(u8, status, "desynchronized"))
        return .{ .non_authoritative = .desynchronized };
    if (std.mem.eql(u8, status, "throttled"))
        return .{ .non_authoritative = .throttled };
    return .{ .non_authoritative = .unknown_status };
}

/// Convert only an authoritative current-PDS answer into persistent evidence.
/// A null result is an intentional no-op, not an unavailable account.
pub fn toEvidence(
    outcome: Outcome,
    repo_did: []const u8,
    pds_origin: []const u8,
    observed_at_us: i64,
) ?availability.Evidence {
    return switch (outcome) {
        .available => |value| .{
            .repo_did = repo_did,
            .available = true,
            .source = .current_pds,
            .repository_rev = value.repository_rev,
            .pds_origin = pds_origin,
            .observed_at_us = observed_at_us,
        },
        .unavailable => |reason| .{
            .repo_did = repo_did,
            .available = false,
            .reason = reason,
            .source = .current_pds,
            .pds_origin = pds_origin,
            .observed_at_us = observed_at_us,
        },
        .non_authoritative => null,
    };
}

test "repo status distinguishes account absence from infrastructure trouble" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const did = "did:plc:artist";
    const active = try parse(a, did,
        \\{"did":"did:plc:artist","active":true,"rev":"3jqfcqzm3fo2j"}
    );
    try std.testing.expect(active == .available);
    try std.testing.expectEqualStrings("3jqfcqzm3fo2j", active.available.repository_rev.?);

    const deleted = try parse(a, did,
        \\{"did":"did:plc:artist","active":false,"status":"deleted"}
    );
    try std.testing.expectEqual(availability.UnavailableReason.deleted, deleted.unavailable);

    const throttled = try parse(a, did,
        \\{"did":"did:plc:artist","active":false,"status":"throttled"}
    );
    try std.testing.expectEqual(NonAuthoritativeReason.throttled, throttled.non_authoritative);
    try std.testing.expect(toEvidence(throttled, did, "https://pds.example.com", 3) == null);
    const evidence = toEvidence(deleted, did, "https://pds.example.com", 4).?;
    try evidence.validate();
    try std.testing.expect(!evidence.available);
    const future = try parse(a, did,
        \\{"did":"did:plc:artist","active":false,"status":"new-host-state"}
    );
    try std.testing.expectEqual(NonAuthoritativeReason.unknown_status, future.non_authoritative);
}

test "repo status rejects mismatched identities and contradictory responses" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try std.testing.expectError(error.IdentityMismatch, parse(a, "did:plc:artist",
        \\{"did":"did:plc:other","active":true}
    ));
    try std.testing.expectError(error.InvalidResponse, parse(a, "did:plc:artist",
        \\{"did":"did:plc:artist","active":true,"status":"deleted"}
    ));
    try std.testing.expectError(error.InvalidResponse, parse(a, "did:plc:artist",
        \\{"did":"did:plc:artist","active":false,"status":"deleted","rev":"3jqfcqzm3fo2j"}
    ));
}
