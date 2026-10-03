import { z } from 'zod';
export const VERSION = 1 as const;
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const relpath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !p.split('/').some((x) => !x || x === '.' || x === '..') &&
      !/[\x00-\x1f\x7f]/.test(p),
    'Expected a clean relative path',
  );
export const outcome = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'unknown',
  'timeout',
  'unsupported',
  'blocked',
  'not-run',
  'cancelled',
  'interrupted',
]);
const base = {
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  createdAt: z.string().datetime(),
};
export const sourceRef = z
  .object({ path: relpath, start: z.number().int().positive(), end: z.number().int().positive() })
  .strict()
  .refine((r) => r.end >= r.start);
export const Project = z.object({
  ...base,
  name: z.string(),
  root: z.string(),
  origin: z.enum(['local-project', 'bundled-fixture']).default('local-project'),
});
export const Scope = z.object({
  ...base,
  projectId: z.string(),
  authorized: z.literal(true),
  paths: z.array(relpath).min(1),
  projectPath: relpath.optional(),
  dependencyPaths: z.array(relpath).optional(),
  exclusions: z.array(relpath),
  requirements: z.string().min(1).max(20000),
  permission: z.enum(['owned', 'authorized']),
});
export const FileRecord = z.object({
  path: relpath,
  hash: digest,
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().positive(),
});
export const Snapshot = z.object({
  ...base,
  scopeId: z.string(),
  hash: digest,
  files: z.array(FileRecord),
  excluded: z.array(z.string()),
  dependencyLocks: z.record(z.string(), digest),
});
export const limits = z.object({
  seconds: z.number().int().min(1).max(3600),
  memoryMb: z.number().int().min(128).max(8192),
  cpus: z.number().min(0.25).max(4),
  pids: z.number().int().min(16).max(256),
  diskMb: z.number().int().min(16).max(1024),
  maxOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(8 * 1024 * 1024),
  tokens: z.number().int().min(0).max(500000),
  maxTasks: z.number().int().min(1).max(20),
});
export const defaultLimits = {
  seconds: 120,
  memoryMb: 1024,
  cpus: 1,
  pids: 64,
  diskMb: 128,
  maxOutputBytes: 2 * 1024 * 1024,
  tokens: 24000,
  maxTasks: 4,
};
export const Diagnosis = z.object({
  kind: z.enum(['foundry', 'hardhat', 'unknown']),
  supported: z.boolean(),
  compiler: z.string().nullable(),
  evm: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
  issues: z.array(z.string()),
  notes: z.array(z.string()),
});
export const ProviderConfig = z.object({
  provider: z.enum(['openai', 'anthropic']),
  model: z.string().min(1).max(200),
  maxOutputTokens: z.number().int().min(256).max(16000),
});
export const Plan = z.object({
  ...base,
  snapshotId: z.string(),
  snapshotHash: digest,
  scopeId: z.string(),
  diagnosis: Diagnosis,
  tasks: z.array(z.enum(['intake', 'foundry-build', 'foundry-test', 'slither', 'model-review'])),
  limits,
  image: z.string().nullable(),
  provider: ProviderConfig.nullable(),
  egress: z.array(z.string()),
  methodology: z.literal('native-review-v1'),
  adapterVersion: z.enum(['0.1.0', '0.2.0']),
  hash: digest,
});
export const Run = z.object({
  ...base,
  planId: z.string(),
  snapshotId: z.string(),
  state: outcome,
  finishedAt: z.string().nullable(),
  cancelRequested: z.boolean(),
  costUsd: z.number().nullable(),
  reservedTokens: z.number().int().nonnegative(),
  usedTokens: z.number().int().nonnegative(),
});
export const Task = z.object({
  ...base,
  runId: z.string(),
  kind: z.string(),
  state: outcome,
  dependencies: z.array(z.string()),
  attempts: z.number().int(),
  leaseUntil: z.number().nullable(),
  leaseOwner: z.string().nullable(),
  detail: z.string(),
  evidence: z.array(digest),
});
export const ToolExecution = z.object({
  ...base,
  runId: z.string(),
  taskId: z.string(),
  tool: z.string(),
  version: z.string().nullable(),
  image: z.string(),
  argv: z.array(z.string()),
  state: outcome,
  exitCode: z.number().nullable(),
  evidence: z.array(digest),
  seconds: z.number(),
});
export const ModelInvocation = z.object({
  ...base,
  runId: z.string(),
  provider: z.string(),
  model: z.string(),
  contextHash: digest,
  settings: z.record(z.string(), z.unknown()),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  state: outcome,
  evidence: z.array(digest),
});
export const Property = z.object({
  ...base,
  runId: z.string(),
  meaning: z.string(),
  kind: z.enum(['safety', 'liveness']),
  assumptions: z.array(z.string()),
  ownerApproved: z.boolean(),
  source: z.array(sourceRef),
  checks: z.array(z.string()),
  state: outcome,
});
export const Observation = z.object({
  ...base,
  runId: z.string(),
  producer: z.string(),
  text: z.string(),
  source: z.array(sourceRef),
  evidence: z.array(digest),
});
export const Finding = z.object({
  ...base,
  runId: z.string(),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(20000),
  severity: z.enum(['high', 'medium', 'low', 'informational']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceType: z.enum(['static', 'model', 'test']),
  source: z.array(sourceRef).min(1),
  evidence: z.array(digest).min(1),
  observationIds: z.array(z.string()).min(1),
  fingerprint: digest,
});
export const EvidenceArtifact = z.object({
  ...base,
  hash: digest,
  bytes: z.number().int(),
  mediaType: z.string(),
  origin: z.string(),
});
export const CoverageRecord = z.object({
  ...base,
  runId: z.string(),
  taskId: z.string(),
  state: outcome,
  claim: z.string(),
  gaps: z.array(z.string()),
  evidence: z.array(digest),
});
export const HumanDecision = z.object({
  ...base,
  subjectId: z.string(),
  action: z.enum(['approve-plan', 'accept', 'reject', 'needs-review', 'merge', 'unmerge']),
  rationale: z.string().min(1).max(5000),
  actor: z.string().min(1),
  boundHash: digest.nullable(),
});
export type PlanT = z.infer<typeof Plan>;
export type SnapshotT = z.infer<typeof Snapshot>;
export type TaskT = z.infer<typeof Task>;
export type FindingT = z.infer<typeof Finding>;
export type RunT = z.infer<typeof Run>;
export type Limits = z.infer<typeof limits>;
export type Ref = z.infer<typeof sourceRef>;
export const entities = {
  project: Project,
  scope: Scope,
  snapshot: Snapshot,
  plan: Plan,
  run: Run,
  task: Task,
  execution: ToolExecution,
  invocation: ModelInvocation,
  property: Property,
  observation: Observation,
  finding: Finding,
  artifact: EvidenceArtifact,
  coverage: CoverageRecord,
  decision: HumanDecision,
};
export type EntityKind = keyof typeof entities;
