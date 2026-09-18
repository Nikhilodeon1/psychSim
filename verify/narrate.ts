/**
 * Turns the synapse animation into text, for testing and auditing only (never shown in the app).
 *
 *   npm run narrate -- caffeine:low nicotine alcohol
 *   npm run narrate -- morphine-heroin opioid-antagonists:typical:+2 --every 0.25
 *   npm run narrate -- cocaine ssri --events          (also list every single event)
 *
 * It steps the exact animation code the page uses (src/sim/synapseWorld.ts), frame by frame at playback speed,
 * with a fixed random seed. Nothing is inferred from the drawing code; every line comes from diffing the
 * animation's state between frames.
 *
 * For each time window it writes:
 *   - what happened: molecules released, bound, displaced, taken back up, drugs docking, receptors lighting up
 *   - an ASCII picture of the synapse at the end of the window
 *   - the model's numbers beside what the animation showed
 *   - FLAGS wherever the two disagree or something looks wrong
 *
 * Output goes to the terminal and to verify/out/narration-<combo>.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { NT_INFO, SUBSTANCES } from '../src/data/substances';
import type { NT } from '../src/data/substances';
import { ENDOGENOUS } from '../src/data/endogenous';
import { DURATION, simulate } from '../src/sim/engine';
import type { Selection, SimResult } from '../src/sim/engine';
import { sample } from '../src/sim/sample';
import {
  CLEFT_BOT,
  CLEFT_TOP,
  W,
  createWorld,
  familyDrive,
  moleculeTarget,
  seededRandom,
  stepWorld,
  targetOccupancy,
} from '../src/sim/synapseWorld';
import type { Mol, Receptor, World } from '../src/sim/synapseWorld';
import { parseSelection } from './trace';

const FPS = 30;
const RUN_SECONDS = 26;
const FRAMES = RUN_SECONDS * FPS;
/** Simulated hours a drug molecule needs to reach its receptor on screen (~0.5 s of playback). */
const TRAVEL_LAG = 0.15;

// ---------------------------------------------------------------------------------------------------------
// Labels

function label(world: World, m: Mol) {
  if (m.kind === 'nt') return NT_INFO[m.nt!].name;
  if (m.kind === 'endo') return `${ENDOGENOUS[m.lig!].name} (natural)`;
  return world.subs[m.sub!].sub.name;
}
const isAntagonist = (world: World, m: Mol, family: string) =>
  m.kind === 'drug' && world.directActions.some((d) => d.subIdx === m.sub && d.family === family && d.mode === 'antagonist');

const NT_CHAR: Record<NT, string> = { '5HT': 's', DA: 'd', NE: 'n', GABA: 'g', ACh: 'a' };
function glyph(world: World, m: Mol) {
  if (m.kind === 'nt') return NT_CHAR[m.nt!];
  if (m.kind === 'endo') return '*';
  return String(world.subs[m.sub!].slot + 1);
}

/** ASCII picture: presynaptic membrane with transporters, cleft with molecules, receptors on each membrane. */
function picture(world: World): string[] {
  const cols = 96;
  const col = (x: number) => Math.max(0, Math.min(cols - 1, Math.round((x / W) * cols)));
  const rows = 7;
  const cleft = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const pre = Array(cols).fill('=');
  const post = Array(cols).fill('=');
  for (const p of world.pumps) {
    if (p.enzyme) continue;
    const c = col(p.x);
    pre[c] = p.reverse > 0.15 ? 'R' : p.plug ? '#' : 'P';
  }
  for (const r of world.receptors) {
    const c = col(r.x);
    const occ = r.main;
    const ch = !occ ? '_' : isAntagonist(world, occ, r.family) ? 'x' : r.signal > 0.5 ? 'L' : 'o';
    (r.pre ? pre : post)[c] = ch;
    if (r.side && c + 1 < cols) (r.pre ? pre : post)[c + 1] = '+';
  }
  for (const m of world.mols) {
    if (m.state === 'bound' || m.state === 'docked' || m.alpha <= 0) continue;
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((m.y - CLEFT_TOP) / (CLEFT_BOT - CLEFT_TOP)) * rows)));
    cleft[row][col(m.x)] = glyph(world, m);
  }
  return ['  pre  |' + pre.join('') + '|', ...cleft.map((r) => '  cleft|' + r.join('') + '|'), '  post |' + post.join('') + '|'];
}

// ---------------------------------------------------------------------------------------------------------
// Narration

type Window = {
  from: number;
  to: number;
  events: Map<string, number>;
  litFrames: Map<string, { lit: number; target: number; frames: number }>;
  blockFrames: Map<string, { blocked: number; expected: number; frames: number }>;
  molFrames: Map<NT, { count: number; target: number; frames: number }>;
  edgeLoiter: number;
  hovering: number;
  scatter: { sum: number; n: number };
};

export function narrate(sels: Selection[], opts: { every?: number; events?: boolean; seed?: number } = {}) {
  const every = opts.every ?? 0.5;
  const result: SimResult = simulate(sels);
  const world = createWorld(result, seededRandom(opts.seed ?? 11));
  for (let i = 0; i < 240; i++) stepWorld(world, 0, 1 / FPS);

  const out: string[] = [];
  const combo = sels.map((s) => `${s.id}${s.intensity !== 'typical' ? ':' + s.intensity : ''}${s.offset ? ':+' + s.offset : ''}`).join(' + ');
  out.push(`# Animation narration: ${combo}`, '');
  out.push(`Playback: ${RUN_SECONDS} s for ${DURATION} simulated hours at ${FPS} fps (${FRAMES} frames), seed ${opts.seed ?? 11}.`);
  out.push(`Transmitters drawn: ${world.nts.map((n) => NT_INFO[n].name).join(' and ')}.`);
  const families = [...new Set(world.receptors.map((r) => r.family))];
  out.push(
    `Receptors drawn: ${families
      .map((f) => {
        const g = world.receptors.filter((r) => r.family === f);
        return `${f} ×${g.length} (${g[0].pre ? 'on the sending neuron' : 'on the receiving neuron'}${g[0].lig ? `, natural messenger ${ENDOGENOUS[g[0].lig].name}` : ''})`;
      })
      .join('; ')}.`,
  );
  out.push(`Transporters drawn: ${[...new Set(world.pumps.map((p) => (p.enzyme ? 'AChE (enzyme)' : NT_INFO[p.nt].transporter)))].join(', ')}.`);

  // Static checks: things the picture can't show at all.
  const staticFlags: string[] = [];
  for (const s of world.subs)
    for (const r of s.sub.sim.receptors.filter((x) => x.direct))
      if (!families.includes(r.family))
        staticFlags.push(`${s.sub.name} acts at ${r.family}, but no ${r.family} receptors are drawn (the synapse only has room for four receptor types), so its main action is not visible.`);
  for (const s of world.subs)
    for (const n of Object.keys(s.sub.sim.clearance) as NT[])
      if ((s.sub.sim.clearance[n] ?? 0) >= 0.3 && !world.nts.includes(n))
        staticFlags.push(`${s.sub.name} blocks clearance of ${NT_INFO[n].name}, which is not one of the two transmitters drawn.`);
  out.push('', '**Legend:** `P` transporter working, `#` transporter blocked by a docked drug, `R` transporter reversed (pumping out),');
  out.push('`L` receptor activated, `x` receptor blocked by an antagonist, `o` occupied but not yet lit, `_` empty, `+` drug on a modulator site,');
  out.push(`${world.nts.map((n) => `\`${NT_CHAR[n]}\` ${NT_INFO[n].name}`).join(', ')}, \`*\` natural messenger, ${world.subs.map((s) => `\`${s.slot + 1}\` ${s.sub.name}`).join(', ')}.`);
  if (staticFlags.length) out.push('', ...staticFlags.map((f) => `- FLAG (layout): ${f}`));
  out.push('');

  const flagsAll: string[] = [];
  const prevMain = new Map<Receptor, Mol | null>(world.receptors.map((r) => [r, r.main]));
  const prevSide = new Map<Receptor, Mol | null>(world.receptors.map((r) => [r, r.side]));
  const prevLit = new Map<Receptor, boolean>(world.receptors.map((r) => [r, r.signal > 0.5]));
  const prevPlug = new Map(world.pumps.map((p) => [p, p.plug]));
  let prevMols = new Map<Mol, Mol['state']>(world.mols.map((m) => [m, m.state]));
  const edgeSince = new Map<Mol, number>();
  const hoverSince = new Map<Mol, number>();
  const bornAt = new Map<Mol, number>();
  let hoverTotal = 0;
  const scatterAll: number[] = [];
  const firsts = new Set<string>();
  const verbose: string[] = [];

  const framesPerWindow = Math.round((every / DURATION) * FRAMES);
  let win: Window = newWindow(0);
  function newWindow(from: number): Window {
    return { from, to: from + every, events: new Map(), litFrames: new Map(), blockFrames: new Map(), molFrames: new Map(), edgeLoiter: 0, hovering: 0, scatter: { sum: 0, n: 0 } };
  }
  const note = (t: number, msg: string, notable = false) => {
    win.events.set(msg, (win.events.get(msg) ?? 0) + 1);
    if (opts.events) verbose.push(`  ${t.toFixed(2)} h  ${msg}`);
    if (notable && !firsts.has(msg)) {
      firsts.add(msg);
      win.events.set(`FIRST: ${msg}`, 1);
    }
  };

  for (let f = 0; f < FRAMES; f++) {
    const t = (f / FRAMES) * DURATION;
    stepWorld(world, t, 1 / FPS);

    // molecules appearing
    for (const m of world.mols) {
      if (prevMols.has(m)) continue;
      if (m.kind === 'nt') {
        const pump = world.pumps.find((p) => p.nt === m.nt && p.reverse > 0.15 && Math.abs(p.x - m.x) < 6);
        note(t, pump ? `${NT_INFO[m.nt!].name} pumped OUT through reversed ${NT_INFO[m.nt!].transporter}` : `${NT_INFO[m.nt!].name} released from a vesicle`, !!pump);
      } else if (m.kind === 'drug') note(t, `${label(world, m)} molecule entered the cleft`);
      else note(t, `${label(world, m)} arrived`);
    }
    // molecules leaving
    const now = new Map<Mol, Mol['state']>(world.mols.map((m) => [m, m.state]));
    for (const [m, state] of prevMols) {
      if (now.has(m) && m.alpha > 0) continue;
      if (state === 'uptake') {
        const p = world.pumps[m.pump!];
        note(t, p?.enzyme ? `${label(world, m)} broken down by AChE` : `${label(world, m)} taken back up by ${p ? NT_INFO[p.nt].transporter : 'a transporter'}`);
      } else if (m.kind === 'drug') note(t, `${label(world, m)} molecule cleared from the cleft`);
      else if (m.kind === 'endo') note(t, `${label(world, m)} broken down`);
      else note(t, `${label(world, m)} faded out`);
    }
    // uptake refused (blocked transporter sends it back)
    for (const m of world.mols) if (prevMols.get(m) === 'uptake' && m.state === 'free') note(t, `${label(world, m)} turned away at a blocked transporter`);

    // receptors
    for (const r of world.receptors) {
      const before = prevMain.get(r) ?? null;
      const after = r.main;
      if (before !== after) {
        if (before && after) note(t, `${label(world, after)} displaced ${label(world, before)} at ${r.family}`, true);
        else if (after) {
          const blocks = isAntagonist(world, after, r.family);
          note(t, `${label(world, after)} bound ${r.family}${blocks ? ' and BLOCKED it' : ''}`, blocks);
        } else if (before) note(t, `${label(world, before)} let go of ${r.family}`);
      }
      const sBefore = prevSide.get(r) ?? null;
      if (sBefore !== r.side && r.side) note(t, `${label(world, r.side)} bound the modulator site on ${r.family}`, true);
      const lit = r.signal > 0.5;
      if (lit !== prevLit.get(r)) note(t, `${r.family} receptor ${lit ? 'lit up' : 'went dark'}`);
      prevMain.set(r, after);
      prevSide.set(r, r.side);
      prevLit.set(r, lit);
    }
    // transporters
    for (const p of world.pumps) {
      const before = prevPlug.get(p) ?? null;
      if (before !== p.plug) {
        if (p.plug) note(t, `${label(world, p.plug)} docked in ${NT_INFO[p.nt].transporter}, blocking it`, true);
        else if (before) note(t, `${label(world, before)} left ${NT_INFO[p.nt].transporter}`);
        prevPlug.set(p, p.plug);
      }
    }
    prevMols = now;

    // running comparisons with the model for this window
    for (const fam of families) {
      const g = world.receptors.filter((r) => r.family === fam);
      const blocked = g.filter((r) => r.main && isAntagonist(world, r.main, fam)).length;
      const lit = g.filter((r) => r.signal > 0.5).length;
      const target = Math.min(g.length - blocked, g.length * targetOccupancy(familyDrive(world, t, fam)));
      const acc = win.litFrames.get(fam) ?? { lit: 0, target: 0, frames: 0 };
      acc.lit += lit / g.length;
      acc.target += target / g.length;
      acc.frames++;
      win.litFrames.set(fam, acc);
      // an antagonist should hold roughly as many receptors as its activity implies. Molecules need travel
      // time to reach receptors (~0.5 s of playback), so compare with activity TRAVEL_LAG hours earlier.
      const antagonistActivity = world.directActions
        .filter((d) => d.family === fam && d.mode === 'antagonist')
        .reduce((a, d) => a + sample(world.subs[d.subIdx].activity, Math.max(0, t - TRAVEL_LAG)), 0);
      if (antagonistActivity > 0) {
        const b = win.blockFrames.get(fam) ?? { blocked: 0, expected: 0, frames: 0 };
        b.blocked += blocked / g.length;
        b.expected += Math.min(0.9, antagonistActivity);
        b.frames++;
        win.blockFrames.set(fam, b);
      }
    }
    for (const n of world.nts) {
      const count = world.mols.filter((m) => m.kind === 'nt' && m.nt === n && m.state !== 'fade').length;
      const acc = win.molFrames.get(n) ?? { count: 0, target: 0, frames: 0 };
      acc.count += count;
      acc.target += moleculeTarget(sample(result.cleft[n], t));
      acc.frames++;
      win.molFrames.set(n, acc);
    }
    for (const m of world.mols) {
      if (m.kind !== 'drug' || m.state !== 'free') {
        edgeSince.delete(m);
        continue;
      }
      if (m.x < 95 || m.x > W - 95) {
        if (!edgeSince.has(m)) edgeSince.set(m, f);
        if (f - edgeSince.get(m)! === FPS * 3) win.edgeLoiter++;
      } else edgeSince.delete(m);
    }

    // Hovering: a loose molecule parked just above receptors for 1.5 s without binding.
    for (const m of world.mols) if (!bornAt.has(m)) bornAt.set(m, f);
    for (const m of world.mols) {
      const nearSeat =
        m.state === 'free' &&
        world.receptors.some((r) => Math.abs(r.x - m.x) < 30 && (r.pre ? m.y < CLEFT_TOP + 20 : m.y > CLEFT_BOT - 20));
      if (!nearSeat) {
        hoverSince.delete(m);
        continue;
      }
      if (!hoverSince.has(m)) hoverSince.set(m, f);
      if (f - hoverSince.get(m)! === Math.round(FPS * 1.5)) {
        win.hovering++;
        hoverTotal++;
      }
    }
    // Scatter: Clark-Evans ratio of loose molecules (1 = randomly scattered, well below 1 = clumped).
    // Molecules younger than 0.5 s (fresh release bursts) and ones heading for a pump or receptor are left out.
    if (f % 10 === 0) {
      const pts = world.mols.filter((m) => m.state === 'free' && !m.aim && f - (bornAt.get(m) ?? f) > FPS * 0.5);
      if (pts.length >= 6) {
        const area = (W - 140) * (CLEFT_BOT - CLEFT_TOP);
        const nn = pts.map((a) => Math.min(...pts.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
        const R = nn.reduce((x, y) => x + y, 0) / nn.length / (0.5 * Math.sqrt(area / pts.length));
        win.scatter.sum += R;
        win.scatter.n++;
        scatterAll.push(R);
      }
    }

    // close the window
    if ((f + 1) % framesPerWindow === 0 || f === FRAMES - 1) {
      const tEnd = ((f + 1) / FRAMES) * DURATION;
      const k = (n: NT) => sample(result.cleft[n], tEnd);
      const sig = (n: NT) => sample(result.nt[n], tEnd);
      out.push(`## ${win.from.toFixed(1)}–${Math.min(DURATION, tEnd).toFixed(1)} h`, '');
      const activeRules = result.rules.filter((r) => sample(r.overlap, tEnd) > 0.1).map((r) => r.kind);
      out.push(
        `Model: ${world.nts.map((n) => `${NT_INFO[n].name} cleft ${k(n).toFixed(2)}× / signaling ${sig(n).toFixed(2)}×, ${NT_INFO[n].transporter} ${Math.round(sample(result.blockade[n], tEnd) * 100)}% blocked${sample(result.reversal[n], tEnd) > 0.15 ? ', reversed' : ''}`).join('; ')}.` +
          ` Substance activity: ${world.subs.map((s) => `${s.sub.name} ${sample(s.activity, tEnd).toFixed(2)}`).join(', ')}.` +
          (activeRules.length ? ` Rules active: ${activeRules.join(', ')}.` : ''),
      );
      out.push('');
      const events = [...win.events.entries()].sort((a, b) => (a[0].startsWith('FIRST') ? -1 : b[0].startsWith('FIRST') ? 1 : b[1] - a[1]));
      out.push('What happened:');
      if (!events.length) out.push('- nothing changed');
      for (const [msg, n] of events) out.push(msg.startsWith('FIRST') ? `- **${msg}**` : `- ${msg}${n > 1 ? ` ×${n}` : ''}`);
      out.push('', '```', ...picture(world), '```', '');

      // flags for this window
      const flags: string[] = [];
      for (const [n, acc] of win.molFrames) {
        const c = acc.count / acc.frames;
        const tg = acc.target / acc.frames;
        if (Math.abs(c - tg) > Math.max(4, tg * 0.6)) flags.push(`${NT_INFO[n].name}: animation averaged ${c.toFixed(1)} molecules but the model level calls for about ${tg.toFixed(1)}.`);
      }
      for (const [fam, acc] of win.litFrames) {
        const lit = acc.lit / acc.frames;
        const tg = acc.target / acc.frames;
        if (Math.abs(lit - tg) > 0.45) flags.push(`${fam}: ${Math.round(lit * 100)}% of receptors lit on average, model calls for about ${Math.round(tg * 100)}%.`);
      }
      for (const [fam, acc] of win.blockFrames) {
        const shown = acc.blocked / acc.frames;
        const expected = acc.expected / acc.frames;
        if (expected > 0.3 && shown < expected - 0.4)
          flags.push(`${fam}: antagonist activity implies about ${Math.round(expected * 100)}% of receptors blocked, animation showed ${Math.round(shown * 100)}%.`);
      }
      for (const s of world.subs) {
        const a = sample(s.activity, tEnd);
        const visible = world.mols.some((m) => m.kind === 'drug' && m.sub === world.subs.indexOf(s) && m.state !== 'fade');
        if (a > 0.3 && !visible) flags.push(`${s.sub.name} activity is ${a.toFixed(2)} but none of its molecules are on screen.`);
        if (a < 0.02 && visible) flags.push(`${s.sub.name} activity is ~0 but its molecules are still on screen.`);
      }
      for (const n of world.nts) {
        const b = sample(result.blockade[n], tEnd);
        const plugged = world.pumps.some((p) => p.nt === n && p.plug);
        const reversed = sample(result.reversal[n], tEnd) > 0.15;
        if (b > 0.5 && !plugged && !reversed && !world.pumps.find((p) => p.nt === n)?.enzyme) flags.push(`${NT_INFO[n].transporter} is ${Math.round(b * 100)}% blocked in the model but no drug is shown docked in it.`);
        if (sample(result.reversal[n], tEnd) > 0.3 && !events.some(([msg]) => msg.includes('pumped OUT'))) flags.push(`${NT_INFO[n].transporter} is reversed in the model but no molecules were pumped out in this window.`);
      }
      const scatterR = win.scatter.n ? win.scatter.sum / win.scatter.n : null;
      out.push(`Animation texture: ${win.hovering} molecule(s) hovered above receptors for 1.5 s+ without binding; scatter ratio ${scatterR === null ? 'n/a' : scatterR.toFixed(2)} (1 = random, lower = clumped).`, '');
      if (win.hovering >= 5)
        flags.push(`${win.hovering} molecules hovered just above receptors for 1.5 s+ without binding (unbound molecules should diffuse back into the cleft).`);
      if (win.edgeLoiter) flags.push(`${win.edgeLoiter} drug molecule(s) sat at the edge of the picture for over 3 s (no drawn target to move toward).`);
      if (flags.length) {
        out.push('FLAGS:');
        for (const fl of flags) out.push(`- ${fl}`);
        out.push('');
        flagsAll.push(...flags.map((fl) => `${win.from.toFixed(1)} h: ${fl}`));
      }
      win = newWindow(tEnd);
    }
  }

  const summary = [
    '# Summary',
    '',
    `${combo}: ${flagsAll.length + staticFlags.length} flag(s).`,
    ...staticFlags.map((f) => `- layout: ${f}`),
    ...flagsAll.map((f) => `- ${f}`),
    '',
  ];
  if (opts.events) out.push('# Every event', '', '```', ...verbose, '```');
  const meanScatter = scatterAll.length ? scatterAll.reduce((a, b) => a + b, 0) / scatterAll.length : null;
  return { hoverTotal, meanScatter, combo, text: [...summary, ...out].join('\n'), flags: flagsAll, staticFlags };
}

/** Combinations every narration audit covers: all single substances plus combinations for each mechanism. */
export const NARRATE_COMBOS: string[][] = [
  ['caffeine:low', 'nicotine', 'alcohol'],
  ['cocaine', 'ssri'],
  ['morphine-heroin', 'opioid-antagonists:typical:+2'],
  ['antipsychotics', 'amphetamines'],
  ['alcohol', 'benzodiazepines', 'morphine-heroin'],
  ['mdma', 'maoi'],
  ['lsd', 'psilocybin'],
  ['pcp', 'alcohol'],
  ['mdma', 'ssri'],
  ['barbiturates', 'benzodiazepines'],
  ['ldopa', 'antipsychotics'],
  ['maoi', 'ssri'],
  ['amphetamines', 'cocaine'],
  ['thc', 'nicotine'],
  ['caffeine:high', 'benzodiazepines'],
  ['ssri', 'cocaine:typical:+4'],
  ...SUBSTANCES.map((s) => [s.id]),
];

if (process.argv[1]?.replace(/\\/g, '/').endsWith('verify/narrate.ts')) {
  const args = process.argv.slice(2);
  const everyIdx = args.indexOf('--every');
  const every = everyIdx >= 0 ? Number(args[everyIdx + 1]) : undefined;
  const ids = args.filter((a, i) => !a.startsWith('--') && (everyIdx < 0 || i !== everyIdx + 1));
  if (args.includes('--all')) {
    mkdirSync('verify/out', { recursive: true });
    let flagged = 0;
    const index: string[] = ['# Narration audit', ''];
    for (const c of NARRATE_COMBOS) {
      const r = narrate(c.map(parseSelection), { every });
      const file = `narration-${c.join('_').replace(/[:+]/g, '-')}.md`;
      writeFileSync(`verify/out/${file}`, r.text);
      flagged += r.flags.length;
      index.push(`- [${r.combo}](${file}): ${r.flags.length} runtime flag(s), ${r.staticFlags.length} layout note(s)`);
      console.log(r.combo.padEnd(48), `${r.flags.length} flag(s)`, r.staticFlags.length ? `· ${r.staticFlags.length} layout note(s)` : '');
      for (const f of r.flags) console.log(`    ${f}`);
    }
    writeFileSync('verify/out/narration-index.md', index.join('\n'));
    console.log(`\n${NARRATE_COMBOS.length} runs, ${flagged} runtime flag(s). Files in verify/out/ (index: narration-index.md)`);
    process.exit(flagged ? 1 : 0);
  }
  if (!ids.length) {
    console.log('Usage: npm run narrate -- <id[:intensity[:+offset]]> ... [--every 0.5] [--events]\n       npm run narrate -- --all');
    process.exit(1);
  }
  const r = narrate(ids.map(parseSelection), { every, events: args.includes('--events') });
  mkdirSync('verify/out', { recursive: true });
  const file = `verify/out/narration-${ids.join('_').replace(/[:+]/g, '-')}.md`;
  writeFileSync(file, r.text);
  console.log(r.text);
  console.log(`\nWrote ${file}`);
}
