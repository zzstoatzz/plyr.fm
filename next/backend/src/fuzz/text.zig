//! Record strings are author-controlled. Grapheme segmentation must tile
//! its input exactly, and `lexicon_string.validate` must agree with that
//! count.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const grapheme = @import("../internal/text/grapheme.zig");
const lexicon_string = @import("../internal/text/lexicon_string.zig");
const lexicon_value = @import("../internal/atproto/lexicon_value.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "text.grapheme_tiling", graphemeTiling },
        .{ "text.grapheme_model", graphemeModel },
        .{ "text.lexicon_string", lexiconString },
        .{ "text.uri", uri },
    });
}

fn graphemeTiling(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const text = try gen.utf8(case, arena.allocator(), 12);
    case.note("segment({x})", .{text});

    var it = grapheme.iterator(text);
    var expected_offset: usize = 0;
    var clusters: usize = 0;
    while (it.next()) |cluster| {
        clusters += 1;
        if (cluster.offset != expected_offset) return case.fail("clusters do not tile the input");
        if (cluster.len == 0) return case.fail("empty cluster");
        if (cluster.offset + cluster.len > text.len) return case.fail("cluster runs past the input");
        if (!std.unicode.utf8ValidateSlice(text[cluster.offset..][0..cluster.len]))
            return case.fail("cluster splits a code point");
        if (clusters > 1 and cluster.offset > 0) case.event("more than one cluster");
        expected_offset += cluster.len;
    }
    if (expected_offset != text.len) return case.fail("clusters do not cover the input");
    const codepoints = std.unicode.utf8CountCodepoints(text) catch unreachable;
    if (clusters > codepoints) return case.fail("more clusters than code points");
    if (text.len > 0 and clusters == 0) return case.fail("non-empty text has no clusters");
    if (clusters != grapheme.count(text)) return case.fail("count disagrees with the iterator");
    if (clusters < codepoints) case.event("a cluster joins code points");

    // every cluster of a prefix that ends on a cluster boundary is unchanged
    var cut = grapheme.iterator(text);
    var boundary: usize = 0;
    const keep = try case.int(usize, 0, clusters);
    for (0..keep) |_| {
        const cluster = cut.next().?;
        boundary = cluster.offset + cluster.len;
    }
    if (grapheme.count(text[0..boundary]) != keep) {
        case.event("prefix recount differs");
        return case.fail("a prefix cut at a boundary recounts differently");
    }
}

const Symbol = enum { letter, cr, lf, mark, zwj, pict, flag };

fn encodeSymbol(symbol: Symbol) []const u8 {
    return switch (symbol) {
        .letter => "a",
        .cr => "\r",
        .lf => "\n",
        .mark => "\u{301}",
        .zwj => "\u{200d}",
        .pict => "\u{1f600}",
        .flag => "\u{1f1e6}",
    };
}

/// UAX #29 restricted to seven code points, one per rule they exercise
fn modelCount(symbols: []const Symbol) usize {
    if (symbols.len == 0) return 0;
    var clusters: usize = 1;
    var flags_in_run: usize = @intFromBool(symbols[0] == .flag);
    for (symbols[1..], 1..) |cur, i| {
        const prev = symbols[i - 1];
        const joins = if (prev == .cr and cur == .lf)
            true
        else if (prev == .cr or prev == .lf or cur == .cr or cur == .lf)
            false
        else if (cur == .mark or cur == .zwj)
            true
        else if (prev == .zwj and cur == .pict and i >= 2 and pictBeforeZwj(symbols[0 .. i - 1]))
            true
        else if (prev == .flag and cur == .flag)
            flags_in_run % 2 == 1
        else
            false;
        if (!joins) clusters += 1;
        flags_in_run = if (cur == .flag) (if (joins) flags_in_run + 1 else 1) else 0;
    }
    return clusters;
}

/// whether `before` ends in ExtPict Extend*
fn pictBeforeZwj(before: []const Symbol) bool {
    var i = before.len;
    while (i > 0 and before[i - 1] == .mark) i -= 1;
    return i > 0 and before[i - 1] == .pict;
}

fn graphemeModel(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const symbols = try a.alloc(Symbol, try case.int(usize, 0, 10));
    var text: std.ArrayList(u8) = .empty;
    const palettes = [_][]const Symbol{
        std.enums.values(Symbol),
        &.{ .flag, .flag, .letter, .mark },
        &.{ .pict, .zwj, .mark, .letter },
        &.{ .cr, .lf, .mark, .letter },
    };
    const palette = palettes[try case.index(palettes.len)];
    for (symbols) |*symbol| {
        symbol.* = palette[try case.index(palette.len)];
        try text.appendSlice(a, encodeSymbol(symbol.*));
        case.note("{s}", .{@tagName(symbol.*)});
    }
    const expected = modelCount(symbols);
    const actual = grapheme.count(text.items);
    case.note("model {d}, count {d}", .{ expected, actual });
    if (std.mem.indexOf(Symbol, symbols, &.{ .flag, .flag, .flag }) != null) case.event("three flags in a row");
    if (std.mem.indexOf(Symbol, symbols, &.{ .pict, .zwj, .pict }) != null) case.event("emoji zwj sequence");
    if (expected != actual) return case.fail("grapheme count disagrees with the UAX #29 model");
}

fn lexiconString(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    const text = if (try case.int(u8, 0, 3) == 0) try gen.bytes(case, a, 16) else try gen.utf8(case, a, 10);
    const max_bytes = try case.int(usize, 0, 48);
    const max_graphemes = try case.int(usize, 0, 12);
    case.note("validate({x}, {d}, {d})", .{ text, max_bytes, max_graphemes });

    const valid_utf8 = std.unicode.utf8ValidateSlice(text);
    const result = lexicon_string.validate(text, max_bytes, max_graphemes);
    if (text.len > max_bytes) {
        if (result != error.TooManyBytes) return case.fail("byte limit not enforced first");
        return;
    }
    if (!valid_utf8) {
        if (result != error.InvalidUtf8) return case.fail("invalid utf-8 accepted");
        return;
    }
    const clusters = grapheme.count(text);
    if (clusters > max_graphemes) {
        if (result != error.TooManyGraphemes) return case.fail("grapheme limit not enforced");
    } else if (result) |_| {} else |_| return case.fail("valid string rejected");
}

fn uri(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    var text: std.ArrayList(u8) = .empty;
    try text.appendSlice(a, try gen.pick(case, []const u8, &.{ "https://", "at://", "did:", "", "h:", "a+b-c.d:" }));
    try gen.fromAlphabet(case, a, &text, "ab/:?#[]@%20!$&'()*+,;=.-_~\xff \x00", 0, 20);
    case.note("validUri({s})", .{text.items});
    if (lexicon_value.validUri(text.items)) {
        case.event("uri accepted");
        if (!std.unicode.utf8ValidateSlice(text.items)) return case.fail("uri with invalid utf-8 accepted");
        if (std.mem.indexOfScalar(u8, text.items, ':') == null) return case.fail("uri without a scheme accepted");
    }
}
