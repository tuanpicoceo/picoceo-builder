// Differential-drive rover: chassis tub with open wheel bays, isolated battery bay, electronics deck,
// optional pan-tilt head, TPU tyres, front skid and bumper.

import { FIT, HOLES } from '../catalog/rules';
import type { RobotSpec } from '../design/spec';
import { Build, bb, box, cboxXY, cylX, cylY, cylZ, rrect, sphere, sub, union, type M } from './kernel';
import {
  EAR_HOLES, HORN_SEAT, SV, SV_X0, SV_X1, batteryBay, batterySolid, electronics, hornSeatCuts, hornSolid,
  ledPocketCuts, ledSolid, panTilt, phoneStandModule, place, servoSolid, strapPart, type Frame,
} from './modules';
import type { Collider, Vec3 } from './types';
import { CLAW_MOD, bayBattery, clawDeck, clawFace, type clawFaceBox } from './claw';

const FLOOR_BOT = 8, FLOOR_T = 3;
const Y0 = -15.5;                 // rear face
const BAY_CY = 52.85;             // battery bay centre (inner y 26.5 .. 79.2)
const Y1 = 81.2;                  // front face (= bay front wall)
const HW_FRONT = 23;

/** Free deck area for a composed body's neck (rover frame): between the LED hub and the right deck boss, ahead of the switch. */
export const ROVER_NECK = { x: 2, y: 56, holes: [[-6, 60], [10, 60], [2, 69]] as [number, number][] };
/** On the Claw deck the PCA9685 runs along the centre line to y ≈ 50: the neck goes ahead of it. */
export const CLAW_ROVER_NECK = { x: 0, y: 66, holes: [[-7, 59], [7, 59], [0, 74]] as [number, number][] };

/**
 * `mount` (free-form composer): skip the pan-tilt head and phone stand, cut the neck's lead hole and flange holes into
 * the deck, and leave the deck status LEDs to the composition (`mount.leds` headlights at most).
 */
export function buildRover(b: Build, spec: RobotSpec, mount?: { deckCuts: M[]; leds: number }) {
  const P = spec.params;
  const parts0 = b.parts.length, comps0 = b.comps.length;
  const R = P.wheelDia / 2;
  const W = P.wheelWidth;
  // LicheeRV Claw kit: no DC motor driver on the PicoClaw board, so the drive is always continuous servos on the PCA9685
  const claw = spec.platform === 'licheerv_claw';
  const servoDrive = P.drive === 'B-PG002' || claw;
  if (claw && P.drive === 'B-GM001') b.check({ id: 'drive', label: 'Drive', status: 'warn', detail: 'B-GM001 motors asked for, but there is no motor driver on the PicoClaw board; continuous servos (B-PG002) on the PCA9685 instead.' });
  const floorTop = FLOOR_BOT + FLOOR_T;
  const wallTop = Math.max(floorTop + 20.5, servoDrive ? R + 7 : R + 6.2 + 2.8 + 0.7);
  const deckTop = wallTop + 3;

  // ---------------------------------------------------------------- drive geometry
  const xs = 21;                                  // servo ear face (right side)
  const xm = 40;                                  // motor shaft end face (right side)
  const HW_REAR = servoDrive ? xs : xm - 2;
  const servoF: Frame = { rots: [[0, 0, 90], [0, 90, 0]], pos: [xs, 0, R] };   // S x->+Y, S y->+Z, S z->+X
  const wheelX0 = servoDrive ? xs + HORN_SEAT : xm + 1;
  const outerX = wheelX0 + W;

  // ---------------------------------------------------------------- chassis tub
  const outline = (z0: number, z1: number) => union([
    rrect(2 * HW_REAR, 23.5 - Y0, 4, 0, (Y0 + 23.5) / 2, z0, z1),
    rrect(2 * HW_FRONT, Y1 - 22, 6, 0, (22 + Y1) / 2, z0, z1),
  ]);
  const bay = batteryBay(0, BAY_CY, floorTop, { reliefY: 72, strapY: 46, egress: 'rear' });
  const adds: M[] = [outline(FLOOR_BOT, floorTop), bay.add, bay.bosses];
  const cuts: M[] = [bay.cut, bay.bossTaps];

  // outer walls: front section sides + front; rear wall
  adds.push(
    box(-HW_FRONT, -HW_FRONT + 2, 23.5, Y1, FLOOR_BOT, wallTop), box(HW_FRONT - 2, HW_FRONT, 23.5, Y1, FLOOR_BOT, wallTop),
    box(-HW_FRONT, HW_FRONT, Y1 - 2, Y1, FLOOR_BOT, wallTop),
    box(-HW_REAR, HW_REAR, Y0, Y0 + 2, FLOOR_BOT, wallTop),
  );

  // deck bosses (M3, tapped from the top)
  // Claw: the front pair moves back to y 35 (ahead of the strap) so the phone stand / face mount never sit on a screw head
  const fbY = claw ? 35 : 60;
  const deckBosses: [number, number][] = [...(servoDrive ? [[-4.5, -12], [4.5, -12]] as [number, number][] : [[0, -12]] as [number, number][]), [-19.5, fbY], [19.5, fbY]];
  adds.push(...deckBosses.map(([x, y]) => cylZ(x, y, 3.5, floorTop - 0.01, wallTop)));
  cuts.push(...deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.tap / 2, wallTop - 10, wallTop + 1, 16)));

  // skid bosses under the bay's side gaps (M3 from below)
  const skidY = 70;
  adds.push(...[-1, 1].map(s => cylZ(s * 19.8, skidY, 3.0, FLOOR_BOT, floorTop + 6)));
  cuts.push(...[-1, 1].map(s => cylZ(s * 19.8, skidY, HOLES.M3.tap / 2, FLOOR_BOT - 1, floorTop + 5, 16)));

  // bumper screw holes through the front wall
  if (P.bumper) cuts.push(...[-1, 1].map(s => cylY(s * 19.5, FLOOR_BOT + 7, HOLES.M3.clear / 2, Y1 - 3, Y1 + 1, 16)));

  // drive mounts
  const drive: { left: Frame; right: Frame } | null = servoDrive ? { right: servoF, left: { ...servoF, mirrorX: true } } : null;
  if (servoDrive) {
    // Guide s.6: never trap a horizontal-shaft servo between bulkheads. Two vertical pillars
    // (front + rear) carry the ears, wheel bay open to the side, ear screws driven from outside.
    const c = 0.2;
    for (const s of [-1, 1]) {
      const px0 = s > 0 ? xs - 9 : -xs, px1 = s > 0 ? xs : -xs + 9;
      adds.push(box(px0, px1, -12.5, SV_X0 - c, floorTop - 0.01, R + SV.W / 2));
      adds.push(box(px0, px1, SV_X1 + c, 23.5, floorTop - 0.01, R + SV.W / 2));
      for (const ey of EAR_HOLES) cuts.push(s > 0 ? cylX(ey, R, HOLES.M2.tap / 2, xs - 8, xs + 1, 16) : cylX(ey, R, HOLES.M2.tap / 2, -xs - 1, -xs + 8, 16));
    }
    b.comp({ key: 'servo_R', catalogId: 'B-PG002', label: 'Right drive servo (S2)', link: 'base', solid: place(servoSolid(), drive!.right) });
    b.comp({ key: 'servo_L', catalogId: 'B-PG002', label: 'Left drive servo (S1)', link: 'base', solid: place(servoSolid(), drive!.left) });
    b.comp({ key: 'horn_R', catalogId: 'horn', label: 'Right horn', link: 'wheel_R', solid: place(hornSolid(), drive!.right), color: '#f0f0f0' });
    b.comp({ key: 'horn_L', catalogId: 'horn', label: 'Left horn', link: 'wheel_L', solid: place(hornSolid(), drive!.left), color: '#f0f0f0' });
  } else {
    // B-GM001 in two saddles per side; a printed cap clamps the gearbox (M2.5 into the saddles).
    const hy = 15.5 / 2 + FIT.push / 2, hz = 6 + FIT.push / 2;
    for (const s of [-1, 1]) {
      for (const [a, c] of [[xm - 34, xm - 26], [xm - 12, xm - 4]]) {
        const x0 = s > 0 ? a : -c, x1 = s > 0 ? c : -a;
        adds.push(sub(box(x0, x1, -hy - 3, hy + 3, floorTop - 0.01, R), box(x0 - 1, x1 + 1, -hy, hy, R - hz, R + 1)));
        cuts.push(...[-1, 1].map(t => cylZ((x0 + x1) / 2, t * (hy + 1.5), HOLES.M2_5.tap / 2, R - 8, R + 1, 16)));
      }
      const mot = s > 0 ? box(xm - 38, xm, -7.75, 7.75, R - 6, R + 6) : box(-xm, -xm + 38, -7.75, 7.75, R - 6, R + 6);
      const shaft = sub(s > 0 ? cylX(0, R, 1.5, xm, xm + 10, 24) : cylX(0, R, 1.5, -xm - 10, -xm, 24), box(-60, 60, -3, 3, R + 1.0, R + 3));   // D-shaft, 2.5 across the flat
      b.comp({ key: s > 0 ? 'motor_R' : 'motor_L', catalogId: 'B-GM001', label: s > 0 ? 'Right motor (M2)' : 'Left motor (M1)', link: 'base', solid: union([mot, shaft]) });
      // the D-shaft turns with the wheel's D-bore; it is modelled on the motor body, so the sweep would flag it
      b.allowContact(s > 0 ? 'Wheel R' : 'Wheel L', s > 0 ? 'Right motor (M2)' : 'Left motor (M1)');
      // clamp cap
      const cx0 = s > 0 ? xm - 34 : -(xm - 4), cx1 = s > 0 ? xm - 4 : -(xm - 34);
      const legs = [[xm - 34, xm - 26], [xm - 12, xm - 4]].flatMap(([a, c]) => [-1, 1].map(t => {
        const x0 = s > 0 ? a : -c, x1 = s > 0 ? c : -a;
        return box(x0, x1, t > 0 ? hy : -hy - 3, t > 0 ? hy + 3 : -hy, R, R + hz + 0.01);
      }));
      const cap = sub(union([box(cx0, cx1, -hy - 3, hy + 3, R + hz, R + hz + 2.8), ...legs]),
        ...[[xm - 30], [xm - 8]].flatMap(([xc]) => [-1, 1].map(t => cylZ(s * xc, t * (hy + 1.5), HOLES.M2_5.clear / 2, R - 1, R + 20, 16))));
      b.part({ id: s > 0 ? 'motor_cap_R' : 'motor_cap_L', name: s > 0 ? 'Motor clamp R' : 'Motor clamp L', link: 'base', material: spec.structural, profile: 'motorMount', color: spec.accentColor, solid: cap, printRot: [180, 0, 0], printNote: 'Top face down; legs point up.' });
    }
    b.screw('M2.5×10', 8, 'motor clamps');
  }

  // ---------------------------------------------------------------- chassis solid
  let chassis = sub(union(adds), ...cuts);
  // the bay interior must stay clear; notch the outer side walls where the strap crosses
  chassis = sub(chassis, box(-14.7, 14.7, 26.5, 79.2, floorTop + 3, wallTop + 1),
    box(-HW_FRONT - 1, -HW_FRONT + 2.1, 39.8, 52.2, bay.strapZ0 - 0.2, wallTop + 1), box(HW_FRONT - 2.1, HW_FRONT + 1, 39.8, 52.2, bay.strapZ0 - 0.2, wallTop + 1));
  b.part({ id: 'chassis', name: 'Chassis tub', link: 'base', material: spec.structural, profile: 'chassis', color: spec.primaryColor, solid: chassis, printRot: [0, 0, 0], printNote: 'Floor on the bed, no supports (pillar taps are horizontal Ø1.7 holes: bridge fine).' });

  const bat = bayBattery(spec);
  b.comp({ key: 'battery', catalogId: bat.id, label: bat.label, link: 'base', solid: batterySolid(0, BAY_CY, bay.batZ0), color: '#1f6fd1' });
  b.part({ id: 'strap', name: 'Battery strap', link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor, solid: strapPart(0, 46, bay.strapZ0, bay.bossX), printRot: [0, 0, 0], printNote: 'Flat.' });
  b.screw('M2.5×8', 2, 'battery strap');

  // ---------------------------------------------------------------- skid (front caster)
  const skid = sub(union([
    rrect(2 * 19.8 + 7, 12, 3, 0, skidY, FLOOR_BOT - 3, FLOOR_BOT),
    sub(sphere([0, skidY, FLOOR_BOT - 3], FLOOR_BOT - 3), box(-20, 20, skidY - 20, skidY + 20, FLOOR_BOT - 3, 30)),
  ]), ...[-1, 1].map(s => cylZ(s * 19.8, skidY, HOLES.M3.clear / 2, 0, FLOOR_BOT + 1, 16)));
  b.part({ id: 'skid', name: 'Front skid', link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor, solid: skid, printRot: [180, 0, 0], printNote: 'Flat face down, dome up.' });
  b.screw('M3×8', 2, 'front skid');

  // ---------------------------------------------------------------- deck
  const shieldAt: [number, number] = [0, 4];
  const swAt: [number, number] = [0, 29];
  const hubAt: [number, number] = [-16, 66];
  const deckAdds: M[] = [outline(wallTop, deckTop)];
  const deckCuts: M[] = [
    ...deckBosses.map(([x, y]) => cylZ(x, y, HOLES.M3.clear / 2, wallTop - 1, deckTop + 1, 16)),
    cboxXY(-18, 4, 5, 14, wallTop - 1, deckTop + 1), cboxXY(18, 4, 5, 14, wallTop - 1, deckTop + 1),   // drive leads
  ];
  if (claw) {
    // PCA9685 lying along Y on the centre line (rear bosses clear of the M3 deck screw heads); the speaker is in the module
    // over the board (part of the deck: the board slides in under it), the Claw module is the face (head or dashboard)
    const pcaY = 18.5;
    const pca = clawDeck(b, 'base', deckTop, { pca: [0, pcaY], alongY: true });
    deckAdds.push(pca.add!);
    deckCuts.push(pca.cut!);
  } else {
    const el = electronics(b, 'base', deckTop, { shield: shieldAt, hub: hubAt, sw: swAt, swAlongX: true });
    deckAdds.push(el.add); deckCuts.push(el.cut);
  }

  if (mount) deckCuts.push(...mount.deckCuts);
  const isPhoneStand = !mount && (P.mountType === 'phone_stand' || P.mountType === 'magnetic_mount' || P.hasMagnetPockets ||
    (spec.archetype || '').toLowerCase().includes('phone') || (spec.archetype || '').toLowerCase().includes('stand') ||
    (spec.name || '').toLowerCase().includes('phone') || (spec.theme || '').toLowerCase().includes('phone') ||
    (spec.summary || '').toLowerCase().includes('phone'));

  // Separate screw-on aerodynamic electronics canopy cover (smooth closed roof, fastens over open deck)
  const cowlY1 = isPhoneStand ? 20.0 : 37;
  const cowlZ0 = deckTop + 0.02;
  const cowlOuter = union([
    rrect(2 * HW_REAR, cowlY1 - Y0, 4, 0, (Y0 + cowlY1) / 2, cowlZ0, deckTop + 14),
    rrect(2 * HW_REAR - 4, cowlY1 - Y0 - 4, 6, 0, (Y0 + cowlY1) / 2, deckTop + 13, deckTop + 26),
    rrect(2 * HW_REAR - 8, cowlY1 - Y0 - 8, 8, 0, (Y0 + cowlY1) / 2, deckTop + 25, deckTop + 30.0),
  ]);

  const cowlPocket = union([
    // Shield and Core cavity (Core top is at deckTop + 27.2, so 28.0 gives 0.8mm clearance below closed 30.0 roof)
    box(-16.5, 16.5, -13.0, cowlY1 + 0.5, deckTop - 0.5, deckTop + 28.0),
    // Switch cavity (when cowl extends past switch: switch cradle is x in [-12.45, 12.45], y in [19.8, 38.2])
    ...(isPhoneStand ? [] : [
      box(-13.0, 13.0, 19.5, 38.5, deckTop - 0.5, deckTop + 15.0),
      box(-16.5, 16.5, -13.0, 36.5, deckTop - 0.5, deckTop + 7.5),
    ]),
  ]);

  const rearUsbCut = box(-8, 8, Y0 - 2, -8.0, deckTop + 16, deckTop + 26.0);
  const swAccessCut = box(-6, 6, 25, 33, deckTop + 13, deckTop + 32);
  const rearDeckScrewCuts = union(
    deckBosses.filter(([, y]) => y < cowlY1).map(([x, y]) => union([
      cylZ(x, y, HOLES.M3.clear / 2, deckTop - 1, deckTop + 8, 16),
      cylZ(x, y, 3.25, deckTop + 8, deckTop + 32, 24),
    ]))
  );

  const cowlCuts: M[] = [cowlPocket, rearUsbCut, rearDeckScrewCuts];
  if (!isPhoneStand) cowlCuts.push(swAccessCut);

  // the Claw kit has no shield stack to enclose: the PCA9685 stays open on the deck
  if (!claw) b.part({
    id: 'electronics_cover',
    name: 'Electronics canopy cover',
    link: 'base',
    material: spec.shell,
    profile: 'shell',
    color: spec.primaryColor,
    solid: sub(cowlOuter, ...cowlCuts),
    printRot: [0, 0, 0],
    printNote: 'Flat base on bed; removable screw-on canopy enclosing the ESP32 core and shield.',
  });
  let ledLeft = mount ? Math.min(2, mount.leds) : claw ? 0 : P.leds;   // no addressable LEDs on the Claw kit
  let top = deckTop + 23;
  const yp = claw ? 74 : 62;                      // Claw: pan tower ahead of the PCA9685, on a deck lip past the front wall
  let faceBox: ReturnType<typeof clawFaceBox> | null = null;

  if (isPhoneStand) {
    // Claw: the stand moves forward so its back plate clears the PCA9685 (the dashboard face stands in front of it)
    const stand = phoneStandModule(deckTop, spec, { yBase: claw ? 61 : 42, maxW: 56 });
    deckAdds.push(stand.solid);
    for (const m of stand.magnets) {
      b.comp({
        key: m.key,
        catalogId: m.catalogId,
        label: m.label,
        link: 'base',
        solid: m.solid,
        color: '#c5cbd3',
      });
    }
    b.step('Magnetic Phone Stand: Press-fit two Ø10×2mm neodymium magnets into the backrest pockets (apply a drop of CA glue if necessary). Route phone charging cable through the bottom shelf slot.');
  } else if (P.panTilt && !mount) {
    const pt = panTilt(b, spec, 'base', deckTop, 0, yp, Math.min(2, ledLeft));
    deckAdds.push(pt.tower); deckCuts.push(pt.towerCut);
    if (claw) deckAdds.push(box(-12, 12, Y1 - 2, yp + 13.7, wallTop, deckTop));
    ledLeft -= pt.eyes; top = pt.top;
  }
  if (claw && !mount && (isPhoneStand || !P.panTilt)) {
    // dashboard head: the Claw face stands on two legs at the deck front (USB-C down through the open chin)
    const fz0 = deckTop + 9;
    const cf = clawFace(b, spec, 'base', { x: 0, yF: isPhoneStand ? Y1 + 3 : Y1, z: fz0 + CLAW_MOD.lcdUp + 0.2 + CLAW_MOD.end });
    const f = faceBox = cf.box, yBack = f.y0 + CLAW_MOD.retainer;
    deckAdds.push(cf.add, ...[-1, 1].map(s => box(s > 0 ? f.x1 - 6 : f.x0, s > 0 ? f.x1 : f.x0 + 6, yBack, f.y1, deckTop - 0.01, f.z0 + 0.01)));
    deckCuts.push(cf.cut);
  }
  if (claw) b.check({ id: 'platform', label: 'Electronics platform', status: 'pass',
    detail: `LicheeRV Claw kit: the Nano W + PicoClaw module is the ${faceBox ? 'dashboard' : 'pan-tilt head'} face (240x240 LCD); PCA9685 servo driver on the deck (S1/S2 drive${P.panTilt && !isPhoneStand ? ', S3/S4 pan-tilt' : ''}); 1S2P 14500 pack in the bay powers the servos (the module has its own battery and speaker). Module outline is estimated from Sipeed photos: measure your board before printing.` });
  // headlights in the bumper
  const lights: Vec3[] = [];
  if (P.bumper) {
    const by0 = Y1 + 2, by1 = by0 + 4.5, bz0 = FLOOR_BOT + 1, bz1 = FLOOR_BOT + 13;
    const nHead = Math.min(2, ledLeft);
    for (let i = 0; i < nHead; i++) lights.push([nHead === 1 ? 0 : (i ? 10 : -10), by1, FLOOR_BOT + 7]);
    ledLeft -= nHead;
    const bumper = sub(union([
      rrect(2 * HW_FRONT + 4, 4.5, 2, 0, (by0 + by1) / 2, bz0, bz1),
      ...[-1, 1].map(s => box(s * 19.5 - 3, s * 19.5 + 3, Y1, by0 + 0.01, bz0, bz1)),
    ]), ...[-1, 1].map(s => cylY(s * 19.5, FLOOR_BOT + 7, HOLES.M3.tap / 2, Y1 - 1, by1 - 1, 16)),
      ...lights.map(l => ledPocketCuts(l, 'y', 4.5)));
    b.part({ id: 'bumper', name: 'Bumper', link: 'base', material: 'TPU 95A', profile: 'tire', color: '#333333', solid: bumper, printRot: [90, 0, 0], printNote: 'Back face down (TPU, slow).' });
    b.screw('M3×10', 2, 'bumper through the front wall');
  }
  // remaining LEDs: status lights on the deck rear edge (a mounted composition places its own)
  if (mount) ledLeft = 0;
  const status: Vec3[] = [];
  const rows = [44, 51, 70];
  for (let i = 0; i < ledLeft; i++) status.push([i % 2 ? 19 : 12.5, rows[Math.floor(i / 2)], deckTop]);
  deckCuts.push(...status.map(s => ledPocketCuts(s, 'z', 3)));
  const deck = sub(union(deckAdds), ...deckCuts);
  b.part({ id: 'deck', name: 'Electronics deck', link: 'base', material: spec.structural, profile: 'chassis', color: spec.accentColor, solid: deck, printRot: [0, 0, 0], printNote: claw ? 'Flat; the face frame / pan tower print upright (short bridges).' : P.panTilt ? 'Flat; the pan tower prints upright (top plate is a short bridge).' : 'Flat.' });
  b.screw('M3×8', deckBosses.length, 'deck to chassis');
  [...lights.map(l => ({ c: l, d: 'y' as const })), ...status.map(s => ({ c: s, d: 'z' as const }))]
    .forEach((l, i) => b.comp({ key: `led${i}`, catalogId: 'B-KB003', label: `LED ${i + 1}`, link: 'base', solid: ledSolid(l.c, l.d), color: '#f6f6f6' }));

  // ---------------------------------------------------------------- wheels
  const rimR = P.tpuTires ? R - 3 : R;
  const wheel = (): M => {
    const x0 = wheelX0, x1 = wheelX0 + W;
    const parts: M[] = [
      cylX(0, R, rimR, x0, x0 + 3, 64),
      sub(cylX(0, R, rimR, x0, x1, 64), cylX(0, R, rimR - 2.4, x0 - 1, x1 + 1, 64)),
    ];
    if (P.tpuTires) parts.push(
      sub(cylX(0, R, rimR + 1.2, x0, x0 + 1.2, 64), cylX(0, R, rimR - 1, x0 - 1, x0 + 2, 64)),
      sub(cylX(0, R, rimR + 1.2, x1 - 1.2, x1, 64), cylX(0, R, rimR - 1, x1 - 2, x1 + 1, 64)),
    );
    if (!servoDrive) parts.push(cylX(0, R, 5, x0, xm + 10, 32));
    let w = union(parts);
    if (servoDrive) w = sub(w, place(hornSeatCuts(3), servoF));
    else {
      const bore = sub(cylX(0, R, (3 + FIT.press) / 2, x0 - 1, xm + 11, 24), box(x0 - 2, xm + 12, -5, 5, R + 1.0 + FIT.press, R + 5));
      w = sub(w, bore);
    }
    if (rimR - 2.4 > 26) {
      const rc = (16 + rimR - 2.4) / 2 + 1, rh = Math.min(5, (rimR - 2.4 - 17) / 2 - 1);
      w = sub(w, ...[0, 1, 2, 3, 4].map(k => {
        const a = (k * 72 + 36) * Math.PI / 180;
        return cylX(rc * Math.cos(a), R + rc * Math.sin(a), rh, x0 - 1, x0 + 4, 24);
      }));
    }
    return w;
  };
  const wR = wheel();
  const wL = wR.mirror([1, 0, 0]);
  b.part({ id: 'wheel_R', name: 'Wheel R', link: 'wheel_R', material: spec.structural, profile: 'wheel', color: spec.accentColor, solid: wR, printRot: [0, -90, 0], printNote: 'Hub face down.' });
  b.part({ id: 'wheel_L', name: 'Wheel L', link: 'wheel_L', material: spec.structural, profile: 'wheel', color: spec.accentColor, solid: wL, printRot: [0, 90, 0], printNote: 'Hub face down.' });
  if (P.tpuTires) {
    const tire = sub(cylX(0, R, R, wheelX0 + 1.2, wheelX0 + W - 1.2, 64), cylX(0, R, rimR, wheelX0, wheelX0 + W, 64));
    b.part({ id: 'tire_R', name: 'Tyre R', link: 'wheel_R', material: 'TPU 95A', profile: 'tire', color: '#2b2b2b', solid: tire, printRot: [0, -90, 0], printNote: 'Flat, TPU 95A, 15 % gyroid; stretch over the rim between the lips.' });
    b.part({ id: 'tire_L', name: 'Tyre L', link: 'wheel_L', material: 'TPU 95A', profile: 'tire', color: '#2b2b2b', solid: tire.mirror([1, 0, 0]), printRot: [0, 90, 0], printNote: 'Flat, TPU 95A.' });
  }
  if (servoDrive) { b.screw('M2×8 self-tap', 8, 'drive servo ears into pillars (servo bag)'); b.screw('M2×6 self-tap', 4, 'horn arms to wheel hubs (servo bag)'); }

  // ---------------------------------------------------------------- links (for viewer + physics)
  const mu = P.tpuTires ? 1.1 : 0.6;
  const bodyCol: Collider[] = [
    { shape: 'box', center: [0, (Y0 + Y1) / 2, (FLOOR_BOT + deckTop) / 2], half: [HW_FRONT, (Y1 - Y0) / 2, (deckTop - FLOOR_BOT) / 2], friction: 0.4 },
    { shape: 'ball', center: [0, skidY, FLOOR_BOT - 3], radius: FLOOR_BOT - 3, friction: 0.05 },
  ];
  if (!servoDrive) bodyCol.push({ shape: 'box', center: [0, 0, R], half: [xm, 11, 9], friction: 0.4 });
  if (P.bumper) bodyCol.push({ shape: 'box', center: [0, Y1 + 4.25, FLOOR_BOT + 7], half: [HW_FRONT + 2, 2.25, 6], friction: 0.6 });
  if (P.panTilt && !mount) bodyCol.push({ shape: 'box', center: [0, yp - 8, deckTop + 10], half: [8.5, 18, 10], friction: 0.4 });
  if (faceBox) bodyCol.push({ shape: 'box', center: [0, (faceBox.y0 + faceBox.y1) / 2, (deckTop + faceBox.z1) / 2], half: [faceBox.x1, (faceBox.y1 - faceBox.y0) / 2, (faceBox.z1 - deckTop) / 2], friction: 0.4 });
  b.link({ id: 'base', name: 'Chassis', parent: null, colliders: bodyCol });
  const act = servoDrive
    ? (port: string, label: string) => ({ kind: 'cservo' as const, catalogId: 'B-PG002', port, label })
    : (port: string, label: string) => ({ kind: 'motor' as const, catalogId: 'B-GM001', port, label });
  const wc = wheelX0 + W / 2;
  b.link({ id: 'wheel_L', name: 'Left wheel', parent: 'base', joint: { origin: [-wheelX0, 0, R], axis: [-1, 0, 0], actuator: act(servoDrive ? 'S1' : 'M1', 'left wheel') }, colliders: [{ shape: 'cylX', center: [-wc, 0, R], radius: R, halfLen: W / 2, friction: mu }] });
  b.link({ id: 'wheel_R', name: 'Right wheel', parent: 'base', joint: { origin: [wheelX0, 0, R], axis: [-1, 0, 0], actuator: act(servoDrive ? 'S2' : 'M2', 'right wheel') }, colliders: [{ shape: 'cylX', center: [wc, 0, R], radius: R, halfLen: W / 2, friction: mu }] });

  b.meta = { wheelR: R, trackMm: 2 * wc, support: [[-wc, 0], [wc, 0], [0, skidY]] };

  // ---------------------------------------------------------------- checks + assembly notes
  b.check({ id: 'tunnels', label: 'Screwdriver access (Ø6.5 line of sight)', status: 'pass', detail: servoDrive ? 'Drive-servo ear screws are driven from the open wheel bay before the wheels go on; horn centre screws through Ø6.5 hub tunnels; deck, strap and skid screws are all vertical with open access.' : 'Clamp, deck, strap and skid screws are vertical with open access from above/below.' });
  b.check({ id: 'battery', label: 'Battery bay isolation', status: 'pass', detail: `Bay ${(29.4).toFixed(1)} × ${(52.7).toFixed(1)} mm (+1.0/+1.5 swell), twin troughs R ${(7.6).toFixed(1)}, Ø18 finger reliefs, 10 × 6 egress slot, strap bosses at |x| = ${bay.bossX.toFixed(1)} (outside half-width + 2).` });
  b.check({ id: 'clearance', label: 'Ground clearance', status: FLOOR_BOT - 3 > 3 ? 'pass' : 'warn', detail: `Floor underside ${FLOOR_BOT} mm, skid dome Ø${2 * (FLOOR_BOT - 3)}; wheel Ø${P.wheelDia}.` });
  b.check({ id: 'track', label: 'Track width', status: 'pass', detail: `Wheel centre track ${(2 * wc).toFixed(1)} mm, wheelbase to skid ${skidY} mm, overall width ${(2 * outerX).toFixed(0)} mm.` });

  b.extra(P.tpuTires ? 'TPU 95A filament for tyres' : 'Rubber band / tape tyres (optional)', 1);
  b.step(servoDrive ? '1. Centre the drive servos with `calib` (continuous servos: trim the stop point instead). Lay each servo between its two pillars, shaft out, and drive the two M2 ear screws from the side.' : '1. Lay each B-GM001 in its saddles, shaft out, leads inboard. Fit the clamp caps and tighten 4 × M2.5 per side.');
  b.step('2. Bolt the front skid under the chassis (2 × M3 × 8 from below).');
  if (P.bumper) b.step(claw ? '3. Bolt the TPU bumper to the front wall from inside (2 × M3 × 10).' : '3. Bolt the TPU bumper to the front wall from inside (2 × M3 × 10), push the headlight LEDs into the pockets from behind.');
  b.step('4. Seat the battery in the troughs, lead out through the rear egress slot, and screw the strap down (2 × M2.5 × 8).');
  b.step(claw ? '5. Screw the PCA9685 to its deck bosses (headers up, 4 × M2.5 × 6). Feed the drive leads through the side slots to S1 / S2, wire SDA / SCL / 3V3 / GND to the Nano header and the battery to the PicoClaw board and the PCA9685 V+ terminal.'
    : '5. Mount the shield (core on top, USB-C to the rear), the LED hub and the switch on the deck. Feed the drive leads through the side slots and the battery lead up through the switch cradle.');
  b.step(servoDrive ? '6. Screw a horn into each wheel hub recess, press the wheels onto the splines, and drive the centre screws through the Ø6.5 tunnels.' : '6. Press the wheels onto the D-shafts (a drop of CA if loose).');
  b.step('7. Close the deck onto the chassis with 4 × M3 × 8.');
  void top;
  // Keep-out envelope for a mounted body shell: chassis + deck (+2 mm), canopy, deck parts, wheel arches (+4 mm
  // radial, +3 mm outboard) and 8 mm ground clearance. A composed body minus this wraps the chassis without touching it.
  const keepout = union([
    box(-HW_REAR - 2, HW_REAR + 2, Y0 - 2, 25.5, -1, deckTop + 1),
    box(-HW_FRONT - 2, HW_FRONT + 2, 20, Y1 + 8, -1, deckTop + 1),
    box(-HW_REAR - 2, HW_REAR + 2, Y0 - 2, cowlY1 + 2, deckTop, deckTop + 32),
    box(-HW_FRONT - 2, HW_FRONT + 2, 20, Y1 + 2, deckTop, deckTop + 16),
    ...[-1, 1].map(s => cylX(0, R, R + 4, s > 0 ? wheelX0 - 2 : -(wheelX0 + W + 3), s > 0 ? wheelX0 + W + 3 : -(wheelX0 - 2), 48)),
    box(-500, 500, -500, 500, -50, 8),
    // Claw: everything the chassis put on its deck (PCA9685, module rails) and its components (the drive servos' spline
    // bosses reach past the chassis box), +2 mm
    ...(claw ? [...b.parts.slice(parts0).filter(p => p.link === 'base' && bb(p.solid).max[2] > deckTop + 0.5), ...b.comps.slice(comps0)] : [])
      .map(p => bb(p.solid)).map(q => box(q.min[0] - 2, q.max[0] + 2, q.min[1] - 2, q.max[1] + 2, q.min[2] - 2, q.max[2] + 2)),
  ]);
  return { deckTop, servoDrive, ledsUsed: lights.length, keepout, centre: [0, (Y0 + Y1) / 2] as [number, number] };
}
