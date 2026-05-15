import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { downloadOutputs, type DownloadedFile, type RunOutput } from '../lib/downloadOutputs.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import { printExecution, printJson } from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const GROUP_HELP = `Usage: lamina runs <subcommand>

Inspect runs you started with \`lamina run\`.

Subcommands:
  get <runId>        Print current status and outputs.
  wait <runId>       Block until the run reaches a terminal state.
  cancel <runId>     Cancel a queued or running execution.

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
Polymorphic — works for both app runs and freestyle recipe runs.

To avoid hanging the chat session indefinitely, keep --timeout-ms bounded
(≤180000ms) and re-call this command if the previous wait timed out without
reaching terminal. See the skill's rule 5 for the recommended cadence.

Options:
  --timeout-ms <ms>      Max wait time, default 240000. Bound to ≤180000 in
                         agent flows; chain multiple short waits instead of
                         one long block.
  --interval-ms <ms>     Poll interval, default 2000.
  --download <path>      Save terminal-completed outputs to disk at the
                         given path after the wait resolves. Smart path
                         resolution (same as \`lamina run --download\`):
                           ./out/hero.png  → literal for 1 output;
                                             auto-suffixed _0/_1/_2 for N
                           ./out/          → folder; files land inside
                           ./out/{runId}_{index}.{ext}
                                           → advanced template, verbatim
                         Parent dirs auto-created. In JSON mode files
                         appear under \`data.downloads[]\`.
  --json                 Emit the raw API envelope.
  --help, -h             Show this help.
`;

const CANCEL_HELP = `Usage: lamina runs cancel <runId> [options]

Cancel a queued or running execution. Idempotent — if the run already
reached a terminal state (completed/failed/cancelled) the server returns
its current status without erroring.

Use this when the user changes their mind mid-flight (wrong inputs after
dispatch, oversized variant set, abandoned long-running job). Don't just
stop polling — orphaned runs continue consuming credits.

Options:
  --json             Emit the raw API envelope.
  --help, -h         Show this help.

Examples:
  lamina runs cancel exec_8f2a...
  lamina runs cancel exec_8f2a... --json
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
  if (subcommand === 'cancel') {
    await handleCancel(args.slice(1));
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
      download: { type: 'string' },
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

  const template = parsed.values.download as string | undefined;
  let downloads: DownloadedFile[] | null = null;
  if (template) {
    const outputs = ((response as { data?: { outputs?: RunOutput[] } }).data?.outputs ?? []) as RunOutput[];
    downloads = await downloadOutputs({ runId, outputs, template });
    const data = (response as { data?: { downloads?: DownloadedFile[] } }).data;
    if (data) data.downloads = downloads;
  }

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
  } else if (isFreestyle) {
    // Freestyle completion has a different shape; pretty-print as JSON until
    // we have a dedicated renderer.
    printJson(response);
    if (downloads && downloads.length > 0) printDownloads(downloads);
  } else {
    printExecution(response.data);
    if (downloads && downloads.length > 0) printDownloads(downloads);
  }
}

async function handleCancel(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(CANCEL_HELP);
    return;
  }

  const runId = args[0];
  if (!runId) {
    process.stdout.write(CANCEL_HELP);
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
    process.stdout.write(CANCEL_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();
  const response = await client.runs.cancel(runId);

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
    return;
  }

  const { runId: id, status } = response.data;
  if (status === 'cancelled') {
    process.stdout.write(`Cancelled run ${id} (status: cancelled).\n`);
  } else {
    process.stdout.write(`Run ${id} already terminal (status: ${status}); no cancellation needed.\n`);
  }
}

function printDownloads(downloads: DownloadedFile[]): void {
  process.stdout.write(`\nDownloaded ${downloads.length} file(s):\n`);
  for (const d of downloads) {
    const kb = (d.bytes / 1024).toFixed(1);
    process.stdout.write(`  outputs[${d.outputIndex}] → ${d.localPath} (${kb} KB)\n`);
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
