#!/usr/bin/env node
import { handleAppsCommand } from './commands/apps.js';
import { handleAuthCommand } from './commands/auth.js';
import { handleContentCommand } from './commands/content.js';
import { handleExecutionsCommand } from './commands/executions.js';
import { handleIntelligenceCommand } from './commands/intelligence.js';
import { handleLoginCommand } from './commands/login.js';
import { handlePublishingCommand } from './commands/publishing.js';
import { handleMcpCommand } from './commands/mcp.js';
import { handleRunCommand } from './commands/run.js';
import { handleWebhookCommand } from './commands/webhook.js';
import { printHelp } from './lib/output.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'login') {
    await handleLoginCommand(args);
    return;
  }

  if (command === 'auth') {
    await handleAuthCommand(args);
    return;
  }

  if (command === 'apps') {
    await handleAppsCommand(args);
    return;
  }

  if (command === 'content' || command === 'compound') {
    await handleContentCommand(args);
    return;
  }

  if (command === 'intelligence') {
    await handleIntelligenceCommand(args);
    return;
  }

  if (command === 'publishing') {
    await handlePublishingCommand(args);
    return;
  }

  if (command === 'run') {
    await handleRunCommand(args);
    return;
  }

  if (command === 'webhook') {
    await handleWebhookCommand(args);
    return;
  }

  if (command === 'mcp') {
    await handleMcpCommand(args);
    return;
  }

  if (command === 'runs') {
    await handleExecutionsCommand(args);
    return;
  }

  if (command === 'executions') {
    await handleExecutionsCommand(args);
    return;
  }

  throw new Error(`Unknown command "${command}".`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
