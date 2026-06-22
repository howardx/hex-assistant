---
name: <lowercase-with-hyphens>          # required; unique across .claude/agents/
description: <When Claude should delegate to this subagent. Add "use proactively" for automatic delegation.>
tools: <Minimum tools needed — e.g. Read, Grep, Glob. Omit to inherit all. Read-only agents must NOT include Edit/Write.>
model: inherit                          # omit to inherit the session model; set sonnet/opus/haiku/fable to override
---

You are <role>. <One-line purpose.>

## When invoked
1. <Step.>
2. <Step.>

## Output
<Format the subagent should return — shape, grouping, length, sources, a "why it matters" note. It gets only this prompt + CLAUDE.md + git status, not the full system prompt.>

## Notes
- Don't restate CLAUDE.md here — the subagent already loads it.
- Keep the body focused on one capability.
