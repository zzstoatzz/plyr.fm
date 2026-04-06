---
title: "claude code skills"
---

## overview

plyr.fm uses [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) to encode repeatable workflows as slash commands. skills live in `.claude/skills/<name>/SKILL.md` and are invoked with `/<name>` in any Claude Code session.

skills replaced the older `.claude/commands/` format (migrated March 2026). the old format still works but skills are preferred — they support bundled supporting files, richer frontmatter (`context`, `agent`, `effort`, `allowed-tools`), and take precedence over commands with the same name.

reference: [skills docs](https://docs.anthropic.com/en/docs/claude-code/skills), [slash commands docs](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

## project skills

### development workflow

| skill | description | when to use |
|-------|-------------|-------------|
| `/onboard` | read STATUS.md, recent commits, open issues, propose next step | starting a new session |
| `/plan` | create an implementation plan before coding | before non-trivial changes |
| `/implement` | execute an implementation plan phase by phase | after `/plan` is approved |
| `/research` | research a topic thoroughly and persist findings | investigating unfamiliar areas |
| `/status-update` | update STATUS.md to reflect recent work | after shipping PRs |

### operations

| skill | description | when to use |
|-------|-------------|-------------|
| `/deploy` | deploy to production with preflight checks | releasing to prod (never auto-invoked) |
| `/enable-flag` | enable a feature flag for a user | granting feature access |
| `/check-spans` | investigate Logfire spans and traces | debugging production behavior |
| `/screenshot-docs` | capture UI screenshots for documentation | updating docs with visuals |

### code review

| skill | description | when to use |
|-------|-------------|-------------|
| `/consider-review` | review PR feedback and address comments | responding to PR reviews |
| `/investigate-report` | investigate a user report and fix if it's a bug | triaging bug reports |
| `/digest` | extract actionable insights from an external resource | processing links, docs, threads |

### external

| skill | description | when to use |
|-------|-------------|-------------|
| `/contribute` | contributing guide for AI coding assistants | external contributors using Claude Code, Cursor, etc. |

## adding a new skill

create `.claude/skills/<name>/SKILL.md`:

```yaml
---
description: what this skill does (required for auto-discovery)
disable-model-invocation: true  # set for destructive operations like deploy
argument-hint: "[arg]"          # shown in autocomplete
---

# skill name

instructions for the agent...
```

the `description` field is how Claude decides when to auto-invoke a skill. without it, the skill only runs when explicitly called with `/<name>`.

use `disable-model-invocation: true` for skills that shouldn't be triggered automatically (deploy, destructive operations).

## skill scoping

skills are discovered from multiple scopes (highest priority first):

1. **personal**: `~/.claude/commands/` or `~/.claude/skills/` — applies to all projects
2. **project**: `.claude/skills/` — checked into the repo
3. **plugins**: installed via Claude Code plugin system (e.g., `cloudflare:*`, `svelte:*`)

project skills are shared with all contributors. personal skills are private to your machine.
