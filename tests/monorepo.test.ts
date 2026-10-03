import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, cpSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { setup, prepared } from './helpers.ts';
import { snapshot, diagnose, verifySnapshot } from '../packages/core/src/intake.ts';
import { workRun } from '../packages/core/src/engine.ts';
import { report } from '../packages/core/src/report.ts';
import { dockerHost, sandboxRoot } from '../packages/adapters/src/sandbox.ts';

test('monorepo scope pins explicitly selected pnpm Solidity dependencies and normalized configuration', () => {
  const c = setup();
  try {
    const project = 'packages/contracts';
    mkdirSync(join(c.root, project), { recursive: true });
    cpSync(join(c.root, 'src'), join(c.root, project, 'src'), { recursive: true });
    mkdirSync(join(c.root, 'node_modules/.pnpm/example/node_modules/example'), { recursive: true });
    writeFileSync(
      join(c.root, 'node_modules/.pnpm/example/node_modules/example/Library.sol'),
      'pragma solidity 0.8.28; library Library {}',
    );
    writeFileSync(
      join(c.root, 'node_modules/.pnpm/example/node_modules/example/.env'),
      'SECRET=not-for-context',
    );
    writeFileSync(
      join(c.root, 'node_modules/.pnpm/example/node_modules/example/setup.js'),
      'throw new Error("must never execute");',
    );
    symlinkSync('.pnpm/example/node_modules/example', join(c.root, 'node_modules/example'));
    writeFileSync(
      join(c.root, project, 'src/Uses.sol'),
      'pragma solidity 0.8.28; import "example/Library.sol";',
    );
    writeFileSync(
      join(c.root, project, 'remappings.txt'),
      'example/=../../node_modules/example/\n',
    );
    writeFileSync(
      join(c.root, project, 'foundry.toml'),
      `[profile.default]\nsrc="src"\ntest="test/minimal"\nlibs=["../../node_modules"]\nsolc_version="0.8.28"\nevm_version="cancun"\nbytecode_hash="none"\ncbor_metadata=false\nfs_permissions=[{access="read-write",path="./"}]\n[profile.ci]\nfuzz={runs=10000}\n[rpc_endpoints]\nmain="\${PRIVATE_RPC_URL}"\n`,
    );
    const snap = snapshot(
      c.store,
      c.root,
      [project + '/src', project + '/foundry.toml', project + '/remappings.txt'],
      [],
      'Fixture only',
      'owned',
      { projectPath: project, dependencyPaths: ['node_modules/example'] },
    );
    verifySnapshot(c.store, snap);
    const diagnosis = diagnose(c.store, snap);
    assert.equal(diagnosis.supported, true, diagnosis.issues.join('\n'));
    assert.equal(diagnosis.settings.test, 'packages/contracts/test/minimal');
    assert.deepEqual(diagnosis.settings.remappings, ['example/=node_modules/example/']);
    assert.ok(snap.files.some((f) => f.path === 'node_modules/example/Library.sol'));
    assert.ok(snap.files.every((f) => !f.path.endsWith('.env') && !f.path.endsWith('.js')));
  } finally {
    c.cleanup();
  }
});

test('explicit dependency aliases still cannot escape the repository or form cycles', () => {
  for (const target of ['/etc', '.']) {
    const c = setup();
    try {
      mkdirSync(join(c.root, 'node_modules'));
      symlinkSync(target, join(c.root, 'node_modules/escape'));
      assert.throws(
        () =>
          snapshot(c.store, c.root, ['src'], [], 'Fixture', 'owned', {
            dependencyPaths: ['node_modules/escape'],
          }),
        /escapes|cycle/,
      );
    } finally {
      c.cleanup();
    }
  }
});

test('reports refuse corrupt check evidence even when there are no findings', async () => {
  const c = setup();
  try {
    const { run } = prepared(c);
    await workRun(c.store, run.id);
    const task = c.store.list('task').find((t) => t.runId === run.id && t.kind === 'intake')!;
    const file = join(c.store.home, 'artifacts', task.evidence[0]);
    chmodSync(file, 0o600);
    writeFileSync(file, 'corrupt evidence');
    assert.throws(() => report(c.store, run.id, 'md'), /integrity|hash|Artifact/i);
  } finally {
    c.cleanup();
  }
});

test('runtime overrides reject remote endpoints and relative workspace roots', () => {
  for (const endpoint of [
    'tcp://remote:2375',
    'ssh://remote',
    'unix://relative',
    'unix:///tmp/../socket',
    'unix:///tmp/socket?remote=yes',
  ])
    assert.throws(() => dockerHost(endpoint), /local Unix socket/);
  assert.equal(dockerHost('unix:///tmp/local.sock'), 'unix:///tmp/local.sock');
  const before = process.env.GEBAL_SANDBOX_ROOT;
  try {
    process.env.GEBAL_SANDBOX_ROOT = 'relative';
    assert.throws(() => sandboxRoot(), /absolute/);
  } finally {
    if (before === undefined) delete process.env.GEBAL_SANDBOX_ROOT;
    else process.env.GEBAL_SANDBOX_ROOT = before;
  }
});

test('dependency symlinks cannot rename credential files into Solidity source', () => {
  const c = setup();
  try {
    mkdirSync(join(c.root, 'node_modules/example'), { recursive: true });
    writeFileSync(join(c.root, '.env'), 'SYNTHETIC_CANARY=never_export');
    symlinkSync('../../.env', join(c.root, 'node_modules/example/Hidden.sol'));
    assert.throws(
      () =>
        snapshot(c.store, c.root, ['src'], [], 'Fixture', 'owned', {
          dependencyPaths: ['node_modules/example'],
        }),
      /protected path/,
    );
  } finally {
    c.cleanup();
  }
});
