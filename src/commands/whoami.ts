/**
 * `lamina whoami` — print the active identity.
 *
 * Always makes a fresh `GET /v1/account` call so a revoked or expired key
 * fails immediately with a clear error. Goes through
 * `createClientFromAuthContext`, so OAuth access tokens auto-refresh
 * preemptively if they're about to expire — same convention as `vercel
 * whoami`, `npm whoami`, `wrangler whoami`, `gh api user`.
 */
import { classifyError } from '../lib/errors.js';
import { createClientFromAuthContext } from '../lib/config.js';
import { printIdentity } from '../lib/output.js';

const HELP = `Usage: lamina whoami

Print the user, workspace, and other workspace memberships for the
active credential. Resolves the credential in this order:
  1. LAMINA_API_KEY environment variable
  2. ~/.lamina/config.json (saved by \`lamina login\`)

Always makes a fresh API call — a revoked or expired credential fails
with a clear error. OAuth access tokens are auto-refreshed in the
background; if the refresh token is also expired, you'll be prompted
to re-run \`lamina login\`.
`;

export async function handleWhoamiCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();
  try {
    const response = await client.account.get();
    printIdentity(response.data);
  } catch (err) {
    throw classifyError(err);
  }
}
