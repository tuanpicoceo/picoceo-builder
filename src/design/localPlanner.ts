// Offline planner: keyword rules that map a prompt onto a RobotSpec when no AI backend is configured.
// It is deliberately simple; the AI path handles nuance, refinement and check-driven fixes.

import { checkPromptKitFeasibility, type ComponentDirectory } from '../catalog/components';
import { DEFAULT_BEHAVIORS, behaviorsOf, defaultSpec, mechanismFamily, normalizeSpec, type RobotSpec } from './spec';

const COLORS: Record<string, string> = {
  red: '#e63946', orange: '#ff7a1a', yellow: '#ffd23f', green: '#2bb673', teal: '#22c3a6', cyan: '#2ec4f1',
  blue: '#4f8cff', navy: '#26408b', purple: '#8e5cf0', pink: '#ff6fb5', black: '#2a2a2a', white: '#f4f4f4', grey: '#8a8f98', gray: '#8a8f98',
};

export interface PlanResult { spec: RobotSpec; rationale: string; assumptions: string[]; outOfScope: string[] }

export function localPlan(prompt: string, current?: RobotSpec, kitCount = 1, inventory?: ComponentDirectory): PlanResult {
  const infeasible = checkPromptKitFeasibility(prompt, kitCount, inventory);
  if (infeasible) {
    throw Object.assign(new Error(infeasible), { status: 422 });
  }

  const p = prompt.toLowerCase();
  const has = (...w: string[]) => w.some(x => new RegExp(`\\b${x}`).test(p));
  const notes: string[] = [];
  const out: string[] = [];

  const isQuadrupedConcept =
    has('quadruped', 'dog', 'puppy', 'hound', 'wolf', 'fox', 'cats?\\b', 'kitty', 'kitten', 'lion', 'tiger', 'bear', 'panda', 'horse', 'pony', 'cow', 'bull', 'pig', 'sheep', 'goat', 'deer', 'elk', 'elephant', 'rhino', 'hippo', 'giraffe', 'zebra', 'rabbit', 'bunny', 'turtle', 'tortoise', 'lizard', 'dinosaur', 'triceratops', 'stegosaurus', 'cheetah', 'beast') ||
    p.includes('chó') || p.includes('mèo') || p.includes('4 chân') || p.includes('bốn chân');

  const isBipedConcept =
    has('humanoid', 'biped', 'walk', 'person', 'android', 'otto', 'duck', 'chicken', 'rooster', 'hen', 'chick', 'bird', 'penguin', 'owl', 'eagle', 'parrot', 'ostrich', 'flamingo', 'kangaroo', 't-rex', 'tyrannosaurus', 'raptor', 'alien', 'soldier', 'ninja', 'knight') ||
    p.includes('người') || p.includes('hai chân') || p.includes('2 chân') || p.includes('vịt') || p.includes('gà') || p.includes('chim');

  const isSnakeConcept =
    has('snake', 'serpent', 'viper', 'cobra', 'worm', 'python', 'dragon', 'caterpillar', 'centipede', 'eel') ||
    p.includes('rắn') || p.includes('con ran') || p.includes('con rắn') || p.includes('sâu');

  const isArmConcept =
    has('arm', 'gripper', 'grab', 'pick', 'manipulat', 'claw', 'crane', 'excavator', 'digger', 'loader', 'catapult') ||
    p.includes('cánh tay') || p.includes('tay gắp') || p.includes('cần cẩu');

  const isDeskAgentConcept =
    has('stationary', 'stand', 'ai agent', 'desk agent', 'speaker', 'assistant', 'smart speaker', 'xiaozhi', 'zhaozhi', 'desk stand', 'lamp', 'camera', 'turret') ||
    p.includes('trợ lý') || p.includes('chân đế') || p.includes('loa') || p.includes('đèn bàn');

  const isCompanionConcept =
    has('companion', 'buddy', 'pet', 'desk bot', 'desktop', 'emot', 'face', 'mascot', 'greeter') ||
    p.includes('để bàn') || p.includes('bạn đồng hành');

  const isRoverConcept =
    has('rover', 'car', 'drive', 'wheel', 'explor', 'patrol', 'race', 'tank', 'vehicle', 'scout', 'truck', 'buggy', 'bus', 'tractor', 'kart', 'van', 'jeep') ||
    p.includes('xe') || p.includes('ô tô') || p.includes('bánh xe') || p.includes('xe tăng');

  const isTurntableConcept =
    has('turntable', 'rotating table', 'rotary', 'platter', 'scanner stand', '360') ||
    p.includes('bàn xoay') || p.includes('xoay 360');

  const isFeederConcept =
    has('feeder', 'pet feeder', 'food dispenser', 'dispenser', 'treat') ||
    p.includes('máy cho ăn') || p.includes('cấp thức ăn') || p.includes('thức ăn tự động');

  const isGateConcept =
    has('gate', 'barrier', 'boom barrier', 'turnstile', 'barrier gate') ||
    p.includes('thanh chắn') || p.includes('barrier') || p.includes('cổng tự động');

  const isCraneConcept =
    has('crane', 'hoist', 'winch', 'digger', 'excavator') ||
    p.includes('cần cẩu') || p.includes('xe cẩu') || p.includes('máy xúc');

  const isCatapultConcept =
    has('catapult', 'trebuchet', 'launcher', 'ball thrower') ||
    p.includes('bắn đá') || p.includes('máy phóng');

  const isFanConcept =
    has('fan', 'oscillating fan', 'smart fan', 'blower') ||
    p.includes('quạt') || p.includes('quạt xoay');

  const isMachineConcept =
    has('machine', 'device', 'automation', 'conveyor', 'sorter', 'mechanism', 'gadget') ||
    p.includes('máy') || p.includes('thiết bị') || p.includes('tự động');

  // Mechanism builders (lever / rotor / linear / SCARA): see docs/CAD_BUILDERS.md
  const mechanismArchetype =
    has('scara', 'plotter', 'drawing robot', 'drawbot', 'draws? ', 'sketch', 'handwriting') || p.includes('robot vẽ') ? 'scara_plotter'
      : has('forklift') || p.includes('xe nâng') ? 'forklift'
        : has('elevator', 'lift platform', 'lifting platform', 'vertical lift', 'scissor lift') || p.includes('thang máy') ? 'lift'
          : has('camera slider', 'camera dolly', 'dolly') ? 'camera_slider'
            : has('linear actuator', 'linear slider', 'linear rail', 'slider', 'sliding door', 'drawer', 'curtain', 'syringe', 'shuttle') || p.includes('ray trượt') ? 'linear_actuator'
              : has('windmill', 'wind turbine') || p.includes('cối xay gió') ? 'windmill'
                : has('ferris') || p.includes('đu quay') ? 'ferris_wheel'
                  : has('water ?wheel', 'paddle ?wheel') ? 'paddle_wheel'
                    : has('flag', 'semaphore') ? 'flag_waver'
                      : has('flipper', 'pinball', 'whack', 'hammer', 'wiper', 'metronome') ? 'flipper'
                        : has('railway crossing', 'level crossing', 'drawbridge') ? 'barrier_gate'
                          : undefined;

  let archetype: string | undefined =
    mechanismArchetype ? mechanismArchetype
    : isTurntableConcept ? 'turntable'
      : isFeederConcept ? 'pet_feeder'
        : isGateConcept ? 'barrier_gate'
          : isCraneConcept ? 'crane'
            : isCatapultConcept ? 'catapult'
              : isFanConcept ? 'smart_fan'
                : isSnakeConcept ? 'snake'
                  : has('duck', 'quack') || p.includes('vịt') || p.includes('con vịt') ? 'duck'
                    : has('chicken', 'rooster', 'hen', 'chick') || p.includes('gà') || p.includes('con gà') ? 'chicken'
                      : isQuadrupedConcept ? 'quadruped'
                        : isBipedConcept ? 'humanoid'
                          : isArmConcept ? 'arm'
                            : isDeskAgentConcept ? 'desk_agent'
                              : isCompanionConcept ? 'companion'
                                : isRoverConcept ? 'rover'
                                  : isMachineConcept ? 'custom_machine' : undefined;
  const refine = !!current && !archetype;
  if (!archetype) {
    archetype = current?.archetype ?? (p.includes('xe') || p.includes('wheel') ? 'rover' : 'custom_machine');
    if (!current) notes.push(`Autonomous engine: architecting custom ${archetype.replace(/_/g, ' ')} using components in your Directory.`);
  }
  const base = current && current.archetype === archetype ? structuredClone(current) : defaultSpec(archetype);
  const P = base.params;

  if (archetype === 'turntable' || isTurntableConcept) {
    base.theme = P.theme = 'classic';
    base.name = '360 Turntable';
    base.primaryColor = '#6366f1';
    base.accentColor = '#e0e7ff';
    P.panTilt = true;
    notes.push('360° Rotating Turntable: high-stability weighted platform driven by continuous/precision servo with status LED ring.');
  }

  if (archetype === 'pet_feeder' || isFeederConcept) {
    base.theme = P.theme = 'classic';
    base.name = 'Smart Pet Feeder';
    base.primaryColor = '#0284c7';
    base.accentColor = '#f0f9ff';
    notes.push('Smart Pet Food Dispenser: 6-cell carousel tray on a continuous servo; `index` advances one portion per cell.');
  }

  if (archetype === 'barrier_gate' || isGateConcept) {
    base.theme = P.theme = 'classic';
    base.name = 'Smart Barrier Gate';
    base.primaryColor = '#e11d48';
    base.accentColor = '#ffffff';
    notes.push('Smart Boom Barrier Gate: one servo swings a striped boom from level to upright on a ribbed pillar; warning LEDs on the deck.');
  }

  if (archetype === 'crane' || isCraneConcept) {
    base.theme = P.theme = 'industrial';
    base.name = 'Robotic Crane';
    base.primaryColor = '#f59e0b';
    base.accentColor = '#1e293b';
    P.upperLen = 90;
    P.foreLen = 85;
    P.gripperLen = 32;
    notes.push('Articulated desktop crane: multi-link boom with high-torque gear servos and lifting gripper.');
  }

  if (archetype === 'catapult' || isCatapultConcept) {
    base.theme = P.theme = 'mechanical';
    base.name = 'Mechanical Catapult';
    base.primaryColor = '#854d0e';
    base.accentColor = '#fef08a';
    notes.push('Lever catapult: a servo flings a cup arm from -15° to 80° on a ribbed pillar; `launch` runs one shot.');
  }

  const num0 = (re: RegExp) => { const m = p.match(re); return m ? parseFloat(m[1]) : undefined; };
  if (archetype === 'scara_plotter') notes.push('SCARA drawing arm: shoulder + elbow servos on vertical axes (no gravity load), Ø10 pen holder.');
  if (archetype === 'lift' || archetype === 'forklift' || archetype === 'camera_slider' || archetype === 'linear_actuator') {
    const st = num0(/(\d+(?:\.\d+)?)\s*mm\s*(?:of\s*)?(?:stroke|travel|lift)/) ?? num0(/(?:stroke|travel|lift)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/);
    if (st) P.stroke = st;
    notes.push(`Rack-and-pinion ${P.linearOrient} axis: a servo-driven module-1.5 pinion moves the carriage along a T-rail (stroke ≈ π × pitch radius).`);
  }
  if (archetype === 'windmill' || archetype === 'ferris_wheel' || archetype === 'paddle_wheel' || archetype === 'smart_fan')
    notes.push(`${P.rotorStyle} rotor Ø${P.rotorDia} on a continuous servo, pillar sized to clear the deck and electronics cover.`);
  if (archetype === 'flag_waver' || archetype === 'flipper') notes.push(`One-servo lever with a ${P.leverTool} end.`);

  if (archetype === 'desk_agent' || archetype === 'stationary' || has('stationary', 'stand', 'ai agent', 'desk agent', 'xiaozhi', 'zhaozhi', 'speaker') || p.includes('trợ lý')) {
    base.theme = P.theme = 'classic';
    base.name = has('xiaozhi', 'zhaozhi') ? 'XiaoZhi AI Stand' : 'Desk AI Agent';
    base.primaryColor = '#00b4d8';
    base.accentColor = '#f4f4f4';
    P.panTilt = true;
    notes.push('Stationary AI Desk Agent: weighted desk base with acoustic speaker chamber, USB-C pass-through, and expressive pan-tilt head.');
  }

  if (archetype === 'snake' || has('snake', 'serpent', 'viper', 'cobra') || p.includes('rắn') || p.includes('con ran')) {
    base.theme = P.theme = 'snake';
    base.name = 'CyberSnake';
    base.primaryColor = '#2bb673';
    base.accentColor = '#ffd23f';
    notes.push('Snake robot: 4 articulated yaw servo segments with streamlined snake head cowl and LED eyes for sinuous serpentine locomotion.');
  }

  const num = (re: RegExp) => { const m = p.match(re); return m ? parseFloat(m[1]) : undefined; };
  if (archetype === 'rover') {
    const wd = num(/(\d+(?:\.\d+)?)\s*mm\s*(?:diameter\s*)?wheels?/) ?? num(/wheels?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/);
    if (wd) P.wheelDia = wd;
    else if (has('big wheel', 'large wheel', 'off.?road', 'rough', 'all.?terrain')) { P.wheelDia = 80; P.wheelWidth = 20; notes.push('Rough terrain: Ø80 × 20 wheels for clearance and grip.'); }
    else if (has('small', 'tiny', 'compact', 'mini')) { P.wheelDia = 48; notes.push('Compact: Ø48 wheels.'); }
    if (has('fast', 'speed', 'race', 'quick', 'strong', 'push', 'climb')) { P.drive = 'B-GM001'; notes.push('Speed/torque requested: B-GM001 geared motors (motor pins must be verified).'); }
    if (has('servo drive', 'precise', 'slow', 'quiet')) P.drive = 'B-PG002';
    if (has('camera', 'head', 'look', 'pan', 'tilt', 'eyes', 'sensor', 'turret')) { P.panTilt = true; notes.push('Pan-tilt head on S3/S4.'); }
    if (has('no bumper')) P.bumper = false; else if (has('bumper', 'crash', 'collision')) P.bumper = true;
    if (has('no tpu', 'without tpu', 'pla only')) P.tpuTires = false;
  }
  if (archetype === 'arm') {
    const pg = num(/(\d+(?:\.\d+)?)\s*(?:g|gram)/);
    if (pg !== undefined) P.payloadG = pg;
    const reach = num(/reach\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/) ?? num(/(\d+(?:\.\d+)?)\s*mm\s*reach/);
    if (reach) { P.upperLen = P.foreLen = Math.round(reach / 2); notes.push(`Reach ${reach} mm split evenly between the links.`); }
    else if (has('long', 'far', 'big')) { P.upperLen = 90; P.foreLen = 90; }
    else if (has('short', 'compact', 'small', 'strong', 'heavy')) { P.upperLen = 50; P.foreLen = 55; }
    if (has('wide grip', 'big grip', 'large object')) P.gripperLen = 38;
  }
  if (archetype === 'companion') {
    if (has('big head', 'large head')) P.headWidth = 56;
    if (has('small head')) P.headWidth = 40;
  }
  // Themed aesthetic shapes (offline fallback heuristic)
  if (has('chicken', 'rooster', 'hen', 'chick') || p.includes('gà') || p.includes('con gà')) {
    base.theme = P.theme = 'chicken';
    base.name = 'RoosterBot';
    base.primaryColor = '#f4f4f4';
    base.accentColor = '#e63946';
    P.headFeature = 'beak';
    P.footStyle = 'wide';
    P.hasTail = true;
    P.hasWings = true;
    notes.push('Chicken theme: multi-part screwed head enclosure with sculpted beak, wattle, 3-lobed crown comb, side wings, tail feathers, and stability feet.');
  } else if (has('duck', 'quack', 'bird', 'beak', 'bill')) {
    base.theme = P.theme = 'duck';
    base.name = 'DuckBot';
    base.primaryColor = '#ffd23f';
    base.accentColor = '#ff7a1a';
    P.headFeature = 'beak';
    P.footStyle = 'webbed';
    P.hasTail = true;
    P.hasWings = true;
    notes.push('Duck theme: shaped duck bill, webbed flipper feet, upturned tail, and duck yellow/orange styling.');
  } else if (has('frog', 'toad')) {
    base.theme = P.theme = 'frog';
    base.name = 'FrogBot';
    base.primaryColor = '#2bb673';
    base.accentColor = '#ffd23f';
    P.footStyle = 'webbed';
    notes.push('Frog theme: green & yellow styling with webbed feet.');
  } else if (has('penguin')) {
    base.theme = P.theme = 'penguin';
    base.name = 'PenguinBot';
    base.primaryColor = '#2a2a2a';
    base.accentColor = '#ff7a1a';
    P.headFeature = 'beak';
    P.footStyle = 'webbed';
    P.hasWings = true;
    notes.push('Penguin theme: black & white/orange styling with waddling gait.');
  } else if (has('cat', 'kitty', 'kitten')) {
    base.theme = P.theme = 'cat';
    base.name = 'KittyBot';
    base.primaryColor = '#ff7a1a';
    base.accentColor = '#f4f4f4';
    P.headFeature = 'ears';
    P.hasTail = true;
    notes.push('Cat theme: ginger styling with pointed ears and tail.');
  }

  if (archetype === 'quadruped' || (isQuadrupedConcept && !mechanismFamily(archetype))) {
    base.archetype = 'quadruped';
    P.headFeature = 'ears';
    P.hasTail = true;
    P.hasWings = false;
    P.hasArms = false;
    P.footStyle = 'standard';
    P.legLen = 46;
    P.footLen = 30;
    P.footWidth = 22;

    if (has('elephant')) {
      base.theme = 'elephant';
      base.name = 'RoboElephant';
      base.primaryColor = '#6b7280';
      base.accentColor = '#9ca3af';
      P.headFeature = 'ears';
      notes.push('Quadruped elephant: broad stable stance, trunk snout, fan ears and tail.');
    } else if (has('tiger', 'lion', 'cheetah')) {
      base.theme = 'tiger';
      base.name = 'RoboTiger';
      base.primaryColor = '#ea580c';
      base.accentColor = '#1f2937';
      notes.push('Quadruped big cat: sleek predatory stance, pointed ears and tail.');
    } else if (has('bear', 'panda')) {
      base.theme = 'bear';
      base.name = has('panda') ? 'RoboPanda' : 'RoboBear';
      base.primaryColor = has('panda') ? '#18181b' : '#78350f';
      base.accentColor = has('panda') ? '#f4f4f5' : '#fbbf24';
      notes.push('Quadruped bear: powerful stable frame, rounded ears and short tail.');
    } else if (has('horse', 'pony', 'zebra')) {
      base.theme = 'horse';
      base.name = 'RoboHorse';
      base.primaryColor = '#92400e';
      base.accentColor = '#fde68a';
      notes.push('Quadruped equine: tall athletic legs, upright ears and tail.');
    } else if (has('dinosaur', 'triceratops', 'stegosaurus')) {
      base.theme = 'dinosaur';
      base.name = 'DinoBot';
      base.primaryColor = '#15803d';
      base.accentColor = '#ca8a04';
      notes.push('Quadruped dinosaur: sturdy low-slung stance with protective tail.');
    } else if (has('turtle', 'tortoise')) {
      base.theme = 'turtle';
      base.name = 'TurtleBot';
      base.primaryColor = '#166534';
      base.accentColor = '#84cc16';
      P.footWidth = 28;
      notes.push('Quadruped turtle: wide stable footing and carapace frame.');
    } else if (has('cat', 'kitty', 'kitten') || p.includes('mèo')) {
      base.theme = 'cat';
      base.name = 'CyberCat';
      base.primaryColor = '#ff7a1a';
      base.accentColor = '#f4f4f4';
      notes.push('Quadruped feline: agile 4-legged walk, pointed ears and tail.');
    } else {
      base.theme = 'dog';
      base.name = has('spot', 'cyberdog') ? 'CyberDog' : 'Robo Puppy';
      base.primaryColor = '#e06c75';
      base.accentColor = '#f59e0b';
      notes.push('Quadruped robot dog: 4 articulated walking legs (FL on S1, FR on S2, RL on S3, RR on S4) with stable paw pads, dog head with ears and wagging tail.');
    }
  } else if (archetype === 'humanoid' || archetype === 'duck') {
    if (has('arm', 'wave', 'hand') || (kitCount >= 2 && !has('no arm'))) {
      P.hasArms = true;
      notes.push('Articulated arms enabled (shoulder servos).');
    } else {
      P.hasArms = false;
    }
    const leg = num(/(\d+(?:\.\d+)?)\s*mm\s*legs?/) ?? num(/legs?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/);
    if (leg) P.legLen = leg;
    else if (has('tall', 'long leg')) { P.legLen = 60; notes.push('Tall biped: 60 mm legs.'); }
    else if (has('tiny', 'compact', 'short', 'small', 'mini')) { P.legLen = 38; notes.push('Compact mini biped: 38 mm legs.'); }

    const foot = num(/(\d+(?:\.\d+)?)\s*mm\s*feet/);
    if (foot) P.footLen = foot;
    else if (has('big feet', 'stable', 'wide base')) { P.footLen = 60; P.footWidth = 34; notes.push('Enlarged feet soles for walking stability.'); }
  }
  const leds = num(/(\d)\s*(?:leds?|lights?)/);
  if (leds !== undefined) P.leds = leds; else if (has('no led', 'no light')) P.leds = 0; else if (has('lights', 'glow', 'rgb', 'colorful', 'colourful')) P.leds = 6;

  if (has('outdoor', 'sun', 'hot', 'car dash')) { base.structural = 'ABS/ASA'; notes.push('Outdoor/heat: ABS/ASA structure.'); }
  if (has('tough', 'combat', 'indestructible', 'abuse')) { base.structural = 'PA-CF'; notes.push('Abuse-resistant: PA-CF structure (hardened nozzle, dry box).'); }

  const colorWords = Object.keys(COLORS).filter(c => has(c));
  if (colorWords[0]) base.primaryColor = COLORS[colorWords[0]];
  if (colorWords[1]) base.accentColor = COLORS[colorWords[1]];

  const named = prompt.match(/(?:called|named)\s+["']?([A-Za-z0-9][\w -]{1,22})/i);
  if (named) base.name = named[1].trim();
  else if (!refine && (!base.name || base.name === 'Scout Rover' || base.name === 'CyberBot')) {
    base.name = ({ rover: has('patrol') ? 'Patrol Rover' : has('race', 'fast') ? 'Dash Rover' : 'Scout Rover', arm: 'Desk Arm', companion: 'Buddy Bot', humanoid: 'Mini Humanoid' } as Record<string, string>)[archetype] || archetype.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  if (has('phone', 'stand', 'magsafe', 'magnet', 'điện thoại', 'giá đỡ', 'cradle')) {
    P.mountType = 'phone_stand';
    P.hasMagnetPockets = true;
    P.hasCableSlot = true;
    P.mountAngle = 65;
    P.cradleWidth = 60;
    P.cradleHeight = 62;
    if (archetype === 'rover') {
      P.panTilt = false; // phone stand takes deck mount
      base.name = 'Phone Rover Stand';
    } else if (archetype === 'desk_agent') {
      base.name = 'AI Phone Stand';
    }
    notes.push('Integrated 3D-printed magnetic phone stand with recessed Neodymium N52 magnet pockets and bottom USB-C cable slot.');
  }

  const defaultBehaviors = behaviorsOf(archetype) ?? DEFAULT_BEHAVIORS;
  const want = defaultBehaviors.map(b => b.id).filter(id => has(id));
  base.behaviors = want.length ? want : defaultBehaviors.map(b => b.id);

  for (const [w, label] of [['lidar', 'lidar'], ['ultrason', 'ultrasonic sensor'], ['distance sensor', 'distance sensor'], ['gps', 'GPS'], ['imu', 'IMU'], ['line follow', 'line sensor']] as const)
    if (p.includes(w)) out.push(`${label}: not part of standard kit; the design leaves room on the deck (I2C/UART expansion on the shield).`);

  base.summary = prompt.slice(0, 200);
  const { spec, fixes } = normalizeSpec(base);
  return {
    spec,
    rationale: `Chose ${archetype.replace(/_/g, ' ')}${refine ? ' (refining the current design)' : ''} based on your specifications. ${notes.join(' ')}`.trim(),
    assumptions: [...fixes, 'Synthesized using PICOCEO Builder autonomous morphological engine using Directory components.'],
    outOfScope: out,
  };
}