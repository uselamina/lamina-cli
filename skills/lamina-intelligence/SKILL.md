---
name: lamina-intelligence
description: >
  Inspect workspace brand DNA, predict content performance, get
  actionable content recommendations, and read trend patterns from the
  workspace's intelligence layer. Use this skill when the user asks
  about brand context, performance prediction, content recommendations,
  or trend analysis. The intelligence layer is automatically applied to
  app runs; this skill is for explicitly inspecting / querying it.
metadata:
  author: lamina-team
  version: "0.5.7"
---

# Lamina Intelligence — brand context, predictions, recommendations, trends

The intelligence layer is Lamina's RAG-over-brand-data surface. It
provides four CLI commands that expose what the workspace has learned
about a brand's content, performance, and patterns over time.

**Important:** When you run an **App** (`lamina run <appId>`), brand
context is pulled in automatically by apps that are configured for it —
you don't need to inject it manually. This skill is for **inspecting**
the brand data or for using intelligence in ad-hoc flows.

## The four commands

| Command | Purpose | When to use |
|---|---|---|
| `lamina intelligence brand-context` | Dump the full brand DNA of the active workspace (voice, palette, positioning, audience, etc.) | User asks "what does Lamina know about my brand?", or you want to confirm what's available to apps |
| `lamina intelligence predict "<concept>"` | Predict performance for a concept / draft idea | User asks "would X content perform well?" before generating |
| `lamina intelligence recommendations` | Get actionable content recommendations grounded in the brand's existing performance + patterns | User asks "what should I post next?" or wants ideation |
| `lamina intelligence trends` | Top / emerging / declining patterns across the brand's content | User wants strategic insight on what's working / fading |

All four return JSON when piped or `--json`. Per `lamina <cmd> --help`
for full options.

## When to load this skill

Load it when the user mentions any of:

- "brand context", "brand DNA", "brand voice", "brand colors"
- "predict performance", "will this perform"
- "content recommendations", "what should I post", "ideation"
- "trends", "emerging patterns", "what's working"

If the user just wants to generate something, **don't** load this skill
— the app runs already use intelligence under the hood. This skill is
for the explicit query / inspection path.

## Examples

```bash
# Dump the brand DNA for the active workspace
lamina intelligence brand-context --json
# → { voice, palette, positioning, audience, references, ... }

# Predict performance for a concept BEFORE generating
lamina intelligence predict "carousel about how our serum routine works" --json
# → { score, rationale, similar past content with metrics, ... }

# Ask the intelligence layer for content recommendations
lamina intelligence recommendations --json
# → [{ concept, rationale, suggested format, ... }, ...]

# Read trend patterns — what's working, emerging, declining
lamina intelligence trends --json
# → { top, emerging, declining: [{pattern, ...}, ...] }
```

## How intelligence interacts with the rest of the surface

- **Apps** (`lamina-apps` skill) — brand context is pulled automatically
  by apps that are wired for it. The app's prompt scaffolding consumes
  workspace voice / palette / positioning without the caller doing
  anything.
- **Content briefs** (`lamina-content` skill) — `lamina content create`
  routes briefs through brand-aware apps when available. The router
  factors brand fit into its app selection.
- **Atomic generation** (`lamina-models` skill) — atomic dispatch does
  NOT auto-pull brand context. If you want brand-aware atomic
  generation, the agent has to bake the brand voice / palette into the
  prompt explicitly — fetch with `intelligence brand-context` first,
  then craft the prompt.

## Rules

1. **Don't try to inject brand context into app runs manually.** Apps
   wired for brand context already pull it. Manual injection is
   redundant and can conflict.

2. **Brand context is per-workspace.** `whoami` shows the active
   workspace; intelligence commands operate on that workspace. To query
   a different workspace, switch via `lamina login` (workspace picker).

3. **Predict before burning credits on uncertain concepts.** If the
   user is unsure whether a concept will resonate, run
   `intelligence predict` first — it's cheap, returns a score +
   rationale, and informs whether to proceed with generation.
