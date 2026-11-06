const std = @import("std");
const redis = @import("redis");
const ConnectionConfig = @import("../redis/connection_config.zig").ConnectionConfig;
const Admission = @import("auth.zig").Admission;

pub const Ticket = struct { admission: Admission, origin: []const u8 };
pub const Tickets = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    config: ConnectionConfig,
    client: ?redis.Client = null,
    mutex: std.Io.Mutex = .init,

    pub fn init(allocator: std.mem.Allocator, io: std.Io, url: []const u8) !Tickets {
        return .{ .allocator = allocator, .io = io, .config = try ConnectionConfig.parse(allocator, url) };
    }
    pub fn deinit(self: *Tickets) void {
        if (self.client) |*client| client.close();
        self.config.deinit();
    }
    pub fn issue(self: *Tickets, allocator: std.mem.Allocator, admission: Admission, origin: []const u8) ![]const u8 {
        var random: [32]u8 = undefined;
        self.io.random(&random);
        const token = try std.fmt.allocPrint(allocator, "{x}", .{random});
        const key = try std.fmt.allocPrint(allocator, "plyr:next:jam-ticket:{s}", .{token});
        const body = try std.json.Stringify.valueAlloc(allocator, Ticket{ .admission = admission, .origin = origin }, .{});
        _ = try self.command(allocator, &.{ "SET", key, body, "EX", "30", "NX" });
        return token;
    }
    pub fn consume(self: *Tickets, allocator: std.mem.Allocator, token: []const u8) !Ticket {
        if (token.len != 64) return error.InvalidTicket;
        for (token) |byte| if (!std.ascii.isHex(byte)) return error.InvalidTicket;
        const key = try std.fmt.allocPrint(allocator, "plyr:next:jam-ticket:{s}", .{token});
        const body = try self.command(allocator, &.{ "GETDEL", key }) orelse return error.InvalidTicket;
        return std.json.parseFromSliceLeaky(Ticket, allocator, body, .{});
    }
    pub fn latestEvent(self: *Tickets, allocator: std.mem.Allocator) ![]const u8 {
        return try self.command(allocator, &.{ "EVAL", "local e=redis.call('XREVRANGE',KEYS[1],'+','-','COUNT',1); if #e==0 then return '0-0' end; return e[1][1]", "1", @import("store.zig").global_stream }) orelse "0-0";
    }
    fn command(self: *Tickets, allocator: std.mem.Allocator, args: []const []const u8) !?[]const u8 {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.client == null) self.client = try self.config.connect(self.io, self.allocator);
        const result = self.client.?.sendCommand(args) catch |err| {
            self.client.?.close();
            self.client = null;
            return err;
        };
        return switch (result) {
            .bulk => |value| if (value) |bytes| try allocator.dupe(u8, bytes) else null,
            .string => |bytes| try allocator.dupe(u8, bytes),
            .nil => null,
            else => error.InvalidRedisReply,
        };
    }
};
