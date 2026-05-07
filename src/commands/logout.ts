/**
 * `lamina logout` — top-level. Mirrors supabase, vercel, stripe, npm.
 *
 * Clears stored credentials at ~/.lamina/config.json. Does NOT touch the
 * LAMINA_API_KEY environment variable, and does NOT revoke the key on the
 * server — re-running `lamina login` with the same key still works.
 */
import { clearStoredCredentials } from '@uselamina/sdk/storage';

const LOGOUT_HELP = `Usage: lamina logout

Clear stored credentials at ~/.lamina/config.json. Does NOT clear the
LAMINA_API_KEY environment variable, and does NOT revoke the key on the
server — you can keep using the same key by re-running \`lamina login\`.
`;

export async function handleLogoutCommand(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    process.stdout.write(LOGOUT_HELP);
    return;
  }
  await clearStoredCredentials();
  process.stdout.write('Cleared stored credentials at ~/.lamina/config.json\n');
}
