import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setup, prepared } from './helpers.ts';
import { externalOutputPath } from '../packages/core/src/export.ts';

test('real CLI own-agent flow: plan, approve, source run, export, import, report', () => {
  const c = setup();
  try {
    const cli = (...args: string[]) => {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', resolve('packages/cli/src/main.ts'), '--home', c.store.home, ...args],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
      return result.stdout;
    };
    const config = join(c.base, 'scope.json');
    writeFileSync(
      config,
      JSON.stringify({
        paths: ['src', 'test', 'foundry.toml'],
        exclusions: [],
        requirements: 'Original synthetic fixture accounting requirements.',
        permission: 'owned',
        sourceOnly: true,
        existingTests: false,
      }),
    );
    const raw = cli('review', c.root, '--config', config, '--authorized');
    const plan = JSON.parse(raw.slice(0, raw.indexOf('\nInspect this plan')));
    cli(
      'approve',
      plan.id,
      '--hash',
      plan.hash,
      '--actor',
      'test-owner',
      '--reason',
      'CLI source-only smoke test',
    );
    const output = cli('run', plan.id);
    const runId = output.match(/"runId": "([^"]+)"/)![1];
    const contextPath = join(c.base, 'context.json');
    cli('context', runId, '--output', contextPath);
    const context = JSON.parse(readFileSync(contextPath, 'utf8'));
    const reviewPath = join(c.base, 'review.json');
    writeFileSync(
      reviewPath,
      JSON.stringify({
        schemaVersion: 1,
        snapshotHash: context.snapshotHash,
        contextHash: context.contextHash,
        review: { observations: [], gaps: ['CLI smoke test only; no model actually ran.'] },
      }),
    );
    cli('import-review', runId, '--input', reviewPath, '--reviewer', 'synthetic CLI test');
    const reportPath = join(c.base, 'report.md');
    cli('report', runId, '--output', reportPath);
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /Source-only run/);
    assert.match(report, /synthetic CLI test/);
    assert.match(report, /no model actually ran/);
  } finally {
    c.cleanup();
  }
});

test('exports cannot write assessed source through a path alias', () => {
  const c = setup();
  try {
    prepared(c);
    const alias = join(c.base, 'alias');
    symlinkSync(c.root, alias);
    assert.throws(
      () => externalOutputPath(c.store, join(alias, 'new-dir/context.json')),
      /outside/,
    );
    assert.throws(() => externalOutputPath(c.store, join(c.root, 'report.md')), /outside/);
    assert.ok(
      externalOutputPath(c.store, join(c.base, 'safe/report.md')).endsWith('safe/report.md'),
    );
  } finally {
    c.cleanup();
  }
});
