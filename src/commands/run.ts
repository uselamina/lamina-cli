import { parseArgs } from 'node:util';

import { createClientFromAuthContext, resolveStoredWebhookUrl } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  loadInputsFromFile,
  parseInlineInputs,
  validateInputsAgainstSchema,
} from '../lib/inputParser.js';
import { printExecution, printJson, printRunStarted } from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const HELP = `Usage: lamina run <appId> [options]

Start a Lamina app run. Get app IDs from \`lamina apps list\`.

Inputs:
  --input <key=value>      Set one input. Repeatable. Use the snake_case
                           \`key\` from \`lamina apps get <appId>\`.
  --file <path.json>       Load inputs from a JSON file. Either
                           { "key": "value", ... } or { "inputs": { ... } }.

Wait & poll:
  --wait                   Block until the run reaches a terminal state.
  --async                  Explicit non-blocking mode (the default); returns
                           the runId immediately. Follow with
                           \`lamina runs wait <runId>\` or attach a webhook.
                           Mutually exclusive with --wait.
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
        async: { type: 'boolean' },
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
    // Schema-introspection: `lamina run <appId> --help` augments the
    // generic help with that app's actual parameters. Best-effort — if
    // we're not logged in or the app doesn't exist, we silently skip.
    await tryPrintAppParameters(appId);
    return;
  }

  // --wait and --async are mutually exclusive. Both default to false; if
  // both are passed we error rather than silently picking one.
  if (parsed.values.wait && parsed.values.async) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--wait and --async cannot be used together.',
      suggestion: 'Pick one: --wait blocks until done; --async returns immediately.',
    });
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
    if (parsed.values.json || isJsonMode()) {
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

  if (parsed.values.json || isJsonMode()) {
    printJson(completed);
  } else {
    printExecution(completed.data, { appName: started.data.workflowName });
  }
}

/**
 * Append per-app parameter info to `--help` output when an appId is given.
 * Matches the design pattern fal's genmedia uses: `genmedia run <id> --help`
 * shows that endpoint's actual flags. We don't dynamically generate flags
 * (Lamina apps use --input key=value form), but we DO surface the parameter
 * contract so the agent doesn't have to make a separate `apps get` call.
 *
 * Best-effort. Silently skips on auth missing / 404 / network failure —
 * the user/agent already saw the generic help, we're just adding context.
 */
async function tryPrintAppParameters(appId: string): Promise<void> {
  try {
    const { client } = await createClientFromAuthContext();
    const response = await client.apps.get(appId);
    const app = response.data;
    process.stdout.write(`\nInputs for "${app.name}" (${app.appId}):\n`);
    if (!app.parameters || app.parameters.length === 0) {
      process.stdout.write('  (no inputs defined)\n');
      return;
    }
    for (const p of app.parameters) {
      const ident = p.key || p.name || p.id;
      const hasDefault =
        p.default !== undefined && p.default !== null && p.default !== '';
      const required = !hasDefault ? '  (required)' : '';
      let typeStr: string = p.type;
      if (p.type === 'url' && p.accept?.length) {
        typeStr = `url (${p.accept.join(', ')}${p.multiple ? ', multiple' : ''})`;
      }
      process.stdout.write(`  --input ${ident}=<${typeStr}>${required}\n`);
      if (p.type === 'options' && p.options?.length) {
        process.stdout.write(`    options: ${p.options.join(', ')}\n`);
      }
      if (hasDefault) {
        const def =
          typeof p.default === 'string' && p.default.length > 60
            ? `${p.default.slice(0, 57)}...`
            : String(p.default);
        process.stdout.write(`    default: ${def}\n`);
      }
    }
    process.stdout.write(
      `\nFor full parameter details, run: lamina apps get ${appId}\n`,
    );
  } catch {
    // Best-effort. Generic help already printed; nothing else to surface.
  }
}
