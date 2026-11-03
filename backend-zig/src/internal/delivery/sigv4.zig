//! AWS Signature Version 4 for S3-compatible object stores (R2).
//!
//! Only what the blob mirror needs: a single request with a fully known
//! payload, path-style URLs, no query string. The caller passes the headers to
//! sign (lowercase names, `host` included) and gets back the Authorization
//! value; `x-amz-date` and `x-amz-content-sha256` must be among the signed
//! headers and sent verbatim.

const std = @import("std");

const Sha256 = std.crypto.hash.sha2.Sha256;
const HmacSha256 = std.crypto.auth.hmac.sha2.HmacSha256;

pub const Credentials = struct {
    access_key_id: []const u8,
    secret_access_key: []const u8,
    region: []const u8 = "auto",
    service: []const u8 = "s3",
};

pub const Header = struct {
    /// lowercase
    name: []const u8,
    value: []const u8,
};

pub const Request = struct {
    method: []const u8,
    /// already URI-encoded per S3 rules (each segment, '/' kept)
    canonical_path: []const u8,
    /// sorted by name, lowercase names, trimmed values
    headers: []const Header,
    /// lowercase hex sha256 of the payload
    payload_sha256_hex: []const u8,
    /// YYYYMMDD'T'HHMMSS'Z'
    amz_date: []const u8,
};

pub fn hexSha256(out: *[64]u8, data: []const u8) void {
    var digest: [Sha256.digest_length]u8 = undefined;
    Sha256.hash(data, &digest, .{});
    out.* = std.fmt.bytesToHex(digest, .lower);
}

/// `AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=…`
pub fn authorization(
    allocator: std.mem.Allocator,
    credentials: Credentials,
    request: Request,
) ![]u8 {
    if (request.amz_date.len != 16) return error.InvalidDate;
    const date = request.amz_date[0..8];

    var canonical: std.ArrayList(u8) = .empty;
    defer canonical.deinit(allocator);
    var signed_headers: std.ArrayList(u8) = .empty;
    defer signed_headers.deinit(allocator);
    try canonical.print(allocator, "{s}\n{s}\n\n", .{ request.method, request.canonical_path });
    for (request.headers, 0..) |header, i| {
        if (i > 0 and !std.mem.lessThan(u8, request.headers[i - 1].name, header.name))
            return error.UnsortedHeaders;
        try canonical.print(allocator, "{s}:{s}\n", .{ header.name, std.mem.trim(u8, header.value, " ") });
        if (i > 0) try signed_headers.append(allocator, ';');
        try signed_headers.appendSlice(allocator, header.name);
    }
    try canonical.print(allocator, "\n{s}\n{s}", .{ signed_headers.items, request.payload_sha256_hex });

    var canonical_hash: [64]u8 = undefined;
    hexSha256(&canonical_hash, canonical.items);
    const scope = try std.fmt.allocPrint(
        allocator,
        "{s}/{s}/{s}/aws4_request",
        .{ date, credentials.region, credentials.service },
    );
    defer allocator.free(scope);
    const string_to_sign = try std.fmt.allocPrint(
        allocator,
        "AWS4-HMAC-SHA256\n{s}\n{s}\n{s}",
        .{ request.amz_date, scope, canonical_hash },
    );
    defer allocator.free(string_to_sign);

    const secret = try std.fmt.allocPrint(allocator, "AWS4{s}", .{credentials.secret_access_key});
    defer {
        std.crypto.secureZero(u8, secret);
        allocator.free(secret);
    }
    var key: [HmacSha256.mac_length]u8 = undefined;
    HmacSha256.create(&key, date, secret);
    HmacSha256.create(&key, credentials.region, &key);
    HmacSha256.create(&key, credentials.service, &key);
    HmacSha256.create(&key, "aws4_request", &key);
    var signature: [HmacSha256.mac_length]u8 = undefined;
    HmacSha256.create(&signature, string_to_sign, &key);
    std.crypto.secureZero(u8, &key);

    return std.fmt.allocPrint(
        allocator,
        "AWS4-HMAC-SHA256 Credential={s}/{s}, SignedHeaders={s}, Signature={s}",
        .{ credentials.access_key_id, scope, signed_headers.items, std.fmt.bytesToHex(signature, .lower) },
    );
}

/// `YYYYMMDDTHHMMSSZ` for a unix time in seconds.
pub fn formatAmzDate(out: *[16]u8, unix_seconds: u64) void {
    const epoch: std.time.epoch.EpochSeconds = .{ .secs = unix_seconds };
    const day = epoch.getEpochDay().calculateYearDay();
    const month_day = day.calculateMonthDay();
    const time = epoch.getDaySeconds();
    _ = std.fmt.bufPrint(out, "{d:0>4}{d:0>2}{d:0>2}T{d:0>2}{d:0>2}{d:0>2}Z", .{
        day.year,
        month_day.month.numeric(),
        @as(u32, month_day.day_index) + 1,
        time.getHoursIntoDay(),
        time.getMinutesIntoHour(),
        time.getSecondsIntoMinute(),
    }) catch unreachable;
}

test "matches the AWS S3 SigV4 GET Object example" {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
    const allocator = std.testing.allocator;
    const empty_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    var computed: [64]u8 = undefined;
    hexSha256(&computed, "");
    try std.testing.expectEqualStrings(empty_hash, &computed);
    const value = try authorization(allocator, .{
        .access_key_id = "AKIAIOSFODNN7EXAMPLE",
        .secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        .region = "us-east-1",
    }, .{
        .method = "GET",
        .canonical_path = "/test.txt",
        .headers = &.{
            .{ .name = "host", .value = "examplebucket.s3.amazonaws.com" },
            .{ .name = "range", .value = "bytes=0-9" },
            .{ .name = "x-amz-content-sha256", .value = empty_hash },
            .{ .name = "x-amz-date", .value = "20130524T000000Z" },
        },
        .payload_sha256_hex = empty_hash,
        .amz_date = "20130524T000000Z",
    });
    defer allocator.free(value);
    try std.testing.expectEqualStrings(
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " ++
            "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " ++
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
        value,
    );
}

test "amz date formatting and header order are strict" {
    var out: [16]u8 = undefined;
    formatAmzDate(&out, 1369353600);
    try std.testing.expectEqualStrings("20130524T000000Z", &out);
    try std.testing.expectError(error.UnsortedHeaders, authorization(std.testing.allocator, .{
        .access_key_id = "a",
        .secret_access_key = "b",
    }, .{
        .method = "PUT",
        .canonical_path = "/x",
        .headers = &.{ .{ .name = "x-amz-date", .value = "1" }, .{ .name = "host", .value = "h" } },
        .payload_sha256_hex = "0",
        .amz_date = "20130524T000000Z",
    }));
}
