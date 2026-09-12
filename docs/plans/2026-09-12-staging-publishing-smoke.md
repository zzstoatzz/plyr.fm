# Staging publishing smoke — September 12, 2026

19 unique three-second WAV uploads by the bufo.uk test account using app-password authentication. All upload jobs completed without warnings. No production writes.

| Track | Visibility | Listening | Downloads | Anonymous detail / stream / download |
| --- | --- | --- | --- | --- |
| [9192](https://stg.plyr.fm/track/9192) | public | public | open | 200 / 307 / 307 |
| [9193](https://stg.plyr.fm/track/9193) | public | public | off | 200 / 307 / 403 |
| [9194](https://stg.plyr.fm/track/9194) | public | signed_in | open | 200 / 401 / 307 |
| [9195](https://stg.plyr.fm/track/9195) | public | signed_in | off | 200 / 401 / 403 |
| [9196](https://stg.plyr.fm/track/9196) | public | owner | open | 200 / 401 / 307 |
| [9197](https://stg.plyr.fm/track/9197) | public | owner | off | 200 / 401 / 403 |
| [9198](https://stg.plyr.fm/track/9198) | public | supporters | open | 200 / 401 / 307 |
| [9199](https://stg.plyr.fm/track/9199) | public | supporters | off | 200 / 401 / 403 |
| [9200](https://stg.plyr.fm/track/9200) | unlisted | public | off | 200 / 307 / 403 |
| [9201](https://stg.plyr.fm/track/9201) | unlisted | public | open | 200 / 307 / 307 |
| [9202](https://stg.plyr.fm/track/9202) | unlisted | signed_in | open | 200 / 401 / 307 |
| [9203](https://stg.plyr.fm/track/9203) | unlisted | signed_in | off | 200 / 401 / 403 |
| [9204](https://stg.plyr.fm/track/9204) | unlisted | owner | open | 200 / 401 / 307 |
| [9205](https://stg.plyr.fm/track/9205) | unlisted | owner | off | 200 / 401 / 403 |
| [9206](https://stg.plyr.fm/track/9206) | unlisted | supporters | open | 200 / 401 / 307 |
| [9207](https://stg.plyr.fm/track/9207) | unlisted | supporters | off | 200 / 401 / 403 |
| [9208](https://stg.plyr.fm/track/9208) | public | public | ask | 200 / 307 / 307 |
| [9209](https://stg.plyr.fm/track/9209) | public | public | supporters | 200 / 307 / 401 |
| [9210](https://stg.plyr.fm/track/9210) | private | space | off | 404 / 404 / 404 |

307 responses were followed without forwarding bearer credentials; all returned real audio bytes. Artist playback succeeded for all 19; original downloads succeeded for all 18 non-Space works. Native Space direct download returns 404 by design.

## Discovery and originals

- Latest feed: exactly the ten public fixtures, including labelled restricted-listening works.
- Artist listing: all 18 public/unlisted fixtures; native Space excluded anonymously.
- Radio: default rotation contains exactly the four public/public-listening fixtures. All five station responses exclude every unlisted and gated fixture.
- Top tracks: none of the new fixtures rank because they have no likes. Positive ranking was not tested.
- Nine off/supporter-download originals reject anonymous stream/URL requests and return 404 at the public bucket URL.
- Browser: public/downloads-off playback reached readyState 4 with no media error; artist-only play showed its correct refusal; Space detail showed “track not found”; latest and radio displayed the expected fixtures.

## Limitations and follow-up

- Signed-in non-owner and positively entitled supporter/Space-member checks need a separate account; the saved listener token is expired.
- Restricted streaming with open downloads intentionally still permits downloading the original. These independent settings do not protect those bytes.
- Fixtures are retained for the pending listener checks.
- This run omitted the integration-test tag and triggered staging upload DMs. The harness and project smoke workflow now require that existing suppression tag before further test uploads. Global notifications were not disabled.
