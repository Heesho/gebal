import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Store } from './store.ts';

/** Resolve through existing parent aliases before enforcing the original-project write boundary. */
export function externalOutputPath(store: Store, output: string): string {
  const requested = resolve(output);
  if (existsSync(requested) && lstatSync(requested).isSymbolicLink())
    throw new Error('Export destination must not be a symlink');
  let parent = dirname(requested);
  const suffix = [basename(requested)];
  while (!existsSync(parent)) {
    suffix.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) throw new Error('Cannot resolve export destination');
    parent = next;
  }
  const canonical = join(realpathSync(parent), ...suffix);
  for (const project of store.list('project')) {
    if (canonical === project.root || canonical.startsWith(project.root + '/'))
      throw new Error('Export must be outside assessed repositories');
  }
  return canonical;
}
