// "Use any parts" mode: the shopping list from a step-1 selection, the topped-up Directory, and the server's buy mode
// (stock limits lifted, catalog in the prompt) — and that both stay off by default.
import { platformOf } from '../src/catalog/components';
import { buyBody, shoppingList, withBuyRule, withToBuy } from '../src/design/pipeline';
// @ts-expect-error plain ESM server module
import { buyMode, checkPromptKitLimits, getSystemPrompt, validateKitLimits, withBuyMode } from '../server/design.mjs';

let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(ok ? 'PASS' : 'FAIL', name);
  if (!ok) { fails++; if (info !== undefined) console.log('   ', JSON.stringify(info)); }
};

const claw = { 'LICHEERV-NANO-W': 1, 'PICOCLAW-BOARD': 1, 'SG90-SERVO': 1 };
const sel = [
  { id: 'LICHEERV-NANO-W', qty: 1 }, { id: 'RPI-5', qty: 1 },          // own board kept, a second board never bought
  { id: 'PCA9685-SERVO-16', qty: 1 }, { id: 'FS90R-SERVO', qty: 2 },   // missing
  { id: 'SG90-SERVO', qty: 2 },                                        // 1 owned, 2 needed
  { id: 'NOT-A-PART', qty: 3 },                                        // unknown ids ignored
];
const buy = shoppingList(sel, claw);
check('shopping list: missing + shortfall, no board, no unknown ids',
  JSON.stringify(buy) === JSON.stringify({ 'PCA9685-SERVO-16': 1, 'FS90R-SERVO': 2, 'SG90-SERVO': 1 }), buy);
const plan = withToBuy(claw, buy);
check('topped-up directory keeps the platform', plan['SG90-SERVO'] === 1 && plan['FS90R-SERVO'] === 2 && platformOf(plan) === 'licheerv_claw', plan);
check('no board in the directory: the board is on the list', shoppingList([{ id: 'RPI-5', qty: 1 }], {})['RPI-5'] === 1);
check('buy rule only when on', withBuyRule('x', false) === 'x' && withBuyRule('x', true).includes('use any parts'));
const body = buyBody(true) as { buyMissing?: boolean; buyCatalog?: string[] };
check('request carries the catalog', body.buyMissing === true && (body.buyCatalog?.length ?? 0) > 50 && !!body.buyCatalog?.some(l => l.startsWith('FS90R-SERVO:')));
check('request off by default', Object.keys(buyBody(false)).length === 0);

const inv = withBuyMode(claw, body);
check('server: buy mode on with the flag only', buyMode(inv) && !buyMode(withBuyMode(claw, {})) && !buyMode(claw));
check('server: stock pre-check skipped in buy mode', !!checkPromptKitLimits('an arm with 6 servos', 1, claw) && checkPromptKitLimits('an arm with 6 servos', 1, inv) === null);
check('server: LED stock limit lifted, real refusals kept',
  validateKitLimits({ params: { leds: 12 } }, 1, inv) === null && !!validateKitLimits({ params: { leds: 12 } }, 1, claw) &&
  validateKitLimits({ params: { leds: 0 }, refusalReason: 'cannot fly' }, 1, inv) === 'cannot fly');
const p = getSystemPrompt(1, inv);
check('server: prompt has the buy section and catalog', p.includes('"Use any parts" mode') && p.includes('* FS90R-SERVO:') && p.includes('STOCK IS A STARTING POINT') && !p.includes('__buyMissing'));
check('server: plain prompt unchanged', !getSystemPrompt(1, claw).includes('Use any parts') && getSystemPrompt(1, claw).includes('STRICT COMPONENT LIMITS'));

console.log(fails ? `buytest: ${fails} failure(s)` : 'buytest: OK');
process.exit(fails ? 1 : 0);
