/**
 * Structured error model for the Lamina CLI.
 *
 * Conventions, modeled on `gh`, `vercel`, `stripe`:
 *   - Exit 0  → success
 *   - Exit 1  → runtime error (auth failed, network down, server error, etc.)
 *   - Exit 2  → invalid CLI usage (bad flag, missing arg, malformed input)
 *
 * Every CLI-thrown error should be a `LaminaCliError` with:
 *   - a short summary line (the `message`)
 *   - an actionable `suggestion` line (what the user should try next)
 *   - an optional `docsUrl` for the relevant guide
 *   - an `exitCode` (1 or 2)
 *   - an internal `code` for programmatic categorisation
 */

export const EXIT = {
  SUCCESS: 0,
  RUNTIME_ERROR: 1,
  INVALID_USAGE: 2,
} as const;

export type LaminaCliErrorCode =
  | 'auth_invalid_key'
  | 'auth_not_logged_in'
  | 'invalid_argument'
  | 'network_unreachable'
  | 'not_found'
  | 'server_error'
  | 'unknown_subcommand'
  | 'unknown';

export interface LaminaCliErrorOptions {
  message: string;
  code: LaminaCliErrorCode;
  exitCode?: 1 | 2;
  suggestion?: string;
  docsUrl?: string;
  cause?: unknown;
}

export class LaminaCliError extends Error {
  readonly code: LaminaCliErrorCode;
  readonly exitCode: 1 | 2;
  readonly suggestion?: string;
  readonly docsUrl?: string;

  constructor(options: LaminaCliErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'LaminaCliError';
    this.code = options.code;
    this.exitCode = options.exitCode ?? EXIT.RUNTIME_ERROR;
    this.suggestion = options.suggestion;
    this.docsUrl = options.docsUrl;
  }
}

/**
 * Convert any thrown value into a structured CLI error.
 *
 * Best-effort classification of errors that bubble up from `fetch`, the SDK,
 * or wrapped server responses. Anything we can't classify ends up as a
 * generic `unknown` runtime error so we never lose the underlying message.
 */
export function classifyError(err: unknown): LaminaCliError {
  if (err instanceof LaminaCliError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Network: fetch-failed, DNS, connection refused, timeout
  if (
    lower.includes('fetch failed') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('network')
  ) {
    return new LaminaCliError({
      code: 'network_unreachable',
      message: `Could not reach the Lamina API: ${message}`,
      suggestion:
        'Check your network connection. If you set LAMINA_BASE_URL, confirm it points at a reachable host. The default origin is https://app.uselamina.ai.',
      cause: err,
    });
  }

  // 404 / not-found
  if (lower.includes('not found') || lower.includes('404')) {
    return new LaminaCliError({
      code: 'not_found',
      message,
      suggestion: 'Double-check the ID. Use `lamina apps list` to see available app IDs.',
      cause: err,
    });
  }

  // Auth: 401-style messages or bare "Invalid API key"
  if (
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return new LaminaCliError({
      code: 'auth_invalid_key',
      message: 'Lamina rejected the API key.',
      suggestion:
        'Generate a new key at https://app.uselamina.ai/settings?tab=api, or run `lamina login` to re-authenticate.',
      cause: err,
    });
  }

  return new LaminaCliError({
    code: 'unknown',
    message,
    cause: err,
  });
}

/**
 * Print an error to stderr in the conventional form:
 *   Error: <message>
 *   <suggestion line>
 *   See: <docsUrl>
 */
export function printCliError(err: LaminaCliError): void {
  process.stderr.write(`Error: ${err.message}\n`);
  if (err.suggestion) {
    process.stderr.write(`${err.suggestion}\n`);
  }
  if (err.docsUrl) {
    process.stderr.write(`See: ${err.docsUrl}\n`);
  }
}
