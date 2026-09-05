---
title: "agent skills"
---

## shared sources

Project skills live in `.agents/skills/<name>/SKILL.md`. Codex discovers that directory automatically; `.claude/skills/<name>` links to the same folder for Claude Code. Edit the canonical `.agents` file once. The per-skill symlinks follow the [FastMCP migration pattern](https://github.com/PrefectHQ/fastmcp/pull/5013).

Root `AGENTS.md` points to `.agents/AGENTS.md`, and root `CLAUDE.md` points to `AGENTS.md`. Scoped `AGENTS.md` files stay beside the code they govern, with sibling `CLAUDE.md` symlinks. Git tracks these links, so a clone needs no installation step. `just setup` checks the root entrypoints and skill links.

Use the skill picker or mention a skill explicitly (`$onboard` in Codex CLI, `/onboard` in Claude Code). Automatic selection uses the skill's description. See [OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills) and [Claude Code's skill documentation](https://code.claude.com/docs/en/skills) for host-specific behavior. If a Codex skill update does not appear, restart the session.

## project skills

| skill | use it for |
| --- | --- |
| `onboard` | current status, recent commits, and open priorities |
| `change` | the project development workflow, from implementation through review |
| `contribute` | setup and fork workflow for external contributors |
| `plan` | implementation planning before a substantial change |
| `implement` | executing an agreed plan |
| `research` | investigating unfamiliar areas and recording findings |
| `self-review` | reviewing a change before human review |
| `consider-review` | assessing and addressing PR feedback |
| `investigate-report` | triaging a user report and fixing a confirmed bug |
| `backlog-maintenance` | issue triage and proposed backlog cleanup |
| `digest` | extracting useful actions from an external resource |
| `status-update` | maintaining STATUS.md and its history |
| `toast-copy` | writing notifications that fit the product |
| `screenshot-docs` | capturing product screenshots for documentation |
| `deploy` | production release preflight and promotion |
| `enable-flag` | granting feature access |
| `resolve-flag` | reviewing copyright flags and proposing decisions |
| `check-spans` | investigating Logfire traces |
| `traffic-overview` | reporting traffic and performance across time windows |

Discovery is not authorization: publishing, moderation writes, and production promotion still require the user's authorization under the project instructions. Some workflows use Claude-specific tools or session memory; use available equivalents where appropriate and report unavailable dependencies.

## adding a skill

Create `.agents/skills/<name>/SKILL.md` with a name matching its directory and a description explaining when to use it:

```markdown
---
name: example
description: Explain the workflow and the requests it applies to.
---

Instructions for the agent.
```

Then add the Claude entrypoint from the repository root:

```sh
ln -s ../../.agents/skills/example .claude/skills/example
```

Keep supporting files in the same skill folder and use relative references. Preserve any host-specific metadata when editing an existing skill; Claude frontmatter settings do not automatically configure Codex. Codex's optional `agents/openai.yaml` configures its own interface and invocation policy.

Personal skills remain outside the repo; plugin-provided skills are managed by their plugin. A workflow mentioned by a project skill may come from one of those sources rather than this catalog.
