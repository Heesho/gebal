import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, symlinkSync, chmodSync, mkdirSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { setup, prepared } from './helpers.ts';
import { snapshot, diagnose, validateRefs } from '../packages/core/src/intake.ts';
import { relpath, Plan, Scope } from '../packages/core/src/schema.ts';
import {
  createPlan,
  approvePlan,
  enqueue,
  workRun,
  summarize,
  recordCandidates,
  triage,
  compare,
  resumeRun,
  cancelRun,
} from '../packages/core/src/engine.ts';
import { report } from '../packages/core/src/report.ts';
import { Store } from '../packages/core/src/store.ts';
test('schema rejects unauthorized scope and traversal', () => {
  for (const p of ['../secret', '/etc/passwd', 'src/../x', 'src//x', 'src\\x', 'src/\u0000x'])
    assert.equal(relpath.safeParse(p).success, false);
  assert.equal(Scope.safeParse({ authorized: false }).success, false);
});
test('snapshot captures selected uncommitted bytes and never modifies the repository', () => {
  const c = setup();
  try {
    const before = readFileSync(join(c.root, 'src/CreditLedger.sol'));
    const a = prepared(c).snap;
    writeFileSync(
      join(c.root, 'src/CreditLedger.sol'),
      Buffer.concat([before, Buffer.from('\n// local change\n')]),
    );
    const b = prepared(c).snap;
    assert.notEqual(a.hash, b.hash);
    assert.equal(
      c.store
        .readArtifact(a.files.find((f) => f.path.endsWith('CreditLedger.sol'))!.hash)
        .equals(before),
      true,
    );
    assert.equal(
      readFileSync(join(c.root, 'src/CreditLedger.sol'), 'utf8').endsWith('// local change\n'),
      true,
    );
  } finally {
    c.cleanup();
  }
});
test('secret files excluded, symlink/hardlink escapes rejected', () => {
  const c = setup();
  try {
    writeFileSync(join(c.root, 'src/.env'), 'PRIVATE=secret');
    let snap = prepared(c).snap;
    assert.equal(
      snap.files.some((f) => f.path.endsWith('.env')),
      false,
    );
    assert.ok(snap.excluded.includes('src/.env'));
    symlinkSync('/etc/passwd', join(c.root, 'src/evil.sol'));
    assert.throws(() => prepared(c), /Symlinks/);
  } finally {
    c.cleanup();
  }
  const d = setup();
  try {
    linkSync(join(d.root, 'src/CreditLedger.sol'), join(d.root, 'src/alias.sol'));
    assert.throws(() => prepared(d), /Unsupported file/);
  } finally {
    d.cleanup();
  }
});
test('state inside assessed project and oversized files fail closed', () => {
  const c = setup();
  try {
    const nested = new Store(join(c.root, 'state'));
    try {
      assert.throws(() => snapshot(nested, c.root, ['src'], [], 'requirement', 'owned'), /outside/);
    } finally {
      nested.close();
    }
    writeFileSync(join(c.root, 'src/huge.sol'), 'x'.repeat(2 * 1024 * 1024 + 1));
    assert.throws(() => prepared(c), /byte limit/);
  } finally {
    c.cleanup();
  }
});
test('FFI, unknown settings and missing dependencies remain unsupported', () => {
  for (const suffix of [
    '\nffi = true\n',
    '\nunknown_setting = true\n',
    '\nsolc = "/untrusted/compiler"\n',
  ]) {
    const c = setup();
    try {
      writeFileSync(
        join(c.root, 'foundry.toml'),
        readFileSync(join(c.root, 'foundry.toml'), 'utf8') + suffix,
      );
      assert.equal(prepared(c).plan.diagnosis.supported, false);
    } finally {
      c.cleanup();
    }
  }
  const c = setup();
  try {
    writeFileSync(
      join(c.root, 'src/Missing.sol'),
      'pragma solidity 0.8.28; import "absent/X.sol";',
    );
    assert.ok(prepared(c).plan.diagnosis.issues.some((i) => i.includes('Dependencies missing')));
  } finally {
    c.cleanup();
  }
});
test('exact plan hash approval and task budgets enforced', () => {
  const c = setup();
  try {
    const { snap } = prepared(c);
    const p = createPlan(c.store, snap.id);
    assert.throws(() => enqueue(c.store, p.id), /approval/);
    assert.throws(() => approvePlan(c.store, p.id, '0'.repeat(64), 'me', 'review'), /hash/);
    approvePlan(c.store, p.id, p.hash, 'me', 'review');
    const changed = { ...p, limits: { ...p.limits, seconds: 900 } };
    c.store.put('plan', changed, true);
    assert.throws(() => enqueue(c.store, p.id), /integrity/);
    const small = createPlan(c.store, snap.id, { limits: { maxTasks: 1 } });
    approvePlan(c.store, small.id, small.hash, 'me', 'review');
    assert.throws(() => enqueue(c.store, small.id), /Task budget/);
  } finally {
    c.cleanup();
  }
});
test('keyless real engine persists partial run and honest reports', async () => {
  const c = setup();
  try {
    const { run } = prepared(c, true);
    await workRun(c.store, run.id);
    const data = summarize(c.store, run.id);
    assert.equal(data.run.state, 'blocked');
    assert.equal(data.tasks[0].state, 'succeeded');
    assert.equal(data.tasks.find((t) => t.kind === 'foundry-build')?.state, 'blocked');
    assert.equal(data.tasks.find((t) => t.kind === 'foundry-test')?.state, 'not-run');
    assert.equal(data.findings.length, 0);
    assert.match(report(c.store, run.id, 'md'), /No findings recorded/);
    assert.match(report(c.store, run.id, 'md'), /blocked/);
    assert.equal(
      JSON.parse(report(c.store, run.id, 'sarif')).runs[0].invocations[0].executionSuccessful,
      false,
    );
    const reopen = new Store(c.store.home);
    assert.equal(reopen.get('run', run.id).state, 'blocked');
    reopen.close();
  } finally {
    c.cleanup();
  }
});
test('evidence corruption is detected on read and report', () => {
  const c = setup();
  try {
    const { snap, run } = prepared(c);
    const h = c.store.artifact('evidence', 'test');
    recordCandidates(
      c.store,
      run.id,
      snap,
      [
        {
          title: 'Example',
          description: 'Observation',
          severity: 'low',
          confidence: 'low',
          source: [{ path: 'src/CreditLedger.sol', start: 1, end: 2 }],
          rule: 'example',
        },
      ],
      [h],
      'slither',
    );
    chmodSync(join(c.store.home, 'artifacts', h), 0o600);
    writeFileSync(join(c.store.home, 'artifacts', h), 'changed');
    assert.throws(() => c.store.readArtifact(h), /integrity/);
    assert.throws(() => report(c.store, run.id, 'json'), /integrity/);
  } finally {
    c.cleanup();
  }
});
test('source spans are checked, decisions append and exact duplicate evidence is retained', () => {
  const c = setup();
  try {
    const { snap, run } = prepared(c);
    assert.throws(
      () => validateRefs(snap, [{ path: 'src/CreditLedger.sol', start: 1, end: 9999 }]),
      /Unresolvable/,
    );
    const h = c.store.artifact('observation', 'fixture');
    const item = {
      title: '<script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)>',
      severity: 'low' as const,
      confidence: 'low' as const,
      source: [{ path: 'src/CreditLedger.sol', start: 1, end: 2 }],
      rule: 'sample',
    };
    recordCandidates(c.store, run.id, snap, [item, item], [h], 'slither');
    const fs = c.store.list('finding');
    assert.equal(fs.length, 2);
    assert.equal(fs[0].fingerprint, fs[1].fingerprint);
    triage(c.store, fs[0].id, 'accept', 'First review', 'me');
    triage(c.store, fs[0].id, 'reject', 'Corrected after inspecting assumptions', 'me');
    assert.equal(c.store.list('decision').filter((d) => d.subjectId === fs[0].id).length, 2);
    const html = report(c.store, run.id, 'html');
    assert.ok(!html.includes('<script>alert'));
    assert.ok(!html.includes('<img src=x'));
  } finally {
    c.cleanup();
  }
});
test('token reservations include inflight capacity and survive restart', () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    c.store.reserve(run.id, 80, 100);
    assert.throws(() => c.store.reserve(run.id, 30, 100), /budget/);
    const other = new Store(c.store.home);
    assert.throws(() => other.reserve(run.id, 30, 100), /budget/);
    other.close();
    c.store.settle(run.id, 80, 40);
    c.store.reserve(run.id, 60, 100);
    assert.throws(() => c.store.reserve(run.id, -1, 100), /Invalid/);
  } finally {
    c.cleanup();
  }
});
test('transactional leases prevent duplicate claims and recover expired local tasks', () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    const t = c.store.claim(run.id, 'one', 10000)!;
    const second = new Store(c.store.home);
    assert.equal(second.claim(run.id, 'two', 10000), undefined);
    assert.throws(() => resumeRun(second, run.id), /live worker/);
    second.close();
    c.store.put('task', { ...t, leaseUntil: Date.now() - 1 }, true);
    resumeRun(c.store, run.id);
    assert.equal(c.store.get('task', t.id).state, 'pending');
    assert.throws(() => c.store.finish(t, { state: 'succeeded' }), /Lease lost/);
  } finally {
    c.cleanup();
  }
});
test('cancellation is durable and explicit resume preserves history', async () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    cancelRun(c.store, run.id);
    await workRun(c.store, run.id);
    assert.equal(c.store.get('run', run.id).state, 'cancelled');
    resumeRun(c.store, run.id);
    await workRun(c.store, run.id);
    assert.equal(c.store.get('run', run.id).state, 'blocked');
    assert.ok(c.store.events(run.id).length > 3);
  } finally {
    c.cleanup();
  }
});
test('comparison invalidates prior findings and records scope changes', () => {
  const c = setup();
  try {
    const a = prepared(c);
    writeFileSync(
      join(c.root, 'src/CreditLedger.sol'),
      readFileSync(join(c.root, 'src/CreditLedger.sol'), 'utf8') + '\n// change',
    );
    const b = prepared(c);
    const diff = compare(c.store, a.run.id, b.run.id);
    assert.deepEqual(diff.changed, ['src/CreditLedger.sol']);
    assert.equal(diff.reusedEvidence, false);
  } finally {
    c.cleanup();
  }
});

test('manifest tampering fails even when a stale stored snapshot hash is retained', async () => {
  const c = setup();
  try {
    const { snap, run } = prepared(c);
    c.store.put(
      'snapshot',
      { ...snap, files: snap.files.map((f, i) => (i ? f : { ...f, lines: f.lines + 1 })) },
      true,
    );
    await workRun(c.store, run.id);
    assert.equal(c.store.get('run', run.id).state, 'failed');
    assert.match(
      summarize(c.store, run.id).tasks.find((t) => t.kind === 'intake')!.detail,
      /integrity/,
    );
  } finally {
    c.cleanup();
  }
});

test('explicitly selected nested symlink paths are rejected', () => {
  const c = setup();
  try {
    symlinkSync(join(c.root, 'src'), join(c.root, 'alias'));
    assert.throws(
      () => snapshot(c.store, c.root, ['alias/CreditLedger.sol'], [], 'requirements', 'owned'),
      /Symlinks/,
    );
  } finally {
    c.cleanup();
  }
});

test('expired model attempts remain unknown on resume and do not silently retry', () => {
  const c = setup();
  try {
    const { snap } = prepared(c);
    const plan = createPlan(c.store, snap.id, {
      provider: { provider: 'openai', model: 'explicit-test-model', maxOutputTokens: 512 },
    });
    approvePlan(
      c.store,
      plan.id,
      plan.hash,
      'owner',
      'Test egress decision record only; no remote call',
    );
    const run = enqueue(c.store, plan.id);
    const task = c.store.list('task').find((t) => t.runId === run.id && t.kind === 'model-review');
    c.store.put(
      'task',
      { ...task, state: 'running', attempts: 1, leaseOwner: 'crashed', leaseUntil: Date.now() - 1 },
      true,
    );
    resumeRun(c.store, run.id);
    assert.equal(c.store.get('task', task.id).state, 'unknown');
    assert.match(c.store.get('task', task.id).detail, /billable/);
  } finally {
    c.cleanup();
  }
});

test('one resource envelope cannot be multiplied by concurrent workers', () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    const intake = c.store.claim(run.id, 'one', 10000)!;
    c.store.finish(intake, { state: 'succeeded' });
    assert.ok(c.store.claim(run.id, 'one', 10000));
    assert.equal(c.store.claim(run.id, 'two', 10000), undefined);
  } finally {
    c.cleanup();
  }
});
