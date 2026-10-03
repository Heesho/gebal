import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'smol-toml';
import { Store } from '../../core/src/store.ts';
import { type PlanT, type SnapshotT, type Limits } from '../../core/src/schema.ts';
export const imagePattern = /^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64})$/;
export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  overflow: boolean;
};
export function processBounded(
  command: string,
  args: string[],
  seconds: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = '',
      stderr = '',
      bytes = 0,
      timedOut = false,
      overflow = false,
      cancelled = false,
      done = false;
    const child = spawn(
      command,
      command === 'docker' ? ['--host', 'unix:///var/run/docker.sock', ...args] : args,
      {
        env: {
          PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME || '',
          DOCKER_CONFIG: process.env.DOCKER_CONFIG || join(process.env.HOME || '', '.docker'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      },
    );
    const stop = () => {
      cancelled = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, seconds * 1000);
    const complete = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve({ code, stdout, stderr, timedOut, cancelled, overflow });
    };
    for (const [stream, key] of [
      [child.stdout, 'stdout'],
      [child.stderr, 'stderr'],
    ] as const)
      stream.on('data', (data: Buffer) => {
        bytes += data.length;
        if (bytes > maxBytes) {
          overflow = true;
          child.kill('SIGKILL');
          return;
        }
        if (key === 'stdout') stdout += data.toString();
        else stderr += data.toString();
      });
    child.on('error', (e) => {
      stderr = e.message;
      complete(null);
    });
    child.on('close', complete);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });
}
export async function dockerAvailable() {
  const r = await processBounded('docker', ['info', '--format', '{{.ServerVersion}}'], 5, 16384);
  return {
    available: r.code === 0 && r.stdout.trim().length > 0,
    detail: r.code === 0 ? r.stdout.trim() : r.stderr.trim() || 'Docker daemon unavailable',
  };
}
export function dockerArgs(
  name: string,
  image: string,
  source: string,
  controller: string,
  budget: Limits,
  kind: string,
) {
  if (!imagePattern.test(image))
    throw new Error('Tool image must use an immutable digest or image ID');
  if (!['foundry-build', 'foundry-test', 'slither'].includes(kind))
    throw new Error('Unknown sandbox operation');
  if ([source, controller].some((x) => x.includes(',') || x.includes('\n')))
    throw new Error('Unsupported mount path');
  return [
    'run',
    '--rm',
    '--pull=never',
    '--name',
    name,
    '--network=none',
    '--read-only',
    '--user=65534:65534',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit',
    String(budget.pids),
    '--memory',
    `${budget.memoryMb}m`,
    '--memory-swap',
    `${budget.memoryMb}m`,
    '--cpus',
    String(budget.cpus),
    '--ulimit',
    'nofile=128:128',
    '--log-driver=none',
    '--tmpfs',
    `/work:rw,nosuid,nodev,noexec,size=${budget.diskMb}m,mode=1777`,
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
    '--mount',
    `type=bind,src=${source},dst=/source,readonly`,
    '--mount',
    `type=bind,src=${controller},dst=/controller,readonly`,
    '--workdir',
    '/source',
    '--entrypoint',
    '/usr/bin/python3',
    image,
    '/controller/runner.py',
    kind,
  ];
}
// Fixed controller code. Repository/model text is never executed as a command.
const runner = String.raw`
import os, sys, subprocess, json
cfg=json.load(open('/controller/policy.json'))
env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','FOUNDRY_CONFIG':'/controller/foundry.toml','FOUNDRY_PROFILE':'default','FOUNDRY_FFI':'false','FOUNDRY_OFFLINE':'true','NO_COLOR':'1','FOUNDRY_FUZZ_SEED':'0x'+'0'*63+'1','FOUNDRY_FUZZ_RUNS':'256','FOUNDRY_INVARIANT_RUNS':'64','FOUNDRY_INVARIANT_DEPTH':'32'}
def run(args):
 with open('/work/stdout','w+') as out,open('/work/stderr','w+') as err:
  result=subprocess.run(args,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=cfg['seconds'])
  out.seek(0);err.seek(0);a=out.read(cfg['maxOutputBytes']+1);b=err.read(cfg['maxOutputBytes']+1)
  if len(a)+len(b)>cfg['maxOutputBytes']:raise RuntimeError('Output limit exceeded')
  return result.returncode,a,b
try:
 cv=run(['/usr/local/bin/solc','--version'])
 if cv[0]!=0 or ('Version: '+cfg['compiler']+'+') not in cv[1]:raise RuntimeError('Compiler version mismatch')
 kind=sys.argv[1]
 tool='slither' if kind=='slither' else 'forge'
 version=run(['/usr/local/bin/'+tool,'--version'])
 if version[0]!=0:raise RuntimeError('Tool version unavailable')
 if kind=='slither':
  build=run(['/usr/local/bin/forge','build','--root','/source','--config-path','/controller/foundry.toml','--offline','--ast','--build-info','--extra-output','storageLayout','--json'])
  if build[0]!=0:raise RuntimeError('Slither prerequisite build failed: '+build[2][:3000]+build[1][:3000])
  code,out,err=run(['/usr/local/bin/slither','/source','--compile-force-framework','foundry','--foundry-ignore-compile','--foundry-out-directory','/work/out','--config-file','/controller/slither.json','--json','/work/slither.json'])
  out=open('/work/slither.json').read(cfg['maxOutputBytes']+1)
 else:
  code,out,err=run(['/usr/local/bin/forge','test' if kind=='foundry-test' else 'build','--root','/source','--config-path','/controller/foundry.toml','--offline','--json'])
 if len(out)+len(err)>cfg['maxOutputBytes']:raise RuntimeError('Output limit exceeded')
 print(json.dumps({'version':version[1].strip(),'compilerVersion':cv[1].strip(),'exitCode':code,'stdout':out,'stderr':err}))
except Exception as e:
 print(json.dumps({'error':str(e)}));sys.exit(2)
`;
export async function sandbox(
  store: Store,
  plan: PlanT,
  snapshot: SnapshotT,
  kind: string,
  taskId: string,
  signal?: AbortSignal,
) {
  if (!plan.image) throw new Error('No immutable tool image configured');
  const dir = mkdtempSync(join(tmpdir(), 'gebal-'));
  chmodSync(dir, 0o755);
  const source = join(dir, 'source'),
    controller = join(dir, 'controller');
  mkdirSync(source);
  mkdirSync(controller);
  const name = 'gebal-' + taskId;
  try {
    for (const file of snapshot.files) {
      const path = join(source, file.path);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, store.readArtifact(file.hash), { mode: 0o444 });
    }
    const settings = plan.diagnosis.settings;
    const policy = {
      profile: {
        default: {
          src: '/source/src',
          test: '/source/test',
          libs: ['/source/lib'],
          solc: '/usr/local/bin/solc',
          evm_version: plan.diagnosis.evm!,
          optimizer: settings.optimizer ?? false,
          optimizer_runs: settings.optimizer_runs ?? 200,
          via_ir: settings.via_ir ?? false,
          remappings: settings.remappings ?? [],
          out: '/work/out',
          cache_path: '/work/cache',
          ffi: false,
          fs_permissions: [],
          offline: true,
          auto_detect_solc: false,
        },
      },
    };
    writeFileSync(join(controller, 'foundry.toml'), stringify(policy as any), { mode: 0o444 });
    writeFileSync(
      join(controller, 'policy.json'),
      JSON.stringify({ ...plan.limits, compiler: plan.diagnosis.compiler }),
      { mode: 0o444 },
    );
    writeFileSync(join(controller, 'runner.py'), runner, { mode: 0o444 });
    writeFileSync(join(controller, 'slither.json'), '{}', { mode: 0o444 });
    const argv = dockerArgs(name, plan.image, source, controller, plan.limits, kind);
    const result = await processBounded(
      'docker',
      argv,
      plan.limits.seconds,
      Math.min(8 * 1024 * 1024, plan.limits.maxOutputBytes * 2 + 16384),
      signal,
    );
    return { result, argv: argv.map((x) => x.replaceAll(dir, '<disposable-workspace>')) };
  } finally {
    await processBounded('docker', ['rm', '-f', name], 5, 16384);
    rmSync(dir, { recursive: true, force: true });
  }
}
