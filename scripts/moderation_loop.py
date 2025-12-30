#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "pydantic-ai>=0.1.0",
#     "anthropic",
#     "httpx",
#     "pydantic>=2.0",
#     "pydantic-settings",
#     "atproto>=0.0.55",
#     "rich",
# ]
# ///
"""autonomous moderation loop for plyr.fm.

workflow:
1. fetch pending flags from moderation service
2. analyze each flag with LLM (FALSE_POSITIVE, VIOLATION, NEEDS_HUMAN)
3. auto-resolve false positives
4. create review batch for needs_human flags
5. send DM with link to review UI

the review UI handles human decisions - DM is just a notification channel.
"""

import argparse
import asyncio
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from atproto import AsyncClient, models
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console

console = Console()


class LoopSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent / ".env",
        case_sensitive=False,
        extra="ignore",
    )
    moderation_service_url: str = Field(
        default="https://moderation.plyr.fm", validation_alias="MODERATION_SERVICE_URL"
    )
    moderation_auth_token: str = Field(
        default="", validation_alias="MODERATION_AUTH_TOKEN"
    )
    anthropic_api_key: str = Field(default="", validation_alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(
        default="claude-sonnet-4-20250514", validation_alias="ANTHROPIC_MODEL"
    )
    bot_handle: str = Field(default="", validation_alias="NOTIFY_BOT_HANDLE")
    bot_password: str = Field(default="", validation_alias="NOTIFY_BOT_PASSWORD")
    recipient_handle: str = Field(
        default="", validation_alias="NOTIFY_RECIPIENT_HANDLE"
    )


class FlagAnalysis(BaseModel):
    """result of analyzing a single flag."""

    uri: str
    category: str = Field(description="FALSE_POSITIVE, VIOLATION, or NEEDS_HUMAN")
    reason: str


@dataclass
class DMClient:
    handle: str
    password: str
    recipient_handle: str
    _client: AsyncClient = field(init=False, repr=False)
    _dm_client: AsyncClient = field(init=False, repr=False)
    _recipient_did: str = field(init=False, repr=False)
    _convo_id: str = field(init=False, repr=False)

    async def setup(self) -> None:
        self._client = AsyncClient()
        await self._client.login(self.handle, self.password)
        self._dm_client = self._client.with_bsky_chat_proxy()
        profile = await self._client.app.bsky.actor.get_profile(
            {"actor": self.recipient_handle}
        )
        self._recipient_did = profile.did
        convo = await self._dm_client.chat.bsky.convo.get_convo_for_members(
            models.ChatBskyConvoGetConvoForMembers.Params(members=[self._recipient_did])
        )
        self._convo_id = convo.convo.id

    async def get_messages(self, limit: int = 30) -> list[dict]:
        response = await self._dm_client.chat.bsky.convo.get_messages(
            models.ChatBskyConvoGetMessages.Params(convo_id=self._convo_id, limit=limit)
        )
        return [
            {
                "text": m.text,
                "is_bot": m.sender.did != self._recipient_did,
                "sent_at": getattr(m, "sent_at", None),
            }
            for m in response.messages
            if hasattr(m, "text") and hasattr(m, "sender")
        ]

    async def send(self, text: str) -> None:
        await self._dm_client.chat.bsky.convo.send_message(
            models.ChatBskyConvoSendMessage.Data(
                convo_id=self._convo_id,
                message=models.ChatBskyConvoDefs.MessageInput(text=text),
            )
        )


@dataclass
class ModClient:
    base_url: str
    auth_token: str
    _client: httpx.AsyncClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-Moderation-Key": self.auth_token},
            timeout=30.0,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def list_pending(self) -> list[dict]:
        r = await self._client.get("/admin/flags", params={"filter": "pending"})
        r.raise_for_status()
        return r.json().get("tracks", [])

    async def resolve(self, uri: str, reason: str, notes: str = "") -> None:
        r = await self._client.post(
            "/admin/resolve",
            json={
                "uri": uri,
                "val": "copyright-violation",
                "reason": reason,
                "notes": notes,
            },
        )
        r.raise_for_status()

    async def create_batch(
        self, uris: list[str], created_by: str | None = None
    ) -> dict:
        """create a review batch and return {id, url, flag_count}."""
        r = await self._client.post(
            "/admin/batches",
            json={"uris": uris, "created_by": created_by},
        )
        r.raise_for_status()
        return r.json()


def get_header(env: str) -> str:
    return f"[PLYR-MOD:{env.upper()}]"


def create_flag_analyzer(api_key: str, model: str) -> Agent[None, list[FlagAnalysis]]:
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return Agent(
        model=AnthropicModel(model, provider=AnthropicProvider(api_key=api_key)),
        output_type=list[FlagAnalysis],
        system_prompt="""\
analyze each copyright flag. categorize as:
- FALSE_POSITIVE: fingerprint noise, uploader is the artist, unrelated matches
- VIOLATION: clearly copyrighted commercial content
- NEEDS_HUMAN: ambiguous, need human review

return a FlagAnalysis for each flag with uri, category, and brief reason.
""",
    )


async def run_loop(
    dry_run: bool = False, limit: int | None = None, env: str = "prod"
) -> None:
    settings = LoopSettings()
    for attr in [
        "moderation_auth_token",
        "anthropic_api_key",
        "bot_handle",
        "bot_password",
        "recipient_handle",
    ]:
        if not getattr(settings, attr):
            console.print(f"[red]missing {attr}[/red]")
            return

    console.print(f"[bold]moderation loop[/bold] ({settings.anthropic_model})")
    if dry_run:
        console.print("[yellow]DRY RUN[/yellow]")

    dm = DMClient(settings.bot_handle, settings.bot_password, settings.recipient_handle)
    mod = ModClient(settings.moderation_service_url, settings.moderation_auth_token)

    try:
        await dm.setup()

        # get pending flags
        pending = await mod.list_pending()
        if not pending:
            console.print("[green]no pending flags[/green]")
            return

        console.print(f"[bold]{len(pending)} pending flags[/bold]")

        # analyze flags
        if limit:
            pending = pending[:limit]

        analyzer = create_flag_analyzer(
            settings.anthropic_api_key, settings.anthropic_model
        )
        desc = "\n---\n".join(
            f"URI: {f['uri']}\nTrack: {f.get('context', {}).get('track_title', '?')}\n"
            f"Uploader: @{f.get('context', {}).get('artist_handle', '?')}\n"
            f"Matches: {', '.join(m['artist'] for m in f.get('context', {}).get('matches', [])[:3])}"
            for f in pending
        )
        result = await analyzer.run(f"analyze {len(pending)} flags:\n\n{desc}")
        analyses = result.output

        # auto-resolve false positives
        auto = [a for a in analyses if a.category == "FALSE_POSITIVE"]
        human = [a for a in analyses if a.category == "NEEDS_HUMAN"]
        console.print(f"analysis: {len(auto)} auto-resolve, {len(human)} need human")

        for a in auto:
            if not dry_run:
                try:
                    await mod.resolve(
                        a.uri, "fingerprint_noise", f"auto: {a.reason[:50]}"
                    )
                    console.print(f"  [green]✓[/green] {a.uri[-40:]}")
                except Exception as e:
                    console.print(f"  [red]✗[/red] {e}")

        # create batch and send link for needs_human (if any)
        if human:
            human_uris = [h.uri for h in human]
            console.print(f"[dim]creating batch for {len(human_uris)} flags...[/dim]")

            if not dry_run:
                batch = await mod.create_batch(human_uris, created_by="moderation_loop")
                msg = f"{get_header(env)} {batch['flag_count']} need review:\n{batch['url']}"
                await dm.send(msg)
                console.print(f"[green]sent batch {batch['id']}[/green]")
            else:
                console.print(
                    f"[yellow]would create batch with {len(human_uris)} flags[/yellow]"
                )

        console.print("[bold]done[/bold]")

    finally:
        await mod.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--env", default="prod", choices=["dev", "staging", "prod"])
    args = parser.parse_args()
    asyncio.run(run_loop(dry_run=args.dry_run, limit=args.limit, env=args.env))


if __name__ == "__main__":
    main()
