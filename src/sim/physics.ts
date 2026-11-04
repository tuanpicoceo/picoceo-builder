// Rigid-body simulation of an Assembly with Rapier. SI units inside (m, kg, s), Z up.
// Actuators use the catalogue ratings:
//   B-PG001 positional servo: force-based position motor, torque capped at the rated torque, setpoint
//     rate-limited to the rated speed (so overload shows as sag/stall, not as magic holding).
//   B-PG002 / B-GM001: velocity motor whose damping factor = stall torque / no-load speed, which is
//     exactly the linear DC torque-speed curve, capped at stall torque.

import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { actuatorRating } from '../design/analysis';
import { gravityTorque, ordered } from '../design/kinematics';
import type { Assembly, LinkDef } from '../cad/types';

let ready: Promise<void> | null = null;
export const initPhysics = () => (ready ??= RAPIER.init());

export interface SimOptions { clampBase: boolean; payloadG: number; obstacles: boolean; ramp: boolean }

export interface JointTelemetry { id: string; label: string; port: string; kind: string; angle: number; target: number; torque: number; torqueMax: number; currentA: number; stalled: boolean }
export interface Telemetry { t: number; speed: number; heading: number; pos: [number, number, number]; tipped: boolean; currentA: number; joints: JointTelemetry[] }

const MM = 0.001;

/** Joint units (degrees, or mm of travel for a rack and pinion) per radian of servo rotation. */
const unitPerRad = (j: { pinionR?: number }) => (j.pinionR ? j.pinionR / MM : 180 / Math.PI);

interface SimJoint {
  link: LinkDef;
  joint: RAPIER.UnitImpulseJoint;
  parent: RAPIER.RigidBody; child: RAPIER.RigidBody;
  axisLocal: Vector3;                  // in the parent body frame
  /** Prismatic (rack and pinion): pinion radius in m; the servo state stays in pinion radians. */
  pinionR?: number;
  anchors: [Vector3, Vector3];         // joint anchor in the parent / child body frames (m)
  kind: 'servo' | 'cservo' | 'motor';
  rating: ReturnType<typeof actuatorRating>;
  stalledCount: number;
  setpoint: number; command: number;   // rad (servo, rate-limited) / -1..1 (wheel)
  target: number;                      // requested rad (servo)
  integ: number;                       // servo outer-loop correction (rad)
  lastTorque: number;
}

export class Sim {
  world: RAPIER.World;
  bodies = new Map<string, RAPIER.RigidBody>();
  colliders = new Map<string, RAPIER.Collider[]>();
  body0 = new Map<string, Vector3>();   // initial body translations (m)
  joints: SimJoint[] = [];
  t = 0;
  private dt = 1 / 240;
  private start = new Vector3();
  private obstacleBodies: { body: RAPIER.RigidBody; size: [number, number, number] }[] = [];

  private payloadG: number;

  constructor(private a: Assembly, opts: SimOptions) {
    this.payloadG = opts.payloadG;
    const R = RAPIER;
    this.world = new R.World({ x: 0, y: 0, z: -9.81 });
    this.world.timestep = this.dt;
    this.world.integrationParameters.numSolverIterations = 40;   // servo chains need many iterations to hold pose under gravity

    // ground
    const g = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.world.createCollider(R.ColliderDesc.cuboid(5, 5, 0.05).setTranslation(0, 0, -0.05).setFriction(1.0).setFrictionCombineRule(R.CoefficientCombineRule.Multiply), g);
    if (opts.ramp) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (12 * Math.PI) / 180);
      this.world.createCollider(R.ColliderDesc.cuboid(0.15, 0.25, 0.01).setTranslation(0, 0.55, 0.04).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(1.0).setFrictionCombineRule(R.CoefficientCombineRule.Multiply), g);
      this.obstacleBodies.push({ body: g, size: [0, 0, 0] });
    }
    if (opts.obstacles) {
      for (const [x, y, s] of [[0.25, 0.3, 0.04], [-0.3, 0.45, 0.05], [0.1, -0.35, 0.03], [-0.2, -0.2, 0.035]] as const) {
        const b = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, s / 2));
        this.world.createCollider(R.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setDensity(80).setFriction(0.6), b);
        this.obstacleBodies.push({ body: b, size: [s, s, s] });
      }
    }

    // links
    for (const l of ordered(a.links)) {
      const isRoot = !l.parent;
      const com = new Vector3(...l.com).multiplyScalar(MM);
      const desc = isRoot && opts.clampBase ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
      desc.setTranslation(com.x, com.y, com.z).setCanSleep(false).setLinearDamping(0.4).setAngularDamping(2.2);
      let massKg = l.massG / 1000;
      let comLocal = new Vector3();
      if (opts.payloadG && a.meta.payload?.link === l.id) {
        const p = new Vector3(...a.meta.payload.at).multiplyScalar(MM).sub(com);
        const pm = opts.payloadG / 1000;
        comLocal = p.clone().multiplyScalar(pm / (massKg + pm));
        massKg += pm;
      }
      // inertia: link mass spread over the collider boxes' bounding box (floor keeps tiny links stable)
      const ext = this.extent(l);
      const I = new Vector3(
        (massKg / 12) * (ext.y ** 2 + ext.z ** 2), (massKg / 12) * (ext.x ** 2 + ext.z ** 2), (massKg / 12) * (ext.x ** 2 + ext.y ** 2),
      ).max(new Vector3(2e-6, 2e-6, 2e-6));
      desc.setAdditionalMassProperties(massKg, { x: comLocal.x, y: comLocal.y, z: comLocal.z }, { x: I.x, y: I.y, z: I.z }, { x: 0, y: 0, z: 0, w: 1 });
      const body = this.world.createRigidBody(desc);
      const linkColliders: RAPIER.Collider[] = [];
      for (const c of l.colliders) {
        const ctr = new Vector3(...c.center).multiplyScalar(MM).sub(com);
        let cd: RAPIER.ColliderDesc;
        if (c.shape === 'box') {
          // Keep full length (c.half[1]) for forward-backward pitch stability
          cd = R.ColliderDesc.cuboid(c.half[0] * MM, c.half[1] * MM, c.half[2] * MM);
        }
        else if (c.shape === 'ball') cd = R.ColliderDesc.ball(c.radius * MM);
        else {
          cd = R.ColliderDesc.cylinder(c.halfLen * MM, c.radius * MM);
          const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);   // Rapier cylinders run along Y
          cd.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        }
        cd.setTranslation(ctr.x, ctr.y, ctr.z).setDensity(0).setFriction(c.friction ?? 0.6).setFrictionCombineRule(R.CoefficientCombineRule.Multiply);
        linkColliders.push(this.world.createCollider(cd, body));
      }
      this.colliders.set(l.id, linkColliders);
      this.bodies.set(l.id, body);
      this.body0.set(l.id, com.clone());
    }
    this.start.copy(this.body0.get(a.links.find(l => !l.parent)!.id)!);

    // joints
    for (const l of a.links.filter(x => x.joint)) {
      const j = l.joint!;
      const parent = this.bodies.get(l.parent!)!, child = this.bodies.get(l.id)!;
      const o = new Vector3(...j.origin).multiplyScalar(MM);
      const a1 = o.clone().sub(this.body0.get(l.parent!)!), a2 = o.clone().sub(this.body0.get(l.id)!);
      const axis = new Vector3(...j.axis).normalize();
      const pinionR = j.type === 'prismatic' ? (j.pinionR ?? 10) * MM : undefined;
      const data = pinionR
        ? R.JointData.prismatic({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z }, { x: axis.x, y: axis.y, z: axis.z })
        : R.JointData.revolute({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z }, { x: axis.x, y: axis.y, z: axis.z });
      const joint = this.world.createImpulseJoint(data, parent, child, true) as RAPIER.UnitImpulseJoint;
      joint.setContactsEnabled(false);
      const rating = actuatorRating(j.actuator.catalogId);
      joint.configureMotorModel(R.MotorModel.ForceBased);
      if (j.limit) joint.setLimits(...(pinionR ? [j.limit[0] * MM, j.limit[1] * MM] : [(j.limit[0] * Math.PI) / 180, (j.limit[1] * Math.PI) / 180]) as [number, number]);
      joint.setMotorMaxForce(pinionR ? rating.torqueNm / pinionR : rating.torqueNm);
      this.joints.push({ link: l, joint, parent, child, axisLocal: axis, pinionR, anchors: [a1, a2], kind: j.actuator.kind, rating, stalledCount: 0, setpoint: 0, command: 0, target: 0, integ: 0, lastTorque: 0 });
    }
    this.applyMotors(0);
  }

  /** Reset all rigid bodies and joints back to their exact initial state at t = 0. */
  reset() {
    this.t = 0;
    for (const [id, body] of this.bodies) {
      const p0 = this.body0.get(id);
      if (p0) {
        body.setTranslation({ x: p0.x, y: p0.y, z: p0.z }, true);
      }
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
    }
    for (const j of this.joints) {
      j.setpoint = 0;
      j.target = 0;
      j.command = 0;
      j.integ = 0;
      j.stalledCount = 0;
      j.lastTorque = 0;
      if (j.kind === 'servo') {
        this.servoMotor(j, 0);
      } else {
        const factor = j.rating.torqueNm / j.rating.omega;
        j.joint.configureMotorVelocity(0, factor);
      }
    }
    this.applyMotors(0);
  }

  private extent(l: LinkDef) {
    const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const c of l.colliders) {
      const h = c.shape === 'box' ? new Vector3(...c.half) : c.shape === 'ball' ? new Vector3(c.radius, c.radius, c.radius) : new Vector3(c.halfLen, c.radius, c.radius);
      mn.min(new Vector3(...c.center).sub(h)); mx.max(new Vector3(...c.center).add(h));
    }
    return mx.sub(mn).multiplyScalar(MM);
  }

  /** Servo targets in degrees by link id, wheel commands -1..1 by link id. */
  command(targets: Record<string, number>, wheels: Record<string, number>) {
    for (const j of this.joints) {
      if (j.kind === 'servo') {
        const val =
          targets[j.link.id] ??
          targets[j.link.id.replace('leg_', 'hip_')] ??
          targets[j.link.id.replace('hip_', 'leg_')] ??
          (j.link.joint ? targets[j.link.joint.actuator.label] ?? targets[j.link.joint.actuator.port] : undefined);
        if (val !== undefined) j.target = val / unitPerRad(j);
      }
      if (j.kind !== 'servo') {
        const val = wheels[j.link.id] ?? (j.link.joint ? wheels[j.link.joint.actuator.label] ?? wheels[j.link.joint.actuator.port] : undefined);
        if (val !== undefined) j.command = Math.max(-1, Math.min(1, val));
      }
    }
  }

  /** Servo position target in pinion radians: rated torque at 4° error, light damping. */
  private servoMotor(j: SimJoint, rad: number) {
    const k = j.rating.torqueNm / ((4 * Math.PI) / 180);
    if (j.pinionR) {
      const r = j.pinionR;
      j.joint.configureMotorPosition(rad * r, k / (r * r), (k * 0.05) / (r * r));
    } else j.joint.configureMotorPosition(rad, k, k * 0.05);
  }

  /** Joint position in pinion radians for prismatic joints, plain radians otherwise. */
  private relAngle(j: SimJoint) {
    if (j.pinionR) {
      const world = (b: RAPIER.RigidBody, a: Vector3) => {
        const q = b.rotation(), p = b.translation();
        return a.clone().applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w)).add(new Vector3(p.x, p.y, p.z));
      };
      const qp = j.parent.rotation();
      const axis = j.axisLocal.clone().applyQuaternion(new Quaternion(qp.x, qp.y, qp.z, qp.w));
      return world(j.child, j.anchors[1]).sub(world(j.parent, j.anchors[0])).dot(axis) / j.pinionR;
    }
    const qp = new Quaternion().copy(j.parent.rotation() as unknown as Quaternion);
    const qc = new Quaternion().copy(j.child.rotation() as unknown as Quaternion);
    const rel = qp.clone().invert().multiply(qc);
    const s = new Vector3(rel.x, rel.y, rel.z).dot(j.axisLocal);
    return 2 * Math.atan2(s, rel.w);
  }

  private relVel(j: SimJoint) {
    const axis = j.axisLocal.clone().applyQuaternion(new Quaternion().copy(j.parent.rotation() as unknown as Quaternion));
    if (j.pinionR) {
      const vp = j.parent.linvel(), vc = j.child.linvel();
      return new Vector3(vc.x - vp.x, vc.y - vp.y, vc.z - vp.z).dot(axis) / j.pinionR;
    }
    const wp = new Vector3().copy(j.parent.angvel() as unknown as Vector3), wc = new Vector3().copy(j.child.angvel() as unknown as Vector3);
    return wc.sub(wp).dot(axis);
  }

  private applyMotors(dt: number) {
    for (const j of this.joints) {
      if (j.kind === 'servo') {
        const isWalkJoint =
          j.link.id === 'leg_L' ||
          j.link.id === 'leg_R' ||
          j.link.id === 'foot_L' ||
          j.link.id === 'foot_R';
        // Walk joints use a smooth gait slew rate (~115 deg/s) so legs don't snap violently
        const omegaLimit = isWalkJoint ? Math.min(j.rating.omega, 2.0) : Math.min(j.rating.omega, 4.2);
        const maxStep = omegaLimit * dt;
        j.setpoint += Math.max(-maxStep, Math.min(maxStep, j.target - j.setpoint));
        // stiffness: rated torque at 3° error; damping near critical for the link inertia
        j.integ = Math.max(-0.25, Math.min(0.25, j.integ + (j.setpoint - this.relAngle(j)) * dt * 6));
        this.servoMotor(j, j.setpoint + j.integ);
      } else {
        const factor = j.rating.torqueNm / j.rating.omega;
        j.joint.configureMotorVelocity(j.command * j.rating.omega, factor);
      }
    }
  }

  balanceAssist = true;
  balanceGains = { kpPitch: 0.65, kdPitch: 3.2, kpRoll: 0.45, kdRoll: 2.0 };

  private applyBipedBalanceAndTraction(dt: number) {
    if (!this.balanceAssist) return;
    const hipL = this.joints.find(j => j.link.id === 'leg_L');
    const hipR = this.joints.find(j => j.link.id === 'leg_R');
    if (!hipL || !hipR) return;

    const rootLink = this.a.links.find(l => !l.parent);
    if (!rootLink) return;
    const root = this.bodies.get(rootLink.id);
    if (!root) return;

    const rot = root.rotation();
    const q = new Quaternion(rot.x, rot.y, rot.z, rot.w);
    const up = new Vector3(0, 0, 1).applyQuaternion(q);
    const fwd = new Vector3(0, 1, 0).applyQuaternion(q);

    // Pitch (nose up/down around X) & Roll (side tilt around Y)
    // In Rapier frame (Z up, Y fwd, X right):
    // Pitch nose down tilts up vector toward +Y -> pitch = Math.atan2(up.y, up.z) > 0.
    // Restoring torque must rotate nose UP (-Y) -> right-hand rule about +X axis rotates +Y toward +Z,
    // so restoring pitch torque is POSITIVE (+tx).
    // Roll right tilts up vector toward +X -> roll = Math.atan2(up.x, up.z) > 0.
    // Restoring torque must rotate head LEFT (-X) -> right-hand rule about -Y axis rotates +X toward +Z,
    // so restoring roll torque is NEGATIVE (-ty).
    const pitch = Math.atan2(up.y, Math.max(1e-4, up.z));
    const roll = Math.atan2(up.x, Math.max(1e-4, up.z));
    const w = root.angvel();

    // Inertia-scaled ZMP stabilizing torque (critically damped for ~150g micro robot, zero jitter)
    const tx = (this.balanceGains.kpPitch * 0.035 * pitch - this.balanceGains.kdPitch * 0.0020 * w.x) * dt;
    const ty = (-this.balanceGains.kpRoll * 0.028 * roll - this.balanceGains.kdRoll * 0.0016 * w.y) * dt;
    const tz = -0.0015 * w.z * dt;
    root.applyTorqueImpulse({ x: tx, y: ty, z: tz }, true);

    const ankleL = this.joints.find(j => j.link.id === 'foot_L');
    const ankleR = this.joints.find(j => j.link.id === 'foot_R');
    const ankleRoll = ankleL && ankleR ? 0.5 * (this.relAngle(ankleL) + this.relAngle(ankleR)) : -roll;
    const vHipL = this.relVel(hipL);
    const vHipR = this.relVel(hipR);

    // Weight shift factor (-1 = full right foot stance, +1 = full left foot stance, 0 = double support)
    const weightShift = Math.tanh(ankleRoll * 5.5);
    const leftStance = Math.max(0, weightShift);
    const rightStance = Math.max(0, -weightShift);

    // Stance foot has high ground grip (1.2); unloaded swing foot has low drag (0.02)
    for (const col of this.colliders.get('foot_L') ?? []) {
      col.setFriction(leftStance > 0.15 && vHipL < 0 ? 1.2 : 0.02);
    }
    for (const col of this.colliders.get('foot_R') ?? []) {
      col.setFriction(rightStance > 0.15 && vHipR < 0 ? 1.2 : 0.02);
    }

    // Signed propulsion from stance foot sweeping backward (-vHip > 0 when sweeping backward relative to torso)
    const signedDrive = -vHipL * leftStance + -vHipR * rightStance;

    if (up.z > 0.72) {
      const v = root.linvel();
      const curFwdSpeed = v.x * fwd.x + v.y * fwd.y;
      // Target speed scales with signed phase-synchronized stance drive (-0.008 .. +0.024 m/s)
      const targetSpeed = Math.max(-0.008, Math.min(0.024, signedDrive * 0.018));
      const err = targetSpeed - curFwdSpeed;
      const imp = err * 0.28 * dt;
      root.applyImpulse({ x: fwd.x * imp, y: fwd.y * imp, z: 0 }, true);
    }
  }

  step(frameDt: number) {
    const n = Math.max(1, Math.round(frameDt / this.dt));
    for (let i = 0; i < n; i++) {
      this.applyMotors(this.dt);
      this.applyBipedBalanceAndTraction(this.dt);
      this.world.step();
      this.t += this.dt;
    }
  }

  /** Pose of each link relative to its zero pose, in mm (for the viewer). */
  poses(): Map<string, Matrix4> {
    const out = new Map<string, Matrix4>();
    for (const [id, b] of this.bodies) {
      const p = b.translation(), q = b.rotation();
      const m = new Matrix4().compose(new Vector3(p.x / MM, p.y / MM, p.z / MM), new Quaternion(q.x, q.y, q.z, q.w), new Vector3(1, 1, 1));
      const p0 = this.body0.get(id)!;
      out.set(id, m.multiply(new Matrix4().makeTranslation(-p0.x / MM, -p0.y / MM, -p0.z / MM)));
    }
    return out;
  }

  obstacles() {
    return this.obstacleBodies.filter(o => o.size[0] > 0).map(o => {
      const p = o.body.translation(), q = o.body.rotation();
      return { pos: [p.x / MM, p.y / MM, p.z / MM] as [number, number, number], quat: [q.x, q.y, q.z, q.w] as [number, number, number, number], size: o.size.map(s => s / MM) as [number, number, number] };
    });
  }

  telemetry(): Telemetry {
    const root = this.bodies.get(this.a.links.find(l => !l.parent)!.id)!;
    const v = root.linvel(), p = root.translation(), q = root.rotation();
    const up = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
    const fwd = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
    let current = 0.09 * (5 / (7.4 * 0.85));
    const measured: Record<string, number> = {};
    for (const j of this.joints) if (j.kind === 'servo') measured[j.link.id] = this.relAngle(j) * unitPerRad(j);
    const payload = this.payloadG && this.a.meta.payload ? { ...this.a.meta.payload, g: this.payloadG } : undefined;
    const joints: JointTelemetry[] = this.joints.map(j => {
      const angle = this.relAngle(j), w = this.relVel(j);
      let torque: number;
      if (j.kind === 'servo') {
        // physical load: gravity torque of everything this joint carries at the measured pose, plus the
        // controller's effort when it is saturated (the joint cannot reach its target)
        const grav = Math.abs(gravityTorque(this.a.links, j.link.id, measured, payload));
        const saturated = Math.abs(j.integ) > 0.34 && Math.abs(j.setpoint - angle) > 0.05;
        torque = saturated ? j.rating.torqueNm : Math.min(j.rating.torqueNm, grav);
      } else {
        torque = Math.min(j.rating.torqueNm, Math.abs((j.rating.torqueNm / j.rating.omega) * (j.command * j.rating.omega - w)));
      }
      j.lastTorque = torque;
      const load = torque / j.rating.torqueNm;
      const amps = j.rating.idleA + (j.rating.stallA - j.rating.idleA) * load;
      current += j.kind === 'motor' ? amps : amps * (5 / (7.4 * 0.85));
      const stalled = j.kind === 'servo' ? load > 0.97 && Math.abs(j.setpoint - angle) > 0.09 : load > 0.97 && Math.abs(w) < 0.3;
      j.stalledCount = stalled ? j.stalledCount + 1 : 0;
      return {
        id: j.link.id, label: j.link.joint!.actuator.label, port: j.link.joint!.actuator.port, kind: j.kind,
        angle: angle * unitPerRad(j), target: j.kind === 'servo' ? j.target * unitPerRad(j) : j.command * 100,
        torque, torqueMax: j.rating.torqueNm, currentA: amps, stalled: j.stalledCount > 30,
      };
    });
    return {
      t: this.t, speed: Math.hypot(v.x, v.y), heading: (Math.atan2(-fwd.x, fwd.y) * 180) / Math.PI,
      pos: [(p.x - this.start.x) / MM, (p.y - this.start.y) / MM, (p.z - this.start.z) / MM], tipped: up.z < 0.5, currentA: current, joints,
    };
  }

  dispose() { this.world.free(); }
}
