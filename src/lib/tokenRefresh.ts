/**
 * OAuth refresh-token rotation for stored CLI credentials.
 *
 * Pattern follows `gh`, `supabase`, `vercel`: when the access token is
 * about to expire, swap it transparently using the stored refresh token.
 * The user never re-prompts unless the refresh ALSO fails (revoked,
 * >30 days old, server lost grant), at which point we surface a clear
 * "session expired" error pointing at `lamina login`.
 *
 * Currently preemptive only (refresh BEFORE the request when expiresAt
 * is within the skew window). Adding a reactive 401-retry path is a
 * small follow-up; preemptive handles the common case where the CLI is
 * idle for an hour and the user comes back to a stale token.
 */
import type { StoredLaminaCredentials } from '@uselamina/sdk';
import { writeStoredCredentials } from '@uselamina/sdk/storage';

import { EXIT, LaminaCliError } from './errors.js';

/** Refresh when the access token is within this many ms of expiring. */
const REFRESH_SKEW_MS = 60_000;

interface ServerTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
}

async function postRefresh(
  creds: StoredLaminaCredentials
): Promise<StoredLaminaCredentials> {
  if (creds.kind !== 'oauth' || !creds.refreshToken || !creds.clientId) {
    throw new LaminaCliError({
      code: 'auth_not_logged_in',
      exitCode: EXIT.RUNTIME_ERROR,
      message: 'Stored credentials are not refreshable.',
      suggestion: 'Run `lamina login` to authenticate.',
    });
  }

  const baseUrl = creds.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${baseUrl}/cli/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as Partial<ServerTokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !payload.access_token || !payload.refresh_token) {
    throw new LaminaCliError({
      code: 'auth_not_logged_in',
      exitCode: EXIT.RUNTIME_ERROR,
      message: 'Session expired and could not be refreshed.',
      suggestion: 'Run `lamina login` to authenticate again.',
      cause: payload.error_description || payload.error,
    });
  }

  const refreshed: StoredLaminaCredentials = {
    ...creds,
    apiKey: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString(),
    scope: payload.scope || creds.scope,
    savedAt: new Date().toISOString(),
  };

  await writeStoredCredentials(refreshed);
  return refreshed;
}

/**
 * Return credentials, refreshed in place if they're OAuth and near
 * expiry. API-key credentials and tokens with plenty of life remaining
 * are returned as-is.
 */
export async function refreshIfNeeded(
  creds: StoredLaminaCredentials
): Promise<StoredLaminaCredentials> {
  if (creds.kind !== 'oauth' || !creds.expiresAt) return creds;
  const expiresMs = Date.parse(creds.expiresAt);
  if (Number.isNaN(expiresMs)) return creds;
  if (expiresMs - Date.now() > REFRESH_SKEW_MS) return creds;
  return postRefresh(creds);
}
