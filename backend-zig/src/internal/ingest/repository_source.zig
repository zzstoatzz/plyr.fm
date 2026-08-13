//! Port for a bounded authoritative `com.atproto.sync.getRepo` response.

const std = @import("std");
const zat = @import("zat");

pub const Repo = struct {
    bytes: []const u8,
    release_context: *anyopaque,
    release_fn: *const fn (*anyopaque, []const u8) void,

    pub fn release(self: Repo) void {
        self.release_fn(self.release_context, self.bytes);
    }
};

pub const Source = struct {
    context: *anyopaque,
    fetch_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!Repo,

    pub fn fetch(
        self: Source,
        allocator: std.mem.Allocator,
        did: []const u8,
    ) Error!Repo {
        if (zat.Did.parse(did) == null) return error.InvalidIdentity;
        const repo = try self.fetch_fn(self.context, allocator, did);
        if (repo.bytes.len == 0) {
            repo.release();
            return error.EmptyRepository;
        }
        return repo;
    }
};

pub const Error = error{
    InvalidIdentity,
    EmptyRepository,
    RepositoryNotFound,
    RepositoryRateLimited,
    RepositoryUnavailable,
    RepositoryTooLarge,
    RepositoryIdentityUnavailable,
    RepositoryEndpointMissing,
    UnsafeRepositoryEndpoint,
    UnsupportedRepositoryEndpoint,
    OutOfMemory,
};
