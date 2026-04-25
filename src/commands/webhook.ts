import { parseArgs } from 'node:util';

import {
  clearStoredWebhookConfig,
  LaminaWebhookListener,
  readStoredWebhookConfig,
  type LaminaWebhookListenerEvent,
  writeStoredWebhookConfig,
} from '@uselamina/sdk';

import { createClientFromAuthContext } from '../lib/config.js';
import { printJson, printWebhookStatus } from '../lib/output.js';

function normalizePublicUrl(publicUrl: string | undefined, path: string): string | null {
  if (!publicUrl) {
    return null;
  }

  const url = new URL(publicUrl);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = path;
  }
  return url.toString();
}

export async function handleWebhookCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'signing-key') {
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
    const response = await client.webhooks.signingKey();

    if (parsed.values.json) {
      printJson(response);
      return;
    }

    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  if (subcommand === 'status') {
    const stored = await readStoredWebhookConfig();
    if (!stored) {
      process.stdout.write('No default Lamina webhook URL is saved.\n');
      return;
    }

    printWebhookStatus(stored);
    return;
  }

  if (subcommand === 'clear') {
    await clearStoredWebhookConfig();
    process.stdout.write('Cleared stored Lamina webhook configuration\n');
    return;
  }

  if (subcommand === 'serve') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        host: { type: 'string' },
        port: { type: 'string' },
        path: { type: 'string' },
        'public-url': { type: 'string' },
        'save-default': { type: 'boolean' },
        once: { type: 'boolean' },
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

    const host = parsed.values.host || '127.0.0.1';
    const port = parsed.values.port ? Number.parseInt(parsed.values.port, 10) : 8788;
    const path = parsed.values.path || '/lamina/webhook';
    const publicUrl = normalizePublicUrl(parsed.values['public-url'], path);
    if (parsed.values['save-default'] && !publicUrl) {
      throw new Error('`lamina webhook serve --save-default` requires --public-url https://...');
    }

    const listener = new LaminaWebhookListener({
      client,
      host,
      port,
      path,
      publicUrl,
      onEvent: async (event: LaminaWebhookListenerEvent) => {
        if (parsed.values.json) {
          printJson(event);
        } else if (event.verified && event.payload) {
          process.stdout.write(
            `Verified webhook ${event.sequence} for run ${event.payload.data.runId} (${event.payload.data.status})\n`
          );
        } else {
          process.stdout.write(
            `Rejected webhook ${event.sequence}${event.error ? `: ${event.error}` : ''}\n`
          );
        }
      },
    });

    const status = await listener.start();

    if (parsed.values['save-default']) {
      await writeStoredWebhookConfig({
        publicUrl,
        host: status.host,
        port: status.port,
        path: status.path,
        savedAt: new Date().toISOString(),
      });
    }

    if (parsed.values.json) {
      printJson(status);
    } else {
      process.stdout.write(`Lamina webhook listener running on ${status.localUrl}\n`);
      if (status.publicUrl) {
        process.stdout.write(`Public webhook URL: ${status.publicUrl}\n`);
      } else {
        process.stdout.write(
          'No public webhook URL configured. Pass --public-url https://... if this listener is exposed through a tunnel or public host.\n'
        );
      }
      if (parsed.values['save-default']) {
        process.stdout.write('Saved this webhook configuration as the default for `--webhook default`\n');
      }
      process.stdout.write('Press Ctrl+C to stop the listener.\n');
    }

    if (parsed.values.once) {
      await listener.waitForEvent();
      await listener.close();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let shuttingDown = false;

      const stop = async () => {
        if (shuttingDown) {
          return;
        }

        shuttingDown = true;
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        try {
          await listener?.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      const onSigint = () => {
        void stop();
      };
      const onSigterm = () => {
        void stop();
      };

      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);
    });

    return;
  }

  throw new Error(
    'Unknown webhook command. Use `lamina webhook signing-key`, `status`, `clear`, or `serve`.'
  );
}
