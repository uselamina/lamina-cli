/**
 * `lamina whoami` — print the active identity.
 *
 * Always makes a fresh `GET /v1/account` call so a revoked or expired key
 * fails immediately with a clear error. Goes through
 * `createClientFromAuthContext`, so OAuth access tokens auto-refresh
 * preemptively if they're about to expire — same convention as `vercel
 * whoami`, `npm whoami`, `wrangler whoami`, `gh api user`.
 *
 * Output:
 * - Default (no flag): human-readable multi-line identity block.
 * - `--json`: structured envelope `{ data: AccountResponse }` to stdout.
 *   Errors (not logged in, network down, revoked token) flow through
 *   `printCliError()` which respects JSON mode.
 */
import { classifyError } from '../lib/errors.js';
import { createClientFromAuthContext } from '../lib/config.js';
import { detectJsonModeFromArgs, isJsonMode } from '../lib/outputMode.js';
import { printIdentity, printJson } from '../lib/output.js';

const HELP = `Usage: lamina whoami [--json]

Print the user, workspace, and other workspace memberships for the
active credential. Resolves the credential in this order:
  1. LAMINA_API_KEY environment variable
  2. ~/.lamina/config.json (saved by \`lamina login\`)

Always makes a fresh API call — a revoked or expired credential fails
with a clear error. OAuth access tokens are auto-refreshed in the
background; if the refresh token is also expired, you'll be prompted
to re-run \`lamina login\`.

Options:
  --json    Emit identity as a structured JSON envelope (for agents).
  --help, -h
`;

export async function handleWhoamiCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  detectJsonModeFromArgs(args);

  const { client } = await createClientFromAuthContext();
  try {
    const response = await client.account.get();
    if (isJsonMode()) {
      printJson({ data: response.data });
    } else {
      printIdentity(response.data);
    }
  } catch (err) {
    throw classifyError(err);
  }
}
