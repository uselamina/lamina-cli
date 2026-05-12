import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import { printExecution, printJson } from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const GROUP_HELP = `Usage: lamina runs <subcommand>

Inspect runs you started with \`lamina run\`.

Subcommands:
  get <runId>        Print current status and outputs.
  wait <runId>       Block until the run reaches a terminal state.

Run \`lamina runs <subcommand> --help\` for subcommand options.
`;

const GET_HELP = `Usage: lamina runs get <runId> [options]

Print the current status, progress, and outputs of a run.

Options:
  --json             Emit the raw API envelope.
  --help, -h         Show this help.
`;

const WAIT_HELP = `Usage: lamina runs wait <runId> [options]

Block until the run reaches a terminal state (completed / failed / cancelled).

Options:
  --timeout-ms <ms>  Max wait time, default 240000.
  --interval-ms <ms> Poll interval, default 2000.
  --json             Emit the raw API envelope.
  --help, -h         Show this help.
`;

export async function handleRunsCommand(args: string[]): Promise<void> {
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

  if (subcommand === 'get') {
    await handleGet(args.slice(1));
    return;
  }
  if (subcommand === 'wait') {
    await handleWait(args.slice(1));
    return;
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina runs ${subcommand}".`,
    suggestion: 'Run `lamina runs --help` to see valid subcommands.',
  });
}

async function handleGet(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(GET_HELP);
    return;
  }

  const runId = args[0];
  if (!runId) {
    process.stdout.write(GET_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <runId>.',
    });
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(GET_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();
  const response = await client.runs.get(runId);
  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else {
    printExecution(response.data);
  }
}

async function handleWait(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(WAIT_HELP);
    return;
  }

  const runId = args[0];
  if (!runId) {
    process.stdout.write(WAIT_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <runId>.',
    });
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      json: { type: 'boolean' },
      'interval-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(WAIT_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();
  const waitOptions = {
    intervalMs: parsed.values['interval-ms']
      ? Number.parseInt(parsed.values['interval-ms'], 10)
      : 2000,
    timeoutMs: parsed.values['timeout-ms']
      ? Number.parseInt(parsed.values['timeout-ms'], 10)
      : 240000,
  };

  // Polymorphic: a runId might belong to either an app workflow run
  // (/v1/runs/<runId>) or a freestyle/recipe run (/v1/freestyle/<runId>).
  // Try the app endpoint first; on 404 fall back to freestyle. Either way
  // the agent gets one wait command to learn instead of branching by mode.
  let response;
  let isFreestyle = false;
  try {
    response = await client.runs.wait(runId, waitOptions);
  } catch (err) {
    if (isLikelyNotFound(err)) {
      response = await client.freestyle.wait(runId, waitOptions);
      isFreestyle = true;
    } else {
      throw err;
    }
  }

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else if (isFreestyle) {
    // Freestyle completion has a different shape; pretty-print as JSON until
    // we have a dedicated renderer.
    printJson(response);
  } else {
    printExecution(response.data);
  }
}

function isLikelyNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { status?: number; statusCode?: number; message?: string; code?: string };
  if (anyErr.status === 404 || anyErr.statusCode === 404) return true;
  if (anyErr.code === 'not_found') return true;
  const msg = (anyErr.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('404');
}
