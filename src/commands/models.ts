import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  printJson,
  printModelsList,
  printModelDescribe,
} from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const GROUP_HELP = `Usage: lamina models <subcommand>

Discover Lamina's curated set of image and video generation models.

Subcommands:
  list             List models (filter by --modality).
  describe <id>    Show the input contract (flat paramSchema, prompt included) for one model.

Run \`lamina models <subcommand> --help\` for subcommand options.
`;

const LIST_HELP = `Usage: lamina models list [options]

List Lamina's curated image and video generation models. Each entry
is the minimum needed to pick a model — \`id\`, \`modality\`,
\`categories\`. Call \`lamina models describe <id>\` next for the input
contract.

Options:
  --modality <kind>   image (default) or video.
  --json              Emit the raw API envelope (for piping to jq).
  --help, -h          Show this help.

Examples:
  lamina models list
  lamina models list --modality video
  lamina models list --modality video --json
`;

const DESCRIBE_HELP = `Usage: lamina models describe <id> [options]

Show the input contract for one model — the schema you follow when
invoking \`lamina generate image\` / \`lamina edit image\` / \`lamina
generate video\`. Returns the model's \`id\`, \`modality\`, \`categories\`,
and a \`modes\` block where each supported mode carries its own \`prompt\`
metadata and \`paramSchema\` (every field accepted under \`--params\`).

Options:
  --modality <kind>   Optional — image or video. Model ids are globally
                      unique, so the lookup is polymorphic by default.
                      Pass to scope explicitly if you need to.
  --json              Emit the raw API envelope (for piping to jq).
  --help, -h          Show this help.

Examples:
  lamina models describe ideogram-v3
  lamina models describe kling-v3-pro-image-to-video
  lamina models describe minimax-text-to-video
`;

export async function handleModelsCommand(args: string[]): Promise<void> {
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

  if (subcommand === 'list') return handleList(args.slice(1));
  if (subcommand === 'describe') return handleDescribe(args.slice(1));

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina models ${subcommand}".`,
    suggestion: 'Run `lamina models --help` for valid subcommands.',
  });
}

async function handleList(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(LIST_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        modality: { type: 'string' },
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
      suggestion: 'Run `lamina models list --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(LIST_HELP);
    return;
  }

  const modality = (parsed.values.modality as 'image' | 'video' | undefined) ?? 'image';

  const { client } = await createClientFromAuthContext();
  const response = await client.models.list({ modality });

  if (isJsonMode()) {
    printJson(response);
    return;
  }

  printModelsList(response.data, { modality });
}

async function handleDescribe(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(DESCRIBE_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        modality: { type: 'string' },
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
      suggestion: 'Run `lamina models describe --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(DESCRIBE_HELP);
    return;
  }

  const modelId = parsed.positionals[0];
  if (!modelId) {
    process.stdout.write(DESCRIBE_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <id>.',
      suggestion: 'Example: lamina models describe ideogram-v3',
    });
  }

  const modality = parsed.values.modality as 'image' | 'video' | undefined;

  const { client } = await createClientFromAuthContext();
  const response = await client.models.describe(modelId, modality ? { modality } : {});

  if (isJsonMode()) {
    printJson(response);
    return;
  }

  printModelDescribe(response.data);
}
