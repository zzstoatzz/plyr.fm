const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const httpz = b.dependency("httpz", .{ .target = target, .optimize = optimize });
    const root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "httpz", .module = httpz.module("httpz") }},
    });

    const executable = b.addExecutable(.{ .name = "next-processing", .root_module = root_module });
    b.installArtifact(executable);

    const run_command = b.addRunArtifact(executable);
    run_command.step.dependOn(b.getInstallStep());
    b.step("run", "Run the processing executor").dependOn(&run_command.step);

    const test_filter = b.option([]const u8, "test-filter", "Run tests whose names contain this text");
    const tests = b.addTest(.{
        .root_module = root_module,
        .filters = if (test_filter) |filter| &.{filter} else &.{},
    });
    const run_tests = b.addRunArtifact(tests);
    run_tests.has_side_effects = true;
    b.step("test", "Run the executor tests (they spawn the real ffmpeg)").dependOn(&run_tests.step);

    // declared before the lazy fetch, which reruns configure without it
    const cases = b.option(u64, "fuzz-cases", "cases per property (default: HEGEL_TEST_CASES, else 100)");
    if (b.option(bool, "hegel", "build the property harnesses with the native Hegel engine") orelse false) {
        // the engine runs every case, so it is always optimized
        const hegel_dep = b.lazyDependency("hegel", .{
            .target = target,
            .optimize = if (optimize == .debug) .safe else optimize,
        });
        if (hegel_dep) |hegel| {
            const fuzz_module = b.createModule(.{
                .root_source_file = b.path("src/fuzz.zig"),
                .target = target,
                .optimize = optimize,
                .imports = &.{.{ .name = "hegel", .module = hegel.module("hegel") }},
            });
            const fuzz = b.addExecutable(.{ .name = "fuzz", .root_module = fuzz_module });
            const run_fuzz = b.addRunArtifact(fuzz);
            run_fuzz.has_side_effects = true;
            if (cases) |n| run_fuzz.setEnvironmentVariable("HEGEL_TEST_CASES", b.fmt("{d}", .{n}));
            b.step("fuzz", "run the property harnesses over the attempt and encoder boundaries").dependOn(&run_fuzz.step);
        }
    }
}
