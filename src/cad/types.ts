// Assembly description produced by the CAD worker and consumed by the viewer, simulator and exporters.
// Frame: X = robot right, Y = forward, Z = up, ground at Z = 0, millimetres. Everything is modelled in
// its assembled pose with every joint at 0.

import type { Material, ProfileKey } from '../catalog/rules';

export type Vec3 = [number, number, number];

export interface MeshData {
  positions: Float32Array;   // xyz triplets
  indices: Uint32Array;
}

export interface BuiltPart {
  id: string;
  name: string;
  link: string;
  material: Material;
  profile: ProfileKey;
  color: string;
  mesh: MeshData;            // assembled pose
  printMesh: MeshData;       // rotated into print orientation, resting on Z = 0
  printNote: string;
  volume: number;            // mm³
  area: number;              // mm²
  watertight: boolean;
  bbox: { min: Vec3; max: Vec3 };
  printBBox: { min: Vec3; max: Vec3 };
}

export interface BuiltComponent {
  key: string;
  catalogId: string;
  label: string;
  link: string;
  mesh: MeshData;
  color: string;
  center: Vec3;
}

export type ActuatorKind = 'servo' | 'cservo' | 'motor';

export interface JointDef {
  origin: Vec3;              // world position of the axis at the zero pose (mm)
  axis: Vec3;                // unit vector, world frame
  limit?: [number, number];  // degrees (revolute) or mm of travel (prismatic)
  /** 'prismatic' = linear travel along `axis` (rack and pinion). Default 'revolute'. */
  type?: 'revolute' | 'prismatic';
  /** Prismatic only: pitch radius of the driving pinion, mm (travel = radius × servo angle). */
  pinionR?: number;
  actuator: { kind: ActuatorKind; catalogId: string; port: string; label: string };
}

export type Collider =
  | { shape: 'box'; center: Vec3; half: Vec3; friction?: number }
  | { shape: 'cylX'; center: Vec3; radius: number; halfLen: number; friction?: number }
  | { shape: 'ball'; center: Vec3; radius: number; friction?: number };

export interface LinkDef {
  id: string;
  name: string;
  parent: string | null;
  joint?: JointDef;
  colliders: Collider[];
  massG: number;             // parts + components
  com: Vec3;                 // world, zero pose
}

export interface GeoCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface Fastener { size: string; qty: number; use: string }

export interface AssemblyMeta {
  payload?: { link: string; at: Vec3 };        // where a carried payload sits (arm)
  wheelR?: number;                              // rover wheel radius, mm
  trackMm?: number;                             // rover wheel centre track
  support?: [number, number][];                 // ground contact polygon (XY, mm) for tip checks
  clampable?: boolean;                          // base has clamp tabs
}

export interface Assembly {
  meta: AssemblyMeta;
  parts: BuiltPart[];
  components: BuiltComponent[];
  links: LinkDef[];
  checks: GeoCheck[];
  fasteners: Fastener[];
  extras: { item: string; qty: number }[];
  assemblySteps: string[];
  dims: { w: number; d: number; h: number };
  buildMs: number;
}
