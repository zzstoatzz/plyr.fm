const std = @import("std");
const track = @import("../domain/track.zig");
const Candidate = @import("station.zig").Candidate;
const Entry = @import("sampler.zig").Entry;

pub const Collections = struct {
    track: []const u8,
    profile: []const u8,
    like: []const u8,
};

/// One station's rotation for one period, at one requested length.
pub const Key = struct {
    station: []const u8,
    size: usize,
    period: i64,
};

pub const Hydrated = struct {
    value: track.Track,
    tags: []const []const u8,
};

pub const Error = error{ IndexUnavailable, CorruptProjection, OutOfMemory };

/// Reads the radio corpus from the projection and keeps each period's pinned
/// rotation. A pin is operational state the radio owns: the first rotation
/// drawn in a period is the rotation for that period, so a rebuild (a
/// restart, a second machine) can't reshuffle the loop and jump the playhead.
/// Losing pins is harmless: the next period draws fresh.
pub const RadioStore = struct {
    context: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        corpus: *const fn (*anyopaque, std.mem.Allocator, Collections, []const []const u8) Error![]Candidate,
        tracks: *const fn (*anyopaque, std.mem.Allocator, Collections, []const []const u8) Error![]Hydrated,
        pin: *const fn (*anyopaque, std.mem.Allocator, Key, []const Entry) Error![]Entry,
        peek: *const fn (*anyopaque, std.mem.Allocator, Key) Error!?Pinned,
        pinAnchor: *const fn (*anyopaque, Key, i64) Error!?i64,
    };

    pub const Pinned = struct {
        entries: []Entry,
        anchor_us: ?i64,
    };

    /// Every public, ungated, playable track, newest first, with whether a
    /// default hidden tag (`hidden_tags`) marks it or its artist.
    pub fn corpus(self: RadioStore, allocator: std.mem.Allocator, collections: Collections, hidden_tags: []const []const u8) Error![]Candidate {
        return self.vtable.corpus(self.context, allocator, collections, hidden_tags);
    }

    /// The tracks among `uris` that may still air, in no particular order.
    pub fn tracks(self: RadioStore, allocator: std.mem.Allocator, collections: Collections, uris: []const []const u8) Error![]Hydrated {
        return self.vtable.tracks(self.context, allocator, collections, uris);
    }

    /// Pins `entries` unless the period already has a rotation; returns the pinned one.
    pub fn pin(self: RadioStore, allocator: std.mem.Allocator, key: Key, entries: []const Entry) Error![]Entry {
        return self.vtable.pin(self.context, allocator, key, entries);
    }

    pub fn peek(self: RadioStore, allocator: std.mem.Allocator, key: Key) Error!?Pinned {
        return self.vtable.peek(self.context, allocator, key);
    }

    /// Sets the period's anchor unless one is set; returns the anchor that
    /// stands, or null when the period has no pinned rotation.
    pub fn pinAnchor(self: RadioStore, key: Key, anchor_us: i64) Error!?i64 {
        return self.vtable.pinAnchor(self.context, key, anchor_us);
    }
};
