//! Durable scheduling port for current-PDS account status reconciliation.

const std = @import("std");
const zat = @import("zat");

pub const Claim = struct {
    repo_did: []const u8,
    attempted_at_us: i64,
    lease_until_us: i64,
    hint_watermark_us: i64,

    pub fn validate(self: Claim) Error!void {
        if (zat.Did.parse(self.repo_did) == null or self.attempted_at_us < 0 or
            self.lease_until_us <= self.attempted_at_us or
            self.hint_watermark_us < 0)
            return error.InvalidClaim;
    }
};

pub const Completion = struct {
    claim: Claim,
    completed_at_us: i64,
    next_attempt_at_us: i64,
    successful_response: bool,
    authoritative: bool,
    outcome: []const u8,

    pub fn validate(self: Completion) Error!void {
        try self.claim.validate();
        if (self.completed_at_us < self.claim.attempted_at_us or
            self.next_attempt_at_us <= self.completed_at_us or
            self.outcome.len == 0 or self.outcome.len > 64 or
            (self.authoritative and !self.successful_response))
            return error.InvalidCompletion;
    }
};

pub const Schedule = struct {
    context: *anyopaque,
    seed_fn: *const fn (*anyopaque, i64) Error!usize,
    hint_fn: *const fn (*anyopaque, []const u8, i64) Error!void,
    claim_fn: *const fn (*anyopaque, std.mem.Allocator, i64, i64) Error!?Claim,
    complete_fn: *const fn (*anyopaque, Completion) Error!void,

    pub fn seed(self: Schedule, now_us: i64) Error!usize {
        if (now_us < 0) return error.InvalidTime;
        return self.seed_fn(self.context, now_us);
    }

    pub fn hint(self: Schedule, repo_did: []const u8, now_us: i64) Error!void {
        if (zat.Did.parse(repo_did) == null) return error.InvalidIdentity;
        if (now_us < 0) return error.InvalidTime;
        return self.hint_fn(self.context, repo_did, now_us);
    }

    pub fn claim(
        self: Schedule,
        allocator: std.mem.Allocator,
        now_us: i64,
        lease_duration_us: i64,
    ) Error!?Claim {
        if (now_us < 0 or lease_duration_us <= 0 or
            lease_duration_us > std.math.maxInt(i64) - now_us)
            return error.InvalidTime;
        const value = try self.claim_fn(self.context, allocator, now_us, lease_duration_us);
        if (value) |claim_value| try claim_value.validate();
        return value;
    }

    pub fn complete(self: Schedule, completion: Completion) Error!void {
        try completion.validate();
        return self.complete_fn(self.context, completion);
    }
};

pub const Error = error{
    InvalidIdentity,
    InvalidTime,
    InvalidClaim,
    InvalidCompletion,
    LostLease,
    CorruptSchedule,
    ScheduleUnavailable,
    OutOfMemory,
};

test "schedule values enforce leases and explicit completion outcomes" {
    const claim: Claim = .{
        .repo_did = "did:plc:artist",
        .attempted_at_us = 10,
        .lease_until_us = 20,
        .hint_watermark_us = 10,
    };
    try claim.validate();
    const completion: Completion = .{
        .claim = claim,
        .completed_at_us = 15,
        .next_attempt_at_us = 30,
        .successful_response = true,
        .authoritative = false,
        .outcome = "throttled",
    };
    try completion.validate();
    var impossible = completion;
    impossible.successful_response = false;
    impossible.authoritative = true;
    try std.testing.expectError(error.InvalidCompletion, impossible.validate());
}
