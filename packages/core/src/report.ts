import { summarize } from './engine.ts';
import { Store } from './store.ts';
const escape = (x: unknown) =>
  String(x).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const md = (x: unknown) =>
  String(x)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[\\`*{}\[\]()#+.!_|<>]/g, '\\$&');
export function report(store: Store, id: string, format: 'json' | 'md' | 'html' | 'sarif') {
  const data = summarize(store, id);
  for (const f of data.findings) {
    for (const h of f.evidence) store.readArtifact(h);
  }
  if (format === 'json') return JSON.stringify(data, null, 2);
  if (format === 'sarif')
    return JSON.stringify(
      {
        version: '2.1.0',
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        runs: [
          {
            tool: { driver: { name: data.brand, version: '0.1.0' } },
            invocations: [
              {
                executionSuccessful: data.run.state === 'succeeded',
                toolExecutionNotifications: data.tasks
                  .filter((t) => t.state !== 'succeeded')
                  .map((t) => ({
                    level: 'error',
                    message: { text: t.kind + ': ' + t.state + ' ' + t.detail },
                  })),
              },
            ],
            results: data.findings.map((f) => ({
              ruleId: f.evidenceType + '/' + f.title,
              level:
                f.severity === 'high'
                  ? 'error'
                  : f.severity === 'informational'
                    ? 'note'
                    : 'warning',
              message: { text: f.description },
              locations: f.source.map((s) => ({
                physicalLocation: {
                  artifactLocation: { uri: s.path.split('/').map(encodeURIComponent).join('/') },
                  region: { startLine: s.start, endLine: s.end },
                },
              })),
              properties: {
                confidence: f.confidence,
                evidence: f.evidence,
                disposition:
                  data.decisions.filter((d) => d.subjectId === f.id).at(-1)?.action ??
                  'needs-review',
              },
            })),
          },
        ],
      },
      null,
      2,
    );
  const content = `# ${md(data.brand)} assessment\n\nRun: ${md(id)}\n\n**Outcome: ${md(data.run.state)}**\n\n${md(data.disclaimer)}\n\n${data.plan.tasks.every((t) => t === 'intake' || t === 'model-review') ? '**Source-only run: no compiler, static analyzer or executable test coverage.**' : ''}\n\nSnapshot: ${data.snapshot.hash}\n\n## Incomplete checks\n\n${
    data.tasks
      .filter((t) => t.state !== 'succeeded')
      .map((t) => `- ${md(t.kind)}: **${md(t.state)}** — ${md(t.detail)}`)
      .join('\n') || 'All planned tasks completed. Coverage remains limited to the checks below.'
  }\n\n## Scope and requirements\n\n${md(data.scope.requirements)}\n\nAuthorized: ${data.scope.paths.map(md).join(', ')}\n\nExcluded/absent: ${data.snapshot.excluded.map(md).join(', ')}\n\n## Check evidence\n\n${data.tasks.map((t) => `- ${md(t.kind)}: ${md(t.state)}. ${md(t.detail)}\n  Evidence: ${t.evidence.join(', ') || 'none'}`).join('\n')}\n\n## Findings requiring human review\n\n${data.findings.map((f) => `### ${md(f.title)}\n\nSeverity: ${f.severity}; confidence: ${f.confidence}; evidence: ${f.evidenceType}; disposition: ${md(data.decisions.filter((d) => d.subjectId === f.id).at(-1)?.action ?? 'needs-review')}\n\n${md(f.description)}\n\nSource: ${f.source.map((s) => `${md(s.path)}:${s.start}-${s.end}`).join(', ')}\n\nArtifacts: ${f.evidence.join(', ')}\n`).join('\n') || 'No findings recorded. This does not establish safety.'}\n\n## Coverage gaps\n\n${data.coverage
    .flatMap((c) => c.gaps)
    .map((g: string) => '- ' + md(g))
    .join(
      '\n',
    )}\n\n## Provenance and cost\n\nMethod: ${data.plan.methodology}; adapter: ${data.plan.adapterVersion}\n\nTool image: ${md(data.plan.image ?? 'unavailable')}; compiler: ${md(data.plan.diagnosis.compiler ?? 'unknown')}; EVM: ${md(data.plan.diagnosis.evm ?? 'unknown')}\n\nPlanned direct provider/model: ${md(data.plan.provider ? data.plan.provider.provider + '/' + data.plan.provider.model : 'none')}\n\nExternal reviewers: ${
    data.invocations
      .filter((i) => i.provider === 'external-agent')
      .map((i) => md(i.model))
      .join(', ') || 'none'
  }. External provenance, usage and spend are unverified.\n\nRecorded direct API tokens: ${data.run.usedTokens}; reserved: ${data.run.reservedTokens}. Monetary cost: ${data.run.costUsd === null ? 'unknown' : data.run.costUsd}. Local compute cost is not measured.\n\nThe JSON report retains manifests, settings, decisions, invocations, source hashes, timelines and coverage records. Artifact IDs resolve through the local store or CLI evidence command.\n`;
  if (format === 'md') return content;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(data.brand)} assessment</title><style>body{background:#10151b;color:#e5e9f0;font:15px/1.65 ui-monospace,monospace;max-width:1000px;margin:48px auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{color:#c2e5ab}small{color:#9ba6b5}</style><h1>${escape(data.brand)} / assessment</h1><small>Source and evidence are escaped, inert text. Outcome: ${escape(data.run.state)}</small><pre>${escape(content)}</pre></html>`;
}
