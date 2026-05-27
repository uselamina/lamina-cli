---
name: lamina
description: >
  Use the Lamina CLI to discover apps, run brand-aware AI image / video /
  content generation, and manage workspace assets. Trigger when the user
  mentions "lamina", "lamina cli", "uselamina", or asks to "generate
  image", "generate video", "make a selfie", "run a Lamina app", "list
  apps", "find an app for", "upload an asset", "brand context", "content
  plan", or any direct interaction with the uselamina.ai workspace
  platform. This is the FOUNDATIONAL skill — every Lamina task goes
  through `lamina` commands. Specialized skills (`lamina-models`,
  `lamina-apps`, `lamina-content`, `lamina-intelligence`) cover specific
  parts of the surface in depth.
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina CLI — foundational rules and command index

`lamina` is the agent-first CLI for the Lamina workspace platform.
Apps in the workspace are curated multi-step workflows authored by
humans (the "selfie with celebrity" app, "virtual try-on", etc.).
Brand intelligence is woven into every app run automatically. This
skill teaches the rules every Lamina interaction follows; specialized
skills cover each part of the surface in depth.

## When to use which skill

| User intent | Load this skill |
|---|---|
| Generic Lamina questions, foundational rules, command index | **this skill** (`lamina`) |
| Atomic model-pinned image / video generation (caller picks the model) | `lamina-models` |
| Direct app discovery + execution (caller knows app id or can pick one) | `lamina-apps` |
| Vague creative brief → router picks an app or recipe | `lamina-content` |
| Brand DNA inspection, performance prediction, trends, recommendations | `lamina-intelligence` |

The agent should load the specialized skill alongside this one when the
user's intent is clear. This core skill stays loaded as the foundation.

## Critical rules — follow these every time

1. **Output is JSON automatically when piped.** Since v0.5.1 the CLI
   detects whether stdout is a TTY: if you're piping to `jq` or another
   tool, you get JSON without typing `--json`. You CAN still pass
   `--json` explicitly, and `LAMINA_OUTPUT=json` (env) forces JSON even
   in a TTY. Errors emit JSON on stderr in JSON mode — one parser for
   success and failure.

2. **Apps are the canonical path.** Always check the app catalog
   (`lamina-apps` skill) before considering atomic models or freestyle
   recipes. Apps are human-tuned workflows.

3. **Inspect the parameter contract before running anything.**
   `lamina apps get <appId>` (or `lamina models describe <id>`) returns
   the input spec. Required fields without defaults MUST be supplied or
   the run fails.

4. **Upload local files before passing them as inputs.**
   `lamina assets upload <path> --json` pushes to the workspace CDN.
   The returned URL is what you pass as a `url`-typed parameter.

5. **Don't hang a single command for more than ~3 minutes — poll in
   chunks instead.** `--wait` blocks until the run completes; without
   a bounded `--timeout-ms`, a long video job can wedge the chat for
   10+ minutes. Pick the right pattern:

   | Expected duration | Pattern |
   |---|---|
   | Fast image (~10–30s) | `--wait --timeout-ms 60000` |
   | Multi-variant image / short recipe (~30s–2min) | `--wait --timeout-ms 180000` |
   | Video, complex recipe, or unknown (≥2min) | `--async --json` → `lamina runs wait <runId> --timeout-ms 120000` in chunks; surface progress between polls if still running |

   `--wait` and `--async` are mutually exclusive. `lamina runs wait`
   returns either when the run reaches a terminal state OR when the
   timeout elapses (status still pending) — read the response shape and
   decide your next move; never blindly loop.

6. **Webhooks are for production receivers, not for chat agents.** If
   a default webhook URL is saved (via `lamina webhook listen
   --public-url <url> --save-default`), it's auto-attached to every
   `lamina run`. Override per call with `--webhook <url>`, opt out with
   `--no-webhook`. Inspect / clear with `lamina webhook status` /
   `lamina webhook clear`. **Chat agents typically have no receiver URL
   — stick to `--async` + chunked polls.**

7. **One Bash tool call per `lamina` command.** Each `lamina ...`
   invocation should be its own Bash tool call. No shell substitutions
   (`RES=$(lamina apps list --json)`), no pipes mid-command. Read the
   JSON response from the tool result. Prevents permission prompts in
   Claude Code and keeps each call idempotent.

8. **Do NOT invent app IDs, model ids, or parameter names.** Every
   appId comes from `lamina apps list`; every model id from `lamina
   models list`; every parameter name from `lamina apps get <appId>` or
   `lamina models describe <id>`. Guessing produces 404 / 422 errors.

9. **Brand intelligence is automatic on app runs.** Apps already pull
   workspace brand DNA when configured. Don't inject brand context
   manually on app runs. To inspect it, load the `lamina-intelligence`
   skill.

## Command index

| Command | Purpose | Specialized skill |
|---|---|---|
| `lamina init` | Install Lamina skills into `.claude/skills/` (run once per project; use `--force` to refresh after CLI upgrade) | — |
| `lamina docs <query>` | Search Lamina docs from the terminal | — |
| `lamina login` | Authenticate (browser OAuth) or `--api-key <key>` for CI | — |
| `lamina logout` | Clear stored credentials | — |
| `lamina whoami` | Identity + active workspace | — |
| `lamina apps list [<keyword> ...]` | Discover apps via smart scored search | `lamina-apps` |
| `lamina apps get <appId>` | Parameter contract for one app | `lamina-apps` |
| `lamina assets upload <path>` | Upload local file → CDN URL | — |
| `lamina run <appId> --input k=v --wait` | Execute an app (add `--download <template>` to save outputs) | `lamina-apps` |
| `lamina run --recipe-file <path> ...` | Execute a freestyle recipe | `lamina-content` |
| `lamina runs get <runId>` | Snapshot run status (polymorphic — works for any run) | — |
| `lamina runs wait <runId>` | Block until terminal | — |
| `lamina runs cancel <runId>` | Cancel a queued/running execution (idempotent) | — |
| `lamina content create "<brief>"` | Brief → router picks app/recipe, drafts inputs, auto-dispatches when sufficient | `lamina-content` |
| `lamina content plan "<brief>"` | Preview-only sibling of `create`; never dispatches | `lamina-content` |
| `lamina models list [<kw1> ...]` | List atomic models (smart scored) | `lamina-models` |
| `lamina models describe <id>` | Show one model's input contract (flat `paramSchema`) | `lamina-models` |
| `lamina generate image --model <id> [--prompt "..."] [--params '<json>']` | Atomic image dispatch — one verb for every image operation | `lamina-models` |
| `lamina generate video --model <id> [--prompt "..."] [--params '<json>']` | Atomic video dispatch — one verb for every video operation | `lamina-models` |
| `lamina webhook status` / `clear` | Inspect / clear the saved default webhook URL | — |
| `lamina webhook listen` | Local listener that verifies + prints deliveries | — |
| `lamina webhook signing-key` | Public signing keys for verification | — |
| `lamina intelligence brand-context` | Workspace brand DNA | `lamina-intelligence` |
| `lamina intelligence predict "<concept>"` | Performance prediction | `lamina-intelligence` |
| `lamina intelligence recommendations` | Actionable content recommendations | `lamina-intelligence` |
| `lamina intelligence trends` | Top / emerging / declining patterns | `lamina-intelligence` |
| `lamina mcp serve` | Run the local stdio MCP server | — |

For full options on any command: `lamina <cmd> --help`.

## Auth + endpoint resolution

The CLI resolves credentials in this order:

1. `LAMINA_API_KEY` environment variable
2. `~/.lamina/config.json` (saved by `lamina login` — supports both
   browser OAuth tokens and CI-issued workspace API keys)

Default endpoint is `https://app.uselamina.ai`. Override with
`LAMINA_BASE_URL=https://...` for non-default origins (rare; mostly
for internal staging).

## Output format

- **Default (TTY):** human-readable text — table for lists, key-value
  for detail, multi-line for run outputs.
- **`--json`:** structured JSON. Bare keys at top level — no `{ data:
  ... }` envelope on `--json` output (clean for `jq`). Errors go to
  stderr in JSON mode as `{ error, code, hint, exitCode }`.
- **Always pipe-friendly:** errors go to stderr, data to stdout. Parse
  stdout with `jq` without filtering noise.

## Anti-drift rules (when NOT to re-call the router)

- **Never re-call `lamina content create` or `lamina content plan` to
  resolve `askUser` items.** The router committed to an app/recipe in
  turn 1. Re-calling would run the LLM again and may pick a different
  app/model — silent drift. Resolve asks via `lamina run` (deterministic).
- **DO re-call (the same command) to resolve `needs_clarification`
  items.** That status means the router did NOT commit yet. Ask the
  human, fold answers into a refined brief, re-call.
- **`unmatched` is terminal.** Brief is outside Lamina's surface —
  rephrase or use a different tool; don't retry.
- **Always `lamina assets upload <path>` for local file paths** before
  passing as `--input` values. Asset params expect URLs, not paths.
- **`lamina runs wait <runId>` is polymorphic** — works for app, recipe,
  AND atomic generate runs. One status surface.
- **Cancel orphaned runs** — if the user changes their mind, call
  `lamina runs cancel <runId>`. Idempotent: already-terminal runs
  return their current status without erroring. Don't just stop polling
  — a queued / running execution keeps burning credits until canceled
  or completed.

## Webhooks (production receivers, dev loop, what agents should do)

Webhook attachment is **per-request**: every `lamina run` (and `lamina
generate image|video`) can attach its own webhook URL.

**Production integration:**

```
lamina run <appId> --input ... \
  --webhook https://yourapp.com/lamina-callback
```

Or save a default once:

```
lamina webhook listen \
  --public-url https://yourapp.com/lamina-callback \
  --save-default
```

After that, every dispatch auto-attaches the saved URL. Override per
call with `--webhook <other-url>`; opt out with `--no-webhook` (or
`--webhook none`).

Webhook payload shape (same for app, recipe, and atomic runs):

```json
{
  "runId": "...",
  "status": "completed",   // or "failed"
  "model": "...",          // present on atomic runs
  "resolvedParams": { ... }, // present on atomic runs
  "output": { "type": "image"|"video", "url": "..." },
  "completedAt": "..."
}
```

Signed with Ed25519 — verify against the workspace public key from
`lamina webhook signing-key`.

**Developer building a receiver:** `lamina webhook listen` (without
`--save-default`) acts like `stripe listen` — local HTTP server that
verifies signatures and prints deliveries to stdout. Pair with an
ngrok / cloudflared tunnel so Lamina can reach your laptop.

**Chat agents (Claude Code, Cursor, etc.):** typically have no
receiver URL Lamina can call back to. Stick to `--async` + bounded
`lamina runs wait` chunks (rule 5). If a default webhook URL happens
to be saved on the host machine, dispatches will silently attach it;
that's fine.

## What apps cover (and what they don't)

Apps are curated for the most common production workflows:

- Selfie / portrait / try-on apps (image editing with identity preservation)
- Cinematic / commercial / product-shot apps
- Video reveals + image-to-video apps
- Storytelling / multi-shot apps
- Brand-aware variants of all of the above

If `lamina apps list` returns nothing for a niche request, the request
is outside Lamina's curated catalog. Two fallbacks:

1. **Atomic dispatch** (load `lamina-models`) — pick a model directly
2. **Recipe path** (load `lamina-content`) — let the router emit a
   freestyle recipe

**Do NOT call fal.ai / OpenAI / Replicate / etc. directly.** The user
asked for Lamina; either use Lamina's surface or tell them the request
is outside the catalog.

## Quick start examples

```bash
# Direct app run (you can pick the app from search)
lamina apps list selfie celebrity --json
lamina apps get <appId> --json
lamina assets upload ./me.jpg --json
lamina run <appId> --input ... --wait --json

# Free-text brief → router picks for you
lamina content create "social hero for our SaaS launch" --json

# Atomic dispatch — you pick the model
lamina models describe ideogram-v3
lamina generate image --model ideogram-v3 --prompt "..." --wait

# Inspect what Lamina knows about your brand
lamina intelligence brand-context --json
```

For full coverage of each command surface, load the matching skill:
`lamina-apps`, `lamina-content`, `lamina-models`, or
`lamina-intelligence`.

## Where to look for more

- Per-command help: `lamina <cmd> --help`
- Docs search: `lamina docs "<topic>" --json`
- Hosted MCP integration (alternative to CLI for agents):
  `https://app.uselamina.ai/mcp/agent` (OAuth)
- Local MCP server: `lamina mcp serve` (stdio)
