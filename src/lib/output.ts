import type {
  AppDetail,
  AppSummary,
  BrandContextResponse,
  ConnectedChannel,
  ContentBriefResult,
  ExecutionStatus,
  LaminaCreateResult,
  PerformancePrediction,
  PublishHistoryItem,
  PublishResult,
  Recommendation,
  TransferAssetResult,
  TrendPatternSummary,
  WorkflowStructure,
} from '@uselamina/sdk';

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
  process.stdout.write(`Found ${apps.length} app${apps.length === 1 ? '' : 's'}\n`);
  for (const app of apps) {
    process.stdout.write(`- ${app.appId}  ${app.name}\n`);
  }
}

export function printAppDetail(app: AppDetail): void {
  process.stdout.write(`${app.name}\n`);
  process.stdout.write(`App ID: ${app.appId}\n`);
  if (app.description) {
    process.stdout.write(`${app.description}\n`);
  }

  if (app.parameters.length === 0) {
    process.stdout.write('Parameters: none\n');
    return;
  }

  process.stdout.write('Parameters:\n');
  for (const parameter of app.parameters) {
    const required = parameter.required ? 'required' : 'optional';
    const optionText =
      parameter.type === 'options' && parameter.options?.length
        ? ` [${parameter.options.join(', ')}]`
        : '';
    process.stdout.write(`- ${parameter.name} (${parameter.type}, ${required})${optionText}\n`);
  }
}

export function printWorkflow(workflow: WorkflowStructure): void {
  process.stdout.write(`${workflow.name}\n`);
  process.stdout.write(`App ID: ${workflow.appId}\n`);
  process.stdout.write(`Nodes: ${workflow.nodes.length}\n`);
  process.stdout.write(`Edges: ${workflow.edges.length}\n`);
}

export function printExecution(execution: ExecutionStatus): void {
  process.stdout.write(`Run: ${execution.runId}\n`);
  process.stdout.write(`Status: ${execution.status}\n`);
  process.stdout.write(`Workflow: ${execution.workflowId}\n`);

  if (execution.errorMessage) {
    process.stdout.write(`Error: ${execution.errorMessage}\n`);
  }

  if (execution.outputs.length > 0) {
    process.stdout.write('Outputs:\n');
    for (const output of execution.outputs) {
      process.stdout.write(
        `- ${output.label} (${output.type}, ${output.status})${
          output.value ? `: ${String(output.value)}` : ''
        }\n`
      );
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
  process.stdout.write(`Saved webhook URL: ${status.publicUrl || 'none'}\n`);
  if (status.host && typeof status.port === 'number' && status.path) {
    process.stdout.write(`Listener defaults: http://${status.host}:${status.port}${status.path}\n`);
  }
}

export function printBrandContext(data: BrandContextResponse): void {
  if (data.brandDna) {
    process.stdout.write('Brand DNA\n');
    if (data.brandDna.voiceAttributes.length) {
      process.stdout.write(`  Voice: ${data.brandDna.voiceAttributes.join(', ')}\n`);
    }
    if (data.brandDna.contentPillars.length) {
      process.stdout.write(`  Pillars: ${data.brandDna.contentPillars.join(', ')}\n`);
    }
    if (data.brandDna.guardrails.length) {
      process.stdout.write(`  Guardrails: ${data.brandDna.guardrails.join(', ')}\n`);
    }
    if (data.brandDna.visualIdentity.length) {
      process.stdout.write(`  Visual: ${data.brandDna.visualIdentity.join(', ')}\n`);
    }
  } else {
    process.stdout.write('Brand DNA: not available\n');
  }

  if (data.guidance) {
    process.stdout.write('\nGuidance\n');
    for (const d of data.guidance.promptDirectives) {
      process.stdout.write(`  + ${d}\n`);
    }
    for (const d of data.guidance.negativePrompts) {
      process.stdout.write(`  - ${d}\n`);
    }
  }

  if (data.topPatterns) {
    process.stdout.write(`\nTop Patterns (${data.topPatterns.topPatterns.length})\n`);
    for (const p of data.topPatterns.topPatterns) {
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

export function printCompoundCreate(data: LaminaCreateResult): void {
  process.stdout.write(`Run: ${data.runId}\n`);
  process.stdout.write(`Status: ${data.status}\n`);
  process.stdout.write(`Workflow: ${data.workflowName} (${data.workflowId})\n`);
  process.stdout.write(`Selected: ${data.selectedApp.name} — ${data.selectedApp.whyMatched} (confidence: ${data.selectedApp.confidence.toFixed(2)})\n`);

  if (data.brandContext) {
    const bc = data.brandContext;
    if (bc.voiceAttributes.length) {
      process.stdout.write(`Brand voice: ${bc.voiceAttributes.join(', ')}\n`);
    }
  }

  if (data.guidanceSummary?.promptDirectives.length) {
    process.stdout.write(`Directives: ${data.guidanceSummary.promptDirectives.length} applied\n`);
  }

  process.stdout.write(`\nUse \`lamina runs wait ${data.runId}\` to get results.\n`);
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

export function printHelp(): void {
  process.stdout.write(`Lamina CLI\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`Commands:\n`);
  process.stdout.write(`  lamina login\n`);
  process.stdout.write(`  lamina auth status\n`);
  process.stdout.write(`  lamina auth clear\n`);
  process.stdout.write(`  lamina apps list [--search text] [--limit n]\n`);
  process.stdout.write(`  lamina apps get <appId>\n`);
  process.stdout.write(`  lamina apps workflow <appId>\n`);
  process.stdout.write(
    `  lamina run <appId> [--file inputs.json] [--input key=value] [--wait] [--webhook <url|default|local>]\n`
  );
  process.stdout.write(`  lamina runs get <runId>\n`);
  process.stdout.write(`  lamina runs wait <runId>\n`);
  process.stdout.write(`  lamina intelligence brand-context [--platform x] [--modality x]\n`);
  process.stdout.write(
    `  lamina intelligence predict "concept" --platform instagram --modality image\n`
  );
  process.stdout.write(`  lamina intelligence recommendations [--platform x]\n`);
  process.stdout.write(`  lamina intelligence trends [--window-days 7] [--platform x]\n`);
  process.stdout.write(`  lamina publishing channels\n`);
  process.stdout.write(
    `  lamina publishing publish --account-id <id> [--image-url x] [--caption x]\n`
  );
  process.stdout.write(`  lamina publishing transfer-asset <url> --media-type image\n`);
  process.stdout.write(`  lamina publishing history [--status published] [--platform meta]\n`);
  process.stdout.write(
    `  lamina content create "brief" [--platform x] [--modality x] [--app-id x]\n`
  );
  process.stdout.write(`  lamina content brief "goal" [--platform x] [--count 3]\n`);
  process.stdout.write(`  lamina content score [--platform x] [--modality x]\n`);
  process.stdout.write(`  lamina webhook signing-key\n`);
  process.stdout.write(`  lamina webhook status\n`);
  process.stdout.write(`  lamina webhook clear\n`);
  process.stdout.write(`  lamina webhook serve [--public-url https://... --save-default]\n`);
  process.stdout.write(`  lamina mcp serve\n`);
  process.stdout.write(`\n`);
}
