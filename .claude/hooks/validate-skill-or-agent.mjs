#!/usr/bin/env node
// PreToolUse hook: validate new/edited skill & subagent files against best practices.
// Blocks (exit 2) on missing required frontmatter; warns (exit 0, stdout) on verbosity.
// Wired in .claude/settings.json on the Write matcher.
import { readFileSync } from 'node:fs';

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0); // no stdin -> nothing to validate
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // malformed input -> don't block
}

const toolName = payload?.tool_name ?? '';
const filePath = payload?.tool_input?.file_path ?? '';
const content = payload?.tool_input?.content ?? '';

if (toolName !== 'Write') process.exit(0);

const p = String(filePath).replace(/\\/g, '/');
const isAgent = /\/\.claude\/agents\/.*\.md$/.test(p);
const isSkill = /\/\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p);
if (!isAgent && !isSkill) process.exit(0);

if (!content.startsWith('---')) {
  console.error(`[skill/agent check] ${filePath}: missing YAML frontmatter.`);
  process.exit(2);
}

const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error(`[skill/agent check] ${filePath}: malformed frontmatter.`);
  process.exit(2);
}
const fm = fmMatch[1];
const hasKey = (k) => new RegExp(`^${k}[ \\t]*:`, 'm').test(fm);
const getValue = (k) => {
  const m = fm.match(new RegExp(`^${k}[ \\t]*:[ \\t]*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};

const warnings = [];
const block = (msg) => { console.error(`[skill/agent check] ${filePath}: ${msg}`); process.exit(2); };

if (isAgent) {
  if (!hasKey('name') || !getValue('name')) block(`subagent missing required 'name' (lowercase, hyphens, unique).`);
  if (!hasKey('description') || !getValue('description')) block(`subagent missing required 'description' (when to delegate).`);
  const desc = getValue('description').toLowerCase();
  if (!/use|when|invoke|delegate|proactively/.test(desc)) {
    warnings.push(`agent 'description' should state WHEN to delegate (consider adding "use proactively").`);
  }
} else if (isSkill) {
  if (!hasKey('description') || !getValue('description')) block(`skill missing required 'description' (what it does + when to use it).`);
  const lines = content.split('\n').length;
  if (lines > 500) warnings.push(`skill body is ${lines} lines — keep under 500; move detail to supporting files.`);
}

if (warnings.length) console.log(`[skill/agent check] ${filePath}: ${warnings.join(' ')}`);
process.exit(0);
