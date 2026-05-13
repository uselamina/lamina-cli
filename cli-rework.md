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
