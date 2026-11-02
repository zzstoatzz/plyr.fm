//! Extended grapheme cluster segmentation (UAX #29), enough to count
//! user-perceived characters for Lexicon `maxGraphemes`.
//!
//! Property tables are generated from Unicode data by
//! `scripts/gen_grapheme_tables.py`; the rules below follow UAX #29
//! GB3-GB13 including GB9c (Indic conjunct breaks). Input must be valid
//! UTF-8; callers validate first.

const std = @import("std");
const tables = @import("grapheme_tables.zig");

const Gcb = enum {
    other,
    cr,
    lf,
    control,
    extend,
    zwj,
    regional_indicator,
    prepend,
    spacing_mark,
    l,
    v,
    t,
    lv,
    lvt,
};

const InCb = enum { none, linker, consonant, extend };

fn inRanges(comptime ranges: []const [2]u21, cp: u21) bool {
    var lo: usize = 0;
    var hi: usize = ranges.len;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (cp < ranges[mid][0]) {
            hi = mid;
        } else if (cp > ranges[mid][1]) {
            lo = mid + 1;
        } else return true;
    }
    return false;
}

fn gcb(cp: u21) Gcb {
    // ASCII fast path: only CR, LF, and controls are special.
    if (cp < 0x80) {
        return switch (cp) {
            '\r' => .cr,
            '\n' => .lf,
            0...0x09, 0x0B, 0x0C, 0x0E...0x1F, 0x7F => .control,
            else => .other,
        };
    }
    if (inRanges(&tables.gcb_extend, cp)) return .extend;
    if (inRanges(&tables.gcb_zwj, cp)) return .zwj;
    if (inRanges(&tables.gcb_spacing_mark, cp)) return .spacing_mark;
    if (inRanges(&tables.gcb_control, cp)) return .control;
    if (inRanges(&tables.gcb_regional_indicator, cp)) return .regional_indicator;
    if (inRanges(&tables.gcb_prepend, cp)) return .prepend;
    if (inRanges(&tables.gcb_l, cp)) return .l;
    if (inRanges(&tables.gcb_v, cp)) return .v;
    if (inRanges(&tables.gcb_t, cp)) return .t;
    if (inRanges(&tables.gcb_lv, cp)) return .lv;
    if (inRanges(&tables.gcb_lvt, cp)) return .lvt;
    return .other;
}

fn incb(cp: u21) InCb {
    if (cp < 0x300) return .none;
    if (inRanges(&tables.incb_linker, cp)) return .linker;
    if (inRanges(&tables.incb_consonant, cp)) return .consonant;
    if (inRanges(&tables.incb_extend, cp)) return .extend;
    return .none;
}

fn extPict(cp: u21) bool {
    return cp >= 0xA9 and inRanges(&tables.extended_pictographic, cp);
}

const Props = struct {
    gcb: Gcb,
    incb: InCb,
    ext_pict: bool,

    fn of(cp: u21) Props {
        return .{ .gcb = gcb(cp), .incb = incb(cp), .ext_pict = extPict(cp) };
    }
};

pub const Grapheme = struct {
    offset: usize,
    len: usize,
};

pub const Iterator = struct {
    bytes: []const u8,
    i: usize = 0,

    fn decodeAt(self: *const Iterator, at: usize) struct { cp: u21, len: usize } {
        const len = std.unicode.utf8ByteSequenceLength(self.bytes[at]) catch unreachable;
        const cp = std.unicode.utf8Decode(self.bytes[at..][0..len]) catch unreachable;
        return .{ .cp = cp, .len = len };
    }

    pub fn next(self: *Iterator) ?Grapheme {
        if (self.i >= self.bytes.len) return null;
        const start = self.i;

        const first = self.decodeAt(self.i);
        self.i += first.len;
        var prev = Props.of(first.cp);

        // State carried across the cluster for GB9c, GB11, and GB12/13.
        var ri_count: usize = if (prev.gcb == .regional_indicator) 1 else 0;
        // GB11: ExtPict Extend* ZWJ x ExtPict. `pict_ext` tracks the
        // "ExtPict Extend*" prefix; `pict_zwj` is that prefix plus one ZWJ.
        var pict_ext = prev.ext_pict;
        var pict_zwj = false;
        // GB9c: Consonant [Extend Linker]* Linker [Extend Linker]* x Consonant
        var conjunct = prev.incb == .consonant;
        var conjunct_linked = false;

        while (self.i < self.bytes.len) {
            const decoded = self.decodeAt(self.i);
            const cur = Props.of(decoded.cp);
            if (isBreak(prev, cur, ri_count, pict_zwj, conjunct and conjunct_linked)) break;
            self.i += decoded.len;

            // Update carried state with `cur` now inside the cluster.
            if (cur.gcb == .regional_indicator) ri_count += 1 else ri_count = 0;

            pict_zwj = pict_ext and cur.gcb == .zwj;
            pict_ext = cur.ext_pict or (pict_ext and cur.gcb == .extend);

            switch (cur.incb) {
                .consonant => {
                    conjunct = true;
                    conjunct_linked = false;
                },
                .linker => if (conjunct) {
                    conjunct_linked = true;
                },
                .extend => {},
                .none => {
                    conjunct = false;
                    conjunct_linked = false;
                },
            }
            prev = cur;
        }
        return .{ .offset = start, .len = self.i - start };
    }
};

fn isBreak(prev: Props, cur: Props, ri_count: usize, pict_zwj: bool, conjunct_linked: bool) bool {
    const p = prev.gcb;
    const c = cur.gcb;
    // GB3
    if (p == .cr and c == .lf) return false;
    // GB4, GB5
    if (p == .control or p == .cr or p == .lf) return true;
    if (c == .control or c == .cr or c == .lf) return true;
    // GB6-GB8 (Hangul syllables)
    if (p == .l and (c == .l or c == .v or c == .lv or c == .lvt)) return false;
    if ((p == .lv or p == .v) and (c == .v or c == .t)) return false;
    if ((p == .lvt or p == .t) and c == .t) return false;
    // GB9, GB9a, GB9b
    if (c == .extend or c == .zwj or c == .spacing_mark) return false;
    if (p == .prepend) return false;
    // GB9c
    if (conjunct_linked and cur.incb == .consonant) return false;
    // GB11
    if (pict_zwj and cur.ext_pict) return false;
    // GB12, GB13
    if (p == .regional_indicator and c == .regional_indicator) return ri_count % 2 == 0;
    // GB999
    return true;
}

pub fn iterator(bytes: []const u8) Iterator {
    return .{ .bytes = bytes };
}

pub fn count(bytes: []const u8) usize {
    var it = iterator(bytes);
    var n: usize = 0;
    while (it.next() != null) n += 1;
    return n;
}

test "grapheme clusters follow UAX #29" {
    const cases = [_]struct { []const u8, usize }{
        .{ "", 0 },
        .{ "abc", 3 },
        .{ "\r\n", 1 },
        .{ "\n\r", 2 },
        .{ "e\u{301}", 1 },
        .{ "e\u{301}e\u{301}", 2 },
        .{ "👨‍👩‍👧‍👦", 1 },
        .{ "🇺🇸", 1 },
        .{ "🇺🇸🇬🇧", 2 },
        .{ "🇺🇸🇬", 2 },
        .{ "👍🏽", 1 },
        .{ "각", 1 }, // precomposed LV T
        .{ "\u{1100}\u{1161}\u{11A8}", 1 }, // L V T
        .{ "क्षि", 1 }, // GB9c conjunct + spacing mark
        .{ "a\u{200D}🙂", 2 }, // ZWJ after non-pictographic does not join
        .{ "\u{0600}1", 1 }, // prepend
    };
    for (cases) |case| {
        try std.testing.expectEqual(case[1], count(case[0]));
    }
}
