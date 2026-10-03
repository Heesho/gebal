import { Store, hash, stable, identity, now } from './store.ts';
import {
  Plan,
  Run,
  defaultLimits,
  type PlanT,
  type SnapshotT,
  type TaskT,
  type RunT,
  type FindingT,
  type Limits,
} from './schema.ts';
import { diagnose, validateRefs, verifySnapshot } from './intake.ts';
import { dockerAvailable, sandbox, imagePattern } from '../../adapters/src/sandbox.ts';
import { parseTool, type Candidate } from '../../adapters/src/tools.ts';
import { provider, systemPrompt, ProviderOutputError } from '../../adapters/src/providers.ts';
export function createPlan(
  store: Store,
  snapshotId: string,
  options: {
    image?: string;
    sourceOnly?: boolean;
    existingTests?: boolean;
    provider?: PlanT['provider'];
    limits?: Partial<Limits>;
  } = {},
) {
  const snap = store.get<SnapshotT>('snapshot', snapshotId);
  if (options.sourceOnly && options.existingTests)
    throw new Error('Source-only mode cannot execute existing tests');
  if (options.image && !imagePattern.test(options.image))
    throw new Error('Image must be pinned to an immutable digest');
  const data = {
    ...identity(),
    snapshotId,
    snapshotHash: snap.hash,
    scopeId: snap.scopeId,
    diagnosis: diagnose(store, snap),
    tasks: [
      'intake',
      ...(options.sourceOnly
        ? []
        : ['foundry-build', ...(options.existingTests ? ['foundry-test'] : []), 'slither']),
      ...(options.provider ? ['model-review'] : []),
    ],
    limits: { ...defaultLimits, ...options.limits },
    image: options.image ?? null,
    provider: options.provider ?? null,
    egress: options.provider
      ? [
          `${options.provider.provider}: all authorized snapshot source text and stated requirements`,
        ]
      : [],
    methodology: 'native-review-v1',
    adapterVersion: '0.1.0',
  };
  const plan = Plan.parse({ ...data, hash: hash(stable(data)) });
  store.put('plan', plan);
  return plan;
}
export function verifyPlan(plan: PlanT) {
  const { hash: expected, ...data } = plan;
  if (hash(stable(data)) !== expected) throw new Error('Plan integrity failure');
}
export function approvePlan(
  store: Store,
  planId: string,
  expectedHash: string,
  actor: string,
  rationale: string,
) {
  const plan = store.get<PlanT>('plan', planId);
  verifyPlan(plan);
  if (plan.hash !== expectedHash) throw new Error('Approval hash does not match plan');
  return store.put('decision', {
    ...identity(),
    subjectId: planId,
    action: 'approve-plan',
    rationale,
    actor,
    boundHash: plan.hash,
  });
}
function approved(store: Store, plan: PlanT) {
  verifyPlan(plan);
  return store
    .list('decision')
    .some(
      (d) => d.subjectId === plan.id && d.action === 'approve-plan' && d.boundHash === plan.hash,
    );
}
export function enqueue(store: Store, planId: string) {
  const plan = store.get<PlanT>('plan', planId);
  if (!approved(store, plan)) throw new Error('Explicit hash-bound plan approval is required');
  if (plan.tasks.length > plan.limits.maxTasks) throw new Error('Task budget exceeded');
  return store.transaction(() => {
    const run = Run.parse({
      ...identity(),
      planId,
      snapshotId: plan.snapshotId,
      state: 'pending',
      finishedAt: null,
      cancelRequested: false,
      costUsd: null,
      reservedTokens: 0,
      usedTokens: 0,
    });
    store.put('run', run);
    let intakeId = '',
      buildId = '';
    for (const kind of plan.tasks) {
      const t = {
        ...identity(),
        runId: run.id,
        kind,
        state: 'pending',
        dependencies: kind === 'intake' ? [] : kind === 'foundry-test' ? [buildId] : [intakeId],
        attempts: 0,
        leaseUntil: null,
        leaseOwner: null,
        detail: 'Awaiting worker',
        evidence: [],
      };
      if (kind === 'intake') intakeId = t.id;
      if (kind === 'foundry-build') buildId = t.id;
      store.put('task', t);
    }
    store.event(run.id, 'Approved plan enqueued.');
    return run;
  });
}
export function triage(
  store: Store,
  id: string,
  action: 'accept' | 'reject' | 'needs-review',
  rationale: string,
  actor: string,
) {
  store.get('finding', id);
  return store.put('decision', {
    ...identity(),
    subjectId: id,
    action,
    rationale,
    actor,
    boundHash: null,
  });
}
export function recordCandidates(
  store: Store,
  runId: string,
  snap: SnapshotT,
  items: Candidate[],
  evidence: string[],
  producer: string,
) {
  for (const h of evidence) store.readArtifact(h);
  for (const item of items) {
    validateRefs(snap, item.source);
    const observation = store.put('observation', {
      ...identity(),
      runId,
      producer,
      text: item.description,
      source: item.source,
      evidence,
    });
    // Only exact same producer/rule/source/description duplicates share a fingerprint. Never merge human decisions.
    const fingerprint = hash(
      stable({ producer, rule: item.rule, source: item.source, description: item.description }),
    );
    store.put('finding', {
      ...identity(),
      runId,
      title: item.title,
      description: item.description,
      severity: item.severity,
      confidence: item.confidence,
      evidenceType: producer === 'model' ? 'model' : 'static',
      source: item.source,
      evidence,
      observationIds: [observation.id],
      fingerprint,
    });
  }
}
export function cancelRun(store: Store, id: string) {
  return store.transaction(() => {
    const run = store.get<RunT>('run', id);
    store.put('run', { ...run, cancelRequested: true }, true);
    for (const task of store
      .list<TaskT>('task')
      .filter((t) => t.runId === id && t.state === 'pending'))
      store.put('task', { ...task, state: 'cancelled', detail: 'Cancelled by owner' }, true);
    store.event(id, 'Cancellation requested.');
  });
}
export function resumeRun(store: Store, id: string) {
  return store.transaction(() => {
    const run = store.get<RunT>('run', id);
    const tasks = store.list<TaskT>('task').filter((t) => t.runId === id);
    if (tasks.some((t) => t.state === 'running' && (t.leaseUntil ?? 0) > Date.now()))
      throw new Error('Run has a live worker lease');
    if (!approved(store, store.get('plan', run.planId))) throw new Error('Plan approval missing');
    for (const t of tasks) {
      if (t.kind === 'model-review' && t.attempts > 0 && t.state !== 'succeeded') {
        store.put(
          'task',
          {
            ...t,
            state: 'unknown',
            leaseUntil: null,
            leaseOwner: null,
            detail:
              'Remote outcome may be billable. Create a new approved plan after reviewing provider records.',
          },
          true,
        );
        continue;
      }
      if (['blocked', 'interrupted', 'running', 'cancelled', 'not-run'].includes(t.state))
        store.put(
          'task',
          {
            ...t,
            state: t.attempts >= 3 ? 'blocked' : 'pending',
            leaseUntil: null,
            leaseOwner: null,
            detail:
              t.attempts >= 3 ? 'Maximum local attempts reached' : 'Explicit resume requested',
          },
          true,
        );
    }
    store.put('run', { ...run, state: 'pending', cancelRequested: false, finishedAt: null }, true);
    store.event(id, 'Run resumed; prior artifacts and decisions retained.');
  });
}
export function summarize(store: Store, id: string) {
  const run = store.get<RunT>('run', id);
  const plan = store.get<PlanT>('plan', run.planId);
  const snapshot = store.get<SnapshotT>('snapshot', run.snapshotId);
  const scope = store.get('scope', snapshot.scopeId);
  const project = store.get('project', scope.projectId);
  const own = (kind: any) => store.list(kind).filter((v: any) => v.runId === id);
  const findings = own('finding') as FindingT[];
  const decisions = store
    .list('decision')
    .filter((d) => d.subjectId === plan.id || findings.some((f) => f.id === d.subjectId));
  const budget = store.db
    .prepare('SELECT reserved,consumed FROM reservations WHERE run_id=?')
    .get(id);
  return {
    schemaVersion: 1,
    brand: process.env.GEBAL_NAME || 'Gebal',
    domain: process.env.GEBAL_DOMAIN || 'gebal.ai',
    run: {
      ...run,
      reservedTokens: Number(budget?.reserved ?? 0),
      usedTokens: Number(budget?.consumed ?? 0),
    },
    plan,
    snapshot,
    scope,
    project,
    tasks: own('task') as TaskT[],
    findings,
    observations: own('observation'),
    properties: own('property'),
    coverage: own('coverage'),
    executions: own('execution'),
    invocations: own('invocation'),
    decisions,
    events: store.events(id),
    disclaimer:
      'An empty findings list is not a security certificate. Completed checks establish only their stated coverage.',
  };
}
export async function workRun(store: Store, id: string, externalSignal?: AbortSignal) {
  const run = store.get<RunT>('run', id),
    plan = store.get<PlanT>('plan', run.planId),
    snap = store.get<SnapshotT>('snapshot', run.snapshotId);
  if (!approved(store, plan)) throw new Error('Plan approval missing');
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const deadline = Date.now() + plan.limits.seconds * 1000;
  const timer = setTimeout(abort, plan.limits.seconds * 1000);
  const poll = setInterval(() => {
    if (store.get<RunT>('run', id).cancelRequested) abort();
  }, 200);
  const owner = identity().id;
  store.put('run', { ...run, state: 'running', finishedAt: null }, true);
  try {
    for (;;) {
      if (controller.signal.aborted || store.get<RunT>('run', id).cancelRequested) break;
      const task = store.claim(id, owner, plan.limits.seconds * 1000 + 15000);
      if (!task) break;
      store.event(id, `${task.kind}: running (attempt ${task.attempts})`);
      const began = Date.now();
      let state: TaskT['state'] = 'unknown',
        detail = '',
        evidence: string[] = [];
      try {
        if (task.kind === 'intake') {
          if (snap.hash !== plan.snapshotHash) throw new Error('Snapshot hash mismatch');
          verifySnapshot(store, snap);
          const artifact = store.artifact(
            JSON.stringify({ manifest: snap, diagnosis: plan.diagnosis }, null, 2),
            'intake',
            'application/json',
          );
          evidence = [artifact];
          state = 'succeeded';
          detail = `Recorded ${snap.files.length} authorized files. ${plan.diagnosis.supported ? 'Supported Foundry configuration.' : 'Build configuration unsupported; see diagnosis.'}`;
        } else if (task.kind === 'model-review') {
          if (!plan.provider || !plan.egress.length)
            throw new Error('Provider egress not approved');
          const key =
            process.env[
              plan.provider.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
            ];
          if (!key) {
            state = 'blocked';
            detail = `Missing ${plan.provider.provider} API key`;
          } else {
            const scope = store.get('scope', snap.scopeId);
            const context = JSON.stringify({
              requirements: scope.requirements,
              snapshotHash: snap.hash,
              files: snap.files.map((f) => ({
                path: f.path,
                content: store.readArtifact(f.hash).toString(),
              })),
            });
            const reserve =
              Buffer.byteLength(context + systemPrompt) + plan.provider.maxOutputTokens + 2048;
            store.reserve(id, reserve, plan.limits.tokens);
            const invocation = {
              ...identity(),
              runId: id,
              provider: plan.provider.provider,
              model: plan.provider.model,
              contextHash: hash(context),
              settings: {
                maxOutputTokens: plan.provider.maxOutputTokens,
                method: plan.methodology,
                sharedInputHashes: snap.files.map((f) => f.hash),
                temperature: 'provider-default',
                retries: 0,
              },
              inputTokens: null,
              outputTokens: null,
              costUsd: null,
              state: 'running',
              evidence: [],
            };
            store.put('invocation', invocation);
            try {
              const response = await provider(plan.provider.provider, key).review({
                model: plan.provider.model,
                context,
                maxOutputTokens: plan.provider.maxOutputTokens,
                signal: controller.signal,
              });
              const artifact = store.artifact(
                response.raw,
                'model:' + plan.provider.provider,
                'application/json',
              );
              evidence = [artifact];
              for (const item of response.result.observations) validateRefs(snap, item.source);
              recordCandidates(
                store,
                id,
                snap,
                response.result.observations.map((o) => ({
                  ...o,
                  description: o.description + '\nAssumptions: ' + o.assumptions.join('; '),
                  rule: 'native-review-v1',
                })),
                evidence,
                'model',
              );
              store.settle(id, reserve, response.inputTokens + response.outputTokens);
              store.put(
                'invocation',
                {
                  ...invocation,
                  state: 'succeeded',
                  inputTokens: response.inputTokens,
                  outputTokens: response.outputTokens,
                  evidence,
                },
                true,
              );
              state = 'succeeded';
              detail = `${response.result.observations.length} model observations; no human acceptance implied.`;
              store.put('coverage', {
                ...identity(),
                runId: id,
                taskId: task.id,
                state,
                claim: detail,
                gaps: response.result.gaps,
                evidence,
              });
            } catch (e) {
              if (e instanceof ProviderOutputError)
                evidence = [store.artifact(e.raw, 'invalid-model-output', 'application/json')];
              store.put('invocation', { ...invocation, state: 'unknown', evidence }, true);
              throw e;
            }
          }
        } else if (!plan.diagnosis.supported) {
          state = 'unsupported';
          detail = plan.diagnosis.issues.join('; ');
        } else if (!plan.image) {
          state = 'blocked';
          detail = 'No approved immutable tool image. No host execution was attempted.';
        } else {
          const available = await dockerAvailable();
          if (!available.available) {
            state = 'blocked';
            detail = 'Docker sandbox unavailable: ' + available.detail;
          } else {
            const executionPlan = {
              ...plan,
              limits: {
                ...plan.limits,
                seconds: Math.max(1, Math.floor((deadline - Date.now()) / 1000)),
              },
            };
            const { result, argv } = await sandbox(
              store,
              executionPlan,
              snap,
              task.kind,
              task.id,
              controller.signal,
            );
            const artifact = store.artifact(
              JSON.stringify(result),
              'tool:' + task.kind,
              'application/json',
            );
            evidence = [artifact];
            let version: string | null = null;
            if (result.cancelled) {
              state = 'cancelled';
              detail = 'Execution cancelled';
            } else if (result.timedOut) {
              state = 'timeout';
              detail = 'Execution time budget exceeded';
            } else if (result.overflow) {
              state = 'failed';
              detail = 'Tool output limit exceeded';
            } else if (result.code !== 0) {
              state = 'failed';
              detail = 'Sandbox/tool execution failed. Inspect the evidence artifact.';
            } else {
              const parsed = parseTool(task.kind, result.stdout, snap);
              state = parsed.state;
              detail = parsed.claim;
              version = parsed.version;
              recordCandidates(store, id, snap, parsed.findings, evidence, task.kind);
              store.put('coverage', {
                ...identity(),
                runId: id,
                taskId: task.id,
                state,
                claim: detail,
                gaps: parsed.gaps,
                evidence,
              });
            }
            store.put('execution', {
              ...identity(),
              runId: id,
              taskId: task.id,
              tool: task.kind,
              version,
              image: plan.image,
              argv,
              state,
              exitCode: result.code,
              evidence,
              seconds: (Date.now() - began) / 1000,
            });
          }
        }
      } catch (e) {
        state = task.kind === 'model-review' ? 'unknown' : 'failed';
        detail = String(e).slice(0, 4000);
      }
      if (!store.list('coverage').some((c) => c.taskId === task.id))
        store.put('coverage', {
          ...identity(),
          runId: id,
          taskId: task.id,
          state,
          claim: detail,
          gaps:
            task.kind === 'intake'
              ? ['No semantic, test, or property coverage established by intake.']
              : ['Check incomplete or blocked; no security coverage claimed.'],
          evidence,
        });
      store.finish(task, { state, detail, evidence });
      store.event(id, `${task.kind}: ${state} — ${detail}`);
    }
    const tasks = store.list<TaskT>('task').filter((t) => t.runId === id);
    // Another process may own a live lease. Do not finalize its work.
    if (tasks.some((t) => t.state === 'running')) return;
    const cancelled = store.get<RunT>('run', id).cancelRequested || externalSignal?.aborted;
    for (const t of tasks.filter((t) => t.state === 'pending'))
      store.put(
        'task',
        {
          ...t,
          state: cancelled ? 'cancelled' : Date.now() >= deadline ? 'timeout' : 'not-run',
          detail: cancelled
            ? 'Cancelled'
            : Date.now() >= deadline
              ? 'Run wall-time budget exceeded'
              : 'Prerequisite did not succeed',
        },
        true,
      );
    const completed = store.list<TaskT>('task').filter((t) => t.runId === id);
    const state = cancelled
      ? 'cancelled'
      : completed.every((t) => t.state === 'succeeded')
        ? 'succeeded'
        : completed.some((t) => t.state === 'failed')
          ? 'failed'
          : completed.some((t) => t.state === 'timeout')
            ? 'timeout'
            : completed.some((t) => t.state === 'unknown')
              ? 'unknown'
              : 'blocked';
    store.put('run', { ...store.get<RunT>('run', id), state, finishedAt: now() }, true);
    store.event(id, `Run ${state}. Review coverage gaps before relying on results.`);
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    externalSignal?.removeEventListener('abort', abort);
  }
}
export function compare(store: Store, left: string, right: string) {
  const a = summarize(store, left),
    b = summarize(store, right);
  const paths = new Set([...a.snapshot.files, ...b.snapshot.files].map((f) => f.path));
  return {
    mode: 'partial source comparison; full rerun required for caller/dependency impact',
    left,
    right,
    scopeChanged:
      stable({
        paths: a.scope.paths,
        exclusions: a.scope.exclusions,
        requirements: a.scope.requirements,
      }) !==
      stable({
        paths: b.scope.paths,
        exclusions: b.scope.exclusions,
        requirements: b.scope.requirements,
      }),
    changed: [...paths].filter(
      (p) =>
        a.snapshot.files.find((f) => f.path === p)?.hash !==
        b.snapshot.files.find((f) => f.path === p)?.hash,
    ),
    staleFindings: a.findings.map((f) => f.id),
    reusedEvidence: false,
  };
}
