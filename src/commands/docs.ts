/**
 * `lamina docs <query>` — search Lamina docs from the terminal.
 *
 * Data source: `https://docs.uselamina.ai/llms-full.txt` — a Mintlify
 * auto-generated single text file containing every published doc page
 * concatenated, with `# <Title>` + `Source: <URL>` markers between pages.
 *
 * No server-side search service is built. We rely on what Mintlify already
 * publishes for free, fetch it once, cache it locally, search in-memory.
 *
 * Mechanics:
 *   1. First call fetches https://docs.uselamina.ai/llms-full.txt
 *   2. Cache at ~/.lamina/docs-cache.json with 1-hour TTL
 *   3. Parse cache into sections (one per doc page)
 *   4. Rank sections by query keyword hits (heading > body)
 *   5. Return top N (default 10) as { title, url, snippet }
 *
 * The agent uses the snippet to answer the question if it's enough; if not,
 * it can WebFetch the URL for the full page content.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { EXIT, LaminaCliError } from '../lib/errors.js';
import { detectJsonModeFromArgs, isJsonMode } from '../lib/outputMode.js';
import { printJson } from '../lib/output.js';

const DOCS_BASE = 'https://docs.uselamina.ai';
const LLMS_PATH = '/llms-full.txt';
const CACHE_DIR = join(homedir(), '.lamina');
const CACHE_PATH = join(CACHE_DIR, 'docs-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LIMIT = 10;
const SNIPPET_RADIUS = 80; // chars on each side of the match
const SNIPPET_MAX = 180;

const HELP = `Usage: lamina docs <query> [--limit N] [--json]

Search Lamina's docs from the terminal. Useful when an agent needs to
look up a concept (auth, webhook signing, brand DNA, etc.) without
opening a browser.

Arguments:
  <query>           Words or phrase to search for. Multi-word queries are
                    supported (the whole rest of the line after flags
                    becomes the query).

Options:
  --limit <N>       Max results to return (default 10).
  --json            Emit results as a JSON envelope (for agents / scripts).
  --help, -h

Examples:
  lamina docs webhook signing
  lamina docs "OAuth refresh token" --limit 5 --json
`;

// ─── Section parsing ────────────────────────────────────────────────────────

interface DocSection {
  title: string;
  url: string;
  body: string;
}

interface CacheFile {
  fetchedAt: string; // ISO timestamp
  source: string;
  raw: string;
}

/**
 * Split the llms-full.txt into per-page sections. Each page begins with:
 *   # <title>
 *   Source: <url>
 *   <body>
 *   <blank line(s)>
 *
 * Pages without a `Source:` line are kept (their `url` falls back to the
 * docs base) so query coverage is never silently dropped.
 */
function parseSections(raw: string): DocSection[] {
  const lines = raw.split('\n');
  const sections: DocSection[] = [];
  let current: { title: string; url: string; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#\s+\S/.test(line) && !/^#\s*\d/.test(line); // skip # 1, # comments
    if (isHeading) {
      if (current) {
        sections.push({ title: current.title, url: current.url, body: current.lines.join('\n') });
      }
      const title = line.replace(/^#\s+/, '').trim();
      // Look ahead for an optional `Source: <url>` on the next line
      let url = DOCS_BASE;
      const next = lines[i + 1];
      if (next && /^Source:\s*https?:\/\//.test(next)) {
        url = next.replace(/^Source:\s*/, '').trim();
        i++; // consume the Source line
      }
      current = { title, url, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    sections.push({ title: current.title, url: current.url, body: current.lines.join('\n') });
  }
  return sections;
}

// ─── Ranked search ──────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildSnippet(body: string, queryTokens: string[]): string {
  const lower = body.toLowerCase();
  // Find the first match position of any query token
  let firstHit = -1;
  for (const tok of queryTokens) {
    const idx = lower.indexOf(tok);
    if (idx !== -1 && (firstHit === -1 || idx < firstHit)) firstHit = idx;
  }
  if (firstHit === -1) {
    // No body hit (matched in title only) — return the leading sentence
    return body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX);
  }
  const start = Math.max(0, firstHit - SNIPPET_RADIUS);
  const end = Math.min(body.length, firstHit + SNIPPET_RADIUS);
  let slice = body.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) slice = `…${slice}`;
  if (end < body.length) slice = `${slice}…`;
  return slice.slice(0, SNIPPET_MAX);
}

function rankSections(sections: DocSection[], query: string, limit: number): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored: SearchResult[] = [];
  for (const sec of sections) {
    const titleLower = sec.title.toLowerCase();
    const bodyLower = sec.body.toLowerCase();
    let score = 0;
    for (const tok of queryTokens) {
      // Title hits are 5x more valuable than body hits
      const titleHits = countOccurrences(titleLower, tok);
      const bodyHits = countOccurrences(bodyLower, tok);
      score += titleHits * 5 + bodyHits;
    }
    if (score > 0) {
      scored.push({
        title: sec.title,
        url: sec.url,
        snippet: buildSnippet(sec.body, queryTokens),
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

// ─── Caching ────────────────────────────────────────────────────────────────

async function loadFreshCache(): Promise<CacheFile | null> {
  try {
    const text = await readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(text) as CacheFile;
    const age = Date.now() - Date.parse(parsed.fetchedAt);
    if (age >= 0 && age < CACHE_TTL_MS) return parsed;
    return null; // stale
  } catch {
    return null;
  }
}

async function fetchAndCache(): Promise<CacheFile> {
  const url = `${DOCS_BASE}${LLMS_PATH}`;
  const res = await fetch(url, { headers: { 'User-Agent': '@uselamina/cli docs' } });
  if (!res.ok) {
    throw new LaminaCliError({
      code: 'network_unreachable',
      exitCode: EXIT.RUNTIME_ERROR,
      message: `Could not fetch Lamina docs index (${res.status} from ${url}).`,
      suggestion:
        'Check your network connection. If docs.uselamina.ai is up, this may be a transient hiccup — retry in a moment.',
    });
  }
  const raw = await res.text();
  const cache: CacheFile = {
    fetchedAt: new Date().toISOString(),
    source: url,
    raw,
  };
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache));
  return cache;
}

async function getDocs(): Promise<CacheFile> {
  const fresh = await loadFreshCache();
  if (fresh) return fresh;
  return fetchAndCache();
}

// ─── Argument parsing ───────────────────────────────────────────────────────

interface ParsedArgs {
  query: string;
  limit: number;
}

function parseArgs(args: string[]): ParsedArgs {
  let limit = DEFAULT_LIMIT;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') continue; // already detected
    if (a === '--limit') {
      const next = args[i + 1];
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        throw new LaminaCliError({
          code: 'invalid_argument',
          exitCode: EXIT.INVALID_USAGE,
          message: `--limit expects a positive integer (got ${JSON.stringify(next)}).`,
          suggestion: 'Try `lamina docs <query> --limit 5`.',
        });
      }
      limit = Math.floor(n);
      i++;
      continue;
    }
    if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isFinite(n) || n <= 0 || n > 100) {
        throw new LaminaCliError({
          code: 'invalid_argument',
          exitCode: EXIT.INVALID_USAGE,
          message: `--limit expects a positive integer (got ${a}).`,
        });
      }
      limit = Math.floor(n);
      continue;
    }
    if (a.startsWith('--')) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `Unknown flag: ${a}`,
        suggestion: 'Run `lamina docs --help` for valid flags.',
      });
    }
    queryParts.push(a);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'A search query is required.',
      suggestion: 'Try `lamina docs webhook signing` or `lamina docs --help`.',
    });
  }
  return { query, limit };
}

// ─── Output ─────────────────────────────────────────────────────────────────

function printResults(query: string, results: SearchResult[], cacheAgeSeconds: number): void {
  if (results.length === 0) {
    process.stdout.write(`No results for "${query}".\n`);
    process.stdout.write(`Try broader terms or browse https://docs.uselamina.ai\n`);
    return;
  }
  process.stdout.write(
    `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`,
  );
  if (cacheAgeSeconds > 0) {
    process.stdout.write(` (cache age ${cacheAgeSeconds}s)`);
  }
  process.stdout.write(`:\n\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.title}\n`);
    process.stdout.write(`    ${r.url}\n`);
    if (r.snippet) {
      process.stdout.write(`    ${r.snippet}\n`);
    }
    process.stdout.write(`\n`);
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleDocsCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  detectJsonModeFromArgs(args);

  const { query, limit } = parseArgs(args);
  const cache = await getDocs();
  const sections = parseSections(cache.raw);
  const results = rankSections(sections, query, limit);
  const cacheAgeSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(cache.fetchedAt)) / 1000));

  if (isJsonMode()) {
    printJson({
      query,
      results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
      count: results.length,
      cacheAgeSeconds,
    });
    return;
  }
  printResults(query, results, cacheAgeSeconds);
}

// Suppress lint-warn for unused stat import on some toolchains
void stat;
