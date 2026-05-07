/**
 * `lamina whoami` — top-level. Matches vercel, npm, wrangler, fly.
 *
 * Reports authenticated identity along with diagnostic info: how the
 * credential was resolved (env var vs stored creds), the base URL in use,
 * and a fingerprint of the API key. `--json` for scripting.
 */
import { parseArgs } from 'node:util';

import { DEFAULT_BASE_URL, LaminaClient, normalizeBaseUrl, resolveApiKey } from '@uselamina/sdk';
import { readStoredCredentials } from '@uselamina/sdk/storage';

import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { printJson } from '../lib/output.js';

const WHOAMI_HELP = `Usage: lamina whoami [options]

Show the authenticated identity along with diagnostic info: how the
credential was resolved (env var vs stored creds), the base URL in use,
and a fingerprint of the API key.

Options:
  --json    Emit the raw status as JSON.
  --help, -h
`;

interface AuthStatus {
  loggedIn: boolean;
  source: 'env' | 'stored' | 'none';
  baseUrl: string | null;
  keyFingerprint: string | null;
  configPath: string;
  user: { email?: string | null } | null;
  workspace: {
    id?: string;
    name?: string | null;
    slug?: string | null;
    role?: string | null;
  } | null;
  otherWorkspaces: Array<{ id: string; name?: string | null; role?: string | null }>;
}

export async function handleWhoamiCommand(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    process.stdout.write(WHOAMI_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
    });
  }

  if (parsed.values.help) {
    process.stdout.write(WHOAMI_HELP);
    return;
  }

  const envKey = resolveApiKey();
  let source: AuthStatus['source'];
  let apiKey: string | null = null;
  let baseUrl: string | null = null;

  if (envKey) {
    source = 'env';
    apiKey = envKey;
    baseUrl = normalizeBaseUrl(process.env.LAMINA_BASE_URL?.trim() || DEFAULT_BASE_URL);
  } else {
    const stored = await readStoredCredentials();
    if (stored?.apiKey) {
      source = 'stored';
      apiKey = stored.apiKey;
      baseUrl = stored.baseUrl || DEFAULT_BASE_URL;
    } else {
      source = 'none';
    }
  }

  const status: AuthStatus = {
    loggedIn: false,
    source,
    baseUrl,
    keyFingerprint: apiKey ? fingerprintKey(apiKey) : null,
    configPath: '~/.lamina/config.json',
    user: null,
    workspace: null,
    otherWorkspaces: [],
  };

  if (apiKey && baseUrl) {
    try {
      const client = new LaminaClient({ apiKey, baseUrl });
      const account = (await client.account.get()).data;
      status.loggedIn = true;
      status.user = { email: account.user?.email || null };
      if (account.workspace) {
        status.workspace = {
          id: account.workspace.id,
          name: account.workspace.name || null,
          slug: account.workspace.slug || null,
          role: account.workspace.role || null,
        };
      }
      status.otherWorkspaces = (account.memberships || [])
        .filter((m) => !account.workspace || m.workspaceId !== account.workspace.id)
        .map((m) => ({ id: m.workspaceId, name: m.name || null, role: m.role || null }));
    } catch (err) {
      const cli = classifyError(err);
      if (parsed.values.json) {
        printJson({ ...status, loggedIn: false, error: cli.message });
        process.exit(EXIT.RUNTIME_ERROR);
      }
      process.stdout.write(`Logged in:    no\n`);
      process.stdout.write(`Source:       ${source}\n`);
      if (baseUrl) process.stdout.write(`Base URL:     ${baseUrl}\n`);
      if (status.keyFingerprint) {
        process.stdout.write(`Key:          ${status.keyFingerprint}\n`);
      }
      process.stdout.write(`Error:        ${cli.message}\n`);
      if (cli.suggestion) process.stdout.write(`Suggestion:   ${cli.suggestion}\n`);
      process.exit(EXIT.RUNTIME_ERROR);
    }
  }

  if (parsed.values.json) {
    printJson(status);
    return;
  }

  if (!status.loggedIn) {
    process.stdout.write(`Logged in:  no\n`);
    process.stdout.write(`Source:     ${source}\n`);
    process.stdout.write(`\nRun \`lamina login\` to authenticate.\n`);
    return;
  }

  process.stdout.write(`Logged in:    yes\n`);
  process.stdout.write(
    `Source:       ${source}${source === 'env' ? ' (LAMINA_API_KEY)' : ' (~/.lamina/config.json)'}\n`,
  );
  if (baseUrl) process.stdout.write(`Base URL:     ${baseUrl}\n`);
  if (status.keyFingerprint) {
    process.stdout.write(`Key:          ${status.keyFingerprint}\n`);
  }
  if (status.user?.email) {
    process.stdout.write(`User:         ${status.user.email}\n`);
  }
  if (status.workspace) {
    const role = status.workspace.role ? ` (${status.workspace.role})` : '';
    const name = status.workspace.name || status.workspace.id || '?';
    process.stdout.write(`Workspace:    ${name}${role}\n`);
    if (status.workspace.slug) {
      process.stdout.write(`Slug:         ${status.workspace.slug}\n`);
    }
  }
  if (status.otherWorkspaces.length > 0) {
    process.stdout.write(`\nOther workspaces (${status.otherWorkspaces.length}):\n`);
    for (const w of status.otherWorkspaces) {
      const role = w.role ? ` (${w.role})` : '';
      const name = w.name || w.id;
      process.stdout.write(`  - ${name}${role}\n`);
    }
  }
}

function fingerprintKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  const underscore = trimmed.indexOf('_');
  const prefixEnd = underscore >= 0 && underscore < 8 ? Math.min(underscore + 5, 8) : 6;
  const prefix = trimmed.slice(0, prefixEnd);
  const tail = trimmed.slice(-3);
  return `${prefix}…${tail}`;
}
