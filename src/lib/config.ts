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

export type AuthSource = 'explicit' | 'env' | 'stored';

export interface ResolvedAuthContext {
  apiKey: string;
  baseUrl: string;
  source: AuthSource;
  storedCredentials: StoredLaminaCredentials | null;
}

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
    'No default Lamina webhook URL is saved. Run `lamina webhook serve --public-url <url> --save-default` or pass --webhook https://... explicitly.'
  );
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
      baseUrl: normalizeBaseUrl(options.baseUrl),
      source: 'explicit',
      storedCredentials: null,
    };
  }

  const envKey = resolveApiKey({ env });
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: normalizeBaseUrl(options.baseUrl || env.LAMINA_BASE_URL || DEFAULT_BASE_URL),
      source: 'env',
      storedCredentials: null,
    };
  }

  const storedCredentials = options.storedCredentials ?? (await readStoredCredentials());
  if (storedCredentials) {
    return {
      apiKey: storedCredentials.apiKey,
      baseUrl: normalizeBaseUrl(options.baseUrl || storedCredentials.baseUrl),
      source: 'stored',
      storedCredentials,
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
