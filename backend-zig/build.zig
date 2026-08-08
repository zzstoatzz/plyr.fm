const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    root_module.addImport("zat", b.dependency("zat", .{
        .target = target,
        .optimize = optimize,
    }).module("zat"));
    root_module.addImport("pg", b.dependency("pg", .{
        .target = target,
        .optimize = optimize,
        .openssl = true,
    }).module("pg"));

    const executable = b.addExecutable(.{
        .name = "plyr-backend",
        .root_module = root_module,
    });
    b.installArtifact(executable);

    const run_command = b.addRunArtifact(executable);
    run_command.step.dependOn(b.getInstallStep());
    if (b.args) |args| run_command.addArgs(args);

    const run_step = b.step("run", "Run the selected backend process role");
    run_step.dependOn(&run_command.step);

    const tests = b.addTest(.{ .root_module = root_module });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run Zig backend tests");
    test_step.dependOn(&run_tests.step);

    const snapshot_bench_module = b.createModule(.{
        .root_source_file = b.path("src/bench_snapshot.zig"),
        .target = target,
        .optimize = optimize,
    });
    snapshot_bench_module.addImport("zat", b.dependency("zat", .{
        .target = target,
        .optimize = optimize,
    }).module("zat"));
    const snapshot_bench = b.addExecutable(.{
        .name = "bench-snapshot",
        .root_module = snapshot_bench_module,
    });
    const run_snapshot_bench = b.addRunArtifact(snapshot_bench);
    const snapshot_bench_step = b.step(
        "bench-snapshot",
        "Benchmark authenticated complete-repository list extraction",
    );
    snapshot_bench_step.dependOn(&run_snapshot_bench.step);
}
