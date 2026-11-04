// Printed-part mass estimate (kept free of the CAD kernel so the UI thread can use it).
import { MATERIALS, PROFILES, type Material, type ProfileKey } from '../catalog/rules';

/** Printed mass: perimeter shell (walls × 0.42 mm) plus infill of the remaining core. */
export function printedGrams(volume: number, area: number, profile: ProfileKey, material: Material): number {
  const pr = PROFILES[profile];
  const shell = Math.min(volume, area * pr.walls * 0.42 * 0.5 + area * 0.5 * 0.8); // walls + top/bottom skins
  const core = Math.max(0, volume - shell);
  return ((shell + core * pr.infill) / 1000) * MATERIALS[material].density;
}
