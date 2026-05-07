/**
 * OAuth 2.1 Authorization Code + PKCE flow with loopback redirect.
 *
 * Same pattern as `gh auth login --web`, `supabase login`, `vercel login`,
 * `firebase login`: the CLI binds an ephemeral localhost port, registers
 * itself as a public OAuth client (RFC 7591 dynamic client registration),
 * opens the user's browser to the authorization endpoint, and waits for
 * the redirect back with a code. Code is then exchanged at the token
 * endpoint for an access token + refresh token.
 *
 * Server endpoints (in react-flow-integration/server/routers/cliOAuthRouter.ts):
 *   POST /cli/oauth/register   — RFC 7591 DCR
 *   GET  /cli/oauth/authorize  — redirects to /oauth/consent UI
 *   POST /cli/oauth/token      — code → tokens
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { LaminaCliError, EXIT } from './errors.js';
import { openBrowser } from './openBrowser.js';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  clientId: string;
  baseUrl: string;
}

export interface RunOAuthFlowOptions {
  baseUrl: string;
  scopes?: string[];
  /** Suppress browser auto-open (SSH / containers / `--no-browser` flag). */
  noBrowser?: boolean;
  /** Override stdout writer for tests. */
  out?: (text: string) => void;
}

const DEFAULT_SCOPES = [
  'lamina:creative:read',
  'lamina:creative:write',
  'lamina:brand:read',
];

const CALLBACK_PATH = '/callback';

// Same TTL the auth code has server-side, so we don't out-wait the code.
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE verifier: 43-128 chars, URL-safe. We use 64 random bytes → 86 chars. */
function generatePkceVerifier(): string {
  return base64UrlEncode(randomBytes(64));
}

function pkceChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

interface CallbackResult {
  code: string;
  state: string;
}

function bindLoopback(host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

function awaitCallback(server: Server, expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new LaminaCliError({
          code: 'auth_timeout',
          exitCode: EXIT.RUNTIME_ERROR,
          message: 'Authorization timed out — no callback received within 10 minutes.',
          suggestion: 'Re-run `lamina login`.',
        })
      );
    }, FLOW_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (error) {
        respondWithPage(res, 'failure', errorDescription || error);
        settle(() =>
          reject(
            new LaminaCliError({
              code: 'auth_denied',
              exitCode: EXIT.RUNTIME_ERROR,
              message: errorDescription || `Authorization failed: ${error}`,
            })
          )
        );
        return;
      }

      if (!code || !state) {
        respondWithPage(res, 'failure', 'Missing code or state in callback.');
        settle(() =>
          reject(
            new LaminaCliError({
              code: 'auth_invalid_callback',
              exitCode: EXIT.RUNTIME_ERROR,
              message: 'Authorization callback was missing code or state.',
            })
          )
        );
        return;
      }

      if (state !== expectedState) {
        respondWithPage(res, 'failure', 'State mismatch — possible CSRF.');
        settle(() =>
          reject(
            new LaminaCliError({
              code: 'auth_state_mismatch',
              exitCode: EXIT.RUNTIME_ERROR,
              message: 'OAuth state mismatch; aborting for safety.',
            })
          )
        );
        return;
      }

      respondWithPage(res, 'success');
      settle(() => resolve({ code, state }));
    });
  });
}

function respondWithPage(res: ServerResponse, kind: 'success' | 'failure', message?: string) {
  const title = kind === 'success' ? 'Logged in to Lamina' : 'Lamina login failed';
  const body =
    kind === 'success'
      ? 'You can close this tab and return to your terminal.'
      : `${message || 'Login failed.'} You can close this tab and re-run \`lamina login\`.`;
  const accent = kind === 'success' ? '#f8d57e' : '#ff9b8f';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f1a17; color: #f8f1df; margin: 0;
    min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card { max-width: 420px; padding: 32px; border-radius: 24px;
    border: 1px solid rgba(248, 241, 223, 0.18); background: rgba(15, 26, 23, 0.92); }
  .eyebrow { color: ${accent}; letter-spacing: 1.4px; text-transform: uppercase;
    font-size: 12px; margin: 0 0 12px; }
  h1 { margin: 0 0 12px; font-size: 28px; }
  p { margin: 0; color: #d9cdb4; line-height: 1.55; }
</style>
</head>
<body>
<div class="card">
  <p class="eyebrow">Lamina</p>
  <h1>${title}</h1>
  <p>${body}</p>
</div>
</body>
</html>`);
}

interface DcrResult {
  client_id: string;
}

async function registerClient(baseUrl: string, redirectUri: string): Promise<DcrResult> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/cli/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Lamina CLI',
      client_uri: 'https://github.com/uselamina/lamina-cli',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LaminaCliError({
      code: 'auth_dcr_failed',
      exitCode: EXIT.RUNTIME_ERROR,
      message: `Could not register CLI as an OAuth client (HTTP ${res.status}).`,
      suggestion: text.slice(0, 200) || 'Check that the server is reachable at ' + baseUrl,
    });
  }
  return (await res.json()) as DcrResult;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
}

async function exchangeCode({
  baseUrl,
  clientId,
  redirectUri,
  code,
  codeVerifier,
}: {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/cli/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !payload.access_token) {
    throw new LaminaCliError({
      code: 'auth_token_exchange_failed',
      exitCode: EXIT.RUNTIME_ERROR,
      message:
        payload.error_description ||
        payload.error ||
        `Token exchange failed (HTTP ${res.status}).`,
    });
  }
  return payload as TokenResponse;
}

/**
 * Run the full OAuth flow. Returns tokens on success, throws LaminaCliError
 * on cancellation/failure. Caller is responsible for persisting tokens.
 */
export async function runOAuthFlow(options: RunOAuthFlowOptions): Promise<OAuthTokens> {
  const out = options.out || ((s: string) => process.stdout.write(s));
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const scopes = options.scopes && options.scopes.length > 0 ? options.scopes : DEFAULT_SCOPES;

  // 1. Bind a loopback port — its randomness is the redirect_uri uniqueness
  //    that lets us register a fresh OAuth client without colliding with
  //    a previous CLI session.
  const { server, port } = await bindLoopback();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    // 2. PKCE + state.
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = pkceChallenge(codeVerifier);
    const state = generateState();

    // 3. Register CLI as a public OAuth client for THIS redirect_uri.
    const { client_id: clientId } = await registerClient(baseUrl, redirectUri);

    // 4. Open the browser to the authorize endpoint.
    const authorizeUrl = new URL(`${baseUrl}/cli/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', scopes.join(' '));

    const url = authorizeUrl.toString();
    out(`Opening ${baseUrl} in your browser to authorize this CLI...\n`);

    if (!options.noBrowser) {
      const result = await openBrowser(url);
      if (!result.launched) {
        out(`(Couldn't open the browser automatically.)\n`);
        out(`If a browser doesn't open, paste this URL:\n  ${url}\n\n`);
      } else {
        out(`If a browser doesn't open, paste this URL:\n  ${url}\n\n`);
      }
    } else {
      out(`Open this URL to continue:\n  ${url}\n\n`);
    }
    out(`Waiting for authorization...\n`);

    // 5. Wait for /callback?code=&state= on our loopback server.
    const { code } = await awaitCallback(server, state);

    // 6. Exchange code → tokens.
    const tokens = await exchangeCode({
      baseUrl,
      clientId,
      redirectUri,
      code,
      codeVerifier,
    });

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scope: tokens.scope,
      clientId,
      baseUrl,
    };
  } finally {
    // Always release the port — including on cancellation.
    server.close();
  }
}
