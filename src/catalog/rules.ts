// FDM design rules from the CyberBrick guide (sections 4-9, 11, 12).

export const FIT = {
  journal: 0.40,      // free-spinning journal, diametrical
  slide: 0.20,        // sliding fit, per mating wall
  push: 0.40,         // push-fit pocket (Pocket = Part + 0.40)
  press: 0.05,        // press-fit (Hole = Pin + 0.05)
  magnetD: 4.2, magnetH: 2.2,   // for Ø4 x 2 N52
  nutAF: 5.6, nutDepth: 2.6,    // DIN 934 M3
  tunnel: 6.5,        // screwdriver line-of-sight tunnel
};

export const HOLES = {
  M2: { clear: 2.3, tap: 1.7, cbore: 4.2, cboreDepth: 2.2, minWall: 1.4, tunnel: 5.0 },
  M2_5: { clear: 2.8, tap: 2.15, cbore: 5.2, cboreDepth: 2.8, minWall: 1.8, tunnel: 6.5 },
  M3: { clear: 3.4, tap: 2.6, cbore: 6.2, cboreDepth: 3.4, minWall: 2.2, tunnel: 6.5 },
  M4: { clear: 4.5, tap: 3.4, cbore: 8.0, cboreDepth: 4.4, minWall: 2.8, tunnel: 8.0 },
};

export type ProfileKey = 'chassis' | 'motorMount' | 'cantilever' | 'wheel' | 'shell' | 'tire';

export interface SlicingProfile {
  key: ProfileKey;
  label: string;
  layer: number;
  walls: number;
  infill: number;          // 0..1
  pattern: string;
  note: string;
}

export const PROFILES: Record<ProfileKey, SlicingProfile> = {
  chassis: { key: 'chassis', label: 'Primary chassis base', layer: 0.20, walls: 4, infill: 0.25, pattern: 'gyroid', note: 'Absorbs motor vibration; torsional stiffness across the drive baseline.' },
  motorMount: { key: 'motorMount', label: 'Motor & gear mount', layer: 0.16, walls: 5, infill: 0.45, pattern: 'gyroid', note: 'Hoop strength around screw bosses prevents cracking when tightening.' },
  cantilever: { key: 'cantilever', label: 'Cantilever stem / arm', layer: 0.16, walls: 5, infill: 0.40, pattern: 'gyroid (print on side)', note: 'Continuous perimeter loops resist bending.' },
  wheel: { key: 'wheel', label: 'Wheel rim & hub', layer: 0.16, walls: 4, infill: 0.35, pattern: 'gyroid', note: 'Concentricity; resists radial crush from the tyre.' },
  shell: { key: 'shell', label: 'Decorative body shell', layer: 0.16, walls: 3, infill: 0.18, pattern: 'adaptive cubic', note: 'Light, low centre of gravity, smooth surface.' },
  tire: { key: 'tire', label: 'Robot tyre (flexible)', layer: 0.20, walls: 3, infill: 0.15, pattern: 'gyroid (TPU 95A)', note: 'Compliance and grip on polished desks.' },
};

export type Material = 'PETG' | 'PLA+' | 'ABS/ASA' | 'TPU 95A' | 'PA-CF';

export const MATERIALS: Record<Material, { density: number; tensile: string; hdt: string; use: string; motorSafe: boolean; color: string }> = {
  'PETG': { density: 1.27, tensile: '~50 MPa', hdt: '~75 °C', use: 'Primary standard: chassis, brackets, functional gears', motorSafe: true, color: '#4f8cff' },
  'PLA+': { density: 1.24, tensile: '~58 MPa', hdt: '~55 °C', use: 'Exterior shells and brackets away from heat', motorSafe: false, color: '#ffd23f' },
  'ABS/ASA': { density: 1.05, tensile: '~44 MPa', hdt: '~98 °C', use: 'Outdoor, hot motors, UV exposure', motorSafe: true, color: '#e8e8e8' },
  'TPU 95A': { density: 1.21, tensile: 'flexible', hdt: '~60 °C', use: 'Tyres, bumpers, shock mounts', motorSafe: false, color: '#333333' },
  'PA-CF': { density: 1.15, tensile: '~95 MPa', hdt: '~150 °C', use: 'Combat robots, high-ratio gears, grippers', motorSafe: true, color: '#555555' },
};

/** Packaging clearances (guide s.10-12; cableRoute / rotatingGap from the architecture doc step 3 / turntable). */
export const CLEARANCE = {
  crossClampPerSide: 0.30,         // tongue & cheek joint, each side (s.10)
  cableRoute: 4.0,                 // insulation / cable routing gap around packed components (arch step 3)
  rotatingGap: 2.0,                // rotating platter to lid (arch s.4.2.1)
  batterySwellLen: 1.5,            // bay length margin (s.11)
  batterySwellWid: 1.0,            // bay width margin (s.11)
  cellTroughExtraR: 0.5,           // trough R = R_cell + 0.5 (s.11)
  fingerRelief: [18, 24] as const, // Ø range of lift-out reliefs (s.11)
  egressSlot: [10, 6] as const,    // rear wire egress slot W x H (s.11)
  strapT: 2.8,                     // rigid cross-strap thickness (s.11)
  strapBossOutside: 2.0,           // |X| >= cradle half-width + 2.0 (s.11)
  supportOverhangDeg: 50,          // supports only beyond this overhang (s.12)
  minStructuralWalls: 4,           // perimeter walls for structural parts (s.12)
};

/** Press-fit allowance for bearings, dowels and bushings (s.4: Hole = Pin + 0.05). */
export const BEARING_PRESS = 0.05;
export const bearingBore = (d: number) => +(d + BEARING_PRESS).toFixed(3);

export const CHECKLIST = [
  'Watertight mesh: zero non-manifold edges or self-intersections',
  'Boolean order: battery cavity and servo bays subtracted after all bosses are unified',
  'Screwdriver clearance: Ø6.5 line-of-sight tunnels for internal M2.5/M3 fasteners',
  'Journal clearance: +0.20 mm radial on unpowered hubs',
  'Captive nut pockets at 5.60 mm across flats',
  'Magnet pockets Ø4.20 for Ø4.00 magnets',
  'Bending-load parts sliced flat on their side',
  'Minimum 4 perimeter walls for structural parts',
  'Supports only for overhangs > 50°; bores and screw holes print support-free',
  'PETG or ABS for motor mounts and structural chassis',
];
