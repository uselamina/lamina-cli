import { readFile } from 'node:fs/promises';
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

const HELP = `Usage:
  lamina run <appId>            [options]   # dispatch a catalog app
  lamina run --recipe-file <p>  [options]   # dispatch a recipe (from \`lamina content plan\`)

Dispatch a catalog app OR a freestyle recipe (mutually exclusive).

App mode — positional <appId>:
  --input <key=value>      Set one input. Repeatable. Use the snake_case
                           \`key\` from \`lamina apps get <appId>\`.
  --file <path.json>       Load inputs from a JSON file. Either
                           { "key": "value", ... } or { "inputs": { ... } }.

Recipe mode — --recipe-file <path>:
  --recipe-file <path>     Dispatch the recipe at <path>. Typically the file
                           written by \`lamina content plan\` when the agent
                           falls back to a recipe (no catalog app fits).
  --input <key=value>      Optional per-recipe overrides — used when the
                           plan response included askUser items and the
                           human's answers slot into the recipe.

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
  lamina run --recipe-file ~/.lamina/recipes/recipe-2026-05-12-abc.json --wait

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
        message: 'Missing <appId> or --recipe-file <path>.',
        suggestion:
          'For app dispatch, pass <appId> (see `lamina apps list`).\n' +
          'For recipe dispatch, pass --recipe-file <path> (typically from `lamina content plan`).',
      });
    }
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        'recipe-file': { type: 'string' },
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
  const recipeFile = parsed.values['recipe-file'];

  // Mode discrimination
  if (positionalAppId && recipeFile) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Pass either <appId> positional OR --recipe-file, not both.',
      suggestion: 'App dispatch: lamina run <appId>. Recipe dispatch: lamina run --recipe-file <path>.',
    });
  }
  if (!positionalAppId && !recipeFile) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <appId> or --recipe-file <path>.',
      suggestion: 'Run `lamina run --help` for usage.',
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

  if (parsed.values.help) {
    process.stdout.write(HELP);
    if (positionalAppId) await tryPrintAppParameters(positionalAppId);
    return;
  }

  if (recipeFile) {
    await dispatchRecipe(recipeFile, parsed);
    return;
  }

  // App dispatch (existing behavior)
  await dispatchApp(positionalAppId!, parsed);
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

  const rawWebhook = (parsed.values.webhook as string | undefined)?.trim();
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
      ? Number.parseInt(parsed.values['interval-ms'] as string, 10)
      : 2000,
    timeoutMs: parsed.values['timeout-ms']
      ? Number.parseInt(parsed.values['timeout-ms'] as string, 10)
      : 240000,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(completed);
  } else {
    printExecution(completed.data, { appName: started.data.workflowName });
  }
}

// ─── Recipe dispatch ───────────────────────────────────────────────────────
//
// Reads a recipe JSON file (written by `lamina content plan` when the agent
// falls back to a recipe), merges any --input overrides into each variant's
// params (for askUser answers), and dispatches via the existing
// `client.content.run({ mode: 'freestyle', ... })` SDK call. Polls via
// `client.freestyle.wait` if --wait.

async function dispatchRecipe(
  recipeFile: string,
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  // Read + parse the recipe JSON.
  let recipe: { modality?: string; variants?: Array<Record<string, unknown>>; reason?: string };
  try {
    const raw = await readFile(recipeFile, 'utf8');
    recipe = JSON.parse(raw);
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `Failed to read recipe file '${recipeFile}': ${(err as Error).message}`,
      suggestion: 'Verify the file exists. Recipe files are typically at ~/.lamina/recipes/.',
    });
  }

  if (!recipe || typeof recipe !== 'object' || !Array.isArray(recipe.variants)) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `Recipe file '${recipeFile}' is not a valid recipe (missing variants[]).`,
      suggestion: 'Re-run `lamina content plan` to regenerate a recipe.',
    });
  }
  const modality: 'image' | 'video' = recipe.modality === 'video' ? 'video' : 'image';

  // Merge --input answers into every variant's params. For images, target
  // imageParams; for video, also imageParams (still inputs) and videoParams.
  // Server-side validator will reject unknown keys per the freestyle model
  // registry — we don't try to be clever here.
  const inlineInputs = parseInlineInputs((parsed.values.input as string[]) || []);
  const variants = recipe.variants.map((v) => {
    if (Object.keys(inlineInputs).length === 0) return v;
    const next: Record<string, unknown> = { ...v };
    if (next.imageParams && typeof next.imageParams === 'object') {
      next.imageParams = { ...(next.imageParams as Record<string, unknown>), ...inlineInputs };
    } else {
      next.imageParams = { ...inlineInputs };
    }
    if (modality === 'video' && next.videoParams && typeof next.videoParams === 'object') {
      next.videoParams = { ...(next.videoParams as Record<string, unknown>), ...inlineInputs };
    }
    return next;
  });

  const rawWebhook = (parsed.values.webhook as string | undefined)?.trim();
  const webhookUrl =
    rawWebhook === 'local' || rawWebhook === 'default'
      ? (await resolveStoredWebhookUrl(rawWebhook)).webhookUrl
      : rawWebhook;

  const { client } = await createClientFromAuthContext();

  const started = await client.content.run({
    mode: 'freestyle',
    freestyleRecipe: {
      modality,
      rationale: recipe.reason,
      variants,
    },
    intent: undefined,
    metadata: { source: 'lamina_cli_run_recipe' },
    numVariants: variants.length,
    webhookUrl,
  });

  if (!parsed.values.wait) {
    if (parsed.values.json || isJsonMode()) {
      printJson(started);
    } else {
      process.stdout.write(`Recipe run started: ${started.data.runId}\n`);
      process.stdout.write(`Mode:               freestyle (${modality})\n`);
      if (started.data.picks) process.stdout.write(`Picks:              ${started.data.picks}\n`);
      process.stdout.write(`\nFollow with: lamina runs wait ${started.data.runId}\n`);
    }
    return;
  }

  const completed = await client.freestyle.wait(started.data.runId, {
    intervalMs: parsed.values['interval-ms']
      ? Number.parseInt(parsed.values['interval-ms'] as string, 10)
      : 2000,
    timeoutMs: parsed.values['timeout-ms']
      ? Number.parseInt(parsed.values['timeout-ms'] as string, 10)
      : 240000,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(completed);
  } else {
    // Reuse printExecution-style output. Freestyle completed runs may have a
    // slightly different shape; for now surface the JSON if not pretty.
    printJson(completed);
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
