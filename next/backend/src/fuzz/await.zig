//! `/v1/records/await` polls the index on a schedule. Simulated against a
//! clock, with random query latency and a random moment the record settles,
//! the schedule must bound the queries one wait costs, never sleep past the
//! deadline, and notice a settled record within one capped interval.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const await_record = @import("../internal/application/await_record.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "await.schedule", schedule },
    });
}

fn schedule(_: void, case: *hegel.TestCase) !void {
    const timeout = try case.int(u32, 0, await_record.max_timeout_ms);
    const max_latency = try gen.pick(case, u32, &.{ 0, 1, 20, 300 });
    const settles_at: ?u64 = if (try case.boolean()) try case.int(u64, 0, timeout + 1_000) else null;
    case.note("timeout {d}, latency up to {d}, settles at {?d}", .{ timeout, max_latency, settles_at });

    var now: u64 = 0;
    var checks: u32 = 0;
    var attempt: u32 = 0;
    var last_check: u64 = 0;
    const seen: ?u64 = while (true) : (attempt += 1) {
        last_check = now;
        checks += 1;
        if (settles_at) |at| if (now >= at) break now;
        now += try case.int(u32, 0, max_latency);
        const delay = await_record.pollDelay(attempt, now, timeout) orelse break null;
        if (delay == 0) return case.fail("zero sleep before the deadline");
        if (now + delay > timeout) return case.fail("sleeps past the deadline");
        now += delay;
        if (checks > 200) return case.fail("wait does not end");
    };

    // doubling from 25 ms reaches the 500 ms cap in five steps
    const bound = 7 + timeout / await_record.max_poll_ms;
    if (checks > bound) return case.fail("a wait costs more queries than the schedule allows");
    if (seen) |at| {
        if (at > settles_at.? + await_record.max_poll_ms + max_latency)
            return case.fail("a settled record is noticed later than one capped interval");
        case.event("settled record seen");
    } else {
        if (settles_at) |at| if (at + await_record.max_poll_ms + max_latency <= timeout)
            return case.fail("a record that settled well before the deadline was missed");
        if (max_latency == 0 and last_check != timeout) return case.fail("the last check is not at the deadline");
        case.event("timed out");
    }
}
