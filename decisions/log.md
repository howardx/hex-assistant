# Decision Log


Append-only. When a meaningful decision is made, log it here.


Format: [YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...


---

[2026-06-22] DECISION: Adopt the agentic loop as the orchestration architecture for the Higgsfield video-gen webapp, starting with constrained autonomy + guardrails. | REASONING: Deep research (ReAct, Auto-GPT, LangGraph, Swarm, reflection/Self-Refine) concluded the loop + guardrails — not model power — drive agent reliability; main risks are silent loops, hallucinated success, context drift, tool confusion, and per-phase (OODA) security. | CONTEXT: Perplexity sonar-deep-research, 19 sources, context-aware. Full report at research/2026-06-22-agentic-loop.md.

[2026-06-23] DECISION: Build the creator-watch skill as an Apify + Perplexity hybrid: Apify scrapers fetch recent tweets + linked articles + YouTube transcripts; Perplexity classifies each point as FACT or OPINION and web-verifies every fact (confirmed/disputed/unverifiable). Digests are written as immutable captures into the brain-dump knowledge base at knowledge/raw/creator-watch/ — hex owns fetch+summarize, brain-dump owns the wiki layer. | REASONING: Perplexity can't reliably fetch specific handles' recent tweets (X blocks crawling); a cheap Apify scraper (~$0.15-0.40/1k tweets) solves the fetch for pennies while Perplexity (already paid for) does the valuable classify+verify synthesis. Verify-not-just-label was chosen because flagging disputed claims is the real "signal vs noise" value and is where Perplexity earns its place; it's a prompt change, not an architecture change. Two-workspace boundary keeps each repo's ownership model intact. | CONTEXT: skill-builder session; user added APIFY_API_KEY; chose classify+verify; watchlist = @SVScholar, @BTCdayu, YT @nateherk, @clearvaluetax9382, @NoPriorsPodcast.

[2026-06-25] DECISION: Build media-notes skill — ad-hoc single-media summarizer (YouTube now; extensible to Apple Podcasts / other audio via Whisper later). Fetches transcript via Apify codepoetry, summarizes via Perplexity (plain summary — no Facts/Opinions split or web-verification, by user choice), writes a paired summary (`<slug>.md`, brain-dump source-template frontmatter, ingest-ready) + verbatim transcript (`<slug>.transcript.md`) to brain-dump/knowledge/raw/. | REASONING: Distinct from creator-watch (recurring watchlist with facts/verify) — this captures any one-off video/podcast the user runs into; plain summary keeps it fast and fits arbitrary content (tutorials, talks, podcasts). Two-file pair (`.transcript.md` suffix) makes summary vs verbatim easy to identify in the dir; summary is ingest-ready so brain-dump folds it into the wiki. No login/local deps (YouTube captions are public — unlike creator-watch's X Articles). fetchTranscript dispatches by host, so adding platforms is a localized branch. | CONTEXT: skill-builder session; user named it media-notes (platform-agnostic), chose plain summary, ingest-ready format, verbatim+summary, one URL per run.
