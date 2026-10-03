import { z } from 'zod';
import { validateRefs } from '../../core/src/intake.ts';
import { type SnapshotT, type Ref } from '../../core/src/schema.ts';
export type Candidate = {
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low' | 'informational';
  confidence: 'high' | 'medium' | 'low';
  source: Ref[];
  rule: string;
};
const envelope = z.object({
  version: z.string().min(1),
  compilerVersion: z.string().min(1),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});
const Slither = z.object({
  success: z.boolean(),
  error: z.unknown(),
  results: z.object({
    detectors: z.array(
      z.object({
        check: z.string().min(1),
        impact: z.enum(['High', 'Medium', 'Low', 'Informational', 'Optimization']),
        confidence: z.enum(['High', 'Medium', 'Low']),
        description: z.string().min(1),
        elements: z
          .array(
            z.object({
              source_mapping: z.object({
                filename_relative: z.string().optional(),
                filename_absolute: z.string().optional(),
                lines: z.array(z.number().int().positive()).min(1),
              }),
            }),
          )
          .min(1),
      }),
    ),
  }),
});
export function parseTool(kind: string, raw: string, snap: SnapshotT) {
  const env = envelope.parse(JSON.parse(raw));
  const data = JSON.parse(env.stdout);
  const findings: Candidate[] = [];
  let claim = '',
    state: 'succeeded' | 'failed' | 'unknown' = 'succeeded';
  const gaps: string[] = [];
  if (kind === 'slither') {
    if (!/\b0\.11\./.test(env.version))
      throw new Error('Unsupported Slither output version: ' + env.version);
    const output = Slither.parse(data);
    if (!output.success) throw new Error('Slither analysis unsuccessful');
    if (env.exitCode !== 0 && env.exitCode !== 255) throw new Error('Unexpected Slither exit code');
    for (const item of output.results.detectors) {
      const source = item.elements.map((e) => ({
        path: (
          e.source_mapping.filename_relative ??
          e.source_mapping.filename_absolute ??
          ''
        ).replace(/^\/source\//, ''),
        start: Math.min(...e.source_mapping.lines),
        end: Math.max(...e.source_mapping.lines),
      }));
      validateRefs(snap, source);
      findings.push({
        title: item.check,
        description: item.description,
        severity: (
          {
            High: 'high',
            Medium: 'medium',
            Low: 'low',
            Informational: 'informational',
            Optimization: 'informational',
          } as const
        )[item.impact],
        confidence: item.confidence.toLowerCase() as Candidate['confidence'],
        source,
        rule: item.check,
      });
    }
    claim = `Slither completed; ${findings.length} analyzer observations require human review.`;
    gaps.push('Static detectors do not establish property completeness or correctness.');
  } else if (kind === 'foundry-test') {
    if (!/forge Version: 1\./.test(env.version))
      throw new Error('Unsupported Foundry version: ' + env.version);
    const suites = z
      .record(
        z.string(),
        z.object({
          test_results: z.record(
            z.string(),
            z.object({
              status: z.enum(['Success', 'Failure', 'Skipped']),
              reason: z.string().nullable().optional(),
            }),
          ),
        }),
      )
      .parse(data);
    const results = Object.values(suites).flatMap((s) => Object.values(s.test_results));
    const failed = results.filter((t) => t.status === 'Failure').length;
    const passed = results.filter((t) => t.status === 'Success').length;
    state = failed || env.exitCode !== 0 ? 'failed' : passed === 0 ? 'unknown' : 'succeeded';
    claim = `Existing tests: ${passed} passed, ${failed} failed, ${results.length - passed - failed} skipped.`;
    gaps.push(
      'Test assertions are not automatically security findings.',
      'Reachability, rejection/revert rates, property sensitivity and liveness coverage are not established.',
    );
  } else if (kind === 'foundry-build') {
    if (!/forge Version: 1\./.test(env.version))
      throw new Error('Unsupported Foundry version: ' + env.version);
    const output = z
      .object({
        errors: z.array(
          z.object({
            severity: z.string(),
            message: z.string().optional(),
            formattedMessage: z.string().optional(),
          }),
        ),
        sources: z.record(z.string(), z.unknown()).optional(),
        contracts: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(data);
    state =
      env.exitCode !== 0 || output.errors.some((e) => e.severity === 'error')
        ? 'failed'
        : Object.keys(output.sources ?? {}).length === 0
          ? 'unknown'
          : 'succeeded';
    claim =
      state === 'succeeded'
        ? 'Compiler completed for the pinned source and settings.'
        : state === 'unknown'
          ? 'Compiler output contains no source coverage.'
          : 'Compilation failed.';
    gaps.push('Compilation is not a security assessment.');
  } else throw new Error('Unsupported adapter');
  return { state, claim, gaps, findings, version: env.version, exitCode: env.exitCode };
}
