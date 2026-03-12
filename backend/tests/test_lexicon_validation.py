"""pure unit tests for lexicon record validation."""

from backend.utilities.lexicon import _LEXICONS_DIR, validate_record


class TestLexiconDirectory:
    def test_lexicons_dir_exists(self) -> None:
        """regression: lexicons dir must be found (was missing in Docker)."""
        assert _LEXICONS_DIR.is_dir(), f"lexicons dir not found at {_LEXICONS_DIR}"

    def test_track_lexicon_loadable(self) -> None:
        """track.json must be present and loadable."""
        assert (_LEXICONS_DIR / "track.json").exists()


class TestValidateTrack:
    def test_valid_record(self) -> None:
        record = {
            "title": "my song",
            "artist": "test artist",
            "audioUrl": "https://cdn.example.com/song.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.track", record) == []

    def test_missing_required_fields(self) -> None:
        errors = validate_record("fm.plyr.track", {})
        assert any("title" in e for e in errors)
        assert any("artist" in e for e in errors)
        assert any("fileType" in e for e in errors)
        assert any("createdAt" in e for e in errors)

    def test_audio_blob_only_valid(self) -> None:
        """audioBlob alone passes schema validation (audioUrl is optional)."""
        record = {
            "title": "blob track",
            "artist": "test",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
            "audioBlob": {"ref": {"$link": "bafytest"}, "mimeType": "audio/mpeg"},
        }
        assert validate_record("fm.plyr.track", record) == []

    def test_neither_audio_field_passes_schema(self) -> None:
        """no audio fields passes schema — business rule enforced at ingest."""
        record = {
            "title": "no audio",
            "artist": "test",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.track", record) == []

    def test_title_too_long(self) -> None:
        record = {
            "title": "x" * 300,
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.track", record)
        assert any("maxLength" in e and "title" in e for e in errors)

    def test_empty_title(self) -> None:
        record = {
            "title": "",
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.track", record)
        assert any("minLength" in e and "title" in e for e in errors)

    def test_wrong_type(self) -> None:
        record = {
            "title": 123,
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.track", record)
        assert any("expected string" in e and "title" in e for e in errors)

    def test_negative_duration(self) -> None:
        record = {
            "title": "ok",
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
            "duration": -5,
        }
        errors = validate_record("fm.plyr.track", record)
        assert any("minimum" in e and "duration" in e for e in errors)

    def test_optional_fields_absent(self) -> None:
        """omitting optional fields is fine."""
        record = {
            "title": "ok",
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.track", record) == []

    def test_description_max_length(self) -> None:
        record = {
            "title": "ok",
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
            "description": "x" * 5001,
        }
        errors = validate_record("fm.plyr.track", record)
        assert any("maxLength" in e and "description" in e for e in errors)

    def test_features_max_length(self) -> None:
        record = {
            "title": "ok",
            "artist": "a",
            "audioUrl": "https://x.com/a.mp3",
            "fileType": "mp3",
            "createdAt": "2025-01-01T00:00:00Z",
            "features": [{"did": f"did:plc:{i}", "handle": f"u{i}"} for i in range(11)],
        }
        errors = validate_record("fm.plyr.track", record)
        assert any("maxLength" in e and "features" in e for e in errors)


class TestValidateLike:
    def test_valid_like(self) -> None:
        record = {
            "subject": {"uri": "at://did:plc:x/fm.plyr.track/abc", "cid": "bafy"},
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.like", record) == []

    def test_missing_subject(self) -> None:
        record = {"createdAt": "2025-01-01T00:00:00Z"}
        errors = validate_record("fm.plyr.like", record)
        assert any("subject" in e for e in errors)

    def test_strong_ref_without_uri(self) -> None:
        record = {
            "subject": {"cid": "bafy"},
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.like", record)
        assert any("strongRef" in e and "uri" in e for e in errors)


class TestValidateComment:
    def test_valid_comment(self) -> None:
        record = {
            "subject": {"uri": "at://did:plc:x/fm.plyr.track/abc", "cid": "bafy"},
            "text": "great track!",
            "timestampMs": 5000,
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.comment", record) == []

    def test_text_too_long(self) -> None:
        record = {
            "subject": {"uri": "at://did:plc:x/fm.plyr.track/abc", "cid": "bafy"},
            "text": "x" * 1001,
            "timestampMs": 0,
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.comment", record)
        assert any("maxLength" in e and "text" in e for e in errors)

    def test_negative_timestamp(self) -> None:
        record = {
            "subject": {"uri": "at://did:plc:x/fm.plyr.track/abc", "cid": "bafy"},
            "text": "ok",
            "timestampMs": -1,
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.comment", record)
        assert any("minimum" in e and "timestampMs" in e for e in errors)


class TestValidateList:
    def test_valid_list(self) -> None:
        record = {
            "items": [],
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.list", record) == []

    def test_items_exceeding_max(self) -> None:
        items = [
            {"subject": {"uri": f"at://did:plc:x/fm.plyr.track/{i}", "cid": "bafy"}}
            for i in range(501)
        ]
        record = {
            "items": items,
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.list", record)
        assert any("maxLength" in e and "items" in e for e in errors)


class TestValidateProfile:
    def test_valid_profile(self) -> None:
        record = {
            "bio": "i make music",
            "createdAt": "2025-01-01T00:00:00Z",
        }
        assert validate_record("fm.plyr.actor.profile", record) == []

    def test_bio_too_long(self) -> None:
        record = {
            "bio": "x" * 2561,
            "createdAt": "2025-01-01T00:00:00Z",
        }
        errors = validate_record("fm.plyr.actor.profile", record)
        assert any("maxLength" in e and "bio" in e for e in errors)


class TestPartialValidation:
    def test_skips_required_fields(self) -> None:
        """partial mode doesn't flag missing required fields."""
        assert validate_record("fm.plyr.track", {}, partial=True) == []

    def test_still_checks_types(self) -> None:
        errors = validate_record("fm.plyr.track", {"title": 123}, partial=True)
        assert any("expected string" in e for e in errors)

    def test_still_checks_lengths(self) -> None:
        errors = validate_record("fm.plyr.track", {"title": ""}, partial=True)
        assert any("minLength" in e for e in errors)


class TestUnknownLexicon:
    def test_unknown_id_returns_empty(self) -> None:
        assert validate_record("com.example.unknown", {"anything": "goes"}) == []
