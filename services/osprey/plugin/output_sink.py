"""plyr.fm output sink for Osprey.

handles effects produced by rule evaluation:
- LabelAdd/LabelRemove → calls Rust moderation service POST /emit-label
- custom effects (NotifyUploader, etc.) in later phases
"""

import logging
import os
from typing import Any

import httpx

from osprey.engine.executor.execution_context import ExecutionResult
from osprey.engine.language_types.labels import LabelEffect
from osprey.worker.sinks.sink.output_sink import BaseOutputSink

logger = logging.getLogger(__name__)


class PlyrOutputSink(BaseOutputSink):
    """sends rule effects to the plyr.fm moderation service.

    currently handles label effects (add/remove) by calling
    the Rust labeler's POST /emit-label endpoint.

    later phases will add handling for custom effects like
    NotifyUploader and ScheduleGracePeriod.
    """

    timeout: float = 10.0
    max_retries: int = 2

    def __init__(self, labeler_url: str, auth_token: str) -> None:
        self._labeler_url = labeler_url
        self._auth_token = auth_token

    @classmethod
    def from_env(cls) -> "PlyrOutputSink":
        return cls(
            labeler_url=os.environ.get(
                "MODERATION_LABELER_URL", "https://moderation.plyr.fm"
            ),
            auth_token=os.environ.get("MODERATION_AUTH_TOKEN", ""),
        )

    def _headers(self) -> dict[str, str]:
        return {"X-Moderation-Key": self._auth_token}

    def will_do_work(self, result: ExecutionResult) -> bool:
        """check if this result has any label effects to process."""
        return bool(result.label_effects)

    def push(self, result: ExecutionResult) -> None:
        """process label effects from rule evaluation."""
        for label_effect in result.label_effects:
            self._handle_label_effect(label_effect, result)

    def _handle_label_effect(
        self, effect: LabelEffect, result: ExecutionResult
    ) -> None:
        """emit or negate a label via the Rust moderation service."""
        entity_id = str(effect.entity.id)
        label_val = effect.label

        # determine if this is an add or negate
        is_negation = effect.neg if hasattr(effect, "neg") else False

        payload: dict[str, Any] = {
            "uri": entity_id,
            "val": label_val,
            "neg": is_negation,
        }

        # add context from the action data if available
        action_data = result.action.data if result.action else {}
        if track_id := action_data.get("track_id"):
            context: dict[str, Any] = {"track_id": track_id}
            if artist_handle := action_data.get("artist_handle"):
                context["artist_handle"] = artist_handle
            if artist_did := action_data.get("artist_did"):
                context["artist_did"] = artist_did
            if scan := action_data.get("scan"):
                if isinstance(scan, str):
                    import json

                    scan = json.loads(scan)
                context["highest_score"] = scan.get("highest_score")
                context["matches"] = scan.get("matches")
            payload["context"] = context

        try:
            # use synchronous httpx since Osprey runs on gevent
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    f"{self._labeler_url}/emit-label",
                    json=payload,
                    headers=self._headers(),
                )
                response.raise_for_status()

            action_str = "negated" if is_negation else "added"
            logger.info(
                "label %s: %s on %s",
                action_str,
                label_val,
                entity_id,
            )
        except Exception:
            logger.exception("failed to emit label %s on %s", label_val, entity_id)

    def stop(self) -> None:
        """cleanup — nothing to do for HTTP sink."""
