//! Property harnesses for the inputs this executor takes from outside, run
//! by `zig build fuzz -Dhegel`: the start request body (from the owner DO),
//! the configured callback origin, and ffprobe's duration output.
//! `-Dfuzz-cases` or `HEGEL_TEST_CASES` sets the cases per property.

const std = @import("std");
const hegel = @import("hegel");
const attempt = @import("attempt.zig");
const transfer = @import("transfer.zig");

pub fn main() !void {
    var failed = false;
    inline for (.{
        .{ "processing.attempt_parse", attemptParse },
        .{ "processing.attempt_round_trip", attemptRoundTrip },
        .{ "processing.callback_origin", callbackOrigin },
        .{ "processing.probe_seconds", probeSeconds },
    }) |property| {
        std.debug.print("-- {s}\n", .{property[0]});
        hegel.run(.{ .key = property[0] }, {}, property[1]) catch {
            failed = true;
        };
    }
    if (failed) std.process.exit(1);
}

const json_noise = "{}[]\":,0123456789-.eE+ \\/aAfxtrunl\x00\xff";
const fields = [_][]const u8{ "uploadId", "generation", "sourceBytes", "outputBudget", "recipe", "capability", "extra" };

fn pick(case: *hegel.TestCase, comptime T: type, options: []const T) !T {
    return options[try case.index(options.len)];
}

fn noise(case: *hegel.TestCase, a: std.mem.Allocator, alphabet: []const u8, max: usize) ![]u8 {
    const len = try case.int(usize, 0, max);
    const out = try a.alloc(u8, len);
    for (out) |*c| c.* = alphabet[try case.index(alphabet.len)];
    return out;
}

/// Near-miss JSON objects: whatever the body, parse never crashes, and what
/// it accepts is inside every bound the transfer relies on.
fn attemptParse(_: void, case: *hegel.TestCase) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var body: std.ArrayList(u8) = .empty;
    if (try case.boolean()) {
        try body.appendSlice(a, try noise(case, a, json_noise, 200));
    } else {
        try body.append(a, '{');
        // mostly the six real fields, each usually valid, sometimes a near
        // miss, sometimes repeated or joined by an unknown one
        const count = try case.int(usize, 4, 8);
        for (0..count) |i| {
            if (i > 0) try body.append(a, ',');
            const name = if (i < 6 and try case.int(u8, 0, 9) != 0) fields[i] else try pick(case, []const u8, &fields);
            try body.print(a, "\"{s}\":", .{name});
            if (try case.int(u8, 0, 3) != 0) {
                try body.appendSlice(a, try validValue(case, a, name));
                continue;
            }
            switch (try case.int(u8, 0, 5)) {
                0 => try body.print(a, "{d}", .{try case.int(u64, 0, std.math.maxInt(i64))}),
                1 => try body.print(a, "{d}", .{try case.int(u64, 0, 4 * attempt.max_bytes)}),
                2 => try body.print(a, "-{d}", .{try case.int(u32, 0, 10)}),
                3 => try body.print(a, "\"{s}\"", .{try pick(case, []const u8, &.{ "12345678-1234-1234-1234-123456789abc", attempt.recipe, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "../x", "" })}),
                4 => try body.print(a, "\"{s}\"", .{try noise(case, a, "abcdef0123456789-xX ./\\\"", 64)}),
                else => try body.appendSlice(a, try pick(case, []const u8, &.{ "null", "true", "1.5", "[]", "{}" })),
            }
        }
        try body.append(a, '}');
    }
    const parsed = attempt.parse(a, body.items) orelse return;
    case.event("accepted");
    if (!parsed.valid()) return case.fail("parse accepted an invalid attempt");
    if (parsed.sourceBytes + parsed.outputBudget > 2 * attempt.max_bytes) return case.fail("reservation over twice the admission");
    var path_buffer: [256]u8 = undefined;
    const path = parsed.path(&path_buffer, "heartbeat") catch return case.fail("callback path overflowed");
    if (std.mem.indexOf(u8, path, "..") != null or std.mem.count(u8, path, "/") != 5) return case.fail("callback path escapes its attempt");
}

fn validValue(case: *hegel.TestCase, a: std.mem.Allocator, name: []const u8) ![]const u8 {
    if (std.mem.eql(u8, name, "uploadId")) return "\"12345678-1234-1234-1234-123456789abc\"";
    if (std.mem.eql(u8, name, "recipe")) return "\"" ++ attempt.recipe ++ "\"";
    if (std.mem.eql(u8, name, "capability")) return "\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"";
    if (std.mem.eql(u8, name, "generation")) return std.fmt.allocPrint(a, "{d}", .{try case.int(u32, 1, std.math.maxInt(u32))});
    return std.fmt.allocPrint(a, "{d}", .{try case.int(u64, 1, 2 * attempt.max_bytes)});
}

/// Every attempt inside the bounds survives serialization and parses back equal.
fn attemptRoundTrip(_: void, case: *hegel.TestCase) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var id = (try a.dupe(u8, "00000000-0000-0000-0000-000000000000"));
    for (id, 0..) |*c, i| if (i != 8 and i != 13 and i != 18 and i != 23) {
        c.* = "0123456789abcdef"[try case.index(16)];
    };
    const source = try case.int(u64, 1, attempt.max_bytes);
    const value: attempt.Attempt = .{
        .uploadId = id,
        .generation = try case.int(u32, 1, std.math.maxInt(u32)),
        .sourceBytes = source,
        .outputBudget = try case.int(u64, 1, 2 * attempt.max_bytes - source),
        .recipe = attempt.recipe,
        .capability = blk: {
            const capability = try noise(case, a, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~!", 4096);
            if (capability.len < 32) return error.Reject;
            break :blk capability;
        },
    };
    _ = &id;
    const body = try std.json.Stringify.valueAlloc(a, value, .{});
    const parsed = attempt.parse(a, body) orelse return case.fail("a valid attempt was refused");
    if (!parsed.eql(value)) return case.fail("round trip changed the attempt");
    case.event("round trip");
}

/// What the origin check accepts is a bare https origin a path can be appended to.
fn callbackOrigin(_: void, case: *hegel.TestCase) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const prefix = try pick(case, []const u8, &.{ "https://", "https://", "http://", "https:", "", "HTTPS://", "https://user@", "https://u:p@" });
    const host = try pick(case, []const u8, &.{ "audio.example", "a", "", "[::1]", "audio.example:8443" });
    const rest = if (try case.boolean()) try pick(case, []const u8, &.{ "", "/", "//", "/x", "?q", "#f", ":", " " }) else try noise(case, a, "abc.-:/?#@%[]09 \x00", 40);
    const value = try std.mem.concat(a, u8, &.{ prefix, host, rest });
    const origin = attempt.callbackOrigin(value) catch return;
    case.event("accepted");
    if (!std.mem.startsWith(u8, origin, "https://")) return case.fail("accepted a non-https origin");
    const authority = origin["https://".len..];
    if (authority.len == 0) return case.fail("accepted an origin without a host");
    for (authority) |c| if (c == '/' or c == '?' or c == '#' or c == '@' or c <= ' ') return case.fail("accepted an origin carrying more than a host");
}

/// ffprobe output is at most 64 bytes of anything; parsing never crashes and
/// only returns a rounded positive finite duration.
fn probeSeconds(_: void, case: *hegel.TestCase) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const text = if (try case.boolean())
        try noise(case, a, "0123456789.eE+-naifNAI/ \n\r\t", 64)
    else
        try std.fmt.allocPrint(a, "{d}.{d:0>6}\n", .{ try case.int(u64, 0, 1 << 33), try case.int(u32, 0, 999_999) });
    const seconds = transfer.parseSeconds(text) catch return;
    case.event("parsed");
    const value = std.fmt.parseFloat(f64, std.mem.trim(u8, text, " \t\r\n")) catch return case.fail("accepted unparseable output");
    if (!(value > 0) or @round(value) != @as(f64, @floatFromInt(seconds))) return case.fail("duration is not the rounded positive value");
}
