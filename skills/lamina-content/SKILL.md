---
name: lamina-content
description: >
  Plan and run from a natural-language creative brief. Use this skill when
  the user gives a vague creative intent ("make me a hero image", "selfie
  with Brad Pitt", "moody dawn scene", "cinematic founder shot") and you
  want the router agent to pick the right Lamina App — or fall back to a
  freestyle recipe when no app fits. Covers `lamina content create` and
  `lamina content plan`. For directly running a known app by id, use
  `lamina-apps`. For model-pinned atomic dispatch, use `lamina-models`.
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina Content — agentic routing from free-text briefs

`lamina content create` is the **one LLM-driven step** in the agent loop.
It takes a free-text brief, picks the best app (or emits a freestyle
recipe when no app fits), drafts the inputs it can infer from the brief,
and **dispatches automatically when the brief has enough context**.
Otherwise it returns the missing inputs for you to provide via
`lamina run`.

Once the router commits to an `appId` or `recipe`, the dispatch step
(`lamina run`) is deterministic — no LLM, no drift. The agent's choice
binds.

## Two commands

| Command | What it does |
|---|---|
| `lamina content create "<brief>"` | Router picks an app/recipe, drafts inputs, **auto-dispatches when sufficient**. Returns `ran` / `needs_input` / `needs_clarification` / `unmatched`. |
| `lamina content plan "<brief>"` | Preview-only sibling — same routing tree but NEVER dispatches. Use for dry-runs, debug, CI preview. |

For the regular agentic flow, use `create`. Use `plan` only when you
explicitly want to inspect the routing decision before committing.

## The flow

```
1. (if the user gave a local file path)
   lamina assets upload <path> --json
   → grab .data.url; you'll pass it as a --input value below

2. lamina content create "<brief>" \
     [--modality image|video] [--platform <name>] [--app-id <pinned-id>] \
     [--input <name>=<value>]* --json
   → one LLM call. Either dispatches the run OR returns asks/clarifications.

3. Branch on data.status:
     'ran'                 → dispatched. data.runId is ready. Poll with
                             `lamina runs wait <runId>` (or pass --wait
                             on the create call to block here). Surface
                             outputs to the user.
     'needs_input'         → router committed to an app/recipe but needs
                             specific values you must supply. Ask the
                             human each item in data.askUser, then
                             dispatch DETERMINISTICALLY via `lamina run`
                             with the selectedApp.appId from the
                             response. NEVER re-call `content create`
                             here — that would re-roll the router LLM.
     'needs_clarification' → router paused before committing because the
                             brief is genuinely ambiguous between TWO
                             OR MORE apps (true pre-commit ROUTING
                             ambiguity — e.g. banner vs reel vs video).
                             Ask the human each item in
                             data.clarifications, fold answers into a
                             refined brief, then RE-CALL `lamina content
                             create`. This is the ONLY status where
                             re-calling create is correct.
     'unmatched'           → brief is outside Lamina's surface. Tell the
                             human; suggest rephrasing. Never retry.

4. Surface outputs to the user. Done.
```

## Dispatching a plan — `mode: 'app'`

Shape of the response data (all fields the agent reads):

| field | what it is | dispatches as |
|---|---|---|
| `selectedApp.appId` | The app the router committed to | first positional arg of `lamina run` |
| `selectedApp.rationale` | One-sentence why this app fits | informational — surface to human if useful |
| `draftedInputs` | Inputs the router pre-filled from the brief | one `--input <key>=<value>` per entry |
| `askUser` *(may be empty)* | Questions the human must answer (USER-OWNED slots, PRESET option picks, output subsetting, KNOBs) | one `--input <name>=<answer>` per entry **EXCEPT** when `name === "__outputs"` (see below) |
| `selectedOutputs` *(may be absent)* | Output labels the router picked already (envelope narrowing) | one `--output "<label>"` per entry |
| `warnings` *(may be empty)* | Soft mismatches (e.g. brief said 9:16 but app has no aspect param) | surface to human as FYI; doesn't block dispatch |

**Reading `askUser` correctly — three flavors:**

1. **USER-OWNED slot** (e.g. `name: "product_image_1_image_url"`): the
   human supplies a URL (or local path → `lamina assets upload` first).
   Pass as `--input <name>=<url>`.
2. **PRESET option choice** (e.g. `name: "background_text"`, question
   lists `Beach / Desert / Tropical / Urban / ... or say 'default'`):
   surface the **option list verbatim** to the human — they can't guess
   what's available. Their answer is one of the listed labels OR the
   literal string `default`. Pass as `--input <name>=<chosen-label>`
   (omit entirely if they said `default` — the app's curated default
   fires automatically).
3. **`__outputs` (reserved name)** — fires when the brief is silent on
   which of an app's semantically-distinct outputs to produce. Question
   describes available labels. Human answers with a list. Pass each as
   `--output "<label>"` (NOT `--input` — `__outputs` is never a real
   app parameter).

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
```

**Rules for the dispatch:**

1. **Drafted inputs are non-negotiable** — pass every key in
   `data.draftedInputs` verbatim. They're the router's committed values
   from the brief; skipping them changes the run.
2. **One `--input` per asked answer** — match the answer to
   `askUser[i].name`.
3. **`--output` flags are conditional on `data.selectedOutputs`**:
   - Absent / empty → omit `--output` entirely → workflow runs ALL outputs.
   - Present with labels → one `--output "<label>"` per entry. Quote
     labels (they may contain spaces).
4. **No second LLM call** — once you have the plan, dispatch is
   mechanical. Never re-call `lamina content plan` to "double-check".
5. **The pretty-print CLI shows the exact next command** — if running
   interactively, the `Next:` block in `lamina content plan`'s output
   has the literal command with `--output` flags pre-filled.

## Dispatching a plan — `mode: 'recipe'`

When no app's purpose fits the brief, the router emits a **recipe** —
a per-variant spec (`imageModel`, `imageParams`, `prompt`, `styleHint`).
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

### `imageUrls` — the reference-image convention on the recipe path

Some recipe models are **reference-aware** — they composite user-supplied
images into the output (e.g. "founder wearing OUR backpack"). When the
router picks one of these models, the response shape is:

- Variant declares `imageParams.imageUrls: []` as a placeholder
- `askUser` contains one entry with `name: "imageUrls"` (the **literal
  schema slot key**, not a free-text label) and a natural-language question

Reference-aware models in the registry today: `nano-banana-pro-edit`
(max 14 refs), `seedream-4.5-edit` (max 10), `gpt-image-2-edit-image`
(max 16), `ideogram-v3` (max 3, optional). Text-only models have no
`imageUrls` in their schema — the router picks them when no user asset
is needed.

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

## Worked example A — selfie via plan + run (app path)

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

## Worked example B — founder shot via plan + run (recipe path)

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
# → returns runId immediately (recipe runs typically take 30s–2min)

# Turn 3 — bounded poll
lamina runs wait <runId> --timeout-ms 120000 --json
# → completes; outputs[0].value is the image URL.
```

Key differences from Example A:
- `mode: 'recipe'` ⇒ dispatch with `--recipe-file <path>`, not `<appId>`
- `askUser[0].name === 'imageUrls'` ⇒ literal schema slot, not a label
- Reference-aware model (`nano-banana-pro-edit`) → the human's photo
  composites into the output
- Recipe runs are typically slower than app runs → `--async` + bounded
  `runs wait` chunks instead of inline `--wait`

## `plan` vs direct app discovery — what `plan` adds

Direct discovery (load the `lamina-apps` skill) is fine when you can
confidently pick the app. `plan` adds these on top:

- **Recipe fallback** when no app's purpose fits the brief — direct
  discovery has no recipe path
- **Drafted inputs** — `plan` pre-fills any inferable text params from
  the brief (e.g. `celebrity_text: "Tom Holland"`). Direct discovery
  means YOU draft those values from the brief yourself.
- **Smart asks** — `plan` only asks for what it can't infer
- **Reference-image convention** — when `plan` picks a reference-aware
  recipe model, it sets `imageUrls: []` and emits an ask with `name:
  "imageUrls"` — the CLI dispatch knows how to merge

**Hard rule:** if direct `apps list` returns no candidate whose
`description` matches the brief's actual subject, switch to
`lamina content plan` immediately — it's the only path that can
recipe-fall-back.

## Anti-drift rules (when NOT to re-call create / plan)

- **Never re-call `lamina content create` or `lamina content plan` to
  resolve `askUser` items.** The router committed to an app/recipe in
  turn 1 (`selectedApp.appId` or `recipe`). Re-calling would run the LLM
  again and may pick a different app/model — silent drift. The asks
  loop **always** dispatches through `lamina run` (deterministic, no
  LLM).
- **DO re-call (the same command) to resolve `needs_clarification`
  items.** That status means the router did NOT commit yet — it paused
  for a strategic answer. Ask the human, fold answers into a refined
  brief, re-call. This is the explicit exception.
- **`unmatched` is terminal.** Brief is outside Lamina's surface
  entirely — rephrase or use a different tool; don't retry.

The distinction:

| Response field | What it is | Resolve via |
|---|---|---|
| `data.askUser[i]` (inside `status: 'needs_input'` or `'plan'`) | Per-param question on the chosen app | `lamina run --input <name>=<answer>` (or `--output "<label>"` when `name === "__outputs"`) |
| `data.clarifications[i]` (inside `status: 'needs_clarification'`) | True pre-commit ROUTING ambiguity | Re-call `lamina content create` (or `plan`) with refined brief |
