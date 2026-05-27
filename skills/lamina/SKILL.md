---
name: lamina
description: >
  Use the Lamina CLI to discover apps, run brand-aware AI image / video /
  content generation, and manage workspace assets. Trigger when the user
  mentions "lamina", "lamina cli", "uselamina", or asks to "generate image",
  "generate video", "make a selfie", "run a Lamina app", "list apps", "find
  an app for", "upload an asset", "brand context", "content plan", or any
  direct interaction with the uselamina.ai workspace platform. This is the
  foundational skill for Lamina; every Lamina-related agent task goes through
  `lamina` commands.
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina CLI: brand-aware AI media generation

`lamina` is the agent-first CLI for the Lamina workspace platform. Apps in
the workspace are curated multi-step workflows authored by humans (the
"selfie with celebrity" app, "virtual try-on", etc.). Brand intelligence
(workspace brand DNA, content scoring) is woven through every run
automatically. This skill teaches you the canonical flow and the rules.

## Critical rules — follow these every time

1. **Output is JSON automatically when piped.** Since v0.5.1 the CLI
   detects whether stdout is a TTY: if you're piping the output to `jq`
   or another tool, you get JSON without typing `--json`. You CAN still
   pass `--json` explicitly, and `LAMINA_OUTPUT=json` (env) forces JSON
   even in a TTY. Errors emit JSON on stderr in JSON mode too — one
   parser for success and failure.

2. **Apps are the curated path. Always start with `lamina apps list <kw1>
   <kw2> ... --json`** (positional keywords; multiple in one call —
   the server scores + ranks the union). Apps are workflows a human author
   has tuned end to end. Use them before considering anything else.

3. **Inspect the parameter contract before running.** `lamina apps get
   <appId> --json` returns the full input spec — names, types, defaults,
   options, must-supply markers. Required inputs without defaults must be
   supplied or the run fails.

4. **Upload local files before passing them as inputs.** Use `lamina assets
   upload <path> --json` to push to the workspace CDN. The returned URL is
   what you pass as a `url`-typed parameter (e.g.
   `--input your_photo_image_url=<url>`).

5. **Don't hang a single command for more than ~3 minutes — poll in
   chunks instead.** `--wait` blocks until the run completes; without a
   bounded `--timeout-ms`, a long video job can wedge the chat for 10+
   minutes. Pick the right pattern:

   | Expected duration | Pattern |
   |---|---|
   | Fast image (~10-30s) | `lamina run ... --wait --timeout-ms 60000` |
   | Multi-variant image / short recipe (~30s-2min) | `lamina run ... --wait --timeout-ms 180000` |
   | Video, complex recipe, or unknown (≥2min) | `lamina run ... --async --json` → check `lamina runs wait <runId> --timeout-ms 120000` in chunks, surface progress to the human between polls if still running after 2-3 checks |

   `--wait` and `--async` are mutually exclusive. `lamina runs wait`
   returns either when the run reaches a terminal state OR when the
   timeout elapses (status still pending) — read the response shape and
   decide your next move; never blindly loop.

6. **Webhooks for production receivers, not for chat agents.** If a
   default webhook URL is saved (via `lamina webhook listen --public-url
   <url> --save-default`), it's auto-attached to every `lamina run`.
   Override per call with `--webhook <url>`, opt out with `--no-webhook`.
   Inspect / clear the saved URL with `lamina webhook status` / `lamina
   webhook clear`. **Chat agents typically have no receiver URL — stick
   to `--async` + chunked polls instead** (rule 5). See the "Webhooks"
   section for the dev-loop pattern with `lamina webhook listen` (akin
   to `stripe listen`).

7. **One Bash tool call per `lamina` command.** Each `lamina ...`
   invocation should be its own Bash tool call. No shell substitutions
   (`RES=$(lamina apps list --json)`), no pipes mid-command. Read the JSON
   response from the tool result. Prevents permission prompts in Claude Code
   and keeps each call idempotent.

8. **Do NOT invent app IDs or parameter names.** Every appId comes from
   `lamina apps list`; every parameter name comes from `lamina apps get
   <appId>`. Guessing produces 404 / 422 errors.

9. **Brand intelligence is automatic on app runs.** Apps already pull
   workspace brand DNA when configured. Don't try to inject brand context
   manually. To inspect it: `lamina intelligence brand-context --json`.

## Command index

| Command | Purpose |
|---|---|
| `lamina init` | Install this skill into the cwd's `.claude/skills/lamina/` (you ran this once already if you're reading this) |
| `lamina docs <query>` | Search Lamina docs from the terminal |
| `lamina login` | Authenticate (browser OAuth) or `--api-key <key>` for CI |
| `lamina logout` | Clear stored credentials |
| `lamina whoami` | Identity + active workspace |
| `lamina apps list [<keyword> ...] [--limit n]` | Discover apps. With keywords: smart scored search (same matcher MCP `lamina_discover` uses). Without keywords: browse mode (top apps by popularity). |
| `lamina apps get <appId>` | Parameter contract for one app |
| `lamina assets upload <path>` | Upload local file → CDN URL |
| `lamina run <appId> --input k=v --wait` | Execute an app (add `--download <template>` to also save outputs to disk) |
| `lamina runs get <runId>` | Snapshot run status |
| `lamina runs wait <runId>` | Block until terminal |
| `lamina runs cancel <runId>` | Cancel a queued/running execution (idempotent) |
| `lamina content create "<brief>"` | Brief → run a workflow. Router picks an app (or recipe), drafts inputs, **auto-dispatches when sufficient**; otherwise returns `needs_input` / `needs_clarification`. |
| `lamina content plan "<brief>"` | Preview-only sibling of `create`. Same routing tree but NEVER dispatches. Use for dry-runs, debug, CI preview. |
| `lamina models list [<kw1> <kw2> ...] [--modality image\|video]` | List atomic models. Positional keywords are passed to the smart scorer (same matcher MCP `lamina_discover` uses). |
| `lamina models describe <id> [--modality image\|video]` | Show one model's input contract — flat `paramSchema` where `prompt` is just another field (when supported). Models that don't accept a prompt simply omit it. Hybrid models present a merged schema with mode-specific fields marked optional. |
| `lamina generate image --model <id> [--prompt "..."] [--params '<json>']` | **Atomic image dispatch** — ONE command for every image operation. The model id is the discriminator. Text-to-image, image-to-image, edit, remix, background-remove, reframe — all share this verb. Hybrid models (nano-banana-pro, gpt-image-2, gemini-2.5-flash-image, seedream-4.5, flux-2-flex, nano-banana-2, gpt-image-1, gpt-image-1.5) flip to image-to-image when `params.imageUrls` (non-empty) or `params.imageUrl` is set; otherwise text-to-image. Edit-only models (bria-bg-remove, ideogram-character, ideogram-v3-remix/reframe/replace-background, flux-pro-kontext, ideogram-character-remix) always require a source. |
| `lamina generate video --model <id> [--prompt "..."] [--params '<json>']` | **Atomic video dispatch** — ONE command for every video operation. Text-to-video, image-to-video, video-to-video, motion-control, reference-to-video, keyframe — all share this verb. Each video model has a single declared mode; pick the model that does what you want and provide its required URL params (`imageUrl` for image-to-video, `videoUrl` for video-to-video, both for motion-control, `firstFrameUrl`+`lastFrameUrl` for keyframe, `referenceImageUrls` for reference variants). |
| `lamina run <appId> ...` | Execute a catalog app (deterministic, no LLM). Add `--output "<label>"` (repeatable) to run only a subset of the app's outputs. |
| `lamina run --recipe-file <path> ...` | Execute a freestyle recipe from `~/.lamina/recipes/...` |
| `lamina webhook status` / `lamina webhook clear` | Inspect / clear the saved default webhook URL |
| `lamina intelligence brand-context` | Workspace brand DNA |
| `lamina intelligence predict "<concept>"` | Performance prediction |
| `lamina intelligence recommendations` | Actionable content recommendations |
| `lamina intelligence trends` | Top / emerging / declining patterns |
| `lamina webhook signing-key` | Public signing keys for webhook verification |
| `lamina webhook listen` | Local listener that verifies + prints deliveries |
| `lamina mcp serve` | Run the local stdio MCP server |

For full options on any command: `lamina <cmd> --help`.

## The canonical agent flow — create from a brief

Two entry patterns depending on how concrete the user's intent is:

- **Known intent** ("use the selfie app", "run app X with these inputs",
  "give me a virtual try-on") → go direct: `lamina apps list --search` →
  `lamina apps get <appId>` → `lamina run <appId> --input ...`. No
  `content create` needed. See "Direct app discovery" below.
- **Vague creative brief** ("make me a hero image", "selfie with Brad
  Pitt", "moody dawn scene", "cinematic founder shot") → use
  `lamina content create`. The router agent decides between an app and
  a freestyle recipe, drafts inputs, and **dispatches automatically
  when the brief has enough context**. Otherwise it returns the missing
  inputs for you to provide via `lamina run`.

The vague-brief flow:

```
1. (if the user gave a local file path)
   lamina assets upload <path> --json
   → grab .data.url; you'll pass it as a --input value below

2. lamina content create "<the user's brief>" \
     [--modality image|video] [--platform <name>] [--app-id <pinned-id>] \
     [--input <name>=<value>]* --json
   → one LLM call. Either dispatches the run OR returns asks/clarifications.

3. Branch on data.status:
     'ran'                 → the workflow was dispatched. data.runId is
                             ready. Poll with `lamina runs wait <runId>`
                             (or pass --wait on the create call to block
                             here). Surface outputs to the user.
     'needs_input'         → the router committed to an app/recipe but
                             needs specific values you must supply. Ask
                             the human each item in data.askUser, then
                             dispatch DETERMINISTICALLY via `lamina run`
                             with the selectedApp.appId from the response.
                             NEVER re-call `content create` here — that
                             would re-roll the router LLM. See
                             "Dispatching a plan" below.
     'needs_clarification' → the router paused before committing because
                             the brief is genuinely ambiguous between TWO
                             OR MORE apps (true pre-commit ROUTING
                             ambiguity — e.g. banner vs reel vs video).
                             Ask the human each item in data.clarifications,
                             fold the answers into a refined brief, then
                             RE-CALL `lamina content create`. This is the
                             ONLY status where re-calling create is correct.
                             NOTE: PRESET option picks and per-app context
                             questions go through `askUser`, NOT through
                             `needs_clarification`.
     'unmatched'           → brief is outside Lamina's surface. Tell the
                             human; suggest rephrasing. Never retry.

4. Surface outputs to the user. Done.
```

`lamina content create` is the **only** LLM-driven step. The dispatch step
(`lamina run`) is deterministic — pure schema validation + workflow
dispatch, no LLM. That means **the agent's decision binds**: once `create`
commits to a `selectedApp.appId`, `lamina run` honors it exactly. No drift
across turns.

### Preview-only sibling: `lamina content plan`

`lamina content plan "<brief>"` runs the same router agent but **never
dispatches**. Use it when you explicitly want to inspect the routing
decision before committing — CI dry-runs, debugging which app the router
picks, manual review before burning credits. For the regular agentic flow,
use `create`.

## Atomic image generation + edit

Two atomic dispatch verbs cover every model-pinned operation. The model id
is the discriminator — there's no separate verb for edit / image-to-video /
motion-control / etc., because those are just different models that take
different params (per their `paramSchema`).

- **`lamina generate image`** — every image dispatch. Text-to-image when
  you pass just a prompt; image-to-image when `params` includes a source
  image (`imageUrls` non-empty array, or `imageUrl` for single-source
  models like `flux-pro-kontext`). Hybrid models flip automatically;
  edit-only models always require a source.
- **`lamina generate video`** — every video dispatch (text-to-video,
  image-to-video, video-to-video, motion-control, reference-to-video,
  keyframe). Each video model has one declared mode; the model id picks
  the operation, and required URL fields in `params` come from the
  model's paramSchema.

The discovery flow is the same for both:

1. **`lamina models list <kw1> <kw2> ...`** — positional keywords go
   through the smart scorer (same matcher MCP `lamina_discover` uses).
   Without keywords, you get top apps by popularity, capped by `--limit`.
   Combine medium + form + context for best results, e.g.
   `lamina models list product video reel 9:16 --modality video`.

2. **`lamina models describe <id>`** — input contract for the chosen
   model. Response is FLAT: `paramSchema` keyed by field name. `prompt`
   appears here as a regular `type: 'string'` field (when supported)
   alongside other inputs. Hybrid models merge their modes' fields into
   one schema with mode-specific fields marked optional. Each field has
   `type`, range, default, enum `values`, description.

3. **`lamina generate {image|video} --model <id> [--prompt "..."]
   [--params '<json>']`** — dispatch. The CLI returns a `runId`; pass
   `--wait` to block + `--download <template>` to save outputs, or fire
   and forget with `--webhook <url>`.

### Synchronous vs asynchronous models

Most models go through fal and take 5–60s (image) or 30s–5min (video).
A subset is Vertex-AI-backed and returns inline — `--wait` returns on
the first poll:

- Vertex (sync, ~2s): `imagen-4.0-fast-generate-001`, `imagen-4.0-generate-001`,
  `imagen-4.0-ultra-generate-001`, `gemini-2.5-flash-image`,
  `veo3-text-to-video`, `veo3-image-to-video`, `veo3-first-frame-to-video`,
  `veo3-keyframe-to-video`.
- fal (async): everything else.

The agent doesn't need to branch — the contract is identical.

### Hybrid models (multiple modes)

`nano-banana-pro`, `nano-banana-2`, `gpt-image-1`, `gpt-image-1.5`,
`gpt-image-2`, `seedream-4.5`, `flux-2-flex`, `gemini-2.5-flash-image`
declare both `text-to-image` and `image-to-image`. The server flips
automatically based on whether `params.imageUrls` (non-empty) or
`params.imageUrl` is supplied. No separate command — same `lamina
generate image`.

### Examples

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

### Multi-shot mode (Kling V3/O3 image-to-video)

Four models support narrative multi-shot generation: `kling-o3-standard-image-to-video`, `kling-o3-pro-image-to-video`, `kling-v3-standard-image-to-video`, `kling-v3-pro-image-to-video`. Toggle with `params.multiShots: true`, then provide `params.multiPrompt: [{prompt, duration}, ...]`. Rules enforced by the registry:
- 1–5 shots per run
- Each shot's `duration` must be in `'3'..'15'` (string)
- Sum of all shot durations must be in `[3, 15]` (total clip cap)
- When `multiShots: true`, the top-level `prompt` is required (kept as a brief description) but NOT sent to fal — only `multi_prompt` reaches the model

Validation errors are structured so an agent can self-correct: `{ field, error, allowed/range/maxShots, got }`.

### When to use atomic generate/edit vs `lamina content create`

| You want | Use |
|---|---|
| Router to pick an app from a free-text brief, orchestrate inputs, multi-step workflows | `lamina content create` (agentic) |
| Pick a specific model, dispatch one image directly (no LLM in path) | `lamina generate image --model <id>` (text-to-image OR image-to-image — model id discriminates) |
| Compose primitive steps in your own skill / IDE flow | atomic surface |
| Experiment with or compare models | atomic surface |
| Dispatch a known workflow with the exact `appId` | `lamina run <appId>` |

The atomic surface is its own thin dispatch layer on top of fal: caller
picks the model + mode (via tool choice), server validates against the
model's mode-specific paramSchema, submits to fal directly, and stores
the run in `fal_requests`. Same `lamina runs wait` works for both atomic
generate and edit runIds.

## Direct app discovery (the non-plan path)

When the user's intent is concrete enough that you (the agent) can pick
an app yourself, skip `plan` and search directly. Three steps:

1. **Search smartly with a comprehensive keyword list — one call, multiple
   angles.** `lamina apps list <kw1> <kw2> <kw3> ... --json` takes positional
   keywords and routes through the **same scored matcher the MCP
   `lamina_discover` tool uses** (SQL prefilter + JS scorer with intent
   analysis + popularity ranking). Don't make many narrow one-keyword
   calls — pass everything that captures the user's intent in a single
   invocation. The server does the union + scoring.

   How to pick the keywords from the brief:

   - **Medium** (`image`, `video`, `audio`)
   - **Form / output kind** (`reel`, `hero`, `banner`, `headshot`,
     `portrait`, `pack shot`, `try-on`, `lookbook`, `catalog`)
   - **Context / channel** (`ecommerce`, `social`, `lifestyle`,
     `editorial`, `Instagram`, `story`, `ad`)
   - **Subject domain** if the brief named one (`apparel`, `eyewear`,
     `jewelry`, `food`, `cosmetics`)
   - **Aspect / format** when explicit (`9:16`, `16:9`, `square`)

   Combine 3–6 angles from the brief in one call — that's the contract
   shape that produces tight, ranked candidates:

   ```
   # "make me a selfie with a celebrity"
   lamina apps list selfie celebrity portrait identity --json

   # "product video reel for our new sneaker"
   lamina apps list "product video" reel 9:16 ecommerce --json

   # "editorial hero shot for the founder"
   lamina apps list "hero shot" editorial lifestyle portrait --json
   ```

   Quote multi-word keywords (`"hero shot"`) so the shell passes them
   as a single positional. `apps list` with no keywords is **browse
   mode** — returns top apps by popularity, capped by `--limit`.

   If the first call's candidates don't fit the brief's actual subject,
   rephrase with different angles and call again. **Only fall back to
   `lamina content plan` (the recipe path) after you're confident no
   app in the workspace covers the brief.** Apps are human-tuned;
   they're nearly always the better path than a recipe.

2. **Read each candidate's `description` / `purpose` as a whole
   sentence.** Don't keyword-match. Ask: what does this app *actually
   deliver*? Watch for context cues:

   | Cue in description | Means | When it fits |
   |---|---|---|
   | "Salesforce / PDP / storefront / ecommerce" | Catalog output | Bulk product imagery for stores. WRONG for editorial. |
   | "editorial / cinematic / hero / magazine" | Editorial single-shot | Founder / lifestyle / brand-story shots. |
   | "on-model / try-on" + a clothing word | Garment-on-person | Apparel try-on, not generic portraits. |
   | "pack shot / product shot / clean catalog" | Studio product photo | When the product IS the subject. |
   | "reel / social / Instagram / story" | Social channel output | Platform-specific format. |

3. **`lamina apps get <appId> --json`** to read the full parameter
   contract. Required inputs without defaults MUST be supplied or the
   run fails.

4. **Resolve user-owned inputs.** For each `url`-typed param the app
   needs (product photo, headshot, logo), ask the human; for local
   file paths run `lamina assets upload <path> --json` first to get a
   CDN URL.

5. **Dispatch** — bound the wait by expected duration (rule 5 — no
   single call hangs >3min):

   ```bash
   # Fast image work (~10-30s)
   lamina run <appId> \
     --input <each param>=<value> \
     --wait --timeout-ms 60000 --json

   # Slower work (multi-variant / video) — async + chunked poll
   lamina run <appId> \
     --input <each param>=<value> \
     --async --json
   # → returns runId; then:
   lamina runs wait <runId> --timeout-ms 120000 --json
   # → repeat with another bounded wait if still running.
   ```

### `plan` vs direct discovery — what `plan` adds

Direct discovery is fine when you can confidently pick the app. `plan`
adds these on top — and they only exist on the `plan` path:

- **Recipe fallback.** When no app's purpose fits the brief, `plan`
  emits a freestyle recipe (model + params + prompt). Direct discovery
  has no recipe path — you're stuck if no app matches.
- **Drafted inputs.** `plan` pre-fills any inferable text params from
  the brief (e.g. `celebrity_text: "Tom Holland"`). Direct discovery
  means YOU draft those values from the brief yourself.
- **Smart asks.** `plan` only asks for what it can't infer from the
  brief. Direct discovery: you decide what to ask, what to fill, what
  to leave default — your call to get right.
- **Reference-image convention.** When `plan` picks a reference-aware
  recipe model, it sets the `imageUrls: []` placeholder and emits an
  ask with `name: "imageUrls"` — the CLI dispatch knows how to merge
  the answer. Direct discovery doesn't have this convention because
  apps use their own per-param slots.

**Hard rule:** if direct `apps list --search` returns no candidate
whose `description` matches the brief's actual subject, switch to
`lamina content plan` immediately — it's the only path that can
recipe-fall-back.

## Dispatching a plan

When `lamina content plan` returns `status: "plan"`, the response has
`mode: 'app' | 'recipe'`. Two dispatch paths, same shape of skill rule:

### `mode: 'app'`

Shape of the response data (all fields the agent reads):

| field | what it is | dispatches as |
|---|---|---|
| `selectedApp.appId` | The app the router committed to | first positional arg of `lamina run` |
| `selectedApp.rationale` | One-sentence why this app fits | informational — surface to human if useful |
| `draftedInputs` | Inputs the router pre-filled from the brief | one `--input <key>=<value>` per entry |
| `askUser` *(may be empty)* | Questions the human must answer — covers USER-OWNED slots (their photo, logo), PRESET option choices (background, aesthetic — curated options listed INLINE in `question`), output subsetting (when `name === "__outputs"`), and KNOBs the user needs to set | one `--input <name>=<answer>` per entry **EXCEPT** when `name === "__outputs"` (see below) |
| `selectedOutputs` *(may be absent)* | Output labels the router picked already (envelope narrowing — broader app delivered as the narrow subset the brief asked for) | one `--output "<label>"` per entry |
| `warnings` *(may be empty)* | Soft mismatches (e.g. brief said 9:16 but app has no aspect param) | surface to human as FYI; doesn't block dispatch |

**Reading `askUser` correctly — three flavors:**

1. **USER-OWNED slot** (e.g. `name: "product_image_1_image_url"`): the human supplies a URL (or local path → `lamina assets upload` first). Pass as `--input <name>=<url>`.
2. **PRESET option choice** (e.g. `name: "background_text"`, question lists `Beach / Desert / Tropical / Urban / ... or say 'default'`): surface the **option list verbatim** to the human — they can't guess what's available. Their answer is one of the listed labels OR the literal string `default`. Pass as `--input <name>=<chosen-label>` (omit entirely if they said `default` — the app's curated default fires automatically).
3. **`__outputs` (reserved name)** — fires when the brief is silent on which of an app's semantically-distinct outputs to produce. Question describes the available output labels. Human answers with a list (comma-separated or one per line). Pass each as `--output "<label>"` (NOT `--input` — `__outputs` is never a real app parameter).

Procedure:

```
data = response.data   # status === "plan", mode === "app"

# 1. Resolve any open questions in askUser.
if data.askUser is non-empty:
  for each askUser item { name, question }:
    ASK the human the question in chat
    collect the answer
    if the answer is a local file path:
      run `lamina assets upload <path> --json` → use returned .data.url

# 2. Build the dispatch command. Three repeatable flag groups:
#    --input <draftedInputs>     --input <askUser answers>     --output <selectedOutputs>

lamina run <data.selectedApp.appId> \
  --input <each draftedInputs key>=<value> \
  --input <each askUser name>=<answer> \
  --output "<each selectedOutputs label>"   # ONLY if selectedOutputs is present
  --wait --json

# → response.data.outputs[].value are the result URLs (one per node that ran)
```

**Rules for the dispatch:**

1. **Drafted inputs are non-negotiable** — pass every key in `data.draftedInputs` verbatim. They're the router's committed values from the brief; skipping them changes the run.
2. **One `--input` per asked answer** — match the answer to `askUser[i].name`. If the human gave a file path, the URL from `lamina assets upload` is what flows here.
3. **`--output` flags are conditional on `data.selectedOutputs`**:
   - Field absent or empty → omit `--output` entirely → workflow runs ALL outputs (default).
   - Field present with labels → one `--output "<label>"` per entry. Quote labels (they may contain spaces).
4. **No second LLM call** — once you have the plan, the dispatch is mechanical. Never re-call `lamina content plan` to "double-check" the app or output choice.
5. **The pretty-print CLI shows you the exact next command** — if you're running interactively, the `Next:` block in `lamina content plan`'s output has the literal command with `--output` flags pre-filled. JSON callers build it from the data fields above.

Worked example — brief explicitly subsets outputs:

```bash
# Brief: "Product catalog shoot for my new sneaker — I only need the
#         Front View and the Back View, skip the side angle and the video."
lamina content plan "<that brief>" --modality image --json
# → response.data:
#     status:        "plan"
#     mode:          "app"
#     selectedApp:   { appId: "abc-123", name: "Product Catalog", rationale: "..." }
#     draftedInputs: { environment_text: "Studio" }
#     selectedOutputs: ["Front View", "Back View"]
#     askUser:       [{ name: "product_import_product", question: "Drop a photo..." }]

# After asking the human and uploading their photo:
lamina run abc-123 \
  --input environment_text="Studio" \
  --input product_import_product="https://media.../shoe.jpg" \
  --output "Front View" \
  --output "Back View" \
  --wait --json
# Workflow runs ONLY the Front View + Back View nodes (saves credits vs all 4)
```

Worked example — brief doesn't subset outputs:

```bash
# Brief: "Product catalog shoot for my new sneaker"
lamina content plan "<that brief>" --modality image --json
# → response.data has no selectedOutputs field

lamina run abc-123 \
  --input environment_text="Studio" \
  --input product_import_product="https://media.../shoe.jpg" \
  --wait --json
# Workflow runs ALL declared outputs (default)
```

### `mode: 'recipe'`

When no app's purpose fits the brief, the router agent emits a **recipe**
— a per-variant spec (`imageModel`, `imageParams`, `prompt`, `styleHint`).
The CLI writes the recipe JSON to a local file
(`~/.lamina/recipes/recipe-<date>-<id>.json`) and returns the path as
`recipeFile`. That file is the agent's binding contract — `lamina run
--recipe-file <path>` honors it byte-for-byte.

```
data = response.data
# data has: recipe, modality, recipeFile, askUser, warnings

if data.askUser is non-empty:
  for each askUser item: ask human, collect answer (upload local paths first)

lamina run --recipe-file <data.recipeFile> \
  --input <each asked name>=<answer> \
  --wait --json
```

#### `imageUrls` — the reference-image convention on the recipe path

Some recipe models are **reference-aware** — they composite user-supplied
images into the output (e.g. "founder wearing OUR backpack"). When the
router picks one of these models, the response shape is:

- The variant declares `imageParams.imageUrls: []` as a placeholder
- `askUser` contains one entry with `name: "imageUrls"` (the **literal
  schema slot key**, not a free-text label) and a natural-language question

Reference-aware models in the registry today: `nano-banana-pro-edit`
(max 14 refs), `seedream-4.5-edit` (max 10), `gpt-image-2-edit-image`
(max 16), `ideogram-v3` (max 3, optional). Text-only models have no
`imageUrls` in their schema — agent picks them when no user asset is
needed.

Single reference (most common):

```
lamina run --recipe-file <data.recipeFile> \
  --input imageUrls=<https://media.getmason.io/...> \
  --wait --json
```

Multi-reference (logo + product + scene, etc.) — repeat the flag:

```
lamina run --recipe-file <data.recipeFile> \
  --input imageUrls=<url1> \
  --input imageUrls=<url2> \
  --input imageUrls=<url3> \
  --wait --json
```

The CLI collects repeated `--input` keys into an array. A single scalar
URL is auto-wrapped into a one-element array at dispatch. Exceeding the
model's `maxItems` cap is rejected with a clean error.

### Worked example A — selfie via plan + run (app path)

```bash
# Turn 1 — plan (one LLM call)
lamina content plan "selfie with Tom Holland" --modality image --json
# → {
#     status: "plan",
#     mode: "app",
#     selectedApp: { appId: "e0124407-d57a-4f76-ac5a-be0041e55a24", ... },
#     draftedInputs: { celebrity_text: "Tom Holland" },
#     askUser: [{ name: "your_photo_image_url", question: "Drop a photo of yourself …" }],
#     warnings: []
#   }

# Ask the human in chat: "Got a photo of yourself for the selfie?"
# Human: "/Users/me/photo.jpg"

lamina assets upload /Users/me/photo.jpg --json
# → { data: { url: "https://media.getmason.io/..." } }

# Turn 2 — DETERMINISTIC dispatch (no LLM, no drift)
lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 \
  --input celebrity_text="Tom Holland" \
  --input your_photo_image_url="https://media.getmason.io/..." \
  --wait --timeout-ms 60000 --json
# → completes; outputs[0].value is the image URL.
```

### Worked example B — editorial founder shot via plan + run (recipe path)

```bash
# Turn 1 — plan (one LLM call)
lamina content plan "Cinematic founder shot — someone walking through \
  Manchester at golden hour wearing our backpack" \
  --modality image --json
# → {
#     status: "plan",
#     mode: "recipe",
#     recipe: {
#       variants: [{
#         imageModel: "nano-banana-pro-edit",      // reference-aware
#         imageParams: {
#           imageUrls: [],                          // placeholder — filled at dispatch
#           aspectRatio: "16:9",
#           resolution: "2K",
#           outputFormat: "png"
#         },
#         prompt: "A founder walks through central Manchester at golden hour …",
#         styleHint: "golden hour editorial"
#       }],
#       reason: "No app's purpose matches a cinematic founder lifestyle shot …"
#     },
#     recipeFile: "/Users/me/.lamina/recipes/recipe-2026-05-13-abc.json",
#     askUser: [{ name: "imageUrls", question: "Drop a photo of your backpack …" }],
#     warnings: []
#   }

# Ask the human: "Got a photo of the backpack for the shot?"
# Human: "/Users/me/backpack.jpg"

lamina assets upload /Users/me/backpack.jpg --json
# → { data: { url: "https://media.getmason.io/..." } }

# Turn 2 — DETERMINISTIC recipe dispatch
lamina run --recipe-file /Users/me/.lamina/recipes/recipe-2026-05-13-abc.json \
  --input imageUrls="https://media.getmason.io/..." \
  --async --json
# → returns runId immediately (recipe runs typically take 30s-2min)

# Turn 3 — bounded poll
lamina runs wait <runId> --timeout-ms 120000 --json
# → completes; outputs[0].value is the image URL.
#   If status still "running", poll again with another bounded timeout.
```

Key differences from Example A:
- `mode: 'recipe'` ⇒ dispatch with `--recipe-file <path>`, not `<appId>`
- `askUser[0].name === 'imageUrls'` ⇒ literal schema slot, not a label
- Reference-aware model (`nano-banana-pro-edit`) → the human's photo
  actually composites into the output
- Recipe runs are typically slower than app runs → `--async` + bounded
  `runs wait` chunks instead of inline `--wait`

## Saving outputs to disk — `--download <path>`

`--download <path>` saves the result(s) to disk wherever the user names.
Works on `lamina run --wait` and `lamina runs wait <runId>` (any command
that resolves a run terminally). Smart path resolution — the agent just
passes the user's literal path, CLI handles the rest:

- `--download "./public/hero.png"` → single output lands there literally;
  multiple outputs auto-suffix as `hero_0.png`, `hero_1.png`, …
- `--download "./out/"` (folder, trailing slash) → files land inside as
  `label_0.png`, `label_1.png`, …
- `--download "./out/{runId}_{label}_{index}.{ext}"` → advanced template,
  used verbatim. Placeholders: `{runId}` `{index}` `{ext}` `{label}`.

Parent directories are auto-created. In JSON mode, downloaded files
appear under `data.downloads[]` alongside the URLs in `data.outputs[]`.
The download only fires when the run reaches terminal — on chunked polls
of a long job, add `--download <path>` to every poll; it quietly does
nothing until the poll that finally catches terminal.

## Selecting a subset of an app's outputs — `--output <label>`

Many apps produce multiple outputs (e.g. Swift Catalog produces *Front
View*, *Side View*, *Back View*, *Lifestyle View*, ...). When the user's
brief implies they want only some of those, pass `--output "<label>"`
on `lamina run` (repeatable). The labels are visible in
`lamina apps get <appId>`'s `outputs[]` section.

```bash
# Get only Front + Side from Swift Catalog instead of all 5 outputs
lamina run 19fdcc86-... \
  --input front_image_url="<url>" \
  --input back_image_url="<url>" \
  --output "Front View" --output "Side View" \
  --wait --download "./catalog/" --json
```

- Label match is **case-insensitive**.
- If a label matches multiple output nodes (rare — authors usually
  curate via the studio's output-display settings), all matching outputs
  run.
- Unknown labels error with the full list of available outputs.
- Omit `--output` entirely → full workflow runs (all outputs). Same as
  before this flag existed.

Selecting a subset skips the un-needed parts of the workflow — faster
+ fewer credits. Useful when the user explicitly names which views /
variants / cuts they want from a multi-output app.

When `lamina content plan` returns `data.selectedOutputs`, the router has
already done this matching for you — see the **Dispatching a plan ›
`mode: 'app'`** section above for the full dispatch shape.

## Anti-drift rules (when NOT to re-call create / plan)

- **Never re-call `lamina content create` or `lamina content plan` to resolve
  askUser items.** The router committed to an app/recipe in turn 1
  (`selectedApp.appId` or `recipe`). Re-calling the router would run the LLM
  again and may pick a different app or model — silent drift. The asks loop
  **always** dispatches through `lamina run` (which is deterministic, no LLM).
- **DO re-call (the same command) to resolve `needs_clarification` items.**
  That status means the router did NOT commit yet — it paused for a strategic
  answer (preset customization, ambiguous routing, missing platform/scope).
  Ask the human each clarification, fold answers into a refined brief, then
  re-call the same command. This is the explicit exception.
- **The distinction matters:**
  | Response field | What it is | Resolve via |
  |---|---|---|
  | `data.askUser[i]` (inside `status: 'needs_input'` or `'plan'`) | Per-param question on the chosen app — USER-OWNED slot, PRESET option pick (curated options listed inline), `__outputs` subset, or a KNOB the user needs to set | `lamina run --input <name>=<answer>` (or `--output "<label>"` when `name === "__outputs"`) |
  | `data.clarifications[i]` (inside `status: 'needs_clarification'`) | True pre-commit ROUTING ambiguity — the answer would change which app the router picks (banner vs reel vs video, etc.). NEVER fires for preset choices or per-app context questions | Re-call `lamina content create` (or `plan`) with refined brief |
- **`unmatched` is terminal.** Brief is outside Lamina's surface entirely —
  rephrase the brief or use a different tool; don't retry the same brief.
- **Always `lamina assets upload <path>` for local file paths** in askUser
  answers before passing as `--input` values. Asset params expect URLs, not paths.
- **`lamina runs wait <runId>` is polymorphic** — works for both app runs and
  recipe runs. No need to remember which mode you dispatched.
- **Cancel orphaned runs** — if the user changes their mind after dispatch
  (wrong inputs, oversized variant set, abandoned long job) call
  `lamina runs cancel <runId>`. It's idempotent: already-terminal runs return
  their current status without erroring. Don't just stop polling — a queued
  or running execution keeps burning credits until canceled or completed.

## Webhooks (production receivers, dev loop, and what agents should do)

Lamina's webhook model is **per-request** (inherited from fal underneath):
every `lamina run` can attach its own webhook URL. Three personas use this
differently:

**Production integration (your deployed receiver)**

```
lamina run <appId> --input ... --webhook https://yourapp.com/lamina-callback
```

Your server endpoint is permanent; the flag is just per-call data routing.
For convenience save it once:

```
lamina webhook listen \
  --public-url https://yourapp.com/lamina-callback \
  --save-default
```

After that, **every `lamina run` auto-attaches the saved URL**. No flag
needed. Per-call override with `--webhook <other-url>`; per-call opt-out
with `--no-webhook` (or `--webhook none`). Inspect with `lamina webhook
status`, clear with `lamina webhook clear`.

The webhook payload shape (same for app and recipe runs):

```json
{
  "data": {
    "runId": "...",
    "status": "completed",   // or "failed"
    "outputs": [{ "url": "...", "type": "image", ... }],
    "completedAt": "..."
  }
}
```

Signed with Ed25519 — verify against the workspace public key from
`lamina webhook signing-key`.

**Developer building such a receiver**

`lamina webhook listen` (no `--save-default`) acts like `stripe listen` —
a local HTTP server that verifies signatures and prints deliveries to
stdout. Pair it with an ngrok / cloudflared tunnel so Lamina can reach
your laptop. Use it to develop your real receiver code, then deploy and
stop using `lamina webhook listen`.

**Chat agent (Claude Code, Cursor, etc.)**

Chat agents have no persistent URL Lamina can call back to — webhooks
don't fit. Stick to the `--async` + bounded `lamina runs wait` chunks
pattern (rule 5). If a default webhook URL happens to be saved on the
host machine, dispatches will silently attach it; that's fine — the
listener (if any) prints events and the agent continues polling.

## Auth + endpoint resolution

The CLI resolves credentials in this order:

1. `LAMINA_API_KEY` environment variable
2. `~/.lamina/config.json` (saved by `lamina login` — supports both browser
   OAuth tokens and CI-issued workspace API keys)

Default endpoint is `https://app.uselamina.ai`. Override with
`LAMINA_BASE_URL=https://...` for non-default origins (rare; mostly for
internal staging).

## Output format

- **Default (TTY):** human-readable text — table for lists, key-value for
  detail, multi-line for run outputs.
- **`--json`:** structured JSON envelope. Successful commands write
  `{ data: ... }` to stdout. Failed commands write
  `{ error: "...", code: "...", hint: "...", exitCode: 1 }` to stderr.
- **Always pipe-friendly:** errors go to stderr, data to stdout. You can
  parse stdout with `jq` / your JSON parser without filtering noise.

## What apps cover (and what they don't)

Apps are curated for the most common production workflows. As of writing:

- Selfie / portrait / try-on apps (image editing with identity preservation)
- Cinematic / commercial / product-shot apps
- Video reveals + image-to-video apps
- Storytelling / multi-shot apps
- Brand-aware variants of all of the above

If `lamina apps list --search` returns nothing for a niche request, that
request is currently outside Lamina's curated surface. **Do NOT try to call
fal.ai / OpenAI / Replicate / etc. directly.** The user asked for Lamina;
tell them their request is outside the catalog and ask whether they want
something close that exists, or if they want to use a different tool.

## Examples

```bash
# Make a celebrity selfie
lamina apps list --search selfie --json
# → pick e0124407-d57a-4f76-ac5a-be0041e55a24
lamina apps get e0124407-d57a-4f76-ac5a-be0041e55a24 --json
# → parameters: your_photo_image_url, celebrity_text, ai_designer_aspect_ratio
lamina assets upload ./me.jpg --json
# → "url": "https://media.getmason.io/..."
lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 \
  --input your_photo_image_url="https://media.getmason.io/..." \
  --input celebrity_text="Tom Holland" \
  --wait --json
# → outputs[0].value is the result image URL
```

```bash
# Look up something in the docs without leaving the terminal
lamina docs "webhook signing" --json
# → { results: [{title, url, snippet}, ...] }
```

```bash
# Plan from a vague brief
lamina content plan "social hero image for our SaaS launch" --json
# → server picks an app or emits a recipe; returns a plan (never dispatches).
#   Follow up with `lamina run <appId>` or `lamina run --recipe-file <path>`.
```

## Where to look for more

- Per-command help: `lamina <cmd> --help`
- Docs search: `lamina docs "<topic>" --json`
- Hosted MCP integration (alternative to CLI for agents):
  `https://app.uselamina.ai/mcp/agent`
