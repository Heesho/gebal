#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Store } from '../../core/src/store.ts';
import { snapshot, defaultPaths } from '../../core/src/intake.ts';
import {
  createPlan,
  approvePlan,
  enqueue,
  workRun,
  summarize,
  resumeRun,
  cancelRun,
  triage,
  compare,
} from '../../core/src/engine.ts';
import { report } from '../../core/src/report.ts';
import { dockerAvailable } from '../../adapters/src/sandbox.ts';
import { z } from 'zod';
import { relpath, ProviderConfig, limits } from '../../core/src/schema.ts';
import { externalOutputPath } from '../../core/src/export.ts';
import { agentContext, importAgentReview } from '../../core/src/agent.ts';
const program = new Command()
  .name('gebal')
  .description('Bring-your-own-AI Solidity review harness. Source, evidence, decisions.')
  .version('0.1.0')
  .option('--home <directory>', 'Private state directory outside assessed projects');
const store = () => new Store(program.opts().home);
const print = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const withStore = async (fn: (s: Store) => unknown) => {
  const s = store();
  try {
    await fn(s);
  } finally {
    s.close();
  }
};
const configSchema = z
  .object({
    paths: z.array(relpath).min(1),
    exclusions: z.array(relpath),
    requirements: z.string().min(1),
    permission: z.enum(['owned', 'authorized']),
    image: z.string().optional(),
    existingTests: z.boolean().default(false),
    sourceOnly: z.boolean().default(true),
    provider: ProviderConfig.optional(),
    limits: limits.partial().optional(),
  })
  .strict();
program
  .command('doctor')
  .description('Read-only runtime and isolation checks')
  .action(async () =>
    print({
      node: process.version,
      sqlite: 'built-in node:sqlite',
      docker: await dockerAvailable(),
      toolImage: process.env.GEBAL_TOOL_IMAGE || 'not configured',
      providers: {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
      },
      note: 'Host forge/slither installations are never used for assessed code. Tool versions are detected inside the approved immutable image.',
    }),
  );
program
  .command('init')
  .description('Write a scope configuration template to an explicitly selected path')
  .requiredOption('--output <file>', 'Configuration outside assessed project')
  .action((o) => {
    writeFileSync(
      resolve(o.output),
      JSON.stringify(
        {
          paths: defaultPaths,
          exclusions: [],
          requirements: 'Describe the intended behavior and explicit safety/liveness requirements.',
          permission: 'owned',
          existingTests: false,
          sourceOnly: true,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    print('Created ' + resolve(o.output));
  });
for (const name of ['plan', 'review'])
  program
    .command(name)
    .argument('<repository>')
    .requiredOption('--config <file>', 'Reviewed scope and execution configuration')
    .requiredOption('--authorized', 'Assert ownership or express review authorization')
    .description('Snapshot authorized local source and create a plan; does not execute checks')
    .action((root, o) =>
      withStore((s) => {
        if (!o.authorized) throw new Error('Explicit authorization required');
        const cfg = configSchema.parse(JSON.parse(readFileSync(resolve(o.config), 'utf8')));
        const snap = snapshot(
          s,
          resolve(root),
          cfg.paths,
          cfg.exclusions,
          cfg.requirements,
          cfg.permission,
        );
        const plan = createPlan(s, snap.id, {
          image: cfg.image ?? process.env.GEBAL_TOOL_IMAGE,
          existingTests: cfg.existingTests,
          sourceOnly: cfg.sourceOnly,
          provider: cfg.provider,
          limits: cfg.limits,
        });
        print(plan);
        print(
          `Inspect this plan, then approve its exact hash: gebal approve ${plan.id} --hash ${plan.hash} --actor YOUR_NAME --reason "Reviewed scope, execution limits and egress"`,
        );
      }),
    );
program
  .command('approve')
  .argument('<plan>')
  .requiredOption('--hash <sha256>')
  .requiredOption('--actor <name>')
  .requiredOption('--reason <text>')
  .description('Approve this exact plan, including selected existing tests and any provider egress')
  .action((id, o) => withStore((s) => print(approvePlan(s, id, o.hash, o.actor, o.reason))));
program
  .command('run')
  .argument('<plan>')
  .option('--enqueue', 'Queue for a separate durable worker')
  .description('Run an approved plan')
  .action((id, o) =>
    withStore(async (s) => {
      const run = enqueue(s, id);
      print({ runId: run.id });
      if (!o.enqueue) {
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once('SIGINT', stop);
        try {
          await workRun(s, run.id, controller.signal);
          const result = summarize(s, run.id);
          print(result);
          process.exitCode = result.run.state === 'succeeded' ? 0 : 3;
        } finally {
          process.removeListener('SIGINT', stop);
        }
      }
    }),
  );
program
  .command('status')
  .argument('[run]')
  .action((id) => withStore((s) => print(id ? summarize(s, id) : s.list('run'))));
program
  .command('resume')
  .argument('<run>')
  .option('--enqueue')
  .action((id, o) =>
    withStore(async (s) => {
      resumeRun(s, id);
      if (!o.enqueue) {
        await workRun(s, id);
        const result = summarize(s, id);
        print(result);
        process.exitCode = result.run.state === 'succeeded' ? 0 : 3;
      } else print({ queued: id });
    }),
  );
program
  .command('cancel')
  .argument('<run>')
  .action((id) =>
    withStore((s) => {
      cancelRun(s, id);
      print('Cancellation requested');
    }),
  );
program
  .command('findings')
  .argument('<run>')
  .action((id) => withStore((s) => print(summarize(s, id).findings)));
program
  .command('decide')
  .argument('<finding>')
  .requiredOption('--action <action>', 'accept, reject, needs-review')
  .requiredOption('--actor <name>')
  .requiredOption('--reason <text>')
  .action((id, o) =>
    withStore((s) =>
      print(
        triage(
          s,
          id,
          z.enum(['accept', 'reject', 'needs-review']).parse(o.action),
          o.reason,
          o.actor,
        ),
      ),
    ),
  );
program
  .command('report')
  .argument('<run>')
  .option('--format <type>', 'json, md, html, sarif', 'md')
  .option('--output <file>')
  .action((id, o) =>
    withStore((s) => {
      const output = report(s, id, z.enum(['json', 'md', 'html', 'sarif']).parse(o.format));
      if (o.output) {
        const path = externalOutputPath(s, o.output);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, output, { mode: 0o600 });
        print(path);
      } else print(output);
    }),
  );
program
  .command('evidence')
  .argument('<sha256>')
  .option('--output <file>')
  .description('Verify and inspect a content-addressed artifact')
  .action((h, o) =>
    withStore((s) => {
      const bytes = s.readArtifact(h);
      if (o.output)
        writeFileSync(externalOutputPath(s, o.output), bytes, { flag: 'wx', mode: 0o600 });
      else print(bytes.toString().replace(/[\x00-\x08\x1b\x7f]/g, ''));
    }),
  );
program
  .command('compare')
  .argument('<left>')
  .argument('<right>')
  .action((a, b) => withStore((s) => print(compare(s, a, b))));
program
  .command('context')
  .argument('<run>')
  .requiredOption('--output <file>', 'Local context file for your own AI assistant')
  .description('Export cold, pinned source context; no cloud request or peer findings')
  .action((id, o) =>
    withStore((s) => {
      const context = agentContext(s, id);
      const path = externalOutputPath(s, o.output);
      writeFileSync(path, JSON.stringify(context, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      print({
        path,
        snapshotHash: context.snapshotHash,
        contextHash: context.contextHash,
        egress:
          'None performed by Gebal. Review provider permissions before sharing this file with your own AI.',
      });
    }),
  );
program
  .command('import-review')
  .argument('<run>')
  .requiredOption('--input <file>', 'Inert JSON matching agents/response.schema.json')
  .requiredOption('--reviewer <label>', 'Operator-reported AI tool/model identifier')
  .description(
    'Import validated unreviewed observations from your own assistant; never executes content',
  )
  .action((id, o) =>
    withStore((s) => {
      const path = resolve(o.input);
      if (statSync(path).size > 2 * 1024 * 1024) throw new Error('Review exceeds 2 MiB');
      print(importAgentReview(s, id, JSON.parse(readFileSync(path, 'utf8')), o.reviewer));
    }),
  );
program
  .command('evaluation')
  .description('Run isolated source-intake and parser controls; not a security benchmark')
  .action(async () => {
    const { evaluate } = await import('../../../scripts/evaluate.ts');
    print(await evaluate());
  });
try {
  await program.parseAsync();
} catch (e) {
  console.error('Gebal: ' + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 2;
}
