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
  | 'auth_timeout'
  | 'auth_denied'
  | 'auth_invalid_callback'
  | 'auth_state_mismatch'
  | 'auth_dcr_failed'
  | 'auth_token_exchange_failed'
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
  /**
   * Structured server-side details for the error (e.g. validation error
   * field list). Surfaced in --json output so coding agents can read each
   * `errors[].field` and self-correct on retry without re-parsing the
   * human-readable message.
   */
  details?: unknown;
}

export class LaminaCliError extends Error {
  readonly code: LaminaCliErrorCode;
  readonly exitCode: 1 | 2;
  readonly suggestion?: string;
  readonly docsUrl?: string;
  readonly details?: unknown;

  constructor(options: LaminaCliErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'LaminaCliError';
    this.code = options.code;
    this.exitCode = options.exitCode ?? EXIT.RUNTIME_ERROR;
    this.suggestion = options.suggestion;
    this.docsUrl = options.docsUrl;
    this.details = options.details;
  }
}

/**
 * Convert any thrown value into a structured CLI error.
 *
 * Best-effort classification of errors that bubble up from `fetch`, the SDK,
 * or wrapped server responses. Anything we can't classify ends up as a
 * generic `unknown` runtime error so we never lose the underlying message.
 */
/**
 * Extract structured server-side `details` from an SDK error if present.
 * The /v1 API wraps validation errors as:
 *   body: { error, code: 'VALIDATION_ERROR', details: { code, message, details: {errors:[...]} } }
 * We surface the inner envelope so agents can read field-level errors.
 */
function extractServerDetails(err: unknown): unknown {
  if (!err || typeof err !== 'object') return undefined;
  const body = (err as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return undefined;
  const details = (body as { details?: unknown }).details;
  return details;
}

export function classifyError(err: unknown): LaminaCliError {
  if (err instanceof LaminaCliError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const details = extractServerDetails(err);

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
    suggestion:
      details
        ? 'See `details.errors` for the field-level validation errors. Each entry has `field`, `error`, and (when applicable) `allowed` / `range` / `got` — use these to fix your params and retry.'
        : 'If this looks like a CLI bug, run `lamina docs "<topic>"` for guidance, or update the CLI: `npm install -g @uselamina/cli@latest`.',
    details,
    cause: err,
  });
}

/**
 * Print an error to stderr.
 *
 * Format depends on output mode (set via `--json` flag, see `outputMode.ts`):
 *
 * - **Text mode** (default): conventional human-readable form:
 *     Error: <message>
 *     <suggestion line>
 *     See: <docsUrl>
 *
 * - **JSON mode** (`--json` was passed): single-line JSON envelope:
 *     {"error":"...","code":"...","hint":"...","exitCode":1}
 *
 * JSON mode lets agents that pipe stdout to a parser also pipe stderr to
 * the same parser without switching formats based on success/failure.
 */
import { isJsonMode } from './outputMode.js';

export function printCliError(err: LaminaCliError): void {
  if (isJsonMode()) {
    const payload: Record<string, unknown> = {
      error: err.message,
      code: err.code,
      exitCode: err.exitCode,
    };
    if (err.suggestion) payload.hint = err.suggestion;
    if (err.docsUrl) payload.docsUrl = err.docsUrl;
    if (err.details !== undefined) payload.details = err.details;
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stderr.write(`Error: ${err.message}\n`);
  if (err.suggestion) {
    process.stderr.write(`${err.suggestion}\n`);
  }
  // Surface field-level validation errors in text mode too — agents using
  // text mode (or humans inspecting CLI output) need them to self-correct.
  if (err.details && typeof err.details === 'object') {
    const d = err.details as { details?: { errors?: Array<Record<string, unknown>> } };
    const fieldErrors = d.details?.errors;
    if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
      process.stderr.write(`Field errors:\n`);
      for (const fe of fieldErrors) {
        const field = fe.field || '?';
        const code = fe.error || '?';
        const msg = fe.message ? ` — ${fe.message}` : '';
        const extra: string[] = [];
        if (fe.allowed) extra.push(`allowed=${JSON.stringify(fe.allowed)}`);
        if (fe.range) extra.push(`range=${JSON.stringify(fe.range)}`);
        if (fe.got !== undefined) extra.push(`got=${JSON.stringify(fe.got)}`);
        const tail = extra.length ? `  [${extra.join(' ')}]` : '';
        process.stderr.write(`  • ${field}: ${code}${msg}${tail}\n`);
      }
    }
  }
  if (err.docsUrl) {
    process.stderr.write(`See: ${err.docsUrl}\n`);
  }
}
