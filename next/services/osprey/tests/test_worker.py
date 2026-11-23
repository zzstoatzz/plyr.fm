"""the worker end to end: indexed tracks in next's Postgres, through Osprey's
RulesSink and plyr's rules, out as review flags in the moderation log."""

from osprey.worker.sinks.sink.output_sink import MultiOutputSink
from osprey.worker.sinks.sink.rules_sink import RulesSink

from plyr_osprey.image_scan import Verdict
from plyr_osprey.store import MAX_ATTEMPTS, IndexedCover, Store
from plyr_osprey.tracks import CURSORS, ModerationLogSink, TrackInputStream, Walk
from tests.conftest import TEST_DATABASE_URL
from tests.test_rules import NEXT_AUDIO, played_through

OTHER_AUDIO = 'https://plyr-next-audio.n8-3e9.workers.dev/audio/other.mp3'


def add_track(db, n: int, audio_url: str | None, at_us: int, deleted: bool = False, blob_cid: str | None = None) -> str:
    uri = f'at://did:plc:uploader/fm.plyr.track/{n}'
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO plyr_index.track_records
               (record_uri, record_cid, owner_did, collection, title, audio_url, audio_blob_cid, deleted,
                indexed_at_us)
               VALUES (%s, %s, 'did:plc:uploader', 'fm.plyr.track', %s, %s, %s, %s, %s)
               ON CONFLICT (record_uri) DO UPDATE SET indexed_at_us = EXCLUDED.indexed_at_us,
                   audio_url = EXCLUDED.audio_url, record_cid = EXCLUDED.record_cid,
                   audio_blob_cid = EXCLUDED.audio_blob_cid""",
            (uri, f'cid{n}-{at_us}', f'song {n}', audio_url, blob_cid, deleted, at_us),
        )
    return uri


def mirror(db, uri: str, blob_cid: str, at_us: int) -> str:
    """the blob mirror's verified copy of a track's blob, as it records one."""
    url = f'https://plyr-next-audio.n8-3e9.workers.dev/audio/{blob_cid}'
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO plyr_index.track_delivery_origins
               (record_uri, service, record_cid, origin_url, media_type, artifact_cid, verification, observed_at_us)
               SELECT record_uri, 'r2', record_cid, %s, 'audio/mpeg', %s, 'verified_blob_cid', %s
               FROM plyr_index.track_records WHERE record_uri = %s""",
            (url, blob_cid, at_us, uri),
        )
    return url


def drain(engine, start_at_us: int = 0, cursors: tuple[str, ...] = CURSORS) -> None:
    osprey, helpers = engine
    store, walk = Store(TEST_DATABASE_URL, 'fm.plyr.track'), Walk()
    stream = TrackInputStream(
        store, walk, drain_once=True, start_at_us=start_at_us, covers_start_at_us=start_at_us, cursors=cursors
    )
    RulesSink(osprey, stream, MultiOutputSink([ModerationLogSink(store, walk)]), helpers, envoy_check_port=0).run()
    store.close()


def rows(db, sql: str) -> list[tuple]:
    with db.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def test_new_tracks_are_scanned_once_and_flags_open_reviews(db, engine, fingerprinter) -> None:
    with db.cursor() as cur:
        cur.execute("INSERT INTO plyr_index.actor_identities VALUES ('did:plc:uploader', 'uploader.bsky.social', 'Up')")
    flagged = add_track(db, 1, NEXT_AUDIO, 10)
    clean = add_track(db, 2, OTHER_AUDIO, 20)
    add_track(db, 3, 'https://audio.plyr.fm/x.mp3', 30)
    add_track(db, 4, NEXT_AUDIO.replace('abc', 'gone'), 40, deleted=True)
    fingerprinter.by_url[NEXT_AUDIO] = played_through('Beartooth', 5)

    drain(engine)

    assert rows(db, 'SELECT subject_uri, action, actor, reason FROM plyr_moderation.events') == [
        (flagged, 'flagged_by_scan', 'scan:audd', 'Beartooth - Hit (0:00-1:00)')
    ]
    assert rows(db, 'SELECT record_uri, recordings_found FROM plyr_moderation.scans ORDER BY 1') == [
        (flagged, 1),
        (clean, 0),
    ]
    assert rows(db, "SELECT indexed_at_us, attempts FROM plyr_moderation.rule_cursors WHERE name = 'tracks'") == [
        (30, 0)
    ]
    assert sorted(fingerprinter.scanned) == sorted([OTHER_AUDIO, NEXT_AUDIO])

    # an edit that keeps the audio comes round again but isn't paid for twice
    add_track(db, 1, NEXT_AUDIO, 50)
    drain(engine)
    assert len(fingerprinter.scanned) == 2
    assert rows(db, 'SELECT count(*) FROM plyr_moderation.events') == [(1,)]
    assert rows(db, "SELECT indexed_at_us FROM plyr_moderation.rule_cursors WHERE name = 'tracks'") == [(50,)]


def test_without_audd_tracks_wait_and_are_scanned_once_it_is_set(db, engine, fingerprinter) -> None:
    add_track(db, 1, NEXT_AUDIO, 10)
    drain(engine, cursors=(IndexedCover.cursor,))
    assert fingerprinter.scanned == []
    assert rows(db, "SELECT count(*) FROM plyr_moderation.rule_cursors WHERE name = 'tracks' AND attempts > 0") == [(0,)]
    drain(engine)
    assert fingerprinter.scanned == [NEXT_AUDIO]


def test_a_first_run_starts_from_now_not_the_whole_catalog(db, engine, fingerprinter) -> None:
    add_track(db, 1, NEXT_AUDIO, 10)
    drain(engine, start_at_us=100)
    assert fingerprinter.scanned == []
    add_track(db, 2, NEXT_AUDIO, 200)
    drain(engine, start_at_us=100)
    assert fingerprinter.scanned == [NEXT_AUDIO]


def test_a_failing_scan_is_retried_then_passed_over(db, engine, fingerprinter) -> None:
    stuck = add_track(db, 1, NEXT_AUDIO, 10)
    add_track(db, 2, OTHER_AUDIO, 20)
    fingerprinter.failing.add(NEXT_AUDIO)

    for attempt in range(1, MAX_ATTEMPTS):
        drain(engine)
        assert rows(db, "SELECT indexed_at_us, attempts FROM plyr_moderation.rule_cursors WHERE name = 'tracks'") == [
            (0, attempt)
        ]
        assert OTHER_AUDIO not in fingerprinter.scanned

    drain(engine)  # the last attempt passes it over; the next run moves on
    drain(engine)
    assert rows(db, 'SELECT record_uri FROM plyr_moderation.scans') == [(stuck.replace('/1', '/2'),)]
    assert rows(db, 'SELECT count(*) FROM plyr_moderation.events') == [(0,)]


def test_a_track_written_straight_to_its_pds_is_scanned_once_next_holds_its_audio(db, engine, fingerprinter) -> None:
    # blob only, or a blob beside an audioUrl on a host next doesn't hold
    direct = add_track(db, 1, None, 10, blob_cid='bafkreiblob1')
    elsewhere = add_track(db, 2, 'https://evil.example/a.mp3', 20, blob_cid='bafkreiblob2')
    drain(engine)
    assert fingerprinter.scanned == []

    direct_copy = mirror(db, direct, 'bafkreiblob1', 30)
    elsewhere_copy = mirror(db, elsewhere, 'bafkreiblob2', 40)
    fingerprinter.by_url[direct_copy] = played_through('Beartooth', 5)
    drain(engine)

    assert fingerprinter.scanned == [direct_copy, elsewhere_copy]
    assert rows(db, 'SELECT subject_uri, actor FROM plyr_moderation.events') == [(direct, 'scan:audd')]
    assert rows(db, 'SELECT record_uri, audio_url FROM plyr_moderation.scans ORDER BY 1') == [
        (direct, direct_copy),
        (elsewhere, elsewhere_copy),
    ]
    assert rows(db, "SELECT indexed_at_us FROM plyr_moderation.rule_cursors WHERE name = 'tracks'") == [(40,)]

    # a copy of an older blob isn't the record's audio
    add_track(db, 1, None, 50, blob_cid='bafkreiblob3')
    drain(engine)
    assert len(fingerprinter.scanned) == 2


def add_cover(db, n: int, image_url: str | None, at_us: int) -> str:
    uri = add_track(db, n, None, at_us)
    with db.cursor() as cur:
        cur.execute('UPDATE plyr_index.track_records SET image_url = %s WHERE record_uri = %s', (image_url, uri))
    return uri


def add_list(db, n: int, cover_blob: str | None, at_us: int) -> str:
    uri = f'at://did:plc:uploader/fm.plyr.list/{n}'
    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO plyr_index.list_records
               (record_uri, record_cid, owner_did, collection, name, cover_blob_cid, indexed_at_us)
               VALUES (%s, %s, 'did:plc:uploader', 'fm.plyr.list', %s, %s, %s)
               ON CONFLICT (record_uri) DO UPDATE SET indexed_at_us = EXCLUDED.indexed_at_us,
                   cover_blob_cid = EXCLUDED.cover_blob_cid, record_cid = EXCLUDED.record_cid""",
            (uri, f'lcid{n}-{at_us}', f'album {n}', cover_blob, at_us),
        )
    return uri


IMAGES = 'https://plyr-next-audio.n8-3e9.workers.dev/images/'


def test_every_cover_next_shows_is_checked_however_it_was_written(db, engine, fingerprinter, image_scanner) -> None:
    pds_cover = add_cover(
        db, 1, 'https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:uploader&cid=bafkreicover1', 10
    )
    elsewhere = add_cover(db, 2, 'https://elsewhere.example/c.jpg', 20)
    add_cover(db, 3, 'https://images.plyr.fm/prodcover.jpg', 30)  # prod checked it at upload
    album = add_list(db, 1, 'bafkreialbum', 40)
    add_list(db, 2, None, 50)
    image_scanner.unsafe[f'{IMAGES}bafkreialbum?did=did:plc:uploader'] = Verdict(
        is_safe=False, severity='high', categories=['sexual'], reason='explicit nudity'
    )

    drain(engine)

    assert image_scanner.scanned == [
        f'{IMAGES}bafkreicover1?did=did:plc:uploader',
        'https://elsewhere.example/c.jpg',
        f'{IMAGES}bafkreialbum?did=did:plc:uploader',
    ]
    assert fingerprinter.scanned == []
    assert rows(db, 'SELECT subject_uri, action, actor, reason FROM plyr_moderation.events') == [
        (album, 'flagged_by_scan', 'scan:cover', 'high: sexual: explicit nudity')
    ]
    assert rows(db, 'SELECT record_uri, violations FROM plyr_moderation.image_scans ORDER BY 1') == [
        (album, 1),
        (pds_cover, 0),
        (elsewhere, 0),
    ]
    assert rows(db, 'SELECT name, indexed_at_us FROM plyr_moderation.rule_cursors ORDER BY 1') == [
        ('covers', 40),
        ('tracks', 30),
    ]

    # an edit that keeps the cover comes round again but isn't paid for twice; a new one is checked
    add_list(db, 1, 'bafkreialbum', 60)
    add_cover(db, 2, 'https://elsewhere.example/new.jpg', 70)
    drain(engine)
    assert image_scanner.scanned[3:] == ['https://elsewhere.example/new.jpg']


def test_a_failing_cover_scan_is_retried_then_passed_over(db, engine, fingerprinter, image_scanner) -> None:
    add_cover(db, 1, 'https://elsewhere.example/bad.jpg', 10)
    add_cover(db, 2, 'https://elsewhere.example/ok.jpg', 20)
    image_scanner.failing.add('https://elsewhere.example/bad.jpg')
    for _ in range(MAX_ATTEMPTS + 1):
        drain(engine)
    assert rows(db, 'SELECT image_url FROM plyr_moderation.image_scans') == [('https://elsewhere.example/ok.jpg',)]
