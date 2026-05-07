# `@uselamina/cli`

The official Lamina command-line tool. Run AI image, video, and content
generation from your terminal — discover apps, dispatch runs, plan from a
brief, listen for webhooks, or expose Lamina to an LLM agent via MCP.

[Lamina](https://uselamina.ai) is an agentic creative API for generating
videos, movies, and images for products, brands, social, and ads.

> **Building an LLM agent integration?** The CLI is for humans and scripts.
> If you're integrating Lamina into Claude Code, Cursor, or a custom MCP
> client, connect your agent to the hosted MCP server at
> `https://app.uselamina.ai/mcp/agent` (OAuth) — agents get typed tools
> instead of CLI text parsing.

## Installation

```bash
npm install -g @uselamina/cli
```

Verify:

```bash
lamina --version
```

## Authentication

Two paths, mirroring the convention used by `gh`, `supabase`, `vercel`,
`firebase`:

```bash
# 1. Interactive (default) — opens your browser for an OAuth approval flow
#    (Authorization Code + PKCE with a loopback redirect). No copy/paste of
#    secrets. Saves tokens to ~/.lamina/config.json (mode 0600).
lamina login

# 2. CI / scripted — pass an API key non-interactively (no browser).
lamina login --api-key lma_your_key

# Or use an environment variable for one-off CI runs (overrides stored creds):
export LAMINA_API_KEY=lma_your_key
```

`lamina login` opens `app.uselamina.ai`, you pick a workspace and click
*Approve*, the CLI receives the auth code on a loopback port, exchanges it
for an access token + refresh token, and stores them. No keys to manage by
hand for the human flow.

Generate workspace API keys (for CI) at
<https://app.uselamina.ai/settings?tab=api>.

```bash
# Confirm — shows identity, active workspace, and other workspace memberships
lamina whoami

# Sign out (clears ~/.lamina/config.json)
lamina logout
```

## Quick start

```bash
# Find an app for your task
lamina apps list --search selfie

# Inspect its parameters
lamina apps get e0124407-d57a-4f76-ac5a-be0041e55a24

# Upload a local image to Lamina's CDN (returns a URL you can pass into runs)
URL=$(lamina assets upload ./me.jpg --json | jq -r '.data.url')

# Run it with explicit inputs and block until done
lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 \
  --input celebrity_text="Brad Pitt" \
  --input your_photo_image_url="$URL" \
  --wait

# Or describe what you want and let the planner pick the app
lamina content plan "a selfie with Tom Holland" --modality image
```

## Commands

Run `lamina help <command>` (or `lamina <command> --help`) for full options
on any command.

| Command | What it does |
|---|---|
| `lamina login` | Browser-based OAuth approval (default); `--api-key` for CI |
| `lamina logout` | Clear saved credentials |
| `lamina whoami` | Show authenticated user + active workspace |
| `lamina apps list` | Discover apps in your workspace + public catalog |
| `lamina apps get <appId>` | Show full parameter spec for one app |
| `lamina assets upload <path>` | Upload a local file to Lamina's CDN; returns a URL for run inputs |
| `lamina run <appId>` | Run an app with explicit inputs |
| `lamina runs get <runId>` | Snapshot of a run's status and outputs |
| `lamina runs wait <runId>` | Block until a run reaches a terminal state |
| `lamina content plan "<brief>"` | Plan and run from a natural-language brief |
| `lamina content brief "<goal>"` | Generate concept ideas (no dispatch) |
| `lamina content score` | Score this workspace's published content |
| `lamina webhook listen` | Local HTTP listener that verifies + prints deliveries |
| `lamina webhook signing-key` | Show this workspace's public signing keys |
| `lamina webhook status` | Show the saved default forwarding URL |
| `lamina webhook clear` | Clear the saved default forwarding URL |
| `lamina intelligence brand-context` | Show workspace brand DNA, guidance, top patterns |
| `lamina intelligence predict "<concept>"` | Predict content performance for a concept |
| `lamina intelligence recommendations` | List actionable content recommendations |
| `lamina intelligence trends` | Top / emerging / declining patterns by window |

## Output

Every command supports a `--json` flag that emits the raw API envelope, so
you can pipe results into `jq` or another CLI without parsing formatted text:

```bash
lamina apps list --json | jq '.data[] | select(.modality == "image") | .appId'
```

## Configuration

| Variable | Purpose |
|---|---|
| `LAMINA_API_KEY` | Workspace API key (or OAuth access token). Overrides credentials saved via `lamina login`. |
| `LAMINA_BASE_URL` | Endpoint URL. Defaults to `https://app.uselamina.ai`. |

Credentials are saved at `~/.lamina/config.json` (Unix file permissions).
Webhook listener defaults are saved alongside.

## Exit codes

Modeled on POSIX conventions (`gh`, `git`, `vercel`).

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Runtime error — network, server, auth rejected, run failed |
| `2` | Invalid usage — missing argument, unknown subcommand, bad flag |

Errors print to stderr in a consistent shape so scripts can branch on
exit code rather than parse stdout.

## Webhooks

Receive completion callbacks for app runs:

```bash
# Run a local listener that verifies signatures
lamina webhook listen \
  --public-url https://your-tunnel.example/lamina/webhook \
  --save-default

# Then dispatch with --webhook default
lamina run <appId> --input ... --webhook default
```

Lamina signs webhooks with Ed25519. Inspect the public keys with
`lamina webhook signing-key`.

## MCP integration

Lamina hosts an MCP (Model Context Protocol) server so LLM agents — Claude
Code, Cursor, Windsurf, custom clients — can call Lamina's app catalog, run
dispatch, and content planner as typed tools.

Connect your MCP client to:

```
https://app.uselamina.ai/mcp/agent
```

Authentication is via OAuth. The exact client config shape depends on your
MCP client; see your client's docs for adding a remote MCP server.

## Documentation

- [User guides](https://docs.uselamina.ai)
- [CLI & SDK guide](https://docs.uselamina.ai/guides/use-the-cli-and-sdk)
- [Webhook testing locally](https://docs.uselamina.ai/guides/test-webhooks-locally)
- [Agent integration patterns](https://docs.uselamina.ai/guides/agent-integration-patterns)

For programmatic Node.js / TypeScript integration without a shell, see
[`@uselamina/sdk`](https://github.com/uselamina/lamina-sdk).
