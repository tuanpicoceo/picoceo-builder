// Client-side Direct AI execution for Google Gemini and Meta Muse APIs.
// Allows PICOCEO Builder to run multi-step generative robot design directly in the browser
// on static hosts (like Firebase Hosting) without requiring a backend server.

import type { StepNumber, AiStepOutputs, ReferenceImage } from './pipeline';
import type { ComponentDirectory } from '../catalog/components';
import { SHAPES, type RobotSpec } from './spec';

const KEY_STORAGE = 'cyberbuild_ai_key';
const PROVIDER_STORAGE = 'cyberbuild_ai_provider';

export function getStoredAiKey(): { key: string; provider: 'gemini' | 'meta' } | null {
  const k = localStorage.getItem(KEY_STORAGE)?.trim();
  const p = (localStorage.getItem(PROVIDER_STORAGE)?.trim() || 'gemini') as 'gemini' | 'meta';
  if (k) return { key: k, provider: p };
  const envKey = (import.meta as any).env?.VITE_AI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.VITE_META_API_KEY;
  if (envKey) {
    const prov: 'gemini' | 'meta' = envKey.startsWith('AIzaSy') ? 'gemini' : 'meta';
    return { key: envKey, provider: prov };
  }
  return null;
}

export function setStoredAiKey(key: string, provider: 'gemini' | 'meta' = 'gemini'): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
  localStorage.setItem(PROVIDER_STORAGE, provider);
}

export function clearStoredAiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(PROVIDER_STORAGE);
}

export function hasClientAiKey(): boolean {
  return Boolean(getStoredAiKey());
}

export async function testAiKey(key: string, provider: 'gemini' | 'meta' = 'gemini'): Promise<{ ok: boolean; message: string; model?: string }> {
  if (provider === 'gemini') {
    const testModels = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    for (const m of testModels) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Return JSON: {"status":"ok"}' }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });
        if (res.ok) {
          return { ok: true, message: `Connected to Google Gemini (${m})`, model: m };
        }
        if (res.status === 401 || res.status === 403) {
          return { ok: false, message: 'Invalid API Key: Access denied by Google AI.' };
        }
      } catch (err: any) {
        // continue to next model candidate
      }
    }
    return { ok: false, message: 'Unable to connect to Google Gemini API with this key.' };
  } else {
    try {
      const res = await fetch('https://api.meta.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'muse-spark-1.3-contributor',
          messages: [{ role: 'user', content: 'Respond with OK' }]
        })
      });
      if (res.ok) {
        return { ok: true, message: 'Connected to Meta Muse (muse-spark-1.3-contributor)', model: 'muse-spark-1.3-contributor' };
      }
      return { ok: false, message: `Meta API returned HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, message: err.message || 'Meta API connection failed.' };
    }
  }
}

// JSON Schemas for each of the 7 AI design steps
const NUM = { type: 'number' };
const SPEC_SCHEMA = {
  type: 'object',
  required: ['name', 'archetype', 'theme', 'summary', 'rationale', 'params', 'structural', 'shell', 'primaryColor', 'accentColor', 'behaviors', 'assumptions', 'outOfScope', 'refusalReason'],
  properties: {
    name: { type: 'string', description: 'Short robot name, max 24 characters' },
    archetype: { type: 'string', description: 'Robot or mechanism archetype (e.g. duck, rover, arm, companion, humanoid, quadruped, snake, barrier_gate, catapult, smart_fan, windmill, pet_feeder, camera_slider, lift, forklift, scara_plotter)' },
    theme: { type: 'string', description: 'Theme or character inspiration' },
    summary: { type: 'string', description: 'One sentence describing the robot' },
    rationale: { type: 'string' },
    params: {
      type: 'object',
      required: [
        'theme', 'headFeature', 'footStyle', 'hasTail', 'hasWings',
        'mountType', 'mountAngle', 'hasMagnetPockets', 'hasCableSlot', 'cradleWidth', 'cradleHeight',
        'drive', 'wheelDia', 'wheelWidth', 'tpuTires', 'bumper', 'panTilt',
        'upperLen', 'foreLen', 'gripperLen', 'payloadG',
        'legLen', 'footLen', 'footWidth', 'armLen', 'hasArms',
        'leverLen', 'leverTool', 'pivotH', 'rotorStyle', 'rotorDia', 'bladeCount', 'stroke', 'linearOrient', 'linearTool',
        'leds', 'headWidth'
      ],
      properties: {
        theme: { type: 'string' },
        headFeature: { type: 'string', enum: ['none', 'beak', 'ears', 'visor', 'dome'] },
        footStyle: { type: 'string', enum: ['standard', 'webbed', 'wide'] },
        hasTail: { type: 'boolean' },
        hasWings: { type: 'boolean' },
        mountType: { type: 'string', enum: ['none', 'phone_stand', 'magnetic_mount', 'camera_mount', 'pan_tilt_head', 'tablet_stand'] },
        mountAngle: NUM,
        hasMagnetPockets: { type: 'boolean' },
        hasCableSlot: { type: 'boolean' },
        cradleWidth: NUM,
        cradleHeight: NUM,
        drive: { type: 'string', enum: ['B-PG002', 'B-GM001'] },
        wheelDia: NUM, wheelWidth: NUM, tpuTires: { type: 'boolean' }, bumper: { type: 'boolean' }, panTilt: { type: 'boolean' },
        upperLen: NUM, foreLen: NUM, gripperLen: NUM, payloadG: NUM,
        legLen: NUM, footLen: NUM, footWidth: NUM, armLen: NUM, hasArms: { type: 'boolean' },
        leverLen: NUM, leverTool: { type: 'string', enum: ['boom', 'cup', 'flag', 'paddle'] }, pivotH: NUM,
        rotorStyle: { type: 'string', enum: ['fan', 'windmill', 'wheel', 'paddle', 'carousel'] }, rotorDia: NUM, bladeCount: { type: 'integer' },
        stroke: NUM, linearOrient: { type: 'string', enum: ['horizontal', 'vertical'] }, linearTool: { type: 'string', enum: ['table', 'fork', 'camera'] },
        leds: { type: 'integer' }, headWidth: NUM,
      },
    },
    intent: { type: 'string', enum: ['modify', 'new'], description: 'With a current design: modify = change/fix/ask about it; new = a different robot.' },
    composition: {
      type: 'object',
      description: 'Free-form composition (use=true when no archetype builder matches): body {shape, size [x,y,z]}, standH, joints [{name, parent, face, at [u,v], kind swing|spin, range [lo,hi], point, reach, shape, size}] (max 4), features [{parent, shape|led, size, at, color}]. World axes: x right, y front, z up, mm.',
      properties: {
        use: { type: 'boolean' },
        mobility: { type: 'string', enum: ['none', 'wheels', 'legs'], description: 'wheels = body rides the 2-wheel rover chassis (voice platforms: a drive plate on continuous servos); legs (LicheeRV Claw) = a pelvis on two 3-DOF walking legs' },
        wheelCount: { type: 'integer', enum: [2, 4], description: 'Voice platforms with wheels: 2 + front skid, or 4 (tank steering)' },
        body: { type: 'object', properties: { shape: { type: 'string', enum: [...SHAPES] }, size: { type: 'array', items: NUM } } },
        standH: NUM,
        joints: { type: 'array', items: { type: 'object' } },
        features: { type: 'array', items: { type: 'object' } },
      },
    },
    structural: { type: 'string', enum: ['PETG', 'ABS/ASA', 'PA-CF'] },
    shell: { type: 'string', enum: ['PLA+', 'PETG', 'ABS/ASA'] },
    primaryColor: { type: 'string', description: '#rrggbb' },
    accentColor: { type: 'string', description: '#rrggbb' },
    behaviors: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    refusalReason: { type: 'string' },
  },
};

const STEP_SCHEMAS: Record<number, any> = {
  1: {
    type: 'object',
    required: ['archetype', 'theme', 'visualSubject', 'summary', 'aiReasoning', 'selectedComponents', 'refusalReason'],
    properties: {
      archetype: { type: 'string' },
      theme: { type: 'string' },
      visualSubject: { type: 'string', description: 'Real-world thing whose look the robot imitates, 1-3 words for a picture search (e.g. "frog"); empty if none' },
      summary: { type: 'string' },
      aiReasoning: { type: 'string' },
      selectedComponents: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'name', 'qty', 'role'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            qty: { type: 'integer' },
            role: { type: 'string' },
          },
        },
      },
      refusalReason: { type: 'string' },
    },
  },
  2: {
    type: 'object',
    required: ['aiReasoning', 'overallDimensionsMm', 'envelopeShape', 'silhouetteSummary', 'designStyle', 'features'],
    properties: {
      aiReasoning: { type: 'string' },
      overallDimensionsMm: { type: 'array', items: { type: 'number' } },
      envelopeShape: { type: 'string', enum: ['cylinder_platter', 'box_chassis', 'aerodynamic_wedge', 'articulated_arm', 'biped_torso', 'quadruped_frame', 'segmented_cylinder', 'custom_organic'] },
      silhouetteSummary: { type: 'string' },
      designStyle: { type: 'string' },
      features: { type: 'array', items: { type: 'string' } },
    },
  },
  3: {
    type: 'object',
    required: ['aiReasoning', 'componentsFit', 'fitStatus', 'initialEnvelopeMm', 'adjustedEnvelopeMm', 'expansionDeltaMm', 'fitExplanation', 'spatialPlan', 'kinematicPlan', 'wiringPlan'],
    properties: {
      aiReasoning: { type: 'string' },
      componentsFit: { type: 'boolean' },
      fitStatus: { type: 'string', enum: ['perfect_fit', 'auto_expanded'] },
      initialEnvelopeMm: { type: 'array', items: { type: 'number' } },
      adjustedEnvelopeMm: { type: 'array', items: { type: 'number' } },
      expansionDeltaMm: { type: 'array', items: { type: 'number' } },
      fitExplanation: { type: 'string' },
      spatialPlan: {
        type: 'array',
        items: {
          type: 'object',
          required: ['componentId', 'link', 'zone', 'coordsMm'],
          properties: {
            componentId: { type: 'string' },
            link: { type: 'string' },
            zone: { type: 'string' },
            coordsMm: { type: 'array', items: { type: 'number' } },
          },
        },
      },
      kinematicPlan: {
        type: 'array',
        items: {
          type: 'object',
          required: ['jointName', 'parentLink', 'childLink', 'actuatorId', 'port', 'axis', 'rangeDeg'],
          properties: {
            jointName: { type: 'string' },
            parentLink: { type: 'string' },
            childLink: { type: 'string' },
            actuatorId: { type: 'string' },
            port: { type: 'string' },
            axis: { type: 'string' },
            rangeDeg: { type: 'string' },
          },
        },
      },
      wiringPlan: {
        type: 'array',
        items: {
          type: 'object',
          required: ['from', 'to', 'port', 'notes'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            port: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
    },
  },
  4: SPEC_SCHEMA,
  5: {
    type: 'object',
    required: ['aiReasoning', 'auditVerdict', 'findings', 'needsRefinement', 'refinedDesign'],
    properties: {
      aiReasoning: { type: 'string' },
      auditVerdict: { type: 'string', enum: ['PASS', 'OPTIMIZED', 'NEEDS_ATTENTION'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['domain', 'status', 'analysis', 'actionTaken'],
          properties: {
            domain: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
            analysis: { type: 'string' },
            actionTaken: { type: 'string' },
          },
        },
      },
      needsRefinement: { type: 'boolean' },
      refinedDesign: SPEC_SCHEMA,
    },
  },
  6: {
    type: 'object',
    required: ['aiReasoning', 'behaviors', 'simulationScenarios', 'physicsNotes'],
    properties: {
      aiReasoning: { type: 'string' },
      behaviors: { type: 'array', items: { type: 'string' } },
      simulationScenarios: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'description', 'targetMetric'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            targetMetric: { type: 'string' },
          },
        },
      },
      physicsNotes: { type: 'string' },
    },
  },
  7: {
    type: 'object',
    required: ['aiReasoning', 'controllerTarget', 'architectureSummary', 'aiModuleFilename', 'aiModuleCode'],
    properties: {
      aiReasoning: { type: 'string' },
      controllerTarget: { type: 'string' },
      architectureSummary: { type: 'string' },
      aiModuleFilename: { type: 'string' },
      aiModuleCode: { type: 'string' },
    },
  },
  8: {
    type: 'object',
    required: ['aiReasoning', 'readinessScore', 'verdict', 'executiveSummary', 'testEvaluations'],
    properties: {
      aiReasoning: { type: 'string' },
      readinessScore: { type: 'integer' },
      verdict: { type: 'string', enum: ['READY', 'READY_WITH_WARNINGS', 'ACTION_REQUIRED'] },
      executiveSummary: { type: 'string' },
      testEvaluations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['suite', 'status', 'assessment'],
          properties: {
            suite: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
            assessment: { type: 'string' },
          },
        },
      },
    },
  },
};

function getStepInstructions(step: number, inventory?: ComponentDirectory): string {
  const stockSummary = inventory ? Object.entries(inventory).filter(([, q]) => q > 0).map(([id, q]) => `${q}x ${id}`).join(', ') : 'Default stock';
  const header = `You are PICOCEO Builder AI, an expert robotics hardware design agent.
You synthesize 3D-printable robotic parts, mechanical structures, wiring, and physics simulations using the CyberBrick system.
User Available Components: ${stockSummary}.
Always respond strictly in JSON conforming to the step schema.`;

  const map: Record<number, string> = {
    1: `\nSTEP 1: Select components from Directory to fit user robot concept.`,
    2: `\nSTEP 2: Synthesize overall 3D physical form, silhouette, and envelope dimensions [W, D, H] based on user input.`,
    3: `\nSTEP 3: Fit components into the 3D form. If components do not fit, adjust/widen the 3D form to fit comfortably.`,
    4: `\nSTEP 4: Design the complete 3D-printable multi-part screw-together enclosure RobotSpec matching the fitted envelope. If no archetype (rover, arm, humanoid, quadruped, snake, companion, turntable, barrier_gate, smart_fan, camera_slider, scara_plotter) matches the idea's look, set composition.use=true and compose the body shape, up to 4 servo joints (each rotates about the normal of the parent face it is mounted on) and decorative features.`,
    5: `\nSTEP 5: Audit geometry clearances, torque margins, and stability. Refine if needed.`,
    6: `\nSTEP 6: Configure Rapier3D physics behaviors and test scenarios.`,
    7: `\nSTEP 7: Write custom MicroPython control firmware (ai_controller.py).`,
    8: `\nSTEP 8: Final systems sign-off, readiness score (0-100), and executive summary.`,
  };
  return `${header}\n${map[step] || ''}`;
}

export async function callClientAiStep(params: {
  step: StepNumber;
  prompt: string;
  image?: ReferenceImage;
  inventory?: ComponentDirectory;
  currentSpec?: RobotSpec;
  previousSteps?: Partial<AiStepOutputs>;
  checks?: string[];
  asmSummary?: Record<string, unknown>;
}): Promise<{ step: StepNumber; result: any; model: string; provider: string }> {
  const auth = getStoredAiKey();
  if (!auth) {
    throw new Error('No AI key available.');
  }

  const { key, provider } = auth;
  const { step, prompt, image, inventory, currentSpec, previousSteps, checks, asmSummary } = params;

  const sysPrompt = getStepInstructions(step, inventory);
  const contextParts = [`User Idea: ${prompt}`];
  if (currentSpec) contextParts.push(`Current RobotSpec: ${JSON.stringify(currentSpec)}`);
  if (previousSteps) contextParts.push(`Previous Steps: ${JSON.stringify(previousSteps)}`);
  if (checks) contextParts.push(`Checks: ${checks.join('\n')}`);
  if (asmSummary) contextParts.push(`Assembly Summary: ${JSON.stringify(asmSummary)}`);

  const userText = contextParts.join('\n\n');
  const schema = STEP_SCHEMAS[step] ?? SPEC_SCHEMA;

  if (provider === 'gemini') {
    const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    for (const model of candidateModels) {
      try {
        const parts: any[] = [{ text: userText }];
        if (image?.dataUrl) {
          const match = image.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1] || 'image/png',
                data: match[2]
              }
            });
          }
        }

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              maxOutputTokens: 16000,
            }
          })
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Google Gemini API Key invalid or expired.');
          }
          continue;
        }

        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) continue;
        const parsed = JSON.parse(text);
        return { step, result: parsed, model, provider: 'gemini' };
      } catch (err: any) {
        if (err.message?.includes('API Key invalid')) throw err;
      }
    }
  } else {
    // Meta Muse
    const res = await fetch('https://api.meta.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'muse-spark-1.3-contributor',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userText }
        ],
        response_format: { type: 'json_schema', json_schema: { name: `step_${step}`, strict: true, schema } }
      })
    });
    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        return { step, result: JSON.parse(content), model: 'muse-spark-1.3-contributor', provider: 'meta' };
      }
    }
  }

  throw new Error('Direct AI call failed.');
}
