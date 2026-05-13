import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';

import { EXIT, LaminaCliError } from './errors.js';

/**
 * Save terminal-completed run outputs to disk via a path template.
 *
 * Convention follows `genmedia run --download` / `gh release download` /
 * Stripe CLI artifact templates: explicit template with `{var}`
 * placeholders, auto-create parent dirs, return per-output local paths
 * so callers can surface them in JSON envelopes.
 *
 * Supported placeholders in `template`:
 *   {runId}  — the run UUID
 *   {index}  — 0-based output index (REQUIRED when there are 2+ outputs
 *              to prevent collisions)
 *   {ext}    — file extension inferred from URL pathname or `Content-Type`
 *   {label}  — slugified output label (apps surface meaningful labels;
 *              recipes use the variant `styleHint`). Falls back to "output".
 *
 * Example: `--download "./out/{runId}_{index}.{ext}"`.
 *
 * Failed / non-image-url outputs are skipped silently; the caller's
 * non-JSON renderer can flag them. The return value is just the list
 * of downloads that actually completed.
 */
export interface RunOutput {
  id?: string;
  label?: string | null;
  type?: string | null;
  value?: unknown; // SDK type — only string URLs are downloadable; runtime-checked.
  status?: string | null;
  mimeType?: string | null;
}

export interface DownloadedFile {
  outputIndex: number;
  sourceUrl: string;
  localPath: string;
  bytes: number;
}

export async function downloadOutputs({
  runId,
  outputs,
  template,
}: {
  runId: string;
  outputs: RunOutput[];
  template: string;
}): Promise<DownloadedFile[]> {
  if (!template || typeof template !== 'string') {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--download requires a path template.',
      suggestion: 'Example: --download "./out/{runId}_{index}.{ext}"',
    });
  }

  // Output URL list (one per completed terminal output with a value).
  const ready = outputs
    .map((out, i) => ({ out, i }))
    .filter(
      ({ out }) =>
        out &&
        typeof out.value === 'string' &&
        out.value.length > 0 &&
        (out.status === 'completed' || out.status == null),
    );

  if (ready.length === 0) return [];

  // Collision check: when there are 2+ outputs, the template MUST include
  // {index} (or {label} which is per-output) — otherwise every output
  // writes to the same path and only the last survives.
  if (
    ready.length > 1 &&
    !template.includes('{index}') &&
    !template.includes('{label}')
  ) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: `--download template must include {index} or {label} when the run has ${ready.length} outputs.`,
      suggestion: 'Example: --download "./out/{runId}_{index}.{ext}"',
    });
  }

  const downloaded: DownloadedFile[] = [];
  for (const { out, i } of ready) {
    const url = out.value as string;

    const ext = await inferExtension(url, out.mimeType ?? null);
    const label = slugifyLabel(out.label || out.id || 'output');

    const localPath = template
      .replaceAll('{runId}', runId)
      .replaceAll('{index}', String(i))
      .replaceAll('{ext}', ext || 'bin')
      .replaceAll('{label}', label);

    await mkdir(dirname(localPath), { recursive: true });

    const res = await fetch(url);
    if (!res.ok) {
      throw new LaminaCliError({
        code: 'server_error',
        exitCode: EXIT.RUNTIME_ERROR,
        message: `Failed to download outputs[${i}] from ${url}: HTTP ${res.status}`,
      });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(localPath, buf);

    downloaded.push({
      outputIndex: i,
      sourceUrl: url,
      localPath,
      bytes: buf.byteLength,
    });
  }

  return downloaded;
}

/**
 * Infer a file extension for `{ext}`.
 *
 * Order: URL pathname extension → fetch HEAD content-type → "bin".
 * Caller passes a hint via the output's mimeType when the SDK surfaces it,
 * which short-circuits the network probe.
 */
async function inferExtension(url: string, mimeHint: string | null): Promise<string> {
  try {
    const u = new URL(url);
    const fromPath = extname(u.pathname).replace(/^\./, '');
    if (fromPath) return fromPath.toLowerCase();
  } catch {
    // not a URL we can parse; fall through to mime-type probe
  }

  const mime = mimeHint || (await probeContentType(url));
  return mimeToExt(mime) || 'bin';
}

async function probeContentType(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.headers.get('content-type');
  } catch {
    return null;
  }
}

function mimeToExt(mime: string | null): string | null {
  if (!mime) return null;
  const t = mime.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'application/json': 'json',
    'text/plain': 'txt',
  };
  return map[t] || null;
}

function slugifyLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'output';
}
