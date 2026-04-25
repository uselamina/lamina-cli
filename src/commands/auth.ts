import { clearStoredCredentials, readStoredCredentials, resolveApiKey } from '@uselamina/sdk';

import { printAuthStatus } from '../lib/output.js';

export async function handleAuthCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'status') {
    const envKey = resolveApiKey();
    if (envKey) {
      printAuthStatus({
        source: 'env',
        baseUrl: process.env.LAMINA_BASE_URL || 'https://app.uselamina.ai',
        keyPreview: `${envKey.slice(0, 8)}…`,
      });
      return;
    }

    const stored = await readStoredCredentials();
    if (!stored) {
      process.stdout.write('Not authenticated. Run `lamina login`.\n');
      return;
    }

    printAuthStatus({
      source: 'stored',
      baseUrl: stored.baseUrl,
      keyPreview: `${stored.apiKey.slice(0, 8)}…`,
    });
    return;
  }

  if (subcommand === 'clear') {
    await clearStoredCredentials();
    process.stdout.write('Cleared stored Lamina credentials\n');
    return;
  }

  throw new Error('Unknown auth command. Use `lamina auth status` or `lamina auth clear`.');
}
