import {
  DEFAULT_BASE_URL,
  LaminaClient,
  normalizeBaseUrl,
  writeStoredCredentials,
} from '@uselamina/sdk';
import { parseArgs } from 'node:util';

import { printSavedLogin } from '../lib/output.js';
import { promptApiKey } from '../lib/prompts.js';

export async function handleLoginCommand(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
    },
    allowPositionals: false,
  });

  const apiKey = parsed.values['api-key']?.trim() || (await promptApiKey());
  if (!apiKey) {
    throw new Error('A Lamina API key is required.');
  }

  const baseUrl = normalizeBaseUrl(parsed.values['base-url'] || DEFAULT_BASE_URL);
  const client = new LaminaClient({ apiKey, baseUrl });
  await client.apps.list({ limit: 1 });

  await writeStoredCredentials({
    apiKey,
    baseUrl,
    savedAt: new Date().toISOString(),
  });

  printSavedLogin(baseUrl);
}
