import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import {
  printCompoundCreate,
  printContentBrief,
  printJson,
} from '../lib/output.js';

function printContentHelp(): void {
  process.stdout.write('Usage: lamina content <command>\n\n');
  process.stdout.write('Commands:\n');
  process.stdout.write('  create    Create content from a natural language brief\n');
  process.stdout.write('  score     Score workspace content against brand standards\n');
  process.stdout.write('  brief     Generate a structured content brief from a goal\n');
}

export async function handleContentCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printContentHelp();
    return;
  }

  if (subcommand === 'create') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        'brand-profile-id': { type: 'string' },
        'campaign-id': { type: 'string' },
        'app-id': { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: true,
    });

    const brief = parsed.positionals.join(' ');
    if (!brief) {
      throw new Error(
        'Missing brief. Use `lamina content create "Instagram carousel for spring collection" --platform instagram`.'
      );
    }

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

    const response = await client.content.create({
      brief,
      platform: parsed.values.platform,
      modality: parsed.values.modality,
      brandProfileId: parsed.values['brand-profile-id'],
      campaignId: parsed.values['campaign-id'],
      appId: parsed.values['app-id'],
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printCompoundCreate(response.data);
    }
    return;
  }

  if (subcommand === 'score') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        limit: { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: false,
    });

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

    const response = await client.content.score({
      platform: parsed.values.platform,
      modality: parsed.values.modality,
      limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      process.stdout.write(`${JSON.stringify(response.data, null, 2)}\n`);
    }
    return;
  }

  if (subcommand === 'brief') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        count: { type: 'string' },
        'brand-profile-id': { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: true,
    });

    const goal = parsed.positionals.join(' ');
    if (!goal) {
      throw new Error(
        'Missing goal. Use `lamina content brief "increase Instagram engagement this week" --platform instagram`.'
      );
    }

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

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
    return;
  }

  throw new Error(
    'Unknown content command. Use `lamina content create`, `score`, or `brief`.'
  );
}
