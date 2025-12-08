#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "agentic-learning>=0.4.0",
#     "anthropic>=0.40.0",
#     "pydantic-settings>=2.0.0",
# ]
# [tool.uv]
# prerelease = "allow"
# ///
"""proof of concept: letta-powered status agent with persistent memory.

this script demonstrates using letta's learning SDK to give an LLM
persistent memory across runs. the agent will remember context about
plyr.fm's codebase and recent work.

usage:
    # first run - agent learns about the project
    uv run scripts/letta_status_agent.py "what is plyr.fm?"

    # second run - agent remembers previous context
    uv run scripts/letta_status_agent.py "what did we discuss last time?"

    # ask about recent work
    uv run scripts/letta_status_agent.py "summarize recent commits"

    # manage agent
    uv run scripts/letta_status_agent.py --create   # create the agent
    uv run scripts/letta_status_agent.py --delete   # delete the agent
    uv run scripts/letta_status_agent.py --status   # check agent status

environment variables (in .env):
    LETTA_API_KEY - letta cloud API key
    ANTHROPIC_API_KEY - anthropic API key
"""

import asyncio
import subprocess
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

AGENT_NAME = "plyr-status-agent"
MEMORY_BLOCKS = ["project_context", "recent_work"]


class AgentSettings(BaseSettings):
    """settings for the letta status agent."""

    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent / ".env",
        case_sensitive=False,
        extra="ignore",
    )

    letta_api_key: str = Field(validation_alias="LETTA_API_KEY")
    anthropic_api_key: str = Field(validation_alias="ANTHROPIC_API_KEY")


def get_recent_commits(limit: int = 10) -> str:
    """get recent commit messages for context."""
    result = subprocess.run(
        ["git", "log", "--oneline", f"-{limit}"],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent.parent,
    )
    return result.stdout.strip()


def get_open_issues(limit: int = 5) -> str:
    """get open issues for context."""
    result = subprocess.run(
        ["gh", "issue", "list", "--limit", str(limit)],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent.parent,
    )
    return result.stdout.strip()


async def create_agent(settings: AgentSettings) -> None:
    """create the letta agent."""
    from agentic_learning import AsyncAgenticLearning

    letta_client = AsyncAgenticLearning(api_key=settings.letta_api_key)

    # check if already exists
    existing = await letta_client.agents.retrieve(agent=AGENT_NAME)
    if existing:
        print(f"agent '{AGENT_NAME}' already exists (id: {existing.id})")
        return

    # create
    agent = await letta_client.agents.create(
        agent=AGENT_NAME,
        memory=MEMORY_BLOCKS,
        model="anthropic/claude-sonnet-4-20250514",
    )
    print(f"✓ created agent '{AGENT_NAME}' (id: {agent.id})")
    print(f"  memory blocks: {MEMORY_BLOCKS}")


async def delete_agent(settings: AgentSettings) -> None:
    """delete the letta agent."""
    from agentic_learning import AsyncAgenticLearning

    letta_client = AsyncAgenticLearning(api_key=settings.letta_api_key)

    deleted = await letta_client.agents.delete(agent=AGENT_NAME)
    if deleted:
        print(f"✓ deleted agent '{AGENT_NAME}'")
    else:
        print(f"agent '{AGENT_NAME}' not found")


async def show_status(settings: AgentSettings) -> None:
    """show agent status and memory."""
    from agentic_learning import AsyncAgenticLearning

    letta_client = AsyncAgenticLearning(api_key=settings.letta_api_key)

    agent = await letta_client.agents.retrieve(agent=AGENT_NAME)
    if not agent:
        print(f"agent '{AGENT_NAME}' not found")
        print("run: uv run scripts/letta_status_agent.py --create")
        return

    print(f"agent: {AGENT_NAME}")
    print(f"  id: {agent.id}")
    print(f"  model: {agent.model}")

    # show memory blocks
    if hasattr(agent, "memory") and agent.memory:
        print("  memory blocks:")
        for block in agent.memory.blocks:
            preview = (
                block.value[:100] + "..." if len(block.value) > 100 else block.value
            )
            print(f"    - {block.label}: {preview}")


def run_agent_sync(user_message: str) -> None:
    """run the status agent with letta memory (sync version)."""
    import os

    settings = AgentSettings()

    # SDK's capture() reads from os.environ, so we need to set it
    os.environ["LETTA_API_KEY"] = settings.letta_api_key

    # import after settings validation
    import anthropic
    from agentic_learning import AgenticLearning, learning

    # initialize clients - use SYNC clients for sync context
    letta_client = AgenticLearning(api_key=settings.letta_api_key)
    anthropic_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # ensure agent exists (sync)
    existing = letta_client.agents.retrieve(agent=AGENT_NAME)
    if not existing:
        print(f"creating agent '{AGENT_NAME}'...")
        try:
            letta_client.agents.create(
                agent=AGENT_NAME,
                memory=MEMORY_BLOCKS,
                model="anthropic/claude-sonnet-4-20250514",
            )
            print(f"✓ agent '{AGENT_NAME}' created")
        except Exception as e:
            print(f"✗ failed to create agent: {e}")
            sys.exit(1)

    # gather context
    recent_commits = get_recent_commits()
    open_issues = get_open_issues()

    system_prompt = f"""you are a status agent for plyr.fm, a decentralized music streaming
platform built on AT Protocol.

your role is to:
1. understand what's happening in the codebase
2. remember context across conversations
3. help maintain STATUS.md and track project progress

current context:
- recent commits:
{recent_commits}

- open issues:
{open_issues}

be concise and technical. use lowercase aesthetic.
"""

    print(f"user: {user_message}\n")
    print("agent: ", end="", flush=True)

    # wrap the anthropic call with letta learning context (SYNC)
    # this automatically captures the conversation and injects relevant memory
    with learning(
        agent=AGENT_NAME,
        client=letta_client,
        memory=MEMORY_BLOCKS,
    ):
        response = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )

        # print response
        for block in response.content:
            if hasattr(block, "text"):
                print(block.text)

    print("\n✓ conversation saved to letta memory")


def main() -> None:
    """main entry point."""
    if len(sys.argv) < 2:
        print("usage: uv run scripts/letta_status_agent.py <message>")
        print("\nexamples:")
        print('  uv run scripts/letta_status_agent.py "what is plyr.fm?"')
        print('  uv run scripts/letta_status_agent.py "what did we discuss last time?"')
        print('  uv run scripts/letta_status_agent.py "summarize recent work"')
        print("\nagent management:")
        print("  uv run scripts/letta_status_agent.py --create")
        print("  uv run scripts/letta_status_agent.py --delete")
        print("  uv run scripts/letta_status_agent.py --status")
        sys.exit(1)

    settings = AgentSettings()

    # handle management commands
    if sys.argv[1] == "--create":
        asyncio.run(create_agent(settings))
        return
    elif sys.argv[1] == "--delete":
        asyncio.run(delete_agent(settings))
        return
    elif sys.argv[1] == "--status":
        asyncio.run(show_status(settings))
        return

    user_message = " ".join(sys.argv[1:])
    run_agent_sync(user_message)


if __name__ == "__main__":
    main()
