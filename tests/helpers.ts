import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../packages/core/src/store.ts';
import { snapshot } from '../packages/core/src/intake.ts';
import { createPlan, approvePlan, enqueue } from '../packages/core/src/engine.ts';
export function setup() {
  const base = mkdtempSync(join(tmpdir(), 'gebal-test-'));
  const root = join(base, 'repo');
  cpSync(resolve('fixtures/vault'), root, { recursive: true });
  const store = new Store(join(base, 'state'));
  return {
    base,
    root,
    store,
    cleanup() {
      store.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}
export function prepared(ctx: ReturnType<typeof setup>, tests = false) {
  const snap = snapshot(
    ctx.store,
    ctx.root,
    ['src', 'test', 'foundry.toml'],
    [],
    'Fixture accounting and owner authorization.',
    'owned',
  );
  const plan = createPlan(ctx.store, snap.id, { existingTests: tests });
  approvePlan(ctx.store, plan.id, plan.hash, 'test-owner', 'Review exact original fixture plan');
  return { snap, plan, run: enqueue(ctx.store, plan.id) };
}
export const toolEnvelope = (tool: 'forge' | 'slither', data: unknown, exitCode = 0) =>
  JSON.stringify({
    version: tool === 'forge' ? 'forge Version: 1.3.1' : '0.11.3',
    compilerVersion: 'Version: 0.8.28+commit.test',
    exitCode,
    stdout: JSON.stringify(data),
    stderr: '',
  });
