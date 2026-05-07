import type {
  AccountResponse,
  AppDetail,
  AppSummary,
  AssetUploadResult,
  BrandContextResponse,
  ConnectedChannel,
  ContentBriefResult,
  ContentPlanResult,
  ExecutionStarted,
  ExecutionStatus,
  LaminaWebhookListenerEvent,
  PerformancePrediction,
  PublishHistoryItem,
  PublishResult,
  Recommendation,
  TransferAssetResult,
  TrendPatternSummary,
  WebhookSigningKeyResponse,
} from '@uselamina/sdk';

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function padRight(value: string, len: number): string {
  return value.length >= len ? value : value + ' '.repeat(len - value.length);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printIdentity(account: AccountResponse): void {
  if (account.user.email) {
    process.stdout.write(`User:       ${account.user.email}\n`);
  }
  if (account.workspace) {
    const role = account.workspace.role ? ` (${account.workspace.role})` : '';
    const name = account.workspace.name || account.workspace.id;
    process.stdout.write(`Workspace:  ${name}${role}\n`);
    if (account.workspace.slug) {
      process.stdout.write(`Slug:       ${account.workspace.slug}\n`);
    }
  } else {
    process.stdout.write(`Workspace:  (none)\n`);
  }

  // Other workspaces — only surface when there's more than one, otherwise
  // the user already sees the sole workspace above.
  const others = (account.memberships || []).filter(
    (m) => !account.workspace || m.workspaceId !== account.workspace.id
  );
  if (others.length > 0) {
    process.stdout.write(
      `Other workspaces (${others.length}):\n`
    );
    for (const m of others) {
      const role = m.role ? ` (${m.role})` : '';
      const name = m.name || m.workspaceId;
      process.stdout.write(`  - ${name}${role}\n`);
    }
  }
}

export function printAuthStatus(status: {
  source: string;
  baseUrl: string;
  keyPreview: string;
}): void {
  process.stdout.write(`Authenticated via: ${status.source}\n`);
  process.stdout.write(`Base URL: ${status.baseUrl}\n`);
  process.stdout.write(`API key: ${status.keyPreview}\n`);
}

export function printAppList(apps: AppSummary[]): void {
  if (apps.length === 0) {
    process.stdout.write('No apps found.\n');
    return;
  }

  // Tabular: NAME / MODALITY / VISIBILITY / APP ID / DESCRIPTION.
  // ID truncated to 8 chars (full UUID via --json). Name capped at 40 to
  // keep the table from blowing out wide on outlier titles.
  const NAME_MAX = 40;
  const ID_LEN = 8;

  const rows = apps.map((a) => ({
    name: truncate(a.name, NAME_MAX),
    modality: a.modality || '—',
    visibility: a.isPublic ? 'public' : 'private',
    id: a.appId.slice(0, ID_LEN),
    description: a.description ? a.description.replace(/\s+/g, ' ').trim() : '',
  }));

  // Column widths driven by data, with sane minimums so headers fit.
  const wName = Math.max('NAME'.length, ...rows.map((r) => r.name.length));
  const wMod = Math.max('MODALITY'.length, ...rows.map((r) => r.modality.length));
  const wVis = Math.max('VISIBILITY'.length, ...rows.map((r) => r.visibility.length));
  const wId = Math.max('APP ID'.length, ID_LEN);

  // DESCRIPTION takes whatever's left of the terminal (with a sane min).
  const term = process.stdout.columns || 100;
  const sep = '  ';
  const fixedWidth = wName + sep.length + wMod + sep.length + wVis + sep.length + wId + sep.length;
  const wDesc = Math.max(20, term - fixedWidth);

  process.stdout.write(
    padRight('NAME', wName) +
      sep +
      padRight('MODALITY', wMod) +
      sep +
      padRight('VISIBILITY', wVis) +
      sep +
      padRight('APP ID', wId) +
      sep +
      'DESCRIPTION\n'
  );

  for (const r of rows) {
    process.stdout.write(
      padRight(r.name, wName) +
        sep +
        padRight(r.modality, wMod) +
        sep +
        padRight(r.visibility, wVis) +
        sep +
        padRight(r.id, wId) +
        sep +
        truncate(r.description, wDesc) +
        '\n'
    );
  }

  process.stdout.write(`\n${apps.length} app${apps.length === 1 ? '' : 's'} shown.\n`);
}

export function printAppDetail(app: AppDetail): void {
  process.stdout.write(`${app.name}\n`);
  process.stdout.write(`App ID: ${app.appId}\n`);
  if (app.description) {
    process.stdout.write(`\n${app.description}\n`);
  }

  if (app.parameters.length === 0) {
    process.stdout.write('\nParameters: none\n');
    return;
  }

  process.stdout.write(`\nParameters (${app.parameters.length}):\n`);
  for (const p of app.parameters) {
    // Prefer the snake_case `key` (canonical input identifier); fall back to
    // `name` if the workflow author didn't set one.
    const ident = p.key || p.name || p.id;

    // The honest "must I supply this" signal is whether a default exists.
    // The workflow author's `required` flag is unreliable — we ignore it.
    const hasDefault = p.default !== undefined && p.default !== null && p.default !== '';
    const mustSupplyMarker = hasDefault ? '' : '   (must supply)';

    process.stdout.write(`\n  ${ident}${mustSupplyMarker}\n`);

    // Skip `name:` line when name is redundant with the ident.
    if (p.name && p.name !== ident) {
      process.stdout.write(`    name:    ${p.name}\n`);
    }

    let typeStr: string = p.type;
    if (p.type === 'url' && p.accept?.length) {
      typeStr = `url (${p.accept.join(', ')}${p.multiple ? ', multiple' : ''})`;
    }
    process.stdout.write(`    type:    ${typeStr}\n`);

    if (p.description) {
      process.stdout.write(`    note:    ${truncate(p.description, 80)}\n`);
    }

    if (p.type === 'options' && p.options?.length) {
      process.stdout.write(`    options: ${p.options.join(', ')}\n`);
    }

    if (hasDefault) {
      const defaultStr =
        typeof p.default === 'string' ? truncate(p.default, 80) : JSON.stringify(p.default);
      process.stdout.write(`    default: ${defaultStr}\n`);
    }
  }
}

export function printAssetUpload(data: AssetUploadResult & { sizeBytes?: number }): void {
  process.stdout.write(`Uploaded: ${data.filename}\n`);
  if (typeof data.sizeBytes === 'number' && data.sizeBytes > 0) {
    process.stdout.write(`Size:     ${formatBytes(data.sizeBytes)}\n`);
  }
  process.stdout.write(`Type:     ${data.mediaType}\n`);
  process.stdout.write(`URL:      ${data.url}\n`);
  if (data.assetId) {
    process.stdout.write(`Asset ID: ${data.assetId}\n`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function printRunStarted(started: ExecutionStarted): void {
  process.stdout.write(`Run started: ${started.runId}\n`);
  if (started.workflowName) {
    process.stdout.write(`App:         ${started.workflowName}\n`);
  }
  process.stdout.write(`Status:      ${started.status}\n`);
  process.stdout.write(`\nFollow with: lamina runs wait ${started.runId}\n`);
}

export function printExecution(
  execution: ExecutionStatus,
  options: { appName?: string } = {}
): void {
  process.stdout.write(`Run:    ${execution.runId}\n`);
  process.stdout.write(`Status: ${execution.status}\n`);
  if (options.appName) {
    process.stdout.write(`App:    ${options.appName}\n`);
  } else {
    process.stdout.write(`App ID: ${execution.workflowId}\n`);
  }

  // Progress is only meaningful while queued/running; terminal states have
  // their own signals (errors, output URLs).
  if (
    execution.progress &&
    (execution.status === 'queued' || execution.status === 'running')
  ) {
    const pct = execution.progress.percentComplete;
    const pctStr = pct === null || pct === undefined ? '—' : `${Math.round(pct)}%`;
    const total = execution.progress.totalOutputs;
    const done = execution.progress.completedOutputs;
    process.stdout.write(`Progress: ${pctStr} (${done}/${total} outputs ready)\n`);
  }

  if (execution.errorMessage) {
    process.stdout.write(`\nError: ${execution.errorMessage}\n`);
  }

  if (execution.outputs.length > 0) {
    process.stdout.write(`\nOutputs (${execution.outputs.length}):\n`);
    for (const output of execution.outputs) {
      const label = output.label || output.id || '(unnamed)';
      process.stdout.write(`  ${label}\n`);
      process.stdout.write(`    type:   ${output.type}\n`);
      process.stdout.write(`    status: ${output.status}\n`);
      if (typeof output.value === 'string' && output.value) {
        process.stdout.write(`    url:    ${output.value}\n`);
      }
      if (output.error) {
        process.stdout.write(`    error:  ${output.error}\n`);
      }
    }
  }

  // Timing footer for terminal states only — keeps "running" output tight.
  if (execution.status !== 'queued' && execution.status !== 'running') {
    if (execution.startedAt) {
      process.stdout.write(`\nStarted:   ${execution.startedAt}\n`);
    }
    if (execution.completedAt) {
      process.stdout.write(`Completed: ${execution.completedAt}\n`);
    }
  }
}

export function printSavedLogin(baseUrl: string): void {
  process.stdout.write(`Saved Lamina credentials for ${baseUrl}\n`);
}

export function printWebhookStatus(status: {
  publicUrl?: string | null;
  host?: string;
  port?: number;
  path?: string;
}): void {
  // "Default forwarding URL" is the saved-default that `lamina run --webhook default`
  // points at — the wording in the original "Saved webhook URL" was ambiguous.
  process.stdout.write(`Default forwarding URL: ${status.publicUrl || '(none)'}\n`);
  if (status.host && typeof status.port === 'number' && status.path) {
    process.stdout.write(`Listener defaults:      http://${status.host}:${status.port}${status.path}\n`);
  }
}

export function printSigningKeys(response: WebhookSigningKeyResponse): void {
  const keys = Array.isArray(response.keys) ? response.keys : [];
  if (keys.length === 0) {
    process.stdout.write('No signing keys configured.\n');
    return;
  }

  // JWKS-style display. These are PUBLIC keys (Ed25519), not shared secrets,
  // so we don't mask — but we truncate the long base64 `x` field for terminal
  // readability. Full value via `--json`.
  process.stdout.write(`Signing keys (${keys.length}):\n\n`);
  for (const key of keys) {
    const k = key as Record<string, unknown>;
    const kid = typeof k.kid === 'string' ? k.kid : '(no kid)';
    const alg = typeof k.alg === 'string' ? k.alg : (k.kty as string) || 'unknown';
    const use = typeof k.use === 'string' ? k.use : '—';
    const x = typeof k.x === 'string' ? k.x : '';
    const xPreview = x ? `${x.slice(0, 16)}…${x.slice(-4)}` : '(none)';

    process.stdout.write(`  ${kid}\n`);
    process.stdout.write(`    algorithm: ${alg}\n`);
    process.stdout.write(`    use:       ${use}\n`);
    process.stdout.write(`    public:    ${xPreview}\n`);
  }
  process.stdout.write(`\nFull JWK shape: lamina webhook signing-key --json\n`);
}

export function printListenerStartup(args: {
  localUrl: string;
  publicUrl: string | null;
  signingKid: string | null;
  signingAlg: string | null;
  savedDefault: boolean;
}): void {
  // Mirror `stripe listen` — surface the most useful info on startup so the
  // user doesn't have to run another command before they can verify deliveries.
  process.stdout.write(`Lamina webhook listener running on ${args.localUrl}\n`);
  if (args.publicUrl) {
    process.stdout.write(`Public URL:    ${args.publicUrl}\n`);
  } else {
    process.stdout.write(
      `Public URL:    (none — pass --public-url https://... for tunneled setups)\n`
    );
  }
  if (args.signingKid) {
    process.stdout.write(
      `Signing key:   ${args.signingKid}${args.signingAlg ? ` (${args.signingAlg})` : ''}\n`
    );
  } else {
    process.stdout.write(`Signing key:   (could not fetch — verification disabled)\n`);
  }
  if (args.savedDefault) {
    process.stdout.write(
      `Saved this configuration as the default for \`lamina run --webhook default\`.\n`
    );
  }
  process.stdout.write(`\nPress Ctrl+C to stop.\n\n`);
}

export function printWebhookEvent(event: LaminaWebhookListenerEvent): void {
  // HH:MM:SS prefix for log correlation, matching `stripe listen` and
  // `svix listen` style. Status word is fixed-width so columns line up.
  const time = new Date(event.receivedAt).toISOString().slice(11, 19);
  const status = event.verified ? 'verified' : 'rejected';
  const seqStr = `#${event.sequence}`.padEnd(4);

  if (event.verified && event.payload) {
    const data = event.payload.data;
    const runId = data.runId;
    const runStatus = data.status;
    process.stdout.write(`${time}  ${status}  ${seqStr}  run ${runId} (${runStatus})\n`);
  } else {
    const reason = event.error || 'unknown';
    process.stdout.write(`${time}  ${status}  ${seqStr}  ${reason}\n`);
  }
}

export function printBrandContext(data: BrandContextResponse): void {
  // Each section is independent — workspaces frequently have one configured
  // and not the others. Print honest empty-state per section so the user
  // knows whether to fill in a brand profile vs run scoring vs both.

  // Brand DNA
  if (data.brandDna) {
    process.stdout.write('Brand DNA\n');
    if (data.brandDna.voiceAttributes.length) {
      process.stdout.write(`  Voice:       ${data.brandDna.voiceAttributes.join(', ')}\n`);
    }
    if (data.brandDna.contentPillars.length) {
      process.stdout.write(`  Pillars:     ${data.brandDna.contentPillars.join(', ')}\n`);
    }
    if (data.brandDna.guardrails.length) {
      process.stdout.write(`  Guardrails:  ${data.brandDna.guardrails.join(', ')}\n`);
    }
    if (data.brandDna.visualIdentity.length) {
      process.stdout.write(`  Visual:      ${data.brandDna.visualIdentity.join(', ')}\n`);
    }
  } else {
    process.stdout.write('Brand DNA:   (not configured — set up a brand profile in your workspace)\n');
  }

  // Guidance
  process.stdout.write('\nGuidance\n');
  if (data.guidance && (data.guidance.promptDirectives.length || data.guidance.negativePrompts.length)) {
    for (const d of data.guidance.promptDirectives) process.stdout.write(`  + ${d}\n`);
    for (const d of data.guidance.negativePrompts) process.stdout.write(`  - ${d}\n`);
  } else {
    process.stdout.write('  (none — guidance is populated by content scoring; no scored content yet)\n');
  }

  // Top patterns
  const patterns = data.topPatterns?.topPatterns || [];
  process.stdout.write(`\nTop Patterns (${patterns.length})\n`);
  if (patterns.length === 0) {
    process.stdout.write('  (none — patterns appear after content scoring jobs run)\n');
  } else {
    for (const p of patterns) {
      process.stdout.write(`  ${p.pattern} (${p.occurrences}x, avg ${p.avgPerformance.toFixed(1)})\n`);
    }
  }
}

export function printPrediction(data: PerformancePrediction): void {
  process.stdout.write(`Performance: ${(data.performancePrediction * 100).toFixed(0)}%\n`);
  process.stdout.write(`Brand fit: ${(data.brandFit * 100).toFixed(0)}%\n`);
  process.stdout.write(`Trend alignment: ${(data.trendAlignment * 100).toFixed(0)}%\n`);
  process.stdout.write(`Fatigue risk: ${(data.fatigueRisk * 100).toFixed(0)}%\n`);
  process.stdout.write(`Confidence: ${(data.confidence * 100).toFixed(0)}%\n`);

  if (data.reasoning.length) {
    process.stdout.write('\nReasoning:\n');
    for (const r of data.reasoning) {
      process.stdout.write(`  - ${r}\n`);
    }
  }

  if (data.recommendedAdjustments.length) {
    process.stdout.write('\nAdjustments:\n');
    for (const a of data.recommendedAdjustments) {
      process.stdout.write(`  - ${a}\n`);
    }
  }
}

export function printRecommendations(data: Recommendation[]): void {
  if (data.length === 0) {
    process.stdout.write('No recommendations.\n');
    process.stdout.write(
      '(Recommendations are populated by background scoring jobs — none have run yet, or all have been resolved.)\n'
    );
    return;
  }
  process.stdout.write(`Found ${data.length} recommendation${data.length === 1 ? '' : 's'}\n`);
  for (const rec of data) {
    process.stdout.write(`- [${rec.priority}] ${rec.title} (${rec.type})\n`);
    if (rec.summary) {
      process.stdout.write(`  ${rec.summary}\n`);
    }
  }
}

export function printTrends(data: TrendPatternSummary): void {
  process.stdout.write(`Trends (${data.windowStart} to ${data.windowEnd})\n`);

  const total =
    (data.topPatterns?.length || 0) +
    (data.emergingPatterns?.length || 0) +
    (data.decliningPatterns?.length || 0);

  if (total === 0) {
    process.stdout.write(
      '\n(No patterns scored in this window. Trends populate after content scoring runs.)\n'
    );
    return;
  }

  if (data.topPatterns.length) {
    process.stdout.write(`\nTop (${data.topPatterns.length}):\n`);
    for (const p of data.topPatterns) {
      process.stdout.write(`  ${p.label} (momentum: ${p.momentum})\n`);
    }
  }

  if (data.emergingPatterns.length) {
    process.stdout.write(`\nEmerging (${data.emergingPatterns.length}):\n`);
    for (const p of data.emergingPatterns) {
      process.stdout.write(`  ${p.label} (momentum: ${p.momentum})\n`);
    }
  }

  if (data.decliningPatterns.length) {
    process.stdout.write(`\nDeclining (${data.decliningPatterns.length}):\n`);
    for (const p of data.decliningPatterns) {
      process.stdout.write(`  ${p.label} (momentum: ${p.momentum})\n`);
    }
  }
}

export function printChannels(data: ConnectedChannel[]): void {
  process.stdout.write(`Found ${data.length} connected channel${data.length === 1 ? '' : 's'}\n`);
  for (const ch of data) {
    const ig = ch.hasInstagram ? ' + Instagram' : '';
    process.stdout.write(`- ${ch.id}  ${ch.platform}${ig}  ${ch.accountName || ch.username || 'unnamed'}\n`);
  }
}

export function printPublishResult(data: PublishResult): void {
  const s = data.summary;
  process.stdout.write(`Published: ${s.success}/${s.total} succeeded, ${s.failed} failed\n`);
  for (const r of data.results) {
    if (r.status === 'success') {
      process.stdout.write(`  + ${r.platform} (${r.accountName}): ${r.postUrl}\n`);
    } else {
      process.stdout.write(`  x ${r.platform} (${r.accountName}): ${r.error}\n`);
    }
  }
}

export function printTransferResult(data: TransferAssetResult): void {
  process.stdout.write(`CDN URL: ${data.cdnUrl}\n`);
  process.stdout.write(`Asset ID: ${data.assetId}\n`);
  process.stdout.write(`Filename: ${data.filename}\n`);
}

export function printPublishHistory(data: PublishHistoryItem[]): void {
  process.stdout.write(`Found ${data.length} publish record${data.length === 1 ? '' : 's'}\n`);
  for (const item of data) {
    const date = item.publishedAt || item.createdAt;
    const status = item.status === 'published' ? '+' : 'x';
    process.stdout.write(`${status} [${item.platform || '?'}] ${item.contentType} — ${date}\n`);
    if (item.postUrl) {
      process.stdout.write(`  ${item.postUrl}\n`);
    }
    if (item.error) {
      process.stdout.write(`  Error: ${item.error}\n`);
    }
  }
}

export function printContentPlan(data: ContentPlanResult): void {
  // ── status line and unmatched short-circuit ─────────────────────────────
  if (data.status === 'unmatched') {
    process.stdout.write(`Status: unmatched\n`);
    if (data.reason) process.stdout.write(`Reason: ${data.reason}\n`);
    return;
  }

  if (data.status === 'dispatched') {
    process.stdout.write(`Status:      dispatched\n`);
    if (data.runId) process.stdout.write(`Run started: ${data.runId}\n`);
    if (data.webhookEnabled) {
      process.stdout.write(`Webhook:     enabled (POST on completion)\n`);
    }
  } else {
    // needs_input
    process.stdout.write(`Status:      needs_input\n`);
  }

  // ── selected app/model block ────────────────────────────────────────────
  if (data.selectedApp) {
    // appId is null when the planner fell back to a freestyle model. Show
    // the appId in parens only when it's a real catalog app.
    if (data.selectedApp.appId) {
      process.stdout.write(`App:         ${data.selectedApp.name} (${data.selectedApp.appId})\n`);
    } else {
      process.stdout.write(`Using:       ${data.selectedApp.name}\n`);
    }
    if (data.selectedApp.purpose) {
      process.stdout.write(`Purpose:     ${data.selectedApp.purpose}\n`);
    }
    process.stdout.write(
      `Why picked:  ${data.selectedApp.rationale} (confidence ${data.selectedApp.confidence.toFixed(2)})\n`
    );
  }

  // ── cost ────────────────────────────────────────────────────────────────
  if (data.cost) {
    const { expected, min, max } = data.cost;
    if (min === expected && max === expected) {
      process.stdout.write(`Cost:        ~${expected} credits\n`);
    } else {
      process.stdout.write(`Cost:        ~${expected} credits (range ${min}–${max})\n`);
    }
  }

  // ── brand context applied (if any) ──────────────────────────────────────
  if (data.brandContext && data.brandContext.voiceAttributes.length > 0) {
    process.stdout.write(`Brand voice: ${data.brandContext.voiceAttributes.join(', ')}\n`);
  }
  if (data.guidanceSummary && data.guidanceSummary.promptDirectives.length > 0) {
    const n = data.guidanceSummary.promptDirectives.length;
    process.stdout.write(`Guidance:    ${n} prompt directive${n === 1 ? '' : 's'} applied\n`);
  }

  // ── drafted inputs (filled from the brief) ──────────────────────────────
  const draftedKeys = Object.keys(data.drafted);
  if (draftedKeys.length > 0) {
    process.stdout.write(`\nDrafted from brief (${draftedKeys.length}):\n`);
    for (const key of draftedKeys) {
      const value = data.drafted[key];
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      const truncated = display.length > 80 ? `${display.slice(0, 77)}…` : display;
      process.stdout.write(`  ${key} = ${truncated}\n`);
    }
  }

  // ── defaulted (workflow author defaults used) ───────────────────────────
  const defaultedKeys = Object.keys(data.defaulted);
  if (defaultedKeys.length > 0) {
    process.stdout.write(`\nUsing workflow defaults (${defaultedKeys.length}):\n`);
    for (const key of defaultedKeys) {
      const value = data.defaulted[key];
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      const truncated = display.length > 60 ? `${display.slice(0, 57)}…` : display;
      process.stdout.write(`  ${key} = ${truncated}\n`);
    }
  }

  // ── must-supply (the honest gaps) ───────────────────────────────────────
  if (data.askUser.length > 0) {
    process.stdout.write(`\nNeed from you (${data.askUser.length}):\n`);
    for (const item of data.askUser) {
      process.stdout.write(`  ${item.key}  (${item.type})\n`);
      if (item.purpose) process.stdout.write(`    purpose: ${item.purpose}\n`);
      process.stdout.write(`    ask:     ${item.askUser}\n`);
    }
  }

  // ── follow-up hint ──────────────────────────────────────────────────────
  if (data.status === 'dispatched' && data.runId) {
    if (!data.webhookEnabled) {
      // App runs use `lamina runs wait`; freestyle runs poll a different
      // endpoint (`/v1/freestyle/:runId`) — surface the right path so the
      // caller doesn't burn time on a 404.
      if (data.runType === 'freestyle') {
        process.stdout.write(
          `\nFreestyle run — poll with the SDK: \`client.freestyle.wait("${data.runId}")\`\n`
        );
      } else {
        process.stdout.write(`\nFollow with: lamina runs wait ${data.runId}\n`);
      }
    }
  } else {
    // needs_input
    if (data.askUser.length === 0 && data.dispatchHint) {
      // plan-only branch — preview without dispatching
      process.stdout.write(`\nReady to run:\n  ${data.dispatchHint}\n`);
    } else if (data.askUser.length > 0 && data.selectedApp) {
      process.stdout.write(
        `\nNext: collect the inputs above, then run \`lamina run ${data.selectedApp.appId} --input <key>=<value>\`.\n`
      );
    }
  }
}

export function printContentScore(data: unknown): void {
  // The /v1/content/score endpoint returns {workspaceId, itemsScanned,
  // scoresCreated, contentItemIds[], scores[]}. Type is `unknown` in the SDK
  // because the shape has evolved; we narrow defensively here.
  if (!data || typeof data !== 'object') {
    process.stdout.write('Score response was empty.\n');
    return;
  }

  const d = data as Record<string, unknown>;
  const workspaceId = typeof d.workspaceId === 'string' ? d.workspaceId : null;
  const itemsScanned = typeof d.itemsScanned === 'number' ? d.itemsScanned : 0;
  const scoresCreated = typeof d.scoresCreated === 'number' ? d.scoresCreated : 0;
  const scores = Array.isArray(d.scores) ? d.scores : [];

  if (workspaceId) {
    process.stdout.write(`Workspace:       ${workspaceId}\n`);
  }
  process.stdout.write(`Items scanned:   ${itemsScanned}\n`);
  process.stdout.write(`Scores created:  ${scoresCreated}\n`);

  if (itemsScanned === 0) {
    process.stdout.write(
      `\nNo content scored. This workspace has no scorable content yet —\n` +
        `publish content via \`lamina publishing publish ...\` and rerun.\n`
    );
    return;
  }

  if (scores.length === 0) {
    return;
  }

  process.stdout.write(`\nScores (${scores.length}):\n`);
  for (const score of scores) {
    if (!score || typeof score !== 'object') continue;
    const s = score as Record<string, unknown>;
    const id = typeof s.contentItemId === 'string' ? s.contentItemId : '?';
    const value = typeof s.score === 'number' ? s.score.toFixed(2) : '—';
    const label = typeof s.label === 'string' ? ` (${s.label})` : '';
    process.stdout.write(`  ${id}  →  ${value}${label}\n`);
  }
}

export function printContentBrief(data: ContentBriefResult): void {
  process.stdout.write(`Generated ${data.concepts.length} concept${data.concepts.length === 1 ? '' : 's'}\n\n`);
  for (let i = 0; i < data.concepts.length; i++) {
    const c = data.concepts[i];
    process.stdout.write(`${i + 1}. ${c.title}\n`);
    process.stdout.write(`   ${c.concept}\n`);
    process.stdout.write(`   Platform: ${c.platform} | Format: ${c.format} | ${c.modality}\n`);
    process.stdout.write(`   Performance: ${c.predictedPerformance}\n`);
    process.stdout.write(`   Prompt: ${c.prompt.substring(0, 120)}${c.prompt.length > 120 ? '...' : ''}\n\n`);
  }
}

// Top-level help layout follows the convention popularised by `gh` and adopted
// by `vercel`, `supabase`, `wrangler`, `fly`: USAGE → command groups → EXAMPLES
// → ENVIRONMENT VARIABLES → EXIT CODES → FOR AGENTS → LEARN MORE. Section names
// are uppercase so structure scans visually. The FOR AGENTS section is the
// single most important deviation — it surfaces the MCP path so users
// integrating with Claude / Cursor don't waste cycles wrapping the CLI.
export function printHelp(): void {
  process.stdout.write(`Lamina CLI — agentic creative API for video, image, and content generation.

USAGE
  lamina <command> <subcommand> [flags]

CORE COMMANDS
  login         Authenticate with Lamina
  logout        Sign out
  whoami        Show authenticated user + active workspace
  apps          Discover and inspect apps in your workspace
  assets        Upload local files (images, videos, audio) to the CDN
  run           Run an app with explicit inputs
  runs          Inspect previously-started runs
  content       Plan and run from a natural-language brief
  webhook       Run a local listener for webhook deliveries

ADDITIONAL COMMANDS
  intelligence  Brand context, predictions, recommendations, trends

EXAMPLES
  $ lamina apps list --search selfie
  $ lamina apps get e0124407-d57a-4f76-ac5a-be0041e55a24
  $ lamina assets upload ./me.jpg
  $ lamina run e0124407-d57a-4f76-ac5a-be0041e55a24 --input celebrity_text="Brad Pitt" --wait
  $ lamina content plan "a selfie with Tom Holland" --modality image
  $ lamina webhook listen --public-url https://my-tunnel.example/lamina/webhook --save-default

ENVIRONMENT VARIABLES
  LAMINA_API_KEY    API key. Overrides credentials saved via \`lamina login\`.
  LAMINA_BASE_URL   Endpoint URL. Defaults to https://app.uselamina.ai.

EXIT CODES
  0   Success
  1   Runtime error (network, server, auth rejected)
  2   Invalid usage (missing arg, bad flag, unknown subcommand)

FOR AGENTS
  This CLI is built for humans and scripts. If you're integrating Lamina into
  an LLM agent (Claude Code, Cursor, custom MCP client), connect to the hosted
  MCP server — agents get typed tools and JSON in/out without parsing CLI text:

    https://app.uselamina.ai/mcp/agent

  Add this URL to your MCP client config and authenticate via OAuth.

LEARN MORE
  Use \`lamina <command> --help\` (or \`lamina help <command>\`) for more on a command.
  Read the docs at https://docs.uselamina.ai
`);
}

export function printVersion(cliVersion: string, sdkVersion: string): void {
  // Format mirrors `gh --version`: tool version on first line, dependency
  // versions on subsequent lines. Critical info for bug reports.
  const platform = `${process.platform} ${process.arch}`;
  const nodeVer = process.version;
  process.stdout.write(`lamina ${cliVersion}\n`);
  process.stdout.write(`@uselamina/sdk ${sdkVersion}\n`);
  process.stdout.write(`node ${nodeVer} (${platform})\n`);
}
