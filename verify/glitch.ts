/**
 * Measures visual glitches in the synapse animation by stepping it exactly like the canvas does during playback.
 *
 *   npm run glitch                      (default set of combinations)
 *   npm run glitch -- caffeine:low nicotine alcohol
 *
 * Reports, per run of the full 8-hour playback:
 *   teleports  — a molecule's drawn position jumps more than 25 px between two frames
 *   blinks     — a receptor switches lit/unlit and back within 0.3 s
 *   popIns     — a molecule appears and disappears again within 0.4 s
 *   dockChurn  — a drug molecule docks into a transporter and leaves within 1 s
 */
import { simulate } from '../src/sim/engine';
import type { Selection } from '../src/sim/engine';
import { createWorld, seededRandom, stepWorld } from '../src/sim/synapseWorld';
import type { Mol, World } from '../src/sim/synapseWorld';
import { parseSelection } from './trace';

const FPS = 30;
const RUN_SECONDS = 26;
const DURATION = 8;

/** Where the canvas draws a molecule this frame (it draws every molecule at its model position). */
function drawnAt(_world: World, m: Mol): [number, number] {
  return [m.x, m.y];
}

export type GlitchReport = { combo: string; frames: number; teleports: number; blinks: number; popIns: number; dockChurn: number };

export function measure(sels: Selection[], seed = 7): GlitchReport {
  const result = simulate(sels);
  const world = createWorld(result, seededRandom(seed));
  for (let i = 0; i < 240; i++) stepWorld(world, 0, 1 / FPS);

  const frames = RUN_SECONDS * FPS;
  const last = new Map<Mol, [number, number]>();
  const born = new Map<Mol, number>();
  const docked = new Map<Mol, number>();
  const litSince = world.receptors.map(() => ({ lit: false, since: 0, prevDuration: Infinity }));
  let teleports = 0;
  let blinks = 0;
  let popIns = 0;
  let dockChurn = 0;

  for (let f = 0; f < frames; f++) {
    const t = (f / frames) * DURATION;
    const before = new Set(world.mols);
    stepWorld(world, t, 1 / FPS);
    const now = f / FPS;

    for (const m of world.mols) {
      if (!born.has(m)) born.set(m, now);
      const pos = drawnAt(world, m);
      const prev = last.get(m);
      if (prev && m.state !== 'fade' && Math.hypot(pos[0] - prev[0], pos[1] - prev[1]) > 25) teleports++;
      last.set(m, pos);
      if (m.state === 'docked' && !docked.has(m)) docked.set(m, now);
    }
    for (const m of before) {
      if (!world.mols.includes(m)) {
        if (now - (born.get(m) ?? 0) < 0.4) popIns++;
        last.delete(m);
      }
    }
    for (const [m, at] of docked) {
      if (m.state !== 'docked') {
        if (now - at < 1) dockChurn++;
        docked.delete(m);
      }
    }
    world.receptors.forEach((r, i) => {
      const lit = r.signal > 0.5;
      const s = litSince[i];
      if (lit !== s.lit) {
        const duration = now - s.since;
        if (duration < 0.3 && s.prevDuration !== Infinity) blinks++;
        s.prevDuration = duration;
        s.lit = lit;
        s.since = now;
      }
    });
  }
  return { combo: sels.map((s) => `${s.id}${s.intensity !== 'typical' ? ':' + s.intensity : ''}${s.offset ? ':+' + s.offset : ''}`).join(' + '), frames, teleports, blinks, popIns, dockChurn };
}

export const GLITCH_COMBOS: string[][] = [
  ['caffeine:low', 'nicotine', 'alcohol'],
  ['cocaine', 'ssri'],
  ['morphine-heroin', 'opioid-antagonists:typical:+2'],
  ['thc'],
  ['antipsychotics', 'amphetamines'],
  ['alcohol', 'benzodiazepines', 'morphine-heroin'],
  ['mdma', 'maoi'],
  ['lsd', 'psilocybin'],
];

if (process.argv[1]?.replace(/\\/g, '/').endsWith('verify/glitch.ts')) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const combos = args.length ? [args] : GLITCH_COMBOS;
  console.log('combo'.padEnd(52), 'teleports  blinks  popIns  dockChurn   (per 26 s playback)');
  for (const c of combos) {
    const r = measure(c.map(parseSelection));
    console.log(r.combo.padEnd(52), String(r.teleports).padStart(9), String(r.blinks).padStart(7), String(r.popIns).padStart(7), String(r.dockChurn).padStart(10));
  }
}
