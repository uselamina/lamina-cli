import { parseArgs } from 'node:util';

import { createClientFromAuthContext, resolveStoredWebhookUrl } from '../lib/config.js';
import {
  loadInputsFromFile,
  parseInlineInputs,
  validateInputsAgainstSchema,
} from '../lib/inputParser.js';
import { printExecution, printJson } from '../lib/output.js';

export async function handleRunCommand(args: string[]): Promise<void> {
  const appId = args[0];
  if (!appId) {
    throw new Error('Missing appId. Use `lamina run <appId>`.');
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      file: { type: 'string' },
      input: { type: 'string', multiple: true },
      wait: { type: 'boolean' },
      webhook: { type: 'string' },
      json: { type: 'boolean' },
      'interval-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
    },
    allowPositionals: false,
  });

  const fileInputs = parsed.values.file ? await loadInputsFromFile(parsed.values.file) : {};
  const inlineInputs = parseInlineInputs(parsed.values.input || []);
  const inputs = { ...fileInputs, ...inlineInputs };
  const rawWebhook = parsed.values.webhook?.trim();
  const webhook =
    rawWebhook === 'local' || rawWebhook === 'default'
      ? (await resolveStoredWebhookUrl(rawWebhook)).webhookUrl
      : rawWebhook;

  const { client } = await createClientFromAuthContext({
    apiKey: parsed.values['api-key'],
    baseUrl: parsed.values['base-url'],
  });

  const app = await client.apps.get(appId);
  validateInputsAgainstSchema(inputs, app.data.parameters);

  const started = await client.runs.run(appId, {
    inputs,
    webhook,
  });

  if (!parsed.values.wait) {
    if (parsed.values.json) {
      printJson(started);
    } else {
      process.stdout.write(`Started run ${started.data.runId}\n`);
    }
    return;
  }

  const completed = await client.runs.wait(started.data.runId, {
    intervalMs: parsed.values['interval-ms']
      ? Number.parseInt(parsed.values['interval-ms'], 10)
      : undefined,
    timeoutMs: parsed.values['timeout-ms']
      ? Number.parseInt(parsed.values['timeout-ms'], 10)
      : undefined,
  });

  if (parsed.values.json) {
    printJson(completed);
  } else {
    printExecution(completed.data);
  }
}
