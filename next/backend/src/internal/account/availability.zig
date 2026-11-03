//! Canonical account visibility derived only from authoritative evidence.
//!
//! Relay account frames are deliberately not evidence: they describe the
//! relay host's view and may be caused by infrastructure desynchronization.
//! They may trigger a current-PDS check, but only a checked PDS response or
//! authenticated repository activity may construct this value.

const std = @import("std");
const zat = @import("zat");

pub const UnavailableReason = enum {
    deactivated,
    deleted,
    takendown,
    suspended,
};

pub const Source = enum {
    verified_repository,
    current_pds,
};

pub const Evidence = struct {
    repo_did: []const u8,
    available: bool,
    reason: ?UnavailableReason = null,
    source: Source,
    repository_rev: ?[]const u8 = null,
    commit_cid: ?zat.Cid = null,
    pds_origin: ?[]const u8 = null,
    observed_at_us: i64,

    pub fn validate(self: Evidence) Error!void {
        if (zat.Did.parse(self.repo_did) == null or self.observed_at_us < 0)
            return error.InvalidEvidence;
        if (self.available != (self.reason == null)) return error.InvalidEvidence;
        if (self.repository_rev) |rev| {
            if (zat.Tid.parse(rev) == null) return error.InvalidEvidence;
        }
        switch (self.source) {
            .verified_repository => {
                if (!self.available or self.repository_rev == null or
                    self.commit_cid == null or self.pds_origin != null)
                    return error.InvalidEvidence;
                const parsed = zat.Cid.fromBytes(self.commit_cid.?.raw) catch
                    return error.InvalidEvidence;
                if (parsed.codec() != zat.cbor.Codec.dag_cbor)
                    return error.InvalidEvidence;
            },
            .current_pds => {
                if (self.commit_cid != null or self.pds_origin == null)
                    return error.InvalidEvidence;
                const uri = std.Uri.parse(self.pds_origin.?) catch
                    return error.InvalidEvidence;
                if (!std.ascii.eqlIgnoreCase(uri.scheme, "https") or
                    uri.user != null or uri.password != null or uri.host == null or
                    (!uri.path.isEmpty() and !componentEquals(uri.path, "/")) or
                    uri.query != null or uri.fragment != null)
                    return error.InvalidEvidence;
            },
        }
    }
};

fn componentEquals(component: std.Uri.Component, expected: []const u8) bool {
    var buffer: [8]u8 = undefined;
    const raw = component.toRaw(&buffer) catch return false;
    return std.mem.eql(u8, raw, expected);
}

pub const ApplyResult = enum { applied, idempotent, stale };

pub const Store = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, Evidence) Error!ApplyResult,

    pub fn apply(self: Store, allocator: std.mem.Allocator, evidence: Evidence) Error!ApplyResult {
        try evidence.validate();
        return self.apply_fn(self.context, allocator, evidence);
    }
};

pub const Error = error{
    InvalidEvidence,
    EvidenceConflict,
    CorruptProjection,
    ProjectionUnavailable,
    OutOfMemory,
};

test "availability evidence excludes relay guesses and contradictory shapes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const commit = try zat.Cid.forDagCbor(arena.allocator(), "commit");
    const verified: Evidence = .{
        .repo_did = "did:plc:artist",
        .available = true,
        .source = .verified_repository,
        .repository_rev = "3jqfcqzm3fo2j",
        .commit_cid = commit,
        .observed_at_us = 1,
    };
    try verified.validate();

    const unavailable: Evidence = .{
        .repo_did = "did:plc:artist",
        .available = false,
        .reason = .deactivated,
        .source = .current_pds,
        .pds_origin = "https://pds.example.com",
        .observed_at_us = 2,
    };
    try unavailable.validate();

    var contradiction = unavailable;
    contradiction.reason = null;
    try std.testing.expectError(error.InvalidEvidence, contradiction.validate());
    var relay_shaped = unavailable;
    relay_shaped.pds_origin = null;
    try std.testing.expectError(error.InvalidEvidence, relay_shaped.validate());
}
