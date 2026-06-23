---
name: creator-watch
description: Use when someone asks to screen creators, see what specific Twitter/X handles or YouTube channels have posted recently, get a facts-vs-opinions digest of creator feeds, or check what named people/accounts are saying. Fetches recent tweets, linked articles, and YouTube transcripts via Apify, summarizes via Perplexity, strictly separates FACTS from OPINIONS, and web-verifies each fact.
argument-hint: [handles/URLs or "all"]
disable-model-invocation: true
---

# creator-watch

Periodically screen a set of X/Twitter handles + YouTube channels, summarize what they've posted **since the last run**, and return a digest that **strictly separates FACTS from OPINIONS** — with every fact **web-verified** (confirmed / disputed / unverifiable). Runs the script `screen.mjs` and presents its output in the user's style.

## When to use
- "screen my watchlist", "creator digest", "what have [creators] been saying lately", "any new takes from [@handle / channel]"
- The user wants a curated summary of specific people's recent output, not broad news

Do **not** use for general AI/crypto/tech news across sources — that's the broader news-digest workflow. This is per-creator screening.

## How to run
Run from the project root (script reads `.env` for keys itself; you never read `.env`):

```bash
node .claude/skills/creator-watch/screen.mjs                          # whole watchlist
node .claude/skills/creator-watch/screen.mjs SVScholar                # just one account
node .claude/skills/creator-watch/screen.mjs --fetch-only             # calibration: raw fields only, no Perplexity call
node .claude/skills/creator-watch/screen.mjs --depth deep             # thorough verification pass (sonar-deep-research, slower)
node .claude/skills/creator-watch/screen.mjs --since 2026-06-01       # override the recency window
node .claude/skills/creator-watch/screen.mjs --force                  # re-run ignoring seen-state (regenerate a capture); state unchanged
```

Flags: `--fetch-only` `--force` `--depth quick|standard|deep` `--since YYYY-MM-DD` `--model <sonar model>` `--no-context`.

Then present the result per **Output handling** below. Don't pad it.

## Setup (one-time)
- Keys in `.env` (the script reads them; you never do): `PERPLEXITY_API_KEY`, `APIFY_API_KEY`.
- **X Articles need your X login** (their bodies are login-walled): add `X_AUTH_TOKEN` and `X_CT0` to `.env`. Grab both from browser DevTools → Application → Cookies → `x.com` while logged in. Without them, tweets/transcripts still work but X Article bodies are skipped (shown as links only).
- **Playwright** renders articles in your installed Chrome. Once, in the skill dir: `cd .claude/skills/creator-watch && npm install` (installs `playwright-core`). No Chromium download — it drives your Chrome via `channel:'chrome'`. macOS + Google Chrome required.

## What the script does (black box)
1. Reads `watchlist.json` + `state.json` (seen tweet/video IDs).
2. **Twitter** via Apify `xquik/x-tweet-scraper` (search `from:<handle>`) → recent tweets per handle; drops already-seen IDs and anything older than the window. Native **X Articles** (long-form posts at `x.com/i/article/…`) are detected and their **bodies rendered in headless Chrome** using the user's X login, then summarized like any other content. (External articles the author links to — Substack, blogs — are passed to Perplexity to read directly.)
3. **YouTube** via Apify `codepoetry/youtube-transcript-ai-scraper` → recent video **transcripts** per channel (deduped).
4. Sends the raw tweets + transcripts + article URLs to **Perplexity** with a strict prompt:
   - **PASS 1 — CLASSIFY**: each point is a **FACT** (asserted as established) or an **OPINION** (take/prediction).
   - **PASS 2 — VERIFY**: every fact is checked against the web and tagged **confirmed / disputed / unverifiable** (with a citation). Opinions are not verified.
5. Writes an immutable capture to the **brain-dump** knowledge base: `brain-dump/knowledge/raw/creator-watch/creator-watch-YYYY-MM-DD.md`.
6. Appends seen IDs to `state.json`; prints the digest to stdout.

## Output handling
Present the digest as-is, in the user's style — casual, tight bullets, **no emojis**, no marketing fluff (see `@.claude/rules/communication-style.md`). Keep all source links. The digest already leads with a **Claims to scrutinize** section (disputed facts) — surface that prominently. Note where the file was saved.

## Output format (what the digest looks like)
```
# Creator Watch — YYYY-MM-DD
TL;DR (1-3 sentences)
## Claims to scrutinize         <- disputed facts only; "None" if clean
## @handle / Channel
  ### Facts   <- each: tag (confirmed/disputed/unverifiable) + source + verification source
  ### Opinions <- each: the take + source
## Open questions / watch list
## Sources
```

## Editing the watchlist
Accounts live in `.claude/skills/creator-watch/watchlist.json`. Add/remove handles (no `@`) or YouTube URLs anytime. The watchlist is just config — no code changes needed.

## Two-workspace integration (important)
- **creator-watch (hex) only writes immutable raw captures** to `brain-dump/knowledge/raw/creator-watch/`. It is a *source producer*.
- It **never touches** the brain-dump wiki layer (`wiki/`, `index.md`, `log.md`). That's the brain-dump workspace's own Claude to maintain per its constitution (raw → ingest → wiki summary + entity/concept fan-out).
- So: produce the capture here; if the user wants it folded into the wiki, that happens in a brain-dump session ("ingest creator-watch-YYYY-MM-DD").

## Cost
- Apify: ~$0.40/1k tweets + ~$0.70/1k transcripts. For this small watchlist screened every few days: **low single-digit $/month**.
- Perplexity: one call per run (does classification + verification + web lookups internally). `--depth deep` costs more.
- Article rendering: ~5-8s per X Article in headless Chrome, capped at `CW_MAX_ARTICLES` (4) per handle. An active account's first run renders several; later runs render only newly-posted ones (seen ones are deduped).
- If anything goes over budget, the script doesn't run again until invoked — it never auto-fires (`disable-model-invocation: true`).

## Guardrails
- **Facts vs Opinions split is mandatory**, and facts must be verified. If a fact can't be verified, it's tagged `unverifiable` — never presented as confirmed.
- Only summarize what was actually fetched. Never fabricate quotes, numbers, or sources. Perplexity is told this explicitly.
- **Never read `.env`** — the script loads `PERPLEXITY_API_KEY`, `APIFY_API_KEY`, `X_AUTH_TOKEN`, `X_CT0` itself.
- **X session:** never click "Log out" on x.com in the browser the cookies came from — it invalidates `auth_token` immediately. If article fetches hit a login wall, the digest prints an "X session expired" warning; refresh `X_AUTH_TOKEN`/`X_CT0` from DevTools.
- If an account fails (private/suspended/dead, or the actor's input shape changed), the script notes it in stderr and continues with the rest; it does **not** advance `lastRun` when a fetch errors, so the next run retries the gap.
- Don't run more often than needed — each run costs money. Default cadence is a few times a week.

## Troubleshooting / calibration
- **First run, or after changing actors:** always run `--fetch-only` first. It prints the raw field names each actor returns (and any errors) without calling Perplexity, so you can confirm the fetch works and costs ~nothing.
- **"No new content":** expected between runs — the state file dedupes. Lower `--since` or clear `state.json` to re-pull.
- **Twitter actor returns `noResults`:** X periodically blocks scrapers (apidojo/tweet-scraper was dead as of 2026-06). Switch `TWITTER_ACTOR` to the `kaitoeasyapi~...` fallback noted in `screen.mjs`, then confirm with `--fetch-only`.
- **YouTube returns no transcript:** confirm `YT_ACTOR` accepts `{ startUrls:[{url}] }`; if it wants a different field (e.g. `urls`, `channelUrls`), edit `buildYtInput()`. Some videos genuinely have no captions.
- **Perplexity timeout:** use `--depth standard` or `quick` (deep research can take minutes).
- **Sources list looks short:** it's built from every URL inlined in the text — Perplexity's separate `citations` array is often a partial subset on long answers, so it isn't relied on. Re-run with `--force` to regenerate a capture.
- **"X session expired" warning / articles not fetched:** `X_AUTH_TOKEN`/`X_CT0` rotated or you logged out of x.com. Re-grab both from DevTools (Application → Cookies → x.com) and update `.env`. Also confirm `npm install` ran in the skill dir (`playwright-core` must be present) and Google Chrome is installed.

## Notes
- Verification tags are **probabilistic** — the web can be silent on niche claims, and Perplexity can be wrong. Treat `disputed`/`unverifiable` as flags to weigh, not verdicts.
- Apify scrapers read X via unofficial means (X ToS nuance). Low risk for personal screening of public posts; the tradeoff exists because X priced its official API out.
