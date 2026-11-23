//! One dispatched processing attempt, as the audio Worker's owner Durable
//! Object sends it, and the callback origin it reports to.

const std = @import("std");

pub const recipe = "mp3-320k-44100-v1";
pub const part_bytes: usize = 10 * 1024 * 1024;
pub const max_bytes: u64 = 1536 * 1024 * 1024;
/// the start request is a few hundred bytes; anything bigger is refused
pub const max_body_bytes: usize = 8192;

/// The start request's JSON. Unknown or repeated fields are refused.
pub const Attempt = struct {
    uploadId: []const u8,
    generation: u32,
    sourceBytes: u64,
    outputBudget: u64,
    recipe: []const u8,
    capability: []const u8,

    /// The source fits the 1.5 GiB admission, source plus output fits twice
    /// that, the recipe is the one this executor encodes, and the capability
    /// is printable so it can travel in a header.
    pub fn valid(a: Attempt) bool {
        return uploadIdValid(a.uploadId) and
            a.generation > 0 and
            a.sourceBytes >= 1 and a.sourceBytes <= max_bytes and
            a.outputBudget >= 1 and a.outputBudget <= 2 * max_bytes - a.sourceBytes and
            std.mem.eql(u8, a.recipe, recipe) and
            a.capability.len >= 32 and a.capability.len <= 4096 and
            graphic(a.capability);
    }

    pub fn eql(a: Attempt, b: Attempt) bool {
        return std.mem.eql(u8, a.uploadId, b.uploadId) and
            a.generation == b.generation and
            a.sourceBytes == b.sourceBytes and
            a.outputBudget == b.outputBudget and
            std.mem.eql(u8, a.recipe, b.recipe) and
            std.mem.eql(u8, a.capability, b.capability);
    }

    /// A copy whose strings `allocator` owns.
    pub fn dupe(a: Attempt, allocator: std.mem.Allocator) !Attempt {
        var copy = a;
        copy.uploadId = try allocator.dupe(u8, a.uploadId);
        errdefer allocator.free(copy.uploadId);
        copy.recipe = try allocator.dupe(u8, a.recipe);
        errdefer allocator.free(copy.recipe);
        copy.capability = try allocator.dupe(u8, a.capability);
        return copy;
    }

    pub fn free(a: Attempt, allocator: std.mem.Allocator) void {
        allocator.free(a.uploadId);
        allocator.free(a.recipe);
        allocator.free(a.capability);
    }

    /// `/v1/processing/{uploadId}/{generation}/{action}`
    pub fn path(a: Attempt, buffer: []u8, action: []const u8) ![]const u8 {
        return std.fmt.bufPrint(buffer, "/v1/processing/{s}/{d}/{s}", .{ a.uploadId, a.generation, action });
    }
};

/// Parses and checks a start request body; null for anything not a valid attempt.
pub fn parse(arena: std.mem.Allocator, body: []const u8) ?Attempt {
    if (body.len > max_body_bytes) return null;
    const attempt = std.json.parseFromSliceLeaky(Attempt, arena, body, .{
        .ignore_unknown_fields = false,
        .duplicate_field_behavior = .@"error",
    }) catch return null;
    return if (attempt.valid()) attempt else null;
}

/// A canonical lowercase UUID: it lands in callback paths and logs.
fn uploadIdValid(id: []const u8) bool {
    if (id.len != 36) return false;
    for (id, 0..) |c, i| switch (i) {
        8, 13, 18, 23 => if (c != '-') return false,
        else => if (!std.ascii.isDigit(c) and !(c >= 'a' and c <= 'f')) return false,
    };
    return true;
}

fn graphic(value: []const u8) bool {
    for (value) |c| if (c <= ' ' or c >= 0x7f) return false;
    return true;
}

/// The configured callback origin: `https://host[:port]` and nothing else, so
/// no path, query or credentials ride along on every callback. Returns the
/// origin without a trailing slash.
pub fn callbackOrigin(value: []const u8) ![]const u8 {
    const uri = std.Uri.parse(value) catch return error.InvalidOrigin;
    const host = uri.host orelse return error.InvalidOrigin;
    if (!std.mem.eql(u8, uri.scheme, "https") or
        host.isEmpty() or
        uri.user != null or uri.password != null or
        uri.query != null or uri.fragment != null)
        return error.InvalidOrigin;
    const path = switch (uri.path) {
        inline else => |p| p,
    };
    if (!(path.len == 0 or std.mem.eql(u8, path, "/"))) return error.InvalidOrigin;
    if (!graphic(value)) return error.InvalidOrigin;
    return std.mem.trimEnd(u8, value, "/");
}

pub fn fixture() Attempt {
    return .{
        .uploadId = "12345678-1234-1234-1234-123456789abc",
        .generation = 1,
        .sourceBytes = max_bytes,
        .outputBudget = max_bytes,
        .recipe = recipe,
        .capability = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    };
}

test "accepts a full-size reservation and refuses invalid ones" {
    const ok = fixture();
    try std.testing.expect(ok.valid());
    var cases = [_]Attempt{ ok, ok, ok, ok, ok, ok, ok, ok };
    cases[0].sourceBytes = max_bytes + 1;
    cases[1].outputBudget = max_bytes + 1;
    cases[2].uploadId = "../source";
    cases[3].generation = 0;
    cases[4].recipe = "wav";
    cases[5].uploadId = "12345678-1234-1234-1234-123456789ABC";
    cases[6].capability = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    cases[7].capability = ("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") ++ " ";
    for (cases) |case| try std.testing.expect(!case.valid());
}

test "parse refuses unknown and repeated fields" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const base =
        \\{"uploadId":"12345678-1234-1234-1234-123456789abc","generation":1,"sourceBytes":10,"outputBudget":10,"recipe":"mp3-320k-44100-v1","capability":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    ;
    try std.testing.expect(parse(a, base ++ "}") != null);
    try std.testing.expect(parse(a, base ++ ",\"extra\":1}") == null);
    try std.testing.expect(parse(a, base ++ ",\"generation\":2}") == null);
    try std.testing.expect(parse(a, "{}") == null);
    try std.testing.expect(parse(a, "not json") == null);
}

test "the callback origin cannot carry paths or credentials" {
    try std.testing.expectEqualStrings("https://audio.example", try callbackOrigin("https://audio.example"));
    try std.testing.expectEqualStrings("https://audio.example", try callbackOrigin("https://audio.example/"));
    for ([_][]const u8{
        "http://audio.example",
        "https://user:secret@audio.example",
        "https://audio.example/path",
        "https://audio.example?token=x",
        "https://audio.example#x",
        "https:///",
        "audio.example",
    }) |invalid| try std.testing.expectError(error.InvalidOrigin, callbackOrigin(invalid));
}
