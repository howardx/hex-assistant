# Decision Log


Append-only. When a meaningful decision is made, log it here.


Format: [YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...


---

[2026-06-22] DECISION: Adopt the agentic loop as the orchestration architecture for the Higgsfield video-gen webapp, starting with constrained autonomy + guardrails. | REASONING: Deep research (ReAct, Auto-GPT, LangGraph, Swarm, reflection/Self-Refine) concluded the loop + guardrails — not model power — drive agent reliability; main risks are silent loops, hallucinated success, context drift, tool confusion, and per-phase (OODA) security. | CONTEXT: Perplexity sonar-deep-research, 19 sources, context-aware. Full report at research/2026-06-22-agentic-loop.md.

[2026-06-23] DECISION: Build the creator-watch skill as an Apify + Perplexity hybrid: Apify scrapers fetch recent tweets + linked articles + YouTube transcripts; Perplexity classifies each point as FACT or OPINION and web-verifies every fact (confirmed/disputed/unverifiable). Digests are written as immutable captures into the brain-dump knowledge base at knowledge/raw/creator-watch/ — hex owns fetch+summarize, brain-dump owns the wiki layer. | REASONING: Perplexity can't reliably fetch specific handles' recent tweets (X blocks crawling); a cheap Apify scraper (~$0.15-0.40/1k tweets) solves the fetch for pennies while Perplexity (already paid for) does the valuable classify+verify synthesis. Verify-not-just-label was chosen because flagging disputed claims is the real "signal vs noise" value and is where Perplexity earns its place; it's a prompt change, not an architecture change. Two-workspace boundary keeps each repo's ownership model intact. | CONTEXT: skill-builder session; user added APIFY_API_KEY; chose classify+verify; watchlist = @SVScholar, @BTCdayu, YT @nateherk, @clearvaluetax9382, @NoPriorsPodcast.
