/**
 * `lamina apps` — read-only catalog inspection.
 *
 * Subcommands:
 *   - lamina apps list  [--search t] [--limit n] [--public | --private] [--json]
 *   - lamina apps get <appId>                                              [--json]
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

const LIST_HELP = `Usage: lamina apps list [options]

List Lamina apps. Shows your workspace's apps plus public apps from other
workspaces.

Options:
  --search <text>     Filter by substring match against name and description.
  --limit <n>         Cap the number of public apps returned (default 10).
                      Workspace-owned apps are always included.
  --public            Show only public apps (from any workspace).
  --private           Show only your workspace's private apps.
  --json              Output raw JSON instead of the human-readable format.
  -h, --help          Show this help.

Examples:
  lamina apps list
  lamina apps list --search selfie --limit 5
  lamina apps list --private --json
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
      search: { type: 'string' },
      limit: { type: 'string' },
      public: { type: 'boolean' },
      private: { type: 'boolean' },
      json: { type: 'boolean' },
    },
    allowPositionals: false,
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

  let response;
  try {
    const { client } = await createClientFromAuthContext();
    response = await client.apps.list({
      search: parsed.values.search,
      limit,
    });
  } catch (err) {
    throw classifyError(err);
  }

  let apps = response.data;
  if (parsed.values.public) {
    apps = apps.filter((a) => a.isPublic);
  } else if (parsed.values.private) {
    apps = apps.filter((a) => !a.isPublic);
  }

  if (parsed.values.json || isJsonMode()) {
    printJson({ ...response, data: apps });
    return;
  }

  printAppList(apps);
  await maybePrintBootstrapHint();
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
