/**
 * `lamina whoami` — print the active identity.
 *
 * Always makes a fresh `GET /v1/account` call so a revoked or expired key
 * fails immediately with a clear error. Same convention as `vercel
 * whoami`, `npm whoami`, `wrangler whoami`, `gh api user`.
 */
import { DEFAULT_BASE_URL, LaminaClient, normalizeBaseUrl, resolveApiKey } from '@uselamina/sdk';
import { readStoredCredentials } from '@uselamina/sdk/storage';

import { classifyError, EXIT, LaminaCliError } from '../lib/errors.js';
import { printIdentity } from '../lib/output.js';

const HELP = `Usage: lamina whoami

Print the user, workspace, and other workspace memberships for the active
API key. Resolves the key in this order:
  1. LAMINA_API_KEY environment variable
  2. ~/.lamina/config.json (saved by \`lamina login\`)

Always makes a fresh API call — a revoked or expired key fails with a
clear error.
`;

export async function handleWhoamiCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  // Resolve credentials. Order: env > stored. We don't reuse
  // LaminaClient.fromEnv because we want a clear error path when neither
  // source is configured.
  const envKey = resolveApiKey();
  let apiKey: string | undefined;
  let baseUrl: string;

  if (envKey) {
    apiKey = envKey;
    baseUrl = normalizeBaseUrl(process.env.LAMINA_BASE_URL?.trim() || DEFAULT_BASE_URL);
  } else {
    const stored = await readStoredCredentials();
    if (!stored?.apiKey) {
      throw new LaminaCliError({
        code: 'auth_not_logged_in',
        exitCode: EXIT.RUNTIME_ERROR,
        message: 'Not logged in.',
        suggestion: 'Run `lamina login` to authenticate, or set LAMINA_API_KEY.',
      });
    }
    apiKey = stored.apiKey;
    baseUrl = stored.baseUrl || DEFAULT_BASE_URL;
  }

  const client = new LaminaClient({ apiKey, baseUrl });

  try {
    const response = await client.account.get();
    printIdentity(response.data);
  } catch (err) {
    throw classifyError(err);
  }
}
