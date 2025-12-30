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

state machine:
1. check for outstanding question
2. if outstanding + no reply → WAIT (just auto-resolve, don't ask more)
3. if outstanding + reply → PROCESS (apply decision to those flags)
4. if no outstanding → analyze pending, ask about needs_human

the question text contains flag info (titles) - we parse it to know
which flags a reply applies to.
"""

import argparse
import asyncio
import re
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


class ModerationDecision(BaseModel):
    """parsed decision from natural language reply."""

    action: str = Field(
        description="approve_all, reject_all, approve_specific, reject_specific, need_clarification"
    )
    approved_numbers: list[int] = Field(
        default_factory=list, description="1-indexed flag numbers to approve"
    )
    rejected_numbers: list[int] = Field(
        default_factory=list, description="1-indexed flag numbers to reject"
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


def get_header(env: str) -> str:
    return f"[PLYR-MOD:{env.upper()}]"


def parse_question_flags(question_text: str) -> list[str]:
    """extract flag titles from a question message."""
    # format: "1. Title @artist → Match"
    titles = []
    for line in question_text.split("\n"):
        match = re.match(r"^\d+\.\s+(.+?)\s+@", line)
        if match:
            titles.append(match.group(1).strip())
    return titles


def format_question(flags: list[dict], env: str) -> str:
    """format compact question. includes flag URIs at end for tracking."""
    lines = [f"{get_header(env)} {len(flags)} need review:"]
    uris = []
    for i, f in enumerate(flags, 1):
        ctx = f.get("context", {})
        title = ctx.get("track_title", "?")[:30]
        artist = ctx.get("artist_handle", "?")[:15]
        matches = ctx.get("matches", [])
        top = matches[0]["artist"][:15] if matches else "?"
        lines.append(f"{i}. {title} @{artist} → {top}")
        uris.append(f["uri"])
    # append URIs in compact form for reply processing
    lines.append(f"[{','.join(uris)}]")
    return "\n".join(lines)


def extract_uris_from_question(text: str) -> list[str]:
    """extract URIs from the [uri1,uri2,...] at end of question."""
    match = re.search(r"\[(at://[^\]]+)\]$", text, re.MULTILINE)
    if match:
        return [u.strip() for u in match.group(1).split(",")]
    return []


def create_reply_parser(api_key: str, model: str) -> Agent[None, ModerationDecision]:
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return Agent(
        model=AnthropicModel(model, provider=AnthropicProvider(api_key=api_key)),
        output_type=ModerationDecision,
        system_prompt="""\
parse the human's reply to a moderation question about flagged music tracks.

actions:
- approve_all: clear all flags as false positives ("all good", "approve", "fine")
- reject_all: keep all as violations ("reject all", "keep flagged", "real violations")
- approve_specific: approve only certain numbers ("approve 1,3", "1 and 3 are fine")
- reject_specific: reject only certain numbers ("reject 2", "2 is real")
- need_clarification: unclear response

numbers are 1-indexed from the question.
""",
    )


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

        # step 1: check conversation state
        messages = await dm.get_messages(limit=50)
        header = get_header(env)

        # find most recent bot question
        bot_question = None
        bot_idx = None
        for i, m in enumerate(messages):
            if m["is_bot"] and m["text"].startswith(header):
                bot_question = m
                bot_idx = i
                break

        # find human reply after it
        human_reply = None
        if bot_question and bot_idx is not None:
            for j in range(bot_idx - 1, -1, -1):
                if not messages[j]["is_bot"]:
                    human_reply = messages[j]
                    break

        # step 2: get pending flags
        pending = await mod.list_pending()
        if not pending:
            console.print("[green]no pending flags[/green]")
            return

        console.print(f"[bold]{len(pending)} pending flags[/bold]")

        # step 3: handle state
        if bot_question and not human_reply:
            # WAITING state - don't send more questions
            console.print("[yellow]waiting for reply to previous question[/yellow]")
            console.print(f"[dim]question: {bot_question['text'][:100]}...[/dim]")
            # still do auto-resolve for high-confidence
            # (skip for now to keep simple)
            return

        if bot_question and human_reply:
            # PROCESS state - apply decision
            console.print(f"[green]found reply:[/green] {human_reply['text'][:80]}")

            # parse the reply
            parser = create_reply_parser(
                settings.anthropic_api_key, settings.anthropic_model
            )
            result = await parser.run(
                f"question:\n{bot_question['text']}\n\nreply:\n{human_reply['text']}"
            )
            decision = result.output
            console.print(f"[green]decision:[/green] {decision.action}")

            # get URIs from the question
            question_uris = extract_uris_from_question(bot_question["text"])
            console.print(f"[dim]question had {len(question_uris)} flags[/dim]")

            if decision.action == "approve_all":
                for uri in question_uris:
                    if not dry_run:
                        try:
                            await mod.resolve(
                                uri, "fingerprint_noise", "human approved"
                            )
                            console.print(f"  [green]✓[/green] resolved {uri[-40:]}")
                        except Exception as e:
                            console.print(f"  [red]✗[/red] {e}")
                    else:
                        console.print(f"  [yellow]would resolve[/yellow] {uri[-40:]}")

            elif decision.action == "reject_all":
                console.print("[dim]keeping all as violations (no action needed)[/dim]")
                # TODO: mark as "reviewed" so we don't re-ask?

            elif decision.action == "approve_specific":
                for num in decision.approved_numbers:
                    if 1 <= num <= len(question_uris):
                        uri = question_uris[num - 1]
                        if not dry_run:
                            try:
                                await mod.resolve(
                                    uri, "fingerprint_noise", "human approved"
                                )
                                console.print(f"  [green]✓[/green] #{num} resolved")
                            except Exception as e:
                                console.print(f"  [red]✗[/red] #{num} {e}")

            elif decision.action == "reject_specific":
                # approve all except the rejected ones
                for i, uri in enumerate(question_uris, 1):
                    if i not in decision.rejected_numbers:
                        if not dry_run:
                            try:
                                await mod.resolve(
                                    uri, "fingerprint_noise", "human approved"
                                )
                                console.print(f"  [green]✓[/green] #{i} resolved")
                            except Exception as e:
                                console.print(f"  [red]✗[/red] #{i} {e}")

            elif decision.action == "need_clarification":
                console.print("[yellow]reply unclear, will re-ask[/yellow]")

            # refresh pending list
            pending = await mod.list_pending()
            if not pending:
                console.print("[green]all flags resolved![/green]")
                return
            console.print(f"[bold]{len(pending)} flags remaining[/bold]")

        # step 4: analyze remaining flags and ask about needs_human
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

        # send question for needs_human (if any)
        if human:
            human_flags = [f for f in pending if f["uri"] in [h.uri for h in human]]
            question = format_question(human_flags, env)
            console.print(
                f"[dim]sending question ({len(question)} chars, {len(human_flags)} flags)...[/dim]"
            )
            if not dry_run:
                await dm.send(question)
                console.print("[green]sent[/green]")
            else:
                console.print(f"[yellow]would send:[/yellow]\n{question}")

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
