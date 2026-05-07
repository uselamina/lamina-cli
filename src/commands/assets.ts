import { parseArgs } from 'node:util';
import { basename, extname } from 'node:path';
import { stat } from 'node:fs/promises';

import type { AssetMediaType } from '@uselamina/sdk';

import { createClientFromAuthContext } from '../lib/config.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import { printAssetUpload, printJson } from '../lib/output.js';

const GROUP_HELP = `Usage: lamina assets <subcommand>

Upload local files (images, videos, audio) to Lamina's asset CDN. The URL
returned can be passed as input to subsequent runs — e.g.
\`--input your_photo_image_url=<url>\`.

Bytes are streamed directly to the storage backend via a pre-signed URL —
they never go through Lamina's API server.

Subcommands:
  upload <path>      Upload a local file and print the asset URL.

Run \`lamina assets <subcommand> --help\` for subcommand options.
`;

const UPLOAD_HELP = `Usage: lamina assets upload <path> [options]

Upload a local file to Lamina's asset CDN. The bytes are streamed directly
to the storage backend; they do not pass through Lamina's API server.

The returned URL is stable and can be reused across multiple runs.

Options:
  --media-type <kind>   image | video | audio. Auto-detected from the file
                        extension when omitted (.png/.jpg/... → image,
                        .mp4/.mov/... → video, .mp3/.wav/... → audio).
  --filename <name>     Override the filename registered with the CDN.
                        Defaults to the basename of <path>.
  --json                Emit the raw API envelope (for piping to jq).
  --help, -h            Show this help.

Examples:
  lamina assets upload ./me.jpg
  lamina assets upload ./product-reel.mp4 --media-type video
  lamina assets upload ./jingle.mp3 --filename "intro-jingle.mp3"

  # Chain into a run via the shell:
  URL=$(lamina assets upload ./me.jpg --json | jq -r '.data.url')
  lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 \\
    --input your_photo_image_url="$URL" \\
    --input celebrity_text="Brad Pitt" --wait

Auth: reads LAMINA_API_KEY, then \`lamina login\` credentials. Override the
endpoint with LAMINA_BASE_URL (defaults to https://app.uselamina.ai).
`;

export async function handleAssetsCommand(args: string[]): Promise<void> {
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

  if (subcommand === 'upload') {
    return handleUpload(args.slice(1));
  }

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina assets ${subcommand}".`,
    suggestion: 'Run `lamina assets --help` for valid subcommands.',
  });
}

// ─── upload ─────────────────────────────────────────────────────────────────

const EXT_TO_MEDIA_TYPE: Record<string, AssetMediaType> = {
  // image
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.heic': 'image',
  '.heif': 'image',
  '.avif': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  // video
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.m4v': 'video',
  '.mkv': 'video',
  // audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
};

function detectMediaTypeFromExtension(path: string): AssetMediaType | null {
  const ext = extname(path).toLowerCase();
  return EXT_TO_MEDIA_TYPE[ext] ?? null;
}

async function handleUpload(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(UPLOAD_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        'media-type': { type: 'string' },
        filename: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: (err as Error).message,
      suggestion: 'Run `lamina assets upload --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(UPLOAD_HELP);
    return;
  }

  const path = parsed.positionals[0];
  if (!path) {
    process.stdout.write(UPLOAD_HELP);
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing <path>.',
      suggestion: 'Example: lamina assets upload ./me.jpg',
    });
  }

  // Validate the file is readable + grab its size for the success output.
  let fileSize = 0;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `Not a regular file: ${path}`,
        suggestion: 'Pass the path to a single image, video, or audio file.',
      });
    }
    fileSize = info.size;
  } catch (err) {
    if (err instanceof LaminaCliError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `File not found: ${path}`,
      });
    }
    throw err;
  }

  // Resolve mediaType: explicit flag > extension auto-detect > error.
  let mediaType: AssetMediaType;
  const flagged = parsed.values['media-type'];
  if (flagged) {
    if (flagged !== 'image' && flagged !== 'video' && flagged !== 'audio') {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `--media-type must be one of: image, video, audio (got "${flagged}")`,
      });
    }
    mediaType = flagged;
  } else {
    const detected = detectMediaTypeFromExtension(path);
    if (!detected) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `Could not detect media type from "${extname(path) || '(no extension)'}".`,
        suggestion: 'Pass --media-type image|video|audio explicitly.',
      });
    }
    mediaType = detected;
  }

  const filename = (parsed.values.filename || basename(path)).trim();

  const { client } = await createClientFromAuthContext();

  const result = await client.assets.upload({
    source: { path },
    filename,
    mediaType,
  });

  if (parsed.values.json) {
    printJson({ data: { ...result, sizeBytes: fileSize } });
    return;
  }

  printAssetUpload({ ...result, sizeBytes: fileSize });
}
