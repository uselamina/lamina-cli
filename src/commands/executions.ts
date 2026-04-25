import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { printExecution, printJson } from '../lib/output.js';

export async function handleExecutionsCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const executionId = args[1];

  if (!executionId) {
    throw new Error('Missing executionId.');
  }

  const parsed = parseArgs({
    args: args.slice(2),
    options: {
      json: { type: 'boolean' },
      'interval-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
    },
    allowPositionals: false,
  });

  const { client } = await createClientFromAuthContext({
    apiKey: parsed.values['api-key'],
    baseUrl: parsed.values['base-url'],
  });

  if (subcommand === 'get') {
    const response = await client.runs.get(executionId);
    if (parsed.values.json) {
      printJson(response);
    } else {
      printExecution(response.data);
    }
    return;
  }

  if (subcommand === 'wait') {
    const response = await client.runs.wait(executionId, {
      intervalMs: parsed.values['interval-ms']
        ? Number.parseInt(parsed.values['interval-ms'], 10)
        : undefined,
      timeoutMs: parsed.values['timeout-ms']
        ? Number.parseInt(parsed.values['timeout-ms'], 10)
        : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printExecution(response.data);
    }
    return;
  }

  throw new Error('Unknown runs command. Use `lamina runs get` or `wait`.');
}
