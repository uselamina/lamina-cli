import { randomBytes } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import { parseInlineInputs } from '../lib/inputParser.js';
import {
  printContentBrief,
  printContentPlan,
  printContentScore,
  printJson,
} from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const GROUP_HELP = `Usage: lamina content <subcommand>

High-level natural-language entry points. For low-level (specific app +
explicit inputs) use \`lamina run\`.

Subcommands:
  plan <brief>       Brief → server picks an app, classifies inputs as
                     drafted/defaulted/must-supply, returns a plan.
                     Use --dispatch to auto-run when nothing's missing.
  brief <goal>       Goal → concept ideas (no dispatch).
  score              Score this workspace's published content against
                     brand standards.

Run \`lamina content <subcommand> --help\` for subcommand options.
`;

const PLAN_HELP = `Usage: lamina content plan "<brief>" [options]

Send a brief to the content router agent. The agent picks the best app,
drafts what it can from the brief + any \`--input\` values you provide,
and either:

  • Dispatches the run when nothing user-specific is missing, OR
  • Returns "askUser" questions when the brief isn't enough yet (e.g. it
    needs a photo URL, a product name, or a choice you should make).

When askUser is non-empty, ASK THE HUMAN for each item, then re-invoke
this command with \`--input <name>=<value>\` for each answer. Loop until
askUser is empty and a runId is returned.

Options:
  --input <name>=<value>     Provide a value for one of the agent's
                             questions. Repeatable. The agent will relay
                             the value to the matching app parameter and
                             will NOT re-ask.
  --platform <name>          Target platform hint (e.g. instagram, tiktok).
  --modality <kind>          Modality hint: image | video.
  --app-id <uuid>            Skip ranking and use this app directly.
  --brand-profile-id <uuid>  Apply a specific brand profile.
  --num-variants <n>         Variant count when the agent goes freestyle.
  --webhook <url>            Get a POST callback when a run dispatches.
  --wait                     Block until the dispatched run completes.
  --timeout-ms <ms>          Max wait time, default 240000 (with --wait).
  --interval-ms <ms>         Poll interval, default 2000 (with --wait).
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.

Examples:
  lamina content plan "a selfie with Tom Holland" --modality image
  lamina content plan "a selfie with Tom Holland" \\
    --input your_photo_image_url=https://media.getmason.io/abc.jpg
  lamina content plan "spring IG carousel" --platform instagram

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials.
`;

const BRIEF_HELP = `Usage: lamina content brief "<goal>" [options]

Generate concept ideas from a goal. The server applies brand context and
returns structured concepts (title, prompt, platform, modality, format,
predicted performance, rationale). No run is dispatched.

Options:
  --platform <name>          Target platform hint.
  --modality <kind>          Modality hint: image | video | audio | text.
  --count <n>                How many concepts to return.
  --brand-profile-id <uuid>  Apply a specific brand profile.
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.

Example:
  lamina content brief "increase Instagram engagement this week" --platform instagram --count 3
`;

const SCORE_HELP = `Usage: lamina content score [options]

Score this workspace's published content against brand standards. Returns
how many items were scanned and any scores created.

Options:
  --platform <name>          Filter by platform.
  --modality <kind>          Filter by modality.
  --limit <n>                Cap the number of items scanned.
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.
`;

export async function handleContentCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    process.stdout.write(GROUP_HELP);
    if (!subcommand) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: 'Missing subcommand.',
      });
    }
    return;
  }

  if (subcommand === 'plan') {
    return handlePlan(args.slice(1));
  }
  if (subcommand === 'brief') {
    return handleBrief(args.slice(1));
  }
  if (subcommand === 'score') {
    return handleScore(args.slice(1));
  }

  // `create` was the legacy regex-based dispatcher. Routing was unreliable for
  // apps that need user-asset URLs (selfies, product shoots). Dropped in
  // favour of `plan`, which is honest about what it can and can't draft.
  if (subcommand === 'create') {
    throw new LaminaCliError({
      code: 'unknown_subcommand',
      exitCode: EXIT.INVALID_USAGE,
      message: '`lamina content create` was removed.',
      suggestion:
        'Use `lamina content plan "<brief>"` to plan a run (preview-then-apply, like `terraform plan`). Add --dispatch to run immediately when nothing\'s missing.',
    });
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina content ${subcommand}".`,
    suggestion: 'Run `lamina content --help` for valid subcommands.',
  });
}

async function handlePlan(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(PLAN_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        input: { type: 'string', multiple: true },
        platform: { type: 'string' },
        modality: { type: 'string' },
        'app-id': { type: 'string' },
        'brand-profile-id': { type: 'string' },
        'num-variants': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina content plan --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(PLAN_HELP);
    return;
  }

  const brief = parsed.positionals.join(' ').trim();
  if (!brief) {
    process.stdout.write(PLAN_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing brief.',
      suggestion: 'Example: lamina content plan "a selfie with Tom Holland" --modality image',
    });
  }

  const inlineInputs = parseInlineInputs(parsed.values.input || []);
  const hasInputs = Object.keys(inlineInputs).length > 0;

  const numVariantsRaw = parsed.values['num-variants'];
  const numVariants = numVariantsRaw ? Number.parseInt(numVariantsRaw, 10) : undefined;

  const { client } = await createClientFromAuthContext();

  const response = await client.content.plan({
    brief,
    platform: parsed.values.platform,
    modality: parsed.values.modality,
    appId: parsed.values['app-id'],
    brandProfileId: parsed.values['brand-profile-id'],
    inputs: hasInputs ? inlineInputs : undefined,
    numVariants,
  });

  // For `mode: 'recipe'` responses, write the recipe JSON to a local file so
  // the calling agent can dispatch it via `lamina run --recipe-file <path>`.
  // Best-effort: log a warning if write fails but don't error — the recipe is
  // also returned inline in the JSON response.
  let recipeFile: string | undefined;
  if (
    response.data.status === 'plan' &&
    response.data.mode === 'recipe' &&
    response.data.recipe
  ) {
    try {
      recipeFile = await writeRecipeFile(response.data.recipe);
      // Best-effort cleanup of old recipe files (>24h).
      void cleanupOldRecipes();
    } catch (err) {
      process.stderr.write(
        `Warning: failed to write recipe to ~/.lamina/recipes/: ${(err as Error).message}\n`,
      );
    }
  }

  if (parsed.values.json || isJsonMode()) {
    // Include the recipeFile path in the JSON output if we wrote one.
    const augmented = recipeFile
      ? { ...response, data: { ...response.data, recipeFile } }
      : response;
    printJson(augmented);
    return;
  }

  printContentPlan(response.data, { recipeFile });
}

// ─── Recipe file storage helpers ───────────────────────────────────────────
//
// When `lamina content plan` returns a recipe (no catalog app fit), we write
// the recipe JSON to `~/.lamina/recipes/recipe-<date>-<id>.json` so the
// calling agent can pass it to `lamina run --recipe-file <path>` for
// deterministic dispatch via the existing `client.content.run({mode:
// 'freestyle', ...})` SDK call. Files auto-clean after 24h.

const RECIPES_DIR = join(homedir(), '.lamina', 'recipes');
const RECIPE_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

async function writeRecipeFile(recipe: unknown): Promise<string> {
  await mkdir(RECIPES_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const id = randomBytes(4).toString('hex');
  const path = join(RECIPES_DIR, `recipe-${today}-${id}.json`);
  await writeFile(path, JSON.stringify(recipe, null, 2), 'utf8');
  return path;
}

async function cleanupOldRecipes(): Promise<void> {
  let entries;
  try {
    entries = await readdir(RECIPES_DIR);
  } catch {
    return; // directory doesn't exist yet
  }
  const now = Date.now();
  await Promise.all(
    entries
      .filter((name) => name.startsWith('recipe-') && name.endsWith('.json'))
      .map(async (name) => {
        const full = join(RECIPES_DIR, name);
        try {
          const s = await stat(full);
          if (now - s.mtimeMs > RECIPE_FILE_MAX_AGE_MS) {
            await unlink(full);
          }
        } catch {
          // best-effort
        }
      }),
  );
}

async function handleBrief(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(BRIEF_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        count: { type: 'string' },
        'brand-profile-id': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina content brief --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(BRIEF_HELP);
    return;
  }

  const goal = parsed.positionals.join(' ').trim();
  if (!goal) {
    process.stdout.write(BRIEF_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing goal.',
      suggestion: 'Example: lamina content brief "increase IG engagement" --platform instagram',
    });
  }

  const { client } = await createClientFromAuthContext();

  const response = await client.content.brief({
    goal,
    platform: parsed.values.platform,
    modality: parsed.values.modality,
    count: parsed.values.count ? Number.parseInt(parsed.values.count, 10) : undefined,
    brandProfileId: parsed.values['brand-profile-id'],
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printContentBrief(response.data);
  }
}

async function handleScore(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(SCORE_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        limit: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina content score --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(SCORE_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();

  const response = await client.content.score({
    platform: parsed.values.platform,
    modality: parsed.values.modality,
    limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printContentScore(response.data);
  }
}
