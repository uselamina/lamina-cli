import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import {
  printBrandContext,
  printJson,
  printPrediction,
  printRecommendations,
  printTrends,
} from '../lib/output.js';

function printIntelligenceHelp(): void {
  process.stdout.write('Usage: lamina intelligence <command>\n\n');
  process.stdout.write('Commands:\n');
  process.stdout.write('  brand-context   Get brand DNA, guidance, and top patterns\n');
  process.stdout.write('  predict         Predict content performance before generating\n');
  process.stdout.write('  recommendations Get actionable content recommendations\n');
  process.stdout.write('  trends          Get current trend signals\n');
}

export async function handleIntelligenceCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printIntelligenceHelp();
    return;
  }

  if (subcommand === 'brand-context') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        'brand-profile-id': { type: 'string' },
        'campaign-id': { type: 'string' },
        'workflow-id': { type: 'string' },
        platform: { type: 'string' },
        objective: { type: 'string' },
        modality: { type: 'string' },
        'top-k': { type: 'string' },
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

    const response = await client.intelligence.getBrandContext({
      brandProfileId: parsed.values['brand-profile-id'],
      campaignId: parsed.values['campaign-id'],
      workflowId: parsed.values['workflow-id'],
      platform: parsed.values.platform,
      objective: parsed.values.objective,
      modality: parsed.values.modality,
      topK: parsed.values['top-k'] ? Number.parseInt(parsed.values['top-k'], 10) : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printBrandContext(response.data);
    }
    return;
  }

  if (subcommand === 'predict') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        platform: { type: 'string' },
        modality: { type: 'string' },
        'brand-profile-id': { type: 'string' },
        'campaign-id': { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: true,
    });

    const concept = parsed.positionals.join(' ');
    if (!concept) {
      throw new Error('Missing concept. Use `lamina intelligence predict "your concept" --platform instagram --modality image`.');
    }
    if (!parsed.values.platform) {
      throw new Error('Missing --platform flag.');
    }
    if (!parsed.values.modality) {
      throw new Error('Missing --modality flag.');
    }

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

    const response = await client.intelligence.predict({
      concept,
      platform: parsed.values.platform,
      modality: parsed.values.modality,
      brandProfileId: parsed.values['brand-profile-id'],
      campaignId: parsed.values['campaign-id'],
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printPrediction(response.data);
    }
    return;
  }

  if (subcommand === 'recommendations') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        'campaign-id': { type: 'string' },
        'workflow-id': { type: 'string' },
        'brand-profile-id': { type: 'string' },
        platform: { type: 'string' },
        objective: { type: 'string' },
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

    const response = await client.intelligence.recommendations({
      campaignId: parsed.values['campaign-id'],
      workflowId: parsed.values['workflow-id'],
      brandProfileId: parsed.values['brand-profile-id'],
      platform: parsed.values.platform,
      objective: parsed.values.objective,
      modality: parsed.values.modality,
      limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printRecommendations(response.data);
    }
    return;
  }

  if (subcommand === 'trends') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        category: { type: 'string' },
        platform: { type: 'string' },
        'window-days': { type: 'string' },
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

    const response = await client.intelligence.trends({
      category: parsed.values.category,
      platform: parsed.values.platform,
      windowDays: parsed.values['window-days']
        ? Number.parseInt(parsed.values['window-days'], 10)
        : undefined,
      limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printTrends(response.data);
    }
    return;
  }

  throw new Error(
    'Unknown intelligence command. Use `lamina intelligence brand-context`, `predict`, `recommendations`, or `trends`.'
  );
}
