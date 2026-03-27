# base entities and action type discriminators for plyr.fm moderation

TrackId: Entity[int] = EntityJson(type='Track', path='$.track_id', coerce_type=True)
ArtistDid: Entity[str] = EntityJson(type='User', path='$.artist_did', coerce_type=True)
TrackAtUri: Entity[str] = EntityJson(type='Uri', path='$.track_at_uri', coerce_type=True)
ActionType = JsonData(path='$.action_type')

# action type predicates
IsCopyrightScan = ActionType == 'copyright_scan_completed'
IsImageScan = ActionType == 'image_scanned'
IsUserLogin = ActionType == 'user_login'
IsTrackUpload = ActionType == 'track_uploaded'
