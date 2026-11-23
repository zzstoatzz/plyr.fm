"""end to end: a track written straight to a PDS gets scanned by next's rules.

writes an unlisted fm.plyr.track with only an audioBlob (a few seconds of a
tone) to the test account's PDS, the way a client that never talks to plyr
would, then waits for next to index it and copy its blob, runs the rules
worker once, and checks that the copy was fingerprinted. the record is deleted
afterwards whatever happens.

env: TEST_HANDLE, TEST_PASSWORD (an app password), DATABASE_URL (next's db),
and what scripts/run needs.
"""

import io
import json
import math
import os
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import wave
from datetime import UTC, datetime
from pathlib import Path

import psycopg2

HERE = Path(__file__).parent
COLLECTION = 'fm.plyr.track'
WAIT_SECONDS = 300


def call(url: str, *, body: bytes | None = None, token: str | None = None, content_type: str = 'application/json'):
    request = urllib.request.Request(url, data=body, method='POST' if body is not None else 'GET')
    request.add_header('user-agent', 'plyr.fm-next-direct-pds-check')
    if body is not None:
        request.add_header('content-type', content_type)
    if token:
        request.add_header('authorization', f'Bearer {token}')
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    return json.loads(raw) if raw else {}


def pds_of(handle: str) -> tuple[str, str]:
    query = urllib.parse.urlencode({'handle': handle})
    did = call(f'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?{query}')['did']
    doc = (
        call(f'https://plc.directory/{did}')
        if did.startswith('did:plc:')
        else call(f'https://{did.removeprefix("did:web:")}/.well-known/did.json')
    )
    service = next(s for s in doc['service'] if s['id'].endswith('#atproto_pds'))
    return did, service['serviceEndpoint'].rstrip('/')


def tone(seconds: int = 6, rate: int = 22050) -> bytes:
    """a sine sweep, unique per run so the blob is new every time."""
    start = 300 + (int(time.time()) % 400)
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        frames = bytearray()
        for i in range(seconds * rate):
            t = i / rate
            frames += struct.pack('<h', int(8000 * math.sin(2 * math.pi * (start + 40 * t) * t)))
        out.writeframes(bytes(frames))
    return buffer.getvalue()


def wait_for(conn, sql: str, args: tuple, what: str):
    deadline = time.time() + WAIT_SECONDS
    while time.time() < deadline:
        with conn, conn.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
        if row:
            print(f'{what}: {row}', flush=True)
            return row
        time.sleep(5)
    sys.exit(f'timed out waiting for {what}')


def main() -> None:
    handle, password = os.environ['TEST_HANDLE'], os.environ['TEST_PASSWORD']
    did, pds = pds_of(handle)
    session = call(
        f'{pds}/xrpc/com.atproto.server.createSession',
        body=json.dumps({'identifier': handle, 'password': password}).encode(),
    )
    token = session['accessJwt']
    blob = call(f'{pds}/xrpc/com.atproto.repo.uploadBlob', body=tone(), token=token, content_type='audio/wav')['blob']
    record = {
        '$type': COLLECTION,
        'title': 'direct-to-PDS check',
        'artist': handle,
        'fileType': 'wav',
        'duration': 6,
        'visibility': 'unlisted',
        'createdAt': datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        'audioBlob': blob,
    }
    created = call(
        f'{pds}/xrpc/com.atproto.repo.createRecord',
        body=json.dumps({'repo': did, 'collection': COLLECTION, 'record': record}).encode(),
        token=token,
    )
    uri = created['uri']
    print(f'wrote {uri} with blob {blob["ref"]["$link"]} on {pds}', flush=True)
    try:
        conn = psycopg2.connect(os.environ['DATABASE_URL'].replace('postgresql+psycopg://', 'postgresql://'))
        wait_for(
            conn,
            'SELECT audio_url, audio_blob_cid FROM plyr_index.track_records WHERE record_uri = %s AND NOT deleted',
            (uri,),
            'indexed',
        )
        (copy,) = wait_for(
            conn,
            """SELECT d.origin_url FROM plyr_index.track_delivery_origins d
               JOIN plyr_index.track_records t ON t.record_uri = d.record_uri AND t.audio_blob_cid = d.artifact_cid
               WHERE d.record_uri = %s""",
            (uri,),
            'verified copy',
        )
        subprocess.run([str(HERE / 'run')], check=True, env={**os.environ, 'OSPREY_DRAIN_ONCE': 'true'})
        with conn, conn.cursor() as cur:
            cur.execute('SELECT audio_url, recordings_found FROM plyr_moderation.scans WHERE record_uri = %s', (uri,))
            scans = cur.fetchall()
        print(f'scans: {scans}', flush=True)
        if not any(audio == copy for audio, _ in scans):
            sys.exit(f'{uri} was not scanned at {copy}')
        print('ok: the direct-to-PDS track was scanned at its verified copy', flush=True)
    finally:
        call(
            f'{pds}/xrpc/com.atproto.repo.deleteRecord',
            body=json.dumps({'repo': did, 'collection': COLLECTION, 'rkey': uri.rsplit('/', 1)[1]}).encode(),
            token=token,
        )
        print(f'deleted {uri}', flush=True)


if __name__ == '__main__':
    main()
