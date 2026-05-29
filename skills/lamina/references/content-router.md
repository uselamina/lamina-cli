# Lamina Content Router — deep flow

Load only when actually using `lamina content create` or `lamina content plan`. The main `SKILL.md` covers when to use the content router as a shortcut; this reference covers the full response branching, askUser handling, and worked example.

## Why use the content router at all

`lamina content create/plan` is a shortcut that does — server-side, in ONE call — what a capable agent could do client-side over several calls:

1. App discovery (the smart-scored matcher)
2. Drafting inputs from the brief (pre-filling any fields the brief covered)
3. Reading the App's contract and identifying what user-owned slots / preset choices / output subsets the agent still needs to ask about

For agents that don't want to do that legwork client-side, calling content saves ~2-3 round trips. For agents that already have rich vertical-skill knowledge loaded, going directly through `lamina apps list` + `lamina apps get` may produce better-tuned input drafts.

## Response statuses

`create` and `plan` return one of these. Read `data.status` and act accordingly:

| Status | Origin | Means | What you do |
|---|---|---|---|
| `ran` | only `create` | Router dispatched the run. `data.runId` is ready. | Poll with `lamina runs wait <runId>` (or `--wait` on the call). Surface outputs. |
| `plan` | only `plan` | Routing decision shown without dispatching. | Read `data.selectedApp` + `draftedInputs` + `askUser`. Dispatch yourself via `lamina run <selectedApp.appId>`. |
| `needs_input` | both | Router committed to an App but is missing user-owned slots (media, preset choice, output subset). | Read `data.askUser[]` — each entry has `name` + `question`. Ask the user, collect answers, dispatch via `lamina run <selectedApp.appId>` with `--input <name>=<answer>`. **Don't re-call content** — that would re-roll the router LLM. |
| `needs_clarification` | both | Router did NOT commit yet — the brief is genuinely ambiguous (banner vs reel vs catalog, etc.). | Read `data.clarifications[]`, ask the user, fold answers into a refined brief, then RE-CALL `create`/`plan`. This is the ONE case where re-calling makes sense. |
| `unmatched` | both | No App in the catalog fits the brief (or the brief is outside Lamina's surface). | Agent's fallback: use vertical-skill knowledge (if loaded) + `lamina generate image/video` for direct model dispatch. For genuinely outside-the-platform briefs, surface to the user. |

## Dispatching when status is `plan` or `needs_input`

Response fields the agent reads:

- `selectedApp.appId` → first positional arg of `lamina run`
- `selectedApp.rationale` → optional info to surface to the user
- `draftedInputs` → one `--input <key>=<value>` per entry (pre-filled by the router from the brief)
- `askUser[]` *(may be empty)* → one `--input <name>=<answer>` per entry **except** when `name === "__outputs"` (see below)
- `selectedOutputs[]` *(optional)* → one `--output "<label>"` per entry
- `warnings[]` → soft mismatches; surface to the user as FYI

### Reading `askUser` entries — three shapes

1. **User-owned media** (`name` ends in `_url`, brief silent): ask the user for a file path or URL. If a file path, run `lamina assets upload <path>` first; pass the returned URL as `--input <name>=<url>`.
2. **Preset choice with curated options** (the `question` lists choices inline): surface the option list to the user verbatim. They answer with one of the listed labels OR the literal string `default` (omit the input entirely if they say `default`).
3. **`__outputs` reserved name**: fires when the brief is silent on which subset of the App's outputs to run. Question describes the labels. User picks. Pass each as `--output "<label>"` (NOT `--input` — `__outputs` is never a real App parameter).

## Worked example — Product photoshoot (App path)

**User:** "Product photoshoot for ceramic mug — clean catalog style."

```bash
lamina content plan \
  "Product photoshoot for ceramic mug — clean catalog style" \
  --modality image --json
```

Response (abbreviated):
```json
{
  "status": "plan",
  "mode": "app",
  "selectedApp": { "appId": "b149d8c8-...", "name": "Product Shoot (With Mood Board) (10)" },
  "draftedInputs": { "product_text": "ceramic mug, clean catalog style" },
  "askUser": [
    { "name": "your_product_image_url", "question": "Upload a photo of the mug." },
    { "name": "mood_board_images_urls", "question": "Provide 1-3 mood board reference images." }
  ]
}
```

Agent confirms with user, gets files, uploads each, dispatches:

```bash
lamina assets upload ./mug.jpg --json
lamina assets upload ./mood1.jpg --json

lamina run b149d8c8-... \
  --input product_text="ceramic mug, clean catalog style" \
  --input your_product_image_url="https://media.../mug.jpg" \
  --input mood_board_images_urls="https://media.../mood1.jpg" \
  --wait --timeout-ms 180000 --json
```

## When no App fits

`status: 'unmatched'` is the signal. The router does not generate a freestyle recipe — that path is removed. The agent's fallback is:

1. If a relevant vertical skill is loaded (UGC, product-shoot, brand-campaign, etc.), use its guidance for model + prompt pattern.
2. Dispatch directly via `lamina generate image --model <id> --prompt "..."` or `lamina generate video --model <id> ...`.
3. If the brief is genuinely outside the platform's surface (text generation, code, audio narration with no video, etc.), tell the user.

## When NOT to re-call `create` / `plan`

The most common drift trap. After the router has picked, the dispatch is deterministic:

- **`needs_input`** — router HAS committed. Resolve via `lamina run --input ...`. Do NOT re-call content. Re-calling would re-roll the LLM and may pick a different App, silently changing the run.
- **`needs_clarification`** — router HAS NOT committed yet (pre-commit routing ambiguity). Fold the user's answer into a refined brief and RE-CALL. This is the explicit exception.
- **`unmatched`** — brief is outside the catalog. Don't retry the same brief; fall back to direct model dispatch + skill knowledge.

| Where you read it | What it is | How to resolve |
|---|---|---|
| `data.askUser[i]` (inside `needs_input` or `plan`) | Per-param question on the chosen App | `lamina run --input <name>=<answer>` (or `--output "<label>"` for `__outputs`) |
| `data.clarifications[i]` (inside `needs_clarification`) | True pre-commit routing ambiguity | Re-call `lamina content create` (or `plan`) with a refined brief |
