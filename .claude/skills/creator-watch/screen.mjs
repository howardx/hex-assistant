#!/usr/bin/env node
// screen.mjs — creator-watch: screen X/Twitter handles + YouTube channels, fetch new
// content since the last run (tweets + linked articles + video transcripts), and produce
// a FACTS-vs-OPINIONS digest via the Perplexity API — with every FACT verified against the
// web (confirmed / disputed / unverifiable).
//
// Architecture: Apify scrapers FETCH (reliable per-handle/per-channel access), Perplexity
// CLASSIFIES (strict FACTS vs OPINIONS) AND VERIFIES each fact (live web), tailored to the
// user. Mirrors the research skill's pattern: keys live in .env and are read here; the
// assistant never sees them.
//
// Output is written as an IMMUTABLE source capture into the brain-dump knowledge base:
//   /Users/howard/src/brain-dump/knowledge/raw/creator-watch/creator-watch-YYYY-MM-DD.md
// This workspace (hex) only writes raw captures — the brain-dump workspace owns the wiki
// layer (wiki/, index.md, log.md) on top of them.
//
// Usage:
//   node screen.mjs [all | <handle/url> ...] [--fetch-only] [--depth quick|standard|deep]
//                   [--since YYYY-MM-DD] [--model sonar-pro] [--no-context]
//   node screen.mjs --fetch-only          # calibrate: show raw fetched fields, no Perplexity call
//   node screen.mjs SVScholar             # screen just that account
//   node screen.mjs                       # screen the whole watchlist

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..'); // .claude/skills/creator-watch -> hex root
const BRAINDUMP_RAW = '/Users/howard/src/brain-dump/knowledge/raw/creator-watch';
const STATE_PATH = join(__dirname, 'state.json');
const WATCHLIST_PATH = join(__dirname, 'watchlist.json');

// --- Actor config (adjust here if an actor ID or its input shape changes) -------------
// NOTE: the Apify REST API uses a TILDE for actor IDs (username~actorName), NOT a slash.
// (The slash form is the storefront URL and 404s in the API path.)
// Twitter: xquik~x-tweet-scraper input { searchTerms: ["from:<handle>"], maxItems }. Output: text/url/id/createdAt/entities.
//   (apidojo~tweet-scraper returns noResults as of 2026-06 — X blocked it. If this one stops too,
//    fall back to kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest — richer schema, $0.25/1k.)
const TWITTER_ACTOR = 'xquik~x-tweet-scraper';
// YouTube: codepoetry~youtube-transcript-ai-scraper input { startUrls:[{url: channel}], maxItems }.
//   Returns per-video transcripts (field read resiliently below). If this actor's input field
//   differs, edit buildYtInput(). Verify with --fetch-only before the first real run.
const YT_ACTOR = 'codepoetry~youtube-transcript-ai-scraper';
const APIFY_BASE = 'https://api.apify.com/v2/acts';
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-pro'; // verification via live search; use --depth deep for a thorough weekly check

const MAX_TWEETS = Number(process.env.CW_MAX_TWEETS || 15);
const MAX_VIDEOS = Number(process.env.CW_MAX_VIDEOS || 3);
const MAX_TRANSCRIPT_CHARS = Number(process.env.CW_MAX_TRANSCRIPT || 6000);
const DEFAULT_WINDOW_DAYS = 14; // fallback window when there's no last-run state

// --- arg parsing ----------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.error(`Usage: node screen.mjs [all | handle/url ...] [--fetch-only] [--depth quick|standard|deep] [--since YYYY-MM-DD] [--model MODEL] [--no-context]`);
  process.exit(0);
}
const flag = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 && args[i + 1] ? args[i + 1] : null; };
const depth = flag('depth');
const modelOverride = flag('model');
const sinceOverride = flag('since');
const noContext = args.includes('--no-context');
const fetchOnly = args.includes('--fetch-only');
const force = args.includes('--force'); // ignore seen-state: re-fetch+re-summarize without changing state (regenerate a capture)
const posArgs = args.filter((a) => !a.startsWith('--'));
const filter = posArgs.length ? posArgs.join(' ') : 'all';
const model = modelOverride || (depth === 'deep' ? 'sonar-deep-research' : depth === 'quick' ? 'sonar' : DEFAULT_MODEL);

// --- key loaders (mirror research.mjs; never log values) ------------------------------
function readEnvFile() { try { return readFileSync(join(ROOT, '.env'), 'utf8'); } catch { return null; } }
function envKey(names) {
  for (const n of names) { const v = process.env[n]; if (v && v.trim()) return v.trim(); }
  const txt = readEnvFile();
  if (txt) {
    for (const n of names) {
      const m = txt.match(new RegExp(`^${n}\\s*=\\s*(.+)$`, 'm'));
      if (m) { const v = m[1].trim().replace(/^["']|["']$/g, ''); if (v && !/^your[-_ ]?key/i.test(v)) return v; }
    }
  }
  return null;
}
const pplxKey = envKey(['PERPLEXITY_API_KEY']);
const apifyKey = envKey(['APIFY_API_KEY', 'APIFY_TOKEN', 'APIFY_API_TOKEN']);

// --- watchlist + state ----------------------------------------------------------------
function loadWatchlist() {
  const raw = JSON.parse(readFileSync(WATCHLIST_PATH, 'utf8'));
  const norm = (arr, kind) => (arr || []).map((x) => {
    if (kind === 'twitter') return { handle: String(x.handle ?? x.url ?? '').replace(/^@/, '').trim(), name: x.name };
    return { url: String(x.url ?? x.handle ?? '').trim(), name: x.name };
  }).filter((x) => (kind === 'twitter' ? x.handle : x.url));
  let tw = norm(raw.twitter, 'twitter');
  let yt = norm(raw.youtube, 'youtube');
  if (filter.toLowerCase() !== 'all') {
    const want = filter.split(/[,\s]+/).filter(Boolean).map((s) => s.toLowerCase().replace(/^@/, ''));
    const hit = (s) => want.some((w) => s.toLowerCase().includes(w));
    tw = tw.filter((h) => hit(h.handle) || (h.name && hit(h.name)));
    yt = yt.filter((h) => hit(h.url) || (h.name && hit(h.name)));
  }
  return { twitter: tw, youtube: yt };
}
function loadState() {
  if (!existsSync(STATE_PATH)) return { twitter: {}, youtube: {}, lastRun: null };
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return { twitter: {}, youtube: {}, lastRun: null }; }
}
function saveState(s) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

// --- resilient helpers ----------------------------------------------------------------
function first(o, keys) { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
function asMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string' && /^\d+$/.test(v)) { const n = Number(v); return n > 1e12 ? n : n * 1000; }
  const p = Date.parse(v); return Number.isNaN(p) ? null : p;
}
function trunc(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + ` …[+${s.length - n} chars]` : s; }
const topN = (items, n) => [...items].sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0)).slice(0, n); // freshest first
const NON_ARTICLE_HOSTS = new Set(['t.co', 'youtu.be', 'youtube.com', 'instagram.com', 'tiktok.com', 'facebook.com', 'fb.me', 'imgur.com', 'i.imgur.com', 'pbs.twimg.com', 'piped.video']);
function isArticleUrl(u) {
  let p; try { p = new URL(u); } catch { return false; }
  const host = p.hostname.replace(/^www\./, '').toLowerCase();
  if (NON_ARTICLE_HOSTS.has(host)) return false;
  if (host === 'x.com' || host === 'twitter.com') return p.pathname.toLowerCase().startsWith('/i/article/'); // X long-form "Articles" only — skip tweet/profile links
  return true; // external link — treat as a potential article
}
function extractArticleUrls(t, text) {
  const out = new Set();
  const urlEntities = t?.urls || t?.entities?.urls || t?.externalMedia || [];
  for (const u of urlEntities) {
    const v = typeof u === 'string' ? u : (u?.expanded_url || u?.expandedUrl || u?.url || u?.display_url);
    if (v && isArticleUrl(v)) out.add(v);
  }
  const found = String(text ?? '').match(/https?:\/\/[^\s)]+/g) || [];
  for (const u of found) if (isArticleUrl(u)) out.add(u.replace(/[.,;!?]$/, ''));
  return [...out];
}

function normalizeTweet(t, handle) {
  const id = String(first(t, ['id', 'id_str', 'tweetId', 'rest_id']) ?? '');
  const text = String(first(t, ['full_text', 'text', 'content', 'rawContent']) ?? '').trim();
  const url = first(t, ['url', 'link', 'permalink']) || (id && handle ? `https://x.com/${handle}/status/${id}` : '');
  return { id, text, url, dateMs: asMs(first(t, ['createdAt', 'created_at', 'date', 'publishedAt', 'timestamp'])), raw: t };
}
function normalizeVideo(v) {
  const md = v?.metadata && typeof v.metadata === 'object' ? v.metadata : {};
  const id = String(md.id ?? first(v, ['id', 'videoId', 'video_id', 'youtubeId']) ?? '');
  const title = String(md.title ?? first(v, ['title', 'name', 'videoTitle']) ?? '').trim();
  const url = md.url || first(v, ['url', 'link', 'videoUrl', 'youtubeUrl']) || (id ? `https://www.youtube.com/watch?v=${id}` : '');
  let t = first(v, ['transcript_llm', 'transcript_text', 'transcript', 'plainText', 'text', 'content', 'fullText', 'transcript_json', 'captions', 'subtitles']);
  if (Array.isArray(t)) t = t.map((s) => typeof s === 'string' ? s : (s?.text ?? s?.snippet ?? '')).join(' ');
  else if (t && typeof t === 'object') t = JSON.stringify(t);
  return { id, title, url, dateMs: asMs(md.publishedAt || md.uploadDate || md.published || md.date || first(v, ['publishedAt', 'uploadDate', 'uploadedAt', 'published', 'upload_date', 'date', 'createdAt'])), transcript: String(t ?? '').trim(), raw: v };
}

// --- Apify run -------------------------------------------------------------------------
async function runActor(actorId, input, label) {
  const url = `${APIFY_BASE}/${actorId}/run-sync-get-dataset-items?timeout=290`;
  process.stderr.write(`[${label}] calling ${actorId}...\n`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apifyKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(295000),
  });
  if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`Apify ${actorId} ${res.status}: ${txt.slice(0, 400)}`); }
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.items || data?.datasetItems || data?.data || []);
}
async function fetchTwitter(acct) {
  const raw = await runActor(TWITTER_ACTOR, { searchTerms: [`from:${acct.handle}`], maxItems: MAX_TWEETS }, `twitter @${acct.handle}`);
  const items = raw.map((t) => normalizeTweet(t, acct.handle)).filter((t) => t.text);
  return { items, rawCount: raw.length, sample: raw[0] };
}
function buildYtInput(channelUrl) { return { startUrls: [{ url: channelUrl }], maxItems: MAX_VIDEOS }; }
async function fetchYouTube(acct) {
  const raw = await runActor(YT_ACTOR, buildYtInput(acct.url), `youtube ${acct.name || acct.url}`);
  const norm = raw.map(normalizeVideo).filter((v) => v.transcript || v.title);
  const byKey = new Map(); // group caption-segments into one record per video
  for (const v of norm) {
    const key = v.id || v.url || v.title;
    if (!key) continue;
    const ex = byKey.get(key);
    if (ex) ex.transcript = (ex.transcript + ' ' + v.transcript).trim();
    else byKey.set(key, { ...v });
  }
  return { items: [...byKey.values()], rawCount: raw.length, sample: raw[0] };
}
function keepNew(items, seen, getId, getDate, cutoffMs) {
  return items.filter((it) => {
    const id = getId(it);
    if (id && seen[id]) return false;          // already summarized before
    const ms = getDate(it);
    if (cutoffMs && ms && ms < cutoffMs) return false; // older than the window
    return true;
  });
}

// --- context loader (reuse research.mjs pattern) --------------------------------------
function readTrim(p, max = 1500) { try { const t = readFileSync(p, 'utf8').trim(); return t ? t.slice(0, max) : null; } catch { return null; } }
function loadContext() {
  if (noContext) return null;
  const parts = [];
  for (const f of ['me', 'work', 'team', 'current-priorities', 'goals']) {
    const c = readTrim(join(ROOT, 'context', `${f}.md`));
    if (c) parts.push(`### ${f}\n${c}`);
  }
  const pdir = join(ROOT, 'projects');
  if (existsSync(pdir)) {
    for (const d of readdirSync(pdir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const r = readTrim(join(pdir, d.name, 'README.md'), 800);
      if (r) parts.push(`### project: ${d.name}\n${r}`);
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

// --- main -----------------------------------------------------------------------------
if (!apifyKey) { console.error('ERROR: Apify key not found. Add to .env: APIFY_API_KEY=apify_api_v1_...'); process.exit(2); }
if (!fetchOnly && !pplxKey) { console.error('ERROR: Perplexity key not found. Add to .env: PERPLEXITY_API_KEY=pplx-...'); process.exit(2); }

const wl = loadWatchlist();
if (!wl.twitter.length && !wl.youtube.length) { console.error('No accounts to screen (watchlist empty or filter matched nothing).'); process.exit(1); }

const state = loadState();
const sinceMs = sinceOverride ? Date.parse(sinceOverride) : (state.lastRun ? Date.parse(state.lastRun) : null);
const cutoffMs = force ? 0 : ((sinceMs && !Number.isNaN(sinceMs)) ? sinceMs : (Date.now() - DEFAULT_WINDOW_DAYS * 86400000)); // force => no recency filter
process.stderr.write(`[since: ${force ? '(forced: full window)' : new Date(cutoffMs).toISOString()} | accounts: ${wl.twitter.length} X, ${wl.youtube.length} YT]\n`);

const twitter = {}, youtube = {}, errors = [];
const rawSamples = { twitter: {}, youtube: {} }; // for --fetch-only diagnostics
for (const acct of wl.twitter) {
  try { const r = await fetchTwitter(acct); rawSamples.twitter[acct.handle] = r; twitter[acct.handle] = keepNew(r.items, force ? {} : (state.twitter || {}), (t) => t.id, (t) => t.dateMs, cutoffMs); }
  catch (e) { errors.push(`twitter @${acct.handle}: ${e.message}`); twitter[acct.handle] = []; }
}
for (const acct of wl.youtube) {
  try { const r = await fetchYouTube(acct); rawSamples.youtube[acct.name || acct.url] = r; youtube[acct.name || acct.url] = keepNew(r.items, force ? {} : (state.youtube || {}), (v) => v.id, (v) => v.dateMs, cutoffMs); }
  catch (e) { errors.push(`youtube ${acct.name || acct.url}: ${e.message}`); youtube[acct.name || acct.url] = []; }
}

// --- calibration mode: show raw shapes, spend ~nothing, write nothing -----------------
if (fetchOnly) {
  console.log('=== FETCH-ONLY DIAGNOSTIC (no Perplexity call, no state/file writes) ===');
  for (const [h, r] of Object.entries(rawSamples.twitter)) {
    console.log(`\n[Twitter @${h}] raw items: ${r.rawCount} | passed normalize+recency: ${twitter[h].length}`);
    if (r.sample) { console.log('  raw keys:', Object.keys(r.sample).join(', ')); console.log('  raw sample:', trunc(JSON.stringify(r.sample), 700)); }
    else console.log('  (actor returned NO items — likely wrong input field; this actor may want startUrls/searchTerms instead of twitterHandles)');
  }
  for (const [name, r] of Object.entries(rawSamples.youtube)) {
    console.log(`\n[YouTube ${name}] raw items: ${r.rawCount} | passed normalize+recency: ${youtube[name].length}`);
    if (r.sample) { console.log('  raw keys:', Object.keys(r.sample).join(', ')); console.log('  raw sample:', trunc(JSON.stringify(r.sample), 700)); }
    else console.log('  (actor returned NO items — likely wrong input field; check buildYtInput())');
  }
  if (errors.length) { console.log('\nERRORS:'); errors.forEach((e) => console.log(' -', e)); }
  process.exit(errors.length ? 5 : 0);
}

const totalNew = Object.values(twitter).reduce((a, x) => a + x.length, 0) + Object.values(youtube).reduce((a, x) => a + x.length, 0);
if (totalNew === 0) {
  console.log(`No new content since ${new Date(cutoffMs).toISOString().slice(0, 10)}${errors.length ? ` (but ${errors.length} fetch error(s) — see stderr)` : ''}.`);
  process.exit(0);
}

// --- build dossier for Perplexity -----------------------------------------------------
const sections = [];
const allArticleUrls = [];
for (const [h, ts] of Object.entries(twitter)) {
  if (!ts.length) continue;
  const top = topN(ts, MAX_TWEETS);
  const body = top.map((t) => {
    const urls = extractArticleUrls(t.raw, t.text); urls.forEach((u) => allArticleUrls.push(u));
    const d = t.dateMs ? new Date(t.dateMs).toISOString().slice(0, 10) : '????-??-??';
    return `- (${d}) ${trunc(t.text, 1000)}${t.url ? ` [tweet](${t.url})` : ''}${urls.length ? `\n   linked articles: ${urls.join(' ')}` : ''}`;
  }).join('\n');
  sections.push(`## X / @${h}\n${body}`);
}
for (const [name, vs] of Object.entries(youtube)) {
  if (!vs.length) continue;
  const top = topN(vs, MAX_VIDEOS);
  const body = top.map((v) => `- **${v.title || '(untitled)'}**${v.url ? ` — ${v.url}` : ''}\n  transcript: ${trunc(v.transcript || '(no transcript returned)', MAX_TRANSCRIPT_CHARS)}`).join('\n');
  sections.push(`## YouTube / ${name}\n${body}`);
}

// record seen IDs for whatever we successfully fetched (so retries don't reprocess) — skipped under --force
if (!force) {
  for (const [, ts] of Object.entries(twitter)) for (const t of ts) if (t.id) state.twitter[t.id] = true;
  for (const [, vs] of Object.entries(youtube)) for (const v of vs) if (v.id) state.youtube[v.id] = true;
  if (!errors.length) state.lastRun = new Date().toISOString(); // advance window only on a clean run
}

const ctx = loadContext();
const system = [
  'You are a rigorous analyst screening a curated set of creators (X/Twitter + YouTube) for a busy founder/engineer who needs signal separated from noise.',
  'You receive raw captures posted since the last screening: tweets (with any linked articles) and YouTube video transcripts.',
  'TWO-PASS JOB — do both:',
  'PASS 1 — CLASSIFY each distinct point a creator makes as exactly one of:',
  '  - FACT: something the creator asserts as established/true (an event, a number, a release, a reported outcome).',
  '  - OPINION: the creator\'s take, prediction, recommendation, interpretation, or speculation.',
  'PASS 2 — VERIFY every FACT against current web sources (use your search). Tag each fact with exactly one of:',
  '  - confirmed: credible current sources support it as stated.',
  '  - disputed: sources contradict it, it is wrong, or it is framed misleadingly. Explain the discrepancy.',
  '  - unverifiable: no credible sources either way (niche, vague, paywalled, or too fresh).',
  '  Opinions are NOT verified (they are subjective) — label them as takes only.',
  'ABSOLUTE RULES:',
  '- When classifying is borderline, treat it as OPINION and append "(uncertain)".',
  '- Attribute every item to the creator who said it, with the original source link (tweet URL or video URL).',
  '- Every FACT must also carry a verification source link. Cite EVERY source as an INLINE markdown link with the FULL verbatim URL (e.g. "per Redfin](https://www.redfin.com/news/...)"). Do NOT use bare numeric markers like [9] — they break and silently drop sources. Never invent sources or URLs.',
  '- Summarize ONLY the content you were given. For linked article URLs, read and summarize what you can actually access; if you cannot access one, write "could not access" rather than inventing content.',
  '- Never fabricate quotes, numbers, dates, or claims. If a source is ambiguous, say so.',
  '- Lead with the most important items. Tight bullets, one-line takeaway each. No filler, no marketing language, no hype, NO EMOJIS.',
  '- Where clearly relevant, add a one-line note on why it matters for the user (AI-centric products, TypeScript, pre-revenue solo founder).',
  'FORMAT as GitHub-flavored markdown, in this order:',
  '1. A 1-3 sentence TL;DR of the most important movement.',
  '2. **Claims to scrutinize** — list EVERY fact you tagged disputed (highest-value signal), each with: the claim, who said it, why it\'s disputed, and a source. If none, write "None — no claims flagged as disputed."',
  '3. One section per creator (## @handle or channel name) with:',
  '   - **Facts** — each bullet carries the verification tag (**confirmed**/**disputed**/**unverifiable**), the original source link, and a verification source link.',
  '   - **Opinions** — each bullet carries the take and the original source link.',
  '   Omit a creator who had no new content.',
  '4. A short **Open questions / watch list** for next time.',
  'Do NOT write a "Sources" section — the harness builds it from the URLs you inline. Stop after "Open questions".',
].join('\n');

const userParts = [];
if (ctx) userParts.push(`USER PROFILE & CURRENT FOCUS (tailor relevance notes to this):\n${ctx}\n`);
userParts.push(`CAPTURED CREATOR CONTENT (since ${new Date(cutoffMs).toISOString().slice(0, 10)}):\n${sections.join('\n\n')}`);
const uniqArticles = [...new Set(allArticleUrls)].slice(0, 15);
userParts.push(`LINKED ARTICLES TO READ & SUMMARIZE (fetch what you can):\n${uniqArticles.length ? uniqArticles.map((u) => '- ' + u).join('\n') : '- (none)'}`);

const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: userParts.join('\n\n') }] };
const timeoutMs = model === 'sonar-deep-research' ? 600000 : 180000;
process.stderr.write(`[summarizing via ${model} | ${totalNew} new items${errors.length ? ` | ${errors.length} fetch errors` : ''}]\n`);

let content, citations, usedModel;
try {
  const res = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pplxKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); console.error(`Perplexity API error ${res.status}: ${e.slice(0, 600)}`); process.exit(3); }
  const data = await res.json();
  content = data?.choices?.[0]?.message?.content ?? '(no content returned)';
  citations = Array.isArray(data?.citations) ? data.citations : [];
  usedModel = data?.model || model;
} catch (e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') console.error(`Perplexity request timed out after ${timeoutMs / 1000}s. Try --depth standard or quick.`);
  else console.error(`Perplexity request failed: ${e?.message || e}`);
  process.exit(4);
}

// --- write immutable capture to the brain-dump knowledge base --------------------------
const today = new Date().toISOString().slice(0, 10);
mkdirSync(BRAINDUMP_RAW, { recursive: true });
let fpath = join(BRAINDUMP_RAW, `creator-watch-${today}.md`);
if (existsSync(fpath)) fpath = join(BRAINDUMP_RAW, `creator-watch-${today}-${new Date().toISOString().slice(11, 16).replace(':', '')}.md`);
const header = [
  '---',
  'type: creator-watch-capture',
  `date: ${today}`,
  `twitter: [${Object.keys(twitter).map((h) => '@' + h).join(', ')}]`,
  `youtube: [${Object.keys(youtube).join(', ')}]`,
  `new_items: ${totalNew}`,
  `window_since: ${new Date(cutoffMs).toISOString()}`,
  `model: ${usedModel}`,
  '---',
  '',
  `# Creator Watch — ${today}`,
  '',
  `> ${totalNew} new items since ${new Date(cutoffMs).toISOString().slice(0, 10)}. Facts are web-verified (confirmed/disputed/unverifiable).${errors.length ? ` ${errors.length} fetch error(s): ${errors.join('; ')}` : ''}`,
  '',
].join('\n');
// Perplexity's `citations` array is often a partial subset of what it actually cited (esp. for long,
// multi-search answers), so don't rely on it — collect every URL the model inlined in the text, then union.
const citedUrls = Array.from(new Set([
  ...((content.match(/https?:\/\/[^\s)\]>"']+/g) || []).map((u) => u.replace(/[.,;!?)\]]+$/, ''))),
  ...citations,
]));
const footer = citedUrls.length ? `\n\n---\n## Sources (${citedUrls.length})\n${citedUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : '\n';
writeFileSync(fpath, header + content + footer);
process.stderr.write(`[wrote ${fpath} | model: ${usedModel} | sources: ${citedUrls.length} (perplexity citations array: ${citations.length})]\n`);

if (!force) saveState(state);

// --- present in chat (casual, tight, no emojis — see .claude/rules) --------------------
console.log(content);
if (citedUrls.length) { console.log('\n--- Sources ---'); citedUrls.forEach((u, i) => console.log(`${i + 1}. ${u}`)); }
console.log(`\n_(saved to ${fpath})_`);
