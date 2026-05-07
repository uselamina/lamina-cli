/**
 * `lamina auth` — group dispatcher for authentication.
 *
 * Mirrors the convention popularised by `gh auth ...` and adopted by
 * `gcloud auth ...`, `aws sso ...`. Subcommands:
 *
 *   lamina auth login [--api-key K]   Browser-mediated, with --api-key fallback
 *   lamina auth logout                Clear stored credentials
 *   lamina auth status                Identity + auth source + base URL + key fingerprint
 *
 * Top-level `lamina login` / `lamina logout` / `lamina whoami` remain as
 * hidden aliases so users who learned them from earlier releases (or from
 * muscle memory carried over from `vercel login` / `stripe login`) keep
 * working.
 */
import { parseArgs } from 'node:util';

import { DEFAULT_BASE_URL, LaminaClient, normalizeBaseUrl, resolveApiKey } from '@uselamina/sdk';
import {
  clearStoredCredentials,
  readStoredCredentials,
  writeStoredCredentials,
} from '@uselamina/sdk/storage';

import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { openBrowser } from '../lib/openBrowser.js';
import { printIdentity, printJson } from '../lib/output.js';
import { promptApiKey } from '../lib/prompts.js';

const GROUP_HELP = `Usage: lamina auth <subcommand>

Manage CLI authentication.

Subcommands:
  login    Authenticate the CLI (opens a browser by default; --api-key for CI).
  logout   Clear stored credentials.
  status   Show authenticated identity + how the key was resolved.

Run \`lamina auth <subcommand> --help\` for subcommand options.
`;

const LOGIN_HELP = `Usage: lamina auth login [options]

Authenticate the CLI with a Lamina API key. By default, opens your browser
to the API-key page on app.uselamina.ai so you can copy a key without
hunting through the dashboard. Then prompts for the key with masked input
and validates it against the API before saving.

For CI / scripted environments, pass \`--api-key\` to skip the browser.

Options:
  --api-key <key>     Provide the API key non-interactively. Skips the
                      browser open and the prompt.
  --no-browser        Skip browser auto-open even in interactive mode.
                      Useful in SSH / containers / restricted networks.
  --help, -h          Show this help.

Environment:
  LAMINA_API_KEY      If set in the shell, used directly without saving
                      credentials. Useful for one-off CI runs where you
                      don't want a persisted login on the runner.
  LAMINA_BASE_URL     Point the CLI at a non-default origin (e.g. staging).
                      Read at login time and persisted with the saved
                      credentials. Most users should not set this.

Examples:
  lamina auth login                          # interactive (browser opens)
  lamina auth login --api-key lma_…          # CI / scripted
  lamina auth login --no-browser             # interactive without auto-open

Get an API key at https://app.uselamina.ai/settings?tab=api
`;

const LOGOUT_HELP = `Usage: lamina auth logout

Clear stored credentials at ~/.lamina/config.json. Does NOT clear the
LAMINA_API_KEY environment variable, and does NOT revoke the key on the
server — you can keep using the same key by re-running \`lamina auth login\`.
`;

const STATUS_HELP = `Usage: lamina auth status [options]

Show the authenticated identity along with diagnostic info: how the
credential was resolved (env var vs stored creds), the base URL in use,
and a fingerprint of the API key.

Options:
  --json    Emit the raw status as JSON.
  --help, -h
`;

export async function handleAuthCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    process.stdout.write(GROUP_HELP);
    if (!subcommand) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: 'Missing subcommand.',
      });
    }
    return;
  }

  if (subcommand === 'login') {
    return handleAuthLogin(args.slice(1));
  }
  if (subcommand === 'logout') {
    return handleAuthLogout(args.slice(1));
  }
  if (subcommand === 'status') {
    return handleAuthStatus(args.slice(1));
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina auth ${subcommand}".`,
    suggestion: 'Run `lamina auth --help` for valid subcommands.',
  });
}

// ─── login ──────────────────────────────────────────────────────────────────

const API_KEY_PAGE = 'https://app.uselamina.ai/settings?tab=api';

export async function handleAuthLogin(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(LOGIN_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        'api-key': { type: 'string' },
        'no-browser': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina auth login --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(LOGIN_HELP);
    return;
  }

  // Hard-fail on empty --api-key — passing the flag means the caller intended
  // to provide one. Falling through to a prompt would mask a scripting bug.
  const flagKey = parsed.values['api-key'];
  if (flagKey !== undefined && flagKey.trim() === '') {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--api-key was provided but is empty.',
      suggestion:
        'Pass a non-empty key, e.g. `lamina auth login --api-key lma_...`. Omit the flag to prompt interactively.',
    });
  }

  let apiKey: string;

  if (flagKey?.trim()) {
    // Non-interactive path — straight to the key.
    apiKey = flagKey.trim();
  } else {
    // Interactive path — open browser to the API-key page (unless suppressed),
    // then prompt for paste with masked input.
    const skipBrowser = Boolean(parsed.values['no-browser']);
    if (!skipBrowser) {
      process.stdout.write(`Opening ${API_KEY_PAGE} in your browser...\n`);
      const result = await openBrowser(API_KEY_PAGE);
      if (!result.launched) {
        process.stdout.write(
          `(Couldn't open the browser automatically — visit ${API_KEY_PAGE} to generate a key.)\n`,
        );
      }
    } else {
      process.stdout.write(`Visit ${API_KEY_PAGE} to generate an API key.\n`);
    }

    const prompted = (await promptApiKey()).trim();
    if (!prompted) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: 'No API key supplied.',
      });
    }
    apiKey = prompted;
  }

  // Resolve baseUrl honestly — env var wins, default otherwise.
  const envBase = process.env.LAMINA_BASE_URL?.trim();
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(envBase || DEFAULT_BASE_URL);
    new URL(baseUrl);
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `Invalid LAMINA_BASE_URL: ${envBase}`,
      suggestion: 'Pass a full URL, e.g. https://app.uselamina.ai.',
      cause: err,
    });
  }

  // Validate the key + fetch identity in a single call to /v1/account.
  const client = new LaminaClient({ apiKey, baseUrl });
  let account;
  try {
    const response = await client.account.get();
    account = response.data;
  } catch (err) {
    throw classifyError(err);
  }

  await writeStoredCredentials({
    apiKey,
    baseUrl,
    savedAt: new Date().toISOString(),
  });

  process.stdout.write(`\n✓ Logged in to ${baseUrl}\n`);
  printIdentity(account);
  process.stdout.write(`\nSaved credentials to ~/.lamina/config.json (mode 0600)\n`);
}

// ─── logout ────────────────────────────────────────────────────────────────

export async function handleAuthLogout(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(LOGOUT_HELP);
    return;
  }

  await clearStoredCredentials();
  process.stdout.write('Cleared stored credentials at ~/.lamina/config.json\n');
}

// ─── status ────────────────────────────────────────────────────────────────

interface AuthStatus {
  loggedIn: boolean;
  source: 'env' | 'stored' | 'none';
  baseUrl: string | null;
  keyFingerprint: string | null;
  configPath: string;
  user: {
    email?: string | null;
  } | null;
  workspace: {
    id?: string;
    name?: string | null;
    slug?: string | null;
    role?: string | null;
  } | null;
  otherWorkspaces: Array<{ id: string; name?: string | null; role?: string | null }>;
}

export async function handleAuthStatus(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(STATUS_HELP);
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
    process.stdout.write(STATUS_HELP);
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
      // Auth resolved but server rejected — surface that.
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
    process.stdout.write(`\nRun \`lamina auth login\` to authenticate.\n`);
    return;
  }

  process.stdout.write(`Logged in:    yes\n`);
  process.stdout.write(`Source:       ${source}${source === 'env' ? ' (LAMINA_API_KEY)' : ' (~/.lamina/config.json)'}\n`);
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

/**
 * Show only enough of the key to identify it without leaking it. Format:
 *   <prefix>...<last 4>
 * For lma_xxxx keys this is e.g. `lma_6sZ2…lYg` — recognizable to the user
 * who created it but useless to anyone else.
 */
function fingerprintKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed;
  // Preserve any prefix up to and including the first underscore (lma_, mcp_, etc.).
  const underscore = trimmed.indexOf('_');
  const prefixEnd = underscore >= 0 && underscore < 8 ? Math.min(underscore + 5, 8) : 6;
  const prefix = trimmed.slice(0, prefixEnd);
  const tail = trimmed.slice(-3);
  return `${prefix}…${tail}`;
}
