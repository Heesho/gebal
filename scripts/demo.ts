import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Store } from '../packages/core/src/store.ts';
import { snapshot } from '../packages/core/src/intake.ts';
import {
  createPlan,
  approvePlan,
  enqueue,
  workRun,
  summarize,
} from '../packages/core/src/engine.ts';
import { report } from '../packages/core/src/report.ts';
const home = process.env.GEBAL_HOME ?? mkdtempSync(join(tmpdir(), 'gebal-demo-'));
const store = new Store(home);
try {
  const snap = snapshot(
    store,
    resolve('fixtures/vault'),
    ['src', 'test', 'foundry.toml'],
    [],
    'Original synthetic fixture: owner-only credit issuance, accounting conservation, bounded retirement, downward unit rounding. No real funds.',
    'owned',
  );
  const project = store.get('project', store.get('scope', snap.scopeId).projectId);
  store.put('project', { ...project, origin: 'bundled-fixture' }, true);
  const plan = createPlan(store, snap.id, {
    existingTests: process.argv.includes('--tools'),
    sourceOnly: !process.argv.includes('--tools'),
    image: process.env.GEBAL_TOOL_IMAGE,
    limits: { maxTasks: 4 },
  });
  approvePlan(
    store,
    plan.id,
    plan.hash,
    'bundled-fixture-demo',
    'Explicit demo invocation authorizes only original bundled fixture and existing tests; no cloud egress.',
  );
  const run = enqueue(store, plan.id);
  await workRun(store, run.id);
  const result = summarize(store, run.id);
  if (result.run.state !== 'succeeded') process.exitCode = 3;
  const dir = join(home, 'reports');
  mkdirSync(dir, { recursive: true });
  for (const format of ['json', 'md', 'html', 'sarif'] as const)
    writeFileSync(join(dir, `${run.id}.${format}`), report(store, run.id, format), { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        origin:
          'Original bundled synthetic fixture; real engine execution, not simulated tool results',
        home,
        runId: run.id,
        state: result.run.state,
        tasks: result.tasks.map((t) => ({ kind: t.kind, state: t.state, detail: t.detail })),
        reports: dir,
        next: `GEBAL_HOME=${home} pnpm gebal context ${run.id} --output /tmp/gebal-context.json`,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
