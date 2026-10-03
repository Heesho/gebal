import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { snapshot } from '../packages/core/src/intake.ts';
import {
  createPlan,
  approvePlan,
  enqueue,
  workRun,
  summarize,
} from '../packages/core/src/engine.ts';
// Explicitly opt in with an operator-reviewed immutable image. No fallback to host tools.
test(
  'opt-in real Foundry/Slither fixture execution',
  { skip: !process.env.GEBAL_INTEGRATION_IMAGE },
  async () => {
    const c = setup();
    try {
      const snap = snapshot(
        c.store,
        c.root,
        ['src', 'test', 'foundry.toml'],
        [],
        'Original fixture conservation, authorization and bounded retirement.',
        'owned',
      );
      const plan = createPlan(c.store, snap.id, {
        image: process.env.GEBAL_INTEGRATION_IMAGE,
        existingTests: true,
        limits: { seconds: 180 },
      });
      approvePlan(
        c.store,
        plan.id,
        plan.hash,
        'integration-operator',
        'Explicit opt-in original fixture execution in reviewed image',
      );
      const run = enqueue(c.store, plan.id);
      await workRun(c.store, run.id);
      const result = summarize(c.store, run.id);
      assert.equal(result.run.state, 'succeeded', JSON.stringify(result.tasks, null, 2));
      assert.ok(result.tasks.every((t) => t.evidence.length > 0));
      assert.equal(result.executions.length, 3);
    } finally {
      c.cleanup();
    }
  },
);
