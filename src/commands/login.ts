/**
 * `lamina login` — top-level authentication command.
 *
 * Matches the convention used by supabase, vercel, stripe, npm, firebase,
 * netlify, wrangler, railway, heroku — top-level `<tool> login`.
 *
 * Defaults to opening a browser to the API-key page so a user can copy a
 * key without hunting through the dashboard, then prompts for the key with
 * masked input and validates it against the API before saving.
 *
 * For CI / scripted environments, `--api-key` skips the browser entirely.
 */
import { parseArgs } from 'node:util';

import { DEFAULT_BASE_URL, LaminaClient, normalizeBaseUrl } from '@uselamina/sdk';
import { writeStoredCredentials } from '@uselamina/sdk/storage';

import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { openBrowser } from '../lib/openBrowser.js';
import { printIdentity } from '../lib/output.js';
import { promptApiKey } from '../lib/prompts.js';

const API_KEY_PAGE = 'https://app.uselamina.ai/settings?tab=api';

const LOGIN_HELP = `Usage: lamina login [options]

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
  lamina login                          # interactive (browser opens)
  lamina login --api-key lma_…          # CI / scripted
  lamina login --no-browser             # interactive without auto-open

Get an API key at https://app.uselamina.ai/settings?tab=api
`;

export async function handleLoginCommand(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
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
      suggestion: 'Run `lamina login --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(LOGIN_HELP);
    return;
  }

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

  let apiKey: string;

  if (flagKey?.trim()) {
    apiKey = flagKey.trim();
  } else {
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
