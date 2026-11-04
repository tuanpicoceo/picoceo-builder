// Entry point: RobotSpec -> Assembly. Runs in a Web Worker in the app and directly in Node for tests.

import { hasWord, mechanismFamily, type RobotSpec } from '../design/spec';
import { Build, freeAll } from './kernel';
import { buildRover } from './rover';
import { buildArm } from './arm';
import { buildCompanion } from './companion';
import { buildHumanoid } from './humanoid';
import { buildSnake } from './snake';
import { buildQuadruped } from './quadruped';
import { buildTurntable } from './turntable';
import { buildLever } from './lever';
import { buildRotor } from './rotor';
import { buildLinear } from './linear';
import { buildScara } from './scara';
import { buildComposer } from './composer';
import { isVoiceCore } from './voicecore';
import type { Assembly } from './types';

const MECHANISMS = { scara: buildScara, lever: buildLever, rotor: buildRotor, linear: buildLinear };

export function buildAssembly(spec: RobotSpec): Assembly {
  const t = (spec.archetype || '').toLowerCase();
  const th = (spec.theme || '').toLowerCase();
  const t0 = performance.now();
  const b = new Build();
  const family = mechanismFamily(spec.archetype || '');
  try {
    if (spec.composition?.use) {
      b.strictFit = true;     // free-form layouts must leave a way in and a cable path for every part
      buildComposer(b, spec);
    } else if (family && !t.includes('turntable')) {
      MECHANISMS[family](b, spec);
    } else if (
      t.includes('snake') || t.includes('serpent') || t.includes('rắn') || hasWord(t, 'ran') ||
      t.includes('worm') || t.includes('viper') || t.includes('cobra') || t.includes('python') ||
      t.includes('dragon') || t.includes('caterpillar') || t.includes('centipede') || t.includes('eel') ||
      th.includes('snake') || th.includes('rắn') || hasWord(th, 'ran') || th.includes('worm')
    ) {
      buildSnake(b, spec);
    } else if (
      t.includes('quadruped') || t.includes('dog') || t.includes('chó') || t.includes('puppy') || t.includes('hound') ||
      hasWord(t, 'cat') || t.includes('crawler') || t.includes('wolf') || t.includes('fox') || t.includes('lion') ||
      t.includes('tiger') || t.includes('bear') || t.includes('panda') || t.includes('horse') || t.includes('pony') ||
      t.includes('cow') || t.includes('pig') || t.includes('sheep') || t.includes('goat') || t.includes('deer') ||
      t.includes('elephant') || t.includes('rhino') || t.includes('hippo') || t.includes('giraffe') || t.includes('zebra') ||
      t.includes('rabbit') || t.includes('bunny') || t.includes('turtle') || t.includes('tortoise') || t.includes('lizard') ||
      t.includes('dinosaur') || t.includes('triceratops') || t.includes('stegosaurus') || t.includes('sauropod') ||
      t.includes('beast') || t.includes('mammal') || t.includes('4-legged') || t.includes('four legged') || t.includes('4 chân') ||
      th.includes('dog') || hasWord(th, 'cat') || th.includes('elephant') || th.includes('horse') || th.includes('tiger') ||
      th.includes('bear') || th.includes('lion') || th.includes('wolf') || th.includes('turtle') || th.includes('lizard') ||
      (spec.params.hasTail && spec.params.headFeature === 'ears' && !t.includes('humanoid') && !t.includes('biped') && !t.includes('duck'))
    ) {
      buildQuadruped(b, spec);
    } else if (
      t.includes('arm') || t.includes('manipulator') || t.includes('gripper') || t.includes('crane') ||
      t.includes('claw') || t.includes('excavator') || t.includes('loader') || t.includes('digger') ||
      t.includes('catapult') || t.includes('barrier') || t.includes('gate') || t.includes('boom') ||
      t.includes('cánh tay') || t.includes('cần cẩu') || t.includes('bắn đá') || th.includes('arm') || th.includes('crane')
    ) {
      buildArm(b, spec);
    } else if (
      t.includes('rover') || hasWord(t, 'car') || t.includes('vehicle') || t.includes('wheel') ||
      t.includes('racer') || t.includes('tank') || t.includes('truck') || t.includes('buggy') ||
      t.includes('bus') || t.includes('tractor') || t.includes('forklift') || t.includes('kart') ||
      t.includes('van') || t.includes('jeep') || t.includes('boat') || t.includes('vessel') ||
      t.includes('xe') || t.includes('thuyền') || t.includes('tàu') || th.includes('rover') || th.includes('car')
    ) {
      buildRover(b, spec);
    } else if (
      t.includes('turntable') || t.includes('bàn xoay') || t.includes('platter') || t.includes('rotary_table') ||
      th.includes('turntable') || th.includes('bàn xoay')
    ) {
      buildTurntable(b, spec);
    } else if (
      t.includes('companion') || t.includes('turret') || t.includes('head') || t.includes('buddy') ||
      t.includes('desk') || t.includes('agent') || t.includes('stationary') || t.includes('stand') ||
      t.includes('xiaozhi') || t.includes('zhaozhi') || t.includes('bàn') || t.includes('speaker') ||
      t.includes('trợ lý') || t.includes('lamp') || t.includes('camera') || t.includes('cctv') ||
      t.includes('beacon') || t.includes('flower') || t.includes('feeder') ||
      t.includes('dispenser') || t.includes('fan') || t.includes('machine') || t.includes('device') ||
      t.includes('conveyor') || t.includes('scanner') || t.includes('máy') ||
      t.includes('quạt') || th.includes('companion') || th.includes('agent') || th.includes('machine')
    ) {
      buildCompanion(b, spec);
    } else if (
      t.includes('humanoid') || t.includes('biped') || t.includes('walk') || t.includes('duck') ||
      t.includes('chicken') || t.includes('rooster') || t.includes('hen') || t.includes('chick') ||
      t.includes('bird') || t.includes('penguin') || t.includes('owl') || t.includes('eagle') ||
      t.includes('parrot') || t.includes('ostrich') || t.includes('flamingo') || t.includes('kangaroo') ||
      t.includes('t-rex') || t.includes('tyrannosaurus') || t.includes('raptor') || t.includes('alien') ||
      t.includes('robot') || t.includes('person') || t.includes('man') || t.includes('warrior') ||
      t.includes('legged') || th.includes('duck') || th.includes('chicken') || th.includes('rooster') ||
      th.includes('bird') || th.includes('penguin') || spec.params.footStyle === 'webbed' || spec.params.headFeature === 'beak'
    ) {
      buildHumanoid(b, spec);
    } else {
      if (spec.params.drive === 'B-GM001' || (spec.params.wheelDia > 44 && !t.includes('turntable') && !t.includes('fan') && !t.includes('machine'))) buildRover(b, spec);
      else if (spec.params.upperLen > 0 || spec.params.foreLen > 0) buildArm(b, spec);
      else if (spec.params.legLen > 40 && (spec.params.hasArms || spec.params.footLen > 40)) buildHumanoid(b, spec);
      else buildCompanion(b, spec);
    }
    if (spec.platform === 'licheerv_claw' && !b.comps.some(c => c.catalogId === 'LICHEERV-NANO-W'))
      b.check({ id: 'platform', label: 'LicheeRV Claw layout', status: 'warn',
        detail: 'This body still carries the CyberBrick electronics: no LicheeRV Claw layout was built for it. Switch the directory to the CyberBrick kit, or ask for another design.' });
    if (isVoiceCore(spec.platform) && !b.comps.some(c => c.key === 'voice_board'))
      b.check({ id: 'platform', label: `${spec.platform} voice layout`, status: 'warn',
        detail: `This archetype builder still carries the CyberBrick electronics: the ${spec.platform} voice core (board, mic, speaker, display) is only built into free-form compositions. Ask for a free-form design, or switch the directory to the CyberBrick kit.` });
    return b.finish(t0);
  } finally {
    freeAll();
  }
}
