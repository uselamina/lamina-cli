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
Polymorphic — works for app runs, freestyle recipe runs, and atomic
generate runs (\`lamina generate image\`).

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

  // Polymorphic over three run kinds: atomic image-gen, app workflow, freestyle.
  // Try atomic first — cheapest lookup (one indexed SELECT on fal_requests).
  // Fall through on 404 to the other two surfaces.
  let response: unknown;
  let kind: 'atomic' | 'workflow' | 'freestyle' = 'workflow';
  try {
    response = await client.generate.getRun(runId);
    kind = 'atomic';
  } catch (atomicErr) {
    if (!isLikelyNotFound(atomicErr)) throw atomicErr;
    try {
      response = await client.runs.get(runId);
      kind = 'workflow';
    } catch (workflowErr) {
      if (!isLikelyNotFound(workflowErr)) throw workflowErr;
      response = await client.freestyle.get(runId);
      kind = 'freestyle';
    }
  }

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
    return;
  }
  if (kind === 'atomic' || kind === 'freestyle') {
    // Atomic + freestyle have their own response shapes — print JSON until
    // we have dedicated renderers. Atomic is shallow enough to read at a
    // glance; freestyle is variant-shaped.
    printJson(response);
    return;
  }
  printExecution((response as { data: any }).data);
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

  // Polymorphic across three run kinds: atomic image-gen, app workflow,
  // freestyle/recipe. Try atomic first (cheapest), then app, then freestyle.
  // On 404 from one path, fall through to the next.
  let response: any;
  let kind: 'atomic' | 'workflow' | 'freestyle' = 'workflow';
  try {
    response = await client.generate.wait(runId, waitOptions);
    response = { data: response };               // normalize: generate.wait returns the data directly
    kind = 'atomic';
  } catch (atomicErr) {
    if (!isLikelyNotFound(atomicErr)) throw atomicErr;
    try {
      response = await client.runs.wait(runId, waitOptions);
      kind = 'workflow';
    } catch (workflowErr) {
      if (!isLikelyNotFound(workflowErr)) throw workflowErr;
      response = await client.freestyle.wait(runId, waitOptions);
      kind = 'freestyle';
    }
  }

  const template = parsed.values.download as string | undefined;
  let downloads: DownloadedFile[] | null = null;
  if (template) {
    // Atomic runs have `output` (singular); workflow/freestyle have `outputs[]`.
    // Normalize both to an array for the downloader.
    const data = (response as { data?: { outputs?: RunOutput[]; output?: { type?: string; url?: string | null } | null; downloads?: DownloadedFile[] } }).data;
    let outputs: RunOutput[] = [];
    if (Array.isArray(data?.outputs)) {
      outputs = data.outputs;
    } else if (data?.output && typeof data.output === 'object') {
      outputs = [
        {
          value: data.output.url ?? null,
          outputType: data.output.type ?? 'image',
          nodeLabel: null,
        } as RunOutput,
      ];
    }
    downloads = await downloadOutputs({ runId, outputs, template });
    if (data) data.downloads = downloads;
  }

  if (parsed.values.json || isJsonMode()) {
    printJson(response);
    return;
  }
  if (kind === 'atomic' || kind === 'freestyle') {
    // Atomic + freestyle have their own response shapes — pretty-print as
    // JSON until they get dedicated renderers.
    printJson(response);
    if (downloads && downloads.length > 0) printDownloads(downloads);
    return;
  }
  printExecution(response.data);
  if (downloads && downloads.length > 0) printDownloads(downloads);
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
