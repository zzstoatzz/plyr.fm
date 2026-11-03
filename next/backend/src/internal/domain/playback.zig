//! A resolved playback capability, separate from catalog metadata.
//!
//! The author may declare a retrieval URL in a signed record, but that does not
//! prove the bytes at the URL. Exact delivery evidence is therefore represented
//! separately and preferred without laundering an authored URL into a verified
//! mirror.

pub const Playback = struct {
    object: []const u8 = "playback",
    track_id: []const u8,
    record: Record,
    authorization: Authorization = .{},
    availability: Availability,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    revision: []const u8,
};

pub const Authorization = struct {
    audience: Audience = .anonymous,
    status: AuthorizationStatus = .granted,
};

pub const Audience = enum { anonymous };
pub const AuthorizationStatus = enum { granted };

pub const Availability = struct {
    status: AvailabilityStatus,
    artifact: ?Artifact = null,
    delivery: ?Delivery = null,
    /// set when status is `gated`: read the audio from the artist's space
    space: ?Space = null,
};

pub const AvailabilityStatus = enum { available, unavailable, gated };

/// Gated audio held in a space on the artist's PDS. The listener mints a
/// space credential (the PDS asks plyr whether they pass `gate`) and reads
/// the record, then its audio blob, straight from the PDS.
pub const Space = struct {
    /// `at://{artist}/space/{type}/{skey}`
    uri: []const u8,
    /// the space record holding `audioBlob`
    record: []const u8,
    /// the skey, which names the gate: `supporters` or `signed-in`
    gate: []const u8,
};

pub const Artifact = struct {
    cid: []const u8,
    media_type: []const u8,
    byte_length: ?i64,
};

pub const Delivery = struct {
    url: []const u8,
    media_type: []const u8,
    artifact_cid: ?[]const u8,
    source: DeliverySource,
    integrity: Integrity,
};

pub const DeliverySource = enum {
    verified_delivery,
    authored_record,
};

pub const Integrity = enum {
    verified_blob_cid,
    unverified,
};

pub const Candidate = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    revision: []const u8,
    visibility: Visibility,
    gate_type: ?[]const u8,
    audio_space: ?[]const u8 = null,
    artifact: ?Artifact,
    verified_delivery: ?Delivery,
    authored_delivery: ?Delivery,
};

pub const Visibility = enum { public, unlisted, supporters };
