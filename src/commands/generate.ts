import { parseArgs } from 'node:util';

import { readStoredWebhookConfig } from '@uselamina/sdk/storage';

import { createClientFromAuthContext } from '../lib/config.js';
import { downloadOutputs, type RunOutput } from '../lib/downloadOutputs.js';
import { EXIT, LaminaCliError } from '../lib/errors.js';
import {
  printGenerateImageResult,
  printJson,
} from '../lib/output.js';
import { isJsonMode } from '../lib/outputMode.js';

const GROUP_HELP = `Usage: lamina generate <subcommand>

Direct model dispatch. Two subcommands — \`image\` and \`video\` — cover
every generation operation. The model id is the discriminator:

  image    Every image dispatch:
             • text-to-image            (ideogram-v3, imagen-4.0-*, gemini-2.5-flash-image, …)
             • image-to-image / edit    (nano-banana-pro, gpt-image-2, seedream-4.5,
                                         bria-bg-remove, ideogram-character, flux-pro-kontext, …)
           Hybrid models flip to image-to-image automatically when params include
           a source image (\`imageUrls\` non-empty or \`imageUrl\`); otherwise they
           run text-to-image. Edit-only models always require a source.

  video    Every video dispatch:
             • text-to-video      (kling-*-text-to-video, wan-*-text-to-video, veo3-text-to-video, …)
             • image-to-video     (kling-*-image-to-video, seedance-*-image-to-video,
                                   wan-*-image-to-video, veo3-image-to-video, …)
             • video-to-video     (wan-video-to-video, kling-*-v2v-*)
             • motion-control     (kling-v26-motion-control, kling-v26-motion-control-pro)
             • reference-to-video / keyframe (Seedance, Kling reference variants, Veo3 keyframe)
           Each video model has one declared mode; pick the model that does what
           you want and provide the params its schema requires.

Run \`lamina generate <subcommand> --help\` for flags + worked examples.

When to use this vs \`lamina content create\`:
  • \`lamina generate\`        — caller knows the model and supplies its params.
                                 One model, one output. No LLM in the dispatch path.
  • \`lamina content create\`  — agentic router picks an app from a free-text
                                 brief. Falls back to \`unmatched\` when no app
                                 fits (caller can then use \`lamina generate\`).
`;

const IMAGE_HELP = `Usage: lamina generate image --model <id> [--prompt "<text>"] [options]

Direct image-model dispatch — every image operation in one command. Discover the
model with \`lamina models list --modality image\`, read its input contract
with \`lamina models describe <id>\`, then dispatch with this command.

The model id is the discriminator. Text-to-image, image-to-image (edit /
remix / background-swap / reframe), all share this one verb. Hybrid models
(nano-banana-pro, gpt-image-2, gemini-2.5-flash-image, seedream-4.5,
flux-2-flex, nano-banana-2, gpt-image-1, gpt-image-1.5) flip to image-to-
image automatically when \`params\` includes a source image (\`imageUrls\`
non-empty, or \`imageUrl\` for single-source models like flux-pro-kontext).
Edit-only models (bria-bg-remove, ideogram-character, ideogram-v3-remix /
reframe / replace-background, flux-pro-kontext, ideogram-character-remix)
always require a source.

Required:
  --model <id>          Model id (see \`lamina models list --modality image\`).

Optional (required for most models):
  --prompt "<text>"     Natural-language prompt (≤2000 chars). Some edit
                        models (bria-bg-remove, ideogram-v3-reframe) don't
                        accept a prompt — read the describe response.

Param overrides:
  --param key=value     Repeatable single-field overrides per the model's
                        paramSchema.
  --params '<json>'     Bulk JSON object. Merged AFTER --param flags, so JSON
                        wins on conflict.

Run lifecycle:
  --wait                Block until terminal.
  --timeout-ms <ms>     With --wait: default 240000 (4 min). Vertex-backed
                        models (Imagen 4, Gemini 2.5) complete in ~2s; fal-
                        backed models take 5–60s.
  --interval-ms <ms>    With --wait: polling cadence (default 5000).
  --download <path>     Save outputs (dir or template like "./out/{runId}.{ext}").
  --webhook <url>       HMAC-signed POST on completion (pass "default" for
                        the URL saved by \`lamina webhook listen --save-default\`).
  --json                Emit raw API envelope.
  --help, -h            Show this help.

Examples:
  # Text-to-image
  lamina generate image --model ideogram-v3 \\
    --prompt "vintage poster, text reads \\"NEW DROP\\""

  # Text-to-image with bulk params + sync download
  lamina generate image --model imagen-4.0-fast-generate-001 \\
    --prompt "a single ceramic teacup, soft morning light" \\
    --params '{"aspectRatio":"16:9"}' \\
    --wait --download ./out/

  # Image-to-image (edit / remix) — same verb, source image in params
  lamina generate image --model nano-banana-pro \\
    --prompt "watercolor style with brand palette" \\
    --params '{"imageUrls":["https://media.../source.png"]}' \\
    --wait --download ./out/

  # Background remove (edit-only, no prompt)
  lamina generate image --model bria-bg-remove \\
    --params '{"imageUrls":["https://media.../product.jpg"]}' \\
    --wait --download ./out/

  # Flux Pro Kontext (single-image edit)
  lamina generate image --model flux-pro-kontext \\
    --prompt "place the product on a marble pedestal" \\
    --params '{"imageUrl":"https://...","aspectRatio":"3:2"}' \\
    --wait --download ./out/
`;

const VIDEO_HELP = `Usage: lamina generate video --model <id> [--prompt "<text>"] [options]

Direct video-model dispatch — every video operation in one command. Discover the
model with \`lamina models list --modality video\`, read its input contract
with \`lamina models describe <id> --modality video\`, then dispatch.

The model id is the discriminator. Text-to-video, image-to-video, video-to-
video, motion-control, reference-to-video, keyframe — all share this one
verb. Each video model has a single declared mode; pick the model that
does what you want and supply the params its schema requires:

  text-to-video      kling-*-text-to-video, wan-*-text-to-video, seedance-*-t2v,
                     veo3-text-to-video, minimax-text-to-video
  image-to-video     *-image-to-video models; \`imageUrl\` in params (Seedance
                     uses \`startImageUrl\`; veo3-first-frame-to-video uses
                     \`firstFrameUrl\`)
  keyframe           veo3-keyframe-to-video; \`firstFrameUrl\` + \`lastFrameUrl\`
                     (model interpolates between them)
  motion-control     kling-v26-motion-control, kling-v26-motion-control-pro;
                     \`imageUrl\` (character) + \`videoUrl\` (motion reference)
  video-to-video     wan-video-to-video, kling-*-v2v-*; \`videoUrl\`
  reference-to-video kling-*-reference-to-video, seedance-*-reference-to-video,
                     wan-2.6-reference-to-video; \`referenceImageUrls\`

Required:
  --model <id>          Video model id.

Optional (required for most models):
  --prompt "<text>"     Natural-language description (≤2000 chars). Some
                        motion-control models accept it optionally.

Param overrides:
  --param key=value     Repeatable single-field overrides.
  --params '<json>'     Bulk JSON. Merged AFTER --param flags.

Run lifecycle:
  --wait                Block until terminal.
  --timeout-ms <ms>     With --wait: default 600000 (10 min). Vertex-backed
                        Veo3 variants complete in seconds; fal-backed video
                        models take 30s–5 min.
  --interval-ms <ms>    With --wait: polling cadence (default 5000).
  --download <path>     Save outputs (dir or template).
  --webhook <url>       HMAC-signed POST on completion ("default" → saved URL).
  --json                Emit raw API envelope.
  --help, -h            Show this help.

Examples:
  # Text-to-video
  lamina generate video --model kling-v25-text-to-video \\
    --prompt "macro shot of dew rolling down a leaf, golden hour" \\
    --params '{"duration":"10","aspectRatio":"9:16","cfgScale":0.7}'

  # Image-to-video — Minimax (single imageUrl)
  lamina generate video --model minimax-image-to-video \\
    --prompt "the subject smiles and slowly turns toward camera" \\
    --params '{"imageUrl":"https://example.com/portrait.jpg"}'

  # Image-to-video — Veo3 first-frame (sync, returns in seconds)
  lamina generate video --model veo3-first-frame-to-video \\
    --prompt "wind ripples through the grass" \\
    --params '{"firstFrameUrl":"https://...","duration":6}' \\
    --wait --download ./out/

  # Keyframe — Veo3 (first + last frame)
  lamina generate video --model veo3-keyframe-to-video \\
    --prompt "subject walks from window to door" \\
    --params '{"firstFrameUrl":"https://.../w.jpg","lastFrameUrl":"https://.../d.jpg","duration":8}' \\
    --wait --download ./out/

  # Motion-control — character + reference video
  lamina generate video --model kling-v26-motion-control \\
    --params '{"imageUrl":"https://.../character.png","videoUrl":"https://.../dance.mp4"}' \\
    --wait --timeout-ms 300000 --download ./out/

  # Video-to-video (edit)
  lamina generate video --model wan-video-to-video \\
    --prompt "cinematic teal-and-orange grade, slow-motion feel" \\
    --params '{"videoUrl":"https://.../source.mp4"}' \\
    --wait --timeout-ms 300000 --download ./out/
`;

export async function handleGenerateCommand(args: string[]): Promise<void> {
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

  if (subcommand === 'image') return handleGenerateImage(args.slice(1));
  if (subcommand === 'video') return handleGenerateVideo(args.slice(1));

  throw new LaminaCliError({
    code: 'unknown_subcommand',
    exitCode: EXIT.INVALID_USAGE,
    message: `Unknown subcommand: "lamina generate ${subcommand}".`,
    suggestion: 'Run `lamina generate --help` for valid subcommands.',
  });
}

/**
 * Parse repeatable --param k=v flags into an object. Values that look like
 * JSON (start with { or [ or quoted, or are bare numbers/booleans) are
 * JSON-parsed; otherwise treated as strings.
 */
function parseParamFlags(values: unknown): Record<string, unknown> {
  if (!values) return {};
  const arr = Array.isArray(values) ? values : [values];
  const out: Record<string, unknown> = {};
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const eq = raw.indexOf('=');
    if (eq < 0) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `--param must be in key=value form, got "${raw}".`,
        suggestion: 'Example: --param imageSize=auto_4K',
      });
    }
    const key = raw.slice(0, eq).trim();
    const val = raw.slice(eq + 1);
    if (!key) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `--param has an empty key in "${raw}".`,
      });
    }
    let parsed: unknown = val;
    const trimmed = val.trim();
    if (
      trimmed === 'true' ||
      trimmed === 'false' ||
      trimmed === 'null' ||
      /^-?\d/.test(trimmed) ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('"')
    ) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = val;
      }
    }
    out[key] = parsed;
  }
  return out;
}

/**
 * Resolve a `--webhook` value. The literal "default" pulls the URL the
 * user previously persisted via `lamina webhook listen --save-default`.
 */
async function resolveWebhookFlag(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  if (raw === 'default') {
    const stored = await readStoredWebhookConfig();
    if (!stored?.publicUrl) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message:
          '--webhook default requested but no default URL is saved.',
        suggestion:
          'Run `lamina webhook listen --public-url <url> --save-default` first, or pass an explicit URL.',
      });
    }
    return stored.publicUrl;
  }
  return raw;
}

async function handleGenerateImage(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(IMAGE_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        model: { type: 'string' },
        prompt: { type: 'string' },
        param: { type: 'string', multiple: true },
        params: { type: 'string' },
        wait: { type: 'boolean' },
        async: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
        'interval-ms': { type: 'string' },
        download: { type: 'string' },
        webhook: { type: 'string' },
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
      suggestion: 'Run `lamina generate image --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(IMAGE_HELP);
    return;
  }

  const model = parsed.values.model as string | undefined;
  if (!model) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing --model.',
      suggestion: 'Run `lamina models list` to see available models.',
    });
  }

  // Don't hard-require --prompt here. Some models don't take a prompt at all
  // (e.g. bria-bg-remove, sync-lipsync, ideogram-v3-reframe — paramSchema's
  // `prompt: PROMPT_NONE`). Server-side paramSchema validation enforces
  // required-ness per model.
  const prompt = parsed.values.prompt as string | undefined;

  // Build params in two passes (lower precedence → higher):
  //   1. --param k=v repeatable overrides
  //   2. --params '<json>' bulk merge (wins on conflict)
  const paramOverrides = parseParamFlags(parsed.values.param);
  let params: Record<string, unknown> = { ...paramOverrides };
  const paramsRaw = parsed.values.params as string | undefined;
  if (paramsRaw) {
    try {
      const obj = JSON.parse(paramsRaw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        params = { ...params, ...(obj as Record<string, unknown>) };
      } else {
        throw new Error('--params must be a JSON object');
      }
    } catch (err) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `--params is not valid JSON: ${(err as Error).message}`,
        suggestion: "Example: --params '{\"imageSize\":\"auto_4K\"}'",
      });
    }
  }

  const wait = Boolean(parsed.values.wait);
  const isAsync = Boolean(parsed.values.async);
  if (wait && isAsync) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--wait and --async are mutually exclusive.',
    });
  }
  const timeoutMs = Number(parsed.values['timeout-ms'] ?? 240000);
  const intervalMs = Number(parsed.values['interval-ms'] ?? 5000);
  const downloadTemplate = parsed.values.download as string | undefined;
  const webhookRaw = parsed.values.webhook as string | undefined;
  const webhookUrl = await resolveWebhookFlag(webhookRaw);

  const { client } = await createClientFromAuthContext();
  const dispatch = await client.generate.image({
    model,
    prompt,
    params,
    webhookUrl,
  });

  const runId = dispatch.data.runId;

  if (!wait) {
    if (isJsonMode()) {
      printJson(dispatch);
      return;
    }
    printGenerateImageResult(dispatch.data, { phase: 'queued' });
    return;
  }

  // --wait: poll the dedicated generate status endpoint.
  const terminal = await client.generate.wait(runId, { timeoutMs, intervalMs });

  // Adapt the single `output` shape to the array shape downloadOutputs +
  // printGenerateImageResult understand. `output` is null when status !=
  // 'completed'.
  const outputsArr: RunOutput[] = terminal.output
    ? [
        {
          value: terminal.output.url ?? null,
          outputType: terminal.output.type,
          nodeLabel: null,
        } as RunOutput,
      ]
    : [];

  // Optional download.
  let downloads = null;
  if (downloadTemplate && terminal.status === 'completed' && outputsArr.length > 0) {
    downloads = await downloadOutputs({ runId, outputs: outputsArr, template: downloadTemplate });
  }

  if (isJsonMode()) {
    // Surface downloads + outputs on the terminal envelope for JSON consumers.
    const enriched = {
      data: {
        ...terminal,
        outputs: outputsArr,
        ...(downloads ? { downloads } : {}),
      },
    };
    printJson(enriched);
    return;
  }

  printGenerateImageResult(
    {
      runId,
      status: terminal.status as 'queued',
      model: terminal.model || dispatch.data.model,
      resolvedParams: terminal.resolvedParams || dispatch.data.resolvedParams,
      outputs: outputsArr,
      downloads: downloads || undefined,
    } as Parameters<typeof printGenerateImageResult>[0],
    { phase: 'terminal', finalStatus: terminal.status as string },
  );
}

async function handleGenerateVideo(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(VIDEO_HELP);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        model: { type: 'string' },
        prompt: { type: 'string' },
        param: { type: 'string', multiple: true },
        params: { type: 'string' },
        wait: { type: 'boolean' },
        async: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
        'interval-ms': { type: 'string' },
        download: { type: 'string' },
        webhook: { type: 'string' },
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
      suggestion: 'Run `lamina generate video --help` for usage.',
    });
  }

  if (parsed.values.help) {
    process.stdout.write(VIDEO_HELP);
    return;
  }

  const model = parsed.values.model as string | undefined;
  if (!model) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: 'Missing --model.',
      suggestion: 'Run `lamina models list --modality video` to see available models.',
    });
  }

  // Don't hard-require --prompt here. Some models don't take a prompt at all
  // (e.g. sync-lipsync) or treat it as optional (omnihuman-v15, kling-ai-avatar,
  // kling-v26-motion-control). Server-side paramSchema validation enforces
  // required-ness per model.
  const prompt = parsed.values.prompt as string | undefined;

  const paramOverrides = parseParamFlags(parsed.values.param);
  let params: Record<string, unknown> = { ...paramOverrides };
  const paramsRaw = parsed.values.params as string | undefined;
  if (paramsRaw) {
    try {
      const obj = JSON.parse(paramsRaw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        params = { ...params, ...(obj as Record<string, unknown>) };
      } else {
        throw new Error('--params must be a JSON object');
      }
    } catch (err) {
      throw new LaminaCliError({
        code: 'invalid_argument',
        exitCode: EXIT.INVALID_USAGE,
        message: `--params is not valid JSON: ${(err as Error).message}`,
        suggestion: "Example: --params '{\"duration\":\"10\",\"aspectRatio\":\"9:16\"}'",
      });
    }
  }

  const wait = Boolean(parsed.values.wait);
  const isAsync = Boolean(parsed.values.async);
  if (wait && isAsync) {
    throw new LaminaCliError({
      code: 'invalid_argument',
      exitCode: EXIT.INVALID_USAGE,
      message: '--wait and --async are mutually exclusive.',
    });
  }
  // Video runs take noticeably longer than image — default 10 min vs 4.
  const timeoutMs = Number(parsed.values['timeout-ms'] ?? 600000);
  const intervalMs = Number(parsed.values['interval-ms'] ?? 5000);
  const downloadTemplate = parsed.values.download as string | undefined;
  const webhookRaw = parsed.values.webhook as string | undefined;
  const webhookUrl = await resolveWebhookFlag(webhookRaw);

  const { client } = await createClientFromAuthContext();
  const dispatch = await client.generate.video({
    model,
    prompt,
    params,
    webhookUrl,
  });

  const runId = dispatch.data.runId;

  if (!wait) {
    if (isJsonMode()) {
      printJson(dispatch);
      return;
    }
    printGenerateImageResult(
      dispatch.data as unknown as Parameters<typeof printGenerateImageResult>[0],
      { phase: 'queued' },
    );
    return;
  }

  const terminal = await client.generate.wait(runId, { timeoutMs, intervalMs });

  const outputsArr: RunOutput[] = terminal.output
    ? [
        {
          value: terminal.output.url ?? null,
          outputType: terminal.output.type,
          nodeLabel: null,
        } as RunOutput,
      ]
    : [];

  let downloads = null;
  if (downloadTemplate && terminal.status === 'completed' && outputsArr.length > 0) {
    downloads = await downloadOutputs({ runId, outputs: outputsArr, template: downloadTemplate });
  }

  if (isJsonMode()) {
    const enriched = {
      data: {
        ...terminal,
        outputs: outputsArr,
        ...(downloads ? { downloads } : {}),
      },
    };
    printJson(enriched);
    return;
  }

  printGenerateImageResult(
    {
      runId,
      status: terminal.status as 'queued',
      model: terminal.model || dispatch.data.model,
      resolvedParams: terminal.resolvedParams || dispatch.data.resolvedParams,
      outputs: outputsArr,
      downloads: downloads || undefined,
    } as Parameters<typeof printGenerateImageResult>[0],
    { phase: 'terminal', finalStatus: terminal.status as string },
  );
}

