#!/usr/bin/env node
// research.mjs — context-aware deep research via the Perplexity API.
// Loads PERPLEXITY_API_KEY from .env (the assistant never sees the key) and
// auto-attaches the user's profile/goals/projects so research is tailored.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..'); // .claude/skills/research -> repo root

// --- args ---
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const depth = flag('depth') || 'deep';
const focus = flag('focus');
const modelOverride = flag('model');
const noContext = args.includes('--no-context');
const query = args.filter((a) => !a.startsWith('--')).join(' ').trim();

if (!query) {
  console.error('Usage: node research.mjs "<query>" [--depth quick|standard|deep] [--focus "..."] [--model sonar-pro] [--no-context]');
  process.exit(1);
}

const MODELS = { quick: 'sonar', standard: 'sonar-pro', deep: 'sonar-deep-research' };
const model = modelOverride || MODELS[depth] || MODELS.deep;
const timeoutMs = depth === 'deep' ? 600000 : 120000; // deep research can take minutes

// --- API key: prefer process.env, fall back to .env ---
function loadKey() {
  const env = process.env.PERPLEXITY_API_KEY;
  if (env && env.trim()) return env.trim();
  try {
    const txt = readFileSync(join(ROOT, '.env'), 'utf8');
    const m = txt.match(/^PERPLEXITY_API_KEY\s*=\s*(.+)$/m);
    if (m) {
      const v = m[1].trim().replace(/^["']|["']$/g, '');
      if (v && !/^your[-_ ]?key/i.test(v)) return v;
    }
  } catch {}
  return null;
}
const apiKey = loadKey();
if (!apiKey) {
  console.error('ERROR: PERPLEXITY_API_KEY not set. Add it to .env in the project root:\n  PERPLEXITY_API_KEY=pplx-xxxxxxxx');
  process.exit(2);
}

// --- load user context so research is tailored ---
function readTrim(p, max = 1500) {
  try {
    const t = readFileSync(p, 'utf8').trim();
    return t ? t.slice(0, max) : null;
  } catch { return null; }
}
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
      const readme = readTrim(join(pdir, d.name, 'README.md'), 800);
      if (readme) parts.push(`### project: ${d.name}\n${readme}`);
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}
const ctx = loadContext();

// --- build messages ---
const system = [
  'You are a rigorous research analyst for a busy founder/engineer.',
  'Be precise, factual, and concise. Cite sources inline. No filler, no marketing language.',
  'When given a USER PROFILE, tailor the analysis to what matters for that person — weight relevance to their goals, product, and current focus.',
  'Structure the answer with tight sections/bullets. When a profile is provided, end with a short "Relevance to your work" note.',
].join(' ');

const userParts = [];
if (ctx) userParts.push(`USER PROFILE & CURRENT FOCUS:\n${ctx}\n`);
userParts.push(`RESEARCH REQUEST:\n${query}`);
if (focus) userParts.push(`\nANGLE / FOCUS: ${focus}`);
const userContent = userParts.join('\n');

const body = {
  model,
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ],
};

// --- call Perplexity ---
try {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Perplexity API error ${res.status}: ${err.slice(0, 600)}`);
    process.exit(3);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '(no content returned)';
  const citations = Array.isArray(data?.citations) ? data.citations : [];

  process.stderr.write(`[model: ${data?.model || model} | sources: ${citations.length} | context: ${ctx ? 'on' : 'off'}]\n`);
  console.log(content);
  if (citations.length) {
    console.log('\n--- Sources ---');
    citations.forEach((c, i) => console.log(`${i + 1}. ${c}`));
  }
} catch (e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    console.error(`Request timed out after ${timeoutMs / 1000}s. Try --depth standard for a faster pass.`);
  } else {
    console.error(`Request failed: ${e?.message || e}`);
  }
  process.exit(4);
}
