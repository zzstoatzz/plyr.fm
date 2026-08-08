//! The v1 public artist read model.
//!
//! Core profile fields remain flat for practical compatibility with the
//! current clients. `sources` and `projection` make their present provenance
//! explicit: the legacy artists table is a cache, and the two public preference
//! fields are local product state until an authored-record home exists.

pub const Artist = struct {
    object: []const u8 = "artist",
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
    bio: ?[]const u8,
    avatar_url: ?[]const u8,
    show_liked_on_profile: bool,
    support_url: ?[]const u8,
    created_at: []const u8,
    updated_at: []const u8,
    sources: Sources,
    projection: Projection,
};

pub const Sources = struct {
    identity: ClaimSource,
    profile: ClaimSource,
    public_preferences: ClaimSource,
};

pub const ClaimSource = enum {
    legacy_projection,
    legacy_local,
    verified_repo,
};

pub const Projection = struct {
    indexed_at: ?[]const u8,
    verification: ProjectionVerification,
};

pub const ProjectionVerification = enum {
    legacy_unverified,
    verified_repo,
};
