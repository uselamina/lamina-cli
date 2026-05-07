import { parseArgs } from 'node:util';

import { LaminaWebhookListener, type LaminaWebhookListenerEvent } from '@uselamina/sdk';
import {
  clearStoredWebhookConfig,
  readStoredWebhookConfig,
  writeStoredWebhookConfig,
} from '@uselamina/sdk/storage';

import { createClientFromAuthContext } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  printJson,
  printListenerStartup,
  printSigningKeys,
  printWebhookEvent,
  printWebhookStatus,
} from '../lib/output.js';

const GROUP_HELP = `Usage: lamina webhook <subcommand>

Run a local listener for Lamina webhook deliveries, or inspect the active
signing keys.

Subcommands:
  listen              Run a local HTTP listener that verifies and prints
                      incoming webhooks. (Alias: serve)
  signing-key         Show the public signing keys this workspace uses to
                      sign webhooks.
  status              Show the saved default forwarding URL.
  clear               Clear the saved default forwarding URL.

Run \`lamina webhook <subcommand> --help\` for subcommand options.
`;

const LISTEN_HELP = `Usage: lamina webhook listen [options]

Run a local HTTP listener that receives webhook deliveries from Lamina,
verifies their signature against the workspace public key, and prints each
event to the console — modelled on \`stripe listen\`.

Options:
  --host <addr>        Bind address. Default 127.0.0.1.
  --port <n>           Port. Default 8788.
  --path <path>        URL path the listener accepts on. Default /lamina/webhook.
  --public-url <url>   The publicly reachable URL pointing at this listener
                       (e.g. an ngrok / cloudflared tunnel). When set, this is
                       what \`lamina run --webhook ...\` should be told.
  --save-default       Persist the public URL as the default for
                       \`lamina run --webhook default\`. Requires --public-url.
  --once               Exit after the first delivery (useful for scripts).
  --json               Emit each delivery as raw JSON instead of a log line.
  --help, -h           Show this help.

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials.
`;

const SIGNING_KEY_HELP = `Usage: lamina webhook signing-key [options]

Print the public signing keys this workspace uses to sign webhooks. Webhooks
are signed with Ed25519, so these are public — paste them into your
verification code or pin them as JWKS.

Options:
  --json               Emit the raw API envelope (full JWK).
  --help, -h           Show this help.
`;

const STATUS_HELP = `Usage: lamina webhook status

Show the saved default forwarding URL — the URL that
\`lamina run --webhook default\` resolves to.

Options:
  --help, -h           Show this help.
`;

const CLEAR_HELP = `Usage: lamina webhook clear

Clear the saved default forwarding URL. After this, \`lamina run --webhook default\`
will fail until you save a new default with \`lamina webhook listen --public-url ... --save-default\`.

Options:
  --help, -h           Show this help.
`;

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

  if (subcommand === 'signing-key') {
    return handleSigningKey(args.slice(1));
  }
  if (subcommand === 'status') {
    return handleStatus(args.slice(1));
  }
  if (subcommand === 'clear') {
    return handleClear(args.slice(1));
  }
  // `serve` is kept as a hidden alias for `listen` for one release so existing
  // scripts keep working. The proposed-and-approved primary name is `listen`,
  // matching `stripe listen` / `svix listen` muscle memory.
  if (subcommand === 'listen' || subcommand === 'serve') {
    return handleListen(args.slice(1));
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina webhook ${subcommand}".`,
    suggestion: 'Run `lamina webhook --help` for valid subcommands.',
  });
}

async function handleSigningKey(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(SIGNING_KEY_HELP);
    return;
  }

  const parsed = parseArgs({
    args,
    options: {
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(SIGNING_KEY_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();
  const response = await client.webhooks.signingKey();

  if (parsed.values.json) {
    printJson(response);
    return;
  }

  printSigningKeys(response);
}

async function handleStatus(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(STATUS_HELP);
    return;
  }

  const stored = await readStoredWebhookConfig();
  if (!stored) {
    process.stdout.write('No default forwarding URL saved.\n');
    process.stdout.write(
      'Save one with `lamina webhook listen --public-url https://... --save-default`.\n'
    );
    return;
  }

  printWebhookStatus(stored);
}

async function handleClear(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(CLEAR_HELP);
    return;
  }

  await clearStoredWebhookConfig();
  process.stdout.write('Cleared saved default forwarding URL.\n');
}

async function handleListen(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(LISTEN_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        host: { type: 'string' },
        port: { type: 'string' },
        path: { type: 'string' },
        'public-url': { type: 'string' },
        'save-default': { type: 'boolean' },
        once: { type: 'boolean' },
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
      suggestion: 'Run `lamina webhook listen --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(LISTEN_HELP);
    return;
  }

  const { client } = await createClientFromAuthContext();

  const host = parsed.values.host || '127.0.0.1';
  const port = parsed.values.port ? Number.parseInt(parsed.values.port, 10) : 8788;
  const path = parsed.values.path || '/lamina/webhook';
  const publicUrl = normalizePublicUrl(parsed.values['public-url'], path);

  if (parsed.values['save-default'] && !publicUrl) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--save-default requires --public-url.',
      suggestion:
        'Example: lamina webhook listen --public-url https://your-tunnel.example/lamina/webhook --save-default',
    });
  }

  // Pre-fetch the signing key so the startup banner can show its kid+alg the
  // same way `stripe listen` shows its signing secret. We tolerate failure
  // here — the listener still verifies inline; we just don't show a banner.
  let signingKid: string | null = null;
  let signingAlg: string | null = null;
  try {
    const keys = await client.webhooks.signingKey();
    const first = (keys.keys && keys.keys[0]) as Record<string, unknown> | undefined;
    if (first) {
      signingKid = typeof first.kid === 'string' ? first.kid : null;
      signingAlg =
        typeof first.alg === 'string'
          ? first.alg
          : typeof first.kty === 'string'
            ? first.kty
            : null;
    }
  } catch {
    // swallow — banner just hides the key row
  }

  const listener = new LaminaWebhookListener({
    client,
    host,
    port,
    path,
    publicUrl,
    onEvent: (event: LaminaWebhookListenerEvent) => {
      if (parsed.values.json) {
        printJson(event);
      } else {
        printWebhookEvent(event);
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
    printListenerStartup({
      localUrl: status.localUrl,
      publicUrl: status.publicUrl,
      signingKid,
      signingAlg,
      savedDefault: Boolean(parsed.values['save-default']),
    });
  }

  if (parsed.values.once) {
    await listener.waitForEvent();
    await listener.close();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let shuttingDown = false;

    const stop = async () => {
      if (shuttingDown) return;
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
}
