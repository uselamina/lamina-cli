---
name: lamina-apps
description: >
  Discover, inspect, and run Lamina Apps — curated multi-step workflows
  authored by humans (e.g. "selfie with celebrity", "virtual try-on",
  "product catalog shoot"). Use this skill when the user wants to browse
  apps, knows the appId they want to run, or has a concrete enough intent
  that you can pick an app directly. For a vague free-text brief that
  needs the router to choose, use `lamina-content`. For atomic
  model-pinned dispatch, use `lamina-models`.
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina Apps — curated workflows

Apps in the workspace are multi-step workflows tuned end-to-end by
humans. They handle the orchestration: which models to chain, what
prompt scaffolding to apply, how to composite outputs. Brand
intelligence (workspace brand DNA) is woven in automatically when the
app is configured for it.

Apps are the **canonical path** for any production task. Always check
the app catalog before falling back to atomic models or the freestyle
recipe path.

## The flow — three commands

```
1. lamina apps list <keyword1> <keyword2> ... --json    → discovery
2. lamina apps get <appId> --json                       → parameter contract
3. lamina assets upload <local-file> --json             → (if user gave a path)
4. lamina run <appId> --input <name>=<value> --wait     → dispatch
```

## 1. Discovery — `lamina apps list`

`lamina apps list <kw1> <kw2> ... --json` takes positional keywords and
routes through the **same scored matcher the MCP `lamina_discover` tool
uses** (SQL prefilter + JS scorer with intent analysis + popularity
ranking). Pass everything that captures the user's intent in one call;
the server does the union + scoring.

How to pick keywords from a brief — combine 3–6 angles in one call:

- **Medium** — `image`, `video`, `audio`
- **Form / output kind** — `reel`, `hero`, `banner`, `headshot`,
  `portrait`, `pack shot`, `try-on`, `lookbook`, `catalog`
- **Context / channel** — `ecommerce`, `social`, `lifestyle`,
  `editorial`, `Instagram`, `story`, `ad`
- **Subject domain** if the brief named one — `apparel`, `eyewear`,
  `jewelry`, `food`, `cosmetics`
- **Aspect / format** when explicit — `9:16`, `16:9`, `square`

```
# "make me a selfie with a celebrity"
lamina apps list selfie celebrity portrait identity --json

# "product video reel for our new sneaker"
lamina apps list "product video" reel 9:16 ecommerce --json

# "editorial hero shot for the founder"
lamina apps list "hero shot" editorial lifestyle portrait --json
```

Quote multi-word keywords (`"hero shot"`) so the shell passes them as
one positional. `apps list` with no keywords is **browse mode** —
returns top apps by popularity, capped by `--limit`.

If the first call's candidates don't fit the brief's actual subject,
rephrase with different angles and call again. **Only fall back to the
recipe path (`lamina-content` skill) after you're confident no app in
the workspace covers the brief.**

## 2. Read each candidate's `description` as a whole sentence

Don't keyword-match. Ask: what does this app *actually deliver*? Watch
for context cues:

| Cue in description | Means | When it fits |
|---|---|---|
| "Salesforce / PDP / storefront / ecommerce" | Catalog output | Bulk product imagery for stores. WRONG for editorial. |
| "editorial / cinematic / hero / magazine" | Editorial single-shot | Founder / lifestyle / brand-story shots. |
| "on-model / try-on" + a clothing word | Garment-on-person | Apparel try-on, not generic portraits. |
| "pack shot / product shot / clean catalog" | Studio product photo | When the product IS the subject. |
| "reel / social / Instagram / story" | Social channel output | Platform-specific format. |

## 3. Parameter contract — `lamina apps get <appId>`

Returns the full input spec — names, types, defaults, options,
must-supply markers. **Required inputs without defaults MUST be
supplied or the run fails.** Read the spec, decide which inputs you
have from the brief, ask the human for the rest.

For each `url`-typed param the app needs (product photo, headshot,
logo): ask the human; for local file paths run
`lamina assets upload <path> --json` first to get a CDN URL.

## 4. Dispatch — `lamina run <appId>`

Bound the wait by expected duration (the agent must NOT hang on a
single command > 3 minutes):

```bash
# Fast image work (~10–30s)
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

`lamina runs wait <runId>` is polymorphic — works for app runs, recipe
runs, AND atomic generate runs. One status surface.

## Saving outputs to disk — `--download <path>`

Add to any `lamina run --wait` (or to `lamina runs wait` on terminal):

- `--download "./public/hero.png"` → single output lands there; multiple
  outputs auto-suffix as `hero_0.png`, `hero_1.png`, …
- `--download "./out/"` (folder, trailing slash) → files land inside as
  `label_0.png`, `label_1.png`, …
- `--download "./out/{runId}_{label}_{index}.{ext}"` → advanced template,
  used verbatim. Placeholders: `{runId}` `{index}` `{ext}` `{label}`.

In JSON mode, downloaded files appear under `data.downloads[]` alongside
URLs in `data.outputs[]`.

## Selecting a subset of an app's outputs — `--output <label>`

Many apps produce multiple outputs (e.g. a catalog app produces *Front
View*, *Side View*, *Back View*, *Lifestyle View*, ...). When the
user's brief implies they want only some, pass `--output "<label>"`
on `lamina run` (repeatable). Labels are visible in
`lamina apps get <appId>`'s `outputs[]` section.

```bash
# Run only Front + Side from a 5-output catalog app
lamina run 19fdcc86-... \
  --input front_image_url="<url>" \
  --input back_image_url="<url>" \
  --output "Front View" --output "Side View" \
  --wait --download "./catalog/" --json
```

- Label match is **case-insensitive**.
- Unknown labels error with the full list of available outputs.
- Omit `--output` entirely → full workflow runs (all outputs).

Selecting a subset skips un-needed workflow nodes — faster + fewer
credits.

## Cancel orphaned runs

`lamina runs cancel <runId>` — idempotent. Use when the user changes
their mind after dispatch. Already-terminal runs return their current
status without erroring. Don't just stop polling — a queued or running
execution keeps burning credits until canceled or completed.

## Worked example — selfie via direct app discovery

```bash
# Search the catalog
lamina apps list selfie celebrity portrait identity --json
# → pick e0124407-d57a-4f76-ac5a-be0041e55a24

# Read its parameter contract
lamina apps get e0124407-d57a-4f76-ac5a-be0041e55a24 --json
# → parameters: your_photo_image_url, celebrity_text, ai_designer_aspect_ratio

# Upload the user's photo (they gave a local path)
lamina assets upload ./me.jpg --json
# → { data: { url: "https://media.getmason.io/..." } }

# Dispatch
lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 \
  --input your_photo_image_url="https://media.getmason.io/..." \
  --input celebrity_text="Tom Holland" \
  --wait --timeout-ms 60000 --json
# → outputs[0].value is the result image URL
```

## What apps cover (and what they don't)

Apps are curated for the most common production workflows. As of writing:

- Selfie / portrait / try-on apps (image editing with identity preservation)
- Cinematic / commercial / product-shot apps
- Video reveals + image-to-video apps
- Storytelling / multi-shot apps
- Brand-aware variants of all of the above

If `lamina apps list` returns nothing for a niche request, that request
is currently outside Lamina's curated app surface. Two fallbacks:

1. **Atomic dispatch** (`lamina-models` skill) — pick a model directly
2. **Recipe path** (`lamina-content` skill) — let the router emit a
   freestyle recipe

**Do NOT call fal.ai / OpenAI / Replicate / etc. directly.** The user
asked for Lamina; either use Lamina's surface or tell them the request
is outside the catalog.

## Hard rules — apply on every app run

1. **Don't invent appIds or parameter names.** Every appId comes from
   `lamina apps list`; every parameter name comes from `lamina apps get
   <appId>`. Guessing produces 404 / 422 errors.

2. **One Bash tool call per `lamina` command.** No shell substitutions
   (`RES=$(lamina apps list --json)`), no pipes mid-command. Read the
   JSON response from the tool result.

3. **Always `lamina assets upload <path>` for local file paths** before
   passing as `--input` values. Asset params expect URLs, not paths.

4. **Brand intelligence is automatic on app runs.** Apps already pull
   workspace brand DNA when configured. Don't try to inject brand
   context manually. To inspect brand context, load the
   `lamina-intelligence` skill.
