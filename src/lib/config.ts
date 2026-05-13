import {
  DEFAULT_BASE_URL,
  LaminaClient,
  normalizeBaseUrl,
  resolveApiKey,
  type LaminaClientOptions,
  type StoredLaminaCredentials,
  type StoredWebhookConfig,
} from '@uselamina/sdk';
import { readStoredCredentials, readStoredWebhookConfig } from '@uselamina/sdk/storage';

import { EXIT, LaminaCliError } from './errors.js';
import { refreshIfNeeded } from './tokenRefresh.js';

export type AuthSource = 'explicit' | 'env' | 'stored';

export interface ResolvedAuthContext {
  apiKey: string;
  baseUrl: string;
  source: AuthSource;
  storedCredentials: StoredLaminaCredentials | null;
}

/**
 * Strict resolver: returns the saved-default URL, or throws.
 *
 * Used by older callsites that explicitly asked for `--webhook default`
 * (or `local`). For dispatch commands prefer `resolveWebhookForDispatch`,
 * which implements the full implicit-default + override + opt-out matrix.
 */
export async function resolveStoredWebhookUrl(
  override?: string | null
): Promise<{ webhookUrl: string; config: StoredWebhookConfig | null }> {
  const trimmedOverride = override?.trim();
  if (trimmedOverride && trimmedOverride !== 'default' && trimmedOverride !== 'local') {
    return { webhookUrl: trimmedOverride, config: null };
  }

  const stored = await readStoredWebhookConfig();
  const savedUrl = stored?.publicUrl?.trim();
  if (savedUrl) {
    return { webhookUrl: savedUrl, config: stored };
  }

  throw new Error(
    'No default Lamina webhook URL is saved. Run `lamina webhook listen --public-url <url> --save-default` or pass --webhook https://... explicitly.'
  );
}

export type WebhookResolution =
  | { webhookUrl: string; source: 'explicit' | 'stored' }
  | { webhookUrl: null; source: 'opt_out' | 'none' };

/**
 * Mature webhook resolver for dispatch commands (`lamina run`).
 *
 * Precedence (most specific wins):
 *   1. `--no-webhook`               → opt out for this call (returns null)
 *   2. `--webhook none`             → same as --no-webhook
 *   3. `--webhook <url>`            → use this URL exactly (overrides stored)
 *   4. `--webhook default|local`    → use stored default; throw if not saved
 *   5. No flag, but stored default  → use stored implicitly (transparent)
 *   6. No flag, no stored           → no webhook (null), no error
 *
 * Rule (5) is the convenience: save once with `lamina webhook listen
 * --public-url <url> --save-default`, then every `lamina run` auto-attaches
 * the webhook. Users override per-call with --webhook <url> or opt out with
 * --no-webhook. The dispatch path surfaces which source resolved so the
 * CLI can tell the human "webhook (default): https://…".
 */
export async function resolveWebhookForDispatch(opts: {
  explicit?: string | null;
  optOut?: boolean;
}): Promise<WebhookResolution> {
  if (opts.optOut) return { webhookUrl: null, source: 'opt_out' };

  const explicit = opts.explicit?.trim();

  if (explicit === 'none') return { webhookUrl: null, source: 'opt_out' };

  if (explicit && explicit !== 'default' && explicit !== 'local') {
    return { webhookUrl: explicit, source: 'explicit' };
  }

  const stored = await readStoredWebhookConfig();
  const savedUrl = stored?.publicUrl?.trim();
  if (savedUrl) {
    return { webhookUrl: savedUrl, source: 'stored' };
  }

  if (explicit === 'default' || explicit === 'local') {
    throw new Error(
      'No default Lamina webhook URL is saved. Run `lamina webhook listen --public-url <url> --save-default` or pass --webhook https://... explicitly.'
    );
  }

  return { webhookUrl: null, source: 'none' };
}

/**
 * Resolve the API base URL with a consistent precedence across all auth
 * sources (explicit option > LAMINA_BASE_URL env > stored credential > built-in
 * default). Centralizing this avoids the foot-gun where one auth path honored
 * the env var and another silently didn't.
 */
function resolveBaseUrl(args: {
  optionBaseUrl?: string;
  env: NodeJS.ProcessEnv;
  storedBaseUrl?: string | null;
}): string {
  const candidate =
    args.optionBaseUrl ||
    args.env.LAMINA_BASE_URL ||
    args.storedBaseUrl ||
    DEFAULT_BASE_URL;
  return normalizeBaseUrl(candidate);
}

export async function resolveAuthContext(options: {
  apiKey?: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  storedCredentials?: StoredLaminaCredentials | null;
} = {}): Promise<ResolvedAuthContext> {
  const env = options.env || process.env;
  const explicitKey = options.apiKey?.trim();

  if (explicitKey) {
    return {
      apiKey: explicitKey,
      baseUrl: resolveBaseUrl({ optionBaseUrl: options.baseUrl, env }),
      source: 'explicit',
      storedCredentials: null,
    };
  }

  const envKey = resolveApiKey({ env });
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: resolveBaseUrl({ optionBaseUrl: options.baseUrl, env }),
      source: 'env',
      storedCredentials: null,
    };
  }

  const stored = options.storedCredentials ?? (await readStoredCredentials());
  if (stored) {
    // Preemptively refresh OAuth access tokens that are about to expire.
    // For API-key credentials this is a no-op; for OAuth, it rotates the
    // token and persists the new pair before any request goes out.
    const refreshed = await refreshIfNeeded(stored);
    return {
      apiKey: refreshed.apiKey,
      baseUrl: resolveBaseUrl({
        optionBaseUrl: options.baseUrl,
        env,
        storedBaseUrl: refreshed.baseUrl,
      }),
      source: 'stored',
      storedCredentials: refreshed,
    };
  }

  throw new LaminaCliError({
    code: 'auth_not_logged_in',
    exitCode: EXIT.RUNTIME_ERROR,
    message: 'Not logged in.',
    suggestion: 'Run `lamina login` to authenticate, or set LAMINA_API_KEY.',
  });
}

export async function createClientFromAuthContext(
  options: {
    apiKey?: string;
    baseUrl?: string;
    env?: NodeJS.ProcessEnv;
    storedCredentials?: StoredLaminaCredentials | null;
    fetch?: LaminaClientOptions['fetch'];
  } = {}
): Promise<{ client: LaminaClient; context: ResolvedAuthContext }> {
  const context = await resolveAuthContext(options);
  return {
    client: new LaminaClient({
      apiKey: context.apiKey,
      baseUrl: context.baseUrl,
      fetch: options.fetch,
    }),
    context,
  };
}
