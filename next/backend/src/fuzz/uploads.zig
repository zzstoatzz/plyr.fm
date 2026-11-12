const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const admission = @import("../internal/uploads/admission.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{.{ "uploads.reservation_isolation", reservationIsolation }});
}

fn reservationIsolation(_: void, case: *hegel.TestCase) !void {
    const collection = "fm.plyr.dev.track";
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const size = try gen.pick(case, u64, &.{ 0, 1, 104_857_600, admission.max_bytes - 1, admission.max_bytes, admission.max_bytes + 1, std.math.maxInt(u64) });
    const wrong_owner = try case.int(u8, 0, 1) == 1;
    const wrong_collection = try case.int(u8, 0, 1) == 1;
    const restricted = try case.int(u8, 0, 1) == 1;
    const request: admission.Request = .{
        .serviceToken = "",
        .uploadId = "12345678-1234-4123-8123-123456789abc",
        .recordUri = "at://" ++ owner ++ "/" ++ collection ++ "/3mtest",
        .sizeBytes = size,
        .contentType = "audio/mpeg",
        .fileType = "mp3",
        .visibility = "public",
        .downloadPolicy = if (restricted) "supporters" else "open",
    };
    const expected = size > 0 and size <= 1_610_612_736 and !wrong_owner and !wrong_collection and !restricted;
    const accepted = if (admission.validate(request, if (wrong_owner) "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb" else owner, if (wrong_collection) "fm.plyr.track" else collection)) |_| true else |_| false;
    if (expected != accepted) return case.fail("upload admission escaped size/owner/collection/public boundary");
}
