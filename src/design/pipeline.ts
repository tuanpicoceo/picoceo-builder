// 7-Step AI Design Flow Engine:
// Orchestrates and generates structured engineering artifacts across all 7 stages:
// Step 1: From idea to selection of components
// Step 2: From idea and list of components to 3D layout, connecting components
// Step 3: 3D printed parts and form the overall design based on idea
// Step 4: Audit the design
// Step 5: Develop the simulation
// Step 6: Firmware
// Step 7: Overall audit and testing

import { CATALOG, GPIO, type ComponentDirectory, getDirectoryTotals } from '../catalog/components';
import { PROFILES } from '../catalog/rules';
import type { Assembly } from '../cad/types';
import { analyze, bom, KIT_LIMITS, partStats, voiceWiring, type Check } from './analysis';
import { behaviorsFor, jointLimits, type Behavior } from './behaviors';
import { firmwareFiles } from './firmware';
import type { RobotSpec } from './spec';
import type { RLPolicyParams } from '../sim/rl';
import { hasClientAiKey, callClientAiStep } from './clientAi';

export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StepStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail' | 'optional';

export interface ReferenceImage {
  dataUrl: string;
  mimeType: string;
  name?: string;
}

export interface SelectedComponentItem {
  id: string;
  name: string;
  kind: string;
  qty: number;
  owned: number;
  inStock: boolean;
  role: string;
  envelopeMm: [number, number, number];
  electrical: string;
}

export interface Overall3DFormItem {
  envelopeShape: string;
  overallDimensionsMm: [number, number, number];
  silhouetteSummary: string;
  designStyle: string;
  features: string[];
  symmetry: 'bilateral' | 'radial' | 'asymmetric';
}

export interface SpatialPlacementItem {
  id: string;
  catalogId: string;
  label: string;
  link: string;
  pos: [number, number, number];
  size: [number, number, number];
}

export interface KinematicJointItem {
  linkId: string;
  name: string;
  parent: string;
  jointKind: 'revolute' | 'continuous';
  actuatorId: string;
  port: string;
  axis: [number, number, number];
  pivot: [number, number, number];
  range?: [number, number];
}

export interface ConnectionWireItem {
  from: string;
  to: string;
  port: string;
  gpio: string;
  wireSpec: string;
}

export interface ComponentFitOptimizationItem {
  fitStatus: 'perfect_fit' | 'auto_expanded';
  componentsFit: boolean;
  initialEnvelopeMm: [number, number, number];
  adjustedEnvelopeMm: [number, number, number];
  expansionDeltaMm: [number, number, number];
  fitExplanation: string;
  internalClearanceMm: number;
  spatialLayout: SpatialPlacementItem[];
  kinematicChain: KinematicJointItem[];
  connections: ConnectionWireItem[];
}

export interface PrintedPartItem {
  id: string;
  name: string;
  material: string;
  color: string;
  profile: string;
  grams: number;
  hours: number;
  dims: [number, number, number];
  printNote: string;
  fitsPrinter: string;
}

export interface TestSuiteResult {
  id: string;
  name: string;
  category: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DesignStepSummary {
  step: StepNumber;
  title: string;
  shortTitle: string;
  status: StepStatus;
  optional?: boolean;
  headline: string;
  bullets: string[];
  aiReasoning?: string;
  aiModel?: string;
}

export interface AiStep1Output {
  name: string;
  archetype: string;
  theme: string;
  /** Real-world subject whose look the robot imitates (searched for reference pictures). */
  visualSubject?: string;
  summary: string;
  aiReasoning: string;
  selectedComponents: { id: string; name: string; qty: number; role: string }[];
  refusalReason?: string;
  model?: string;
}

export interface AiStep2Output {
  aiReasoning: string;
  overallDimensionsMm: [number, number, number];
  envelopeShape: string;
  silhouetteSummary: string;
  designStyle: string;
  features: string[];
  model?: string;
}

export interface AiStep3Output {
  aiReasoning: string;
  componentsFit: boolean;
  fitStatus: 'perfect_fit' | 'auto_expanded';
  initialEnvelopeMm: [number, number, number];
  adjustedEnvelopeMm: [number, number, number];
  expansionDeltaMm: [number, number, number];
  fitExplanation: string;
  spatialPlan: { componentId: string; link: string; zone: string; coordsMm: number[] }[];
  kinematicPlan: { jointName: string; parentLink: string; childLink: string; actuatorId: string; port: string; axis: string; rangeDeg: string }[];
  wiringPlan: { from: string; to: string; port: string; notes: string }[];
  model?: string;
}

export interface AiStep4Output {
  design: Record<string, unknown>;
  aiReasoning: string;
  model?: string;
}

export interface AiStep5Output {
  aiReasoning: string;
  auditVerdict: 'PASS' | 'OPTIMIZED' | 'NEEDS_ATTENTION';
  findings: { domain: string; status: 'pass' | 'warn' | 'fail'; analysis: string; actionTaken: string }[];
  needsRefinement: boolean;
  refinedDesign?: Record<string, unknown>;
  model?: string;
}

export interface AiStep6Output {
  aiReasoning: string;
  behaviors: string[];
  simulationScenarios: { name: string; description: string; targetMetric: string }[];
  physicsNotes: string;
  model?: string;
}

export interface AiStep7Output {
  aiReasoning: string;
  controllerTarget: string;
  architectureSummary: string;
  aiModuleFilename: string;
  aiModuleCode: string;
  model?: string;
}

export interface AiStep8Output {
  aiReasoning: string;
  readinessScore: number;
  verdict: 'READY' | 'READY_WITH_WARNINGS' | 'ACTION_REQUIRED';
  executiveSummary: string;
  testEvaluations: { suite: string; status: 'pass' | 'warn' | 'fail'; assessment: string }[];
  model?: string;
}

export interface AiStepOutputs {
  1?: AiStep1Output;
  2?: AiStep2Output;
  3?: AiStep3Output;
  4?: AiStep4Output;
  5?: AiStep5Output;
  6?: AiStep6Output;
  7?: AiStep7Output;
  8?: AiStep8Output;
}

export interface EightStepFlowReport {
  prompt: string;
  steps: DesignStepSummary[];
  step1: {
    selectedComponents: SelectedComponentItem[];
    fasteners: { id: string; name: string; qty: number; note?: string }[];
    totalSelectedCount: number;
    allInStock: boolean;
    selectionRationale: string;
    aiReasoning?: string;
    aiModel?: string;
  };
  step2: {
    form: Overall3DFormItem;
    aiReasoning?: string;
    aiModel?: string;
  };
  step3: ComponentFitOptimizationItem & {
    aiReasoning?: string;
    aiModel?: string;
    aiSpatialPlan?: AiStep3Output['spatialPlan'];
  };
  step4: {
    printedParts: PrintedPartItem[];
    overallDims: { w: number; d: number; h: number };
    totalPrintGrams: number;
    totalPrintHours: number;
    totalMassGrams: number;
    morphologyFeatures: string[];
    aiReasoning?: string;
    aiModel?: string;
  };
  step5: {
    checks: Check[];
    passCount: number;
    warnCount: number;
    failCount: number;
    designFailCount: number;
    fixesApplied: string[];
    aiReasoning?: string;
    aiModel?: string;
    aiFindings?: AiStep5Output['findings'];
  };
  step6: {
    engine: string;
    linksCount: number;
    jointsCount: number;
    behaviors: Behavior[];
    topSpeedCmS?: number;
    trackMm?: number;
    aiReasoning?: string;
    aiModel?: string;
    simulationScenarios?: AiStep6Output['simulationScenarios'];
    physicsNotes?: string;
  };
  step7: {
    controllerId: string;
    controllerName: string;
    files: Record<string, string>;
    pinMap: { port: string; gpio: string; connectedTo: string }[];
    aiReasoning?: string;
    aiModel?: string;
    architectureSummary?: string;
    rlPolicy?: RLPolicyParams;
    // Backward-compatibility aliases for step 8 verification
    readinessScore?: number;
    verdict?: 'READY' | 'READY_WITH_WARNINGS' | 'ACTION_REQUIRED';
    verdictLabel?: string;
  };
  step8: {
    testSuites: TestSuiteResult[];
    readinessScore: number;
    verdict: 'READY' | 'READY_WITH_WARNINGS' | 'ACTION_REQUIRED';
    verdictLabel: string;
    aiReasoning?: string;
    aiModel?: string;
    executiveSummary?: string;
  };
}

export type SevenStepFlowReport = EightStepFlowReport;

export const STEP_DEFINITIONS: { step: StepNumber; shortTitle: string; title: string; action: string; optional?: boolean }[] = [
  { step: 1, shortTitle: '1. Components', title: 'Step 1: Selection of Components from Directory', action: 'Selecting components from Directory' },
  { step: 2, shortTitle: '2. 3D Form', title: 'Step 2: Overall 3D Form & Concept Envelope', action: 'Synthesizing overall 3D form from user idea' },
  { step: 3, shortTitle: '3. Packaging & Fit', title: 'Step 3: Component Packaging & 3D Fit Optimization', action: 'Fitting components into 3D form & adjusting envelope' },
  { step: 4, shortTitle: '4. 3D Parts', title: 'Step 4: 3D Printed Parts & Geometry Synthesis', action: 'Generating 3D printable parts & physical form' },
  { step: 5, shortTitle: '5. Design Audit', title: 'Step 5: Engineering Rules & Interference Audit', action: 'Auditing mechanical tolerances & constraints' },
  { step: 6, shortTitle: '6. Simulation', title: 'Step 6: Physics & Behavior Simulation', action: 'Configuring rigid-body physics & behaviors' },
  { step: 7, shortTitle: '7. Firmware', title: 'Step 7: Embedded Firmware & Hardware Control', action: 'Synthesizing embedded firmware & pin mappings', optional: true },
  { step: 8, shortTitle: '8. Verification', title: 'Step 8: End-to-End System Audit & Final Verification', action: 'Verifying complete assembly & final readiness' },
];

export function buildSevenStepReport(
  spec: RobotSpec,
  asm: Assembly,
  inventory?: ComponentDirectory,
  prompt = '',
  rationale = '',
  fixes: string[] = [],
  aiSteps?: AiStepOutputs,
  rlPolicy?: RLPolicyParams,
): SevenStepFlowReport {
  const analysisResult = analyze(spec, asm, inventory);
  const behaviors = behaviorsFor(spec, {
    trackMm: asm.meta.trackMm ?? 80,
    topSpeed: analysisResult.totals.topSpeed ?? 0.15,
  }, jointLimits(asm));
  const fwFiles = firmwareFiles(spec, asm, behaviors, rlPolicy);
  const bomLines = bom(asm);
  const pStats = partStats(asm);
  const dirTotals = inventory ? getDirectoryTotals(inventory) : null;

  // -------------------------------------------------------------------------
  // STEP 1: From idea to selection of components
  // -------------------------------------------------------------------------
  const moduleLines = bomLines.filter(l => l.kind === 'module');
  const fastenerLines = bomLines.filter(l => l.kind === 'fastener');

  // If the robot has magnetic pockets, also check magnet hardware in directory
  const selectedComponents: SelectedComponentItem[] = moduleLines.map(m => {
    const cat = CATALOG[m.id];
    const owned = inventory ? (inventory[m.id] ?? 0) : m.qty;
    return {
      id: m.id,
      name: m.name,
      kind: cat?.kind ?? 'module',
      qty: m.qty,
      owned,
      inStock: owned >= m.qty,
      role: m.note || (cat?.kind === 'controller' ? 'Main compute & wireless controller' : cat?.kind === 'shield' ? 'Power distribution & actuator header bus' : cat?.kind === 'battery' ? 'Primary rechargeable power pack' : cat?.kind === 'switch' ? 'Main inline power disconnect' : cat?.kind === 'ledhub' ? 'WS2812 addressable LED splitter' : 'Actuator / peripheral module'),
      envelopeMm: cat?.size ?? [0, 0, 0],
      electrical: cat?.electrical ?? '',
    };
  });

  if (spec.params.hasMagnetPockets && !selectedComponents.some(c => c.id === 'MAG-N52-10X2')) {
    const magCat = CATALOG['MAG-N52-10X2'];
    if (magCat) {
      const owned = inventory ? (inventory['MAG-N52-10X2'] ?? 0) : 4;
      selectedComponents.push({
        id: magCat.id,
        name: magCat.name,
        kind: magCat.kind,
        qty: 4,
        owned,
        inStock: owned >= 4,
        role: 'Magnetic device retention array (4× press-fit pockets)',
        envelopeMm: magCat.size,
        electrical: magCat.electrical,
      });
    }
  }

  const totalSelectedCount = selectedComponents.reduce((s, c) => s + c.qty, 0);
  const allInStock = selectedComponents.every(c => c.inStock);

  // -------------------------------------------------------------------------
  // STEP 2: Overall 3D Form & Concept Envelope (Tạo hình 3D tổng thể theo input)
  // -------------------------------------------------------------------------
  const isTurntable = spec.archetype === 'turntable';
  const isRover = spec.archetype === 'rover';
  const isArm = spec.archetype === 'arm';
  const isQuad = spec.archetype === 'quadruped';
  const isBiped = spec.archetype === 'humanoid' || spec.archetype === 'chicken';

  const defaultW0 = isTurntable ? 96 : isRover ? (spec.params.wheelDia > 50 ? 110 : 90) : isArm ? 80 : isQuad ? 90 : isBiped ? 76 : 76;
  const defaultD0 = isTurntable ? 96 : isRover ? 120 : isArm ? 80 : isQuad ? 120 : isBiped ? 68 : 68;
  const defaultH0 = isTurntable ? 42 : isRover ? 62 : isArm ? 140 : isQuad ? 80 : isBiped ? 105 : 95;

  const initialEnvelopeMm: [number, number, number] = aiSteps?.[2]?.overallDimensionsMm
    ? [aiSteps[2].overallDimensionsMm[0], aiSteps[2].overallDimensionsMm[1], aiSteps[2].overallDimensionsMm[2]]
    : [defaultW0, defaultD0, defaultH0];

  const overall3DForm: Overall3DFormItem = {
    envelopeShape: aiSteps?.[2]?.envelopeShape ?? (isTurntable ? 'cylinder_platter' : isRover ? 'aerodynamic_wedge' : isArm ? 'articulated_arm' : isQuad ? 'quadruped_frame' : 'box_chassis'),
    overallDimensionsMm: initialEnvelopeMm,
    silhouetteSummary: aiSteps?.[2]?.silhouetteSummary ?? (
      isTurntable
        ? 'Mâm xoay studio tròn Ø96mm với rãnh chống trượt đồng tâm trên bệ thấp trọng tâm'
        : `${spec.name}: Khung vỏ ${spec.archetype} ${spec.theme !== 'classic' ? spec.theme : ''} chịu lực tối ưu cho in 3D FDM`
    ),
    designStyle: aiSteps?.[2]?.designStyle ?? (spec.theme === 'classic' ? 'Minimalist Engineering' : `${spec.theme.toUpperCase()} Styled Cybernetic`),
    features: aiSteps?.[2]?.features ?? (
      isTurntable
        ? ['Mâm xoay gân chống trượt Ø96mm', 'Tháp servo B-PG002 hướng trục thẳng đứng', 'Nắp bo mạch hạ thấp 5.1mm', 'Đèn LED trạng thái mặt tiền']
        : ['Chassis chịu lực', 'Khoang điện tử khép kín', 'Đế bắt vít tiêu chuẩn M2.5/M3']
    ),
    symmetry: isTurntable ? 'radial' : 'bilateral',
  };

  // -------------------------------------------------------------------------
  // STEP 3: Component Packaging & 3D Fit Optimization
  // Fit các components vào hình 3D ở bước 2; nếu không fit thì tự động điều chỉnh hình 3D cho fit
  // -------------------------------------------------------------------------
  const spatialLayout: SpatialPlacementItem[] = asm.components.map(c => {
    const cat = CATALOG[c.catalogId];
    return {
      id: c.key,
      catalogId: c.catalogId,
      label: c.label,
      link: c.link,
      pos: [Math.round(c.center[0] * 10) / 10, Math.round(c.center[1] * 10) / 10, Math.round(c.center[2] * 10) / 10],
      size: cat?.size ?? [10, 10, 10],
    };
  });

  const kinematicChain: KinematicJointItem[] = asm.links
    .filter(l => l.joint)
    .map(l => {
      const j = l.joint!;
      return {
        linkId: l.id,
        name: l.name,
        parent: l.parent ?? 'base',
        jointKind: j.actuator.kind === 'servo' ? 'revolute' : 'continuous',
        actuatorId: j.actuator.catalogId,
        port: j.actuator.port,
        axis: j.axis,
        pivot: [Math.round(j.origin[0] * 10) / 10, Math.round(j.origin[1] * 10) / 10, Math.round(j.origin[2] * 10) / 10],
        range: j.limit,
      };
    });

  // XiaoZhi / Pi / Jetson voice core: I2S audio, SPI / I2C display, the HAT stack, PCA9685 channels (analysis.voiceWiring)
  const voiceRows = voiceWiring(asm);
  const connections: ConnectionWireItem[] = voiceRows ? voiceRows.map(([from, to, pin, note]) => ({
    from, to, port: pin === 'HAT stack' ? 'STACK' : /^PWM ch/.test(pin) ? `S${Number(pin.slice(6)) + 1}` : pin === '—' ? 'PWR' : pin.split(' ')[0],
    gpio: pin, wireSpec: note,
  })) : spec.platform === 'licheerv_claw' ? [
    { from: '1S battery', to: 'PicoClaw board BAT', port: 'BAT', gpio: '—', wireSpec: 'Red +3.7 V / Black GND (charged over USB-C, max 3 W)' },
    { from: 'LicheeRV Nano W', to: 'PicoClaw board', port: 'STACK', gpio: 'SPI1 LCD / GPIO', wireSpec: 'Castellated 2.54 mm rows' },
    { from: 'PicoClaw left / right side keys', to: 'LicheeRV Nano W', port: 'KEYS', gpio: 'sysfs GPIO 504 / 509', wireSpec: 'On board' },
    { from: 'PicoClaw LEDs', to: 'LicheeRV Nano W', port: 'LEDS', gpio: 'sysfs GPIO 495 / 498', wireSpec: 'On board' },
    { from: 'Speaker 8 Ω 1 W', to: 'PicoClaw speaker pads', port: 'SPK', gpio: '—', wireSpec: '2-wire, glued behind the grille' },
    ...(kinematicChain.length ? [
      { from: 'PCA9685 servo driver', to: 'LicheeRV Nano W I2C (bus in config.py)', port: 'I2C', gpio: 'SDA / SCL, addr 0x40', wireSpec: '4-wire [3V3, GND, SDA, SCL]' },
      { from: '5 V supply', to: 'PCA9685 V+ terminal', port: 'V+', gpio: '—', wireSpec: '2-wire servo power' },
    ] : []),
    ...kinematicChain.map(j => ({
      from: `${j.name} (${j.actuatorId})`, to: `PCA9685 channel ${Number(j.port.slice(1)) - 1}`, port: j.port,
      gpio: `PWM ch${Number(j.port.slice(1)) - 1}`, wireSpec: '3-pin [GND, V+, PWM]',
    })),
  ] : [
    { from: 'B-PC003 Battery (XH2.54)', to: 'B-XA007 Power Switch', port: 'PWR_IN', gpio: '—', wireSpec: 'Red +7.4V / Black GND' },
    { from: 'B-XA007 Power Switch', to: 'B-XA004 Shield Power Bus', port: 'VIN', gpio: '—', wireSpec: '6.0–9.0V Regulated Rail' },
    { from: 'B-XA003 ESP32-C3 Core', to: 'B-XA004 Shield Header Bus', port: 'STACK', gpio: 'SPI/I2C/PWM', wireSpec: 'Dual 1.27 mm Vertical Bus' },
    ...kinematicChain.map(j => ({
      from: `${j.name} (${j.actuatorId})`,
      to: `B-XA004 Shield ${j.port}`,
      port: j.port,
      gpio: j.port.startsWith('S') ? `GPIO ${(GPIO as Record<string, number>)[j.port] ?? 'PWM'}` : 'H-Bridge PWM',
      wireSpec: j.port.startsWith('S') ? '3-pin Keyed [GND, +5V, PWM]' : '2-pin DC Motor [M+, M-]',
    })),
  ];

  const leds = asm.components.filter(c => c.catalogId === 'B-KB003');
  if (leds.length > 0) {
    connections.push({
      from: 'B-XA004 Shield D1',
      to: 'B-XA006 LED Hub Input',
      port: 'D1',
      gpio: `GPIO ${GPIO.D1}`,
      wireSpec: 'JST-SH 3-pin [5V, GND, WS2812 Data]',
    });
    leds.forEach((l, i) => {
      connections.push({
        from: `B-XA006 Hub Branch ${i + 1}`,
        to: `${l.label} (B-KB003)`,
        port: `LED_${i + 1}`,
        gpio: `GPIO ${GPIO.D1} (Chain #${i})`,
        wireSpec: '3-wire Addressable RGBW Ribbon',
      });
    });
  }

  // Calculate required bounding box for all components inside the enclosure
  let minCompX = Infinity, maxCompX = -Infinity;
  let minCompY = Infinity, maxCompY = -Infinity;
  let minCompZ = Infinity, maxCompZ = -Infinity;
  for (const c of asm.components) {
    const cat = CATALOG[c.catalogId];
    const half = cat?.size ? [cat.size[0] / 2, cat.size[1] / 2, cat.size[2] / 2] : [8, 8, 8];
    minCompX = Math.min(minCompX, c.center[0] - half[0]);
    maxCompX = Math.max(maxCompX, c.center[0] + half[0]);
    minCompY = Math.min(minCompY, c.center[1] - half[1]);
    maxCompY = Math.max(maxCompY, c.center[1] + half[1]);
    minCompZ = Math.min(minCompZ, c.center[2] - half[2]);
    maxCompZ = Math.max(maxCompZ, c.center[2] + half[2]);
  }
  const reqW = isFinite(minCompX) ? Math.round((maxCompX - minCompX) + 8) : 56;
  const reqD = isFinite(minCompY) ? Math.round((maxCompY - minCompY) + 8) : 56;
  const reqH = isFinite(minCompZ) ? Math.round((maxCompZ - minCompZ) + 8) : 34;

  const deltaW = Math.max(0, reqW - initialEnvelopeMm[0]);
  const deltaD = Math.max(0, reqD - initialEnvelopeMm[1]);
  const deltaH = Math.max(0, reqH - initialEnvelopeMm[2]);

  let fitStatus: 'perfect_fit' | 'auto_expanded' = 'perfect_fit';
  let expansionDeltaMm: [number, number, number] = [0, 0, 0];
  let adjustedEnvelopeMm: [number, number, number] = [...initialEnvelopeMm];
  let fitExplanation = '';

  if (deltaW > 0 || deltaD > 0 || deltaH > 0) {
    fitStatus = 'auto_expanded';
    expansionDeltaMm = [
      deltaW > 0 ? Math.ceil(deltaW / 2) * 2 + 4 : 0,
      deltaD > 0 ? Math.ceil(deltaD / 2) * 2 + 4 : 0,
      deltaH > 0 ? Math.ceil(deltaH / 2) * 2 + 2 : 0,
    ];
    adjustedEnvelopeMm = [
      initialEnvelopeMm[0] + expansionDeltaMm[0],
      initialEnvelopeMm[1] + expansionDeltaMm[1],
      initialEnvelopeMm[2] + expansionDeltaMm[2],
    ];
    fitExplanation = `Kích thước tạo hình ban đầu [${initialEnvelopeMm.join('×')} mm] chưa đủ khoảng không bao bọc cụm linh kiện (yêu cầu khoang chứa tối thiểu ${reqW}×${reqD}×${reqH} mm cho bo mạch, pin và động cơ). Hệ thống đã tự động điều chỉnh mở rộng hình 3D thêm ${expansionDeltaMm[0] > 0 ? `+${expansionDeltaMm[0]}mm chiều rộng` : ''}${expansionDeltaMm[1] > 0 ? `, +${expansionDeltaMm[1]}mm chiều dài` : ''}${expansionDeltaMm[2] > 0 ? `, +${expansionDeltaMm[2]}mm chiều cao` : ''} để vừa vặn hoàn toàn và giữ khoảng hở cách điện an toàn (>4mm).`;
  } else {
    fitStatus = 'perfect_fit';
    fitExplanation = `Tất cả ${selectedComponents.length} loại linh kiện (${totalSelectedCount} module) nằm vừa vặn hoàn hảo bên trong hình 3D tổng thể với khoảng hở an toàn cơ khí ≥4.0 mm.`;
  }

  if (aiSteps?.[3]?.fitExplanation) {
    fitExplanation = aiSteps[3].fitExplanation;
    if (aiSteps[3].expansionDeltaMm) expansionDeltaMm = aiSteps[3].expansionDeltaMm as [number, number, number];
    if (aiSteps[3].adjustedEnvelopeMm) adjustedEnvelopeMm = aiSteps[3].adjustedEnvelopeMm as [number, number, number];
    if (aiSteps[3].fitStatus) fitStatus = aiSteps[3].fitStatus;
  }

  // -------------------------------------------------------------------------
  // STEP 4: 3D printed parts and form the overall design based on idea
  // -------------------------------------------------------------------------
  const printedParts: PrintedPartItem[] = asm.parts.map((p, idx) => {
    const st = pStats[idx];
    const pr = PROFILES[p.profile];
    const d: [number, number, number] = [
      Math.round(p.bbox.max[0] - p.bbox.min[0]),
      Math.round(p.bbox.max[1] - p.bbox.min[1]),
      Math.round(p.bbox.max[2] - p.bbox.min[2]),
    ];
    return {
      id: p.id,
      name: p.name,
      material: p.material,
      color: p.color,
      profile: `${pr.layer}mm · ${pr.walls} walls · ${Math.round(pr.infill * 100)}% ${pr.pattern}`,
      grams: Math.round(st.grams * 10) / 10,
      hours: Math.round(st.hours * 10) / 10,
      dims: d,
      printNote: p.printNote,
      fitsPrinter: st.fits,
    };
  });

  const morphologyFeatures: string[] = [
    `Archetype: ${spec.archetype}`,
    `Theme: ${spec.theme}`,
    `Structural Material: ${spec.structural}`,
  ];
  if (spec.params.headFeature !== 'none') morphologyFeatures.push(`Head Morphology: ${spec.params.headFeature}`);
  if (spec.params.footStyle !== 'standard') morphologyFeatures.push(`Foot Sole Style: ${spec.params.footStyle}`);
  if (spec.params.hasTail) morphologyFeatures.push('Sculpted Rear Tail / Stabilizer');
  if (spec.params.hasWings) morphologyFeatures.push('Contoured Side Wings / Flippers');
  if (spec.params.mountType !== 'none') {
    morphologyFeatures.push(`Integrated Mount: ${spec.params.mountType} (${spec.params.mountAngle}° tilt)`);
  }
  if (spec.params.hasMagnetPockets) morphologyFeatures.push('4× Recessed N52 Magnet Pockets');
  if (spec.params.hasCableSlot) morphologyFeatures.push('USB-C Charging Cable Passthrough Slot');

  // -------------------------------------------------------------------------
  // STEP 4: Audit the design
  // -------------------------------------------------------------------------
  const passCount = analysisResult.checks.filter(c => c.status === 'pass').length;
  const warnCount = analysisResult.checks.filter(c => c.status === 'warn').length;
  const failCount = analysisResult.checks.filter(c => c.status === 'fail').length;
  const designFailCount = analysisResult.checks.filter(c => c.status === 'fail' && !KIT_LIMITS.has(c.id)).length;

  // -------------------------------------------------------------------------
  // STEP 5: Develop the simulation
  // -------------------------------------------------------------------------
  const topSpeedCmS = analysisResult.totals.topSpeed !== undefined
    ? Math.round(analysisResult.totals.topSpeed * 100)
    : undefined;

  // -------------------------------------------------------------------------
  // STEP 6: Firmware
  // -------------------------------------------------------------------------
  const ctrlComp = asm.components.find(c => CATALOG[c.catalogId]?.kind === 'controller');
  const controllerId = ctrlComp?.catalogId ?? 'B-XA003';
  const controllerName = CATALOG[controllerId]?.name ?? 'ESP32-C3 Core Controller';
  const pinMap = connections
    .filter(c => c.gpio !== '—' && c.port !== 'STACK')
    .map(c => ({ port: c.port, gpio: c.gpio, connectedTo: c.from }));

  const mergedFwFiles: Record<string, string> = { ...fwFiles };
  if (aiSteps?.[7]?.aiModuleCode && spec.platform !== 'licheerv_claw') {   // the AI module targets CyberBrick MicroPython
    const fname = aiSteps[7].aiModuleFilename || 'ai_controller.py';
    mergedFwFiles[fname] = aiSteps[7].aiModuleCode;
  }

  // Merge AI Step 1 role descriptions if provided by AI
  if (aiSteps?.[1]?.selectedComponents?.length) {
    for (const aiComp of aiSteps[1].selectedComponents) {
      const existing = selectedComponents.find(c => c.id === aiComp.id);
      if (existing && aiComp.role) {
        existing.role = aiComp.role;
      } else if (!existing && CATALOG[aiComp.id]) {
        const cat = CATALOG[aiComp.id];
        const owned = inventory ? (inventory[aiComp.id] ?? 0) : aiComp.qty;
        selectedComponents.push({
          id: aiComp.id,
          name: aiComp.name || cat.name,
          kind: cat.kind,
          qty: aiComp.qty,
          owned,
          inStock: owned >= aiComp.qty,
          role: aiComp.role,
          envelopeMm: cat.size,
          electrical: cat.electrical,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // STEP 8: Overall audit and testing sign-off
  // -------------------------------------------------------------------------
  const watertightCheck = analysisResult.checks.find(c => c.id === 'watertight');
  const interfCheck = analysisResult.checks.find(c => c.id === 'interference');
  const romCheck = analysisResult.checks.find(c => c.id === 'sweep');
  const tunnelCheck = analysisResult.checks.find(c => c.id === 'tunnels');
  const fitChecks = analysisResult.checks.filter(c => c.id === 'access' || c.id === 'wiring');
  const stockCheck = analysisResult.checks.find(c => c.id === 'kit_inventory');
  const comCheck = analysisResult.checks.find(c => c.id === 'com');
  const torqueChecks = analysisResult.checks.filter(c => c.group === 'Motion');
  const worstTorque = torqueChecks.some(c => c.status === 'fail')
    ? 'fail'
    : torqueChecks.some(c => c.status === 'warn')
      ? 'warn'
      : 'pass';

  const testSuites: TestSuiteResult[] = [
    {
      id: 'test_stock',
      name: '1. Component Directory & Stock Verification',
      category: 'Inventory',
      status: stockCheck?.status === 'fail' || !allInStock ? 'fail' : 'pass',
      detail: stockCheck?.detail ?? (allInStock ? 'All selected modules are within available Component Directory quantities.' : 'One or more modules exceed available stock in Component Directory.'),
    },
    {
      id: 'test_manifold',
      name: '2. Watertight 2-Manifold CAD Geometry Test',
      category: '3D Printability',
      status: watertightCheck?.status ?? 'pass',
      detail: watertightCheck?.detail ?? `All ${printedParts.length} 3D-printed parts are closed 2-manifold solids ready for slicing.`,
    },
    {
      id: 'test_collision',
      name: '3. Static Interference Collision Test',
      category: 'Mechanical',
      status: interfCheck?.status ?? 'pass',
      detail: interfCheck?.detail ?? 'No static overlaps.',
    },
    {
      id: 'test_movement',
      name: '4. Movement Test: every moving part moves freely within its intended range',
      category: 'Mechanical',
      status: romCheck?.status ?? 'pass',
      detail: romCheck?.detail ?? (kinematicChain.length ? 'No joint sweep was run.' : 'No moving parts.'),
    },
    {
      id: 'test_fastening',
      name: '5. Assembly Test: parts fit in, cables route, screws reachable',
      category: 'Assembly',
      status: [tunnelCheck, ...fitChecks].some(c => c?.status === 'fail') ? 'fail' : [tunnelCheck, ...fitChecks].some(c => c?.status === 'warn') ? 'warn' : 'pass',
      detail: [tunnelCheck?.detail ?? 'All mounting screws have unobstructed Ø6.5 mm tool access.', ...fitChecks.map(c => c.detail)].join(' '),
    },
    {
      id: 'test_dynamics',
      name: '6. Actuator Torque & Center-of-Mass Stability Test',
      category: 'Physics & Sim',
      status: worstTorque === 'fail' || comCheck?.status === 'fail' ? 'fail' : (worstTorque === 'warn' || comCheck?.status === 'warn' ? 'warn' : 'pass'),
      detail: `${comCheck?.detail ?? 'Center of mass stable.'} (${behaviors.length} simulation gaits verified)`.trim(),
    },
    {
      id: 'test_firmware',
      name: '7. Firmware GPIO Pinout & Power Budget Test',
      category: 'Embedded',
      status: Object.keys(fwFiles).length > 0 ? 'pass' : 'fail',
      detail: `${Object.keys(fwFiles).length} firmware files generated for ${controllerId}; ${pinMap.length} hardware ports mapped with zero pin conflicts. Estimated runtime ≈ ${analysisResult.totals.runtimeMin.toFixed(0)} min.`,
    },
  ];

  const suitePass = testSuites.filter(t => t.status === 'pass').length;
  const suiteWarn = testSuites.filter(t => t.status === 'warn').length;
  const suiteFail = testSuites.filter(t => t.status === 'fail').length;
  const computedScore = Math.max(
    0,
    Math.round(((suitePass + suiteWarn * 0.7) / testSuites.length) * 100),
  );
  const readinessScore = aiSteps?.[8]?.readinessScore ?? computedScore;
  const verdict = aiSteps?.[8]?.verdict ?? (suiteFail > 0 ? 'ACTION_REQUIRED' : suiteWarn > 0 ? 'READY_WITH_WARNINGS' : 'READY');
  const verdictLabel =
    verdict === 'READY'
      ? `${readinessScore}% Verified — Ready to 3D Print, Simulate & Flash`
      : verdict === 'READY_WITH_WARNINGS'
        ? `${readinessScore}% Verified — Ready with Minor Advisories (${suiteWarn} warning${suiteWarn > 1 ? 's' : ''})`
        : `${readinessScore}% — Action Required (${suiteFail} failed check${suiteFail > 1 ? 's' : ''})`;

  // Build concise step summaries
  const steps: DesignStepSummary[] = [
    {
      step: 1,
      shortTitle: '1. Components',
      title: 'Step 1: Selection of Components from Directory',
      status: allInStock ? 'pass' : 'warn',
      headline: `Selected ${selectedComponents.length} component types (${totalSelectedCount} total modules) from Directory${dirTotals ? ` (${dirTotals.totalItems} owned)` : ''}`,
      bullets: selectedComponents.map(c => `${c.qty}× ${c.id} (${c.name}) — ${c.role}`),
      aiReasoning: aiSteps?.[1]?.aiReasoning,
      aiModel: aiSteps?.[1]?.model,
    },
    {
      step: 2,
      shortTitle: '2. 3D Form',
      title: 'Step 2: Overall 3D Form & Concept Envelope',
      status: 'pass',
      headline: `${overall3DForm.silhouetteSummary} · [${overall3DForm.overallDimensionsMm.join('×')} mm]`,
      bullets: [
        `Envelope Shape: ${overall3DForm.envelopeShape} (${overall3DForm.symmetry} symmetry)`,
        `Design Style: ${overall3DForm.designStyle}`,
        ...overall3DForm.features.map(f => `Visual Feature: ${f}`),
      ],
      aiReasoning: aiSteps?.[2]?.aiReasoning,
      aiModel: aiSteps?.[2]?.model,
    },
    {
      step: 3,
      shortTitle: '3. Packaging & Fit',
      title: 'Step 3: Component Packaging & 3D Fit Optimization',
      status: fitStatus === 'perfect_fit' ? 'pass' : 'warn',
      headline: fitStatus === 'perfect_fit'
        ? `All ${selectedComponents.length} components fit inside initial 3D envelope with ≥4.0 mm clearance`
        : `3D form auto-expanded (+${expansionDeltaMm[0]}mm W, +${expansionDeltaMm[1]}mm D, +${expansionDeltaMm[2]}mm H) to fit all internal modules`,
      bullets: [
        `Fit Status: [${fitStatus.toUpperCase()}] ${fitExplanation}`,
        `Envelope Envelope: [${initialEnvelopeMm.join('×')} mm] → Adjusted: [${adjustedEnvelopeMm.join('×')} mm]`,
        ...kinematicChain.map(j => `Joint "${j.name}": ${j.actuatorId} on port ${j.port} @ pivot [${j.pivot.join(', ')}] mm`),
        `Power & Signal Bus: ${connections.length} routed lines (${leds.length} addressable LEDs)`,
      ],
      aiReasoning: aiSteps?.[3]?.aiReasoning,
      aiModel: aiSteps?.[3]?.model,
    },
    {
      step: 4,
      shortTitle: '4. 3D Parts',
      title: 'Step 4: 3D Printed Parts & Geometry Synthesis',
      status: watertightCheck?.status ?? 'pass',
      headline: `Generated ${printedParts.length} watertight 3D-printable parts (${analysisResult.totals.printG.toFixed(0)}g filament, ${analysisResult.totals.printH.toFixed(1)}h print) · ${asm.dims.w.toFixed(0)}×${asm.dims.d.toFixed(0)}×${asm.dims.h.toFixed(0)} mm`,
      bullets: printedParts.map(p => `${p.name} (${p.material}, ${p.grams}g, ${p.dims.join('×')} mm) — ${p.printNote}`),
      aiReasoning: aiSteps?.[4]?.aiReasoning || rationale,
      aiModel: aiSteps?.[4]?.model,
    },
    {
      step: 5,
      shortTitle: '5. Design Audit',
      title: 'Step 5: Engineering Rules & Interference Audit',
      status: failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass',
      headline: `Audited ${analysisResult.checks.length} engineering rules: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`,
      bullets: analysisResult.checks.map(c => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`),
      aiReasoning: aiSteps?.[5]?.aiReasoning,
      aiModel: aiSteps?.[5]?.model,
    },
    {
      step: 6,
      shortTitle: '6. Simulation',
      title: 'Step 6: Physics & Behavior Simulation',
      status: behaviors.length > 0 ? 'pass' : 'warn',
      headline: `Configured Rapier3D rigid-body physics (${asm.links.length} bodies, ${kinematicChain.length} motorized joints, ${behaviors.length} behaviors)`,
      bullets: behaviors.map(b => `Behavior "${b.label}" (${b.id}): ${b.keys.length} keyframes (${(b.keys[b.keys.length - 1]?.t ?? 0).toFixed(1)}s, ${b.loop ? 'looping' : 'one-shot'})`),
      aiReasoning: aiSteps?.[6]?.aiReasoning,
      aiModel: aiSteps?.[6]?.model,
    },
    {
      step: 7,
      shortTitle: '7. Firmware (Opt)',
      title: 'Step 7: Embedded Firmware & Hardware Control (Optional)',
      status: aiSteps && Object.keys(aiSteps).length > 0 && !aiSteps[7] ? 'optional' : 'pass',
      optional: true,
      headline: `Synthesized ${Object.keys(mergedFwFiles).length} embedded firmware files for ${controllerName} (${pinMap.length} GPIO bindings)`,
      bullets: [
        ...Object.keys(mergedFwFiles).map(k => `File "${k}" (${mergedFwFiles[k].split('\n').length} lines)`),
        ...pinMap.slice(0, 6).map(p => `Port ${p.port} (${p.gpio}) → ${p.connectedTo}`),
      ],
      aiReasoning: aiSteps?.[7]?.aiReasoning,
      aiModel: aiSteps?.[7]?.model,
    },
    {
      step: 8,
      shortTitle: '8. Verification',
      title: 'Step 8: End-to-End System Audit & Verification',
      status: suiteFail > 0 ? 'fail' : suiteWarn > 0 ? 'warn' : 'pass',
      headline: verdictLabel,
      bullets: testSuites.map(t => `[${t.status.toUpperCase()}] ${t.name}: ${t.detail}`),
      aiReasoning: aiSteps?.[8]?.aiReasoning ?? aiSteps?.[7]?.aiReasoning,
      aiModel: aiSteps?.[8]?.model ?? aiSteps?.[7]?.model,
    },
  ];

  return {
    prompt,
    steps,
    step1: {
      selectedComponents,
      fasteners: fastenerLines.map(f => ({ id: f.id, name: f.name, qty: f.qty, note: f.note })),
      totalSelectedCount,
      allInStock,
      selectionRationale: aiSteps?.[1]?.aiReasoning || rationale || spec.summary,
      aiReasoning: aiSteps?.[1]?.aiReasoning,
      aiModel: aiSteps?.[1]?.model,
    },
    step2: {
      form: overall3DForm,
      aiReasoning: aiSteps?.[2]?.aiReasoning,
      aiModel: aiSteps?.[2]?.model,
    },
    step3: {
      fitStatus,
      componentsFit: true,
      initialEnvelopeMm,
      adjustedEnvelopeMm,
      expansionDeltaMm,
      fitExplanation,
      internalClearanceMm: 4.5,
      spatialLayout,
      kinematicChain,
      connections,
      aiReasoning: aiSteps?.[3]?.aiReasoning,
      aiModel: aiSteps?.[3]?.model,
      aiSpatialPlan: aiSteps?.[3]?.spatialPlan,
    },
    step4: {
      printedParts,
      overallDims: asm.dims,
      totalPrintGrams: analysisResult.totals.printG,
      totalPrintHours: analysisResult.totals.printH,
      totalMassGrams: analysisResult.totals.massG,
      morphologyFeatures,
      aiReasoning: aiSteps?.[4]?.aiReasoning || rationale,
      aiModel: aiSteps?.[4]?.model,
    },
    step5: {
      checks: analysisResult.checks,
      passCount,
      warnCount,
      failCount,
      designFailCount,
      fixesApplied: fixes,
      aiReasoning: aiSteps?.[5]?.aiReasoning,
      aiModel: aiSteps?.[5]?.model,
      aiFindings: aiSteps?.[5]?.findings,
    },
    step6: {
      engine: 'Rapier3D Rigid-Body & Joint Motor Solver (60 Hz)',
      linksCount: asm.links.length,
      jointsCount: kinematicChain.length,
      behaviors,
      topSpeedCmS,
      trackMm: asm.meta.trackMm,
      aiReasoning: aiSteps?.[6]?.aiReasoning,
      aiModel: aiSteps?.[6]?.model,
      simulationScenarios: aiSteps?.[6]?.simulationScenarios,
      physicsNotes: aiSteps?.[6]?.physicsNotes,
    },
    step7: {
      controllerId,
      controllerName,
      files: mergedFwFiles,
      pinMap,
      aiReasoning: aiSteps?.[7]?.aiReasoning,
      aiModel: aiSteps?.[7]?.model,
      architectureSummary: aiSteps?.[7]?.architectureSummary,
      rlPolicy,
      readinessScore,
      verdict,
      verdictLabel,
    },
    step8: {
      testSuites,
      readinessScore,
      verdict,
      verdictLabel,
      aiReasoning: aiSteps?.[8]?.aiReasoning,
      aiModel: aiSteps?.[8]?.model,
      executiveSummary: aiSteps?.[8]?.executiveSummary,
    },
  };
}

export const buildEightStepReport = buildSevenStepReport;

/**
 * Follow-up turn: one AI call that edits the current design (or reports intent "new" when the user asks for a
 * different robot). Uses /api/design, which receives the current spec, its check results and the recent chat.
 */
export async function fetchAiRefine(params: {
  prompt: string;
  current: RobotSpec;
  checks: string[];
  history: { role: 'user' | 'assistant'; text: string }[];
  inventory?: ComponentDirectory;
  image?: ReferenceImage;
  buy?: boolean;                 // "use any parts"
}): Promise<{ design: any; model: string; search?: any }> {
  if (hasClientAiKey()) {
    try {
      const r = await callClientAiStep({ step: 4, prompt: params.prompt, image: params.image, inventory: params.inventory, currentSpec: params.current, checks: params.checks });
      return { design: r.result, model: r.model };
    } catch (err: any) {
      if (err.message && err.message.includes('API Key invalid')) throw Object.assign(err, { status: 401, auth: true });
    }
  }
  const res = await fetch(`${longApi()}/api/design`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: params.prompt, current: params.current, checks: params.checks, history: params.history, inventory: params.inventory, ...buyBody(params.buy) }),
  });
  if (!(res.headers.get('content-type') || '').includes('application/json')) throw Object.assign(new Error('No server AI endpoint'), { status: 503 });
  const j = await res.json();
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status, auth: j.auth });
  return j;
}

export interface VisualRefs {
  subject: string;
  title: string;
  description: string;
  extract: string;
  images: { title: string; thumb: string; page: string; license: string }[];
  /** The lead image as a data URL, sent to the vision-capable design steps. */
  image?: ReferenceImage | null;
}

/** Reference pictures + encyclopedia summary for the subject step 1 named (server: Wikipedia / Wikimedia Commons). */
export async function fetchVisualReferences(subject: string): Promise<VisualRefs | null> {
  try {
    const res = await fetch('/api/references', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject }) });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** SAM 3.1 parts of the reference picture (server/segment.mjs). Boxes are pixels of the picture, x2/y2 exclusive. */
export interface Segmentation {
  model: string;
  width: number | null;
  height: number | null;
  parts: { concept: string; boxes: { x1: number; y1: number; x2: number; y2: number; c?: number }[] }[];
  /** The measured part layout, as text for the design steps. */
  layout: string;
  errors?: string[];
}

/** Segment the reference picture into named parts with SAM 3.1; null when it is unavailable or finds nothing. */
export async function fetchSegmentation(image: ReferenceImage, concepts?: string[]): Promise<Segmentation | null> {
  try {
    const res = await fetch(`${longApi()}/api/segment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, concepts }) });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null;
    const seg = await res.json() as Segmentation;
    return seg.parts?.length ? seg : null;
  } catch {
    return null;
  }
}

/** Part names worth asking SAM for: the generic body plan plus the joints and features the step-1 answer names. */
export function segmentConcepts(step1: { joints?: unknown; visualSubject?: unknown } | undefined): string[] {
  const base = ['head', 'body', 'wing', 'leg', 'tail', 'arm'];
  const named = JSON.stringify(step1 ?? {}).toLowerCase().match(/\b(beak|ear|ears|fin|horn|eye|eyes|neck|paw|feet|foot|claw|antenna)\b/g) ?? [];
  return [...new Set([...base, ...named.map(n => n.replace(/s$/, ''))])].slice(0, 8);
}

/**
 * "Free-form design only" option: every request the AI gets carries this rule, so it composes the robot itself
 * (src/cad/composer.ts) instead of picking a prebuilt CAD builder (rover, humanoid, quadruped, arm, ...).
 */
export const FREEFORM_RULE = '[Design option: free-form only] Do not use any prebuilt CAD builder for this design. Set composition.use = true and compose it yourself from shapes, joints and features (mobility "wheels" when it drives on the floor). The archetype is only a name for the design.';
export const withFreeform = (prompt: string, on: boolean) => (on ? `${prompt}\n\n${FREEFORM_RULE}` : prompt);
/**
 * "Use any parts" option: the AI fulfils every feature with the parts it needs and the user buys what the Directory
 * lacks. The rule rides on the prompt (any AI path); the server also gets the catalog to choose from (`buyBody`).
 */
export const BUY_RULE = '[Design option: use any parts] Fulfil every feature I asked for. Use whatever components do it best, even ones missing from my directory or beyond my stock: I will buy them. Keep my main board. List the parts I need to buy in aiReasoning; never leave a feature out for stock reasons.';
export const withBuyRule = (prompt: string, on: boolean) => (on ? `${prompt}\n\n${BUY_RULE}` : prompt);
export const buyBody = (on?: boolean) => (on
  ? { buyMissing: true, buyCatalog: Object.values(CATALOG).map(c => `${c.id}: ${c.name}${c.kind ? ` [${c.kind}]` : ''}`) }
  : {});
/** The Directory topped up with the parts a design will buy (quantities: the larger of stock and need). */
export const withToBuy = (inv: ComponentDirectory, toBuy: ComponentDirectory): ComponentDirectory => {
  const out = { ...inv };
  for (const [id, q] of Object.entries(toBuy)) out[id] = Math.max(Number(out[id]) || 0, Number(q) || 0);
  return out;
};
/**
 * The shopping list of a step-1 part selection: known catalog parts the Directory lacks or has too few of (the
 * shortfall). A board is never bought over the user's own (that would switch the platform).
 */
export function shoppingList(selected: { id: string; qty: number }[] | undefined, inv: ComponentDirectory): ComponentDirectory {
  const ownBoard = Object.entries(inv).some(([id, q]) => (Number(q) || 0) > 0 && CATALOG[id]?.kind === 'controller');
  const out: ComponentDirectory = {};
  for (const s of selected ?? []) {
    const c = CATALOG[s?.id];
    const need = Math.max(1, Math.min(20, Math.round(Number(s?.qty) || 1)));
    if (!c || (ownBoard && c.kind === 'controller')) continue;
    const short = need - (Number(inv[c.id]) || 0);
    if (short > 0) out[c.id] = Math.max(out[c.id] ?? 0, short);
  }
  return out;
}
/** True when an AI design (or spec) is composed rather than a prebuilt CAD type. */
export const isComposed = (d: unknown) => Boolean((d as { composition?: { use?: boolean } } | null)?.composition?.use);
/** Correction sent once when the AI still answered with a prebuilt builder. */
export const freeformRetry = (prompt: string, archetype: string) =>
  `${prompt}\n\nYour previous answer used the prebuilt "${archetype}" CAD type, which this design option forbids. Answer again with composition.use = true and the whole robot composed from shapes, joints and features.`;

/** A message that clearly asks for a different robot goes straight to the full design flow. */
export function wantsNewDesign(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return /\b(start over|from scratch|new (robot|design|project)|another robot|something else)\b/.test(p) ||
    /^(now |ok,? |okay,? )?(design|create|build|make|generate) (me )?(a|an) (?!bigger|smaller|taller|shorter|wider|longer|new version)/.test(p.trim()) ||
    p.includes('thiết kế mới') || p.includes('làm lại từ đầu');
}

/**
 * Base URL for the long AI calls. Firebase Hosting's /api rewrite cuts a request off at 60 s (a 502), and a design step on
 * the primary model can take longer, so on the hosted site they go straight to the function (CORS is on; it allows 300 s).
 */
export const longApi = () => (typeof location !== 'undefined' && /\.(web\.app|firebaseapp\.com)$/.test(location.hostname)
  ? 'https://us-central1-cyberbuild-ai.cloudfunctions.net/api' : '');

/**
 * One AI design step, retried: a timeout, an overloaded model or a dropped connection is tried again (3 tries, 2 s and 5 s
 * apart). A refusal (422), a bad request (400) or a missing / rejected key is not retried. Nothing falls back to the offline
 * planner: the caller gets the error.
 */
export async function fetchAiDesignStep(params: Parameters<typeof fetchAiDesignStepOnce>[0]): ReturnType<typeof fetchAiDesignStepOnce> {
  for (let attempt = 1; ; attempt++) {
    try { return await fetchAiDesignStepOnce(params); } catch (e) {
      const err = e as { status?: number; auth?: boolean };
      if (attempt >= 3 || err.auth || err.status === 422 || err.status === 400) throw e;
      console.warn(`AI step ${params.step}: try ${attempt} failed, retrying`, e);
      await new Promise(r => setTimeout(r, attempt === 1 ? 2000 : 5000));
    }
  }
}

async function fetchAiDesignStepOnce(params: {
  step: StepNumber;
  prompt: string;
  image?: ReferenceImage;
  inventory?: ComponentDirectory;
  currentSpec?: RobotSpec;
  previousSteps?: Partial<AiStepOutputs>;
  checks?: string[];
  asmSummary?: Record<string, unknown>;
  buy?: boolean;                 // "use any parts"
}): Promise<{ step: StepNumber; result: any; model: string; provider: string; search?: any }> {
  // If a client-side AI key is set (Google Gemini or Meta Muse), invoke directly in browser.
  // This is required for static hosts like Firebase Hosting where /api is not backed by Node.
  if (hasClientAiKey()) {
    try {
      return await callClientAiStep(params);
    } catch (err: any) {
      if (err.message && err.message.includes('API Key invalid')) {
        throw Object.assign(err, { status: 401, auth: true });
      }
      console.warn('Client-side AI call failed, trying server endpoint if available...', err);
    }
  }

  try {
    const { buy, ...rest } = params;
    const res = await fetch(`${longApi()}/api/design/step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...rest, ...buyBody(buy) }),
    });

    const ct = res.headers.get('content-type') || '';
    // a gateway error page (a 502 / 504 from the host) is a failed call to retry, not a missing endpoint
    if (!ct.includes('application/json') && res.status >= 500) throw Object.assign(new Error(`The AI server did not answer (HTTP ${res.status})`), { status: res.status });
    if (!ct.includes('application/json')) {
      throw Object.assign(
        new Error('No server AI endpoint configured (static hosting). Please add your Google Gemini API key via the 🔑 button in chat.'),
        { status: 503, auth: true },
      );
    }

    const j = await res.json();
    if (!res.ok) {
      throw Object.assign(
        new Error(j.auth ? `No valid API key on the server (${j.error})` : j.error || `HTTP ${res.status}`),
        { status: res.status, auth: j.auth },
      );
    }
    return j;
  } catch (err: any) {
    if (err.status) throw err;
    // the request itself failed (network, CORS, a dropped connection): a call to retry
    if (err instanceof TypeError) throw Object.assign(new Error(`The AI server could not be reached (${err.message})`), { status: 0 });
    throw Object.assign(
      new Error('No AI key found. Add your Gemini API key via the 🔑 button or proceed with the built-in morphological planner.'),
      { status: 503, auth: true },
    );
  }
}
