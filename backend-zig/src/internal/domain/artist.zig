//! The v1 public artist read model.
//!
//! Core profile fields remain flat for practical client compatibility. The
//! resource itself is admitted only through a verified authored profile and
//! current account-availability evidence. Transitional handle, display-name,
//! and preference fields retain field-level provenance instead of lending
//! legacy presentation state the profile record's authority.

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
    record: Record,
    sources: Sources,
    projection: Projection,
};

pub const Record = struct {
    uri: []const u8,
    cid: []const u8,
    revision: []const u8,
    collection: []const u8,
    rkey: []const u8,
};

pub const Sources = struct {
    did: ClaimSource,
    handle: ClaimSource,
    display_name: ClaimSource,
    profile: ClaimSource,
    public_preferences: ClaimSource,
    account_availability: ClaimSource,
};

pub const ClaimSource = enum {
    legacy_projection,
    legacy_local,
    verified_repo,
    current_pds,
};

pub const Projection = struct {
    indexed_at: ?[]const u8,
    verification: ProjectionVerification,
};

pub const ProjectionVerification = enum {
    legacy_unverified,
    verified_repo,
};
