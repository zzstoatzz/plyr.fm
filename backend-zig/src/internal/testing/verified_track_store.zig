const std = @import("std");
const track = @import("../domain/track.zig");
const track_store = @import("../index/track_store.zig");

pub const Fake = struct {
    value: track.Track,

    pub fn store(self: *Fake) track_store.TrackStore {
        return .{
            .context = self,
            .get_by_uri_fn = get,
            .list_public_fn = list,
            .ready_fn = ready,
        };
    }

    fn get(context: *anyopaque, _: std.mem.Allocator, uri: []const u8) track_store.TrackStore.Error!?track.Track {
        const self: *Fake = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, uri, self.value.record.uri)) return null;
        return self.value;
    }

    fn list(_: *anyopaque, _: std.mem.Allocator, _: track_store.ListRequest) track_store.TrackStore.Error![]track_store.ListItem {
        return &.{};
    }

    fn ready(_: *anyopaque) bool {
        return true;
    }
};

pub fn example() track.Track {
    return .{
        .id = "trk_example",
        .record = .{
            .uri = "at://did:plc:artist/fm.plyr.dev.track/song",
            .cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a",
            .revision = "3m123rev",
            .collection = "fm.plyr.dev.track",
            .rkey = "song",
        },
        .metadata = .{
            .title = "Song",
            .description = null,
            .album = null,
            .duration_seconds = null,
            .created_at = "2026-08-13T00:00:00Z",
        },
        .artist = .{
            .did = "did:plc:artist",
            .profile = .{ .handle = "artist.test", .display_name = "Artist", .avatar_url = null },
        },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{ .visibility = .public, .in_discovery = true, .gate = null, .space_uri = null },
        .moderation = .{ .self_labels = &.{}, .operator_labels = &.{}, .override = null },
        .metrics = .{ .play_count = 0 },
        .projection = .{ .indexed_at = "2026-08-13T00:00:01Z", .verification = .verified_repo },
    };
}
