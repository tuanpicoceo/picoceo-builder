// Quadruped / Robot Dog: horizontal canine chassis housing isolated battery bay,
// ESP32 core, shield, power switch, dual LED eyes, friendly canine snout, ears and tail,
// and 4 articulated walking legs (Front-Left, Front-Right, Rear-Left, Rear-Right).
// 4 DOF (4 hip servos on S1, S2, S3, S4) builds with 1 CyberBrick kit!

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, box, cylX, cylY, cylZ, rrect, sub, union, type M } from './kernel';
import { bayBattery, clawDeck, clawFace, clawFaceBox } from './claw';
import {
  EAR_HOLES, HORN_SEAT, SV, SV_X0, SV_X1,
  batteryBay, batterySolid, electronics, hornSeatCuts, hornSolid,
  ledPocketCuts, ledSolid, place, servoSolid, strapPart, type Frame,
} from './modules';
import type { Collider, Vec3 } from './types';

export const QUADRUPED = {
  torsoHW: 28,       // half width = 28 mm (total 56 mm)
  torsoHY: 52,       // half length = 52 mm (total 104 mm)
  frontY: 34,        // front hip servo Y position
  rearY: 33,         // rear hip servo Y position
  hipZ: 34,          // hip rotation axis height above ground
  legX: 28 + HORN_SEAT, // 38.1 mm (torsoHW + HORN_SEAT)
};

/** Pocket + ear taps for a servo whose ear face sits on a plate's outer face. */
const plateServoCuts = (t: number) => union([
  box(SV_X0 - FIT.push / 2, SV_X1 + FIT.push / 2, -SV.W / 2 - FIT.push / 2, SV.W / 2 + FIT.push / 2, -t - 1, 1),
  ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -t - 0.5, 1, 16)),
]);

export function buildQuadruped(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const pawLen = P.footLen || 30;      // mm
  const pawW = P.footWidth || 22;      // mm

  const hw = QUADRUPED.torsoHW;
  const hy = QUADRUPED.torsoHY;
  const frontY = QUADRUPED.frontY;
  const rearY = QUADRUPED.rearY;
  const hipZ = QUADRUPED.hipZ;
  const legX = QUADRUPED.legX;

  const floorTop = 18;
  const wallTop = floorTop + 20;
  const deckTop = wallTop + 3;
  const headZ0 = wallTop - 2;

  // 4 Hip Servo Frames:
  // FL (Front Left)  -> S1, shaft pointing -X
  // FR (Front Right) -> S2, shaft pointing +X
  // RL (Rear Left)   -> S3, shaft pointing -X
  // RR (Rear Right)  -> S4, shaft pointing +X
  const hipFL: Frame = { rots: [[0, -90, 0]], pos: [-hw, frontY, hipZ] };
  const hipFR: Frame = { rots: [[0, 90, 0]], pos: [hw, frontY, hipZ] };
  const hipRL: Frame = { rots: [[0, -90, 0]], pos: [-hw, -rearY, hipZ] };
  const hipRR: Frame = { rots: [[0, 90, 0]], pos: [hw, -rearY, hipZ] };

  // =========================================================================
  // 1. Canine Torso & Dog Body (Link: 'base')
  // =========================================================================
  b.link({
    id: 'base',
    name: 'Torso',
    parent: null,
    colliders: [{
      shape: 'box',
      half: [hw, hy, (wallTop - floorTop) / 2],
      center: [0, 0, (wallTop + floorTop) / 2],
      friction: 0.5,
    }],
  });

  // Battery bay nestled in belly (y in [-25.6, 25.6])
  const batY = 0;
  const bay = batteryBay(0, batY, floorTop, { reliefY: batY - 14, strapY: batY + 12, egress: 'front' });

  // Main chassis tub with fully closed athletic canine body
  const chassisTub = rrect(2 * hw, 2 * hy, 7, 0, 0, floorTop, wallTop);
  // Interior hollow stops at wallTop so the deck plate remains completely solid and enclosed
  const interiorHollow = rrect(2 * hw - 4, 2 * hy - 4, 5, 0, 0, floorTop, wallTop);

  // Muscular closed canine chest / brisket connecting belly into neck (no open cavities)
  const canineChest = rrect(2 * hw - 2, 22, 8, 0, hy - 4, floorTop, headZ0 + 2);
  // Contoured canine rump / rear flank closing behind rear hips to tail base
  const canineRump = rrect(2 * hw - 2, 16, 7, 0, -hy + 5, floorTop, wallTop + 2);

  // Deck bosses for mounting the electronics
  const deckBosses: [number, number][] = [
    [-hw + 4.5, -hy + 6], [hw - 4.5, -hy + 6],
    [-hw + 4.5, hy - 6], [hw - 4.5, hy - 6],
  ];
  const deckBossSolids = union(deckBosses.map(([x, y]) => cylZ(x, y, 3.5, floorTop - 0.01, wallTop)));
  const deckBossTaps = union(deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, wallTop - 10, wallTop + 1, 16)));

  // Deck plate
  const deckPlate = rrect(2 * hw, 2 * hy - 4, 6, 0, 0, wallTop, deckTop);
  const deckCuts = union([
    cylZ(0, 0, 10, wallTop - 1, deckTop + 1), // wire routing pass-through
    ...deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, wallTop - 1, deckTop + 1, 16)),
  ]);

  // Electronics placements on deck
  // LicheeRV Claw kit: PCA9685 across the deck between the hip servos (bosses on side tabs);
  // the Claw module is the head's face (src/cad/claw.ts), no LED eyes / hub / switch.
  const claw = spec.platform === 'licheerv_claw';
  const pcaY = -13;
  const elec = claw
    ? clawDeck(b, 'base', deckTop, { pca: [0, pcaY] })
    : electronics(b, 'base', deckTop, {
      shield: [0, -2],
      hub: [hw - 9, -2],
      sw: [0, 26],
      swAlongX: false,
    });
  const pcaTabs = claw ? box(-hw - 3.2, hw + 3.2, pcaY - 13, pcaY + 13, wallTop, deckTop) : null;   // board is 62.5 wide

  // Servo mounting pockets cut into chassis side walls for 4 hips
  const servoPockets = union([
    place(plateServoCuts(20), hipFL),
    place(plateServoCuts(20), hipFR),
    place(plateServoCuts(20), hipRL),
    place(plateServoCuts(20), hipRR),
  ]);

  // -------------------------------------------------------------------------
  // Canine Head, Snout, Ears & Tail Features
  // -------------------------------------------------------------------------
  const headZ1 = headZ0 + 26;
  const headY1 = hy + 24;

  // Sculpted head base + muzzle
  const headBase = rrect(36, 32, 8, 0, hy + 6, headZ0, headZ1 - 4);
  const snout = rrect(24, 20, 6, 0, headY1 - 6, headZ0, headZ0 + 14);
  const muzzleNose = cylZ(0, headY1 - 2, 4, headZ0 + 10, headZ0 + 14, 16);

  // Dog Ears (floppy / triangular canine ears on top of head)
  const leftEar = union([
    rrect(8, 14, 3, -19, hy + 4, headZ1 - 8, headZ1 + 4),
    cylY(-19, headZ1 + 4, 4, hy - 3, hy + 11, 16),
  ]);
  const rightEar = union([
    rrect(8, 14, 3, 19, hy + 4, headZ1 - 8, headZ1 + 4),
    cylY(19, headZ1 + 4, 4, hy - 3, hy + 11, 16),
  ]);

  // Dog Tail (playful wagging tail at rear, angled up)
  const tailBaseY = -hy + 2;
  const tailTipY = -hy - 20;
  const tailZ0 = wallTop + 2;
  const tailZ1 = tailZ0 + 16;
  const tail = union([
    cylZ(0, tailBaseY, 3.5, tailZ0 - 2, tailZ0 + 6, 16),
    box(-2.5, 2.5, tailTipY, tailBaseY, tailZ0 + 2, tailZ0 + 7),
    cylY(0, tailZ0 + 10, 3.2, tailTipY, tailBaseY + 2, 16),
    cylZ(0, tailTipY + 2, 3.0, tailZ0 + 8, tailZ1, 16),
  ]);

  // LED eyes pockets (2x B-KB003 RGBW addressable LEDs in canine eye sockets)
  // each pocket opens straight down through the head's underside: the LED pushes up into it (glue), lead back under the head
  const eyeDrop = (x: number) => box(x - 3.4, x + 3.4, hy + 14, hy + 17, headZ0 - 1, headZ0 + 11);
  const eyeL = claw ? null : union([ledPocketCuts([-11, hy + 18, headZ0 + 11], 'y', 3), eyeDrop(-11)]);
  const eyeR = claw ? null : union([ledPocketCuts([11, hy + 18, headZ0 + 11], 'y', 3), eyeDrop(11)]);

  // Claw head: the face frame stands on a neck ahead of the chest, its bottom above the hip servo tops so the
  // retainer screws are reached straight from behind; snout below the screen, ears on the frame's top corners.
  let clawHead: { add: M; cut: M } | null = null;
  if (claw) {
    const fz0 = 52, yF = hy + 24;                                   // frame bottom / front face
    const at = { x: 0, yF, z: fz0 + 0.2 + 3.5 + 21.5 };
    const f = clawFaceBox(at.x, at.yF, at.z);
    const yBack = f.y0 + 2, fy = yF - 1.5;
    const cf = clawFace(b, spec, 'base', at);
    const hw2 = (f.x1 - f.x0) / 2;
    const ear = (sx: number) => union([
      rrect(8, 10, 3, sx * 13, yBack + 6, f.z1 - 1, f.z1 + 9),
      cylY(sx * 13, f.z1 + 9, 4, yBack + 1, yBack + 11, 16),
    ]);
    clawHead = {
      add: union([
        cf.add,
        rrect(2 * hw2, f.y0 + 1 - (hy - 6), 6, 0, (f.y0 + 1 + hy - 6) / 2, headZ0, fz0 - 3),   // neck behind the retainer
        box(f.x0, f.x1, f.y0, yF, headZ0, fz0 + 0.5),                                            // under the frame (retainer ledge)
        rrect(24, 16, 6, 0, yF + 7, headZ0, headZ0 + 12),                                        // snout below the screen
        cylZ(0, yF + 13, 4, headZ0 + 8, headZ0 + 12, 16),
        ear(-1), ear(1),
      ]),
      cut: union([cf.cut, box(-8, 8, yBack, fy, headZ0 - 1, fz0)]),                             // USB-C plug drops through the neck
    };
    b.step('Head: the Claw retainer sits on the ledge behind the face frame; slide it in from behind above the neck and drive both M2 screws straight from the rear (nothing sits behind them). Plug the USB-C cable up through the slot under the chin.');
    b.step('Servo driver: screw the PCA9685 to the deck bosses (headers up), wire SDA / SCL / 3V3 / GND to the Nano header and the battery to its V+ terminal; hip servos on channels S1–S4.');
    b.check({ id: 'platform', label: 'Electronics platform', status: 'pass',
      detail: 'LicheeRV Claw kit: the Nano W + PicoClaw module is the face (240x240 LCD) on a neck ahead of the chest; PCA9685 on the deck, 1S2P 14500 pack in the belly bay powers the servos (the module has its own battery and speaker). Module outline is estimated from Sipeed photos: measure your board before printing.' });
  }

  // Assemble full Torso Solid
  const torsoSolid = sub(
    union([
      chassisTub,
      canineChest,
      canineRump,
      deckPlate,
      bay.add,
      bay.bosses,
      deckBossSolids,
      elec.add,
      pcaTabs,
      ...(clawHead ? [clawHead.add] : [headBase, snout, muzzleNose, leftEar, rightEar]),
      P.hasTail !== false ? tail : null,
    ]),
    interiorHollow,
    bay.cut,
    bay.bossTaps,
    deckCuts,
    deckBossTaps,
    elec.cut,
    servoPockets,
    eyeL,
    eyeR,
    clawHead?.cut ?? null,
  );

  b.part({
    id: 'dog_torso',
    name: 'Robot Dog Body & Head',
    link: 'base',
    material: spec.structural,
    profile: 'chassis',
    color: spec.primaryColor,
    solid: torsoSolid,
    printRot: [0, 0, 0],
    printNote: 'Print upright with chassis belly on bed. Flat bottom for solid adhesion.',
  });

  // Battery strap
  b.part({
    id: 'battery_strap',
    name: 'Battery cross-strap',
    link: 'base',
    material: spec.structural,
    profile: 'shell',
    color: spec.accentColor,
    solid: strapPart(0, batY + 12, bay.strapZ0, bay.bossX),
    printRot: [0, 0, 0],
    printNote: 'Print flat on bed.',
  });

  // Components in Torso
  b.comp({
    key: 'battery',
    catalogId: bayBattery(spec).id,
    label: claw ? bayBattery(spec).label : '2S LiPo battery',
    link: 'base',
    solid: batterySolid(0, batY, bay.batZ0),
    color: '#2a6f97',
  });

  // 4 Hip Servos (B-PG001)
  b.comp({ key: 'servo_hip_FL', catalogId: 'B-PG001', label: 'Front left hip servo', link: 'base', solid: place(servoSolid(), hipFL), color: '#333' });
  b.comp({ key: 'servo_hip_FR', catalogId: 'B-PG001', label: 'Front right hip servo', link: 'base', solid: place(servoSolid(), hipFR), color: '#333' });
  b.comp({ key: 'servo_hip_RL', catalogId: 'B-PG001', label: 'Rear left hip servo', link: 'base', solid: place(servoSolid(), hipRL), color: '#333' });
  b.comp({ key: 'servo_hip_RR', catalogId: 'B-PG001', label: 'Rear right hip servo', link: 'base', solid: place(servoSolid(), hipRR), color: '#333' });

  // LED eyes (none on the Claw kit: the LCD is the face)
  if (!claw) b.comp({ key: 'led_eye_L', catalogId: 'B-KB003', label: 'Left eye LED', link: 'base', solid: ledSolid([-11, hy + 18, headZ0 + 11], 'y'), color: '#f59e0b' });
  if (!claw) b.comp({ key: 'led_eye_R', catalogId: 'B-KB003', label: 'Right eye LED', link: 'base', solid: ledSolid([11, hy + 18, headZ0 + 11], 'y'), color: '#f59e0b' });
  if (!claw) b.step('Eyes: push each LED up into its eye pocket through the slot under the head (a dab of glue holds it) and run the leads back under the chin to the LED hub.');

  // Fasteners
  b.screw('M3x8', 4, 'torso deck to chassis bosses');
  b.screw('M2.5x8', 2, 'battery strap');
  b.screw('M2x6', 8, '4x hip servos into chassis pockets');

  // =========================================================================
  // 2. Four Articulated Canine Walking Legs & Paws
  // =========================================================================
  const legDefs = [
    { id: 'FL', name: 'Front Left', linkId: 'leg_FL', jointId: 'hip_FL', port: 'S1', frame: hipFL, side: -1, isFront: true, posY: frontY },
    { id: 'FR', name: 'Front Right', linkId: 'leg_FR', jointId: 'hip_FR', port: 'S2', frame: hipFR, side: 1, isFront: true, posY: frontY },
    { id: 'RL', name: 'Rear Left', linkId: 'leg_RL', jointId: 'hip_RL', port: 'S3', frame: hipRL, side: -1, isFront: false, posY: -rearY },
    { id: 'RR', name: 'Rear Right', linkId: 'leg_RR', jointId: 'hip_RR', port: 'S4', frame: hipRR, side: 1, isFront: false, posY: -rearY },
  ] as const;

  const pawHalfX = pawW / 2;
  const pawHalfY = pawLen / 2;
  const pawHalfZ = 3.5;

  for (const leg of legDefs) {
    const xCenter = leg.side * legX;
    const jointOrigin: Vec3 = [xCenter, leg.posY, hipZ];
    const pawYCenter = leg.posY + (leg.isFront ? 4 : -4);

    const pawCollider: Collider = {
      shape: 'box',
      half: [pawHalfX, pawHalfY, pawHalfZ],
      center: [xCenter, pawYCenter, pawHalfZ],
      friction: 0.8,
    };

    // Register kinematic link with revolute pitch joint
    b.link({
      id: leg.linkId,
      name: `${leg.name} leg`,
      parent: 'base',
      joint: {
        origin: jointOrigin,
        axis: [1, 0, 0], // pitch rotation (forward/backward swing)
        limit: [-60, 60],
        actuator: { catalogId: 'B-PG001', kind: 'servo', port: leg.port, label: `${leg.name} hip` },
      },
      colliders: [pawCollider],
    });

    // -----------------------------------------------------------------------
    // Upper Thigh Bracket (attaches to horn seat)
    // -----------------------------------------------------------------------
    const thighPlateX0 = leg.side < 0 ? -legX - 4.2 : legX;
    const thighPlateX1 = leg.side < 0 ? -legX : legX + 4.2;
    const thighPlate = box(thighPlateX0, thighPlateX1, leg.posY - 12, leg.posY + 12, hipZ - 12, hipZ + 12);

    // Screwdriver access tunnel for horn center screw
    const tunnelX = cylX(leg.posY, hipZ, 3.25, thighPlateX0 - 2, thighPlateX1 + 2, 24);

    // -----------------------------------------------------------------------
    // Lower Canine Leg Strut (extending from hip down to paw)
    // -----------------------------------------------------------------------
    const pawZ0 = 0;
    const pawZ1 = 7;

    // Athletic canine leg strut
    const legStrut = union([
      box(thighPlateX0, thighPlateX1, leg.posY - 6, leg.posY + 6, pawZ1, hipZ),
      // Knee / hock contouring
      cylY((thighPlateX0 + thighPlateX1) / 2, hipZ - (hipZ - pawZ1) / 2, 5.0, leg.posY - 5, leg.posY + 5, 20),
    ]);

    // -----------------------------------------------------------------------
    // Canine Paw Foot Sole (Stable rounded paw on ground z = 0)
    // -----------------------------------------------------------------------
    const pawSole = union([
      rrect(pawW, pawLen, 6, (thighPlateX0 + thighPlateX1) / 2, pawYCenter, pawZ0, pawZ1),
      // Front toe curvature
      cylZ((thighPlateX0 + thighPlateX1) / 2, pawYCenter + (leg.isFront ? pawLen / 2 - 2 : -(pawLen / 2 - 2)), pawW / 2 - 1, pawZ0, pawZ1, 24),
    ]);

    // Combine Leg Solid with horn seat cuts and screw tunnel
    const legSolid = sub(
      union([thighPlate, legStrut, pawSole]),
      place(hornSeatCuts(5), leg.frame),
      tunnelX,
    );

    b.part({
      id: `leg_${leg.id.toLowerCase()}`,
      name: `${leg.name} Leg & Paw`,
      link: leg.linkId,
      material: spec.structural,
      profile: 'chassis',
      color: spec.accentColor,
      solid: legSolid,
      printRot: [0, 90, 0],
      printNote: 'Print on outer thigh face or sole flat on bed for optimal layer strength.',
    });

    // Horn component
    b.comp({
      key: `horn_${leg.id}`,
      catalogId: 'horn',
      label: `${leg.name} hip horn`,
      link: leg.linkId,
      solid: place(hornSolid(), leg.frame),
      color: '#f0f0f0',
    });

    b.screw('M2x4', 2, `${leg.name} leg to horn`);
  }

  b.meta = {
    support: [
      [-legX, frontY],
      [legX, frontY],
      [legX, -rearY],
      [-legX, -rearY],
    ],
  };

  b.check({
    id: 'tunnels',
    label: 'Screwdriver access (Ø6.5 line of sight)',
    status: 'pass',
    detail: 'Every hip horn centre screw has a horizontal line-of-sight tunnel through the leg thigh bracket; deck screws are vertical with direct access.',
  });
  b.check({
    id: 'battery',
    label: 'Battery bay isolation',
    status: 'pass',
    detail: 'Torso belly cradle has isolated walls, cell troughs, finger reliefs, and top cross-strap.',
  });
}
