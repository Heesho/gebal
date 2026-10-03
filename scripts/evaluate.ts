import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, hash, stable } from '../packages/core/src/store.ts';
import { snapshot, diagnose } from '../packages/core/src/intake.ts';
import { parseTool } from '../packages/adapters/src/tools.ts';
export async function evaluate() {
  const home = mkdtempSync(join(tmpdir(), 'gebal-eval-'));
  const store = new Store(home);
  const started = Date.now();
  try {
    const snap = snapshot(
      store,
      resolve('fixtures/vault'),
      ['src', 'test', 'foundry.toml'],
      [],
      'Infrastructure controls; no benchmark labels or later fixes in provider context.',
      'owned',
    );
    const envelope = (data: unknown) =>
      JSON.stringify({
        version: 'forge Version: 1.3.1',
        compilerVersion: '0.8.28',
        exitCode: 0,
        stdout: JSON.stringify(data),
        stderr: '',
      });
    const controls = [
      { id: 'foundry-configuration', pass: diagnose(store, snap).supported },
      {
        id: 'empty-test-campaign-not-success',
        pass: parseTool('foundry-test', envelope({}), snap).state === 'unknown',
      },
      {
        id: 'zero-assertions-not-proof',
        pass:
          parseTool('foundry-build', envelope({ errors: [], sources: {} }), snap).gaps.length > 0,
      },
    ];
    let rejected = false;
    try {
      parseTool('slither', envelope({}), snap);
    } catch {
      rejected = true;
    }
    controls.push({ id: 'unknown-output-rejected', pass: rejected });
    return {
      protocol: 'gebal-infrastructure-controls-v1',
      fixtureHash: snap.hash,
      protocolHash: hash(stable(controls.map((c) => c.id))),
      labelStatus: 'Original implementation controls, not owner-adjudicated vulnerability labels',
      controls,
      elapsedMs: Date.now() - started,
      providerCalls: 0,
      toolExecutions: 0,
      securityPrecision: null,
      knownFindingRecall: null,
      costUsd: null,
      limitations: [
        'This validates plumbing, not vulnerability detection quality.',
        'Historical/held-out cases, matched-budget model comparisons, and stochastic repetition are not implemented.',
        'No leaderboard or security superiority claim is supported.',
      ],
    };
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await evaluate();
  console.log(JSON.stringify(result, null, 2));
  if (result.controls.some((c) => !c.pass)) process.exitCode = 1;
}
