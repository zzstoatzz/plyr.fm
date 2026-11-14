//! Prepare Zat's HTTP client for a destination-safe, address-pinned TLS dial.

const std = @import("std");
const zat = @import("zat");

/// The pinned-address branch connects before `Client.request`, while std.http
/// normally initializes its CA bundle and clock inside request. Initialize the
/// same shared state explicitly before the lower-level dial.
pub fn prepare(io: std.Io, transport: *zat.HttpTransport) !void {
    const client = &transport.http_client;
    try client.ca_bundle_lock.lockShared(io);
    const initialized = client.now != null;
    client.ca_bundle_lock.unlockShared(io);
    if (initialized) return;

    var bundle: std.crypto.Certificate.Bundle = .empty;
    defer bundle.deinit(client.allocator);
    const now = std.Io.Clock.real.now(io);
    try bundle.rescan(client.allocator, io, now);
    try client.ca_bundle_lock.lock(io);
    defer client.ca_bundle_lock.unlock(io);
    if (client.now == null) {
        client.now = now;
        std.mem.swap(std.crypto.Certificate.Bundle, &client.ca_bundle, &bundle);
    }
}
