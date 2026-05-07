/**
 * `lamina logout` — remove the stored credentials.
 *
 * Idempotent. Doesn't clear LAMINA_API_KEY env var (that's not ours to
 * manage). Same convention as `vercel logout`, `npm logout`, `wrangler
 * logout`.
 */
import { resolveApiKey } from '@uselamina/sdk';
import { clearStoredCredentials, readStoredCredentials } from '@uselamina/sdk/storage';

const HELP = `Usage: lamina logout

Remove the stored credentials at ~/.lamina/config.json. Does NOT clear
the LAMINA_API_KEY environment variable. Idempotent — safe to run when
no credentials are stored.
`;

export async function handleLogoutCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const stored = await readStoredCredentials();
  await clearStoredCredentials();

  if (stored) {
    process.stdout.write('Removed stored credentials at ~/.lamina/config.json.\n');
  } else {
    process.stdout.write('Already logged out (no stored credentials).\n');
  }

  if (resolveApiKey()) {
    process.stdout.write(
      'Note: LAMINA_API_KEY is still set in your environment; unset it to fully log out.\n'
    );
  }
}
