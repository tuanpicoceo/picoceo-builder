// STL / 3MF / ZIP exporters. Everything is generated in the browser from the print-oriented meshes.

import { strToU8, zipSync } from 'fflate';
import type { Assembly, BuiltPart, MeshData } from '../cad/types';
import type { RobotSpec } from '../design/spec';
import { isLinuxPlatform, linuxAppId } from '../design/firmwareLinux';

/** Firmware ZIP; the Linux apps (Claw, Pi, Jetson) go into their <app id>/ folder so they can be copied as is;
 * CyberBrick and XiaoZhi MicroPython files stay flat. */
export function firmwareZip(spec: RobotSpec, files: Record<string, string>): Uint8Array {
  const dir = isLinuxPlatform(spec.platform) ? `${linuxAppId(spec)}/` : '';
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [dir + k, strToU8(v)])));
}

export function stlBinary(m: MeshData, name: string): Uint8Array {
  const n = m.indices.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = `PICOCEO Builder ${name}`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  const p = m.positions;
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) { dv.setFloat32(o, p[i + k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

/** Shelf-pack print footprints onto 256 x 256 plates (6 mm gaps). */
export function layoutPlates(parts: BuiltPart[], bed = 256, gap = 6) {
  const items = parts.map(p => ({ p, w: p.printBBox.max[0] - p.printBBox.min[0], d: p.printBBox.max[1] - p.printBBox.min[1] }))
    .sort((a, b) => b.d - a.d);
  const placed: { p: BuiltPart; plate: number; x: number; y: number }[] = [];
  let plate = 0, x = gap, y = gap, rowH = 0;
  for (const it of items) {
    if (x + it.w + gap > bed) { x = gap; y += rowH + gap; rowH = 0; }
    if (y + it.d + gap > bed) { plate++; x = gap; y = gap; rowH = 0; }
    placed.push({ p: it.p, plate, x: x + it.w / 2, y: y + it.d / 2 });
    x += it.w + gap; rowH = Math.max(rowH, it.d);
  }
  return placed;
}

export function threeMF(spec: RobotSpec, a: Assembly): Uint8Array {
  const placed = layoutPlates(a.parts);
  let objects = '', items = '';
  placed.forEach((pl, i) => {
    const m = pl.p.printMesh;
    let v = '', t = '';
    for (let k = 0; k < m.positions.length; k += 3) v += `<vertex x="${m.positions[k].toFixed(4)}" y="${m.positions[k + 1].toFixed(4)}" z="${m.positions[k + 2].toFixed(4)}"/>`;
    for (let k = 0; k < m.indices.length; k += 3) t += `<triangle v1="${m.indices[k]}" v2="${m.indices[k + 1]}" v3="${m.indices[k + 2]}"/>`;
    objects += `<object id="${i + 1}" type="model" name="${esc(pl.p.name)} [${pl.p.material}]"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    items += `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${(pl.x + pl.plate * 300).toFixed(2)} ${pl.y.toFixed(2)} 0"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(spec.name)}</metadata><metadata name="Application">PICOCEO Builder</metadata>
<resources>${objects}</resources><build>${items}</build></model>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
  });
}

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'robot';

export function projectZip(spec: RobotSpec, a: Assembly, extra: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const p of a.parts) files[`stl/${p.id}.stl`] = stlBinary(p.printMesh, p.name);
  files[`${slug(spec.name)}.3mf`] = threeMF(spec, a);
  files['spec.json'] = strToU8(JSON.stringify(spec, null, 2));
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return zipSync(files, { level: 6 });
}

export function download(name: string, data: Uint8Array | string, type = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : data.slice().buffer], { type });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = name; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
