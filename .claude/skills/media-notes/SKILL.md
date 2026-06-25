---
name: media-notes
description: Use when someone asks to summarize a YouTube video (or other media), take notes on a video/podcast, or capture a clip they just ran into. Fetches the transcript, summarizes it, and writes a brain-dump-ingest-ready summary plus a verbatim transcript.
argument-hint: [media URL]
disable-model-invocation: true
---

# media-notes

Ad-hoc: given **any media URL** (YouTube now; Apple Podcasts / other audio to come), fetch its transcript, summarize it, and write a brain-dump-ingest-ready capture. This is the one-off cousin of **creator-watch** — for a video/podcast you stumble on, not a creator you follow on a schedule.

## When to use
- "summarize this video", "take notes on this youtube", "clip this for me", "/media-notes <url>"
- A single ad-hoc video/podcast the user wants captured into the knowledge base

Do **not** use for recurring per-creator screening (that's `creator-watch`). This is one URL at a time.

## How to run
From the project root (script reads `.env` for keys itself; you never read `.env`):

```bash
node .claude/skills/media-notes/media-notes.mjs <url>                 # summary + verbatim transcript
node .claude/skills/media-notes/media-notes.mjs <url> --no-transcript # summary only (smaller file)
node .claude/skills/media-notes/media-notes.mjs <url> --depth quick   # faster pass
node .claude/skills/media-notes/media-notes.mjs <url> --depth deep    # thorough (sonar-deep-research, slower)
node .claude/skills/media-notes/media-notes.mjs <url> --focus "..."   # emphasize a specific topic in the summary
```

Flags: `--no-transcript` `--focus "..."` `--transcript-file <path>` (+`--title`/`--author`) `--depth quick|standard|deep` `--model <sonar model>`.

Then present the summary in the user's style (casual, tight bullets, **no emojis**). Note the saved paths.

## What it produces (two paired files in `brain-dump/knowledge/raw/`)
A slug (from the video title; falls back to `yt-<videoId>` for non-ASCII titles) names a clear pair:
- **`<slug>.md`** — the **summary**, ingest-ready. Frontmatter: `type: source`, title, author, source_date, ingested, url, source_path (→ the transcript), platform, tags. Body: TL;DR, key takeaways, notable claims & quotes, entities & concepts, quality/stance.
- **`<slug>.transcript.md`** — the **verbatim transcript** (`type: transcript`), cross-linked to the summary. Omitted under `--no-transcript`.

The `.transcript.md` suffix makes the verbatim file easy to spot at a glance; both share the slug and link to each other.

## What the script does (black box)
1. Detects the platform from the URL. **YouTube** only for now; anything else fails loudly with an extension hint.
2. YouTube: Apify `codepoetry~youtube-transcript-ai-scraper` (captions + AI fallback) → transcript + title / channel / date.
3. Perplexity summarizes → TL;DR + key takeaways + notable claims/quotes + entities & concepts + quality/stance + 3-6 tags. **Plain summary** — no Facts/Opinions split, no web-verification.
4. Writes the summary file + verbatim transcript file to `brain-dump/knowledge/raw/`; prints the summary.

## Two-workspace integration
- **media-notes (hex) only writes `raw/`** — a paired summary + transcript. It's a *source producer*.
- It **never touches** the brain-dump wiki layer (`wiki/`, `index.md`, `log.md`). To fold a capture into the wiki, ingest it in a brain-dump session: "ingest `<slug>.md`" → brain-dump's Claude builds `wiki/sources/<slug>.md` + entity/concept fan-out, quoting the verbatim transcript via `source_path`.

## Cost
- Apify: ~$0.70/1k transcripts → fractions of a cent per video.
- Perplexity: one call per video. `--depth deep` costs more.
- Never auto-fires (`disable-model-invocation: true`).

## Guardrails
- **Plain summary only** (no verification) — by design. If you want claim-checking, that's `creator-watch`'s job or ask to add a `--verify` flag here.
- Only summarize what the transcript actually says — never fabricate. Perplexity is told this explicitly.
- **Never read `.env`** — the script loads `PERPLEXITY_API_KEY` and `APIFY_API_KEY` itself.
- Unsupported platforms fail loudly (clear message + extension hint), never silently.

## Troubleshooting
- **"no transcript returned":** the video has captions disabled / is private / member-only. Transcribe the audio locally and feed it in: `brew install yt-dlp ffmpeg whisper-cpp` + a [ggml model](https://huggingface.co/ggerganov/whisper.cpp), grab audio (`yt-dlp -x --audio-format wav --postprocessor-args "ffmpeg:-ar 16000 -ac 1" -o audio.%(ext)s <url>`), run `whisper-cli -m <model> -f audio.wav -otxt` (Metal GPU is used automatically on Apple Silicon), then `node media-notes.mjs <url> --transcript-file audio.txt --title "..." --author "..."`.
- **Non-ASCII titles** (e.g. Chinese): the slug falls back to `yt-<videoId>`; the real title is preserved inside the file.
- **Perplexity timeout:** use `--depth quick`.
- **Want just the summary (no big transcript file):** pass `--no-transcript`.

## Extensibility (future platforms)
Transcript fetching dispatches by host in `detect()` + `fetchYouTube()`. Adding **Apple Podcasts** or arbitrary audio = a new branch that downloads audio and transcribes via Whisper — a localized change, no rewrite. YouTube needs no login (public captions), so no Playwright/cookies here, unlike `creator-watch`'s X Articles.