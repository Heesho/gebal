import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { entities, type EntityKind, type TaskT, Task, digest } from './schema.ts';
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const now = () => new Date().toISOString();
export const identity = () => ({ schemaVersion: 1 as const, id: randomUUID(), createdAt: now() });
export const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
export class Store {
  readonly db: DatabaseSync;
  readonly home: string;
  constructor(home = process.env.GEBAL_HOME || join(homedir(), '.local/share/gebal')) {
    this.home = resolve(home);
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    if (lstatSync(this.home).isSymbolicLink())
      throw new Error('State directory must not be a symlink');
    this.home = realpathSync(this.home);
    chmodSync(this.home, 0o700);
    mkdirSync(join(this.home, 'artifacts'), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.home, 'gebal.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(
      readFileSync(new URL('../../../migrations/001_initial.sql', import.meta.url), 'utf8'),
    );
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  put(kind: EntityKind, value: unknown, replace = false): any {
    const parsed = entities[kind].parse(value);
    if (kind === 'task')
      this.db
        .prepare(`${replace ? 'INSERT OR REPLACE' : 'INSERT'} INTO tasks VALUES (?,?,?,?,?,?)`)
        .run(
          parsed.id,
          (parsed as TaskT).runId,
          (parsed as TaskT).state,
          (parsed as TaskT).leaseUntil,
          (parsed as TaskT).leaseOwner,
          JSON.stringify(parsed),
        );
    else
      this.db
        .prepare(`${replace ? 'INSERT OR REPLACE' : 'INSERT'} INTO records VALUES (?,?,?)`)
        .run(kind, parsed.id, JSON.stringify(parsed));
    return parsed;
  }
  get<T = any>(kind: EntityKind, id: string): T {
    const row =
      kind === 'task'
        ? this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id)
        : this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    if (!row) throw new Error(`${kind} not found: ${id}`);
    return entities[kind].parse(JSON.parse(row.data as string)) as T;
  }
  list<T = any>(kind: EntityKind): T[] {
    const rows =
      kind === 'task'
        ? this.db.prepare('SELECT data FROM tasks ORDER BY rowid').all()
        : this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind);
    return rows.map((row) => entities[kind].parse(JSON.parse(row.data as string)) as T);
  }
  event(runId: string, message: string) {
    this.db
      .prepare('INSERT INTO events(run_id,at,message) VALUES (?,?,?)')
      .run(runId, now(), message.replace(/[\x00-\x08\x1b\x7f]/g, '').slice(0, 2000));
  }
  events(runId: string) {
    return this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY seq').all(runId);
  }
  artifact(data: string | Buffer, origin: string, mediaType = 'text/plain'): string {
    const bytes = Buffer.from(data);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Artifact exceeds 8 MiB');
    const h = hash(bytes);
    const path = join(this.home, 'artifacts', h);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 });
    this.readArtifact(h);
    if (!this.db.prepare("SELECT 1 FROM records WHERE kind='artifact' AND id=?").get(h))
      this.put('artifact', {
        ...identity(),
        id: h,
        hash: h,
        bytes: bytes.length,
        origin,
        mediaType,
      });
    return h;
  }
  readArtifact(h: string): Buffer {
    digest.parse(h);
    const path = join(this.home, 'artifacts', h);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new Error('Unsafe artifact');
    const bytes = readFileSync(path);
    if (hash(bytes) !== h) throw new Error('Artifact integrity failure');
    return bytes;
  }
  reserve(runId: string, tokens: number, limit: number) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('Invalid token reservation');
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO reservations(run_id) VALUES (?)').run(runId);
      const row = this.db.prepare('SELECT * FROM reservations WHERE run_id=?').get(runId)!;
      if (Number(row.reserved) + Number(row.consumed) + tokens > limit)
        throw new Error('Token budget exceeded');
      this.db
        .prepare('UPDATE reservations SET reserved=reserved+? WHERE run_id=?')
        .run(tokens, runId);
    });
  }
  settle(runId: string, reserved: number, consumed: number) {
    this.db
      .prepare(
        'UPDATE reservations SET reserved=reserved-?,consumed=consumed+? WHERE run_id=? AND reserved>=?',
      )
      .run(reserved, consumed, runId, reserved);
  }
  claim(runId: string, owner: string, leaseMs: number): TaskT | undefined {
    return this.transaction(() => {
      const tasks = this.list<TaskT>('task').filter((t) => t.runId === runId);
      // A plan reserves one tool resource envelope, even with multiple worker processes.
      if (tasks.some((t) => t.state === 'running')) return;
      const candidate = tasks.find(
        (t) =>
          t.state === 'pending' &&
          t.dependencies.every((id) => tasks.find((d) => d.id === id)?.state === 'succeeded'),
      );
      if (!candidate) return;
      const claimed = Task.parse({
        ...candidate,
        state: 'running',
        attempts: candidate.attempts + 1,
        leaseOwner: owner,
        leaseUntil: Date.now() + leaseMs,
      });
      this.put('task', claimed, true);
      return claimed;
    });
  }
  finish(task: TaskT, patch: Partial<TaskT>) {
    return this.transaction(() => {
      const current = this.get<TaskT>('task', task.id);
      if (current.state !== 'running' || current.leaseOwner !== task.leaseOwner)
        throw new Error('Lease lost');
      return this.put('task', { ...current, ...patch, leaseOwner: null, leaseUntil: null }, true);
    });
  }
}
