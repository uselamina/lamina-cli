import { parseArgs } from 'node:util';

import { createClientFromAuthContext, resolveStoredWebhookUrl } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  printContentBrief,
  printContentPlan,
  printContentScore,
  printExecution,
  printJson,
} from '../lib/output.js';

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

Send a brief to the planner. The agent picks the best app, drafts what it
can from the brief, applies workspace brand context, and either:

  • Dispatches the run when nothing user-specific is missing (default), or
  • Returns a list of inputs needed from the user when the brief alone
    isn't sufficient (e.g. "your photo URL").

Pass --plan-only to never dispatch (preview-then-apply mode).

Options:
  --platform <name>          Target platform hint (e.g. instagram, tiktok).
  --modality <kind>          Modality hint: image | video | audio | text.
  --app-id <uuid>            Skip ranking and use this app directly.
  --brand-profile-id <uuid>  Apply a specific brand profile.
  --campaign-id <uuid>       Scope guidance to a campaign.
  --webhook <url>            Get a POST callback when the run completes
                             (only used when the planner dispatches).
  --plan-only                Never dispatch. Always return a plan.
  --wait                     Block until the dispatched run reaches a
                             terminal state. (Implies dispatch.)
  --timeout-ms <ms>          Max wait time, default 240000 (with --wait).
  --interval-ms <ms>         Poll interval, default 2000 (with --wait).
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.

Examples:
  lamina content plan "a selfie with Tom Holland" --modality image
  lamina content plan "spring collection IG carousel" --platform instagram
  lamina content plan "caption a product reel" --plan-only
  lamina content plan "..." --webhook https://my-tunnel/lamina/webhook

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
        platform: { type: 'string' },
        modality: { type: 'string' },
        'app-id': { type: 'string' },
        'brand-profile-id': { type: 'string' },
        'campaign-id': { type: 'string' },
        webhook: { type: 'string' },
        'plan-only': { type: 'boolean' },
        wait: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
        'interval-ms': { type: 'string' },
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

  if (parsed.values.wait && parsed.values['plan-only']) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--wait conflicts with --plan-only.',
      suggestion: '--plan-only never starts a run, so there is nothing to wait on.',
    });
  }

  const rawWebhook = parsed.values.webhook?.trim();
  const webhookUrl =
    rawWebhook === 'local' || rawWebhook === 'default'
      ? (await resolveStoredWebhookUrl(rawWebhook)).webhookUrl
      : rawWebhook;

  const { client } = await createClientFromAuthContext();

  const response = await client.content.plan({
    brief,
    platform: parsed.values.platform,
    modality: parsed.values.modality,
    appId: parsed.values['app-id'],
    brandProfileId: parsed.values['brand-profile-id'],
    campaignId: parsed.values['campaign-id'],
    webhookUrl,
    planOnly: Boolean(parsed.values['plan-only']),
  });

  if (parsed.values.json && !parsed.values.wait) {
    printJson(response);
    return;
  }

  printContentPlan(response.data);

  // --wait only meaningful when --dispatch fired a run.
  if (parsed.values.wait && response.data.status === 'dispatched' && response.data.runId) {
    process.stdout.write('\nWaiting for run to complete…\n\n');
    const completed = await client.runs.wait(response.data.runId, {
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
      printExecution(completed.data, { appName: response.data.selectedApp?.name });
    }
  }
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

  if (parsed.values.json) {
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

  if (parsed.values.json) {
    printJson(response);
  } else {
    printContentScore(response.data);
  }
}
