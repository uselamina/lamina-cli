---
name: lamina-models
description: >
  Atomic model-pinned image and video generation with the Lamina CLI. Use this
  skill when the user names a specific model, asks to dispatch a single
  generation directly, or wants to compare/experiment with models. Covers
  `lamina models list`, `lamina models describe <id>`, and the two atomic
  dispatch verbs `lamina generate image` and `lamina generate video`. For a
  vague free-text creative brief, use the `lamina-content` skill instead (it
  routes to an app or recipe). For executing a known Lamina App by id, use
  `lamina-apps`.
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina atomic generation — model-pinned image and video

The atomic surface is a thin dispatch layer: caller picks a specific model
(by id), the server validates inputs against the model's `paramSchema`,
submits to the provider directly, and returns a `runId`. No LLM in the
dispatch path. Same `lamina runs wait` works for any atomic run.

## Two verbs cover everything

The model id is the discriminator — there is no separate verb for edit /
image-to-video / motion-control / etc., because those are just different
models that take different params per their `paramSchema`.

- **`lamina generate image`** — every image dispatch. Text-to-image when
  you pass just a prompt; image-to-image when `params` includes a source
  image (`imageUrls` non-empty array, or `imageUrl` for single-source
  models). Hybrid models flip automatically; edit-only models always
  require a source.

- **`lamina generate video`** — every video dispatch (text-to-video,
  image-to-video, video-to-video, motion-control, reference-to-video,
  keyframe). Each video model has one declared mode; the model id picks
  the operation, and required URL fields in `params` come from the
  model's `paramSchema`.

## The discovery flow (same for image and video)

1. **`lamina models list <kw1> <kw2> ... [--modality image|video]`** —
   positional keywords go through the smart scorer (the same matcher the
   MCP `lamina_discover` tool uses). Without keywords you get top models
   by popularity, capped by `--limit`. Combine medium + form + context
   for best results, e.g.

   ```
   lamina models list product video reel 9:16 --modality video
   ```

2. **`lamina models describe <id>`** — input contract for the chosen
   model. Response is FLAT: `paramSchema` keyed by field name. `prompt`
   appears here as a regular `type: 'string'` field (when supported)
   alongside other inputs. Hybrid models merge their modes' fields into
   one schema with mode-specific fields marked optional. Every field
   carries explicit `required: true|false`, type, range / enum values,
   default, and a description.

   No `--modality` flag needed — model ids are globally unique across
   image + video registries; the server searches both.

3. **`lamina generate {image|video} --model <id> [--prompt "..."]
   [--params '<json>']`** — dispatch. The CLI returns a `runId`; pass
   `--wait` to block + `--download <template>` to save outputs, or fire
   and forget with `--webhook <url>`.

## Synchronous vs asynchronous models

Most models go through fal and take 5–60s (image) or 30s–5min (video).
A subset is Vertex-AI-backed and returns inline — `--wait` returns on
the first poll:

- Vertex (sync, ~2s): `imagen-4.0-fast-generate-001`, `imagen-4.0-generate-001`,
  `imagen-4.0-ultra-generate-001`, `gemini-2.5-flash-image`,
  `veo3-text-to-video`, `veo3-image-to-video`, `veo3-first-frame-to-video`,
  `veo3-keyframe-to-video`.
- fal (async): everything else.

The agent doesn't need to branch — the contract is identical.

## Hybrid models (multiple modes)

`nano-banana-pro`, `nano-banana-2`, `gpt-image-1`, `gpt-image-1.5`,
`gpt-image-2`, `seedream-4.5`, `flux-2-flex`, `gemini-2.5-flash-image`
declare both `text-to-image` and `image-to-image`. The server flips
automatically based on whether `params.imageUrls` (non-empty) or
`params.imageUrl` is supplied. No separate command — same `lamina
generate image`.

## Multi-shot mode (Kling V3 / O3 image-to-video)

Four models support narrative multi-shot generation:
`kling-o3-standard-image-to-video`, `kling-o3-pro-image-to-video`,
`kling-v3-standard-image-to-video`, `kling-v3-pro-image-to-video`.
Toggle with `params.multiShots: true`, then provide
`params.multiPrompt: [{prompt, duration}, ...]`. Rules enforced by the
registry:

- 1–5 shots per run
- Each shot's `duration` must be in `'3'..'15'` (string)
- Sum of all shot durations must be in `[3, 15]` (total clip cap)
- When `multiShots: true`, the top-level `prompt` is required (kept as a
  brief description) but NOT sent to fal — only `multi_prompt` reaches
  the model.

Validation errors are structured so an agent can self-correct:
`{ field, error, allowed/range/maxShots, got }`.

## When to use atomic vs `lamina content create`

| You want | Use |
|---|---|
| Router to pick an app from a free-text brief, orchestrate inputs, multi-step workflows | `lamina content create` (load `lamina-content` skill) |
| Pick a specific model, dispatch one image directly (no LLM in path) | `lamina generate image --model <id>` (this skill) |
| Compose primitive steps in your own skill / IDE flow | this skill |
| Experiment with or compare models | this skill |
| Dispatch a known workflow with the exact `appId` | `lamina run <appId>` (load `lamina-apps` skill) |

## Examples

```bash
# Text-to-image (basic)
lamina generate image --model ideogram-v3 \
  --prompt "vintage poster, text reads \"NEW DROP\""

# Text-to-image with custom dimensions
lamina generate image --model gpt-image-2 \
  --prompt "moody product shot on slate" \
  --params '{"imageSize":"custom","customWidth":1920,"customHeight":1088}'

# Text-to-image — Vertex sync, returns in seconds
lamina generate image --model imagen-4.0-fast-generate-001 \
  --prompt "a single ceramic teacup, soft morning light" \
  --params '{"aspectRatio":"16:9"}' \
  --wait --download ./out/

# Image-to-image — hybrid model, same verb, source in params
lamina generate image --model nano-banana-pro \
  --prompt "watercolor style with brand palette" \
  --params '{"imageUrls":["https://media.../source.png"]}' \
  --wait --download ./out/

# Image-to-image — background remove (edit-only, no prompt)
lamina generate image --model bria-bg-remove \
  --params '{"imageUrls":["https://example.com/product.png"]}' \
  --wait --download ./out/

# Image-to-image — inpainting with mask
lamina generate image --model gpt-image-2 \
  --prompt "fill the masked area with matching texture" \
  --params '{"imageUrls":["https://..."],"maskUrl":"https://..."}'

# Image-to-image — background swap
lamina generate image --model ideogram-v3-replace-background \
  --prompt "a sunlit Tokyo café in the background" \
  --params '{"imageUrls":["https://..."]}'

# Image-to-image — Flux Pro Kontext (single-image edit)
lamina generate image --model flux-pro-kontext \
  --prompt "place the product on a marble pedestal in soft studio light" \
  --params '{"imageUrl":"https://.../product.png","aspectRatio":"3:2"}' \
  --wait --download ./out/

# Text-to-video — Kling v2.5 with overrides (fal async, 30s–5min)
lamina generate video --model kling-v25-text-to-video \
  --prompt "macro shot of dew rolling down a leaf, golden hour" \
  --params '{"duration":"10","aspectRatio":"9:16","cfgScale":0.7}' \
  --wait --timeout-ms 600000 --download ./out/

# Image-to-video — Minimax (single imageUrl)
lamina generate video --model minimax-image-to-video \
  --prompt "the subject smiles and slowly turns toward the camera" \
  --params '{"imageUrl":"https://example.com/portrait.jpg"}'

# Image-to-video — Seedance keyframe (start + end frames)
lamina generate video --model seedance-2.0-fast-image-to-video \
  --prompt "subject walks toward the doorway" \
  --params '{"startImageUrl":"https://.../start.jpg","endImageUrl":"https://.../end.jpg","duration":"8"}'

# Image-to-video — Veo3 first-frame (Vertex sync, ~5s)
lamina generate video --model veo3-first-frame-to-video \
  --prompt "wind ripples through the grass; subject's hair lifts gently" \
  --params '{"firstFrameUrl":"https://example.com/portrait.jpg","duration":6,"resolution":"720p"}' \
  --wait --download ./out/

# Keyframe — Veo3 (interpolate first → last)
lamina generate video --model veo3-keyframe-to-video \
  --prompt "the subject walks from the window to the door" \
  --params '{"firstFrameUrl":"https://.../window.jpg","lastFrameUrl":"https://.../door.jpg","duration":8}' \
  --wait --download ./out/

# Motion-control — character image + motion-reference video
lamina generate video --model kling-v26-motion-control \
  --params '{"imageUrl":"https://.../character.png","videoUrl":"https://.../dance.mp4"}' \
  --wait --timeout-ms 300000 --download ./out/

# Video-to-video edit
lamina generate video --model wan-video-to-video \
  --prompt "cinematic teal-and-orange grade, slow-motion feel" \
  --params '{"videoUrl":"https://.../source.mp4"}' \
  --wait --timeout-ms 300000 --download ./out/

# Image-to-video — Kling V3 Pro multi-shot (narrative video, max 5 shots,
# total duration ≤ 15s)
lamina generate video --model kling-v3-pro-image-to-video \
  --prompt "brand product launch sizzle" \
  --params '{
    "startImageUrl":"https://.../hero.jpg",
    "multiShots":true,
    "multiPrompt":[
      {"prompt":"camera dollies in on the product","duration":"5"},
      {"prompt":"camera arcs around to reveal the logo","duration":"5"},
      {"prompt":"camera pulls back, brand text appears","duration":"5"}
    ]
  }'
```

## Saving outputs to disk — `--download <path>`

`--download <path>` saves the result(s) to disk wherever the user names.
Works on `lamina generate {image|video} --wait` and `lamina runs wait
<runId>` (any command that resolves a run terminally). Smart path
resolution:

- `--download "./public/hero.png"` → single output lands there literally;
  multiple outputs auto-suffix as `hero_0.png`, `hero_1.png`, …
- `--download "./out/"` (folder, trailing slash) → files land inside as
  `label_0.png`, `label_1.png`, …
- `--download "./out/{runId}_{label}_{index}.{ext}"` → advanced template,
  used verbatim. Placeholders: `{runId}` `{index}` `{ext}` `{label}`.

Parent directories are auto-created. In JSON mode, downloaded files
appear under `data.downloads[]` alongside the URLs in `data.outputs[]`.

## Polling status

`lamina runs wait <runId>` is **polymorphic** — works for image, video,
app, and recipe runs. No need to remember which surface dispatched.

Bound the wait by expected duration (never let a single command hang
> 3 minutes):

| Expected duration | Pattern |
|---|---|
| Fast image (~10–30s) | `lamina generate image ... --wait --timeout-ms 60000` |
| Slow video / unknown (≥ 2min) | `lamina generate video ... --async --json` → `lamina runs wait <runId> --timeout-ms 120000` in chunks |
