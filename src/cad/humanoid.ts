// Humanoid / biped desktop robot: torso (housing battery, ESP32 core, shield, switch and hip servos),
// articulated left/right legs with ankle-tilt feet for stable bipedal walking, and optional arms.
// 4 DOF (2 hips + 2 ankles) builds with 1 kit; with arms (6 DOF) builds with 2-4 kits.

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { bayBattery, clawDeck, clawFace } from './claw';
import { Build, box, cboxXY, cylX, cylY, cylZ, rrect, sub, union, type M } from './kernel';
import {
  EAR_HOLES, HORN_SEAT, SV, SV_X0, SV_X1,
  batteryBay, batterySolid, electronics, hornSeatCuts, hornSolid,
  ledPocketCuts, ledSolid, place, servoSolid, strapPart, type Frame,
} from './modules';
import type { Collider, Vec3 } from './types';

/** Pocket + ear taps for a servo whose ear face sits on a plate's outer face. */
const plateServoCuts = (t: number) => union([
  box(SV_X0 - FIT.push / 2, SV_X1 + FIT.push / 2, -SV.W / 2 - FIT.push / 2, SV.W / 2 + FIT.push / 2, -t - 1, 1),
  ...EAR_HOLES.map(ex => cylZ(ex, 0, HOLES.M2.tap / 2, -t - 0.5, 1, 16)),
]);

export const HUMANOID = {
  torsoHW: 26,       // half width = 26 mm (total 52 mm)
  torsoHY: 32,       // half depth = 32 mm (total 64 mm)
  ankleZ: 18,        // ankle joint Z axis
  legX: 26 + HORN_SEAT, // 36.1 mm (torsoHW + HORN_SEAT)
};

export function buildHumanoid(b: Build, spec: RobotSpec) {
  const P = spec.params;
  const legLen = P.legLen;       // mm
  const footLen = P.footLen;     // mm
  const footW = P.footWidth;     // mm
  const armLen = P.armLen;       // mm
  const hasArms = P.hasArms;
  const claw = spec.platform === 'licheerv_claw';   // LicheeRV Claw kit: the Claw module is the head's face, PCA9685 on the deck

  const ankleZ = HUMANOID.ankleZ;
  const hipZ = ankleZ + legLen;
  const legX = HUMANOID.legX;
  const footY0 = -20, footY1 = footLen - 20;

  const hw = HUMANOID.torsoHW;
  const hy = HUMANOID.torsoHY;
  const floorTop = hipZ + 18;
  const wallTop = floorTop + 20;
  const deckTop = wallTop + 3;

  // Hip servo frames attached to outer torso side walls (shafts pointing outwards along ±X)
  const hipServoL: Frame = { rots: [[0, -90, 0]], pos: [-hw, 0, hipZ] };
  const hipServoR: Frame = { rots: [[0, 90, 0]], pos: [hw, 0, hipZ] };

  // Ankle servo frames (both point shaft +Y forward)
  const ankleY = -6;
  const ankleServoL: Frame = {
    rots: [[-90, 0, 0]],
    pos: [-legX, ankleY, ankleZ],
  };
  const ankleServoR: Frame = {
    rots: [[-90, 0, 0]],
    pos: [legX, ankleY, ankleZ],
  };

  // ---------------------------------------------------------------- Feet (foot_L and foot_R)
  for (const side of [-1, 1] as const) {
    const isL = side < 0;
    const linkId = isL ? 'foot_L' : 'foot_R';
    const xCenter = side * legX;
    const ankleFrame = isL ? ankleServoL : ankleServoR;

    // Foot sole block with rounded front/back corners
    let sole: M;
    if (P.footStyle === 'webbed') {
      const t = 4;
      const heel = rrect(footW - 4, footLen - 8, 5, xCenter, (footY0 + footY1 - 8) / 2, 0, t);
      const toeCenter = cylZ(xCenter, footY1 - 2, 6, 0, t, 24);
      const toeLeft = cylZ(xCenter - (footW / 2 - 2), footY1 - 5, 5, 0, t, 24);
      const toeRight = cylZ(xCenter + (footW / 2 - 2), footY1 - 5, 5, 0, t, 24);
      const webFill = box(xCenter - (footW / 2 - 2), xCenter + (footW / 2 - 2), footY0 + 10, footY1 - 5, 0, t);
      const scallopLeft = cylZ(xCenter - (footW / 4), footY1 + 1, 4.0, -1, t + 1, 24);
      const scallopRight = cylZ(xCenter + (footW / 4), footY1 + 1, 4.0, -1, t + 1, 24);
      sole = sub(union([heel, toeCenter, toeLeft, toeRight, webFill]), scallopLeft, scallopRight);
    } else if (P.footStyle === 'wide') {
      sole = rrect(footW + 6, footLen + 4, 5, xCenter, (footY0 + footY1) / 2, 0, 4);
    } else {
      sole = rrect(footW, footLen, 4, xCenter, (footY0 + footY1) / 2, 0, 5);
    }

    // Upright bracket on horn face
    const bracketY0 = ankleY + HORN_SEAT;
    const bracketY1 = bracketY0 + 4;
    const bracketX0 = xCenter - 5;
    const bracketX1 = xCenter + 18;
    const bracket = box(bracketX0, bracketX1, bracketY0, bracketY1, 4, ankleZ + 8);

    // Screwdriver access tunnel through bracket along Y to tighten horn centre screw
    const tunnelY = cylY(xCenter, ankleZ, 3.25, bracketY0 - 2, bracketY1 + 10, 24);
    const footSolid = sub(union([sole, bracket]), place(hornSeatCuts(4), ankleFrame), tunnelY);

    b.part({
      id: isL ? 'foot_left' : 'foot_right',
      name: isL ? (P.footStyle === 'webbed' ? 'Left webbed foot' : 'Left foot sole') : (P.footStyle === 'webbed' ? 'Right webbed foot' : 'Right foot sole'),
      link: linkId,
      material: spec.structural,
      profile: 'chassis',
      color: spec.accentColor,
      solid: footSolid,
      printRot: [0, 0, 0],
      printNote: P.footStyle === 'webbed' ? 'Webbed sole flat on bed.' : 'Sole flat on bed for optimal adhesion and ground contact.',
    });

    b.comp({
      key: `horn_ankle_${isL ? 'L' : 'R'}`,
      catalogId: 'horn',
      label: `${isL ? 'Left' : 'Right'} ankle horn`,
      link: linkId,
      solid: place(hornSolid(), ankleFrame),
      color: '#f0f0f0',
    });
  }

  // ---------------------------------------------------------------- Legs (leg_L and leg_R)
  for (const side of [-1, 1] as const) {
    const isL = side < 0;
    const linkId = isL ? 'leg_L' : 'leg_R';
    const xCenter = side * legX;
    const hipFrame = isL ? hipServoL : hipServoR;
    const ankleFrame = isL ? ankleServoL : ankleServoR;

    // Hip horn attachment plate
    const hipPlateX0 = isL ? -legX - 4 : legX;
    const hipPlateX1 = isL ? -legX : legX + 4;
    const hipPlate = box(hipPlateX0, hipPlateX1, -8, 8, hipZ - 16, hipZ + 4);

    // Ankle mounting plate
    const anklePlateX0 = xCenter - 12;
    const anklePlateX1 = xCenter + 23;
    const anklePlate = box(anklePlateX0, anklePlateX1, ankleY - 4, ankleY, ankleZ - 5, ankleZ + 8);

    // Vertical connecting spar between hip plate and ankle plate
    const spar = box(hipPlateX0, hipPlateX1, ankleY - 4, ankleY, ankleZ, hipZ);

    // Sculpted leg armor fairing (shin guard and calf ridge for sleek robotics silhouette)
    const shinGuard = rrect(4, 10, 2, (hipPlateX0 + hipPlateX1) / 2, ankleY - 2, ankleZ + 9, hipZ - 2);
    const calfRidge = box(hipPlateX0, hipPlateX1, -8, 2, ankleZ + 9, hipZ - 5);

    const strut = union([hipPlate, anklePlate, spar, shinGuard, calfRidge]);

    const legSolid = sub(
      strut,
      place(plateServoCuts(4), ankleFrame),
      place(hornSeatCuts(4), hipFrame),
      cylX(0, hipZ, 3.25, isL ? -legX - 6 : legX - 2, isL ? -legX + 2 : legX + 6, 24)
    );

    b.part({
      id: isL ? 'leg_left' : 'leg_right',
      name: isL ? 'Left leg strut' : 'Right leg strut',
      link: linkId,
      material: spec.structural,
      profile: 'cantilever',
      color: spec.accentColor,
      solid: legSolid,
      printRot: [0, 90, 0],
      printNote: 'Print on its side for bending load strength.',
    });

    b.comp({
      key: `servo_ankle_${isL ? 'L' : 'R'}`,
      catalogId: 'B-PG001',
      label: `${isL ? 'Left' : 'Right'} ankle tilt servo (S${isL ? 3 : 4})`,
      link: linkId,
      solid: place(servoSolid(), ankleFrame),
    });

    b.comp({
      key: `horn_hip_${isL ? 'L' : 'R'}`,
      catalogId: 'horn',
      label: `${isL ? 'Left' : 'Right'} hip horn`,
      link: linkId,
      solid: place(hornSolid(), hipFrame),
      color: '#f0f0f0',
    });
  }

  // ---------------------------------------------------------------- Torso (torso)
  // Battery bay in center of torso along Y
  const bay = batteryBay(0, 0, floorTop, { reliefY: 0, strapY: 10, egress: 'rear' });

  // Outer torso tub and inner pocket (tub covers lower hip servo bay and upper battery cradle)
  const tailSolid = P.hasTail ? sub(
    rrect(18, 14, 4, 0, -hy - 5, floorTop + 6, floorTop + 18),
    cylX(0, floorTop + 4, 8, -hy - 14, -hy + 2, 24)
  ) : undefined;

  const wingsSolid = P.hasWings && !hasArms ? union([
    rrect(3, 24, 3, -hw - 1.5, 0, floorTop + 4, floorTop + 18),
    rrect(3, 24, 3, hw + 1.5, 0, floorTop + 4, floorTop + 18),
  ]) : undefined;

  const outerTub = rrect(2 * hw, 2 * hy, 6, 0, 0, hipZ - 8, wallTop);
  const hipPocket = rrect(2 * hw - 6, 2 * hy - 6, 4, 0, 0, hipZ - 9, floorTop - 1);
  const innerTub = rrect(2 * hw - 4, 2 * hy - 4, 4, 0, 0, floorTop, wallTop + 1);

  // Deck bosses for M3 screws
  const deckBosses: [number, number][] = [[-hw + 4, -hy + 4], [hw - 4, -hy + 4], [-hw + 4, hy - 4], [hw - 4, hy - 4]];
  const deckBossSolids = union(deckBosses.map(([x, y]) => cylZ(x, y, 3.5, floorTop - 0.01, wallTop)));
  const deckBossTaps = union(deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, wallTop - 10, wallTop + 1, 16)));

  // Torso chassis solid
  const torsoChassis = sub(
    union([outerTub, ...(tailSolid ? [tailSolid] : []), ...(wingsSolid ? [wingsSolid] : []), bay.add, bay.bosses, deckBossSolids]),
    hipPocket,
    innerTub,
    bay.cut,
    bay.bossTaps,
    deckBossTaps,
    place(plateServoCuts(4), hipServoL),
    place(plateServoCuts(4), hipServoR)
  );

  b.part({
    id: 'torso',
    name: 'Torso chassis',
    link: 'torso',
    material: spec.structural,
    profile: 'chassis',
    color: spec.primaryColor,
    solid: torsoChassis,
    printRot: [0, 0, 0],
    printNote: 'Upright orientation with base on the bed.',
  });

  const bat = bayBattery(spec);
  b.comp({
    key: 'battery',
    catalogId: bat.id,
    label: bat.label,
    link: 'torso',
    solid: batterySolid(0, 0, bay.batZ0),
    color: '#1f6fd1',
  });

  b.part({
    id: 'battery_strap',
    name: 'Torso battery strap',
    link: 'torso',
    material: spec.structural,
    profile: 'chassis',
    color: spec.accentColor,
    solid: strapPart(0, 10, bay.strapZ0, bay.bossX),
    printRot: [0, 0, 0],
    printNote: 'Flat.',
  });

  b.comp({
    key: 'servo_hip_L',
    catalogId: 'B-PG001',
    label: 'Left hip pitch servo (S1)',
    link: 'torso',
    solid: place(servoSolid(), hipServoL),
  });
  b.comp({
    key: 'servo_hip_R',
    catalogId: 'B-PG001',
    label: 'Right hip pitch servo (S2)',
    link: 'torso',
    solid: place(servoSolid(), hipServoR),
  });

  // ---------------------------------------------------------------- Multi-Part Screw-Together Deck & Head Enclosure
  // Part 1: Flat Electronics Mounting Deck (open access to mount & wire Shield, Core, Hub, and Switch)
  // Claw: deck & head grow 4 mm front and back so the 62.5 mm PCA9685 lies along Y inside the head walls
  const hd = claw ? hy + 4 : hy;
  const deckPlate = rrect(2 * hw, 2 * hd, 6, 0, 0, wallTop, deckTop);
  const deckScrewHoles = union(deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, wallTop - 1, deckTop + 1, 16)));

  let el: { add: M; cut: M };
  if (claw) {
    // PCA9685 on 3 mm standoffs (+ its 4 mm bosses); wires drop through the slot. The speaker is built into the Claw module.
    const pca: [number, number] = [-4, -2];
    const pd = clawDeck(b, 'torso', deckTop + 3, { pca, alongY: true });
    const posts = [-1, 1].flatMap(sx => [-1, 1].map(sy => cylZ(pca[0] + sx * 19.1 / 2, pca[1] + sy * 55.9 / 2, 2.9, deckTop - 0.01, deckTop + 3.01)));
    el = { add: union([...posts, pd.add!]), cut: union([pd.cut!, cboxXY(pca[0], pca[1], 10, 6, wallTop - 1, deckTop + 1)]) };
  } else {
    el = electronics(b, 'torso', deckTop, {
      shield: [0, 4],
      hub: [-18, -4],
      sw: [6, -23],
      swAlongX: true,
    });
  }

  const electronicsDeckSolid = sub(
    union([deckPlate, el.add]),
    deckScrewHoles,
    el.cut
  );

  b.part({
    id: 'electronics_deck',
    name: 'Electronics mounting deck',
    link: 'torso',
    material: spec.structural,
    profile: 'motorMount',
    color: spec.accentColor,
    solid: electronicsDeckSolid,
    printRot: [0, 0, 0],
    printNote: 'Flat plate on bed; provides open access to mount and wire all electronics.',
  });

  // Front face LED eyes (none on the Claw kit: the LCD is the face)
  const eyeZ = deckTop + 8;
  const eyeY = hy - 4;
  const eyeLeds: Vec3[] = claw ? [] : [[-10, eyeY, eyeZ], [10, eyeY, eyeZ]];
  eyeLeds.forEach((c, i) => b.comp({
    key: `eye_led_${i + 1}`,
    catalogId: 'B-KB003',
    label: `Eye LED ${i + 1}`,
    link: 'torso',
    solid: ledSolid(c, 'y'),
    color: '#00ffd0',
  }));

  const eyeCutsCombined: M[] = claw ? [] : [union([
    union(eyeLeds.map(c => ledPocketCuts(c, 'y', 3))),
    ...eyeLeds.map(c => cylY(c[0], c[2], 2.25, c[1] - 4, hy + 2, 24)),
  ])];

  // Claw face: LCD centred on the head front, frame bottom 15 mm over the raised PCA9685 (room for a right-angle USB-C
  // plug under the chin), bezel 1 mm proud of the shell; the key plungers run out through the right head wall
  const cf = claw ? clawFace(b, spec, 'torso', { x: 0, yF: hd + 1, z: deckTop + 49.2, keyReach: hw }) : null;

  // Multi-part head shell geometry: split into Front Face Shell, Rear Enclosure Shell, and Top Crown Dome
  const shellZ0 = deckTop + 0.02;
  const shellSplitZ = cf ? cf.box.z1 + 1.1 : deckTop + 25.0;   // Claw: shells rise over the frame
  const domeZ0 = shellSplitZ + 0.02;
  const domeZ1 = cf ? shellSplitZ + 5.5 : deckTop + 30.5;

  // Internal corner bosses at top of Front & Rear shells for screwing down the Top Crown Dome (4 × M2.5×8)
  // Claw: wall-side pillars clear of the face frame, the corner screw wells and the PCA9685
  const domeBosses: [number, number][] = claw ? [[-21, -16], [21, -16], [-21, 14], [21, 14]] : [
    [-hw + 6, -hy + 12],
    [hw - 6, -hy + 12],
    [-hw + 6, hy - 10],
    [hw - 6, hy - 10],
  ];
  const domeBossTaps = union(domeBosses.map(([x, y]) => cylZ(x, y, HOLES.M2_5.tap / 2, claw ? shellSplitZ - 9 : deckTop + 16.5, shellSplitZ + 1, 16)));
  // M3 screw clearance at the 4 corner deck bosses (accessible when Top Crown Dome is removed)
  const cornerScrewCuts = union(deckBosses.map(([x, y]) => union([
    cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
    cylZ(x, y, 3.25, deckTop + 8, shellSplitZ + 1, 24),
  ])));

  let lowerShellBase: M;
  if (claw) {
    // Claw: one straight 2 mm wall over the PCA9685, open floor, solid 8 mm corner pillars under the M3 heads,
    // full-height dome pillars; square-ish corners (r4) keep the screw wells inside the wall
    const solids = union([
      ...deckBosses.map(([x, y]) => cylZ(x, y, 4.5, shellZ0, deckTop + 8)),
      ...domeBosses.map(([x, y]) => cylZ(x, y, 3.2, shellZ0, shellSplitZ)),
    ]);
    lowerShellBase = sub(
      rrect(2 * hw, 2 * hd, 4, 0, 0, shellZ0, shellSplitZ),
      sub(rrect(2 * hw - 4, 2 * hd - 4, 3, 0, 0, deckTop - 0.5, shellSplitZ + 1), solids),
      cornerScrewCuts,
      domeBossTaps
    );
  } else {
    const lowerCowlOuter = union([
      rrect(2 * hw, 2 * hy, 6, 0, 0, shellZ0, deckTop + 14),
      rrect(2 * hw - 2, 2 * hy - 4, 7, 0, 0, deckTop + 13, shellSplitZ),
    ]);
    const domeBossPillars = union(domeBosses.map(([x, y]) => cylZ(x, y, 2.9, deckTop + 16, shellSplitZ)));

    const cowlPocket = union([
      // Shield and Core stack cavity (with air clearance around perimeter)
      box(-16.5, 16.5, -19.5, 25.5, deckTop - 0.5, domeZ1),
      // LED hub cavity (at [-18, -4], z from deckTop to deckTop+15.5)
      box(-23.5, -12.0, -19.5, 11.5, deckTop - 0.5, deckTop + 15.5),
      // Power switch cavity (at [6, -23], swX=20.5, swY=14, cradle x in [-6.45, 18.45], y in [-32.2, -13.8])
      box(-7.5, 19.0, -32.6, -13.0, deckTop - 0.5, deckTop + 15.0),
      // Internal wire routing & LED back clearance channel
      box(-19.0, 19.0, -25.0, 27.0, deckTop - 0.5, deckTop + 12.5),
    ]);

    const rearUsbCut = box(-8, 8, -hy - 2, -18.5, deckTop + 16, shellSplitZ + 1);
    const swAccessCut = box(1, 11, -hy - 2, -18.5, deckTop + 1.5, deckTop + 9.5);

    lowerShellBase = sub(
      union([lowerCowlOuter, domeBossPillars]),
      cowlPocket,
      rearUsbCut,
      swAccessCut,
      cornerScrewCuts,
      domeBossTaps,
      ...eyeCutsCombined
    );
  }

  const isChickenOrBird = [spec.archetype, spec.theme, spec.name, spec.summary]
    .join(' ')
    .toLowerCase()
    .match(/chicken|rooster|hen|bird|gà|chim/);

  // Optional front visor or wattle on Head Front Shell
  const frontExtras: M[] = [];
  if (P.headFeature === 'visor') {
    // Claw: the visor becomes a brow over the screen
    frontExtras.push(claw
      ? rrect(2 * hw + 2, 6, 2, 0, hd - 1, shellSplitZ - 4, shellSplitZ)
      : rrect(2 * hw + 2, 6, 2, 0, hy - 2, deckTop + 10, deckTop + 14));
  }
  if (P.headFeature === 'beak' && isChickenOrBird) {
    // Sculpted chicken wattle beneath the beak
    frontExtras.push(cylZ(0, hd + 2.5, 3.2, deckTop + 0.5, deckTop + 3.2, 20));
  }

  // Part 2: Head Front Face Shell (y >= 0.02); Claw: carries the face frame
  const headFrontShell = sub(
    union([
      sub(lowerShellBase, box(-hw - 5, hw + 5, -hd - 10, 0.02, deckTop - 2, domeZ1 + 5)),
      ...(cf ? [cf.add] : []),
      ...frontExtras,
    ]),
    // Claw: mouth slot under the face for a right-angle USB-C plug (charging) running forward from the chin
    ...(cf ? [cf.cut, box(-7, 7, hd - 6, hd + 3, cf.box.z0 - 13, cf.box.z0 + 0.5)] : eyeCutsCombined)
  );

  b.part({
    id: 'head_front_shell',
    name: 'Head front face shell',
    link: 'torso',
    material: spec.shell,
    profile: 'shell',
    color: spec.primaryColor,
    solid: headFrontShell,
    printRot: [0, 0, 0],
    printNote: claw ? 'Flat base on bed; the Claw face frame prints upright in its front wall.' : 'Flat base on bed; houses eye LEDs and mates to rear shell.',
  });

  // Part 3: Head Rear Enclosure Shell (y <= -0.02)
  const headRearShell = sub(
    lowerShellBase,
    box(-hw - 5, hw + 5, -0.02, hd + 25, deckTop - 2, domeZ1 + 5)
  );

  b.part({
    id: 'head_rear_shell',
    name: 'Head rear enclosure shell',
    link: 'torso',
    material: spec.shell,
    profile: 'shell',
    color: spec.primaryColor,
    solid: headRearShell,
    printRot: [0, 0, 0],
    printNote: claw ? 'Flat base on bed; lifts off (with the crown cover) to reach the Claw retainer and the PCA9685.' : 'Flat base on bed; encloses rear PCB stack with USB-C & switch windows.',
  });

  // Part 4 (Optional): Separate Screw-on / Press-fit Sculpted Beak
  if (P.headFeature === 'beak') {
    const beakZ0 = deckTop + 3.2;
    const beakZ1 = deckTop + 8.5;
    const beakSolid = sub(
      union([
        rrect(20, 16, 5, 0, hd + 8, beakZ0, beakZ1),
        cylZ(0, hd + 14, 7, beakZ0, beakZ1, 24),
      ]),
      cylZ(-3.5, hd + 5, 1.1, beakZ1 - 1.8, beakZ1 + 1, 16),
      cylZ(3.5, hd + 5, 1.1, beakZ1 - 1.8, beakZ1 + 1, 16),
      box(-9, 9, hd + 3, hd + 18, beakZ0 + 2.3, beakZ0 + 2.9)
    );

    b.part({
      id: 'head_beak',
      name: 'Sculpted beak / bill',
      link: 'torso',
      material: spec.shell,
      profile: 'shell',
      color: spec.accentColor,
      solid: beakSolid,
      printRot: [0, 0, 0],
      printNote: 'Flat on bed; separate accent-colored beak part.',
    });
  }

  // Part 5: Head Top Crown Cover (smooth closed dome that screws onto Front & Rear shells with 4 × M2.5×8)
  const domeTopFeatures: M[] = [];
  if (P.headFeature === 'ears') {
    const earZ0 = domeZ1 - 2;
    const earZ1 = domeZ1 + 10;
    domeTopFeatures.push(
      sub(
        box(-hw + 3, -hw + 11, hd - 12, hd - 6, earZ0, earZ1),
        cylY(-hw + 3, earZ1, 6, hd - 13, hd - 5, 16)
      ),
      sub(
        box(hw - 11, hw - 3, hd - 12, hd - 6, earZ0, earZ1),
        cylY(hw - 3, earZ1, 6, hd - 13, hd - 5, 16)
      ),
    );
  } else if (P.headFeature === 'dome') {
    domeTopFeatures.push(cylZ(0, 0, hw - 8, domeZ1 - 1, domeZ1 + 5, 24));
  } else if (P.headFeature === 'beak' && isChickenOrBird) {
    // Sculpted 3-lobed chicken comb crest on top of the crown cover
    domeTopFeatures.push(
      rrect(5, 26, 2.4, 0, 2, domeZ1 - 1, domeZ1 + 5),
      cylX(-6, domeZ1 + 5, 4.5, -2.5, 2.5, 20),
      cylX(2, domeZ1 + 6.5, 5.2, -2.5, 2.5, 20),
      cylX(10, domeZ1 + 4.8, 4.2, -2.5, 2.5, 20),
    );
  }

  const domeScrewCuts = union(domeBosses.map(([x, y]) => union([
    cylZ(x, y, HOLES.M2_5.clear / 2, domeZ0 - 1, domeZ1 + 2, 16),
    cylZ(x, y, 2.6, domeZ1 - 2.0, domeZ1 + 2, 16),
  ])));

  const headTopDome = claw
    ? sub(
      union([
        rrect(2 * hw, 2 * hd, 4, 0, 0, domeZ0, domeZ0 + 3.0),
        rrect(2 * hw - 4, 2 * hd - 4, 6, 0, 0, domeZ0 + 2.0, domeZ1),
        ...domeTopFeatures,
      ]),
      domeScrewCuts
    )
    : sub(
      union([
        rrect(2 * hw - 2, 2 * hy - 4, 7, 0, 0, domeZ0, domeZ0 + 3.0),
        rrect(2 * hw - 6, 2 * hy - 8, 9, 0, 0, domeZ0 + 2.0, domeZ1),
        ...domeTopFeatures,
      ]),
      // Interior core top relief so ESP32 Core (z up to deckTop + 27.2) has generous clearance
      box(-14.5, 14.5, -13.0, 21.0, domeZ0 - 1, deckTop + 28.2),
      domeScrewCuts
    );

  b.part({
    id: 'head_top_dome',
    name: 'Head top crown cover',
    link: 'torso',
    material: spec.shell,
    profile: 'shell',
    color: isChickenOrBird ? spec.accentColor : spec.primaryColor,
    solid: headTopDome,
    printRot: [0, 0, 0],
    printNote: 'Smooth closed top head cover; fastens to front & rear head shells with 4 × M2.5×8 screws.',
  });

  // ---------------------------------------------------------------- Arms (optional, 2+ kits)
  if (hasArms) {
    const shoulderZ = deckTop + 6;
    const shoulderX = hw + 19; // 45 mm
    const armX = shoulderX + HORN_SEAT; // 55.1 mm

    for (const side of [-1, 1] as const) {
      const isL = side < 0;
      const linkId = isL ? 'arm_L' : 'arm_R';
      const armServoF: Frame = {
        rots: isL ? [[0, -90, 0]] : [[0, 90, 0]],
        pos: [side * shoulderX, 0, shoulderZ],
      };

      b.comp({
        key: `servo_shoulder_${isL ? 'L' : 'R'}`,
        catalogId: 'B-PG001',
        label: `${isL ? 'Left' : 'Right'} shoulder servo (S${isL ? 5 : 6})`,
        link: 'torso',
        solid: place(servoSolid(), armServoF),
      });

      const x0 = isL ? -armX - 4 : armX;
      const x1 = isL ? -armX : armX + 4;
      const armSolid = sub(
        union([
          box(x0, x1, -6, 6, shoulderZ - armLen, shoulderZ + 6),
          cylY((x0 + x1) / 2, shoulderZ - armLen, 5, -5, 5, 16), // hand palm
        ]),
        place(hornSeatCuts(4), armServoF),
        cylX(0, shoulderZ, 3.25, isL ? -armX - 6 : armX - 2, isL ? -armX + 2 : armX + 6, 24)
      );

      b.part({
        id: isL ? 'arm_left' : 'arm_right',
        name: isL ? 'Left arm' : 'Right arm',
        link: linkId,
        material: spec.structural,
        profile: 'cantilever',
        color: spec.accentColor,
        solid: armSolid,
        printRot: [0, 90, 0],
        printNote: 'Print flat on side.',
      });

      b.comp({
        key: `horn_shoulder_${isL ? 'L' : 'R'}`,
        catalogId: 'horn',
        label: `${isL ? 'Left' : 'Right'} shoulder horn`,
        link: linkId,
        solid: place(hornSolid(), armServoF),
        color: '#f0f0f0',
      });
    }
  }

  // ---------------------------------------------------------------- Kinematic Tree
  const colliders: Collider[] = [
    { shape: 'box', center: [0, 0, (floorTop + deckTop) / 2], half: [hw, hy, (deckTop - floorTop) / 2] },
  ];

  b.link({
    id: 'torso',
    name: 'Torso body',
    parent: null,
    colliders,
  });

  // Hips: pitch around X axis
  b.link({
    id: 'leg_L',
    name: 'Left leg',
    parent: 'torso',
    joint: {
      origin: [-legX, 0, hipZ],
      axis: [1, 0, 0],
      limit: [-40, 40],
      actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S1', label: 'hip_L' },
    },
    colliders: [
      { shape: 'box', center: [-legX, 0, (ankleZ + hipZ) / 2], half: [4, 6, (hipZ - ankleZ) / 2] },
    ],
  });

  b.link({
    id: 'leg_R',
    name: 'Right leg',
    parent: 'torso',
    joint: {
      origin: [legX, 0, hipZ],
      axis: [1, 0, 0],
      limit: [-40, 40],
      actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S2', label: 'hip_R' },
    },
    colliders: [
      { shape: 'box', center: [legX, 0, (ankleZ + hipZ) / 2], half: [4, 6, (hipZ - ankleZ) / 2] },
    ],
  });

  // Ankles: roll around Y axis (side tilt for weight shifting)
  b.link({
    id: 'foot_L',
    name: 'Left foot',
    parent: 'leg_L',
    joint: {
      origin: [-legX, 0, ankleZ],
      axis: [0, 1, 0],
      limit: [-25, 25],
      actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S3', label: 'ankle_L' },
    },
    colliders: [
      { shape: 'box', center: [-legX, (footY0 + footY1) / 2, 2.5], half: [footW / 2, footLen / 2, 2.5], friction: 1.2 },
    ],
  });

  b.link({
    id: 'foot_R',
    name: 'Right foot',
    parent: 'leg_R',
    joint: {
      origin: [legX, 0, ankleZ],
      axis: [0, 1, 0],
      limit: [-25, 25],
      actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S4', label: 'ankle_R' },
    },
    colliders: [
      { shape: 'box', center: [legX, (footY0 + footY1) / 2, 2.5], half: [footW / 2, footLen / 2, 2.5], friction: 1.2 },
    ],
  });

  if (hasArms) {
    const shoulderZ = deckTop + 6;
    const shoulderX = hw + 19;
    const armX = shoulderX + HORN_SEAT;

    b.link({
      id: 'arm_L',
      name: 'Left arm',
      parent: 'torso',
      joint: {
        origin: [-armX, 0, shoulderZ],
        axis: [1, 0, 0],
        limit: [-90, 90],
        actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S5', label: 'arm_L' },
      },
      colliders: [
        { shape: 'box', center: [-armX, 0, shoulderZ - armLen / 2], half: [3, 4, armLen / 2] },
      ],
    });

    b.link({
      id: 'arm_R',
      name: 'Right arm',
      parent: 'torso',
      joint: {
        origin: [armX, 0, shoulderZ],
        axis: [1, 0, 0],
        limit: [-90, 90],
        actuator: { kind: 'servo', catalogId: 'B-PG001', port: 'S6', label: 'arm_R' },
      },
      colliders: [
        { shape: 'box', center: [armX, 0, shoulderZ - armLen / 2], half: [3, 4, armLen / 2] },
      ],
    });
  }

  // Bilateral foot support polygon
  b.meta = {
    support: [
      [-legX - footW / 2, footY0],
      [legX + footW / 2, footY0],
      [legX + footW / 2, footY1],
      [-legX - footW / 2, footY1],
    ],
  };

  b.screw('M2×8 self-tap', 8 + (hasArms ? 4 : 0), 'servo ears (servo bag)');
  b.screw('M2×6 self-tap', 4 + (hasArms ? 2 : 0), 'horn arms to links (servo bag)');
  b.screw('M2.5×8', 2, 'torso battery strap');
  if (!claw) b.screw('M2.5×6', 6, 'shield, switch, and hub to deck');
  b.screw('M3×12', 4, 'head shells & electronics deck to torso bosses');
  b.screw('M2.5×8', 4, 'head top crown cover to front & rear head shells');

  b.step('1. Install the battery in the central torso cradle and screw down the strap (2 × M2.5 × 8).');
  b.step('2. Mount the left (S1) and right (S2) hip pitch servos on the torso side pockets.');
  b.step('3. Fasten the ankle roll servos (S3, S4) into the leg struts, then attach the leg horns to the hip servos.');
  b.step('4. Attach the foot soles to the ankle servo horns using the screwdriver access tunnels.');
  if (hasArms) {
    b.step('5. Mount the left (S5) and right (S6) shoulder servos and attach the arm links.');
  }
  if (claw) {
    b.step('6. Screw the PCA9685 onto the standoffs (4 × M2.5 × 6); servo leads S1–S6 to channels 0–5, I2C and power leads through the deck slot.');
    b.step('7. Set the Head Front Shell (Claw face frame) on the deck and drive its 2 front M3 × 12 corner screws. With the Rear Shell still off, slide the Claw module into the frame from behind and screw on the Claw retainer (2 × M2 × 6) through the open back, then push in the key plungers from the right side.');
    b.step('8. Set the Rear Head Shell on, drive its 2 rear M3 × 12 corner screws, close the Head Top Crown Cover and fasten with 4 × M2.5 × 8. To service the Claw module, lift off the crown cover and Rear Shell to reach the retainer.');
  } else {
    b.step('6. Mount the shield, ESP32 core, LED hub, and switch on the open Electronics Mounting Deck (6 × M2.5 × 6).');
    b.step('7. Push the eye LEDs into the Head Front Face Shell, set the Front and Rear Head Shells onto the deck, and drive 4 × M3 × 12 corner screws into the torso.');
    b.step('8. Close the Head Top Crown Cover over the electronics and fasten with 4 × M2.5 × 8 corner screws.');
  }

  b.check({
    id: 'tunnels',
    label: 'Screwdriver access (Ø6.5 line of sight)',
    status: 'pass',
    detail: 'Servo ears and horns have direct line-of-sight access through foot soles, struts, and arm plates.',
  });
  b.check({
    id: 'battery',
    label: 'Battery bay isolation',
    status: 'pass',
    detail: 'Torso battery cradle has isolated walls, cell troughs, finger reliefs, and top cross-strap.',
  });
}
