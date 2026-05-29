import { parseArgs } from 'node:util';

import { createClientFromAuthContext, resolveWebhookForDispatch } from '../lib/config.js';
import { downloadOutputs, type DownloadedFile, type RunOutput } from '../lib/downloadOutputs.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  loadInputsFromFile,
  parseInlineInputs,
  validateInputsAgainstSchema,
} from '../lib/inputParser.js';
import { printExecution, printJson, printRunStarted } from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const HELP = `Usage:
  lamina run <appId> [options]              # dispatch a catalog app

Dispatch a Lamina catalog App.

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
  --webhook <url>          Send completion event to <url> (overrides any
                           saved default for this call).
  --webhook default        Use the saved default URL. Same as omitting the
                           flag when a default is saved — kept for scripts
                           that want to be explicit.
  --no-webhook             Suppress webhook delivery for this call, even if
                           a default is saved.
                           (alias: --webhook none)

  When NO webhook flag is passed AND a default URL has been saved via
  \`lamina webhook listen --public-url <url> --save-default\`, the stored URL
  is used automatically. Inspect with \`lamina webhook status\`; clear with
  \`lamina webhook clear\`.

Output selection:
  --output <label>         Run only the named output(s) instead of the full
                           app workflow. Pass the label string from
                           \`lamina apps get <appId>\`'s \`outputs[]\` array
                           (case-insensitive). Repeatable for multiple
                           outputs. Omitted → all of the app's outputs run.
                           Example: --output "Front View" --output "Lifestyle View"
                           Saves credits + time by skipping unrelated nodes.

Output:
  --json                   Emit the raw API envelope.
  --download <path>        Save terminal-completed outputs to disk at the
                           given path. Requires --wait. The CLI handles
                           single-vs-multi-output and folder-vs-file
                           automatically:
                             ./public/hero.png   → literal file for 1
                                                   output; auto-suffixed
                                                   ./public/hero_0.png,
                                                   _1.png, … for N outputs
                             ./public/           → folder; files land
                                                   inside as label_0.png,
                                                   label_1.png, …
                             ./out/{runId}_{index}.{ext}
                                                 → advanced template form,
                                                   used verbatim
                           Parent directories are auto-created. In JSON
                           mode each downloaded file appears under
                           \`data.downloads[]\` alongside \`data.outputs[]\`.
  --help, -h               Show this help.

Examples:
  lamina run b149d8c8-dff7-4a92-b828-b84b0e18b50d
  lamina run b149d8c8-... --input product_image_url=https://media.../mug.jpg
  lamina run b149d8c8-... --file inputs.json --wait
  lamina run 19fdcc86-... --input front_image_url=https://... \\
    --output "Front View" --output "Lifestyle View" --wait

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials.
`;

export async function handleRunCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP);
    if (args.length === 0) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: 'Missing <appId>.',
        suggestion: 'Pass <appId> (see `lamina apps list`).',
      });
    }
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        file: { type: 'string' },
        input: { type: 'string', multiple: true },
        wait: { type: 'boolean' },
        async: { type: 'boolean' },
        webhook: { type: 'string' },
        'no-webhook': { type: 'boolean' },
        output: { type: 'string', multiple: true },
        download: { type: 'string' },
        json: { type: 'boolean' },
        'interval-ms': { type: 'string' },
        'timeout-ms': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina run --help` for usage.',
    });
  }

  const positionalAppId = parsed.positionals[0];

  if (!positionalAppId) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <appId>.',
      suggestion: 'Pass an appId (see `lamina apps list`). Run `lamina run --help` for usage.',
    });
  }

  // --wait and --async are mutually exclusive
  if (parsed.values.wait && parsed.values.async) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--wait and --async cannot be used together.',
      suggestion: 'Pick one: --wait blocks until done; --async returns immediately.',
    });
  }

  // --download requires --wait. There's nothing to write to disk until the
  // run reaches a terminal state; for async dispatches use
  // `lamina runs wait <runId> --download <template>` after the fact.
  if (parsed.values.download && !parsed.values.wait) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--download requires --wait.',
      suggestion:
        'Either add --wait inline, or dispatch with --async and run\n' +
        '`lamina runs wait <runId> --download <template>` once it completes.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(HELP);
    if (positionalAppId) await tryPrintAppParameters(positionalAppId);
    return;
  }

  // App dispatch
  await dispatchApp(positionalAppId, parsed);
}

// ─── App dispatch ──────────────────────────────────────────────────────────

async function dispatchApp(
  appId: string,
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const fileInputs = parsed.values.file
    ? await loadInputsFromFile(parsed.values.file as string)
    : {};
  const inlineInputs = parseInlineInputs((parsed.values.input as string[]) || []);
  const inputs = { ...fileInputs, ...inlineInputs };

  const webhookResolution = await resolveWebhookForDispatch({
    explicit: parsed.values.webhook as string | undefined,
    optOut: parsed.values['no-webhook'] as boolean | undefined,
  });
  const webhook = webhookResolution.webhookUrl || undefined;

  const { client } = await createClientFromAuthContext();

  // Surface the resolved webhook source in non-JSON output so the user
  // sees when an implicit (stored-default) URL is firing. Silent in JSON
  // mode — the structured envelope is enough.
  if (webhook && !(parsed.values.json || isJsonMode())) {
    const label = webhookResolution.source === 'stored' ? ' (default)' : '';
    process.stdout.write(`Webhook${label}: ${webhook}\n`);
  }

  const app = await client.apps.get(appId);
  validateInputsAgainstSchema(inputs, app.data.parameters);

  // `--output <label>` (repeatable) selects a subset of the app's outputs.
  // Omitted → undefined → full workflow runs (server default).
  const outputs = (parsed.values.output as string[] | undefined)?.filter((s) => s.trim().length > 0);

  const started = await client.runs.run(appId, {
    inputs,
    webhook,
    ...(outputs && outputs.length > 0 ? { outputs } : {}),
  });

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
      ? Number.parseInt(parsed.values['interval-ms'] as string, 10)
      : 2000,
    timeoutMs: parsed.values['timeout-ms']
      ? Number.parseInt(parsed.values['timeout-ms'] as string, 10)
      : 240000,
  });

  const downloads = await maybeDownloadAndAnnotate({
    parsed,
    runId: started.data.runId,
    response: completed,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(completed);
  } else {
    printExecution(completed.data, { appName: started.data.workflowName });
    if (downloads) printDownloads(downloads);
  }
}

// When `lamina content plan` can't match a brief to a catalog App, the
// response carries `unmatched` status — the calling agent falls back to
// direct model dispatch via `lamina generate image|video`.

/**
 * If `--download <template>` was supplied, download every terminal-completed
 * output to disk via the template, mutate the response envelope to include
 * `data.downloads[]` so the JSON envelope captures local paths alongside
 * source URLs, and return the list for the non-JSON renderer to print.
 *
 * Returns null when --download wasn't passed (no work to do).
 */
async function maybeDownloadAndAnnotate({
  parsed,
  runId,
  response,
}: {
  parsed: ReturnType<typeof parseArgs>;
  runId: string;
  response: { data?: { outputs?: RunOutput[]; downloads?: DownloadedFile[] } };
}): Promise<DownloadedFile[] | null> {
  const template = parsed.values.download as string | undefined;
  if (!template) return null;

  const outputs = (response.data?.outputs as RunOutput[]) || [];
  const downloads = await downloadOutputs({ runId, outputs, template });

  if (response.data) {
    response.data.downloads = downloads;
  }
  return downloads;
}

function printDownloads(downloads: DownloadedFile[]): void {
  if (downloads.length === 0) return;
  process.stdout.write(`\nDownloaded ${downloads.length} file(s):\n`);
  for (const d of downloads) {
    const kb = (d.bytes / 1024).toFixed(1);
    process.stdout.write(`  outputs[${d.outputIndex}] → ${d.localPath} (${kb} KB)\n`);
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
