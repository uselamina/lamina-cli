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
  version: "0.5.0"
---

# Lamina CLI: brand-aware AI media generation

`lamina` is the agent-first CLI for the Lamina workspace platform. Apps in
the workspace are curated multi-step workflows authored by humans (the
"selfie with celebrity" app, "virtual try-on", etc.). Brand intelligence
(workspace brand DNA, content scoring) is woven through every run
automatically. This skill teaches you the canonical flow and the rules.

## Critical rules — follow these every time

1. **Always pass `--json` when an agent will read the output.** Pretty-text
   mode is for humans only. Every Lamina command that returns data supports
   `--json`. Errors are also JSON when `--json` was passed, on stderr.

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

5. **Use `--wait` for short jobs.** It blocks until the run reaches a
   terminal state and returns the outputs inline. For long-running video
   work consider polling with `lamina runs wait <runId>` or saving a
   webhook URL via `lamina webhook listen --save-default`.

6. **One Bash tool call per `lamina` command.** Each `lamina ...`
   invocation should be its own Bash tool call. No shell substitutions
   (`RES=$(lamina apps list --json)`), no pipes mid-command. Read the JSON
   response from the tool result. Prevents permission prompts in Claude Code
   and keeps each call idempotent.

7. **Do NOT invent app IDs or parameter names.** Every appId comes from
   `lamina apps list`; every parameter name comes from `lamina apps get
   <appId>`. Guessing produces 404 / 422 errors.

8. **Brand intelligence is automatic on app runs.** Apps already pull
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
| `lamina run <appId> --input k=v --wait` | Execute an app |
| `lamina runs get <runId>` | Snapshot run status |
| `lamina runs wait <runId>` | Block until terminal |
| `lamina content plan "<brief>"` | Brief → app routing via planner agent |
| `lamina content brief "<goal>"` | Generate concept ideas (no dispatch) |
| `lamina intelligence brand-context` | Workspace brand DNA |
| `lamina intelligence predict "<concept>"` | Performance prediction |
| `lamina intelligence recommendations` | Actionable content recommendations |
| `lamina intelligence trends` | Top / emerging / declining patterns |
| `lamina webhook signing-key` | Public signing keys for webhook verification |
| `lamina webhook listen` | Local listener that verifies + prints deliveries |
| `lamina mcp serve` | Run the local stdio MCP server |

For full options on any command: `lamina <cmd> --help`.

## The canonical agent flow

For any "generate / create / make something" request:

```
1. lamina apps list --search "<keyword>" --json
   → grab .data[].appId of the best match
2. lamina apps get <appId> --json
   → read .data.parameters[] to know what inputs are needed
3. (if user gave you a local file)
   lamina assets upload <path> --json
   → grab .data.url, use as input value
4. lamina run <appId> --input key=value [--input ...] --wait --json
   → read .data.outputs[].value for the result URLs
5. Surface the URLs to the user. Done.
```

If the user gave a brief that doesn't obviously map to an app, use the
planner instead of guessing:

```bash
lamina content plan "<the user's brief>" --json
# Server-side planner agent picks the right app + drafts inputs.
# Returns either { needsInput: [...] } (you must collect more from user)
# or { runId: "..." } (run is already dispatched, just wait on it).
```

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
# → server picks the best app, returns plan or runId
```

## Where to look for more

- Per-command help: `lamina <cmd> --help`
- Docs search: `lamina docs "<topic>" --json`
- Hosted MCP integration (alternative to CLI for agents):
  `https://app.uselamina.ai/mcp/agent`
