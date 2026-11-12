const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const openssl_include_path = b.option(
        std.Build.LazyPath,
        "openssl_include_path",
        "OpenSSL include directory forwarded to pg.zig",
    );
    const openssl_lib_path = b.option(
        std.Build.LazyPath,
        "openssl_lib_path",
        "OpenSSL library directory forwarded to pg.zig",
    );
    if ((openssl_include_path == null) != (openssl_lib_path == null))
        @panic("openssl_include_path and openssl_lib_path must be supplied together");

    const root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    root_module.addAnonymousImport("upload_contract", .{
        .root_source_file = b.path(b.option([]const u8, "upload_contract", "Shared upload policy contract") orelse "../../backend/src/backend/upload_contract.json"),
    });
    root_module.addAnonymousImport("migration_0029_like_counts", .{
        .root_source_file = b.path("migrations/0029_add_track_like_counts.sql"),
    });
    root_module.addAnonymousImport("migration_0030_like_counts", .{
        .root_source_file = b.path("migrations/0030_like_counts_statement_triggers.sql"),
    });
    root_module.addAnonymousImport("migration_0032_track_tags", .{
        .root_source_file = b.path("migrations/0032_add_verified_track_tags.sql"),
    });
    root_module.addAnonymousImport("migration_0033_tag_annotations", .{
        .root_source_file = b.path("migrations/0033_add_legacy_tag_annotations.sql"),
    });
    root_module.addAnonymousImport("migration_0034_tag_normalization", .{
        .root_source_file = b.path("migrations/0034_normalize_derived_tags.sql"),
    });
    root_module.addAnonymousImport("migration_0035_queue_records", .{
        .root_source_file = b.path("migrations/0035_add_queue_records.sql"),
    });
    root_module.addAnonymousImport("migration_0036_account_preferences", .{
        .root_source_file = b.path("migrations/0036_add_account_preferences.sql"),
    });
    root_module.addAnonymousImport("migration_0037_account_labels", .{
        .root_source_file = b.path("migrations/0037_add_account_label_policies.sql"),
    });
    root_module.addAnonymousImport("migration_0038_download_policy", .{
        .root_source_file = b.path("migrations/0038_add_track_download_policy.sql"),
    });
    const zat_module = b.dependency("zat", .{
        .target = target,
        .optimize = optimize,
    }).module("zat");
    const websocket_module = b.dependency("websocket", .{
        .target = target,
        .optimize = optimize,
    }).module("websocket");
    zat_module.addImport("websocket", websocket_module);
    root_module.addImport("zat", zat_module);
    root_module.addImport("websocket", websocket_module);
    const pg_dependency = if (openssl_include_path) |include_path|
        b.dependency("pg", .{
            .target = target,
            .optimize = optimize,
            .openssl = true,
            .openssl_include_path = include_path,
            .openssl_lib_path = openssl_lib_path.?,
        })
    else
        b.dependency("pg", .{
            .target = target,
            .optimize = optimize,
            .openssl = true,
        });
    root_module.addImport("pg", pg_dependency.module("pg"));
    root_module.addImport("redis", b.dependency("redis", .{
        .target = target,
        .optimize = optimize,
    }).module("redis"));

    const executable = b.addExecutable(.{
        .name = "plyr-backend",
        .root_module = root_module,
    });
    b.installArtifact(executable);

    const run_command = b.addRunArtifact(executable);
    run_command.step.dependOn(b.getInstallStep());
    run_command.addPassthruArgs();

    const run_step = b.step("run", "Run the selected backend process role");
    run_step.dependOn(&run_command.step);

    const test_filter = b.option([]const u8, "test-filter", "Run tests whose names contain this text");
    const tests = b.addTest(.{
        .root_module = root_module,
        .filters = if (test_filter) |filter| &.{filter} else &.{},
    });
    const run_tests = b.addRunArtifact(tests);
    run_tests.has_side_effects = true;
    const test_step = b.step("test", "Run Zig backend tests");
    test_step.dependOn(&run_tests.step);

    // declared before the lazy fetch, which reruns configure without it
    const cases = b.option(u64, "fuzz-cases", "cases per property (default: HEGEL_TEST_CASES, else 100)");
    const only = b.option([]const u8, "fuzz-only", "run the property groups whose name contains this");
    if (b.option(bool, "hegel", "build the property harnesses (builds libhegel once)") orelse false) {
        if (b.lazyDependency("hegel", .{ .target = target, .optimize = optimize })) |hegel| {
            const fuzz_module = b.createModule(.{
                .root_source_file = b.path("src/fuzz.zig"),
                .target = target,
                .optimize = optimize,
                .imports = &.{
                    .{ .name = "hegel", .module = hegel.module("hegel") },
                    .{ .name = "zat", .module = root_module.import_table.get("zat").? },
                    .{ .name = "pg", .module = root_module.import_table.get("pg").? },
                    .{ .name = "migration_0029_like_counts", .module = root_module.import_table.get("migration_0029_like_counts").? },
                    .{ .name = "migration_0030_like_counts", .module = root_module.import_table.get("migration_0030_like_counts").? },
                    .{ .name = "migration_0032_track_tags", .module = root_module.import_table.get("migration_0032_track_tags").? },
                    .{ .name = "migration_0033_tag_annotations", .module = root_module.import_table.get("migration_0033_tag_annotations").? },
                    .{ .name = "migration_0034_tag_normalization", .module = root_module.import_table.get("migration_0034_tag_normalization").? },
                },
            });
            // libhegel is a rust staticlib: off darwin, _Unwind_* come from zig's libunwind
            if (!target.result.os.tag.isDarwin()) fuzz_module.link_libcpp = true;
            const fuzz = b.addExecutable(.{ .name = "fuzz", .root_module = fuzz_module });
            const run_fuzz = b.addRunArtifact(fuzz);
            run_fuzz.has_side_effects = true;
            if (cases) |n| run_fuzz.setEnvironmentVariable("HEGEL_TEST_CASES", b.fmt("{d}", .{n}));
            // an option, not only the environment: zig caches the configured
            // graph with the environment it was built under
            if (only) |name| run_fuzz.setEnvironmentVariable("FUZZ_ONLY", name);
            b.step("fuzz", "run the property harnesses over untrusted-input parsers").dependOn(&run_fuzz.step);

            const mutants = b.addRunArtifact(hegel.artifact("hegel-mutants"));
            mutants.setCwd(b.path("."));
            mutants.addArgs(&.{ "src/fuzz/mutants.zon", "--seeds", "3", "--", b.graph.zig_exe, "build", "fuzz", "-Dhegel" });
            if (openssl_include_path) |include_path| {
                mutants.addPrefixedDirectoryArg("-Dopenssl_include_path=", include_path);
                mutants.addPrefixedDirectoryArg("-Dopenssl_lib_path=", openssl_lib_path.?);
            }
            mutants.has_side_effects = true;
            b.step("mutants", "plant each mutant; the harnesses must catch every one").dependOn(&mutants.step);
        }
    }

    const collection_bench_module = b.createModule(.{
        .root_source_file = b.path("src/bench_collection.zig"),
        .target = target,
        .optimize = optimize,
    });
    collection_bench_module.addImport("zat", root_module.import_table.get("zat").?);
    const collection_bench = b.addExecutable(.{ .name = "bench-collection", .root_module = collection_bench_module });
    const run_collection_bench = b.addRunArtifact(collection_bench);
    b.step("bench-collection", "Read and verify public collection proofs without database writes").dependOn(&run_collection_bench.step);

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
