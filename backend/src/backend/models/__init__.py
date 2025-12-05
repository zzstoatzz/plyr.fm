"""database models."""

from backend.models.album import Album
from backend.models.artist import Artist
from backend.models.copyright_scan import CopyrightScan, ScanResolution
from backend.models.database import Base
from backend.models.sensitive_image import SensitiveImage
from backend.models.exchange_token import ExchangeToken
from backend.models.job import Job
from backend.models.oauth_state import OAuthStateModel
from backend.models.pending_dev_token import PendingDevToken
from backend.models.preferences import UserPreferences
from backend.models.queue import QueueState
from backend.models.session import UserSession
from backend.models.tag import Tag, TrackTag
from backend.models.track import Track
from backend.models.track_comment import TrackComment
from backend.models.track_like import TrackLike
from backend.utilities.database import db_session, get_db, init_db

__all__ = [
    "Album",
    "Artist",
    "Base",
    "CopyrightScan",
    "ExchangeToken",
    "Job",
    "OAuthStateModel",
    "PendingDevToken",
    "QueueState",
    "ScanResolution",
    "SensitiveImage",
    "Tag",
    "Track",
    "TrackComment",
    "TrackLike",
    "TrackTag",
    "UserPreferences",
    "UserSession",
    "db_session",
    "get_db",
    "init_db",
]
