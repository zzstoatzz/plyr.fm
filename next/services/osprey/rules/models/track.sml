ActionName = GetActionName()

Owner: Entity[str] = EntityJson(type='Account', path='$.did')

OwnerDid: str = JsonData(path='$.did', coerce_type=True)

Track: Entity[str] = EntityJson(type='Track', path='$.uri')

OwnerHandle: str = JsonData(path='$.handle', coerce_type=True)

OwnerName: str = JsonData(path='$.display_name', coerce_type=True)

AudioUrl: Optional[str] = JsonData(path='$.audio_url', required=False)

AudioHost: str = UrlHost(url=ResolveOptional(optional_value=AudioUrl, default_value=''))

# the rest are a `track` action's only

# the track's length in seconds as the record claims it (else as next measured it); 0 unknown.
# never trusted for what a scan hears: fingerprint.ScanPlan measures the file
KnownDuration: Optional[int] = JsonData(path='$.duration_seconds', required=False)
DurationSeconds: int = ResolveOptional(optional_value=KnownDuration, default_value=0)

# the uploader's tracks indexed in the day up to and including this one
UploadsInDay: Optional[int] = JsonData(path='$.recent_uploads', required=False)
RecentUploads: int = ResolveOptional(optional_value=UploadsInDay, default_value=0)

# this track was held for scan budget and has come round again to try
HeldBefore: Optional[bool] = JsonData(path='$.held', required=False)
Held: bool = ResolveOptional(optional_value=HeldBefore, default_value=False)

# where next shows the record's cover (a `cover` action), if it's next's to scan
CoverUrl: Optional[str] = JsonData(path='$.cover_url', required=False)

# this audio (or cover) was scanned when an earlier version of the record came by
ScannedBefore: bool = JsonData(path='$.scanned_before', coerce_type=True)
