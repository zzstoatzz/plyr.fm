"""storage protocol for type-safe dependency injection."""

from collections.abc import Callable
from io import BytesIO
from typing import BinaryIO, Protocol, runtime_checkable


@runtime_checkable
class StorageProtocol(Protocol):
    """interface for media storage backends."""

    audio_bucket_name: str
    image_bucket_name: str
    public_audio_bucket_url: str
    public_image_bucket_url: str

    async def save(
        self,
        file: BinaryIO | BytesIO,
        filename: str,
        progress_callback: Callable[[float], None] | None = None,
    ) -> str: ...

    async def get_url(
        self,
        file_id: str,
        *,
        file_type: str | None = None,
        extension: str | None = None,
    ) -> str | None: ...

    async def get_file_data(
        self,
        file_id: str,
        file_type: str,
    ) -> bytes | None: ...

    async def delete(self, file_id: str, file_type: str | None = None) -> bool: ...

    async def delete_image(self, file_id: str, image_url: str) -> bool: ...

    async def save_gated(
        self,
        file: BinaryIO | BytesIO,
        filename: str,
        progress_callback: Callable[[float], None] | None = None,
    ) -> str: ...

    async def delete_gated(
        self, file_id: str, file_type: str | None = None
    ) -> bool: ...

    async def generate_presigned_url(
        self,
        file_id: str,
        extension: str,
        expires_in: int | None = None,
    ) -> str: ...

    async def move_audio(
        self,
        file_id: str,
        extension: str,
        *,
        to_private: bool,
    ) -> str | None: ...

    def build_image_url(self, image_id: str, ext: str) -> str: ...

    async def save_thumbnail(self, thumbnail_data: bytes, image_id: str) -> str: ...
