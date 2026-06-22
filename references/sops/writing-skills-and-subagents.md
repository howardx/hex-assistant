# SOP: Writing Skills & Subagents

Authoritative conventions for creating and editing skills (`.claude/skills/`) and subagents (`.claude/agents/`) in this repo. Follow this whenever you create or modify one. Source: Claude Code docs — `code.claude.com/docs/en/sub-agents` and `/skills`.

## Core principle: where a skill runs
A skill may run in the **main agent** or in a **sub-agent**. Which to use is **determined by the prompt**; the **default is the main agent**.
- Use the main agent for most tasks — faster, simpler, and it can weave the result into the conversation.
- Delegate to a sub-agent (via `@<name>` / Agent tool, or `context: fork`) only when the task specifically benefits from isolation: very large output that would flood the main context, side effects you want sandboxed, or tool restrictions you want to enforce.

Don't reach for `context: fork` by default — it's an option, not the standard.

## Skills — `.claude/skills/<name>/SKILL.md`
A skill is a folder with a `SKILL.md` entrypoint (plus optional supporting files). The folder name becomes the `/`-command.

**Frontmatter** (all optional, but `description` is required in this repo):
- `description` — what the skill does and **when to use it**. Lead with the key use case; combined text is capped at 1,536 chars in listings.
- `name` — display name; defaults to the directory name, so usually omit it.
- `disable-model-invocation: true` — for side-effecting/manual workflows you only want to trigger yourself (e.g. `/deploy`). Prevents Claude auto-running it.
- `user-invocable: false` — background knowledge users shouldn't run directly.
- `allowed-tools` / `disallowed-tools` — pre-approve or remove tools while the skill is active.
- `context: fork` + `agent: <name>` — run the skill's task inside a sub-agent (see principle above; not the default).

**Body:**
- Keep it **under 500 lines** and tight. Once a skill loads, its body stays in context across turns — every line is recurring token cost. State **what to do**, not how or why.
- Include an **Output format** section so results are consistent regardless of which path runs.
- Move large reference material into supporting files (`reference.md`, `examples.md`, `scripts/`) and link them from `SKILL.md`.
- Use `$ARGUMENTS` / `$N` for arguments; `` !`<cmd>` `` to inject live command output before the skill runs.

## Subagents — `.claude/agents/<name>.md`
A subagent is a single markdown file with YAML frontmatter + a system prompt. Keep the layout flat and conventional: `.claude/agents/<name>.md`. Identity comes from the `name` field.

**Frontmatter:**
- `name` *(required)* — lowercase letters and hyphens; **unique across the whole tree**.
- `description` *(required)* — **when** Claude should delegate to it. Add **"use proactively"** for automatic delegation on matching tasks.
- `tools` — the tools it may use. **Restrict to the minimum needed.** Read-only subagents must not include `Edit`/`Write`. Omit to inherit all tools.
- `model` — `sonnet`/`opus`/`haiku`/`fable`, a full model ID, or `inherit`. **Defaults to `inherit`**; omit unless you want to override.

**Body = the subagent's system prompt.** A subagent gets only this prompt (plus environment details, `CLAUDE.md`, and git status) — **not** the full Claude Code system prompt. So:
- **Don't restate `CLAUDE.md`** (style rules, project context, goals) unless a rule truly must reach the subagent itself — it already loads CLAUDE.md. Restating is usually wasted tokens.
- Include a **"When invoked:"** section with concrete steps and an **Output** format.
- Keep it focused on one capability.

## Skill vs subagent — how they fit together
- **Skill** = the user-facing entry point and the task. Lives in `.claude/skills/`.
- **Subagent** = a reusable persona + capability set. Lives in `.claude/agents/`.
- A skill can delegate to a sub-agent (`@<name>`) or run inside one (`context: fork` + `agent:`). A subagent can preload skills via its `skills:` field.
- If the same workflow has both a user entry point and a reusable isolated worker, make a skill **and** a subagent (e.g. the `research` skill + `research` subagent) and keep their output format consistent.

## Before you commit a new file
- Required frontmatter present (subagent: `name` + `description`; skill: `description`).
- Skill body < 500 lines; an Output format section present.
- Tools restricted to the minimum on subagents.
- The PreToolUse hook (`node .claude/hooks/validate-skill-or-agent.mjs`) checks the above automatically on Write — it blocks missing required frontmatter and warns on verbosity.
