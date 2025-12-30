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

simplified flow:
1. check DMs for reply to pending question
2. if reply found, apply decision to all pending "needs human" flags
3. analyze pending flags (auto-resolve high confidence)
4. send ONE compact message for flags needing human review
5. exit (non-blocking)

the moderation service is the source of truth for pending flags.
DMs are just the communication channel.

usage:
    uv run scripts/moderation_loop.py
    uv run scripts/moderation_loop.py --dry-run
    uv run scripts/moderation_loop.py --limit 50
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


# --- settings ---


class LoopSettings(BaseSettings):
    """settings for moderation loop."""

    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent / ".env",
        case_sensitive=False,
        extra="ignore",
    )

    moderation_service_url: str = Field(
        default="https://moderation.plyr.fm",
        validation_alias="MODERATION_SERVICE_URL",
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


# --- models ---


class ModerationDecision(BaseModel):
    """parsed decision from natural language reply."""

    action: str = Field(
        description="one of: approve_all, reject_all, approve_specific, reject_specific, need_clarification"
    )
    approved_numbers: list[int] = Field(
        default_factory=list, description="flag numbers to approve (1-indexed)"
    )
    rejected_numbers: list[int] = Field(
        default_factory=list, description="flag numbers to reject (1-indexed)"
    )
    confidence: float = Field(ge=0.0, le=1.0, description="confidence in parsing")


class FlagForHuman(BaseModel):
    """a flag that needs human review."""

    uri: str = Field(description="AT-URI of the flagged track")
    title: str = Field(description="track title")
    artist: str = Field(description="uploader handle")
    top_match: str = Field(description="top matched artist name")


class FlagAnalysis(BaseModel):
    """result of analyzing pending flags."""

    auto_resolve: list[str] = Field(
        default_factory=list, description="URIs to auto-resolve as false positives"
    )
    auto_reject: list[str] = Field(
        default_factory=list, description="URIs that are clear violations"
    )
    needs_human: list[FlagForHuman] = Field(
        default_factory=list, description="flags needing human review"
    )


# --- bluesky DM client ---


@dataclass
class BlueskyDMClient:
    """client for bluesky DMs."""

    handle: str
    password: str
    recipient_handle: str
    _client: AsyncClient = field(init=False, repr=False)
    _dm_client: AsyncClient = field(init=False, repr=False)
    _recipient_did: str = field(init=False, repr=False)
    _convo_id: str = field(init=False, repr=False)

    async def setup(self) -> None:
        """authenticate and get conversation."""
        self._client = AsyncClient()
        await self._client.login(self.handle, self.password)
        self._dm_client = self._client.with_bsky_chat_proxy()

        profile = await self._client.app.bsky.actor.get_profile(
            {"actor": self.recipient_handle}
        )
        self._recipient_did = profile.did

        convo_response = await self._dm_client.chat.bsky.convo.get_convo_for_members(
            models.ChatBskyConvoGetConvoForMembers.Params(members=[self._recipient_did])
        )
        if not convo_response.convo or not convo_response.convo.id:
            raise ValueError("failed to get conversation ID")
        self._convo_id = convo_response.convo.id

    async def get_recent_messages(self, limit: int = 20) -> list[dict]:
        """get recent messages from the conversation."""
        response = await self._dm_client.chat.bsky.convo.get_messages(
            models.ChatBskyConvoGetMessages.Params(convo_id=self._convo_id, limit=limit)
        )
        messages = []
        for msg in response.messages:
            if hasattr(msg, "text") and hasattr(msg, "sender"):
                messages.append(
                    {
                        "text": msg.text,
                        "sender_did": msg.sender.did,
                        "sent_at": getattr(msg, "sent_at", None),
                        "is_from_bot": msg.sender.did != self._recipient_did,
                    }
                )
        return messages

    async def send_message(self, text: str) -> None:
        """send a DM."""
        await self._dm_client.chat.bsky.convo.send_message(
            models.ChatBskyConvoSendMessage.Data(
                convo_id=self._convo_id,
                message=models.ChatBskyConvoDefs.MessageInput(text=text),
            )
        )

    async def close(self) -> None:
        pass


# --- moderation service client ---


@dataclass
class ModerationClient:
    """client for the moderation service API."""

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

    async def list_pending_flags(self) -> list[dict]:
        """list pending flags."""
        response = await self._client.get("/admin/flags", params={"filter": "pending"})
        response.raise_for_status()
        return response.json().get("tracks", [])

    async def resolve_flag(
        self, uri: str, reason: str, notes: str | None = None
    ) -> dict:
        """resolve a flag."""
        payload = {"uri": uri, "val": "copyright-violation", "reason": reason}
        if notes:
            payload["notes"] = notes
        response = await self._client.post("/admin/resolve", json=payload)
        response.raise_for_status()
        return response.json()


# --- AI agents ---


def create_reply_parser(api_key: str, model: str) -> Agent[None, ModerationDecision]:
    """create agent to parse natural language replies."""
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return Agent(
        model=AnthropicModel(model, provider=AnthropicProvider(api_key=api_key)),
        output_type=ModerationDecision,
        system_prompt="""\
parse natural language responses to moderation questions about flagged music tracks.

actions:
- approve_all: resolve all flags as false positives
- reject_all: keep all flags (actual violations)
- approve_specific: approve only certain flags (populate approved_numbers)
- reject_specific: reject only certain flags (populate rejected_numbers)
- need_clarification: response is ambiguous

numbers are 1-indexed from the question list.
"approve 1,3,5" → approve_specific with approved_numbers=[1,3,5]
"all good" → approve_all
"reject the jackson 5 one" → try to identify which number that was
""",
    )


def create_flag_analyzer(api_key: str, model: str) -> Agent[None, FlagAnalysis]:
    """create agent to analyze flags."""
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return Agent(
        model=AnthropicModel(model, provider=AnthropicProvider(api_key=api_key)),
        output_type=FlagAnalysis,
        system_prompt="""\
analyze copyright flags for a music platform.

categorize each as:
- HIGH_CONFIDENCE_FALSE_POSITIVE: clearly not infringement (fingerprint noise, original artist uploading their own work)
- HIGH_CONFIDENCE_VIOLATION: clearly actual infringement
- NEEDS_HUMAN: ambiguous, need human decision

focus on:
1. does uploader handle match the matched artist?
2. are matches unrelated (different genres, languages)?
3. is matched content well-known commercial music?
""",
    )


# --- main logic ---


def get_header(env: str) -> str:
    return f"[PLYR-MOD:{env.upper()}]"


def format_compact_question(flags: list[dict], env: str) -> str:
    """format a compact question that fits in DM limit."""
    lines = [f"{get_header(env)} {len(flags)} need review:"]
    for i, f in enumerate(flags, 1):
        ctx = f.get("context", {})
        title = ctx.get("track_title", "?")[:25]
        artist = ctx.get("artist_handle", "?")[:15]
        matches = ctx.get("matches", [])
        top_match = matches[0]["artist"][:15] if matches else "?"
        lines.append(f"{i}. {title} @{artist} → {top_match}")
    return "\n".join(lines)


async def check_for_reply(
    dm_client: BlueskyDMClient, reply_parser: Agent, env: str
) -> tuple[ModerationDecision | None, str | None]:
    """check for human reply to most recent bot question. returns (decision, reply_text)."""
    messages = await dm_client.get_recent_messages(limit=30)
    header = get_header(env)

    # find most recent bot question with header
    bot_msg = None
    bot_idx = None
    for i, msg in enumerate(messages):
        if msg["is_from_bot"] and msg["text"].startswith(header):
            bot_msg = msg
            bot_idx = i
            break

    if not bot_msg:
        return None, None

    # find human reply after it (messages are newest-first)
    human_reply = None
    for j in range(bot_idx - 1, -1, -1):
        if not messages[j]["is_from_bot"]:
            human_reply = messages[j]
            break

    if not human_reply:
        return None, None

    # parse the reply
    prompt = f"question:\n{bot_msg['text']}\n\nreply:\n{human_reply['text']}"
    result = await reply_parser.run(prompt)
    return result.output, human_reply["text"]


async def run_loop(
    dry_run: bool = False, limit: int | None = None, env: str = "prod"
) -> None:
    """run one iteration of the moderation loop."""
    settings = LoopSettings()

    missing = []
    for attr, name in [
        ("moderation_auth_token", "MODERATION_AUTH_TOKEN"),
        ("anthropic_api_key", "ANTHROPIC_API_KEY"),
        ("bot_handle", "NOTIFY_BOT_HANDLE"),
        ("bot_password", "NOTIFY_BOT_PASSWORD"),
        ("recipient_handle", "NOTIFY_RECIPIENT_HANDLE"),
    ]:
        if not getattr(settings, attr):
            missing.append(name)
    if missing:
        console.print(f"[red]missing: {', '.join(missing)}[/red]")
        return

    console.print(f"[bold]moderation loop[/bold] ({settings.anthropic_model})")
    if dry_run:
        console.print("[yellow]DRY RUN[/yellow]")

    dm_client = BlueskyDMClient(
        handle=settings.bot_handle,
        password=settings.bot_password,
        recipient_handle=settings.recipient_handle,
    )
    mod_client = ModerationClient(
        base_url=settings.moderation_service_url,
        auth_token=settings.moderation_auth_token,
    )

    try:
        await dm_client.setup()

        # step 1: get all pending flags
        flags = await mod_client.list_pending_flags()
        if not flags:
            console.print("[green]no pending flags[/green]")
            return

        total = len(flags)
        if limit:
            flags = flags[:limit]
        console.print(f"[bold]{len(flags)}/{total} pending flags[/bold]")

        # step 2: analyze flags
        analyzer = create_flag_analyzer(
            settings.anthropic_api_key, settings.anthropic_model
        )
        descriptions = []
        for f in flags:
            ctx = f.get("context", {})
            desc = f"URI: {f['uri']}\nTrack: {ctx.get('track_title', '?')}\nUploader: @{ctx.get('artist_handle', '?')}\n"
            if ctx.get("matches"):
                desc += "Matches: " + ", ".join(
                    f"'{m['title']}' by {m['artist']}" for m in ctx["matches"][:3]
                )
            descriptions.append(desc)

        result = await analyzer.run(
            f"analyze {len(descriptions)} flags:\n\n" + "\n---\n".join(descriptions)
        )
        analysis: FlagAnalysis = result.output

        auto_resolve = analysis.auto_resolve
        needs_human = list(analysis.needs_human)  # copy so we can clear it
        console.print(f"analysis: {len(auto_resolve)} auto, {len(needs_human)} human")

        # step 3: check for reply (applies to needs_human flags)
        if needs_human:
            reply_parser = create_reply_parser(
                settings.anthropic_api_key, settings.anthropic_model
            )
            decision, reply_text = await check_for_reply(dm_client, reply_parser, env)

            if decision and reply_text:
                console.print(f"[green]reply:[/green] {reply_text[:80]}...")
                console.print(f"[green]decision:[/green] {decision.action}")

                human_uris = [h.uri for h in needs_human]

                if decision.action == "approve_all":
                    for uri in human_uris:
                        if not dry_run:
                            try:
                                await mod_client.resolve_flag(
                                    uri,
                                    "fingerprint_noise",
                                    f"human: {reply_text[:30]}",
                                )
                                console.print(f"  [green]✓[/green] {uri[-30:]}")
                            except Exception as e:
                                console.print(f"  [red]✗[/red] {uri[-30:]} ({e})")
                        else:
                            console.print(
                                f"  [yellow]would resolve[/yellow] {uri[-30:]}"
                            )
                    needs_human = []  # cleared

                elif decision.action == "reject_all":
                    console.print("[dim]kept as violations[/dim]")
                    needs_human = []  # acknowledged

                elif (
                    decision.action == "approve_specific" and decision.approved_numbers
                ):
                    for num in decision.approved_numbers:
                        if 1 <= num <= len(human_uris):
                            uri = human_uris[num - 1]
                            if not dry_run:
                                try:
                                    await mod_client.resolve_flag(
                                        uri,
                                        "fingerprint_noise",
                                        f"human: {reply_text[:30]}",
                                    )
                                    console.print(
                                        f"  [green]✓[/green] #{num} {uri[-30:]}"
                                    )
                                except Exception as e:
                                    console.print(f"  [red]✗[/red] #{num} ({e})")
                    needs_human = []

        # step 4: auto-resolve high confidence
        for uri in auto_resolve:
            if not dry_run:
                try:
                    await mod_client.resolve_flag(uri, "fingerprint_noise", "auto")
                    console.print(f"  [green]✓[/green] {uri[-30:]}")
                except Exception as e:
                    console.print(f"  [red]✗[/red] {uri[-30:]} ({e})")

        # step 5: send question for remaining needs_human
        if needs_human:
            human_flags = [f for f in flags if f["uri"] in [h.uri for h in needs_human]]
            question = format_compact_question(human_flags, env)
            console.print(f"[dim]sending question ({len(question)} chars)...[/dim]")
            if not dry_run:
                await dm_client.send_message(question)
                console.print("[green]sent[/green]")
            else:
                console.print(f"[yellow]would send:[/yellow]\n{question}")

        console.print("[bold]done[/bold]")

    finally:
        await mod_client.close()
        await dm_client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="autonomous moderation loop")
    parser.add_argument("--dry-run", action="store_true", help="don't make changes")
    parser.add_argument("--limit", type=int, default=None, help="max flags to process")
    parser.add_argument("--env", default="prod", choices=["dev", "staging", "prod"])
    args = parser.parse_args()
    asyncio.run(run_loop(dry_run=args.dry_run, limit=args.limit, env=args.env))


if __name__ == "__main__":
    main()
