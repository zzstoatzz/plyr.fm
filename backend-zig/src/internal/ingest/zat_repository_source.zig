//! Bounded `getRepo` fetch through Zat's guarded HTTP transport.
//!
//! The configured endpoint must return CAR bytes directly. Redirects fail
//! closed: following an untrusted PDS service URL without destination/IP
//! validation would create an SSRF path into the worker's private network.

const std = @import("std");
const zat = @import("zat");
const repository_source = @import("repository_source.zig");
const snapshot_verifier = @import("../projection/snapshot_verifier.zig");

pub const ZatRepositorySource = struct {
    transport: *zat.HttpTransport,
    base_url: []const u8,

    pub fn port(self: *ZatRepositorySource) repository_source.Source {
        return .{ .context = self, .fetch_fn = fetchOpaque };
    }

    fn fetchOpaque(
        context: *anyopaque,
        request_allocator: std.mem.Allocator,
        did: []const u8,
    ) repository_source.Error!repository_source.Repo {
        const self: *ZatRepositorySource = @ptrCast(@alignCast(context));
        const url = std.fmt.allocPrint(
            request_allocator,
            "{s}/xrpc/com.atproto.sync.getRepo?did={s}",
            .{ std.mem.trimRight(u8, self.base_url, "/"), did },
        ) catch return error.OutOfMemory;
        defer request_allocator.free(url);
        const result = self.transport.fetch(.{
            .url = url,
            .accept = "application/vnd.ipld.car",
            .max_response_size = snapshot_verifier.max_repo_bytes,
            .redirect_behavior = .not_allowed,
        }) catch |err| switch (err) {
            error.ResponseTooLarge => return error.RepositoryTooLarge,
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RepositoryUnavailable,
        };
        switch (result.status) {
            .ok => {},
            .not_found => {
                self.transport.allocator.free(result.body);
                return error.RepositoryNotFound;
            },
            .too_many_requests => {
                self.transport.allocator.free(result.body);
                return error.RepositoryRateLimited;
            },
            else => {
                self.transport.allocator.free(result.body);
                return error.RepositoryUnavailable;
            },
        }
        return .{
            .bytes = result.body,
            .release_context = self,
            .release_fn = releaseOpaque,
        };
    }

    fn releaseOpaque(context: *anyopaque, bytes: []const u8) void {
        const self: *ZatRepositorySource = @ptrCast(@alignCast(context));
        self.transport.allocator.free(bytes);
    }
};
