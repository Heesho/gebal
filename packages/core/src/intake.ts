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
import { join, relative, basename, posix } from 'node:path';
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
        /^(\.git|\.env(?:\..*)?|\.ssh|\.aws|\.npmrc|\.pypirc|\.netrc|\.git-credentials|node_modules|out|cache|broadcast|\.gebal)$/.test(
          x,
        ) || /\.(pem|key|p12|keystore)$/i.test(x),
    );
export function snapshot(
  store: Store,
  rootInput: string,
  paths: string[],
  exclusions: string[],
  requirements: string,
  permission: 'owned' | 'authorized',
  options: { projectPath?: string; dependencyPaths?: string[] } = {},
) {
  const root = realpathSync(rootInput);
  if (!lstatSync(root).isDirectory()) throw new Error('Repository must be a directory');
  if (store.home === root || store.home.startsWith(root + '/'))
    throw new Error('State directory must be outside the assessed repository');
  paths.forEach((p) => relpath.parse(p));
  options.dependencyPaths?.forEach((p) => relpath.parse(p));
  if (options.projectPath) relpath.parse(options.projectPath);
  exclusions.forEach((p) => relpath.parse(p));
  const project = store.put('project', { ...identity(), name: basename(root), root });
  const scope = Scope.parse({
    ...identity(),
    projectId: project.id,
    authorized: true,
    paths,
    ...options,
    exclusions,
    requirements,
    permission,
  });
  const files: SnapshotT['files'] = [],
    excluded: string[] = [];
  let size = 0;
  let visited = 0;
  const activeDirectories = new Set<string>();
  const walk = (p: string, dependency = false) => {
    if (++visited > 12000) throw new Error('Snapshot entry limit exceeded');
    if (
      secret(
        dependency
          ? p
              .split('/')
              .filter((x) => x !== 'node_modules')
              .join('/')
          : p,
      ) ||
      exclusions.some((x) => p === x || p.startsWith(x + '/'))
    ) {
      excluded.push(p);
      return;
    }
    const absolute = join(root, p);
    let stat;
    const segments = p.split('/');
    for (let i = 1; i < segments.length; i++) {
      const parent = join(root, ...segments.slice(0, i));
      try {
        if (!dependency && lstatSync(parent).isSymbolicLink())
          throw new Error('Symlinks are not allowed: ' + p);
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
    if (stat.isSymbolicLink() && !dependency) throw new Error(`Symlinks are not allowed: ${p}`);
    const resolved = realpathSync(absolute);
    if (!resolved.startsWith(root + '/')) throw new Error('Path escapes repository');
    if (
      dependency &&
      secret(
        relative(root, resolved)
          .split('/')
          .filter((x) => x !== 'node_modules')
          .join('/'),
      )
    )
      throw new Error('Dependency resolves to a protected path: ' + p);
    if (dependency) stat = lstatSync(resolved);
    if (stat.isDirectory()) {
      if (activeDirectories.has(resolved)) throw new Error('Dependency symlink cycle: ' + p);
      activeDirectories.add(resolved);
      try {
        for (const name of readdirSync(absolute).sort()) walk(p + '/' + name, dependency);
      } finally {
        activeDirectories.delete(resolved);
      }
      return;
    }
    // Dependencies are inert Solidity and provenance metadata, never package scripts or binaries.
    if (
      dependency &&
      !p.endsWith('.sol') &&
      basename(p) !== 'package.json' &&
      !/^LICENSE(?:\..*)?$/.test(basename(p))
    )
      return;
    if (files.some((f) => f.path === p)) return;
    if (!stat.isFile() || (!dependency && stat.nlink !== 1))
      throw new Error(`Unsupported file: ${p}`);
    if (stat.size > 2 * 1024 * 1024 || (size += stat.size) > 16 * 1024 * 1024)
      throw new Error('Snapshot exceeds file/total byte limit');
    const fd = openSync(
      dependency ? resolved : absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
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
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    if (files.some((f) => f.path === p)) return;
    const h = store.artifact(content, 'source:' + p);
    files.push({
      path: p,
      hash: h,
      bytes: content.length,
      lines: content.toString().split('\n').length,
    });
  };
  paths.forEach((p) => walk(p));
  options.dependencyPaths?.forEach((p) => walk(p, true));
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some((f) => f.path.endsWith('.sol')))
    throw new Error('No authorized Solidity sources found');
  const dependencyLocks = Object.fromEntries(
    files
      .filter((f) => /(?:lock|lock\.json|pnpm-lock\.yaml)$/.test(f.path))
      .map((f) => [f.path, f.hash]),
  );
  const snap = Snapshot.parse({
    ...identity(),
    scopeId: scope.id,
    files,
    excluded,
    dependencyLocks,
    hash: hash(stable({ files, paths, ...options, exclusions, requirements, dependencyLocks })),
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
  const scope = store.get('scope', snap.scopeId);
  const projectPath = scope.projectPath ?? '';
  const within = (value: unknown): string => {
    if (typeof value !== 'string' || value.startsWith('/') || /[\\\x00-\x20$]/.test(value))
      throw new Error('Expected a literal relative project path');
    const path = posix.normalize(posix.join(projectPath, value)).replace(/\/$/, '');
    relpath.parse(path);
    return path;
  };
  const config = snap.files.find((f) => f.path === posix.join(projectPath, 'foundry.toml'));
  if (!config)
    return Diagnosis.parse({
      kind: snap.files.some((f) => f.path.includes('hardhat.config')) ? 'hardhat' : 'unknown',
      supported: false,
      compiler,
      evm,
      settings,
      issues: ['An explicit foundry.toml at the selected projectPath is required.'],
      notes,
    });
  try {
    const parsed = parse(store.readArtifact(config.hash).toString()) as any;
    if (Object.keys(parsed).some((k) => !['profile', 'rpc_endpoints', 'fmt'].includes(k)))
      issues.push('Unsupported top-level Foundry configuration.');
    if (!parsed.profile?.default) issues.push('An explicit default profile is required.');
    const original = parsed.profile?.default ?? {};
    const allowed = [
      'src',
      'test',
      'script',
      'out',
      'cache_path',
      'libs',
      'solc_version',
      'evm_version',
      'optimizer',
      'optimizer_runs',
      'via_ir',
      'remappings',
      'bytecode_hash',
      'cbor_metadata',
      'fuzz',
      'invariant',
      'fs_permissions',
    ];
    for (const k of Object.keys(original))
      if (!allowed.includes(k)) issues.push(`Unsupported configuration key: ${k}`);
    compiler = typeof original.solc_version === 'string' ? original.solc_version : null;
    if (!compiler || !/^0\.8\.\d+$/.test(compiler))
      issues.push('An exact Solidity 0.8.x compiler version is required.');
    evm = typeof original.evm_version === 'string' ? original.evm_version : null;
    if (!evm || !['paris', 'shanghai', 'cancun', 'prague'].includes(evm))
      issues.push('An explicit supported EVM target is required.');
    for (const k of ['optimizer', 'via_ir', 'cbor_metadata'])
      if (original[k] !== undefined && typeof original[k] !== 'boolean')
        issues.push(`Invalid ${k} setting`);
    if (
      original.optimizer_runs !== undefined &&
      (!Number.isSafeInteger(original.optimizer_runs) || original.optimizer_runs < 0)
    )
      issues.push('Invalid optimizer_runs setting');
    if (
      original.bytecode_hash !== undefined &&
      !['none', 'ipfs', 'bzzr1'].includes(original.bytecode_hash)
    )
      issues.push('Invalid bytecode_hash setting');
    const libs = original.libs ?? ['lib'];
    if (!Array.isArray(libs)) throw new Error('libs must be an array');
    settings = {
      ...original,
      projectPath,
      src: within(original.src ?? 'src'),
      test: within(original.test ?? 'test'),
      libs: libs.map(within),
    };
    const remappingFile = snap.files.find(
      (f) => f.path === posix.join(projectPath, 'remappings.txt'),
    );
    const external = remappingFile
      ? store
          .readArtifact(remappingFile.hash)
          .toString()
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith('#'))
      : [];
    if (original.remappings !== undefined && !Array.isArray(original.remappings))
      throw new Error('remappings must be an array');
    const maps = [...(original.remappings ?? []), ...external].map((entry: unknown) => {
      if (typeof entry !== 'string' || !/^[@a-zA-Z0-9_./-]+=[@a-zA-Z0-9_./-]+\/$/.test(entry))
        throw new Error('Unsupported remapping');
      const [prefix, target] = entry.split('=');
      if (prefix.split('/').includes('..')) throw new Error('Unsupported remapping prefix');
      return [prefix, within(target) + '/'] as const;
    });
    const prefixes = new Map<string, string>();
    for (const [prefix, target] of maps) {
      if (prefixes.has(prefix) && prefixes.get(prefix) !== target)
        throw new Error('Conflicting remappings: ' + prefix);
      prefixes.set(prefix, target);
    }
    const remappings = [...prefixes].sort((a, b) => b[0].length - a[0].length);
    settings.remappings = remappings.map(([a, b]) => a + '=' + b);
    const names = new Set(snap.files.map((f) => f.path));
    const missing: string[] = [];
    const inferredRemappings = new Map<string, string>();
    for (const file of snap.files.filter((f) => f.path.endsWith('.sol'))) {
      const source = store.readArtifact(file.hash).toString();
      for (const m of source.matchAll(/import\s+(?:[^;]*?from\s+)?["']([^"']+)["']/g)) {
        const imp = m[1];
        let target: string;
        if (imp.startsWith('.')) target = posix.join(posix.dirname(file.path), imp);
        else {
          const mapping = remappings.find(([prefix]) => imp.startsWith(prefix));
          target = mapping
            ? mapping[1] + imp.slice(mapping[0].length)
            : posix.join(projectPath, imp);
          if (!mapping && !names.has(target)) {
            const candidates = (settings.libs as string[])
              .map((lib) => posix.join(lib, imp))
              .filter((candidate) => names.has(candidate));
            if (candidates.length > 1) issues.push('Ambiguous dependency import: ' + imp);
            else if (candidates.length === 1) {
              target = candidates[0];
              inferredRemappings.set(imp, target);
            }
          }
        }
        if (!names.has(target)) missing.push(`${file.path}: ${imp}`);
      }
    }
    settings.remappings = [...remappings, ...inferredRemappings]
      .sort((a, b) => b[0].length - a[0].length)
      .map(([a, b]) => a + '=' + b);
    if (inferredRemappings.size)
      notes.push(
        'Exact file remappings were resolved from uniquely matching authorized library paths and are included in the approved plan.',
      );
    if (missing.length)
      issues.push(
        'Dependencies missing from authorized snapshot: ' + missing.slice(0, 10).join(', '),
      );
    notes.push(
      'Only profile.default is selected; other profiles, RPC endpoints and formatting configuration are not loaded.',
      'Controller overrides output/cache/script paths, denies FFI/filesystem/RPC and dependency downloads, and disables automatic remappings.',
      'Configured fuzz/invariant campaigns are replaced by the disclosed fixed seed and bounded campaign. Tests requiring denied capabilities cannot be validated.',
    );
  } catch (e) {
    issues.push('Invalid or unsupported Foundry configuration: ' + String(e));
  }
  notes.push(
    'Source-only intake does not establish compiler, test, property or security coverage.',
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
      ...(scope.projectPath ? { projectPath: scope.projectPath } : {}),
      ...(scope.dependencyPaths ? { dependencyPaths: scope.dependencyPaths } : {}),
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
