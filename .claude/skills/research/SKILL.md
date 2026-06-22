---
name: research
description: Context-aware deep research via the Perplexity API. Use when the user wants to investigate, research, or go deep on a topic — and wants findings framed around their goals, product, and current priorities. Loads the user's profile/goals/projects automatically. Not for quick fact lookups (use web search for those).
---

# Research Skill

Deep, tailored research using Perplexity's research models. Unlike ad-hoc web search, this runs a longer research pass and grounds the analysis in **who the user is and what they're working on**.

## When to use
- "Research …", "go deep on …", "what's the landscape for …", "investigate …"
- The user needs a thorough synthesis, not a quick fact
- Decisions where relevance to their product/goals matters

Do **not** use for simple lookups (a date, a definition, one fact) — plain web search is faster and cheaper.

## How to run
From the project root:

```bash
node .claude/skills/research/research.mjs "<query>" [--depth quick|standard|deep] [--focus "<angle>"] [--model <model>] [--no-context]
```

- `--depth` — `quick` (`sonar`), `standard` (`sonar-pro`), **`deep` (default, `sonar-deep-research`)**. Deep can take 1–5 min and costs more; drop to `standard` for lighter passes.
- `--focus` — an angle to emphasize (e.g. "relevance to a pre-revenue AI product").
- `--no-context` — raw research, no user-profile injection (for unbiased/external topics).

### What it does automatically
The script loads and attaches as context:
- `context/me.md`, `context/work.md`, `context/team.md`
- `context/current-priorities.md`, `context/goals.md`
- each `projects/*/README.md`

So Perplexity analyzes the topic **through the lens of the user's goals and active work**, and ends with a short "Relevance to your work" note.

## Output handling
The script prints the synthesized answer + a numbered Sources list. Present it in the user's style — casual, tight bullets, no emojis, no marketing fluff (see `@.claude/rules/communication-style.md`). Keep the source links.

## Notes
- API key lives in `.env` as `PERPLEXITY_API_KEY`. The script reads it at runtime — **never read `.env` yourself.**
- If the key is missing/invalid the script prints a clear error; tell the user to add it to `.env`.
- Node 18+ required (global `fetch`). Network required.
