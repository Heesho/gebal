import {
  readdirSync,
  lstatSync,
  realpathSync,
  openSync,
  readFileSync,
  closeSync,
  constants,
  fstatSync,
} from 'node:fs';
import { join, relative, basename } from 'node:path';
import { parse } from 'smol-toml';
import { Store, hash, identity, stable } from './store.ts';
import { Scope, Snapshot, Diagnosis, relpath, type SnapshotT, type Ref } from './schema.ts';
export const defaultPaths = [
  'src',
  'test',
  'lib',
  'foundry.toml',
  'remappings.txt',
  'foundry.lock',
];
const secret = (p: string) =>
  p
    .split('/')
    .some(
      (x) =>
        /^(\.git|\.env(?:\..*)?|\.ssh|\.aws|node_modules|out|cache|broadcast|\.gebal)$/.test(x) ||
        /\.(pem|key|p12|keystore)$/i.test(x),
    );
export function snapshot(
  store: Store,
  rootInput: string,
  paths: string[],
  exclusions: string[],
  requirements: string,
  permission: 'owned' | 'authorized',
) {
  const root = realpathSync(rootInput);
  if (!lstatSync(root).isDirectory()) throw new Error('Repository must be a directory');
  if (store.home === root || store.home.startsWith(root + '/'))
    throw new Error('State directory must be outside the assessed repository');
  paths.forEach((p) => relpath.parse(p));
  exclusions.forEach((p) => relpath.parse(p));
  const project = store.put('project', { ...identity(), name: basename(root), root });
  const scope = Scope.parse({
    ...identity(),
    projectId: project.id,
    authorized: true,
    paths,
    exclusions,
    requirements,
    permission,
  });
  const files: SnapshotT['files'] = [],
    excluded: string[] = [];
  let size = 0;
  let visited = 0;
  const walk = (p: string) => {
    if (++visited > 12000) throw new Error('Snapshot entry limit exceeded');
    if (secret(p) || exclusions.some((x) => p === x || p.startsWith(x + '/'))) {
      excluded.push(p);
      return;
    }
    const absolute = join(root, p);
    let stat;
    const segments = p.split('/');
    for (let i = 1; i < segments.length; i++) {
      const parent = join(root, ...segments.slice(0, i));
      try {
        if (lstatSync(parent).isSymbolicLink()) throw new Error('Symlinks are not allowed: ' + p);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    try {
      stat = lstatSync(absolute);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        excluded.push(`${p} (absent)`);
        return;
      }
      throw e;
    }
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${p}`);
    const resolved = realpathSync(absolute);
    if (!resolved.startsWith(root + '/')) throw new Error('Path escapes repository');
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) walk(p + '/' + name);
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Unsupported file: ${p}`);
    if (stat.size > 2 * 1024 * 1024 || (size += stat.size) > 16 * 1024 * 1024)
      throw new Error('Snapshot exceeds file/total byte limit');
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    let content: Buffer;
    try {
      const before = fstatSync(fd);
      if (before.ino !== stat.ino || before.size !== stat.size)
        throw new Error('File changed during snapshot');
      content = readFileSync(fd);
      const after = fstatSync(fd);
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
        throw new Error('File changed during snapshot');
    } finally {
      closeSync(fd);
    }
    if (content.includes(0)) throw new Error(`Binary file unsupported: ${p}`);
    if (files.some((f) => f.path === p)) return;
    const h = store.artifact(content, 'source:' + p);
    files.push({
      path: p,
      hash: h,
      bytes: content.length,
      lines: content.toString().split('\n').length,
    });
  };
  paths.forEach(walk);
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some((f) => f.path.endsWith('.sol')))
    throw new Error('No authorized Solidity sources found');
  const dependencyLocks = Object.fromEntries(
    files.filter((f) => /(lock|lock\.json)$/.test(f.path)).map((f) => [f.path, f.hash]),
  );
  const snap = Snapshot.parse({
    ...identity(),
    scopeId: scope.id,
    files,
    excluded,
    dependencyLocks,
    hash: hash(stable({ files, paths, exclusions, requirements, dependencyLocks })),
  });
  store.put('scope', scope);
  store.put('snapshot', snap);
  return snap;
}
export function diagnose(store: Store, snap: SnapshotT) {
  const issues: string[] = [],
    notes: string[] = [];
  let compiler: string | null = null,
    evm: string | null = null;
  let settings: Record<string, unknown> = {};
  const config = snap.files.find((f) => f.path === 'foundry.toml');
  if (!config)
    return Diagnosis.parse({
      kind: snap.files.some((f) => f.path.includes('hardhat.config')) ? 'hardhat' : 'unknown',
      supported: false,
      compiler,
      evm,
      settings,
      issues: ['Only a Foundry project with an explicit foundry.toml is supported.'],
      notes,
    });
  try {
    const parsed = parse(store.readArtifact(config.hash).toString()) as any;
    if (Object.keys(parsed).some((k) => k !== 'profile'))
      issues.push(
        'Unsupported top-level Foundry configuration; requires explicit compatibility review.',
      );
    if (!parsed.profile?.default || Object.keys(parsed.profile).some((k) => k !== 'default'))
      issues.push('Only the explicit default Foundry profile is supported.');
    settings = parsed.profile?.default ?? {};
    const allowed = [
      'src',
      'test',
      'libs',
      'solc_version',
      'evm_version',
      'optimizer',
      'optimizer_runs',
      'via_ir',
      'remappings',
    ];
    for (const k of Object.keys(settings))
      if (!allowed.includes(k)) issues.push(`Unsupported configuration key: ${k}`);
    compiler = typeof settings.solc_version === 'string' ? settings.solc_version : null;
    if (!compiler || !/^0\.8\.\d+$/.test(compiler))
      issues.push('An exact Solidity 0.8.x compiler version is required.');
    evm = typeof settings.evm_version === 'string' ? settings.evm_version : null;
    if (!evm || !['paris', 'shanghai', 'cancun', 'prague'].includes(evm))
      issues.push('An explicit supported EVM target is required.');
    if (settings.src !== undefined && settings.src !== 'src')
      issues.push('Custom source roots are unsupported.');
    if (settings.test !== undefined && settings.test !== 'test')
      issues.push('Custom test roots are unsupported.');
    if (
      settings.libs !== undefined &&
      JSON.stringify(settings.libs) !== JSON.stringify(['lib']) &&
      JSON.stringify(settings.libs) !== '[]'
    )
      issues.push('Only local lib dependencies are supported.');
    if (settings.optimizer !== undefined && typeof settings.optimizer !== 'boolean')
      issues.push('Invalid optimizer setting');
    if (
      settings.optimizer_runs !== undefined &&
      (!Number.isSafeInteger(settings.optimizer_runs) || Number(settings.optimizer_runs) < 0)
    )
      issues.push('Invalid optimizer_runs setting');
    if (settings.via_ir !== undefined && typeof settings.via_ir !== 'boolean')
      issues.push('Invalid via_ir setting');
    if (
      settings.remappings !== undefined &&
      (!Array.isArray(settings.remappings) ||
        settings.remappings.some(
          (x) =>
            typeof x !== 'string' ||
            !/^[@a-zA-Z0-9_./-]+=[a-zA-Z0-9_/-]+\/$/.test(x) ||
            x.includes('..'),
        ))
    )
      issues.push('Unsupported remappings');
    if (snap.files.some((f) => f.path === 'remappings.txt'))
      issues.push(
        'remappings.txt is recorded but execution requires moving reviewed remappings into foundry.toml.',
      );
    const missing: string[] = [];
    for (const file of snap.files.filter((f) => f.path.endsWith('.sol'))) {
      const source = store.readArtifact(file.hash).toString();
      for (const m of source.matchAll(/import\s+(?:[^;]*?from\s+)?["']([^"']+)["']/g)) {
        const imp = m[1];
        let target = imp;
        if (imp.startsWith('.')) target = join(file.path.slice(0, file.path.lastIndexOf('/')), imp);
        else
          for (const remap of (Array.isArray(settings.remappings)
            ? settings.remappings
            : []) as string[]) {
            const [prefix, replacement] = remap.split('=');
            if (imp.startsWith(prefix)) target = replacement + imp.slice(prefix.length);
          }
        if (!snap.files.some((f) => f.path === target)) missing.push(`${file.path}: ${imp}`);
      }
    }
    if (missing.length)
      issues.push(
        'Dependencies missing from authorized snapshot: ' + missing.slice(0, 10).join(', '),
      );
  } catch (e) {
    issues.push('Invalid TOML: ' + String(e));
  }
  notes.push(
    'Source-only intake does not establish compiler, test, property or security coverage.',
    'FFI, filesystem cheatcode access, RPC and dependency downloads are denied.',
    'Fuzz seed and campaign limits are imposed by the approved execution plan.',
  );
  return Diagnosis.parse({
    kind: 'foundry',
    supported: issues.length === 0,
    compiler,
    evm,
    settings,
    issues,
    notes,
  });
}
export function validateRefs(snap: SnapshotT, refs: Ref[]) {
  for (const ref of refs) {
    const file = snap.files.find((f) => f.path === ref.path);
    if (!file || ref.start < 1 || ref.end < ref.start || ref.end > file.lines)
      throw new Error('Unresolvable source reference: ' + ref.path);
  }
}

export function verifySnapshot(store: Store, snap: SnapshotT) {
  const scope = store.get('scope', snap.scopeId);
  const expected = hash(
    stable({
      files: snap.files,
      paths: scope.paths,
      exclusions: scope.exclusions,
      requirements: scope.requirements,
      dependencyLocks: snap.dependencyLocks,
    }),
  );
  if (expected !== snap.hash) throw new Error('Snapshot manifest integrity failure');
  for (const file of snap.files) {
    const bytes = store.readArtifact(file.hash);
    if (bytes.length !== file.bytes || bytes.toString().split('\n').length !== file.lines)
      throw new Error('Source metadata integrity failure');
  }
}
