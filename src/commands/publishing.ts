import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import {
  printChannels,
  printJson,
  printPublishResult,
  printPublishHistory,
  printTransferResult,
} from '../lib/output.js';

function printPublishingHelp(): void {
  process.stdout.write('Usage: lamina publishing <command>\n\n');
  process.stdout.write('Commands:\n');
  process.stdout.write('  channels        List connected social media accounts\n');
  process.stdout.write('  publish         Publish content to connected accounts\n');
  process.stdout.write('  transfer-asset  Transfer an asset URL to persistent CDN\n');
  process.stdout.write('  history         View publish history\n');
}

export async function handlePublishingCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printPublishingHelp();
    return;
  }

  if (subcommand === 'channels') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
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

    const response = await client.publishing.channels();

    if (parsed.values.json) {
      printJson(response);
    } else {
      printChannels(response.data);
    }
    return;
  }

  if (subcommand === 'publish') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        'account-id': { type: 'string', multiple: true },
        'image-url': { type: 'string' },
        'video-url': { type: 'string' },
        caption: { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: false,
    });

    const accountIds = parsed.values['account-id'];
    if (!accountIds || accountIds.length === 0) {
      throw new Error('At least one --account-id is required. Run `lamina publishing channels` to see available accounts.');
    }

    if (!parsed.values['image-url'] && !parsed.values['video-url'] && !parsed.values.caption) {
      throw new Error('Provide at least one of: --image-url, --video-url, --caption');
    }

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

    const response = await client.publishing.publish({
      accountIds,
      imageUrl: parsed.values['image-url'],
      videoUrl: parsed.values['video-url'],
      caption: parsed.values.caption,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printPublishResult(response.data);
    }
    return;
  }

  if (subcommand === 'transfer-asset') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        'media-type': { type: 'string' },
        filename: { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: true,
    });

    const sourceUrl = parsed.positionals[0];
    if (!sourceUrl) {
      throw new Error('Missing source URL. Use `lamina publishing transfer-asset <url> --media-type image`.');
    }

    const mediaType = parsed.values['media-type'] as 'image' | 'video' | 'audio' | undefined;
    if (!mediaType || !['image', 'video', 'audio'].includes(mediaType)) {
      throw new Error('--media-type is required (image, video, or audio).');
    }

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

    const response = await client.publishing.transferAsset({
      sourceUrl,
      mediaType,
      filename: parsed.values.filename,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printTransferResult(response.data);
    }
    return;
  }

  if (subcommand === 'history') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        status: { type: 'string' },
        platform: { type: 'string' },
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

    const response = await client.publishing.history({
      status: parsed.values.status,
      platform: parsed.values.platform,
      limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
    } else {
      printPublishHistory(response.data);
    }
    return;
  }

  throw new Error(
    'Unknown publishing command. Use `lamina publishing channels`, `publish`, `transfer-asset`, or `history`.'
  );
}
