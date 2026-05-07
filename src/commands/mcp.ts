import { parseArgs } from 'node:util';

import { startMcpServer } from '@uselamina/mcp';

import { EXIT, LaminaCliError } from '../lib/errors.js';

const GROUP_HELP = `Usage: lamina mcp <subcommand>

Run the Lamina MCP server so an LLM agent (Claude Code, Cursor, custom MCP
client) can call Lamina with typed tools instead of parsing CLI text.

Subcommands:
  serve     Start the MCP server on stdio.

Run \`lamina mcp <subcommand> --help\` for subcommand options.
`;

const SERVE_HELP = `Usage: lamina mcp serve [options]

Start the Lamina MCP server. The server speaks the Model Context Protocol over
stdio and exposes Lamina's app catalog, run dispatch, and content planning as
typed tools.

Configure your MCP client to launch \`lamina mcp serve\` as the server command.

Options:
  --help, -h    Show this help.

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials. Override the
endpoint with LAMINA_BASE_URL (defaults to https://app.uselamina.ai).
`;

export async function handleMcpCommand(args: string[]): Promise<void> {
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

  if (subcommand === 'serve') {
    return handleServe(args.slice(1));
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina mcp ${subcommand}".`,
    suggestion: 'Run `lamina mcp --help` for valid subcommands.',
  });
}

async function handleServe(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(SERVE_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina mcp serve --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(SERVE_HELP);
    return;
  }

  // No --api-key / --base-url flags — env-var-only, consistent with the rest
  // of the CLI. The MCP server reads the same env vars and stored credentials.
  await startMcpServer({});
}
