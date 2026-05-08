/**
 * Quiet update-availability check against the npm registry.
 *
 * Behaviour:
 *   - Cache the result of querying `https://registry.npmjs.org/@uselamina/cli/latest`
 *     at `~/.lamina/update-cache.json` for 24 hours.
 *   - Never block the CLI: a failed lookup or a slow network returns
 *     `null` and the user gets nothing extra.
 *   - Compares the installed version (from the bundled package.json) to
 *     the registry's `latest` tag using simple semver-like ordering.
 *
 * Why fetch every time would be wrong: `lamina --version` is a hot
 * inner-loop command. Hitting the registry adds ~200ms and an external
 * dependency to a command that should be instant. 24-hour cache means
 * the agent learns about updates within a day without paying the cost
 * on every call.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CACHE_PATH = join(homedir(), '.lamina', 'update-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/@uselamina/cli/latest';
const FETCH_TIMEOUT_MS = 1500;

interface CacheFile {
  fetchedAt: string;
  latest: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10));
  const pb = b.split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (Date.now() - Date.parse(parsed.fetchedAt) < CACHE_TTL_MS) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(latest: string): Promise<void> {
  try {
    await mkdir(dirname(CACHE_PATH), { recursive: true });
    await writeFile(
      CACHE_PATH,
      JSON.stringify({ fetchedAt: new Date().toISOString(), latest }),
    );
  } catch {
    // best effort — cache failure should never break --version
  }
}

async function fetchLatest(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(REGISTRY_URL, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { version?: string };
      return typeof json.version === 'string' ? json.version : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Returns the latest published version if it's NEWER than `currentVersion`.
 * Returns null in every other case (cache cold + fetch failed, no
 * connection, identical, or installed > registry which can happen during
 * a release).
 */
export async function getUpdateAvailable(currentVersion: string): Promise<string | null> {
  if (!currentVersion || currentVersion === 'unknown') return null;
  const cached = await readCache();
  let latest = cached?.latest ?? null;
  if (!latest) {
    latest = await fetchLatest();
    if (latest) await writeCache(latest);
  }
  if (!latest) return null;
  return compareVersions(latest, currentVersion) > 0 ? latest : null;
}
