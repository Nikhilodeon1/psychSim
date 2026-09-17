import { BY_ID, NT_INFO, NT_LIST } from '../data/substances';
import type { Axis, NT, Region, Substance } from '../data/substances';

export type Intensity = 'low' | 'typical' | 'high';
export type Offset = 0 | 1 | 2 | 4;

export const INTENSITY_MULT: Record<Intensity, number> = { low: 0.55, typical: 1, high: 1.5 };
export const OFFSETS: Offset[] = [0, 1, 2, 4];

export type Selection = { id: string; intensity: Intensity; offset: Offset };

export const STACK_FACTOR = 1.3;
export const HALF_LIFE_STRETCH = 1.6;
export const DURATION = 8;
export const STEPS = 160;
const REGION_SCALE = 0.9;

export type Rule =
  | { kind: 'stacking'; nt: NT; subs: number[]; via: ('transporter' | 'enzyme')[]; overlap: number[] }
  | { kind: 'competition'; site: string; family: string; subs: number[]; antagonist: number | null; overlap: number[] }
  | { kind: 'metabolic'; slower: number; slowed: number; overlap: number[] }
  | { kind: 'convergence'; subs: number[]; overlap: number[] };

export type SimSub = {
  slot: number;
  sub: Substance;
  sel: Selection;
  mult: number;
  /** Lowest potency multiplier reached during the run (1 = undiminished). */
  potency: number;
  /** Longest effective half-life reached during the run, in hours. */
  halfLife: number;
  stretched: boolean;
  /** Effective activity over time (mult × potency × concentration curve). */
  activity: number[];
};

export type SimResult = {
  times: number[];
  subs: SimSub[];
  /** Net signaling at receptors vs. baseline (includes drugs that act directly on the receptor). */
  nt: Record<NT, number[]>;
  /** Amount of transmitter in the synaptic cleft vs. baseline (release, reuptake and breakdown only). */
  cleft: Record<NT, number[]>;
  /** Transporter (reuptake pump) blockade, 0–1. */
  blockade: Record<NT, number[]>;
  /** Enzymatic breakdown inhibition (MAO), 0–1. */
  enzymeBlock: Record<NT, number[]>;
  /** Transporter reversal (efflux), 0–1. */
  reversal: Record<NT, number[]>;
  release: Record<NT, number[]>;
  axes: Record<Axis, number[]>;
  regions: Record<Region, number[]>;
  regionBoost: Record<Region, number[]>;
  rules: Rule[];
  blurb: string[];
  drivers: Record<Axis, string>;
};

export const AXIS_INFO: Record<Axis, { label: string; base: number }> = {
  arousal: { label: 'Arousal / alertness', base: 50 },
  mood: { label: 'Mood valence', base: 50 },
  cognition: { label: 'Cognitive / motor function', base: 85 },
  load: { label: 'Physiological load', base: 12 },
};

export const REGION_INFO: Record<Region, { label: string; role: string }> = {
  accumbens: { label: 'Nucleus accumbens', role: 'Mesolimbic reward pathway (dopamine)' },
  pfc: { label: 'Prefrontal cortex', role: 'Executive function' },
  amygdala: { label: 'Amygdala', role: 'Arousal and threat appraisal' },
  brainstem: { label: 'Brainstem', role: 'Breathing and heart rate' },
};

const NT_REGION: Record<NT, Region[]> = {
  DA: ['accumbens'],
  '5HT': ['amygdala', 'pfc'],
  NE: ['amygdala'],
  GABA: ['brainstem'],
  ACh: ['pfc'],
};

function concentration(t: number, peak: number, halfLife: number): number {
  if (t <= 0) return 0;
  if (t < peak) return Math.sin((Math.PI / 2) * (t / peak)) ** 2;
  return Math.exp((-Math.LN2 * (t - peak)) / halfLife);
}

const zeros = () => new Array(STEPS + 1).fill(0);
const rec = <K extends string>(keys: readonly K[], fill: () => number[]) =>
  Object.fromEntries(keys.map((k) => [k, fill()])) as Record<K, number[]>;

const isPlural = (name: string) => /s$/.test(name);
const verb = (name: string, singular: string, plural: string) => `${name} ${isPlural(name) ? plural : singular}`;
const poss = (name: string) => (isPlural(name) ? `${name}'` : `${name}'s`);

const list = (names: string[]) =>
  names.length <= 1 ? names.join('') : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function simulate(selections: Selection[]): SimResult {
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * DURATION);
  const picked = selections.slice(0, 3).map((sel, slot) => ({ sel, slot, sub: BY_ID[sel.id] })).filter((p) => p.sub);

  // Unmodified curves, used to decide which interactions actually overlap in time.
  const raw = picked.map((p) => times.map((t) => concentration(t - p.sel.offset, p.sub.sim.peak, p.sub.sim.halfLife)));
  const overlapOf = (idx: number[], curves: number[][]) => times.map((_, k) => Math.min(...idx.map((i) => curves[i][k])));
  const overlaps = (idx: number[], curves: number[][]) => Math.max(...overlapOf(idx, curves)) > 0.15;

  const rules: Rule[] = [];

  // Rule 3 — metabolic interaction: while the slowing substance is present, the slowed one clears more slowly
  // (up to HALF_LIFE_STRETCH × its half-life at the slower's peak concentration). Nothing changes before it arrives.
  const slowedBy = picked.map(() => [] as number[]);
  picked.forEach((a, i) =>
    picked.forEach((b, j) => {
      if (i === j || !a.sub.sim.slowsClearanceOf?.includes(b.sub.id)) return;
      if (!overlaps([i, j], raw)) return;
      slowedBy[j].push(i);
      rules.push({ kind: 'metabolic', slower: i, slowed: j, overlap: [] });
    }),
  );
  const stretched = slowedBy.map((by) => by.length > 0);
  const stretchAt = (i: number, k: number) => 1 + (HALF_LIFE_STRETCH - 1) * Math.max(0, ...slowedBy[i].map((j) => raw[j][k]));
  const dt = DURATION / STEPS;
  const curves = picked.map((p, i) => {
    if (!stretched[i]) return raw[i];
    const { peak, halfLife } = p.sub.sim;
    const out = raw[i].slice();
    for (let k = 1; k <= STEPS; k++) {
      if (times[k] - p.sel.offset <= peak) continue; // absorption phase unchanged
      out[k] = out[k - 1] * Math.exp((-Math.LN2 * dt) / (halfLife * stretchAt(i, k)));
    }
    return out;
  });
  for (const r of rules) if (r.kind === 'metabolic') r.overlap = overlapOf([r.slower, r.slowed], curves);

  // Rule 2 — receptor competition at an identical binding site.
  // Dampening follows the competitor's concentration over time: none before it arrives, strongest at its peak.
  const potencyCurve = picked.map(() => times.map(() => 1));
  const dampen = (i: number, factor: number, by: number[]) => {
    for (let k = 0; k <= STEPS; k++) {
      const c = Math.max(...by.map((j) => curves[j][k]));
      potencyCurve[i][k] *= 1 - (1 - factor) * c;
    }
  };
  const sites = new Map<string, { i: number; mode: string; direct: boolean; family: string }[]>();
  picked.forEach((p, i) =>
    p.sub.sim.receptors.forEach((r) => {
      const arr = sites.get(r.site) ?? [];
      if (!arr.some((e) => e.i === i)) arr.push({ i, mode: r.mode, direct: r.direct, family: r.family });
      sites.set(r.site, arr);
    }),
  );
  for (const [site, entries] of sites) {
    if (entries.length < 2) continue;
    const direct = entries.filter((e) => e.direct);
    const antagonist = direct.find((e) => e.mode === 'antagonist');
    let involved: typeof entries = [];
    if (direct.length >= 2) involved = antagonist ? entries : direct;
    else if (antagonist) involved = entries;
    if (involved.length < 2) continue;
    const idx = involved.map((e) => e.i);
    if (!overlaps(idx, curves)) continue;
    for (const e of involved) {
      const others = idx.filter((j) => j !== e.i);
      if (antagonist) {
        // A competitive antagonist with higher affinity (naloxone at mu) displaces most agonist binding;
        // that is why it works as a reversal agent.
        if (e.i === antagonist.i) dampen(e.i, 0.9, others);
        else dampen(e.i, 0.12, [antagonist.i]);
      } else dampen(e.i, 0.8, others);
    }
    rules.push({
      kind: 'competition',
      site,
      family: involved[0].family,
      subs: idx,
      antagonist: antagonist ? antagonist.i : null,
      overlap: overlapOf(idx, curves),
    });
  }

  // A releaser has to be carried into the terminal by the transporter it reverses, so a blocker of that
  // transporter gets in its way: that pair competes for the transporter instead of stacking on it.
  for (const nt of NT_LIST) {
    const releasers = picked.map((p, i) => (p.sub.sim.reverses?.includes(nt) ? i : -1)).filter((i) => i >= 0);
    const blockers = picked
      .map((p, i) =>
        (p.sub.sim.clearance[nt] ?? 0) >= 0.3 && p.sub.sim.clearanceVia !== 'enzyme' && !p.sub.sim.reverses?.includes(nt) ? i : -1,
      )
      .filter((i) => i >= 0);
    for (const rI of releasers)
      for (const bI of blockers) {
        if (!overlaps([rI, bI], curves)) continue;
        dampen(rI, 0.3, [bI]);
        dampen(bI, 0.9, [rI]);
        rules.push({
          kind: 'competition',
          site: `${NT_INFO[nt].transporter} (substrate site)`,
          family: NT_INFO[nt].transporter,
          subs: [rI, bI],
          antagonist: bI,
          overlap: overlapOf([rI, bI], curves),
        });
      }
  }

  const subs: SimSub[] = picked.map((p, i) => {
    const mult = INTENSITY_MULT[p.sel.intensity];
    return {
      slot: p.slot,
      sub: p.sub,
      sel: p.sel,
      mult,
      potency: Math.min(...potencyCurve[i]),
      halfLife: p.sub.sim.halfLife * Math.max(...times.map((_, k) => (stretched[i] ? stretchAt(i, k) : 1))),
      stretched: stretched[i],
      activity: curves[i].map((c, k) => c * mult * potencyCurve[i][k]),
    };
  });

  // Rule 1 — reuptake / clearance stacking on the same neurotransmitter.
  const stacked = new Set<NT>();
  for (const nt of NT_LIST) {
    const releasers = subs.map((s, i) => (s.sub.sim.reverses?.includes(nt) ? i : -1)).filter((i) => i >= 0);
    const blockers = subs
      .map((s, i) => ((s.sub.sim.clearance[nt] ?? 0) >= 0.3 && s.sub.sim.clearanceVia !== 'enzyme' && !s.sub.sim.reverses?.includes(nt) ? i : -1))
      .filter((i) => i >= 0);
    const idx = subs
      .map((s, i) => ((s.sub.sim.clearance[nt] ?? 0) >= 0.3 && !(releasers.length && blockers.length && releasers.includes(i)) ? i : -1))
      .filter((i) => i >= 0);
    if (idx.length < 2 || !overlaps(idx, curves)) continue;
    stacked.add(nt);
    rules.push({
      kind: 'stacking',
      nt,
      subs: idx,
      via: idx.map((i) => subs[i].sub.sim.clearanceVia ?? 'transporter'),
      overlap: overlapOf(idx, subs.map((s) => s.activity)),
    });
  }

  // Two depressants at different receptors still slow the same brainstem functions.
  const depressants = subs
    .map((s, i) => (['Depressant', 'Opioid'].includes(s.sub.cls) && s.sub.sim.axes.arousal <= -10 && s.sub.sim.axes.load >= 10 ? i : -1))
    .filter((i) => i >= 0);
  if (depressants.length >= 2 && overlaps(depressants, curves))
    rules.push({ kind: 'convergence', subs: depressants, overlap: overlapOf(depressants, subs.map((s) => s.activity)) });

  const nt = rec(NT_LIST, zeros);
  const cleft = rec(NT_LIST, zeros);
  const blockade = rec(NT_LIST, zeros);
  const enzymeBlock = rec(NT_LIST, zeros);
  const reversal = rec(NT_LIST, zeros);
  const release = rec(NT_LIST, zeros);
  const axisKeys = Object.keys(AXIS_INFO) as Axis[];
  const regionKeys = Object.keys(REGION_INFO) as Region[];
  const axes = rec(axisKeys, zeros);
  const regions = rec(regionKeys, zeros);
  const regionBoost = rec(regionKeys, zeros);

  for (let k = 0; k <= STEPS; k++) {
    for (const n of NT_LIST) {
      let linear = 0;
      let reuptakePart = 0;
      let receptorPart = 0;
      let block = 0;
      let enzyme = 0;
      let rev = 0;
      let rel = 0;
      for (const s of subs) {
        const a = s.activity[k];
        const c = s.sub.sim.clearance[n] ?? 0;
        const contrib = a * (s.sub.sim.nt[n] ?? 0);
        // Drugs binding this transmitter's own receptor change signaling, not the amount in the cleft.
        const atOwnReceptor = s.sub.sim.receptors.some((r) => r.direct && r.family === NT_INFO[n].receptor);
        if (c >= 0.3) reuptakePart += contrib;
        else if (atOwnReceptor) receptorPart += contrib;
        else linear += contrib;
        if (s.sub.sim.clearanceVia === 'enzyme') enzyme += a * c;
        else block += a * c;
        if (s.sub.sim.reverses?.includes(n)) rev += a;
        if (s.sub.sim.release.includes(n)) rel += a * 0.8;
      }
      const f = stacked.has(n) ? STACK_FACTOR : 1;
      nt[n][k] = Math.max(0.15, 1 + linear + receptorPart + reuptakePart * f);
      cleft[n][k] = Math.max(0.15, 1 + linear + reuptakePart * f);
      blockade[n][k] = Math.min(0.97, block * f);
      enzymeBlock[n][k] = Math.min(0.97, enzyme * f);
      reversal[n][k] = Math.min(1, rev * 0.8);
      release[n][k] = 1 + rel;
    }

    for (const ax of axisKeys) {
      let v = AXIS_INFO[ax].base;
      for (const s of subs) v += s.activity[k] * s.sub.sim.axes[ax];
      axes[ax][k] = v;
    }
    for (const r of rules) {
      const o = r.overlap[k];
      if (r.kind === 'stacking') {
        axes.load[k] += 12 * o;
        const dir = r.nt === '5HT' ? 1 : 0.6;
        axes.arousal[k] += 6 * o * dir;
        for (const reg of NT_REGION[r.nt]) regionBoost[reg][k] += 0.35 * o;
        regionBoost.brainstem[k] += 0.2 * o;
      } else if (r.kind === 'metabolic') {
        axes.load[k] += 7 * o;
        regionBoost.brainstem[k] += 0.15 * o;
      } else if (r.kind === 'convergence') {
        // supra-additive depression of brainstem function
        axes.load[k] += 16 * o;
        axes.arousal[k] -= 8 * o;
        regionBoost.brainstem[k] += 0.4 * o;
      }
    }
    // Saturate smoothly toward 0 or 100 instead of clipping, so stronger combinations stay distinguishable.
    for (const ax of axisKeys) {
      const base = AXIS_INFO[ax].base;
      const d = axes[ax][k] - base;
      const room = d >= 0 ? 100 - base : base;
      axes[ax][k] = base + room * Math.tanh(d / room);
    }

    for (const reg of regionKeys) {
      let v = 0;
      for (const s of subs) v += s.activity[k] * s.sub.sim.regions[reg];
      // Emax-style saturation: activity approaches but never reaches the maximum.
      regions[reg][k] = 1 - Math.exp(-(v + regionBoost[reg][k]) / REGION_SCALE);
    }
  }

  return { times, subs, nt, cleft, blockade, enzymeBlock, reversal, release, axes, regions, regionBoost, rules, blurb: blurb(subs, rules), drivers: drivers(subs, rules) };
}

function blurb(subs: SimSub[], rules: Rule[]): string[] {
  const name = (i: number) => subs[i].sub.name;
  const out: string[] = [];

  // One sentence per group of substances stacking on clearance, listing every affected neurotransmitter.
  const stackGroups = new Map<string, Extract<Rule, { kind: 'stacking' }>[]>();
  for (const r of rules) {
    if (r.kind !== 'stacking') continue;
    const key = `${r.subs.join(',')}|${r.via.join(',')}`;
    stackGroups.set(key, [...(stackGroups.get(key) ?? []), r]);
  }
  for (const group of stackGroups.values()) {
    const r = group[0];
    const nts = list(group.map((g) => NT_INFO[g.nt].name.toLowerCase()));
    const allTransport = r.via.every((v) => v === 'transporter');
    out.push(
      allTransport
        ? `Combined ${list(group.map((g) => NT_INFO[g.nt].transporter))} inhibition from ${list(r.subs.map(name))} produces supra-additive synaptic ${nts} accumulation, modeled at ${STACK_FACTOR}× the linear sum.`
        : `${list(r.subs.map(name))} block ${nts} clearance through separate routes (transporter reuptake and MAO breakdown), producing supra-additive synaptic accumulation, modeled at ${STACK_FACTOR}× the linear sum.${
            group.some((g) => g.nt === '5HT') ? ' This pairing is the mechanism behind serotonin syndrome, which is why the two are not combined.' : ''
          }`,
    );
  }
  for (const r of rules) {
    if (r.kind !== 'competition') continue;
    if (r.antagonist !== null) {
      const others = r.subs.filter((i) => i !== r.antagonist);
      const indirect = others.every((i) => !subs[i].sub.sim.receptors.find((x) => x.site === r.site)?.direct);
      const substrate = r.site.includes('substrate site');
      out.push(
        substrate
          ? `${list(others.map(name))} must be carried into the terminal through ${r.family} to reverse it, and ${verb(name(r.antagonist), 'occupies', 'occupy')} that same site, so less gets in and release is smaller than ${others.length > 1 ? 'they' : 'it'} would produce alone.`
          : indirect
            ? `${poss(name(r.antagonist))} ${r.family} blockade limits postsynaptic action of the dopamine elevated by ${list(others.map(name))}, reducing net potency on each side.`
            : `Competitive antagonism at ${r.family} receptors: ${verb(name(r.antagonist), 'occupies', 'occupy')} binding sites without activating them, displacing ${list(others.map(name))} and sharply reducing net agonist potency.`,
      );
    } else {
      out.push(
        `${list(r.subs.map(name))} compete for the same ${r.family} binding site, so each reaches lower receptor occupancy, and lower effective potency, than it would alone.`,
      );
    }
  }
  for (const r of rules) {
    if (r.kind !== 'convergence') continue;
    out.push(
      `${list(r.subs.map(name))} act at different receptors, so no shared-site rule applies, but both slow the same brainstem functions; the model adds extra Physiological Load for that convergence.`,
    );
  }
  for (const r of rules) {
    if (r.kind !== 'metabolic') continue;
    out.push(
      `${verb(name(r.slower), 'slows', 'slow')} clearance of ${name(r.slowed)}, lengthening its half-life by up to ${HALF_LIFE_STRETCH}× while both are present and prolonging their overlap.${
        subs[r.slower].sub.id === 'alcohol' && subs[r.slowed].sub.id === 'cocaine'
          ? ' The liver also combines the two into cocaethylene, a longer-lasting active compound.'
          : ''
      }`,
    );
  }

  // Non-rule observation: convergence at distinct sites of the same receptor complex.
  if (out.length < 4) {
    const fam = new Map<string, Set<string>>();
    subs.forEach((s) =>
      s.sub.sim.receptors.filter((r) => r.direct).forEach((r) => {
        const m = fam.get(r.family) ?? new Set();
        m.add(`${r.site}|${s.sub.name}`);
        fam.set(r.family, m);
      }),
    );
    for (const [family, entries] of fam) {
      const sitesSeen = new Set([...entries].map((e) => e.split('|')[0]));
      if (entries.size >= 2 && sitesSeen.size === entries.size && out.length < 4) {
        const names = [...entries].map((e) => e.split('|')[1]);
        out.push(
          `${list(names)} act at distinct binding sites on the ${family} receptor complex, so there is no competition; their effects converge and sum on the same receptor, reflected in Physiological Load.`,
        );
      }
    }
  }

  if (out.length === 0) {
    if (subs.length === 1)
      out.push(`${subs[0].sub.name}: ${subs[0].sub.mechanism}`, 'Add a second or third substance to see how their mechanisms interact.');
    else if (subs.length === 0) out.push('Select a substance to run the simulation.');
    else
      out.push(
        `No modeled interaction rules fired for ${list(subs.map((s) => s.sub.name))}: they share no transporter, binding site or clearance pathway during overlapping activity, so contributions sum linearly.`,
      );
  }
  return out.slice(0, 4);
}

function drivers(subs: SimSub[], rules: Rule[]): Record<Axis, string> {
  const res = {} as Record<Axis, string>;
  for (const ax of Object.keys(AXIS_INFO) as Axis[]) {
    const ranked = subs
      .map((s) => ({ s, w: Math.abs(s.sub.sim.axes[ax]) * s.mult * s.potency }))
      .filter((x) => x.w >= 4)
      .sort((a, b) => b.w - a.w)
      .map(({ s }) => `${s.sub.tag} (${s.sub.name})`);
    const parts = [...ranked];
    if (ax === 'load') {
      for (const r of rules) {
        if (r.kind === 'stacking') parts.push(`stacked ${NT_INFO[r.nt].transporter} blockade`);
        if (r.kind === 'metabolic') parts.push(`prolonged ${subs[r.slowed].sub.name} clearance`);
        if (r.kind === 'convergence') parts.push('convergent depression of brainstem function');
      }
    }
    res[ax] = parts.length ? parts.join(' · ') : 'no substantial contribution';
  }
  return res;
}
