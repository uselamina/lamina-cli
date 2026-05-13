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
  version: "0.5.4"
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

2. **Apps are the curated path. Always start with `lamina apps list --search
   "<keyword>" --json`.** Apps are workflows that a human author has tuned
   end to end. Use them before considering anything else.

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
| `lamina apps list [--search <q>]` | Discover apps |
| `lamina apps get <appId>` | Parameter contract for one app |
| `lamina assets upload <path>` | Upload local file → CDN URL |
| `lamina run <appId> --input k=v --wait` | Execute an app (add `--download <template>` to also save outputs to disk) |
| `lamina runs get <runId>` | Snapshot run status |
| `lamina runs wait <runId>` | Block until terminal |
| `lamina content plan "<brief>"` | Brief → app or recipe routing (LLM, never dispatches). Returns a plan you act on with `lamina run`. |
| `lamina run <appId> ...` | Execute a catalog app (deterministic, no LLM) |
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

## The canonical agent flow — plan once, then run

Two entry patterns depending on how concrete the user's intent is:

- **Known intent** ("use the selfie app", "run app X with these inputs",
  "give me a virtual try-on") → go direct: `lamina apps list --search` →
  `lamina apps get <appId>` → `lamina run <appId> --input ...`. No `plan`
  needed. See "Direct app discovery" below for how to search + evaluate.
- **Vague creative brief** ("make me a hero image", "selfie with Brad
  Pitt", "moody dawn scene", "cinematic founder shot") → use `plan`.
  The router agent decides between an app and a freestyle recipe for
  you, and emits asks for inputs it can't infer. `plan` is the **only**
  path that can fall back to a recipe — direct app discovery can't.

The vague-brief flow:

```
1. (if the user gave a local file path)
   lamina assets upload <path> --json
   → grab .data.url; you'll pass it as a --input value below

2. lamina content plan "<the user's brief>" \
     [--modality image|video] [--platform <name>] [--app-id <pinned-id>] \
     [--input <name>=<value>]* --json
   → one LLM call. Returns the agent's decision (an app, or a recipe).

3. Branch on data.status:
     'plan'                → see "Dispatching a plan" below.
     'needs_clarification' → ask the human the questions in askUser,
                             refine the brief, re-call `lamina content plan`.
                             (Only status where re-calling plan is correct.)
     'unmatched'           → brief is outside Lamina's surface (not a visual
                             creative request, or no model can deliver in
                             one generation). Tell the human, suggest
                             rephrasing or a different tool.

4. Surface outputs to the user. Done.
```

`plan` is the **only** LLM-driven step. The dispatch step (`lamina run`) is
deterministic — pure schema validation + workflow dispatch, no LLM. That
means **the agent's decision binds**: once `plan` returns a `selectedApp.appId`
or a recipe, `lamina run` honors it exactly. No drift across turns.

## Direct app discovery (the non-plan path)

When the user's intent is concrete enough that you (the agent) can pick
an app yourself, skip `plan` and search directly. Three steps:

1. **Search with the brief's intent keywords**, not the user's literal
   words. If the brief says "make a selfie with a celebrity", search
   for `selfie`, then if needed `celebrity portrait`, then if needed
   `portrait identity`. Run 1-2 searches max — `apps list` returns
   many results per query.

   ```
   lamina apps list --search selfie --json
   ```

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

```
data = response.data
# data has: selectedApp.appId, draftedInputs, askUser, warnings

if data.askUser is non-empty:
  for each askUser item { name, question }:
    ASK the human the question in chat
    collect the answer
    if the answer is a local file path:
      run `lamina assets upload <path> --json` → use returned .data.url

# Dispatch: pass drafted inputs AND asked answers.
lamina run <data.selectedApp.appId> \
  --input <each drafted key>=<value> \
  --input <each asked name>=<answer> \
  --wait --json
# → data.outputs[].value are the result URLs.
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

## Anti-drift rules (when NOT to re-call plan)

- **Never re-call `lamina content plan` to resolve askUser items.** The agent
  made a decision in turn 1 (`selectedApp.appId` or `recipe`). Re-calling plan
  would run the LLM again and may pick a different app or model — silent
  drift. The asks loop **always** dispatches through `lamina run`.
- **DO re-call `plan` with a refined brief** ONLY when the response is
  `status: "needs_clarification"`. That's the explicit signal that the
  agent didn't commit to anything yet and needs a tighter brief. (Re-calling
  on `unmatched` won't help — that status means the brief is outside
  Lamina's surface entirely; rephrase or use a different tool.)
- **Always `lamina assets upload <path>` for local file paths** in askUser
  answers before passing as `--input` values. Asset params expect URLs, not paths.
- **`lamina runs wait <runId>` is polymorphic** — works for both app runs and
  recipe runs. No need to remember which mode you dispatched.

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
