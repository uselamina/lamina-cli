#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleAppsCommand } from './commands/apps.js';
import { handleAssetsCommand } from './commands/assets.js';
import { handleContentCommand } from './commands/content.js';
import { handleIntelligenceCommand } from './commands/intelligence.js';
import { handleLoginCommand } from './commands/login.js';
import { handleLogoutCommand } from './commands/logout.js';
import { handleMcpCommand } from './commands/mcp.js';
import { handlePublishingCommand } from './commands/publishing.js';
import { handleRunCommand } from './commands/run.js';
import { handleRunsCommand } from './commands/runs.js';
import { handleWebhookCommand } from './commands/webhook.js';
import { handleWhoamiCommand } from './commands/whoami.js';
import { classifyError, EXIT, LaminaCliError, printCliError } from './lib/errors.js';
import { printHelp, printVersion } from './lib/output.js';

// Read CLI version from our own package.json and the ACTUALLY-INSTALLED SDK
// version from node_modules. Reading from `dependencies` would only show the
// declared range — using the real installed version is what `gh --version` /
// `vercel --version` do, and gives accurate metadata for bug reports.
function loadPackageVersions(): { cli: string; sdk: string } {
  let cli = 'unknown';
  let sdk = 'unknown';
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const ownPkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    cli = ownPkg.version || 'unknown';
  } catch {
    // ignore — `cli` stays 'unknown'
  }
  try {
    // require.resolve isn't available in ESM; createRequire bridges back to
    // CJS resolution so we can locate @uselamina/sdk's package.json reliably
    // regardless of how the CLI is installed.
    const requireFromHere = createRequire(import.meta.url);
    const sdkPkgPath = requireFromHere.resolve('@uselamina/sdk/package.json');
    const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8')) as { version?: string };
    sdk = sdkPkg.version || 'unknown';
  } catch {
    // ignore — `sdk` stays 'unknown'
  }
  return { cli, sdk };
}

// Common typos / muscle-memory invocations from other CLIs. We intercept
// these and point users at the canonical command rather than dumping a bare
// "Unknown command" error.
const MISTYPE_HINTS: Record<string, string> = {
  signin: 'login',
  'sign-in': 'login',
  signout: 'logout',
  'sign-out': 'logout',
  // gh / gcloud style
  auth: 'login',
};

// Map subcommand names to their handlers. Used by the dispatcher AND by
// `lamina help <subcommand>` so help routing is symmetric with execution.
const COMMAND_HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  login: handleLoginCommand,
  logout: handleLogoutCommand,
  whoami: handleWhoamiCommand,
  apps: handleAppsCommand,
  assets: handleAssetsCommand,
  content: handleContentCommand,
  intelligence: handleIntelligenceCommand,
  publishing: handlePublishingCommand,
  run: handleRunCommand,
  runs: handleRunsCommand,
  webhook: handleWebhookCommand,
  mcp: handleMcpCommand,
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  // Top-level help — `lamina`, `lamina help`, `lamina --help`, `lamina -h`.
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  // `lamina version` / `--version` / `-v` — bug-report metadata.
  if (command === '--version' || command === '-v' || command === 'version') {
    const { cli, sdk } = loadPackageVersions();
    printVersion(cli, sdk);
    return;
  }

  // `lamina help` (no arg) prints top-level help; `lamina help <cmd>` is an
  // alias for `lamina <cmd> --help`. Matches gh / git / stripe convention.
  if (command === 'help') {
    const target = args[0];
    if (!target) {
      printHelp();
      return;
    }
    const handler = COMMAND_HANDLERS[target];
    if (!handler) {
      throw new LaminaCliError({
        code: 'unknown_subcommand',
        exitCode: EXIT.INVALID_USAGE,
        message: `Unknown command: "${target}".`,
        suggestion: 'Run `lamina --help` for the list of commands.',
      });
    }
    await handler(['--help']);
    return;
  }

  const handler = COMMAND_HANDLERS[command];
  if (handler) {
    await handler(args);
    return;
  }

  const hint = MISTYPE_HINTS[command];
  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown command: "${command}".`,
    suggestion: hint
      ? `Did you mean \`lamina ${hint}\`? Run \`lamina --help\` for the full list.`
      : 'Run `lamina --help` for the list of commands.',
  });
}

main().catch((error: unknown) => {
  const cliError = classifyError(error);
  printCliError(cliError);
  process.exit(cliError.exitCode);
});
