---
name: research
description: Context-aware deep research via the Perplexity API. Use when the user wants to investigate, research, or go deep on a topic — and wants findings framed around their goals, product, and current priorities. Runs in the main agent by default, or the research sub-agent for deep/isolated reports. Not for quick fact lookups (use web search directly for those).
---

# Research Skill

Deep, tailored research powered by the **Perplexity API** (via `research.mjs`). **Runs in the main agent by default**; for deep or very long reports, delegate to the **research sub-agent** (`@research`), which runs the same script in an isolated context. Either way, findings are grounded in **who the user is and what they're working on**.

## When to use
- "Research …", "go deep on …", "what's the landscape for …", "investigate …"
- The user needs a thorough synthesis, not a quick fact
- Decisions where relevance to their product/goals matters

Do **not** use for simple lookups (a date, a definition, one fact) — a direct `WebSearch` is faster and cheaper.

## How to run — default (main agent)
**Runs in the main agent by default.** Run the Perplexity script from the project root, then present the result per **Output constraints** and **Output handling** below:

```bash
node .claude/skills/research/research.mjs "<topic>" [--depth quick|standard|deep] [--focus "<angle>"] [--no-context]
```

- The script runs Perplexity and **auto-loads** the user's context (profile, goals, projects), so findings are framed around their work. Use `--no-context` for deliberately unbiased/external topics.
- `--depth` maps to Perplexity models: `quick` (`sonar`), `standard` (`sonar-pro`), `deep` (`sonar-deep-research`, 1–5 min; default).
- The Perplexity key lives in `.env` (`PERPLEXITY_API_KEY`); the script reads it at runtime. **Never read `.env` yourself.**

**Save the full report (don't skip — this is what was getting lost):**
1. Get today's date with `date +%F` (don't guess).
2. Save the full script output to `research/<YYYY-MM-DD>-<slug>.md` (short kebab slug from the topic; `mkdir -p research` if missing). This mirrors what the `research` subagent does — without it, the report lives only in transient tool output and can disappear.
3. Cite that saved path to the user when you present the distillation.

### Research brief (applies to either path)
Frame the topic + optional focus angle so the result covers:
- What it is / the core idea
- Why it matters now
- The landscape (concrete examples / players)
- Where it's heading

Before synthesizing, read these context files so the report is framed around the user's real goals and active work:
- context/me.md, context/work.md, context/team.md
- context/current-priorities.md, context/goals.md
- every projects/*/README.md

Output constraints:
- ~600–900 words, grouped by the areas above. Lead with the most important points.
- Casual tone, tight bullets with supporting detail. No fluff, no emojis, no marketing language.
- End with a numbered Sources list (URLs you actually used).
- End with a short "Why it matters for the user" note, tied to their work and stack (TypeScript, AI-centric, solo/pre-revenue).

## Delegate to the research sub-agent
For a deep or very long report that would clutter the main session, delegate instead of running the script inline — the sub-agent runs the same Perplexity script in isolation and returns a distillation:

```
@research <topic> [--depth deep]
```

## Output handling
Present the result in the user's style — casual, tight bullets, no emojis, no marketing fluff (see `@.claude/rules/communication-style.md`). Keep the source links. Light edits are fine; don't pad.

## Guardrails
- **Always** Perplexity (`research.mjs`). Don't substitute ad-hoc `WebSearch`/`WebFetch` for research.
- **Do not** write to `decisions/log.md` — the main session decides what to log.
