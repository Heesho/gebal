import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, prepared } from './helpers.ts';
import { agentContext, importAgentReview } from '../packages/core/src/agent.ts';
import {
  createPlan,
  approvePlan,
  enqueue,
  workRun,
  summarize,
  recordCandidates,
} from '../packages/core/src/engine.ts';
import { report } from '../packages/core/src/report.ts';

function response(context: ReturnType<typeof agentContext>) {
  return {
    schemaVersion: 1,
    snapshotHash: context.snapshotHash,
    contextHash: context.contextHash,
    review: {
      observations: [
        {
          title: 'Synthetic importer control',
          description: 'This is a parser test, not a real finding.',
          severity: 'informational',
          confidence: 'low',
          source: [{ path: 'src/CreditLedger.sol', start: 5, end: 6 }],
          assumptions: ['Test transport only'],
        },
      ],
      gaps: ['No external model actually ran in this unit test'],
    },
  };
}

test('own-agent cold export contains scoped source but no peer findings, warnings or labels', () => {
  const c = setup();
  try {
    const { snap, run } = prepared(c);
    const h = c.store.artifact('secret peer result', 'test');
    recordCandidates(
      c.store,
      run.id,
      snap,
      [
        {
          title: 'Peer-only marker',
          description: 'PEER_FINDING_MUST_NOT_LEAK',
          severity: 'low',
          confidence: 'low',
          source: [{ path: 'src/CreditLedger.sol', start: 1, end: 2 }],
          rule: 'test',
        },
      ],
      [h],
      'slither',
    );
    const context = agentContext(c.store, run.id);
    assert.ok(context.files.some((f) => f.content.includes('contract CreditLedger')));
    assert.ok(!JSON.stringify(context).includes('PEER_FINDING_MUST_NOT_LEAK'));
    assert.equal(context.contextHash.length, 64);
  } finally {
    c.cleanup();
  }
});
test('own-agent import preserves raw observations and uncertainty without completing blocked checks', async () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    await workRun(c.store, run.id);
    const context = agentContext(c.store, run.id);
    const result = importAgentReview(
      c.store,
      run.id,
      response(context),
      'operator-reported assistant',
    );
    assert.equal(result.observations, 1);
    assert.equal(result.disposition, 'needs-review');
    const data = summarize(c.store, run.id);
    assert.equal(data.run.state, 'blocked');
    assert.equal(data.invocations[0].inputTokens, null);
    assert.equal(data.invocations[0].provider, 'external-agent');
    assert.equal(data.coverage.at(-1).state, 'unknown');
    assert.match(c.store.readArtifact(result.evidence).toString(), /Synthetic importer control/);
    assert.match(report(c.store, run.id, 'md'), /operator-reported assistant/);
    assert.throws(
      () => importAgentReview(c.store, run.id, response(context), 'same reviewer'),
      /already imported/,
    );
  } finally {
    c.cleanup();
  }
});
test('own-agent imports reject stale source/context, unsafe spans, executable fields and partial results', () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    const context = agentContext(c.store, run.id);
    for (const key of ['contextHash', 'snapshotHash'])
      assert.throws(
        () =>
          importAgentReview(
            c.store,
            run.id,
            { ...response(context), [key]: '0'.repeat(64) },
            'test',
          ),
        /exact exported/,
      );
    const invalid = response(context);
    invalid.review.observations.push({
      ...invalid.review.observations[0],
      source: [{ path: '../../secret', start: 1, end: 2 }],
    });
    assert.throws(() => importAgentReview(c.store, run.id, invalid, 'test'));
    assert.equal(c.store.list('finding').length, 0);
    assert.throws(() =>
      importAgentReview(
        c.store,
        run.id,
        { ...response(context), command: 'execute anything' },
        'test',
      ),
    );
  } finally {
    c.cleanup();
  }
});
test('source-only runs work without Docker or cloud and disclaim missing semantic coverage', async () => {
  const c = setup();
  try {
    const { snap } = prepared(c);
    const plan = createPlan(c.store, snap.id, { sourceOnly: true });
    approvePlan(c.store, plan.id, plan.hash, 'owner', 'Source-only');
    const run = enqueue(c.store, plan.id);
    await workRun(c.store, run.id);
    const data = summarize(c.store, run.id);
    assert.equal(data.run.state, 'succeeded');
    assert.deepEqual(
      data.tasks.map((t) => t.kind),
      ['intake'],
    );
    assert.match(report(c.store, run.id, 'md'), /Source-only run/);
    assert.equal(data.executions.length, 0);
    assert.equal(data.invocations.length, 0);
    assert.throws(
      () => createPlan(c.store, snap.id, { sourceOnly: true, existingTests: true }),
      /cannot execute/,
    );
  } finally {
    c.cleanup();
  }
});
