//! Executor behavior against the real ffmpeg and a fixture owner origin:
//! dispatch admission, lease fencing, format compatibility, output budgets,
//! part uploads, manifest isolation and scratch cleanup.

const std = @import("std");
const fixture = @import("fixture.zig");
const attempt_module = @import("attempt.zig");
const runner_module = @import("runner.zig");
const transfer = @import("transfer.zig");

const testing = std.testing;
const Io = std.Io;
const Attempt = attempt_module.Attempt;
const Runner = runner_module.Runner;
const part_bytes = attempt_module.part_bytes;

const io = testing.io;

fn smallAttempt(source_bytes: u64, output_budget: u64) Attempt {
    var a = attempt_module.fixture();
    a.sourceBytes = source_bytes;
    a.outputBudget = output_budget;
    return a;
}

const Harness = struct {
    client: std.http.Client,
    runner: Runner,
    tmp: testing.TmpDir,
    scratch_buffer: [128]u8,

    fn init(h: *Harness, origin: []const u8) !void {
        h.tmp = testing.tmpDir(.{ .iterate = true });
        const scratch = try std.fmt.bufPrint(&h.scratch_buffer, ".zig-cache/tmp/{s}", .{h.tmp.sub_path});
        h.client = .{ .allocator = testing.allocator, .io = io };
        h.runner = .{ .io = io, .gpa = testing.allocator, .origin = origin, .auth = "fixture-key", .client = &h.client, .scratch = scratch };
    }

    fn deinit(h: *Harness) void {
        h.runner.waitIdle();
        h.client.deinit();
        h.tmp.cleanup();
    }

    fn scratchEmpty(h: *Harness) !bool {
        var iterator = h.tmp.dir.iterate();
        return (try iterator.next(io)) == null;
    }
};

/// A 16-bit mono 8 kHz WAV of `samples` silent bytes (one second at 16000).
fn wav(allocator: std.mem.Allocator, data_bytes: u32) ![]u8 {
    const bytes = try allocator.alloc(u8, 44 + data_bytes);
    @memset(bytes, 0);
    @memcpy(bytes[0..4], "RIFF");
    std.mem.writeInt(u32, bytes[4..8], 36 + data_bytes, .little);
    @memcpy(bytes[8..16], "WAVEfmt ");
    std.mem.writeInt(u32, bytes[16..20], 16, .little);
    std.mem.writeInt(u16, bytes[20..22], 1, .little);
    std.mem.writeInt(u16, bytes[22..24], 1, .little);
    std.mem.writeInt(u32, bytes[24..28], 8000, .little);
    std.mem.writeInt(u32, bytes[28..32], 16000, .little);
    std.mem.writeInt(u16, bytes[32..34], 2, .little);
    std.mem.writeInt(u16, bytes[34..36], 16, .little);
    @memcpy(bytes[36..40], "data");
    std.mem.writeInt(u32, bytes[40..44], data_bytes, .little);
    return bytes;
}

fn ffmpeg(directory: Io.Dir, args: []const []const u8) !void {
    var argv: std.ArrayList([]const u8) = .empty;
    defer argv.deinit(testing.allocator);
    try argv.appendSlice(testing.allocator, &.{ "ffmpeg", "-y", "-v", "error" });
    try argv.appendSlice(testing.allocator, args);
    var child = try std.process.spawn(io, .{ .argv = argv.items, .cwd = .{ .dir = directory }, .stdin = .ignore, .stdout = .ignore, .stderr = .ignore });
    try testing.expect((try child.wait(io)).success());
}

const Gate = struct {
    open: std.atomic.Value(bool) = .init(false),

    pub fn handle(self: *Gate, _: fixture.Request, c: fixture.Connection) void {
        // the first heartbeat waits for the test, holding the slot, then is refused
        while (!self.open.load(.acquire)) io.sleep(.fromMilliseconds(2), .awake) catch {};
        c.respond(409, "", "");
    }
};

test "dispatch is idempotent for the active attempt and the slot is bounded" {
    var context: Gate = .{};
    var server: fixture.Server(Gate) = undefined;
    try server.start(io, testing.allocator, &context);
    defer server.stop();
    var h: Harness = undefined;
    try h.init(server.origin());
    defer h.deinit();
    defer context.open.store(true, .release);
    const body =
        \\{"uploadId":"12345678-1234-1234-1234-123456789abc","generation":1,"sourceBytes":10,"outputBudget":10,"recipe":"mp3-320k-44100-v1","capability":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
    ;
    const other =
        \\{"uploadId":"12345678-1234-1234-1234-123456789abc","generation":2,"sourceBytes":10,"outputBudget":10,"recipe":"mp3-320k-44100-v1","capability":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
    ;
    try testing.expectEqual(Runner.Dispatch.unauthorized, h.runner.start(null, body));
    try testing.expectEqual(Runner.Dispatch.unauthorized, h.runner.start("fixture-kez", body));
    try testing.expectEqual(Runner.Dispatch.unauthorized, h.runner.start("fixture-ke", body));
    try testing.expect(h.runner.active == null);
    try testing.expectEqual(Runner.Dispatch.bad_request, h.runner.start("fixture-key", "{}"));
    try testing.expectEqual(Runner.Dispatch.accepted, h.runner.start("fixture-key", body));
    try testing.expectEqual(Runner.Dispatch.accepted, h.runner.start("fixture-key", body));
    try testing.expectEqual(Runner.Dispatch.busy, h.runner.start("fixture-key", other));
    context.open.store(true, .release);
    h.runner.waitIdle();
    try testing.expect(try h.scratchEmpty());
}

const LeaseRefused = struct {
    status: u16,
    source_reads: std.atomic.Value(usize) = .init(0),

    pub fn handle(self: *LeaseRefused, request: fixture.Request, c: fixture.Connection) void {
        const action = request.action();
        if (std.mem.eql(u8, action, "heartbeat")) return c.respond(self.status, if (self.status == 302) "location: https://elsewhere.example/\r\n" else "", "");
        if (std.mem.eql(u8, action, "source")) _ = self.source_reads.fetchAdd(1, .monotonic);
        c.respond(200, "", "");
    }
};

test "a refused lease never reads the source" {
    for ([_]u16{ 409, 302 }) |status| {
        var context: LeaseRefused = .{ .status = status };
        var server: fixture.Server(LeaseRefused) = undefined;
        try server.start(io, testing.allocator, &context);
        defer server.stop();
        var h: Harness = undefined;
        try h.init(server.origin());
        defer h.deinit();
        try testing.expectError(error.CallbackRejected, runner_module.run(&h.runner, smallAttempt(10, 10)));
        try testing.expectEqual(@as(usize, 0), context.source_reads.load(.monotonic));
    }
}

test "the real encoder honors the output budget across every admitted format" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const source = try wav(testing.allocator, 16000);
    defer testing.allocator.free(source);
    try tmp.dir.writeFile(io, .{ .sub_path = "source.wav", .data = source });

    try transfer.encode(io, tmp.dir, "source.wav", "output.mp3", 100_000);
    try testing.expect((try tmp.dir.statFile(io, "output.mp3", .{})).size > 10_000);
    try testing.expectError(error.OutputBudgetExceeded, transfer.encode(io, tmp.dir, "source.wav", "output.mp3", 100));

    for ([_][]const u8{ "mp3", "flac", "ogg", "m4a", "aac", "aif", "aiff", "webm" }) |extension| {
        var name_buffer: [32]u8 = undefined;
        const name = try std.fmt.bufPrint(&name_buffer, "source.{s}", .{extension});
        try ffmpeg(tmp.dir, &.{ "-i", "source.wav", name });
        transfer.encode(io, tmp.dir, name, "output.mp3", 100_000) catch |err| {
            std.debug.print("{s}: {s}\n", .{ extension, @errorName(err) });
            return err;
        };
        const seconds = try transfer.duration(io, tmp.dir, "output.mp3");
        try testing.expect(seconds >= 1 and seconds <= 2);
    }
}

test "ALAC in m4a encodes like any other admitted source" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const source = try wav(testing.allocator, 16000);
    defer testing.allocator.free(source);
    try tmp.dir.writeFile(io, .{ .sub_path = "source.wav", .data = source });
    try ffmpeg(tmp.dir, &.{ "-i", "source.wav", "-c:a", "alac", "alac.m4a" });
    try transfer.encode(io, tmp.dir, "alac.m4a", "output.mp3", 100_000);
    try testing.expectEqual(@as(u32, 1), try transfer.duration(io, tmp.dir, "output.mp3"));
}

test "the budget is never published as a truncated success" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(io, .{ .sub_path = "six", .data = "123456" });
    try tmp.dir.writeFile(io, .{ .sub_path = "five", .data = "12345" });
    {
        const input = try tmp.dir.openFile(io, "six", .{});
        defer input.close(io);
        const output = try tmp.dir.createFile(io, "out", .{});
        defer output.close(io);
        try testing.expectError(error.OutputBudgetExceeded, transfer.copyBounded(io, input, output, 5));
    }
    try testing.expectEqual(@as(u64, 0), (try tmp.dir.statFile(io, "out", .{})).size);
    const input = try tmp.dir.openFile(io, "five", .{});
    defer input.close(io);
    const output = try tmp.dir.createFile(io, "out", .{});
    defer output.close(io);
    try testing.expectEqual(@as(u64, 5), try transfer.copyBounded(io, input, output, 5));
}

const PartSink = struct {
    mutex: Io.Mutex = .init,
    lengths: [4]usize = undefined,
    count: usize = 0,
    completed: bool = false,
    failure: ?[]const u8 = null,

    fn fail(self: *PartSink, why: []const u8) void {
        if (self.failure == null) self.failure = why;
    }

    pub fn handle(self: *PartSink, request: fixture.Request, c: fixture.Connection) void {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        const action = request.action();
        if (!std.mem.eql(u8, request.header("authorization") orelse "", "Bearer " ++ "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")) self.fail("authorization");
        if (std.mem.startsWith(u8, action, "parts/")) {
            if (!std.mem.eql(u8, request.method, "PUT")) self.fail("part method");
            var digest: [32]u8 = undefined;
            std.crypto.hash.sha2.Sha256.hash(request.body, &digest, .{});
            if (!std.mem.eql(u8, request.header("x-part-sha256") orelse "", &std.fmt.bytesToHex(digest, .lower))) self.fail("digest");
            const number = std.fmt.parseInt(usize, action["parts/".len..], 10) catch 0;
            if (number != self.count + 1) self.fail("part order");
            self.lengths[self.count] = request.body.len;
            self.count += 1;
            return c.respond(204, "", "");
        }
        if (std.mem.eql(u8, action, "complete")) {
            const Completion = struct { sizeBytes: u64, duration: u32, contentType: []const u8, parts: []const struct { number: usize, sha256: []const u8 } };
            const parsed = std.json.parseFromSlice(Completion, testing.allocator, request.body, .{}) catch {
                self.fail("completion json");
                return c.respond(400, "", "");
            };
            defer parsed.deinit();
            if (parsed.value.sizeBytes != part_bytes + 123 or parsed.value.duration != 1 or parsed.value.parts.len != 2 or
                !std.mem.eql(u8, parsed.value.contentType, "audio/mpeg") or parsed.value.parts[1].number != 2) self.fail("completion fields");
            self.completed = true;
            return c.respond(204, "", "");
        }
        self.fail("unexpected callback");
        c.respond(404, "", "");
    }
};

test "the rendition goes up as bounded parts with an ordered completion" {
    var context: PartSink = .{};
    var server: fixture.Server(PartSink) = undefined;
    try server.start(io, testing.allocator, &context);
    defer server.stop();
    var h: Harness = undefined;
    try h.init(server.origin());
    defer h.deinit();
    {
        const file = try h.tmp.dir.createFile(io, "rendition", .{});
        defer file.close(io);
        try file.setLength(io, part_bytes + 123);
    }
    try transfer.upload(&h.runner, smallAttempt(1, part_bytes + 123), h.tmp.dir, "rendition", 1);
    if (context.failure) |why| {
        std.debug.print("fixture saw: {s}\n", .{why});
        return error.TestUnexpectedResult;
    }
    try testing.expectEqual(@as(usize, 2), context.count);
    try testing.expectEqualSlices(usize, &.{ part_bytes, 123 }, context.lengths[0..2]);
    try testing.expect(context.completed);
}

const Segments = struct {
    reads: std.atomic.Value(usize) = .init(0),

    pub fn handle(self: *Segments, _: fixture.Request, c: fixture.Connection) void {
        _ = self.reads.fetchAdd(1, .monotonic);
        c.respond(200, "", "not audio");
    }
};

test "manifests cannot open external or sibling sources" {
    var context: Segments = .{};
    var server: fixture.Server(Segments) = undefined;
    try server.start(io, testing.allocator, &context);
    defer server.stop();
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    var manifest_buffer: [256]u8 = undefined;
    const manifest = try std.fmt.bufPrint(&manifest_buffer, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n{s}/segment.wav\n#EXT-X-ENDLIST\n", .{server.origin()});
    try tmp.dir.writeFile(io, .{ .sub_path = "manifest", .data = manifest });
    try testing.expectError(error.EncodingFailed, transfer.encode(io, tmp.dir, "manifest", "output.mp3", 100_000));
    try testing.expectEqual(@as(usize, 0), context.reads.load(.monotonic));

    try ffmpeg(tmp.dir, &.{ "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "0.1", "local.wav" });
    try tmp.dir.writeFile(io, .{ .sub_path = "manifest", .data = "ffconcat version 1.0\nfile 'local.wav'\n" });
    try testing.expectError(error.EncodingFailed, transfer.encode(io, tmp.dir, "manifest", "output.mp3", 100_000));
}

const HeldSource = struct {
    reading: std.atomic.Value(bool) = .init(false),
    closed: std.atomic.Value(bool) = .init(false),

    pub fn handle(self: *HeldSource, request: fixture.Request, c: fixture.Connection) void {
        const action = request.action();
        if (std.mem.eql(u8, action, "heartbeat")) return c.respond(if (self.reading.load(.acquire)) 409 else 204, "", "");
        if (std.mem.eql(u8, action, "source")) {
            // promise 100 bytes, send one, and hold the body open
            c.raw("HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\nx");
            self.reading.store(true, .release);
            c.awaitClose();
            self.closed.store(true, .release);
            return;
        }
        c.respond(204, "", "");
    }
};

test "a lost lease cancels the active source read and cleans scratch" {
    var context: HeldSource = .{};
    var server: fixture.Server(HeldSource) = undefined;
    try server.start(io, testing.allocator, &context);
    defer server.stop();
    var h: Harness = undefined;
    try h.init(server.origin());
    defer h.deinit();
    h.runner.heartbeat_interval = .fromMilliseconds(10);
    try testing.expectError(error.LeaseLost, runner_module.run(&h.runner, smallAttempt(100, 100_000)));
    try testing.expect(context.reading.load(.acquire));
    var waited: usize = 0;
    while (!context.closed.load(.acquire) and waited < 200) : (waited += 1) try io.sleep(.fromMilliseconds(10), .awake);
    try testing.expect(context.closed.load(.acquire));
    try testing.expect(try h.scratchEmpty());
}

test "a stalled source fails the attempt" {
    var context: HeldSource = .{};
    var server: fixture.Server(HeldSource) = undefined;
    try server.start(io, testing.allocator, &context);
    defer server.stop();
    var h: Harness = undefined;
    try h.init(server.origin());
    defer h.deinit();
    // heartbeats keep succeeding only if the monitor never fires
    h.runner.heartbeat_interval = .fromSeconds(60);
    h.runner.stall_timeout = .fromMilliseconds(50);
    try testing.expectError(error.SourceStalled, runner_module.run(&h.runner, smallAttempt(100, 100_000)));
    try testing.expect(try h.scratchEmpty());
}

const FailureSink = struct {
    source: []const u8,
    reason: [64]u8 = undefined,
    reason_len: usize = 0,

    pub fn handle(self: *FailureSink, request: fixture.Request, c: fixture.Connection) void {
        const action = request.action();
        if (std.mem.eql(u8, action, "source")) return c.respond(200, "", self.source);
        if (std.mem.eql(u8, action, "failed")) {
            self.reason_len = @min(request.body.len, self.reason.len);
            @memcpy(self.reason[0..self.reason_len], request.body[0..self.reason_len]);
        }
        c.respond(204, "", "");
    }
};

test "the encoder reports capacity separately from other failures" {
    for ([_]bool{ true, false }) |valid_audio| {
        const source = try wav(testing.allocator, 16000);
        defer testing.allocator.free(source);
        if (!valid_audio) @memset(source, 0);
        var context: FailureSink = .{ .source = source };
        var server: fixture.Server(FailureSink) = undefined;
        try server.start(io, testing.allocator, &context);
        defer server.stop();
        var h: Harness = undefined;
        try h.init(server.origin());
        defer h.deinit();
        const result = runner_module.execute(&h.runner, smallAttempt(source.len, 1));
        if (valid_audio)
            try testing.expectError(error.OutputBudgetExceeded, result)
        else
            try testing.expectError(error.EncodingFailed, result);
        try testing.expectEqualStrings(
            if (valid_audio) "{\"reason\":\"output_budget_exceeded\"}" else "{\"reason\":\"executor_failed\"}",
            context.reason[0..context.reason_len],
        );
        try testing.expect(try h.scratchEmpty());
    }
}

const Pipeline = struct {
    source: []const u8,
    mutex: Io.Mutex = .init,
    part_bytes_seen: usize = 0,
    completion: [512]u8 = undefined,
    completion_len: usize = 0,

    pub fn handle(self: *Pipeline, request: fixture.Request, c: fixture.Connection) void {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        const action = request.action();
        if (std.mem.eql(u8, action, "source")) return c.respond(200, "", self.source);
        if (std.mem.startsWith(u8, action, "parts/")) self.part_bytes_seen += request.body.len;
        if (std.mem.eql(u8, action, "complete")) {
            self.completion_len = @min(request.body.len, self.completion.len);
            @memcpy(self.completion[0..self.completion_len], request.body[0..self.completion_len]);
        }
        c.respond(204, "", "");
    }
};

test "a dispatched attempt runs end to end and frees the slot" {
    const source = try wav(testing.allocator, 32000);
    defer testing.allocator.free(source);
    var context: Pipeline = .{ .source = source };
    var server: fixture.Server(Pipeline) = undefined;
    try server.start(io, testing.allocator, &context);
    defer server.stop();
    var h: Harness = undefined;
    try h.init(server.origin());
    defer h.deinit();
    var body_buffer: [512]u8 = undefined;
    const body = try std.fmt.bufPrint(&body_buffer,
        \\{{"uploadId":"12345678-1234-1234-1234-123456789abc","generation":3,"sourceBytes":{d},"outputBudget":1000000,"recipe":"mp3-320k-44100-v1","capability":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}}
    , .{source.len});
    try testing.expectEqual(Runner.Dispatch.accepted, h.runner.start("fixture-key", body));
    h.runner.waitIdle();
    const Completion = struct { sizeBytes: u64, duration: u32, contentType: []const u8, parts: []const struct { number: usize, sha256: []const u8 } };
    const parsed = try std.json.parseFromSlice(Completion, testing.allocator, context.completion[0..context.completion_len], .{});
    defer parsed.deinit();
    try testing.expectEqual(@as(u32, 2), parsed.value.duration);
    try testing.expectEqual(parsed.value.sizeBytes, context.part_bytes_seen);
    try testing.expectEqual(@as(usize, 1), parsed.value.parts.len);
    try testing.expect(try h.scratchEmpty());
}
