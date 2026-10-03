import { Store } from '../../core/src/store.ts';
import { workRun, resumeRun } from '../../core/src/engine.ts';
import type { RunT, TaskT } from '../../core/src/schema.ts';
const store = new Store();
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
try {
  while (!controller.signal.aborted) {
    for (const run of store
      .list<RunT>('run')
      .filter((r) => ['pending', 'running'].includes(r.state))) {
      const tasks = store.list<TaskT>('task').filter((t) => t.runId === run.id);
      if (tasks.some((t) => t.state === 'running')) {
        if (tasks.some((t) => t.state === 'running' && (t.leaseUntil ?? 0) > Date.now())) continue;
        resumeRun(store, run.id);
      }
      await workRun(store, run.id, controller.signal);
    }
    if (process.argv.includes('--once')) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      controller.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
} finally {
  store.close();
}
