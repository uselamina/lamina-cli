/**
 * `lamina login` — authenticate the CLI with a Lamina API key.
 *
 * The key is validated against the API and saved to ~/.lamina/config.json
 * (mode 0600). After successful login, the user's identity (email, active
 * workspace) is fetched and printed so the user knows exactly which account
 * they're acting as — same convention as `vercel login`, `wrangler login`,
 * `npm login`.
 *
 * Endpoint override: set LAMINA_BASE_URL to point at a non-default origin
 * (e.g. staging). Read at login time and persisted with the saved
 * credentials. We deliberately don't expose `--base-url` as a flag, matching
 * the convention used by stripe (STRIPE_API_BASE), gh (GH_HOST), supabase.
 */
import { parseArgs } from 'node:util';

import { DEFAULT_BASE_URL, LaminaClient, normalizeBaseUrl } from '@uselamina/sdk';
import { writeStoredCredentials } from '@uselamina/sdk/storage';

import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { printIdentity } from '../lib/output.js';
import { promptApiKey } from '../lib/prompts.js';

const HELP = `Usage: lamina login [--api-key <key>]

Authenticate the CLI with a Lamina API key. The key is validated against
the API and saved to ~/.lamina/config.json (mode 0600).

Flags:
  --api-key <key>    Provide the API key non-interactively (for CI/scripts).
                     If omitted, prompts interactively with masked input.

Environment:
  LAMINA_API_KEY     If set, used directly without saving credentials. Useful
                     for one-off CI runs where you don't want a persisted
                     login on the runner.
  LAMINA_BASE_URL    Advanced: point the CLI at a non-default API origin
                     (e.g. staging). Read at login time and persisted with
                     the saved credentials. Most users should not set this.

Examples:
  lamina login                          # interactive
  lamina login --api-key lma_…          # CI / scripted

Get an API key at https://app.uselamina.ai/settings?tab=api
`;

export async function handleLoginCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const parsed = parseArgs({
    args,
    options: {
      'api-key': { type: 'string' },
    },
    allowPositionals: false,
  });

  // Hard-fail on empty --api-key — passing the flag means the caller
  // intended to provide one. Falling through to a prompt would mask a
  // scripting bug.
  const flagKey = parsed.values['api-key'];
  if (flagKey !== undefined && flagKey.trim() === '') {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--api-key was provided but is empty.',
      suggestion:
        'Pass a non-empty key, e.g. `lamina login --api-key lma_...`. Omit the flag to prompt interactively.',
    });
  }

  const apiKey = (flagKey?.trim() || (await promptApiKey())).trim();
  if (!apiKey) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'No API key supplied.',
    });
  }

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

  const client = new LaminaClient({ apiKey, baseUrl });

  // Validate by making a single read-only call. The previous version used
  // apps.list({limit:1}); now that we have /v1/account, we use it directly —
  // single round trip that both validates the key AND returns the identity
  // we want to display.
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

  process.stdout.write(`Logged in to ${baseUrl}\n`);
  printIdentity(account);
  process.stdout.write(`Saved credentials to ~/.lamina/config.json (mode 0600)\n`);
}
