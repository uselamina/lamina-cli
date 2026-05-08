import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  printBrandContext,
  printJson,
  printPrediction,
  printRecommendations,
  printTrends,
} from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const GROUP_HELP = `Usage: lamina intelligence <subcommand>

Read this workspace's content-intelligence layer — brand DNA, guidance,
performance prediction, recommendations, and trend signals.

Subcommands:
  brand-context      Show workspace brand DNA + active guidance + top patterns
  predict <concept>  Predict content performance for a concept (LLM-backed)
  recommendations    List actionable content recommendations
  trends             Top / emerging / declining patterns by window

Run \`lamina intelligence <subcommand> --help\` for subcommand options.
`;

const BRAND_CONTEXT_HELP = `Usage: lamina intelligence brand-context [options]

Show this workspace's brand context: voice attributes, content pillars,
guardrails, active prompt directives, and top-performing patterns. Each
section is null/empty when the workspace hasn't configured it yet.

Options:
  --brand-profile-id <uuid>  Scope to one brand profile.
  --campaign-id <uuid>       Scope guidance to a campaign.
  --workflow-id <uuid>       Scope guidance to a specific workflow.
  --platform <name>          Filter by platform (e.g. instagram).
  --modality <kind>          Filter by modality: image | video | audio | text.
  --objective <name>         Filter by content objective.
  --top-k <n>                Cap top patterns shown (default 10).
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials.
`;

const PREDICT_HELP = `Usage: lamina intelligence predict "<concept>" [options]

Predict content performance for a concept BEFORE generating it. The server
gathers brand DNA + top patterns + trends + recent items and runs them
through a Gemini call to score the concept.

Required:
  <concept>                  Free-form concept description (positional).
  --platform <name>          Target platform (e.g. instagram, tiktok).
  --modality <kind>          Modality: image | video | audio | text.

Optional:
  --brand-profile-id <uuid>  Apply a specific brand profile.
  --campaign-id <uuid>       Scope to a campaign.
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.

Cost: one LLM call per invocation (Gemini, capped at 2048 output tokens).

Example:
  lamina intelligence predict "spring carousel about fresh silhouettes" \\
    --platform instagram --modality image
`;

const RECOMMENDATIONS_HELP = `Usage: lamina intelligence recommendations [options]

List actionable content recommendations the platform has surfaced for this
workspace (populated by background scoring jobs). Empty when the
recommendations layer hasn't run.

Options:
  --campaign-id <uuid>       Scope to a campaign.
  --workflow-id <uuid>       Scope to a workflow.
  --brand-profile-id <uuid>  Scope to a brand profile.
  --platform <name>          Filter by platform.
  --modality <kind>          Filter by modality.
  --objective <name>         Filter by objective.
  --limit <n>                Cap results (default 25, max 100).
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.
`;

const TRENDS_HELP = `Usage: lamina intelligence trends [options]

Aggregate trend signals (top / emerging / declining patterns) for this
workspace over a recent window. Empty when no patterns have been scored yet.

Options:
  --category <name>          Filter by pattern category.
  --platform <name>          Filter by platform.
  --window-days <n>          Aggregation window in days (default 7).
  --limit <n>                Cap patterns per bucket (default 20).
  --json                     Emit the raw API envelope.
  --help, -h                 Show this help.
`;

export async function handleIntelligenceCommand(args: string[]): Promise<void> {
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

  if (subcommand === 'brand-context') {
    return handleBrandContext(args.slice(1));
  }
  if (subcommand === 'predict') {
    return handlePredict(args.slice(1));
  }
  if (subcommand === 'recommendations') {
    return handleRecommendations(args.slice(1));
  }
  if (subcommand === 'trends') {
    return handleTrends(args.slice(1));
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina intelligence ${subcommand}".`,
    suggestion: 'Run `lamina intelligence --help` for valid subcommands.',
  });
}

async function handleBrandContext(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(BRAND_CONTEXT_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        'brand-profile-id': { type: 'string' },
        'campaign-id': { type: 'string' },
        'workflow-id': { type: 'string' },
        platform: { type: 'string' },
        objective: { type: 'string' },
        modality: { type: 'string' },
        'top-k': { type: 'string' },
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
      suggestion: 'Run `lamina intelligence brand-context --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(BRAND_CONTEXT_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();

  const response = await client.intelligence.getBrandContext({
    brandProfileId: parsed.values['brand-profile-id'],
    campaignId: parsed.values['campaign-id'],
    workflowId: parsed.values['workflow-id'],
    platform: parsed.values.platform,
    objective: parsed.values.objective,
    modality: parsed.values.modality,
    topK: parsed.values['top-k'] ? Number.parseInt(parsed.values['top-k'], 10) : undefined,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printBrandContext(response.data);
  }
}

async function handlePredict(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(PREDICT_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        'brand-profile-id': { type: 'string' },
        'campaign-id': { type: 'string' },
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
      suggestion: 'Run `lamina intelligence predict --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(PREDICT_HELP);
    return;
  }

  const concept = parsed.positionals.join(' ').trim();
  if (!concept) {
    process.stdout.write(PREDICT_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <concept>.',
      suggestion:
        'Example: lamina intelligence predict "spring carousel" --platform instagram --modality image',
    });
  }
  if (!parsed.values.platform) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing --platform.',
      suggestion: 'Pass --platform <name> (e.g. instagram, tiktok, youtube).',
    });
  }
  if (!parsed.values.modality) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing --modality.',
      suggestion: 'Pass --modality <kind> (image | video | audio | text).',
    });
  }

  const { client } = await createClientFromAuthContext();

  const response = await client.intelligence.predict({
    concept,
    platform: parsed.values.platform,
    modality: parsed.values.modality,
    brandProfileId: parsed.values['brand-profile-id'],
    campaignId: parsed.values['campaign-id'],
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printPrediction(response.data);
  }
}

async function handleRecommendations(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(RECOMMENDATIONS_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        'campaign-id': { type: 'string' },
        'workflow-id': { type: 'string' },
        'brand-profile-id': { type: 'string' },
        platform: { type: 'string' },
        objective: { type: 'string' },
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
      suggestion: 'Run `lamina intelligence recommendations --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(RECOMMENDATIONS_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();

  const response = await client.intelligence.recommendations({
    campaignId: parsed.values['campaign-id'],
    workflowId: parsed.values['workflow-id'],
    brandProfileId: parsed.values['brand-profile-id'],
    platform: parsed.values.platform,
    objective: parsed.values.objective,
    modality: parsed.values.modality,
    limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printRecommendations(response.data);
  }
}

async function handleTrends(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(TRENDS_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        category: { type: 'string' },
        platform: { type: 'string' },
        'window-days': { type: 'string' },
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
      suggestion: 'Run `lamina intelligence trends --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(TRENDS_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();

  const response = await client.intelligence.trends({
    category: parsed.values.category,
    platform: parsed.values.platform,
    windowDays: parsed.values['window-days']
      ? Number.parseInt(parsed.values['window-days'], 10)
      : undefined,
    limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
  });

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printTrends(response.data);
  }
}
