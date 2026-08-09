//! Separately supervised current-PDS account availability reconciler.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const availability = @import("availability.zig");
const current_source = @import("current_pds_status_source.zig");
const postgres_availability = @import("postgres_availability_store.zig");
const postgres_schedule = @import("postgres_check_schedule.zig");
const repo_status = @import("repo_status.zig");

const log = std.log.scoped(.account_reconciler);

pub const Settings = struct {
    normal_interval_us: i64,
    retry_interval_us: i64,
    lease_duration_us: i64,
    seed_interval_us: i64,
    idle_sleep_ms: i64,

    pub fn validate(self: Settings) !void {
        if (self.normal_interval_us <= 0 or self.retry_interval_us <= 0 or
            self.lease_duration_us <= 0 or self.seed_interval_us <= 0 or
            self.idle_sleep_ms == 0)
            return error.InvalidReconcilerSettings;
    }
};

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    settings: Settings,
) !void {
    try settings.validate();
    var identity = zat.DidResolver.init(io, allocator);
    defer identity.deinit();
    identity.transport.user_agent = "plyr.fm-zig-account-reconciler/0.1 (+https://plyr.fm)";
    var transport = zat.HttpTransport.initWithUserAgent(
        io,
        allocator,
        "plyr.fm-zig-account-reconciler/0.1 (+https://plyr.fm)",
    );
    defer transport.deinit();
    var source_adapter: current_source.ZatCurrentPdsStatusSource = .{
        .io = io,
        .identity_resolver = &identity,
        .transport = &transport,
    };
    var schedule_adapter: postgres_schedule.PostgresCheckSchedule = .{ .pool = pool };
    var availability_adapter: postgres_availability.PostgresAvailabilityStore = .{ .pool = pool };
    var runner: Runner = .{
        .io = io,
        .allocator = allocator,
        .source = source_adapter.port(),
        .schedule = schedule_adapter.port(),
        .availability_store = availability_adapter.store(),
        .settings = settings,
    };
    try runner.loop();
}

const Runner = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    source: current_source.Source,
    schedule: @import("check_schedule.zig").Schedule,
    availability_store: availability.Store,
    settings: Settings,

    fn loop(self: *Runner) !void {
        var next_seed_us: i64 = 0;
        while (true) {
            const now_us = try nowMicros(self.io);
            if (now_us >= next_seed_us) {
                const added = try self.schedule.seed(now_us);
                if (added > 0) log.info("scheduled {d} authenticated repositories", .{added});
                next_seed_us = addSaturating(now_us, self.settings.seed_interval_us);
            }
            const claim = try self.schedule.claim(
                self.allocator,
                now_us,
                self.settings.lease_duration_us,
            ) orelse {
                try self.io.sleep(
                    std.Io.Duration.fromMilliseconds(self.settings.idle_sleep_ms),
                    .awake,
                );
                continue;
            };
            defer self.allocator.free(claim.repo_did);
            try self.process(claim);
        }
    }

    fn process(self: *Runner, claim: @import("check_schedule.zig").Claim) !void {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const check = self.source.check(arena.allocator(), claim.repo_did) catch |err| {
            const completed_at_us = try nowMicros(self.io);
            try self.schedule.complete(.{
                .claim = claim,
                .completed_at_us = completed_at_us,
                .next_attempt_at_us = addSaturating(completed_at_us, self.settings.retry_interval_us),
                .successful_response = false,
                .authoritative = false,
                .outcome = sourceErrorName(err),
            });
            log.warn("current-PDS status check failed for {s}: {s}", .{
                claim.repo_did,
                @errorName(err),
            });
            return;
        };
        defer check.deinit(arena.allocator());
        const completed_at_us = try nowMicros(self.io);
        const evidence = repo_status.toEvidence(
            check.outcome,
            claim.repo_did,
            check.pds_origin,
            claim.attempted_at_us,
        );
        if (evidence) |value| {
            _ = try self.availability_store.apply(arena.allocator(), value);
        }
        const authoritative = evidence != null;
        try self.schedule.complete(.{
            .claim = claim,
            .completed_at_us = completed_at_us,
            .next_attempt_at_us = addSaturating(
                completed_at_us,
                if (authoritative)
                    self.settings.normal_interval_us
                else
                    self.settings.retry_interval_us,
            ),
            .successful_response = true,
            .authoritative = authoritative,
            .outcome = outcomeName(check.outcome),
        });
        log.info("current-PDS status checked for {s}: {s} authoritative={}", .{
            claim.repo_did,
            outcomeName(check.outcome),
            authoritative,
        });
    }
};

fn outcomeName(outcome: repo_status.Outcome) []const u8 {
    return switch (outcome) {
        .available => "available",
        .unavailable => |reason| @tagName(reason),
        .non_authoritative => |reason| @tagName(reason),
    };
}

fn sourceErrorName(err: current_source.Error) []const u8 {
    return switch (err) {
        error.InvalidIdentity => "invalid_identity",
        error.IdentityUnavailable => "identity_unavailable",
        error.EndpointMissing => "endpoint_missing",
        error.UnsafeEndpoint => "unsafe_endpoint",
        error.UnsupportedEndpoint => "unsupported_endpoint",
        error.StatusUnavailable => "status_unavailable",
        error.RateLimited => "rate_limited",
        error.InvalidResponse => "invalid_response",
        error.IdentityMismatch => "identity_mismatch",
        error.OutOfMemory => "out_of_memory",
    };
}

fn nowMicros(io: std.Io) !i64 {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse
        error.InvalidSystemClock;
}

fn addSaturating(value: i64, delta: i64) i64 {
    return std.math.add(i64, value, delta) catch std.math.maxInt(i64);
}

test "reconciler settings and stable outcome names are explicit" {
    const settings: Settings = .{
        .normal_interval_us = 10,
        .retry_interval_us = 5,
        .lease_duration_us = 2,
        .seed_interval_us = 3,
        .idle_sleep_ms = 1,
    };
    try settings.validate();
    try std.testing.expectEqualStrings("suspended", outcomeName(.{ .unavailable = .suspended }));
    try std.testing.expectEqualStrings("throttled", outcomeName(.{ .non_authoritative = .throttled }));
    try std.testing.expectEqual(std.math.maxInt(i64), addSaturating(std.math.maxInt(i64), 1));
}

test "reconciler persists authoritative evidence before completing its lease" {
    const schedule_module = @import("check_schedule.zig");
    const Fake = struct {
        stored: bool = false,
        stored_at_us: i64 = -1,
        completed: bool = false,
        authoritative: bool = false,
        outcome: []const u8 = "",

        fn source(self: *@This()) current_source.Source {
            return .{ .context = self, .check_fn = check };
        }

        fn check(
            _: *anyopaque,
            allocator: std.mem.Allocator,
            _: []const u8,
        ) current_source.Error!current_source.Check {
            return .{
                .pds_origin = allocator.dupe(u8, "https://pds.example.com") catch
                    return error.OutOfMemory,
                .outcome = .{ .unavailable = .deactivated },
            };
        }

        fn store(self: *@This()) availability.Store {
            return .{ .context = self, .apply_fn = apply };
        }

        fn apply(
            context: *anyopaque,
            _: std.mem.Allocator,
            evidence: availability.Evidence,
        ) availability.Error!availability.ApplyResult {
            const self: *@This() = @ptrCast(@alignCast(context));
            try evidence.validate();
            self.stored = true;
            self.stored_at_us = evidence.observed_at_us;
            return .applied;
        }

        fn schedule(self: *@This()) schedule_module.Schedule {
            return .{
                .context = self,
                .seed_fn = seed,
                .hint_fn = hint,
                .claim_fn = claim,
                .complete_fn = complete,
            };
        }

        fn seed(_: *anyopaque, _: i64) schedule_module.Error!usize {
            return 0;
        }

        fn hint(_: *anyopaque, _: []const u8, _: i64) schedule_module.Error!void {}

        fn claim(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: i64,
            _: i64,
        ) schedule_module.Error!?schedule_module.Claim {
            return null;
        }

        fn complete(
            context: *anyopaque,
            completion: schedule_module.Completion,
        ) schedule_module.Error!void {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (!self.stored) return error.CorruptSchedule;
            self.completed = true;
            self.authoritative = completion.authoritative;
            self.outcome = completion.outcome;
        }
    };
    var fake: Fake = .{};
    var runner: Runner = .{
        .io = std.testing.io,
        .allocator = std.testing.allocator,
        .source = fake.source(),
        .schedule = fake.schedule(),
        .availability_store = fake.store(),
        .settings = .{
            .normal_interval_us = 1_000,
            .retry_interval_us = 100,
            .lease_duration_us = 500,
            .seed_interval_us = 1_000,
            .idle_sleep_ms = 1,
        },
    };
    try runner.process(.{
        .repo_did = "did:plc:artist",
        .attempted_at_us = 10,
        .lease_until_us = std.math.maxInt(i64),
        .hint_watermark_us = 10,
    });
    try std.testing.expect(fake.stored);
    try std.testing.expectEqual(@as(i64, 10), fake.stored_at_us);
    try std.testing.expect(fake.completed);
    try std.testing.expect(fake.authoritative);
    try std.testing.expectEqualStrings("deactivated", fake.outcome);
}
