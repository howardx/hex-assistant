---
description: <One line: what this skill does and when to use it — lead with the key use case. Capped at 1,536 chars in listings.>
# name: <optional — defaults to this directory's name, so usually omit>
# disable-model-invocation: true   # uncomment for manual-only workflows (/deploy, /commit)
# context: fork                    # uncomment ONLY to run inside a sub-agent (not the default)
# agent: general-purpose           # sub-agent type when context: fork is set
---

# <Skill Name>

<One-paragraph summary: what this skill does.>

## When to use
- <Trigger phrases and situations.>

## What to do
1. <Step.>
2. <Step.>

> **Where this runs:** a skill may run in the main agent or a sub-agent; which to use is determined by the prompt. **Default: main agent.** Delegate to a sub-agent only when the task needs isolation (large output, side effects, tool limits).

## Output format
<How to present or return the result — shape, grouping, length, sources, a "why it matters" note. Keep this consistent across the main-agent and sub-agent paths.>

## Notes
- Use `$ARGUMENTS` / `$N` for arguments; `` !`<cmd>` `` to inject live command output.
- Keep the body under 500 lines; move large reference into supporting files and link them here.
