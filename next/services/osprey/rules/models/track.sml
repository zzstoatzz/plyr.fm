ActionName = GetActionName()

Owner: Entity[str] = EntityJson(type='Account', path='$.did')

Track: Entity[str] = EntityJson(type='Track', path='$.uri')

OwnerHandle: str = JsonData(path='$.handle', coerce_type=True)

OwnerName: str = JsonData(path='$.display_name', coerce_type=True)

AudioUrl: Optional[str] = JsonData(path='$.audio_url', required=False)

AudioHost: str = UrlHost(url=ResolveOptional(optional_value=AudioUrl, default_value=''))

# this audio was fingerprinted when an earlier version of the record came by
ScannedBefore: bool = JsonData(path='$.scanned_before', coerce_type=True)
