/**
 * `lamina apps` — read-only catalog inspection.
 *
 * Subcommands:
 *   - lamina apps list  [<keyword> ...] [--limit n] [--public | --private] [--json]
 *   - lamina apps get   <appId>                                              [--json]
 *
 * Discovery model:
 *   - No keywords  → browse mode. Returns the workspace's apps + top public
 *                    apps (capped by --limit) via `GET /v1/apps`.
 *   - 1+ keywords  → smart search. Positional keywords are joined into an
 *                    intent string and sent to `POST /v1/apps/discover`,
 *                    which runs the same `searchApps()` scorer the MCP
 *                    `lamina_discover` tool and the content-router agents use
 *                    (SQL prefilter against the keyword pool, then a weighted
 *                    JS scorer with medium-bonus + popularity).
 *
 * The CLI deliberately mirrors the MCP tool's keyword-list contract so an
 * agent that knows one knows both.
 *
 * Auth comes from stored credentials (`lamina login`) or LAMINA_API_KEY env.
 * No per-command --api-key / --base-url flags — that's not a convention
 * mature CLIs use; auth is global.
 *
 * The `workflow` subcommand was removed: it returned the internal React
 * Flow graph (random node IDs, internal node types) which isn't a user or
 * agent surface. The REST endpoint /v1/apps/:id/workflow stays for internal
 * tooling.
 */
import { parseArgs } from 'node:util';

import { maybePrintBootstrapHint } from '../lib/bootstrap.js';
import { createClientFromAuthContext } from '../lib/config.js';
import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { printAppDetail, printAppList, printJson } from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const APPS_HELP = `Usage: lamina apps <subcommand> [options]

Inspect Lamina apps available in your workspace (and public apps from
other workspaces).

Subcommands:
  list   List apps with name + description
  get    Show full parameter spec for one app

Run \`lamina apps <subcommand> --help\` for details.
`;

const LIST_HELP = `Usage: lamina apps list [<keyword> ...] [options]

Find the right app for a brief. Two modes:

  Browse mode  — no keywords. Returns the workspace's apps + top public
                 apps (capped by --limit). Use when you want to see what's
                 available.

  Smart search — one or more positional keywords. Routed through the same
                 scored matcher the MCP \`lamina_discover\` tool uses
                 (\`searchApps()\` server-side). Combine medium + form +
                 context for the best results, e.g.:
                   product video reel 9:16
                   hero banner lifestyle ecommerce
                   selfie celebrity portrait

Options:
  --limit <n>         Cap the result count (default 20 in search, 10 public
                      in browse mode).
  --public            Show only public apps (filtered client-side).
  --private           Show only your workspace's private apps.
  --json              Output raw JSON instead of the human-readable format.
  -h, --help          Show this help.

Examples:
  lamina apps list
  lamina apps list selfie portrait
  lamina apps list product video reel --limit 10
  lamina apps list "celebrity portrait" --json

Agents should pass several intent angles in one call — the matcher does
the union + scoring. Avoid making many narrow calls with one keyword each.
`;

const GET_HELP = `Usage: lamina apps get <appId> [--json] [-h, --help]

Show the full parameter spec for one app, including each parameter's
\`key\` (the snake_case identifier you use when running the app), type,
required-flag, default value, and accepted formats.

Example:
  lamina apps get aa6b2547-804f-4c2f-8de1-f8eb2994cfc1
`;

export async function handleAppsCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    process.stdout.write(APPS_HELP);
    return;
  }

  if (subcommand === 'list') {
    await handleList(rest);
    return;
  }

  if (subcommand === 'get') {
    await handleGet(rest);
    return;
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown apps subcommand: "${subcommand}".`,
    suggestion: 'Run `lamina apps --help` for the list of subcommands.',
  });
}

// ─── list ───────────────────────────────────────────────────────────────────

async function handleList(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(LIST_HELP);
    return;
  }

  const parsed = parseArgs({
    args,
    options: {
      limit: { type: 'string' },
      public: { type: 'boolean' },
      private: { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (parsed.values.public && parsed.values.private) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--public and --private are mutually exclusive.',
      suggestion: 'Pass at most one of them, or omit both to list everything.',
    });
  }

  const limit = parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `--limit must be a positive integer, got "${parsed.values.limit}".`,
    });
  }

  const keywords = (parsed.positionals || []).map((k) => k.trim()).filter(Boolean);

  let apps;
  let raw;
  try {
    const { client } = await createClientFromAuthContext();

    if (keywords.length > 0) {
      // Smart search — same matcher MCP `lamina_discover` and the content
      // router agents use. Join positional keywords into an intent string;
      // server tokenizes and runs SQL prefilter + scored re-rank.
      raw = await client.apps.discover({
        intent: keywords.join(' '),
        limit: limit ?? 20,
      });
      apps = raw.data.matches.map(toAppSummary);
    } else {
      // Browse mode — workspace's own apps + top public apps.
      raw = await client.apps.list({ limit });
      apps = raw.data;
    }
  } catch (err) {
    throw classifyError(err);
  }

  if (parsed.values.public) {
    apps = apps.filter((a) => a.isPublic);
  } else if (parsed.values.private) {
    apps = apps.filter((a) => !a.isPublic);
  }

  if (parsed.values.json || isJsonMode()) {
    printJson({ ...raw, data: apps });
    return;
  }

  printAppList(apps);
  await maybePrintBootstrapHint();
}

/**
 * Map `DiscoveredApp` (from `apps.discover()`) onto the `AppSummary` shape
 * the printer expects. `isPublic` isn't surfaced by discover today — we
 * default to true (most cross-workspace matches are public) so the public/
 * private filter behaves predictably. capabilities/icon/etc. are passed
 * through when present.
 */
function toAppSummary(match: import('@uselamina/sdk').DiscoveredApp): import('@uselamina/sdk').AppSummary {
  return {
    appId: match.appId,
    name: match.name,
    description: match.description,
    isPublic: true,
    capabilities: match.capabilities ?? null,
    thumbnail: match.thumbnail ?? null,
  };
}

// ─── get ────────────────────────────────────────────────────────────────────

async function handleGet(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(GET_HELP);
    return;
  }

  const appId = args[0];
  if (!appId) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <appId>.',
      suggestion:
        'Run `lamina apps get <appId>`. Use `lamina apps list` to see the available IDs.',
    });
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      json: { type: 'boolean' },
    },
    allowPositionals: false,
  });

  let response;
  try {
    const { client } = await createClientFromAuthContext();
    response = await client.apps.get(appId);
  } catch (err) {
    throw classifyError(err);
  }

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
    return;
  }

  printAppDetail(response.data);
  await maybePrintBootstrapHint();
}
