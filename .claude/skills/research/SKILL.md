---
name: research
description: Context-aware deep research. Use when the user wants to investigate, research, or go deep on a topic — and wants findings framed around their goals, product, and current priorities. Runs automatically by launching a research sub-agent (web search + synthesis). Not for quick fact lookups (use web search directly for those).
---

# Research Skill

Deep, tailored research by **launching a research sub-agent automatically**. The sub-agent fans out web searches, fetches sources, and synthesizes — grounded in **who the user is and what they're working on**.

## When to use
- "Research …", "go deep on …", "what's the landscape for …", "investigate …"
- The user needs a thorough synthesis, not a quick fact
- Decisions where relevance to their product/goals matters

Do **not** use for simple lookups (a date, a definition, one fact) — a direct `WebSearch` is faster and cheaper.

## How to run — the default path (always do this)
**Do not ask. Launch a sub-agent automatically whenever this skill is invoked.** Use the `Agent` tool with `subagent_type: "general-purpose"`.

The sub-agent does the research; you relay its synthesis. Give it a prompt built from this template (fill in the topic, the angle, and the depth):

```
Research "<topic>" and produce a concise, synthesized report. Use WebSearch and WebFetch across several queries — don't just dump sources, synthesize.

Run multiple search angles (at least 3–5 queries for a standard pass; more for deep). Cover:
- What it is / the core idea
- Why it matters now
- The landscape (concrete examples / players)
- Where it's heading

Before synthesizing, read these context files so the report is framed around the user's real goals and active work:
- context/me.md, context/work.md, context/team.md
- context/current-priorities.md, context/goals.md
- every projects/*/README.md

Focus/emphasis: "<focus angle, or none>".

Output constraints:
- ~600–900 words, grouped by the areas above. Lead with the most important points.
- Casual tone, tight bullets with supporting detail. No fluff, no emojis, no marketing language.
- End with a numbered Sources list (URLs you actually used).
- End with a short "Why it matters for the user" note, tied to their work and stack (TypeScript, AI-centric, solo/pre-revenue).
Your final message is the report itself.
```

- **Depth → how hard the sub-agent works:** `quick` = 2–3 queries, lighter synthesis; `standard` (default) = 3–5 queries; `deep` = broad fan-out, many sources, longer synthesis. Pass depth as guidance inside the prompt.
- **Focus** = an angle to emphasize (e.g. "relevance to shipping an AI-centric webapp"). Pass it in; omit if none.
- **Unbiased/external topic** = drop the context-files step from the prompt (raw research).

## Output handling
Present the sub-agent's synthesis in the user's style — casual, tight bullets, no emojis, no marketing fluff (see `@.claude/rules/communication-style.md`). Keep the source links. Light edits are fine; don't pad.

## Optional deeper fallback — Perplexity
For an extra-deep or model-grounded pass (or if web search isn't turning up enough), the repo also ships a Perplexity script. Run it only when explicitly wanted or when the sub-agent path is insufficient:

```bash
node .claude/skills/research/research.mjs "<query>" [--depth quick|standard|deep] [--focus "<angle>"] [--no-context]
```

It auto-loads the same context files and prints a synthesized answer + numbered Sources. API key lives in `.env` as `PERPLEXITY_API_KEY` (the script reads it at runtime — never read `.env` yourself). Node 18+, network required.
