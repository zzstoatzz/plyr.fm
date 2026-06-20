"""tests for the slingshot identity-resolution client."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal.slingshot import resolve_mini_doc, resolve_mini_doc_safe

# a real resolveMiniDoc response shape (verified against the live service).
_MINI_DOC = {
    "did": "did:plc:ygja2cua5eieiepwctxyopcx",
    "handle": "herbs.teal.town",
    "pds": "https://teal.town",
    "signing_key": "zQ3shrePBffzGZv3tEbDyRrBuget7ReqrsEQqRNSQadpkGKsP",
}


class TestResolveMiniDoc:
    async def test_parses_response(self) -> None:
        mock_response = MagicMock()
        mock_response.json.return_value = _MINI_DOC
        mock_response.raise_for_status = MagicMock()

        with patch("backend._internal.slingshot.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            doc = await resolve_mini_doc(_MINI_DOC["did"])

        assert doc["handle"] == "herbs.teal.town"
        assert doc["pds"] == "https://teal.town"

    async def test_calls_resolvemini_doc_endpoint_with_identifier(self) -> None:
        """guards the endpoint contract: the NSID path and `identifier` param.

        slingshot rejects `did=` — the param must be `identifier`.
        """
        mock_response = MagicMock()
        mock_response.json.return_value = _MINI_DOC
        mock_response.raise_for_status = MagicMock()

        with patch("backend._internal.slingshot.httpx.AsyncClient") as mock_client:
            mock_get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.get = mock_get
            await resolve_mini_doc(_MINI_DOC["did"])

        args, kwargs = mock_get.call_args
        assert args[0] == (
            "https://slingshot.microcosm.blue"
            "/xrpc/com.bad-example.identity.resolveMiniDoc"
        )
        assert kwargs["params"] == {"identifier": _MINI_DOC["did"]}

    async def test_raises_on_http_error(self) -> None:
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = Exception("500 error")

        with patch("backend._internal.slingshot.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            with pytest.raises(Exception, match="500 error"):
                await resolve_mini_doc(_MINI_DOC["did"])


class TestResolveMiniDocSafe:
    async def test_returns_doc_on_success(self) -> None:
        mock_response = MagicMock()
        mock_response.json.return_value = _MINI_DOC
        mock_response.raise_for_status = MagicMock()

        with patch("backend._internal.slingshot.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            doc = await resolve_mini_doc_safe(_MINI_DOC["did"])

        assert doc is not None
        assert doc["handle"] == "herbs.teal.town"

    async def test_returns_none_on_error(self) -> None:
        with patch("backend._internal.slingshot.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("connection failed")
            )
            assert await resolve_mini_doc_safe(_MINI_DOC["did"]) is None
