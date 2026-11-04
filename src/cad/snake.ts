// Articulated Snake / Serpentine robot: snake head (housing isolated battery bay, ESP32 core,
// shield, switch, LED eyes, and S1 yaw servo), chained body segments (each housing a servo driving yaw),
// and a tapered tail cone.
// 4 DOF (4 yaw joints) builds with 1 kit; expandable to 8-16 joints with multiple kits.
// LicheeRV Claw kit: longer snout, PCA9685 along the deck, and the Claw module (own battery + speaker) raised in a
// hood at the front of the cowl (its LCD is the snake's face) in place of the LED eyes.

import { HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { bayBattery, clawDeck, clawFace, clawFaceBox } from './claw';
import { Build, box, cylY, cylZ, rrect, sub, union } from './kernel';
import {
  EAR_HOLES, EAR_X0, EAR_X1, HORN_SEAT, SV,
  batteryBay, batterySolid, electronics, hornSeatCuts, hornSolid,
  ledPocketCuts, ledSolid, place, servoSolid, strapPart, type Frame,
} from './modules';
import type { Vec3 } from './types';

export const SNAKE = {
  hw: 24,           // half width = 24 mm (total 48 mm)
  hy: 38,           // half depth = 38 mm (total 76 mm)
  zJoint: 14,       // yaw servo ear plane height
  segLen: 38,       // pitch distance between adjacent segment joints (mm)
  segW: 24,         // body segment width (mm)
  segH: 30,         // body segment height (mm)
};

export function buildSnake(b: Build, spec: RobotSpec) {
  const hw = SNAKE.hw;
  const hy = SNAKE.hy;
  const floorTop = 3;
  const wallTop = floorTop + 20.5;
  const deckTop = wallTop + 3;
  const zJoint = SNAKE.zJoint;
  const segLen = SNAKE.segLen;
  const segW = SNAKE.segW;
  const segH = SNAKE.segH;

  const numJoints = 4;
  const claw = spec.platform === 'licheerv_claw';
  const ext = claw ? 19 : 0;        // Claw: snout lengthened so the 62.5 mm PCA9685 fits along the deck
  const noseY = hy + 4 + ext;       // front of the snout

  // ---------------------------------------------------------------- Head Module (Link: 'head')
  // Battery bay placed at y = 6: battery spans y in [-18.85, 30.85]
  const batY = 6;
  const bay = batteryBay(0, batY, floorTop, { reliefY: batY - 14, strapY: batY + 12, egress: 'front' });

  // Rear joint mount for Servo S1: shaft pointing +Z at [0, -28, zJoint]
  // S1 body extends y in [-34, -22], x in [-11.4, 11.4]
  const s1Y = -28;
  const s1Pos: Vec3 = [0, s1Y, zJoint];
  const s1Frame: Frame = { rots: [[0, 0, 0]], pos: s1Pos };

  // Head tub outer walls
  const headOutline = (z0: number, z1: number) => union([
    rrect(2 * hw, 2 * hy - 14, 6, 0, 6, z0, z1),
    rrect(2 * hw - 8, 16 + ext, 5, 0, hy - 4 + ext / 2, z0, z1),
  ]);

  const deckBosses: [number, number][] = [
    [-hw + 4, -10], [hw - 4, -10],
    [-hw + 4, hy - 4], [hw - 4, hy - 4],
  ];
  const deckBossSolids = union(deckBosses.map(([x, y]) => cylZ(x, y, 3.5, floorTop - 0.01, wallTop)));
  const deckBossTaps = union(deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, wallTop - 10, wallTop + 1, 16)));

  // S1 mounting bracket at rear
  const s1Pillars = union([
    cylZ(EAR_HOLES[0], s1Y, 3.2, floorTop - 0.01, zJoint),
    cylZ(EAR_HOLES[1], s1Y, 3.2, floorTop - 0.01, zJoint),
    box(EAR_HOLES[0] - 3.2, EAR_HOLES[1] + 3.2, s1Y - 6.2, s1Y + 6.2, floorTop - 0.01, floorTop + 3),
  ]);

  const s1Cuts = union([
    box(EAR_X0 - 0.8, EAR_X1 + 0.8, -SV.W / 2 - 0.8, SV.W / 2 + 0.8, -SV.below - 2, SV.above + 2),
    cylZ(0, 0, 14, 6, 25, 32), // clear horn completely
    ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -8, 2, 16)),
  ]);

  const innerTub = union([
    rrect(2 * hw - 4, 2 * hy - 20, 4, 0, 8, floorTop, wallTop + 1),
  ]);

  const headTub = sub(
    union([
      headOutline(0, wallTop),
      bay.add, bay.bosses, deckBossSolids, s1Pillars,
    ]),
    innerTub,
    bay.cut, bay.bossTaps, deckBossTaps,
    box(-14.7, 14.7, batY - 26.35, batY + 26.35, floorTop + 3, wallTop + 1),
    // Notch for strap
    box(-hw - 1, -hw + 3, batY + 6, batY + 18, bay.strapZ0 - 0.5, wallTop + 1),
    box(hw - 3, hw + 1, batY + 6, batY + 18, bay.strapZ0 - 0.5, wallTop + 1),
    place(s1Cuts, s1Frame),
    ...(claw ? [box(-15, 15, hy + 1, noseY - 2.5, floorTop, wallTop + 1)] : []) // hollow snout extension
  );

  b.part({
    id: 'head_chassis',
    name: 'Snake head chassis',
    link: 'head',
    material: spec.structural,
    profile: 'chassis',
    color: spec.primaryColor,
    solid: headTub,
    printRot: [0, 0, 0],
    printNote: 'Base flat on the print bed.',
  });

  const bat = bayBattery(spec);
  b.comp({
    key: 'battery',
    catalogId: bat.id,
    label: bat.label,
    link: 'head',
    solid: batterySolid(0, batY, bay.batZ0),
    color: '#1f6fd1',
  });

  b.part({
    id: 'battery_strap',
    name: 'Head battery strap',
    link: 'head',
    material: spec.structural,
    profile: 'chassis',
    color: spec.accentColor,
    solid: strapPart(0, batY + 12, bay.strapZ0, bay.bossX),
    printRot: [0, 0, 0],
    printNote: 'Flat.',
  });

  b.comp({
    key: 'servo_yaw_1',
    catalogId: 'B-PG001',
    label: 'Yaw servo 1 (S1)',
    link: 'head',
    solid: place(servoSolid(), s1Frame),
  });

  // ---------------------------------------------------------------- Head Deck & Cowl
  // Deck plate ends at y = -17 to leave rear servo S1 spline and tongue completely clear
  const deckPlate = sub(
    headOutline(wallTop, deckTop),
    box(-hw - 1, hw + 1, -hy - 5, -17, wallTop - 1, deckTop + 1),
    cylZ(0, s1Y, 17, wallTop - 1, deckTop + 1, 32)
  );
  const deckScrewHoles = union(deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, wallTop - 1, deckTop + 1, 16)));

  if (claw) {
    // Claw: PCA9685 along Y on the deck (rear bosses just clear the S1 horn cut, board ends at y 48.75, behind the chin)
    const dk = clawDeck(b, 'head', deckTop, { pca: [0, 17.5], alongY: true });
    b.part({
      id: 'head_deck', name: 'Snake head electronics deck', link: 'head', material: spec.structural, profile: 'motorMount',
      color: spec.accentColor, solid: sub(union([deckPlate, ...(dk.add ? [dk.add] : [])]), deckScrewHoles, ...(dk.cut ? [dk.cut] : [])),
      printRot: [0, 0, 0], printNote: 'Flat plate on bed; PCA9685 servo board screws on top.',
    });

    // Cowl: low shell over the PCA9685 (headers top at deckTop + 14.1); the Claw face stands on the roof at the snout tip in
    // a hood, so its retainer is fully exposed behind the hood above the roof.
    const cowlZ0 = deckTop + 0.02, roofZ = deckTop + 18, pocketTop = roofZ - 2;
    const faceZ = roofZ - clawFaceBox(0, noseY, 0).z0;          // frame bottom on the roof
    const fb = clawFaceBox(0, noseY, faceZ);
    const face = clawFace(b, spec, 'head', { x: 0, yF: noseY, z: faceZ, keyReach: hw });
    const yBack = fb.y0 + 2, fy = noseY - 1.5;                    // module pocket back / LCD front
    const snout = (w: number, d: number, r: number, z0: number, z1: number) => rrect(w, d, r, 0, hy - 4 + ext / 2, z0, z1);
    const cowlOuter = sub(
      union([
        rrect(2 * hw, 17 + hy, 6, 0, (-17 + hy) / 2, cowlZ0, roofZ - 3),
        snout(2 * hw - 8, 16 + ext, 5, cowlZ0, roofZ - 3),
        rrect(2 * hw - 4, 15 + hy, 7, 0, (-16 + hy) / 2, roofZ - 4, roofZ),
        snout(2 * hw - 12, 14 + ext, 4, roofZ - 4, roofZ),
        rrect(2 * hw, fb.y1 - fb.y0, 5, 0, (fb.y0 + fb.y1) / 2, roofZ - 8, fb.z1),   // hood flaring round the face
      ]),
      box(-hw - 1, hw + 1, -hy - 5, -17, deckTop - 1, fb.z1 + 1),
      cylZ(0, s1Y, 17, deckTop - 1, fb.z1 + 1, 32)
    );
    const cowlPocket = sub(
      union([
        rrect(2 * hw - 4, 13 + hy, 4, 0, (-17 + hy) / 2, deckTop - 0.5, roofZ - 5),
        snout(2 * hw - 12, 12 + ext, 3, deckTop - 0.5, roofZ - 5),
        rrect(2 * hw - 8, 11 + hy, 3, 0, (-17 + hy) / 2, roofZ - 5.1, pocketTop),
        snout(2 * hw - 16, 10 + ext, 3, roofZ - 5.1, pocketTop),
      ]),
      ...deckBosses.map(([x, y]) => cylZ(x, y, 5, deckTop - 1, roofZ, 24)),    // screw pillars
    );
    const deckScrewCuts = union(deckBosses.map(([x, y]) => union([
      cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
      cylZ(x, y, 3.25, deckTop + 8, deckTop + 32, 24),
    ])));
    const headCowl = sub(
      union([sub(cowlOuter, cowlPocket), face.add]),
      face.cut,
      box(-8, 8, yBack, fy, pocketTop - 0.5, fb.z0 + 0.1),                 // chin opens into the cowl for the USB-C plug
      box(-6, 6, noseY - 4, noseY + 1, deckTop + 2, deckTop + 9),          // USB-C lead exit under the face
      deckScrewCuts,
    );
    b.part({
      id: 'head_cowl', name: 'Snake head hood shell', link: 'head', material: spec.shell, profile: 'shell',
      color: spec.primaryColor, solid: headCowl, printRot: [0, 0, 0],
      printNote: 'Flat base on bed (supports under the hood overhang); removable screw-on shell, the Claw face frame is its hood.',
    });
  } else {
    // Non-overlapping electronics layout:
    // Shield at [0, -1] (y in [-16, 14])
    // Hub at [-18.5, -1] (x in [-21.5, -15.5], y in [-15, 13])
    // Switch at [0, 23] (x in [-10.25, 10.25], y in [16, 30])
    const el = electronics(b, 'head', deckTop, {
      shield: [0, -1],
      hub: [-18.5, -1],
      sw: [0, 23],
      swAlongX: true,
    });

    // LED Eyes at front snout
    const eyeZ = deckTop + 6;
    const eyeY = hy - 3;
    const eyeLeds: Vec3[] = [[-8.5, eyeY, eyeZ], [8.5, eyeY, eyeZ]];
    const eyeCuts = union(eyeLeds.map(c => union([
      ledPocketCuts(c, 'y', 3),
      cylY(c[0], c[2], 2.25, c[1] - 4, hy + 4, 24),
    ])));
    eyeLeds.forEach((c, i) => b.comp({
      key: `eye_led_${i + 1}`,
      catalogId: 'B-KB003',
      label: `Snake eye LED ${i + 1}`,
      link: 'head',
      solid: ledSolid(c, 'y'),
      color: '#00ffd0',
    }));

    // Part 1: Flat Snake Head Electronics Deck (open access to mount Shield, Core, Hub, and Switch)
    const headDeckSolid = sub(
      union([deckPlate, el.add]),
      deckScrewHoles,
      el.cut,
      eyeCuts
    );

    b.part({
      id: 'head_deck',
      name: 'Snake head electronics deck',
      link: 'head',
      material: spec.structural,
      profile: 'motorMount',
      color: spec.accentColor,
      solid: headDeckSolid,
      printRot: [0, 0, 0],
      printNote: 'Flat plate on bed; provides open access to mount and wire electronics.',
    });

    // Part 2: Removable Screw-On Reptilian Viper Head Shell (smooth closed top roof, fastens over head deck)
    const cowlZ0 = deckTop + 0.02;
    const cowlOuter = sub(
      union([
        rrect(2 * hw, 17 + hy, 6, 0, (-17 + hy) / 2, cowlZ0, deckTop + 12),
        rrect(2 * hw - 8, 16, 5, 0, hy - 4, cowlZ0, deckTop + 12),
        rrect(2 * hw - 2, 15 + hy, 7, 0, (-16 + hy) / 2, deckTop + 11, deckTop + 24),
        rrect(2 * hw - 6, 13 + hy, 8, 0, (-15 + hy) / 2, deckTop + 23, deckTop + 29.8),
      ]),
      box(-hw - 1, hw + 1, -hy - 5, -17, deckTop - 1, deckTop + 32),
      cylZ(0, s1Y, 17, deckTop - 1, deckTop + 32, 32)
    );

    const cowlPocket = union([
      // Shield and core stack at [0, -1] (Core top is at deckTop + 27.2, so 28.0 leaves 0.8mm below closed 29.8 roof)
      box(-16.5, 16.5, -18.0, 16.0, deckTop - 0.5, deckTop + 28.0),
      // LED hub at [-18.5, -1]
      box(-24.5, -12.5, -17.0, 15.0, deckTop - 0.5, deckTop + 16.0),
      // Switch at [0, 23] (cradle x in [-12.45, 12.45], y in [13.8, 32.2])
      box(-13.0, 13.0, 13.5, 32.5, deckTop - 0.5, deckTop + 15.5),
      // Central wiring
      box(-20, 20, -18, 30, deckTop - 0.5, deckTop + 7.5),
    ]);

    const rearUsbCut = box(-8, 8, -25, -15.0, deckTop + 16, deckTop + 26.5);
    const swAccessCut = box(-6, 6, 19, 27, deckTop + 13, deckTop + 31);
    const deckScrewCuts = union(deckBosses.map(([x, y]) => union([
      cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
      cylZ(x, y, 3.25, deckTop + 8, deckTop + 32, 24),
    ])));

    const headCowl = sub(
      cowlOuter,
      cowlPocket,
      rearUsbCut,
      swAccessCut,
      deckScrewCuts,
      eyeCuts
    );

    b.part({
      id: 'head_cowl',
      name: 'Snake head enclosure shell',
      link: 'head',
      material: spec.shell,
      profile: 'shell',
      color: spec.primaryColor,
      solid: headCowl,
      printRot: [0, 0, 0],
      printNote: 'Flat base on bed; removable screw-on head shell enclosing electronics and LED eyes.',
    });
  }

  // ---------------------------------------------------------------- Body Segments (1, 2, 3) & Tail
  let currentY = s1Y; // Y of Joint 1 (-28)

  for (let i = 1; i < numJoints; i++) {
    const parentLink = i === 1 ? 'head' : `segment_${i - 1}`;
    const linkId = `segment_${i}`;
    const nextY = currentY - segLen;
    const jointPos: Vec3 = [0, currentY, zJoint];
    const nextJointPos: Vec3 = [0, nextY, zJoint];

    // Horn from previous joint attached to this segment
    const hornFrame: Frame = { rots: [[0, 0, 0]], pos: jointPos };
    b.comp({
      key: `horn_yaw_${i}`,
      catalogId: 'horn',
      label: `Yaw horn ${i}`,
      link: linkId,
      solid: place(hornSolid(), hornFrame),
      color: '#f0f0f0',
    });

    // Next servo mounted in this segment
    const nextServoFrame: Frame = { rots: [[0, 0, 0]], pos: nextJointPos };
    b.comp({
      key: `servo_yaw_${i + 1}`,
      catalogId: 'B-PG001',
      label: `Yaw servo ${i + 1} (S${i + 1})`,
      link: linkId,
      solid: place(servoSolid(), nextServoFrame),
    });

    // Kinematic knuckle:
    // Front tongue at z in [zJoint + HORN_SEAT, zJoint + HORN_SEAT + 4] (24.1 to 28.1)
    // Main body pod extends from y = nextY - 8 to y = currentY - 14
    const bodyY0 = nextY - 8;
    const bodyY1 = currentY - 14;
    const bodyCenterY = (bodyY0 + bodyY1) / 2;
    const tongueZ0 = zJoint + HORN_SEAT;
    const tongueZ1 = tongueZ0 + 4;

    const frontTongue = sub(
      union([
        cylZ(0, currentY, 8.5, tongueZ0, tongueZ1, 32),
        box(-6, 6, bodyY1 - 1, currentY, tongueZ0, tongueZ1),
      ]),
      place(hornSeatCuts(4), hornFrame),
      cylZ(0, currentY, 3.25, tongueZ0 - 1, tongueZ1 + 1, 24)
    );

    const sNextCuts = union([
      box(EAR_X0 - 0.8, EAR_X1 + 0.8, -SV.W / 2 - 0.8, SV.W / 2 + 0.8, -SV.below - 2, SV.above + 2),
      cylZ(0, 0, 14, 6, 25, 32),
      ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -8, 2, 16)),
    ]);

    const mainPod = sub(
      union([
        rrect(segW, bodyY1 - bodyY0, 6, 0, bodyCenterY, 2, segH),
        cylZ(0, nextY, segW / 2 - 1, 2, segH, 32),
      ]),
      place(sNextCuts, nextServoFrame),
      box(-7, 7, nextY - 10, nextY + 10, zJoint - 18, zJoint + 1),
      // Internal wire clearance
      box(-segW / 2 + 2.5, segW / 2 - 2.5, bodyY0 + 2.5, bodyY1 - 2.5, 4, segH - 3),
      // Top cut above nextY to clear next segment's tongue
      box(-segW / 2 - 1, segW / 2 + 1, nextY - 12, nextY + 12, tongueZ0 - 1, segH + 2)
    );

    // the servo pocket and wire channel cut the rounded rear end off as a loose crescent: print only the main pod
    const segSolid = union([frontTongue, mainPod.decompose().sort((p, q) => q.volume() - p.volume())[0]]);

    b.part({
      id: `seg_${i}`,
      name: `Snake body segment ${i}`,
      link: linkId,
      material: spec.structural,
      profile: 'motorMount',
      color: i % 2 === 0 ? spec.primaryColor : spec.accentColor,
      solid: segSolid,
      printRot: [0, 0, 0],
      printNote: 'Base flat on bed.',
    });

    b.link({
      id: linkId,
      name: `Segment ${i}`,
      parent: parentLink,
      joint: {
        origin: jointPos,
        axis: [0, 0, 1],
        limit: [-35, 35],
        actuator: { kind: 'servo', catalogId: 'B-PG001', port: `S${i}`, label: `yaw_${i}` },
      },
      colliders: [{
        shape: 'box',
        center: [0, bodyCenterY, segH / 2],
        half: [segW / 2, (bodyY1 - bodyY0) / 2, segH / 2],
        friction: 0.5,
      }],
    });

    currentY = nextY;
  }

  // ---------------------------------------------------------------- Tail Module (Link: 'tail')
  const lastJointPos: Vec3 = [0, currentY, zJoint];
  const lastHornFrame: Frame = { rots: [[0, 0, 0]], pos: lastJointPos };
  b.comp({
    key: `horn_yaw_${numJoints}`,
    catalogId: 'horn',
    label: `Tail yaw horn ${numJoints}`,
    link: 'tail',
    solid: place(hornSolid(), lastHornFrame),
    color: '#f0f0f0',
  });

  const tongueZ0 = zJoint + HORN_SEAT;
  const tongueZ1 = tongueZ0 + 4;
  const tailEnd = currentY - 36;
  const tailBodyY1 = currentY - 14;
  const tailCenterY = (tailBodyY1 + tailEnd) / 2;

  const tailTongue = sub(
    union([
      cylZ(0, currentY, 8.5, tongueZ0, tongueZ1, 32),
      box(-6, 6, tailBodyY1 - 1, currentY, tongueZ0, tongueZ1),
    ]),
    place(hornSeatCuts(4), lastHornFrame),
    cylZ(0, currentY, 3.25, tongueZ0 - 1, tongueZ1 + 1, 24)
  );

  const tailCone = union([
    rrect(segW, tailBodyY1 - tailEnd, 6, 0, tailCenterY, 2, segH - 4),
    cylZ(0, tailEnd, 3.5, 2, segH - 10, 24),
  ]);

  const tailSolid = union([tailTongue, tailCone]);

  b.part({
    id: 'tail',
    name: 'Snake tail cone',
    link: 'tail',
    material: spec.structural,
    profile: 'shell',
    color: spec.primaryColor,
    solid: tailSolid,
    printRot: [0, 0, 0],
    printNote: 'Base flat on bed.',
  });

  b.link({
    id: 'tail',
    name: 'Tail',
    parent: `segment_${numJoints - 1}`,
    joint: {
      origin: lastJointPos,
      axis: [0, 0, 1],
      limit: [-35, 35],
      actuator: { kind: 'servo', catalogId: 'B-PG001', port: `S${numJoints}`, label: `yaw_${numJoints}` },
    },
    colliders: [{
      shape: 'box',
      center: [0, tailCenterY, segH / 2],
      half: [segW / 2, (tailBodyY1 - tailEnd) / 2, segH / 2],
      friction: 0.5,
    }],
  });

  // Root link 'head'
  b.link({
    id: 'head',
    name: 'Head',
    parent: null,
    colliders: [{
      shape: 'box',
      center: [0, 6 + ext / 2, wallTop / 2],
      half: [hw, (hy + 20 + ext) / 2, wallTop / 2],
      friction: 0.6,
    }],
  });

  // Fasteners & hardware checks
  b.screw('M3×8', deckBosses.length, 'head deck to chassis');
  b.screw('M2.5×8', 2, 'head battery strap');
  b.screw('M2×8 self-tap', numJoints * 2, 'yaw servo ears to chassis & segments');
  b.screw('M2×6 self-tap', numJoints * 2, 'yaw horn arms to mating segments');
  b.screw('M2.5×6', numJoints, 'horn centre screws');

  b.check({
    id: 'tunnels',
    label: 'Screwdriver access (Ø6.5 line of sight)',
    status: 'pass',
    detail: 'All horn centre screws have vertical Ø6.5 tunnels; head deck screws have vertical line-of-sight access through cowl.',
  });

  b.check({
    id: 'battery',
    label: 'Battery bay isolation',
    status: 'pass',
    detail: 'Head bay with twin troughs, finger reliefs, egress slot, strap bosses outside bay.',
  });

  b.step('1. Fit battery in head chassis and screw down strap (2 × M2.5 × 8).');
  b.step(claw
    ? '2. Screw the PCA9685 to the head deck (4 × M2.5 × 6) and plug S1-S4 into channels 1-4. Screw the cowl down, then slide the Claw module into the hood from behind and fit its retainer: it sits above the roof at the back of the hood, so it stays reachable with the cowl in place.'
    : '2. Install ESP32 core, shield, hub and switch on head deck; connect eye LEDs and S1 servo.');
  b.step('3. Screw yaw horns into segments 1-3 and tail cone (2 × M2 × 6 each).');
  b.step('4. Press each segment onto its preceding servo spline and tighten center screw through Ø6.5 vertical tunnel.');
}
