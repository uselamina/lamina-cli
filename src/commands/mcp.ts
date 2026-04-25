import { parseArgs } from 'node:util';

import { startMcpServer } from '@uselamina/mcp';

export async function handleMcpCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand !== 'serve') {
    throw new Error('Unknown mcp command. Use `lamina mcp serve`.');
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
    },
    allowPositionals: false,
  });

  await startMcpServer({
    apiKey: parsed.values['api-key'],
    baseUrl: parsed.values['base-url'],
  });
}
