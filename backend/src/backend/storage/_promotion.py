"""Bounded server-side promotion of immutable staged objects."""

import asyncio
from typing import Any

import logfire

COPY_PART_BYTES = 64 * 1024 * 1024
PROMOTION_TIMEOUT_SECONDS = 15 * 60
ABORT_TIMEOUT_SECONDS = 30


async def promote_object(
    client: Any,
    *,
    source_bucket: str,
    source_key: str,
    bucket: str,
    key: str,
    content_type: str,
    cache_control: str,
) -> None:
    multipart_id: str | None = None
    async with asyncio.timeout(PROMOTION_TIMEOUT_SECONDS):
        try:
            source = await client.head_object(Bucket=source_bucket, Key=source_key)
            size = source["ContentLength"]
            target = {"Bucket": bucket, "Key": key}
            source_ref = {"Bucket": source_bucket, "Key": source_key}
            metadata = {"ContentType": content_type, "CacheControl": cache_control}
            if size <= COPY_PART_BYTES:
                result = await client.copy_object(
                    **target,
                    CopySource=source_ref,
                    MetadataDirective="REPLACE",
                    **metadata,
                )
                etag = result["CopyObjectResult"]["ETag"]
            else:
                upload = await client.create_multipart_upload(**target, **metadata)
                multipart_id = upload["UploadId"]
                parts = []
                for number, start in enumerate(range(0, size, COPY_PART_BYTES), 1):
                    end = min(start + COPY_PART_BYTES, size) - 1
                    result = await client.upload_part_copy(
                        **target,
                        UploadId=multipart_id,
                        PartNumber=number,
                        CopySource=source_ref,
                        CopySourceRange=f"bytes={start}-{end}",
                    )
                    parts.append(
                        {"PartNumber": number, "ETag": result["CopyPartResult"]["ETag"]}
                    )
                result = await client.complete_multipart_upload(
                    **target, UploadId=multipart_id, MultipartUpload={"Parts": parts}
                )
                etag = result["ETag"]
                multipart_id = None
            destination = await client.head_object(**target)
            if destination["ContentLength"] != size or destination["ETag"] != etag:
                raise ValueError("promoted audio verification failed")
            await client.delete_object(Bucket=source_bucket, Key=source_key)
        except BaseException:
            if multipart_id is not None:
                try:
                    await asyncio.wait_for(
                        client.abort_multipart_upload(
                            Bucket=bucket, Key=key, UploadId=multipart_id
                        ),
                        timeout=ABORT_TIMEOUT_SECONDS,
                    )
                except Exception:
                    logfire.exception("could not abort staged audio promotion")
            raise
