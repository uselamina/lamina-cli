# CLI commands that need rework

A tracking doc for commands that are partially exposed, stale, or not
production-ready. The session of 2026-05-13 focused on `lamina content
plan` + `lamina run` (app and recipe paths). The items below were
intentionally **left untouched** in that session and need their own
focused passes.

Status legend:

- **Tombstoned** — exists in code as a "removed" stub that throws. No
  longer a real command.
- **Hidden** — wired in code, invokable via direct subcommand, but NOT
  listed in the top-level `lamina --help` output. Agents won't discover it.
- **Partial** — listed in help, works at CLI level, but the server path
  or UX hasn't been audited this cycle.

---

## `lamina content` subcommands

### `lamina content brief` — **Partial**

- Listed in `lamina content --help`
- Hits `POST /v1/content/brief`
- Generates N concept ideas from a vague goal
- Not retested this session — agent prompt, response shape, and the
  agent's calibration of "good ideation" need review against today's
  catalog of apps + freestyle models.

### `lamina content score` — **Partial**

- Listed in `lamina content --help`
- Hits `POST /v1/content/score`
- Brand-fit / quality score on existing asset URLs
- Not retested this session. The scoring rubric, brand-DNA integration,
  and output shape probably haven't kept pace with brand-intelligence
  changes elsewhere in the platform.

### `lamina content create` — **Tombstoned**

- NOT listed in `lamina content --help`
- Invoking it throws: "lamina content create was removed. Use `lamina
  content plan`."
- The error suggestion mentions `--dispatch` which doesn't exist either
  (legacy reference). Suggestion text needs a one-line cleanup.
- **Decision:** stay tombstoned for now. The `plan → run` two-step is
  the supported pattern. Revisit if/when there's a real autonomous
  use case.

---

## `lamina intelligence` (4 subcommands) — **Partial**

- Listed under "ADDITIONAL COMMANDS" in `lamina --help`
- Subcommands: `brand-context`, `predict <concept>`, `recommendations`,
  `trends`
- All hit `/v1/intelligence/*` endpoints
- Works at CLI level but the agent flow for using these in a plan/run
  loop isn't taught anywhere — when should an agent call `intelligence
  predict` vs just go to `content plan`? Skill doesn't say.
- Server-side: brand DNA + recommendations + trends ARE actively used
  by `contentRouterAgent` (Sanity preview-run) internally, but the
  CLI's standalone surface is largely unaudited.

---

## `lamina publishing` (4 subcommands) — **Hidden**

- NOT listed in `lamina --help` top-level
- Subcommands: `channels`, `publish`, `transfer-asset`, `history`
- All hit `/v1/publishing/*` endpoints
- The fact that it's hidden suggests it was either never finished or
  was held back deliberately. Need to decide:
  - **Path A:** finish + expose in top-level help, teach in the skill
  - **Path B:** confirm intentional hiding, document why, leave hidden
- No agent task is taught to use `lamina publishing` today.

---

## `lamina mcp serve` — **Hidden**

- NOT listed in `lamina --help` top-level
- Hosts a local stdio MCP server so MCP-speaking agents (Cursor, Claude
  Desktop, custom hosts) can call Lamina with typed tools
- An alternative agent surface to the CLI. If we're committed to skills
  as the canonical agent integration, MCP is a parallel path that needs
  parity work — same tools, same flows, same instructions.
- Unclear whether the MCP server's tool surface is current with this
  session's changes (registry additions, `imageUrls` convention, recipe
  flow). Likely NOT — needs an audit.

---

## `lamina content batch` — **Missing CLI surface for an existing server endpoint**

- Server endpoint `POST /v1/content/batch` exists and works ([externalWorkflowApiRouter.js:2418-2493](../react-flow-integration/server/routers/externalWorkflowApiRouter.js#L2418-L2493))
- Accepts `items[]` (max 10), pinned `appId` + per-item `inputs`, dispatches in
  parallel, per-item failure tolerance, returns batchId + array of runIds
- SDK has no first-class wrapper — only an internal raw-request inside the
  OpenAI tool integration
- **No CLI command** — `lamina content batch` returns "unknown subcommand"
  today. Users have to hit the HTTP API directly or write their own wrapper
- Use case: bulk catalog generation across SKUs (12 sneakers, same app,
  different inputs per item), bulk creative brief dispatch
- Minimum to ship: SDK method + thin CLI command + items-file format + skill
  paragraph + verified test against local server. Estimated 1 focused session.

Decision deferred: also consider whether batch should keep using the legacy
`createContent` router internally OR be migrated to the new `content/plan`
agent flow. For pinned `appId` per item it doesn't matter (no LLM involved);
for LLM-routed items the legacy router has older logic.

---

## Agent-install distribution — **CLI installs via npm only**

SkyPilot and fal genmedia ship their skills via newer agent-native mechanisms.
We lag behind on this distribution UX:

| Channel | SkyPilot / genmedia | Lamina today |
|---|---|---|
| Claude Code plugin marketplace | `claude plugin install skypilot@skypilot` (one command, agent can run it itself) | NOT registered |
| npx skills registry | `npx skills add skypilot-org/skypilot` | NOT published |
| GitHub repo as skill source | Yes — skill folder lives in main repo, marketplace fetches it | Skill is bundled inside the published CLI npm package only |
| Self-bootstrap one-liner in skill | "Bootstrap SkyPilot" prompt → agent self-installs | None — agent has to first know that `npm install -g @uselamina/cli` is required |
| Capability table at top of SKILL.md | Yes — 9 concrete capability+example rows | Added in 0.5.4 — needs grounding in real catalog apps (see "Capability table" below) |

What to do in a future session:

1. Register `@uselamina/cli` in the Claude Code plugin marketplace so agents
   can `claude plugin install lamina` without needing to know npm.
2. Publish a skill-only package to the `npx skills` registry (mirror of the
   one bundled in the CLI) so `npx skills add uselamina` works.
3. Add a "Bootstrap" one-liner section at the very top of SKILL.md:
   *"If `lamina` is not installed, run `npm install -g @uselamina/cli && lamina login`. Then `lamina init` in your project."* — agent self-onboards
   on first invocation.

---

## Capability table — grounded in real catalog

The SKILL.md "What you can do" table needs to be rebuilt around what the
public+featured catalog ACTUALLY ships. From a Supabase audit of
`workflows where is_public = true and is_featured = true` plus high-usage
public apps:

- **Image / catalog** workflows ship one-product-per-run (NOT bulk across
  SKUs in a single call) — `Premium Catalog 1.0` (411 runs), `Mood Board
  Product Shoot 20` (96 runs), `Swift Catalog 5-Image` (87 runs), `A+
  Content Maker` (73 runs), `Jewelry Catalog` (47 runs), `Update Product
  Packaging` (17 runs), `Luxury Watch Advertisement` (17 runs)
- **Video** workflows are compound deliverables — `📺 Product Explainer
  Video` (892 runs), `🎬 Instagram Reel Creator` (756 runs), `💋 AI Lip Sync
  Video` (570 runs), `🎥 Product Video Suite` (427 runs), `🎧 Podcast to
  Video` (392 runs), `🎙️ Video Dubbing Pipeline` (235 runs), `🎓 Explainer
  Video Suite` (198 runs), `Short Film Assets - Personality as a service`
  (84 runs), `Catalog to Reels` (62 runs), `Eyewear Multi-Shot 21s Video`
  (45 runs)

Initial draft attempted (this session) mixed per-execution behavior with
caller-side orchestration ("bulk catalog across 12 SKUs") — incorrect. The
real per-execution shape is 1 product → N styled variations; bulk-across-SKUs
is a caller orchestration pattern (via `/v1/content/batch` once that CLI
surface lands).

To re-do: write the capability table strictly in terms of what one execution
delivers, anchored on featured apps. Add a separate "Orchestration patterns"
section once `lamina content batch` ships.

---

## Top-level help inconsistency

`lamina --help` lists 11 commands; the actual code has 14 (adds:
`publishing`, `mcp`, plus the `init`/`docs` agent-setup pair which
ARE listed). The mismatch is intentional (publishing + mcp are
hidden) but not documented. The skill should either:

- Match the help exactly (don't teach hidden commands), or
- Explicitly note the hidden ones and why

For this session the skill leaves them out of the canonical agent
flow and treats them as "advanced / out of scope."

---

## Suggested order for follow-up sessions

1. **`lamina mcp serve`** — highest leverage. If MCP is a real agent
   surface, parity with the skill's CLI flow is critical. Audit, fix,
   expose.
2. **`lamina content brief` + `content score`** — natural-language
   ideation + brand-fit scoring. Should integrate cleanly with the
   `plan → run` loop.
3. **`lamina intelligence`** — currently a sidebar. Decide if agents
   should ever reach for these directly, or if they're purely
   workspace-admin reads.
4. **`lamina publishing`** — last because it's a different problem
   space (post-generation distribution, not generation itself).
