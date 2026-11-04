// Promise wrapper around the CAD worker. Only the latest request resolves; older ones are dropped.
import type { RobotSpec } from '../design/spec';
import type { Assembly } from './types';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map<number, { resolve: (a: Assembly) => void; reject: (e: Error) => void }>();

worker.onmessage = (e: MessageEvent<{ id: number; assembly?: Assembly; error?: string }>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.error) p.reject(new Error(e.data.error));
  else p.resolve(e.data.assembly!);
};

export function buildInWorker(spec: RobotSpec): Promise<Assembly> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, spec });
  });
}
