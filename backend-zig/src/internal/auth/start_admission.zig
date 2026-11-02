//! Admission port for the expensive browser-login start ceremony.
//!
//! The application expresses a fixed-window policy without knowing Redis.
//! Adapters must make increment-and-expiry atomic and return the remaining
//! window when a caller is denied.

const std = @import("std");

pub const Decision = union(enum) {
    allowed,
    denied: u32,
};

pub const Policy = struct {
    client_limit: u32,
    subject_limit: u32,
    global_limit: u32,
    window_seconds: u32,
};

pub const Store = struct {
    context: *anyopaque,
    admit_fn: *const fn (*anyopaque, []const u8, []const u8, Policy) Error!Decision,

    pub const Error = error{
        AdmissionUnavailable,
        OutOfMemory,
    };

    pub fn admit(
        self: Store,
        client_key: []const u8,
        subject_key: []const u8,
        policy: Policy,
    ) Error!Decision {
        if (client_key.len == 0 or subject_key.len == 0 or
            policy.client_limit == 0 or policy.subject_limit == 0 or
            policy.global_limit == 0 or policy.window_seconds == 0)
            return error.AdmissionUnavailable;
        return self.admit_fn(self.context, client_key, subject_key, policy);
    }
};

test "admission policy rejects unusable dimensions before reaching an adapter" {
    const Fake = struct {
        fn admit(_: *anyopaque, _: []const u8, _: []const u8, _: Policy) Store.Error!Decision {
            return .allowed;
        }
    };
    var context: u8 = 0;
    const store: Store = .{ .context = &context, .admit_fn = Fake.admit };
    const valid: Policy = .{
        .client_limit = 10,
        .subject_limit = 10,
        .global_limit = 120,
        .window_seconds = 60,
    };
    try std.testing.expectError(error.AdmissionUnavailable, store.admit("", "artist", valid));
    try std.testing.expectError(error.AdmissionUnavailable, store.admit("client", "", valid));
    try std.testing.expectError(
        error.AdmissionUnavailable,
        store.admit("client", "artist", .{
            .client_limit = 0,
            .subject_limit = 10,
            .global_limit = 120,
            .window_seconds = 60,
        }),
    );
}
