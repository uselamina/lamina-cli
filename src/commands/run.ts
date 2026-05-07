import { parseArgs } from 'node:util';

import { createClientFromAuthContext, resolveStoredWebhookUrl } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  loadInputsFromFile,
  parseInlineInputs,
  validateInputsAgainstSchema,
} from '../lib/inputParser.js';
import { printExecution, printJson, printRunStarted } from '../lib/output.js';

const HELP = `Usage: lamina run <appId> [options]

Start a Lamina app run. Get app IDs from \`lamina apps list\`.

Inputs:
  --input <key=value>      Set one input. Repeatable. Use the snake_case
                           \`key\` from \`lamina apps get <appId>\`.
  --file <path.json>       Load inputs from a JSON file. Either
                           { "key": "value", ... } or { "inputs": { ... } }.

Wait & poll:
  --wait                   Block until the run reaches a terminal state.
  --timeout-ms <ms>        Max wait time, default 240000 (with --wait).
  --interval-ms <ms>       Poll interval, default 2000 (with --wait).

Webhook:
  --webhook <url>          Send completion event to <url>.
  --webhook default        Use the saved default URL.
  --webhook local          Same as default; intended for local-tunnel setups.

Output:
  --json                   Emit the raw API envelope.
  --help, -h               Show this help.

Examples:
  lamina run e0124407-d57a-4f76-ac5a-be0041e55a24
  lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 --input celebrity_text="Brad Pitt"
  lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 --file inputs.json --wait

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials. Override the
endpoint with LAMINA_BASE_URL (defaults to https://app.uselamina.ai).
`;

export async function handleRunCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP);
    if (args.length === 0) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: 'Missing <appId>.',
        suggestion: 'Run `lamina apps list` to see available app IDs.',
      });
    }
    return;
  }

  const appId = args[0];

  let parsed;
  try {
    parsed = parseArgs({
      args: args.slice(1),
      options: {
        file: { type: 'string' },
        input: { type: 'string', multiple: true },
        wait: { type: 'boolean' },
        webhook: { type: 'string' },
        json: { type: 'boolean' },
        'interval-ms': { type: 'string' },
        'timeout-ms': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina run --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(HELP);
    return;
  }

  const fileInputs = parsed.values.file ? await loadInputsFromFile(parsed.values.file) : {};
  const inlineInputs = parseInlineInputs(parsed.values.input || []);
  const inputs = { ...fileInputs, ...inlineInputs };

  const rawWebhook = parsed.values.webhook?.trim();
  const webhook =
    rawWebhook === 'local' || rawWebhook === 'default'
      ? (await resolveStoredWebhookUrl(rawWebhook)).webhookUrl
      : rawWebhook;

  const { client } = await createClientFromAuthContext();

  const app = await client.apps.get(appId);
  validateInputsAgainstSchema(inputs, app.data.parameters);

  const started = await client.runs.run(appId, { inputs, webhook });

  if (!parsed.values.wait) {
    if (parsed.values.json) {
      printJson(started);
    } else {
      printRunStarted(started.data);
    }
    return;
  }

  const completed = await client.runs.wait(started.data.runId, {
    intervalMs: parsed.values['interval-ms']
      ? Number.parseInt(parsed.values['interval-ms'], 10)
      : 2000,
    timeoutMs: parsed.values['timeout-ms']
      ? Number.parseInt(parsed.values['timeout-ms'], 10)
      : 240000,
  });

  if (parsed.values.json) {
    printJson(completed);
  } else {
    printExecution(completed.data, { appName: started.data.workflowName });
  }
}
