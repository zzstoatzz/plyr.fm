//! Space addresses, parsed without knowing who may read them. Records
//! name the space they sit in (`audioSpace`), so record parsing needs
//! these without depending on the access core in `space/`.

const std = @import("std");
const zat = @import("zat");

pub const SpaceUri = struct {
    authority: []const u8,
    space_type: []const u8,
    skey: []const u8,

    /// `at://{authority-did}/space/{type-nsid}/{skey}`
    pub fn parse(text: []const u8) ?SpaceUri {
        const rest = if (std.mem.startsWith(u8, text, "at://")) text["at://".len..] else return null;
        var parts = std.mem.splitScalar(u8, rest, '/');
        const authority = parts.next() orelse return null;
        const marker = parts.next() orelse return null;
        const space_type = parts.next() orelse return null;
        const skey = parts.next() orelse return null;
        if (parts.next() != null) return null;
        if (!std.mem.eql(u8, marker, "space")) return null;
        if (zat.Did.parse(authority) == null) return null;
        if (zat.Nsid.parse(space_type) == null) return null;
        if (skey.len == 0 or skey.len > 512) return null;
        return .{ .authority = authority, .space_type = space_type, .skey = skey };
    }
};

/// A record inside a space:
/// `at://{authority}/space/{type}/{skey}/{repo}/{collection}/{rkey}`.
pub const SpaceRecordUri = struct {
    space: SpaceUri,
    /// `at://{authority}/space/{type}/{skey}`, a prefix of the record URI
    space_uri: []const u8,
    repo: []const u8,
    collection: []const u8,
    rkey: []const u8,

    pub fn parse(text: []const u8) ?SpaceRecordUri {
        var cut: usize = "at://".len;
        var seen: usize = 0;
        while (seen < 4) : (seen += 1) {
            const slash = std.mem.indexOfScalarPos(u8, text, cut, '/') orelse return null;
            cut = slash + 1;
        }
        const space_uri = text[0 .. cut - 1];
        const space = SpaceUri.parse(space_uri) orelse return null;
        var parts = std.mem.splitScalar(u8, text[cut..], '/');
        const repo = parts.next() orelse return null;
        const collection = parts.next() orelse return null;
        const rkey = parts.next() orelse return null;
        if (parts.next() != null) return null;
        if (zat.Did.parse(repo) == null) return null;
        if (zat.Nsid.parse(collection) == null) return null;
        if (zat.Rkey.parse(rkey) == null) return null;
        return .{ .space = space, .space_uri = space_uri, .repo = repo, .collection = collection, .rkey = rkey };
    }
};
