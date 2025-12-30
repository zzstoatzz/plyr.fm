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

this script:
1. checks bluesky DMs for replies to pending moderation questions
2. parses replies with AI to extract decisions
3. applies decisions to resolve flags
4. analyzes new pending flags
5. auto-resolves high-confidence cases
6. sends questions for ambiguous cases via DM
7. exits (non-blocking)

designed to run on a schedule (e.g., every 5 minutes via GitHub Actions).

usage:
    uv run scripts/moderation_loop.py
    uv run scripts/moderation_loop.py --dry-run
"""

from __future__ import annotations

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

    # moderation service
    moderation_service_url: str = Field(
        default="https://moderation.plyr.fm",
        validation_alias="MODERATION_SERVICE_URL",
    )
    moderation_auth_token: str = Field(
        default="", validation_alias="MODERATION_AUTH_TOKEN"
    )

    # AI
    anthropic_api_key: str = Field(default="", validation_alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(
        default="claude-sonnet-4-20250514", validation_alias="ANTHROPIC_MODEL"
    )

    # bluesky bot for DMs
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
    track_identifiers: list[str] = Field(
        default_factory=list,
        description="track titles, numbers, or URIs mentioned for specific actions",
    )
    reasoning: str = Field(description="extracted reasoning or notes from the reply")
    confidence: float = Field(ge=0.0, le=1.0, description="confidence in parsing")


class ConversationContext(BaseModel):
    """context from recent DM conversation."""

    has_pending_question: bool
    question_text: str | None = None
    question_uris: list[str] = Field(default_factory=list)  # URIs from the question
    reply_text: str | None = None
    decision: ModerationDecision | None = None


class FlagSummary(BaseModel):
    """summary of a flag for the question."""

    uri: str
    track_title: str | None
    artist_handle: str | None
    matches: list[str]  # "Title by Artist"
    ai_reasoning: str


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

        # resolve recipient
        profile = await self._client.app.bsky.actor.get_profile(
            {"actor": self.recipient_handle}
        )
        self._recipient_did = profile.did

        # get conversation
        convo_response = await self._dm_client.chat.bsky.convo.get_convo_for_members(
            models.ChatBskyConvoGetConvoForMembers.Params(members=[self._recipient_did])
        )
        if not convo_response.convo or not convo_response.convo.id:
            raise ValueError("failed to get conversation ID")
        self._convo_id = convo_response.convo.id

    async def get_recent_messages(self, limit: int = 20) -> list[dict]:
        """get recent messages from the conversation."""
        response = await self._dm_client.chat.bsky.convo.get_messages(
            models.ChatBskyConvoGetMessages.Params(
                convo_id=self._convo_id,
                limit=limit,
            )
        )
        messages = []
        for msg in response.messages:
            if hasattr(msg, "text") and hasattr(msg, "sender"):
                messages.append(
                    {
                        "text": msg.text,
                        "sender_did": msg.sender.did,
                        "sent_at": msg.sent_at if hasattr(msg, "sent_at") else None,
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
        """cleanup."""
        pass  # atproto client doesn't need explicit cleanup


# --- moderation service client (simplified from moderation_agent.py) ---


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


def create_reply_parser(
    api_key: str, model: str = "claude-sonnet-4-20250514"
) -> Agent[None, ModerationDecision]:
    """create agent to parse natural language replies."""
    from pydantic_ai.providers.anthropic import AnthropicProvider

    provider = AnthropicProvider(api_key=api_key)
    return Agent(
        model=AnthropicModel(model, provider=provider),
        output_type=ModerationDecision,
        system_prompt="""\
you parse natural language responses to moderation questions.

the human is responding to a question about flagged music tracks. extract their decision:

- "approve_all" - they want to resolve/clear all mentioned flags as false positives
- "reject_all" - they want to keep all flags (actual violations)
- "approve_specific" - they approve specific tracks (extract which ones)
- "reject_specific" - they reject specific tracks (extract which ones)
- "need_clarification" - their response is ambiguous, need to ask again

examples:
- "yeah those are fine" → approve_all
- "approve all except the beatles one" → approve_specific (all except beatles)
- "no, leave them flagged" → reject_all
- "1 and 3 are ok, 2 is actually copyrighted" → approve_specific [1, 3], implicitly reject 2
- "what?" → need_clarification

extract track identifiers as they reference them (numbers, titles, artist names).
""",
    )


def create_flag_analyzer(
    api_key: str, model: str = "claude-sonnet-4-20250514"
) -> Agent[None, dict]:
    """create agent to analyze flags (reuses logic from moderation_agent.py)."""
    from pydantic_ai.providers.anthropic import AnthropicProvider

    provider = AnthropicProvider(api_key=api_key)
    return Agent(
        model=AnthropicModel(model, provider=provider),
        output_type=dict,
        system_prompt="""\
you analyze copyright flags for a music platform.

for each flag, categorize as:
- HIGH_CONFIDENCE_FALSE_POSITIVE: clearly not infringement (fingerprint noise, original artist)
- HIGH_CONFIDENCE_VIOLATION: clearly actual infringement
- NEEDS_HUMAN: ambiguous, need human decision

focus on:
1. does the uploader handle match the matched artist?
2. are the matches unrelated (different genres, languages)?
3. is the matched content well-known commercial music?

return a dict with:
- auto_resolve: list of URIs to auto-resolve as false positives
- auto_reject: list of URIs that are clear violations (keep flagged)
- needs_human: list of {uri, title, artist, matches, reasoning} for ambiguous cases
""",
    )


# --- main logic ---


# message header for identifying moderation questions
def get_moderation_header(env: str = "prod") -> str:
    return f"[PLYR-MOD:{env.upper()}]"


def extract_uris_from_question(question_text: str) -> list[str]:
    """extract URIs from [refs:...] section of a question."""
    import re

    match = re.search(r"\[refs:([^\]]+)\]", question_text)
    if match:
        return [uri.strip() for uri in match.group(1).split(",") if uri.strip()]
    return []


async def check_for_replies(
    dm_client: BlueskyDMClient,
    reply_parser: Agent,
    env: str = "prod",
) -> ConversationContext:
    """check DM conversation for replies to moderation questions."""
    messages = await dm_client.get_recent_messages(limit=30)
    header = get_moderation_header(env)

    # find the most recent bot message with our header
    # and check if there's a human reply after it
    bot_question = None
    human_reply = None

    for i, msg in enumerate(messages):
        if msg["is_from_bot"] and msg["text"].startswith(header):
            bot_question = msg
            # look for human reply after this (messages are newest first)
            for j in range(i - 1, -1, -1):
                if not messages[j]["is_from_bot"]:
                    human_reply = messages[j]
                    break
            break

    if not bot_question:
        return ConversationContext(has_pending_question=False)

    question_uris = extract_uris_from_question(bot_question["text"])

    if not human_reply:
        return ConversationContext(
            has_pending_question=True,
            question_text=bot_question["text"],
            question_uris=question_uris,
        )

    # parse the reply with AI
    prompt = f"""\
the bot asked:
{bot_question["text"]}

the human replied:
{human_reply["text"]}

parse the human's decision.
"""
    result = await reply_parser.run(prompt)

    return ConversationContext(
        has_pending_question=True,
        question_text=bot_question["text"],
        question_uris=question_uris,
        reply_text=human_reply["text"],
        decision=result.output,
    )


def format_question(flags: list[dict], env: str = "prod") -> str:
    """format a moderation question for DM."""
    header = get_moderation_header(env)
    lines = [f"{header}\n"]

    uris = []
    for i, flag in enumerate(flags, 1):
        ctx = flag.get("context", {})
        title = ctx.get("track_title", "unknown")
        artist = ctx.get("artist_handle", "unknown")
        matches = ctx.get("matches", [])
        uris.append(flag["uri"])

        lines.append(f"{i}. '{title}' by @{artist}")
        if matches:
            match_strs = [f"'{m['title']}' by {m['artist']}" for m in matches[:3]]
            lines.append(f"   matches: {', '.join(match_strs)}")
        lines.append("")

    lines.append(
        "reply with your decision (e.g., 'approve all', 'reject 2', 'approve except 3')"
    )
    # include URIs in machine-readable format for reply processing
    lines.append(f"\n[refs:{','.join(uris)}]")

    return "\n".join(lines)


async def run_loop(
    dry_run: bool = False, limit: int | None = None, env: str = "prod"
) -> None:
    """run one iteration of the moderation loop."""
    settings = LoopSettings()

    # validate settings
    missing = []
    if not settings.moderation_auth_token:
        missing.append("MODERATION_AUTH_TOKEN")
    if not settings.anthropic_api_key:
        missing.append("ANTHROPIC_API_KEY")
    if not settings.bot_handle:
        missing.append("NOTIFY_BOT_HANDLE")
    if not settings.bot_password:
        missing.append("NOTIFY_BOT_PASSWORD")
    if not settings.recipient_handle:
        missing.append("NOTIFY_RECIPIENT_HANDLE")

    if missing:
        console.print(f"[red]missing required config: {', '.join(missing)}[/red]")
        return

    console.print("[bold]moderation loop[/bold]")
    console.print(f"service: {settings.moderation_service_url}")
    console.print(f"model: {settings.anthropic_model}")
    if dry_run:
        console.print("[yellow]DRY RUN - no changes will be made[/yellow]")
    console.print()

    # setup clients
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
        console.print("[dim]connected to bluesky[/dim]")

        # step 1: check for replies
        reply_parser = create_reply_parser(
            settings.anthropic_api_key, settings.anthropic_model
        )
        context = await check_for_replies(dm_client, reply_parser, env=env)

        if context.reply_text and context.decision:
            console.print(f"[green]found reply:[/green] {context.reply_text[:100]}...")
            console.print(f"[green]parsed decision:[/green] {context.decision.action}")
            console.print(f"[dim]flags in question: {len(context.question_uris)}[/dim]")

            if context.decision.action == "need_clarification":
                console.print("[yellow]reply was unclear, will ask again[/yellow]")
            elif context.decision.action == "approve_all" and context.question_uris:
                # resolve all flags from the question as false positives
                for uri in context.question_uris:
                    if dry_run:
                        console.print(
                            f"  [yellow]would resolve:[/yellow] {uri[:50]}..."
                        )
                    else:
                        try:
                            await mod_client.resolve_flag(
                                uri,
                                "fingerprint_noise",
                                f"human approved: {context.reply_text[:50]}",
                            )
                            console.print(f"  [green]✓[/green] resolved: {uri[:50]}...")
                        except Exception as e:
                            console.print(f"  [red]✗[/red] failed: {uri[:50]}... ({e})")
            elif context.decision.action == "reject_all" and context.question_uris:
                console.print(
                    "[dim]flags remain as violations (no action needed)[/dim]"
                )
            elif context.decision.action in ("approve_specific", "reject_specific"):
                # TODO: match track identifiers from decision to URIs
                console.print(
                    f"[yellow]specific actions not yet implemented: {context.decision.track_identifiers}[/yellow]"
                )
        elif context.has_pending_question:
            console.print("[yellow]pending question, no reply yet[/yellow]")

        # step 2: get pending flags
        console.print("[dim]fetching pending flags...[/dim]")
        flags = await mod_client.list_pending_flags()

        if not flags:
            console.print("[green]no pending flags[/green]")
            return

        total_flags = len(flags)
        if limit:
            flags = flags[:limit]
            console.print(
                f"[bold]processing {len(flags)} of {total_flags} pending flags[/bold]"
            )
        else:
            console.print(f"[bold]found {len(flags)} pending flags[/bold]")

        # step 3: analyze flags
        analyzer = create_flag_analyzer(
            settings.anthropic_api_key, settings.anthropic_model
        )

        # format flags for analysis
        flag_descriptions = []
        for f in flags:
            ctx = f.get("context", {})
            desc = f"URI: {f['uri']}\n"
            desc += f"Track: {ctx.get('track_title', 'unknown')}\n"
            desc += f"Uploader: @{ctx.get('artist_handle', 'unknown')}\n"
            if ctx.get("matches"):
                desc += "Matches:\n"
                for m in ctx["matches"][:5]:
                    desc += f"  - '{m['title']}' by {m['artist']} (score: {m.get('score', 0):.2f})\n"
            flag_descriptions.append(desc)

        prompt = f"analyze these {len(flag_descriptions)} flags:\n\n" + "\n---\n".join(
            flag_descriptions
        )
        result = await analyzer.run(prompt)
        analysis = result.output

        console.print(
            f"[dim]analysis: {len(analysis.get('auto_resolve', []))} auto-resolve, "
            f"{len(analysis.get('needs_human', []))} need human[/dim]"
        )

        # step 4: auto-resolve high confidence
        auto_resolve = analysis.get("auto_resolve", [])
        if auto_resolve and not dry_run:
            for uri in auto_resolve:
                try:
                    await mod_client.resolve_flag(
                        uri, "fingerprint_noise", "auto-resolved by moderation loop"
                    )
                    console.print(f"  [green]✓[/green] resolved: {uri[:50]}...")
                except Exception as e:
                    console.print(f"  [red]✗[/red] failed: {uri[:50]}... ({e})")

        # step 5: send question for ambiguous
        needs_human = analysis.get("needs_human", [])
        # can send new question if no pending question, or if previous question was answered
        can_send_question = (
            not context.has_pending_question or context.reply_text is not None
        )
        if needs_human and can_send_question:
            question = format_question(
                [f for f in flags if f["uri"] in [h.get("uri") for h in needs_human]],
                env=env,
            )
            console.print("[dim]sending question to DM...[/dim]")
            if not dry_run:
                await dm_client.send_message(question)
                console.print("[green]question sent[/green]")
            else:
                console.print(f"[yellow]would send:[/yellow]\n{question}")

        console.print("\n[bold]loop complete[/bold]")

    finally:
        await mod_client.close()
        await dm_client.close()


def main() -> None:
    """main entry point."""
    parser = argparse.ArgumentParser(description="autonomous moderation loop")
    parser.add_argument("--dry-run", action="store_true", help="don't make changes")
    parser.add_argument(
        "--limit", type=int, default=None, help="limit number of flags to process"
    )
    parser.add_argument(
        "--env",
        type=str,
        default="prod",
        choices=["dev", "staging", "prod"],
        help="environment",
    )
    args = parser.parse_args()

    asyncio.run(run_loop(dry_run=args.dry_run, limit=args.limit, env=args.env))


if __name__ == "__main__":
    main()
