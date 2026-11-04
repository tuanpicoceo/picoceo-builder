/// <reference lib="webworker" />
// CAD worker: keeps the manifold WASM kernel off the UI thread.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { RobotSpec } from '../design/spec';
import { buildAssembly } from './build';
import { initKernel } from './kernel';

const ready = initKernel(() => wasmUrl);

self.onmessage = async (e: MessageEvent<{ id: number; spec: RobotSpec }>) => {
  const { id, spec } = e.data;
  try {
    await ready;
    const a = buildAssembly(spec);
    const transfer: ArrayBuffer[] = [];
    for (const p of a.parts) transfer.push(p.mesh.positions.buffer as ArrayBuffer, p.mesh.indices.buffer as ArrayBuffer, p.printMesh.positions.buffer as ArrayBuffer, p.printMesh.indices.buffer as ArrayBuffer);
    for (const c of a.components) transfer.push(c.mesh.positions.buffer as ArrayBuffer, c.mesh.indices.buffer as ArrayBuffer);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, assembly: a }, transfer);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
