import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
for (const nested of [false, true])
  test(
    `opt-in real Foundry/Slither fixture execution (${nested ? 'monorepo' : 'root'})`,
    { skip: !process.env.GEBAL_INTEGRATION_IMAGE },
    async () => {
      const c = setup();
      try {
        const projectPath = nested ? 'packages/contracts' : '';
        const prefix = projectPath ? projectPath + '/' : '';
        if (nested) {
          mkdirSync(join(c.root, projectPath), { recursive: true });
          for (const name of ['src', 'test', 'foundry.toml'])
            cpSync(join(c.root, name), join(c.root, projectPath, name), { recursive: true });
          mkdirSync(join(c.root, 'deps'));
          writeFileSync(
            join(c.root, 'deps/Sentinel.sol'),
            '// SPDX-License-Identifier: MIT\npragma solidity 0.8.28; library Sentinel { function value() internal pure returns(uint) { return 1; } }\n',
          );
          writeFileSync(
            join(c.root, 'deps/Direct.sol'),
            '// SPDX-License-Identifier: MIT\npragma solidity 0.8.28; library Direct {}\n',
          );
          const configFile = join(c.root, projectPath, 'foundry.toml');
          writeFileSync(
            configFile,
            readFileSync(configFile, 'utf8').replace('libs = []', 'libs = ["../../deps"]'),
          );
          const source = join(c.root, projectPath, 'src/CreditLedger.sol');
          writeFileSync(
            source,
            readFileSync(source, 'utf8').replace(
              'pragma solidity 0.8.28;',
              'pragma solidity 0.8.28;\nimport "sentinel/Sentinel.sol";\nimport "Direct.sol";',
            ),
          );
          writeFileSync(join(c.root, projectPath, 'remappings.txt'), 'sentinel/=../../deps/\n');
        }
        const compiler = process.env.GEBAL_INTEGRATION_COMPILER ?? '0.8.28';
        for (const path of [
          'foundry.toml',
          'src/CreditLedger.sol',
          'test/CreditLedger.t.sol',
          'test/IsolationPolicy.t.sol',
        ]) {
          const file = join(c.root, prefix + path);
          writeFileSync(file, readFileSync(file, 'utf8').replaceAll('0.8.28', compiler));
        }
        if (nested) {
          for (const name of ['Sentinel.sol', 'Direct.sol']) {
            const file = join(c.root, 'deps', name);
            writeFileSync(file, readFileSync(file, 'utf8').replaceAll('0.8.28', compiler));
          }
        }
        const snap = snapshot(
          c.store,
          c.root,
          ['src', 'test', 'foundry.toml', ...(nested ? ['remappings.txt'] : [])].map(
            (p) => prefix + p,
          ),
          [],
          'Original fixture conservation, authorization and bounded retirement.',
          'owned',
          nested ? { projectPath, dependencyPaths: ['deps'] } : {},
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
        assert.equal(
          result.run.state,
          'succeeded',
          JSON.stringify(
            {
              tasks: result.tasks,
              failures: result.executions
                .filter((e) => e.state !== 'succeeded')
                .map((e) =>
                  e.evidence.map((h: string) => c.store.readArtifact(h).toString().slice(0, 5000)),
                ),
            },
            null,
            2,
          ),
        );
        assert.ok(result.tasks.every((t) => t.evidence.length > 0));
        assert.equal(result.executions.length, 3);
        for (const execution of result.executions) {
          const process = JSON.parse(c.store.readArtifact(execution.evidence[0]).toString());
          const envelope = JSON.parse(process.stdout);
          assert.equal(envelope.isolation.uid, 65534);
          assert.deepEqual(envelope.isolation.networkInterfaces, ['lo']);
          assert.equal(envelope.isolation.readonlyMounts, true);
          assert.equal(envelope.isolation.hostCanaryAbsent, true);
          assert.equal(envelope.isolation.seccomp, '2');
        }
        assert.ok(
          result.tasks.some(
            (t) => t.kind === 'foundry-test' && t.detail.includes('7 passed, 0 failed'),
          ),
        );
      } finally {
        c.cleanup();
      }
    },
  );
