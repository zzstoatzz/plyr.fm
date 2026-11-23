//! The moderation log's vocabulary: what can be recorded about a subject and
//! what each entry means for review. Ported from prod's event log
//! (docs/internal/moderation/event-log.md), trimmed to what next enforces
//! today. Takedowns and indexing exclusions join when something here acts
//! on them.
//!
//! Review state is derived, never stored: a subject is open when its newest
//! opening entry has no closing entry after it, so a fresh report on an
//! acknowledged track reopens it for free.

const std = @import("std");

pub const Action = enum {
    reported,
    flagged_by_scan,
    flagged_by_rule,
    acknowledged,
    override_allow,
    override_exclude,
    override_clear,
    /// next's labeler signed a label; neither opens nor closes review
    /// (labelling states what we assert, not that we're finished)
    label_applied,
    label_negated,

    pub fn parse(text: []const u8) ?Action {
        return std.meta.stringToEnum(Action, text);
    }

    pub fn opensReview(self: Action) bool {
        return switch (self) {
            .reported, .flagged_by_scan, .flagged_by_rule => true,
            else => false,
        };
    }

    /// Recording a decision closes review; `override_clear` withdraws a
    /// decision and leaves the subject wherever it was.
    pub fn closesReview(self: Action) bool {
        return switch (self) {
            .acknowledged, .override_allow, .override_exclude => true,
            else => false,
        };
    }

    /// What an operator may record through the API. Reports come in through
    /// their own method, flags from the rules engine.
    pub fn operatorMay(self: Action) bool {
        return switch (self) {
            .acknowledged, .override_allow, .override_exclude, .override_clear, .label_applied, .label_negated => true,
            else => false,
        };
    }

    pub fn isLabel(self: Action) bool {
        return self == .label_applied or self == .label_negated;
    }

    /// The decision this entry projects onto a track, if any. `null` inside
    /// the optional clears it.
    pub fn decision(self: Action) ?(?[]const u8) {
        return switch (self) {
            .override_allow => "allow",
            .override_exclude => "exclude",
            .override_clear => @as(?[]const u8, null),
            else => null,
        };
    }
};

pub const SQL_OPENING = "('reported','flagged_by_scan','flagged_by_rule')";
pub const SQL_CLOSING = "('acknowledged','override_allow','override_exclude')";

pub const ReasonType = enum {
    copyright,
    sexual,
    spam,
    harassment,
    impersonation,
    other,

    pub fn parse(text: []const u8) ?ReasonType {
        return std.meta.stringToEnum(ReasonType, text);
    }
};

/// Label values next's labeler may sign, by subject kind. The same values
/// prod's labeler declares, which is what the policy tables accept.
pub const track_label_values = [_][]const u8{ "copyright-violation", "sexual", "porn" };
pub const account_label_values = [_][]const u8{"ai"};

pub fn labelAllowed(subject: []const u8, value: []const u8, track_collection: []const u8) bool {
    const values: []const []const u8 = if (std.mem.startsWith(u8, subject, "did:"))
        &account_label_values
    else if (isTrack(subject, track_collection))
        &track_label_values
    else
        return false;
    for (values) |allowed| if (std.mem.eql(u8, allowed, value)) return true;
    return false;
}

pub const max_reason_bytes = 2000;
pub const max_subject_bytes = 512;

/// A subject is an AT URI of a record or an account DID.
pub fn validSubject(subject: []const u8) bool {
    if (subject.len == 0 or subject.len > max_subject_bytes) return false;
    for (subject) |byte| if (byte <= ' ' or byte == 0x7f) return false;
    if (std.mem.startsWith(u8, subject, "did:")) return subject.len > "did:x:".len;
    if (!std.mem.startsWith(u8, subject, "at://did:")) return false;
    return std.mem.indexOfScalarPos(u8, subject, "at://".len, '/') != null;
}

/// The track record a subject names, when it names one in `track_collection`.
pub fn isTrack(subject: []const u8, track_collection: []const u8) bool {
    return inCollection(subject, track_collection, "");
}

/// The album or playlist record a subject names: the list collection beside
/// `track_collection` (`fm.plyr.track` → `fm.plyr.list`).
pub fn isList(subject: []const u8, track_collection: []const u8) bool {
    const suffix = ".track";
    if (!std.mem.endsWith(u8, track_collection, suffix)) return false;
    return inCollection(subject, track_collection[0 .. track_collection.len - suffix.len], ".list");
}

/// Whether a decision (allow, exclude) on `subject` projects anywhere.
pub fn takesDecisions(subject: []const u8, track_collection: []const u8) bool {
    return isTrack(subject, track_collection) or isList(subject, track_collection);
}

/// `subject` is `at://<did>/<prefix><suffix>/<rkey>`.
fn inCollection(subject: []const u8, prefix: []const u8, suffix: []const u8) bool {
    if (!std.mem.startsWith(u8, subject, "at://")) return false;
    const rest = subject["at://".len..];
    const slash = std.mem.indexOfScalar(u8, rest, '/') orelse return false;
    var tail = rest[slash + 1 ..];
    if (!std.mem.startsWith(u8, tail, prefix)) return false;
    tail = tail[prefix.len..];
    if (!std.mem.startsWith(u8, tail, suffix)) return false;
    const after = tail[suffix.len..];
    return after.len > 1 and after[0] == '/' and std.mem.indexOfScalar(u8, after[1..], '/') == null;
}

test "decisions apply to tracks and to the albums and playlists beside them" {
    try std.testing.expect(isTrack("at://did:plc:a/fm.plyr.track/3k", "fm.plyr.track"));
    try std.testing.expect(!isTrack("at://did:plc:a/fm.plyr.list/3k", "fm.plyr.track"));
    try std.testing.expect(isList("at://did:plc:a/fm.plyr.list/3k", "fm.plyr.track"));
    try std.testing.expect(isList("at://did:plc:a/fm.plyr.dev.list/3k", "fm.plyr.dev.track"));
    try std.testing.expect(!isList("at://did:plc:a/fm.plyr.listx/3k", "fm.plyr.track"));
    try std.testing.expect(!isList("at://did:plc:a/fm.plyr.list/3k/x", "fm.plyr.track"));
    try std.testing.expect(!isList("at://did:plc:a/fm.plyr.track/3k", "fm.plyr.track"));
    try std.testing.expect(!takesDecisions("did:plc:a", "fm.plyr.track"));
    try std.testing.expect(takesDecisions("at://did:plc:a/fm.plyr.list/3k", "fm.plyr.track"));
}

/// Reasons are free text a person reads in the queue: valid UTF-8, bounded.
pub fn validReason(reason: []const u8) bool {
    return reason.len <= max_reason_bytes and std.unicode.utf8ValidateSlice(reason) and
        std.mem.indexOfScalar(u8, reason, 0) == null;
}

test "opening and closing entries match prod's event log" {
    try std.testing.expect(Action.reported.opensReview());
    try std.testing.expect(Action.flagged_by_rule.opensReview());
    try std.testing.expect(!Action.acknowledged.opensReview());
    try std.testing.expect(Action.override_exclude.closesReview());
    try std.testing.expect(!Action.override_clear.closesReview());
    try std.testing.expect(!Action.override_clear.opensReview());
    try std.testing.expect(!Action.reported.operatorMay());
    try std.testing.expect(Action.override_clear.operatorMay());
    try std.testing.expectEqual(@as(?Action, null), Action.parse("takedown"));
    try std.testing.expect(!Action.label_applied.opensReview() and !Action.label_applied.closesReview());
    try std.testing.expect(Action.label_negated.operatorMay() and Action.label_negated.isLabel());
}

test "labels match their subject kind" {
    const track = "at://did:plc:a/fm.plyr.track/3k1";
    try std.testing.expect(labelAllowed(track, "copyright-violation", "fm.plyr.track"));
    try std.testing.expect(labelAllowed(track, "porn", "fm.plyr.track"));
    try std.testing.expect(!labelAllowed(track, "ai", "fm.plyr.track"));
    try std.testing.expect(labelAllowed("did:plc:a", "ai", "fm.plyr.track"));
    try std.testing.expect(!labelAllowed("did:plc:a", "porn", "fm.plyr.track"));
    try std.testing.expect(!labelAllowed("at://did:plc:a/fm.plyr.comment/1", "porn", "fm.plyr.track"));
}

test "the SQL action sets agree with the enum" {
    inline for (comptime std.enums.values(Action)) |action| {
        const quoted = "'" ++ @tagName(action) ++ "'";
        try std.testing.expectEqual(action.opensReview(), std.mem.indexOf(u8, SQL_OPENING, quoted) != null);
        try std.testing.expectEqual(action.closesReview(), std.mem.indexOf(u8, SQL_CLOSING, quoted) != null);
    }
}

test "decisions project allow, exclude and clear" {
    try std.testing.expectEqualStrings("allow", Action.override_allow.decision().?.?);
    try std.testing.expectEqualStrings("exclude", Action.override_exclude.decision().?.?);
    try std.testing.expectEqual(@as(?[]const u8, null), Action.override_clear.decision().?);
    try std.testing.expectEqual(@as(?(?[]const u8), null), Action.acknowledged.decision());
}

test "subjects are record URIs or account DIDs" {
    try std.testing.expect(validSubject("at://did:plc:abc/fm.plyr.track/3k1"));
    try std.testing.expect(validSubject("did:plc:abc"));
    try std.testing.expect(!validSubject("at://did:plc:abc"));
    try std.testing.expect(!validSubject("https://plyr.fm/track/1"));
    try std.testing.expect(!validSubject("at://did:plc:abc/fm.plyr.track/3k 1"));
    try std.testing.expect(!validSubject("did:"));
    try std.testing.expect(!validSubject(""));
    try std.testing.expect(isTrack("at://did:plc:abc/fm.plyr.track/3k1", "fm.plyr.track"));
    try std.testing.expect(!isTrack("at://did:plc:abc/fm.plyr.trackx/3k1", "fm.plyr.track"));
    try std.testing.expect(!isTrack("at://did:plc:abc/fm.plyr.comment/3k1", "fm.plyr.track"));
    try std.testing.expect(!isTrack("did:plc:abc", "fm.plyr.track"));
    try std.testing.expect(validReason("covers my band's song"));
    try std.testing.expect(!validReason("\xff"));
    try std.testing.expect(!validReason("a\x00b"));
}
