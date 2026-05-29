/**
 * `lamina login` — authenticate the CLI.
 *
 * Two paths, mirroring the convention used by `gh auth login`,
 * `supabase login`, `vercel login`, `firebase login`:
 *
 *   • **OAuth (default)** — Authorization Code + PKCE with a loopback
 *     redirect. CLI opens the browser, user picks a workspace + approves
 *     in Lamina's web UI, callback returns the auth code, CLI exchanges
 *     it for an access token + refresh token. No copy/paste of secrets.
 *
 *   • **`--api-key <key>`** — Non-interactive: validates the key and saves
 *     it. The standard CI / scripted path.
 *
 * Either way, credentials are saved to `~/.lamina/config.json` (mode 0600).
 * The OAuth-specific fields (`refreshToken`, `expiresAt`, `clientId`,
 * `kind: 'oauth'`) are recorded so a future release can refresh on expiry
 * without re-prompting the user.
 *
 * Endpoint override: set `LAMINA_BASE_URL` to point at a non-default origin
 * (e.g. staging or local-dev). Read at login time and persisted alongside
 * the credentials so subsequent commands hit the same origin.
 */
import { parseArgs } from 'node:util';

import { DEFAULT_BASE_URL, LaminaClient, normalizeBaseUrl } from '@uselamina/sdk';
import { writeStoredCredentials } from '@uselamina/sdk/storage';

import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { runOAuthFlow } from '../lib/oauthFlow.js';
import { printIdentity } from '../lib/output.js';

const HELP = `Usage: lamina login [options]

Authenticate the CLI with your Lamina account. By default, opens your
browser for an OAuth approval flow (the same flow used by gh, supabase,
vercel). For CI / scripts, pass an API key non-interactively with
\`--api-key\`.

Options:
  --api-key <key>     Non-interactive: skip the browser flow and use a
                      workspace API key directly.
  --no-browser        Print the authorization URL instead of auto-opening
                      the browser. Useful in SSH / containers.
  --help, -h          Show this help.

Environment:
  LAMINA_API_KEY      If set, used directly without saving credentials.
                      Useful for one-off CI runs where you don't want a
                      persisted login on the runner.

Examples:
  lamina login                          # interactive OAuth (default)
  lamina login --api-key lma_…          # CI / scripted
  lamina login --no-browser             # print URL instead of auto-opening

Get an API key at https://app.uselamina.ai/settings?tab=api
`;

interface ParsedFlags {
  apiKey: string | undefined;
  noBrowser: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
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
      suggestion: 'Run `lamina login --help` for usage.',
    });
  }
  return {
    apiKey: parsed.values['api-key'],
    noBrowser: Boolean(parsed.values['no-browser']),
  };
}

function resolveBaseUrl(): string {
  const envBase = process.env.LAMINA_BASE_URL?.trim();
  try {
    const baseUrl = normalizeBaseUrl(envBase || DEFAULT_BASE_URL);
    new URL(baseUrl);
    return baseUrl;
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `Invalid LAMINA_BASE_URL: ${envBase}`,
      suggestion: 'Pass a full URL, e.g. https://app.uselamina.ai.',
      cause: err,
    });
  }
}

async function fetchIdentityAndPersist({
  apiKey,
  baseUrl,
  oauth,
}: {
  apiKey: string;
  baseUrl: string;
  oauth?: { refreshToken: string; expiresAt: string; clientId: string; scope: string };
}) {
  const client = new LaminaClient({ apiKey, baseUrl });

  // Single round trip that validates the credential AND fetches identity.
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
    ...(oauth
      ? {
          kind: 'oauth' as const,
          refreshToken: oauth.refreshToken,
          expiresAt: oauth.expiresAt,
          clientId: oauth.clientId,
          scope: oauth.scope,
        }
      : { kind: 'apikey' as const }),
  });

  return account;
}

export async function handleLoginCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const flags = parseFlags(args);

  // Reject empty --api-key — passing the flag means the caller intended a
  // value; falling through to the OAuth flow would mask scripting bugs.
  if (flags.apiKey !== undefined && flags.apiKey.trim() === '') {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--api-key was provided but is empty.',
      suggestion:
        'Pass a non-empty key, e.g. `lamina login --api-key lma_…`. Omit the flag for the interactive OAuth flow.',
    });
  }

  const baseUrl = resolveBaseUrl();

  // Non-interactive: --api-key short-circuits the OAuth flow.
  if (flags.apiKey?.trim()) {
    const account = await fetchIdentityAndPersist({
      apiKey: flags.apiKey.trim(),
      baseUrl,
    });
    process.stdout.write(`\n✓ Logged in to ${baseUrl}\n`);
    printIdentity(account);
    process.stdout.write(`\nSaved credentials to ~/.lamina/config.json (mode 0600)\n`);
    return;
  }

  // Default: OAuth Authorization Code + PKCE with loopback redirect.
  const tokens = await runOAuthFlow({
    baseUrl,
    noBrowser: flags.noBrowser,
  });

  const account = await fetchIdentityAndPersist({
    apiKey: tokens.accessToken,
    baseUrl: tokens.baseUrl,
    oauth: {
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      clientId: tokens.clientId,
      scope: tokens.scope,
    },
  });

  process.stdout.write(`\n✓ Logged in to ${tokens.baseUrl}\n`);
  printIdentity(account);
  process.stdout.write(`\nSaved credentials to ~/.lamina/config.json (mode 0600)\n`);
}
