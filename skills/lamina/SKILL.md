---
name: lamina
description: |
  Lamina CLI for branded ecommerce media generation. Foundational skill
  covering the whole CLI surface. Use when the user says: "use lamina",
  "run a Lamina app", "generate a product shot", "make a banner",
  "make a try-on", "make a reel", "make a UGC video", "make an Amazon
  A+ listing", "multi-language adapt", "upload to Lamina", "list
  apps", "find an app for X", "create from this brief", "plan from
  this brief", "give me content ideas", "score our published content",
  "what does Lamina know about my brand", "predict if this content
  will work", "what should I post", "trending patterns", "generate
  with model X", or any direct interaction with uselamina.ai. Three
  surfaces — Apps (curated workflows), Models (direct image/video
  generation), Content router (free-text shortcut) — all part of this
  one foundational skill. See `references/` for deep catalog +
  worked examples.
argument-hint: "[brief-or-command] [--flags]"
allowed-tools: Bash
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina CLI — foundational skill

`lamina` is the agent-first CLI for the Lamina workspace platform
(uselamina.ai). Three surfaces, one skill:

- **Apps** — curated multi-step ecommerce workflows authored by humans
  (product catalog, try-on, banners, reels, marketplace listings,
  multi-language adapts). The canonical production path.
- **Models** — direct image/video generation when you know the model.
- **Content router** — free-text brief → server-side LLM picks an App
  or returns unmatched when no App fits. A shortcut alternative to doing app
  search yourself; useful for ideation and brand scoring.

This skill covers all three at the depth needed for the agent to
decide + dispatch. Deeper material (full app catalog, detailed worked
examples, content router response structures, model dispatch nuances)
lives in `references/` and is loaded on demand.

## Step 0 — Bootstrap

Before any other command:

1. **Skills install.** `lamina init` drops this skill (with `references/`) into `.claude/skills/lamina/`. Idempotent; re-run with `--force` after a CLI upgrade to refresh.
2. **Auth.** If `lamina whoami` fails, run `lamina login` (browser OAuth) and wait for completion. CI: `lamina login --api-key <lma_…>` or `LAMINA_API_KEY=...`.

## Command surface

### Setup & docs

- `lamina init [--force]` — install this skill into `.claude/skills/lamina/`.
- `lamina docs "<query>"` — search Lamina docs from the terminal.

### Auth

- `lamina login [--api-key <key>]` — browser OAuth or CI key.
- `lamina logout` — clear stored credentials.
- `lamina whoami` — identity + active workspace.

### Assets

- `lamina assets upload <path>` — upload local file → CDN URL. Cross-cutting: used by Apps (url-typed inputs), direct model dispatch (URL-typed fields in `paramSchema`), and content briefs with media.

### Apps (curated workflows)

- `lamina apps list [<kw1> <kw2> ...]` — discover apps. Smart scored matcher; combine 3–6 angles (medium + form + context + subject + aspect) in one call.
- `lamina apps get <appId>` — full input contract (`parameters` + `outputs`) for one app.

### Run + runs (polymorphic — apps + models)

- `lamina run <appId> --input <key>=<value>` — dispatch an App.
- `lamina runs get <runId>` — current status.
- `lamina runs wait <runId>` — block until terminal.
- `lamina runs cancel <runId>` — cancel queued / running (idempotent).

### Models

- `lamina models list [--modality image|video]` — list models. Filter by modality only (`image` / `video`). No keyword search, no category filter.
- `lamina models describe <id>` — flat input contract (`paramSchema`) for one model.
- `lamina generate image --model <id> [--prompt "..."] [--params '<json>']` — every image dispatch (text-to-image, image-to-image, edit, background-remove, remix). Model id discriminates.
- `lamina generate video --model <id> [--prompt "..."] [--params '<json>']` — every video dispatch (text-to-video, image-to-video, video-to-video, motion-control, reference-to-video, keyframe).

### Content router

- `lamina content create "<brief>"` — router picks an App, drafts inputs from the brief, auto-dispatches when sufficient. Returns `needs_input` / `needs_clarification` / `ran` / `unmatched`. Shortcut alternative to doing app search + input drafting yourself client-side.
- `lamina content plan "<brief>"` — preview-only sibling of `create`; same routing, never dispatches. When no App fits, returns `unmatched` — agent falls back to direct model dispatch using vertical-skill knowledge.
- `lamina content brief "<goal>"` — goal → 1+ structured content concepts (`{ title, prompt, platform, modality, format, predictedPerformance, rationale }`). Ideation, no dispatch.
- `lamina content score [--platform <p>] [--modality <m>] [--limit <n>]` — score this workspace's published content against brand standards. Requires connected content sources (Salesforce / Shopify / social) — returns `0`s when sources aren't connected.

### Brand intelligence

Returns what the workspace's content-intelligence layer has captured. Data is sparse for newly-onboarded workspaces, richer once brand assets (voice, palette, positioning, audience) are configured. Be honest with the user about response shape.

- `lamina intelligence brand-context` — workspace brand DNA + active guidance + top patterns.
- `lamina intelligence predict "<concept>"` — performance prediction for a concept idea.
- `lamina intelligence recommendations` — actionable content recommendations.
- `lamina intelligence trends [--window <days>]` — top / emerging / declining patterns by window.

### Webhooks

- `lamina webhook listen` — local HTTP listener that verifies + prints incoming deliveries.
- `lamina webhook listen --public-url <url> --save-default` — save a default forwarding URL auto-attached to every dispatch.
- `lamina webhook status` / `clear` — inspect / clear the saved default.
- `lamina webhook signing-key` — Ed25519 public keys for verifying payload signatures.

## Using Apps

A Lamina App is a packaged production workflow for product, brand, and commerce media — ecommerce essentials, product launch campaigns, catalog photography, try-on, banners, reels, marketplace listings, multi-language adapts, and more, with new app categories added over time. Each App declares its typed inputs and outputs so the agent can read the contract and dispatch.

**Command flow:**

```bash
lamina apps list                                      # find appIds
lamina apps get <appId>                               # see parameters + outputs
lamina assets upload <path>                           # local file -> URL
lamina run <appId> --input <key>=<value> [--output "<label>"] --wait
```

**Input contract.** `lamina apps get <appId>` returns the appId, a `parameters[]` array, and an `outputs[]` array:

```json
{
  "appId": "...",
  "parameters": [
    { "key": "product_image", "type": "url",     "accept": ["image"] },
    { "key": "prompt",        "type": "text" },
    { "key": "aspect_ratio",  "type": "options", "options": ["1:1","16:9","9:16"], "default": "1:1" }
  ],
  "outputs": [
    { "label": "hero",      "type": "image" },
    { "label": "lifestyle", "type": "image" }
  ]
}
```

Field semantics:

- `type: "text"` — free-form string.
- `type: "url"` — URL value. `accept` lists allowed asset kinds (`image`, `video`, `audio`). Local paths must be uploaded via `lamina assets upload` first; pass the returned URL.
- `type: "options"` — value must be one of `options[]`.
- `default` — server uses this when `--input <key>` is omitted.

**Outputs.** When `outputs.length > 1`, subset with repeated `--output "<label>"` (exact label from the contract). Omit to return all.

### Featured app catalog by trending ecommerce vertical

A mental map for the most common brand use cases. Use these as a routing shortcut; for anything else, search via `lamina apps list <keywords>`. All app names verified live in the public catalog.

**Catalog photography** — Product Catalog (SFCC), Product Catalog for Shopify Stores, Swift Catalog 2.0, Swift Catalog 3.0, Premium Catalog 1.0, Fast Fashion Catalog App, Ethnic Wear Catalog Images, Saree Catalog, Swimsuit Catalog Images

**Try-on / on-model** — Virtual Try-on, Single Garment Try-on, Double Garment Try-on, Saree Try On, Make Up Try On

**Banners + multi-aspect adaptation** — Collection Banner Maker, Multi Product Banner Maker, Multi Language Adapts, Performance Banners, Performance Ad Maker, Remarketing Ad Maker

**Branded video + reels** — Performance Video, Product Reels (Seedance 2.0), Quick Reel Maker, Apparel Photoshoot, Product Launch Video, Combined Looks

**UGC / creator content** — UGC Maker, UGC Ads for Services

**Marketplace** — A+ Content Maker

**Specialty / jewelry / accessories** — Jewelry Catalog, Necklace and Earrings, Eyewear Shoot, Luxury Watch Advertisement, Room Visualizer, Add Logo or Branding, Update Product Packaging

For **4 worked examples covering distinct dispatch patterns** (single-upload baseline, multi-upload with heavy subset, many curated options, async video), see `references/apps.md` — load when actually doing the dispatch work.

## Using models

Direct image/video generation when you know the model.

**Command flow:**

```bash
lamina models list [--modality image|video]              # find model IDs
lamina models describe <id>                              # see paramSchema
lamina assets upload <path>                              # local file -> URL
lamina generate image|video --model <id> --prompt "..." [--params '<json>'] --wait
```

**Input contract.** `lamina models describe <id>` returns the model id, modality, and a flat `paramSchema` keyed by field name. Each field carries its own typed shape — type, accepted values, defaults, range bounds, asset-kind constraints, etc. — described in the JSON itself. Field names and shapes vary widely by model; the agent reads whatever `paramSchema` returns and builds `--params` from it.

**Two verbs, model id discriminates.** No separate verb for edit / image-to-video / motion-control — the model id picks the operation, and required URL fields come from the `paramSchema`.

- **Hybrid image models** flip text-to-image / image-to-image based on whether `params.imageUrls` is provided (`nano-banana-pro`, `nano-banana-2`, `gpt-image-1`, `gpt-image-1.5`, `gpt-image-2`, `seedream-4.5`, `flux-2-flex`, `gemini-2.5-flash-image`).
- **Vertex-backed sync models** return inline — `--wait` resolves on the first poll: `imagen-4.0-fast-generate-001`, `imagen-4.0-generate-001`, `imagen-4.0-ultra-generate-001`, `gemini-2.5-flash-image`, `veo3-text-to-video`, `veo3-image-to-video`, `veo3-first-frame-to-video`, `veo3-keyframe-to-video`.
- **Multi-shot mode** — `multiShot: true` + `multiPrompt[]` (per-shot `prompt` + `duration`, 1–5 shots, total ≤15s) — is supported by `kling-o3-standard/pro-image-to-video` and `kling-v3-standard/pro-image-to-video`. Read each model's `paramSchema` for the exact field shape.

## Using the content router

A shortcut — the server already encodes App discovery + input drafting + contract understanding. One call returns everything the agent needs to dispatch (or learns there's no App match).

Useful when:

1. You want the server to pick the App for you instead of running your own search.
2. You want concept ideation (`content brief`) — unique surface, no client-side equivalent.
3. You want brand-fit scoring of already-published content (`content score`) — unique surface.

**Flow:** `content plan "<brief>"` (preview) or `content create "<brief>"` (dispatches when ready) → read the response → if `status: 'plan'` or `'needs_input'`, transition to the apps flow via `lamina run`. **Never re-call content** after the router has picked — the dispatch is deterministic from there.

**When no App fits.** Status comes back as `unmatched`. The router does NOT generate a freestyle recipe — that path is removed. Agent should fall back to direct model dispatch (`lamina generate image/video`) using whatever vertical-skill knowledge it has loaded for the brief's use case. For genuinely outside-the-platform briefs, surface that to the user.

**`content score` data state.** Requires connected content sources (Salesforce / Shopify / social). Returns empty `scores: []` until sources are wired.

For full response branching (status table + App-mode dispatch deep dive + worked examples), see `references/content-router.md`.

## Brand intelligence

The four `intelligence` commands return what the workspace's content-intelligence layer has captured. **Data is sparse for newly-onboarded workspaces** — `brandDna: null`, `topPatterns: []`. As the workspace ingests brand assets (voice, palette, positioning, audience), the responses get richer. Surface this honestly to the user; don't pretend the layer is fully populated when it isn't.

The commands work today; the data behind them improves as the workspace matures. They're worth calling when:
- User asks "what does Lamina know about my brand?" → `intelligence brand-context`
- User asks "what should I post next?" → `intelligence recommendations`
- User asks "will this concept perform well?" → `intelligence predict "<concept>"`
- User asks "what's trending / what's working?" → `intelligence trends`

## Output / auth / timeouts

**Output**: TTY = human-readable; `--json` = bare JSON (no envelope). Errors → stderr in JSON mode. Force JSON in TTY with `LAMINA_OUTPUT=json`.

**Timeouts** — never hang a single command for more than ~3 minutes:

| Expected duration | Pattern |
|---|---|
| Fast image (10–30s) | `--wait --timeout-ms 60000` |
| Multi-variant / short recipe (30s–2min) | `--wait --timeout-ms 180000` |
| Video / unknown (≥2min) | `--async --json` → `runs wait <runId> --timeout-ms 120000` in chunks |

`lamina runs wait` is polymorphic — works for App runs and direct model runs.

## Webhooks (one paragraph)

Per-dispatch URL attachment via `--webhook <url>`. Save a default via `lamina webhook listen --public-url <url> --save-default` and every subsequent dispatch auto-attaches it (override per-call with `--webhook <other>`; opt out with `--no-webhook`). Chat agents usually have no receiver URL — stick to `--async` + bounded `runs wait`. Payloads are signed Ed25519; verify against keys from `lamina webhook signing-key`.

## Hard system constraints

**Don't invent IDs.** App IDs come from `lamina apps list`. Parameter / param-schema keys come from `lamina apps get <appId>` and `lamina models describe <id>`. Model IDs come from `lamina models list`. Inventing them produces 404 / 422 errors.

**Inputs decide the output.** Whether dispatching an App (`lamina run --input ...`) or a model (`lamina generate --params ...`), inputs drive what the user gets back. The agent's job is to align them with the user's need; ask when in doubt.

## Quick examples

```bash
# Apps flow (direct discovery)
lamina apps list "product catalog" sneaker ecommerce --json
lamina apps get <appId> --json
lamina assets upload ./shoe.jpg --json
lamina run <appId> --input ... --wait --json

# Content router shortcut
lamina content plan "social hero image for our SaaS launch" --modality image --json
# read response → transition to apps flow

# Model dispatch — caller picks the model
lamina models describe ideogram-v3
lamina generate image --model ideogram-v3 --prompt "..." --wait --download ./out/

# Concept ideation
lamina content brief "promote summer sale" --modality image --platform Instagram --count 5 --json

# Brand intelligence (sparse data when workspace isn't fully configured)
lamina intelligence brand-context --json
```

## Hosted MCP (alternative to CLI)

For agent integrations that prefer typed MCP tools over CLI text, Lamina hosts an MCP endpoint at `https://app.uselamina.ai/mcp/agent` (OAuth). Install with `npx add-mcp https://app.uselamina.ai/mcp/agent` in Claude Code.

## References

Two reference files the agent loads on demand when doing actual work:

- `references/apps.md` — 4 worked examples covering distinct dispatch patterns (single-upload baseline, multi-upload with heavy subset, many curated options, async video). Load when actually dispatching an App.
- `references/content-router.md` — full response branching for `content create/plan` (`needs_input` / `needs_clarification` / `plan` / `ran` / `unmatched`), App-mode dispatching deep dive, askUser handling. Load only when actually using the content router shortcut.
