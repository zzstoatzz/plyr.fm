//! AT Protocol Lexicon string constraints.
//!
//! `maxLength` counts UTF-8 bytes while `maxGraphemes` counts extended
//! grapheme clusters. Keeping this here prevents record decoders from quietly
//! substituting code points for user-perceived characters.

const std = @import("std");
const graphemes = @import("graphemes");

pub const Error = error{
    InvalidUtf8,
    TooManyBytes,
    TooManyGraphemes,
};

pub fn validate(value: []const u8, max_bytes: usize, max_graphemes: usize) Error!void {
    if (value.len > max_bytes) return error.TooManyBytes;
    if (!std.unicode.utf8ValidateSlice(value)) return error.InvalidUtf8;

    var iterator = graphemes.iterator(value);
    var count: usize = 0;
    while (iterator.next() != null) {
        count += 1;
        if (count > max_graphemes) return error.TooManyGraphemes;
    }
}

test "lexicon string counts extended grapheme clusters" {
    try validate("e\u{301}", 3, 1);
    try validate("👨‍👩‍👧‍👦", 25, 1);
    try validate("🇺🇸", 8, 1);

    try std.testing.expectError(
        error.TooManyGraphemes,
        validate("e\u{301}e\u{301}", 6, 1),
    );
}

test "lexicon string enforces bytes independently of graphemes" {
    try std.testing.expectError(error.TooManyBytes, validate("👨‍👩‍👧‍👦", 24, 1));
    try std.testing.expectError(error.InvalidUtf8, validate("\xff", 1, 1));
}
