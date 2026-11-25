//! Conformance with next/core: the rendered TS table is current, and the
//! zig sniffer names every file in the shared corpus as its manifest says
//! (core's tests hold the TS sniffer to the same manifest). Built as its own
//! test module because it reads next/core, which the image build doesn't have.

const std = @import("std");
const audio_format = @import("audio_format.zig");

test "the generated TypeScript matches this file" {
    const rendered = try audio_format.renderTypeScript(std.testing.allocator);
    defer std.testing.allocator.free(rendered);
    std.testing.expectEqualStrings(rendered, @embedFile("audio_format_ts")) catch |err| {
        std.debug.print("next/core/src/audio-format.gen.ts is stale: run `zig build gen-audio-format`\n", .{});
        return err;
    };
}

test "every corpus file is named by its bytes, whatever its name says" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    var corpus = try std.Io.Dir.cwd().openDir(io, @import("audio_corpus").path, .{});
    defer corpus.close(io);
    const manifest_text = try corpus.readFileAlloc(io, "manifest.json", allocator, .limited(64 * 1024));
    defer allocator.free(manifest_text);
    const Entry = struct { file: []const u8, container: ?[]const u8, codec: ?[]const u8 };
    const manifest = try std.json.parseFromSlice(struct { files: []const Entry }, allocator, manifest_text, .{ .ignore_unknown_fields = true });
    defer manifest.deinit();
    try std.testing.expect(manifest.value.files.len > 0);
    for (manifest.value.files) |entry| {
        const bytes = try corpus.readFileAlloc(io, entry.file, allocator, .limited(1024 * 1024));
        defer allocator.free(bytes);
        const format = audio_format.sniff(bytes);
        errdefer std.debug.print("corpus file {s}: got {?}\n", .{ entry.file, format });
        if (entry.container) |expected| {
            try std.testing.expectEqualStrings(expected, @tagName(format.?.container));
            try std.testing.expectEqualStrings(entry.codec.?, @tagName(format.?.codec));
        } else try std.testing.expectEqual(@as(?audio_format.Format, null), format);
    }
}
