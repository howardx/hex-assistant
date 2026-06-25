#!/usr/bin/env node
// media-notes.mjs — ad-hoc media → summary. Fetch a transcript (YouTube now; extensible to
// podcasts/other audio later), summarize via Perplexity, and write a brain-dump-ingest-ready
// summary + verbatim transcript into brain-dump/knowledge/raw/.
//
// Usage:
//   node media-notes.mjs <media-url> [--no-transcript] [--depth quick|standard|deep] [--model MODEL]
//   node media-notes.mjs https://www.youtube.com/watch?v=2OD14-0cot4
//
// Writes a paired two-file set into brain-dump/knowledge/raw/ (easy to tell apart by filename):
//   <slug>.md             — ingest-ready SUMMARY        (type: source)
//   <slug>.transcript.md  — verbatim TRANSCRIPT         (type: transcript)   [unless --no-transcript]
// Hex writes only raw/; the brain-dump workspace owns the wiki layer (wiki/, index.md, log.md).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..'); // .claude/skills/media-notes -> hex root
const BRAINDUMP_RAW = '/Users/howard/src/brain-dump/knowledge/raw';

const YT_ACTOR = 'codepoetry~youtube-transcript-ai-scraper';
const APIFY_BASE = 'https://api.apify.com/v2/acts';
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar-pro';
const MAX_TRANSCRIPT_SUMMARY = 40000; // chars sent to Perplexity (full transcript is still saved verbatim)

// --- args ---
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || !args.some((a) => !a.startsWith('--'))) {
  console.error('Usage: node media-notes.mjs <media-url> [--no-transcript] [--focus "..."] [--transcript-file <path> --title "..." --author "..."] [--depth quick|standard|deep] [--model MODEL]');
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}
const flag = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 && args[i + 1] ? args[i + 1] : null; };
const depth = flag('depth');
const modelOverride = flag('model');
const keepTranscript = !args.includes('--no-transcript');
const focus = flag('focus');
const transcriptFile = flag('transcript-file');
const titleArg = flag('title');
const authorArg = flag('author');
const url = args.find((a) => !a.startsWith('--'));
const model = modelOverride || (depth === 'deep' ? 'sonar-deep-research' : depth === 'quick' ? 'sonar' : DEFAULT_MODEL);

// --- keys (mirror research.mjs / screen.mjs; never log values) ---
function readEnvFile() { try { return readFileSync(join(ROOT, '.env'), 'utf8'); } catch { return null; } }
function envKey(names) {
  for (const n of names) { const v = process.env[n]; if (v && v.trim()) return v.trim(); }
  const txt = readEnvFile();
  if (txt) for (const n of names) { const m = txt.match(new RegExp(`^${n}\\s*=\\s*(.+)$`, 'm')); if (m) { const v = m[1].trim().replace(/^["']|["']$/g, ''); if (v && !/^your[-_ ]?key/i.test(v)) return v; } }
  return null;
}
const pplxKey = envKey(['PERPLEXITY_API_KEY']);
const apifyKey = envKey(['APIFY_API_KEY', 'APIFY_TOKEN', 'APIFY_API_TOKEN']);
if (!apifyKey) { console.error('ERROR: Apify key not found. Add APIFY_API_KEY to .env'); process.exit(2); }
if (!pplxKey) { console.error('ERROR: Perplexity key not found. Add PERPLEXITY_API_KEY to .env'); process.exit(2); }

// --- platform detection (extensible: add branches here for podcasts / other audio) ---
function detect(u) {
  let p; try { p = new URL(u); } catch { return null; }
  const h = p.hostname.replace(/^www\./, '').toLowerCase();
  if (h === 'youtube.com' || h === 'm.youtube.com') { const v = p.searchParams.get('v'); if (v) return { platform: 'youtube', id: v, url: `https://www.youtube.com/watch?v=${v}` }; }
  if (h === 'youtu.be') { const id = p.pathname.slice(1); if (id) return { platform: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` }; }
  return null;
}
const meta = url ? detect(url) : null;
if (!transcriptFile && !meta) { console.error(`ERROR: unsupported or unrecognized URL: ${url}\nOnly YouTube is wired up so far. Ask to add Apple Podcasts / other platforms (would transcribe audio via Whisper).`); process.exit(1); }

// --- apify run ---
async function runActor(actorId, input) {
  const u = `${APIFY_BASE}/${actorId}/run-sync-get-dataset-items?timeout=290`;
  process.stderr.write(`[fetch] ${actorId}...\n`);
  const res = await fetch(u, { method: 'POST', headers: { Authorization: `Bearer ${apifyKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(295000) });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Apify ${actorId} ${res.status}: ${t.slice(0, 400)}`); }
  const d = await res.json();
  return Array.isArray(d) ? d : (d?.items || d?.data || []);
}
function first(o, keys) { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return undefined; }

// --- fetch transcript (YouTube) ---
async function fetchYouTube(m) {
  const items = await runActor(YT_ACTOR, { startUrls: [{ url: m.url }], maxItems: 1 });
  const it = items.find((x) => x?.metadata?.id || first(x, ['id', 'videoId'])) || items[0];
  if (!it) return null;
  const md = it?.metadata && typeof it.metadata === 'object' ? it.metadata : {};
  const id = md.id || m.id;
  const title = md.title || first(it, ['title', 'name']) || `YouTube ${id}`;
  const author = md.channel || md.author || md.uploader || first(it, ['author', 'channel', 'uploader']) || 'unknown';
  let t = first(it, ['transcript_llm', 'transcript_text', 'transcript', 'plainText', 'text', 'content']);
  if (Array.isArray(t)) t = t.map((s) => typeof s === 'string' ? s : (s?.text ?? '')).join(' ');
  else if (t && typeof t === 'object') t = JSON.stringify(t);
  const sourceDate = md.publishedAt || md.uploadDate || md.published || md.date || '';
  return { id, title, author, sourceDate: sourceDate ? String(sourceDate).slice(0, 10) : 'unknown', videoUrl: md.url || m.url, transcript: String(t ?? '').trim() };
}

let fetched;
if (transcriptFile) {
  // local transcript (e.g., whisper-cpp output for a caption-less video)
  let transcript;
  try { transcript = readFileSync(transcriptFile, 'utf8'); } catch (e) { console.error(`ERROR: cannot read --transcript-file ${transcriptFile}: ${e.message}`); process.exit(1); }
  if (!transcript || transcript.replace(/\s/g, '').length < 50) { console.error(`ERROR: --transcript-file is empty: ${transcriptFile}`); process.exit(3); }
  fetched = { id: meta?.id || '', title: titleArg || 'Untitled media', author: authorArg || 'unknown', sourceDate: 'unknown', videoUrl: url || '(none)', transcript };
  process.stderr.write(`[fetch] using local transcript ${transcriptFile} — ${transcript.length} chars\n`);
} else {
  try { fetched = meta.platform === 'youtube' ? await fetchYouTube(meta) : null; }
  catch (e) { console.error(`ERROR fetching transcript: ${e.message}`); process.exit(3); }
  if (!fetched || !fetched.transcript || fetched.transcript.replace(/\s/g, '').length < 50) {
    console.error(`ERROR: no transcript returned for ${meta.url} (captions disabled? private? member-only?). Tip: transcribe locally (yt-dlp + whisper-cpp) and re-run with --transcript-file <path> --title "..." --author "..."`);
    process.exit(3);
  }
  process.stderr.write(`[fetch] "${fetched.title}" — ${fetched.transcript.length} chars\n`);
}

// --- summarize via Perplexity (plain summary: no facts/opinions split, no web-verification) ---
const today = new Date().toISOString().slice(0, 10);
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + ` …[+${s.length - n} chars]` : s; };
const systemLines = [
  'You are summarizing a media transcript (video/podcast) for a busy founder/engineer\'s personal knowledge base.',
  'Summarize ONLY the transcript provided — never fabricate content, quotes, or numbers.',
  'Output GitHub-flavored markdown with these sections, in order:',
  '1. **TL;DR** — 2-3 sentences capturing the whole thing.',
  '2. **Key takeaways** — tight bullets, most important first.',
  '3. **Notable claims & quotes** — the specific factual claims plus a few short verbatim quotes (with approximate timestamps if present).',
  '4. **Entities & concepts** — people, orgs, products, terms worth remembering.',
  '5. **Quality / stance** — source type, rigor, evident bias, date; anything to weigh it.',
  '6. End with one line exactly like: `Tags: tag-one, tag-two, tag-three` (3-6 lowercase kebab-case tags).',
  'No filler, no marketing language, NO EMOJIS. Tight bullets.',
];
if (focus) systemLines.push(`A FOCUS topic is specified below. Give it special, thorough attention: capture EVERY relevant detail — specifics, numbers, eligibility, equity/terms, how-to-apply, deadlines — prominently in Key takeaways and Notable claims. If the transcript does NOT actually discuss the focus, say so explicitly instead of inventing anything.`);
const system = systemLines.join('\n');
const userMsg = `TITLE: ${fetched.title}\nAUTHOR/CHANNEL: ${fetched.author}\nURL: ${fetched.videoUrl}\nDATE: ${fetched.sourceDate}\n${focus ? `\nFOCUS (give this special attention): ${focus}\n` : ''}\nTRANSCRIPT:\n${trunc(fetched.transcript, MAX_TRANSCRIPT_SUMMARY)}`;
const reqBody = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] };
const timeoutMs = model === 'sonar-deep-research' ? 600000 : 180000;
process.stderr.write(`[summarize] via ${model}...\n`);
let summary, tags = [];
try {
  const res = await fetch(PERPLEXITY_URL, { method: 'POST', headers: { Authorization: `Bearer ${pplxKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(reqBody), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) { const e = await res.text().catch(() => ''); console.error(`Perplexity error ${res.status}: ${e.slice(0, 500)}`); process.exit(4); }
  const d = await res.json();
  summary = d?.choices?.[0]?.message?.content ?? '(no content)';
  const tm = summary.match(/Tags:\s*(.+)$/im);
  if (tm) { tags = tm[1].split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')).filter(Boolean).slice(0, 6); summary = summary.replace(/\n*Tags:\s*.+$/im, '').trim(); }
} catch (e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') console.error(`Perplexity timed out after ${timeoutMs / 1000}s — try --depth quick.`);
  else console.error(`Perplexity failed: ${e?.message || e}`);
  process.exit(4);
}

// --- slug + collision-safe paths ---
function slugify(s, fallback) {
  const slug = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  return slug && slug.length >= 3 ? slug : fallback;
}
const baseSlug = slugify(fetched.title, `yt-${fetched.id}`);
let slug = baseSlug, n = 2;
while (existsSync(join(BRAINDUMP_RAW, `${slug}.md`)) || (keepTranscript && existsSync(join(BRAINDUMP_RAW, `${slug}.transcript.md`)))) { slug = `${baseSlug}-${n++}`; }
const sumPath = join(BRAINDUMP_RAW, `${slug}.md`);
const trPath = join(BRAINDUMP_RAW, `${slug}.transcript.md`);

// --- write summary file (ingest-ready) ---
const summaryFile = [
  '---',
  'type: source',
  `title: ${JSON.stringify(fetched.title)}`,
  `author: ${JSON.stringify(fetched.author)}`,
  `source_date: ${fetched.sourceDate}`,
  `ingested: ${today}`,
  `url: ${fetched.videoUrl}`,
  keepTranscript ? `source_path: raw/${slug}.transcript.md` : 'source_path: none',
  'platform: youtube',
  'media: media-notes',
  tags.length ? `tags: [${tags.join(', ')}]` : 'tags: []',
  '---',
  '',
  `# ${fetched.title}`,
  '',
  `> **Source:** [${fetched.videoUrl}](${fetched.videoUrl}) · ${fetched.author} · ${fetched.sourceDate}`,
  keepTranscript ? `> **Verbatim transcript:** \`raw/${slug}.transcript.md\`` : `> *(verbatim transcript not saved — re-run without --no-transcript to keep it)*`,
  '',
  summary,
  '',
].join('\n');
writeFileSync(sumPath, summaryFile);

// --- write verbatim transcript file ---
if (keepTranscript) {
  writeFileSync(trPath, [
    '---',
    'type: transcript',
    `title: ${JSON.stringify(fetched.title)}`,
    `url: ${fetched.videoUrl}`,
    `summary: raw/${slug}.md`,
    'platform: youtube',
    'media: media-notes',
    `captured: ${today}`,
    '---',
    '',
    `# ${fetched.title} — verbatim transcript`,
    '',
    `Source: ${fetched.videoUrl}`,
    '',
    fetched.transcript,
    '',
  ].join('\n'));
}

process.stderr.write(`[wrote] ${sumPath}${keepTranscript ? ` + ${trPath}` : ''}\n`);
console.log(summary);
console.log(`\n_(saved: ${sumPath}${keepTranscript ? ` · verbatim transcript: ${trPath}` : ''})_`);
