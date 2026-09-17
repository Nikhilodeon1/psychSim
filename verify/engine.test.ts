/** Behavior checks for the simulation engine: interaction rules, math, invariants and generated text. */
import { describe, expect, it } from 'vitest';
import { NT_INFO, NT_LIST, SUBSTANCES } from '../src/data/substances';
import type { NT } from '../src/data/substances';
import { GLOSSARY } from '../src/data/glossary';
import { AXIS_INFO, DURATION, HALF_LIFE_STRETCH, STACK_FACTOR, STEPS, simulate } from '../src/sim/engine';
import type { Intensity, Offset, Selection, SimResult } from '../src/sim/engine';
import { synapseLigands, synapseTerms } from '../src/sim/sample';
import { ENDOGENOUS } from '../src/data/endogenous';
import { FACTS, FORBIDDEN_TEXT, NATURAL_LIGANDS, RAISES_DOPAMINE } from './reference';

const sel = (id: string, intensity: Intensity = 'typical', offset: Offset = 0): Selection => ({ id, intensity, offset });
const ids = SUBSTANCES.map((s) => s.id);
const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const));
const kinds = (r: SimResult) => r.rules.map((x) => x.kind).sort();

/** Rules the fact base says should fire for two substances taken together at time 0. */
function expectedRules(a: string, b: string) {
  const fa = FACTS[a];
  const fb = FACTS[b];
  const stacking = NT_LIST.filter((n) => fa.blocksClearance?.[n] && fb.blocksClearance?.[n]);
  const sharedSites = Object.keys(fa.sites ?? {}).filter((site) => fb.sites?.[site]);
  const antagonistVsDopamine =
    (fa.sites?.D2 === 'antagonist' && RAISES_DOPAMINE.includes(b)) || (fb.sites?.D2 === 'antagonist' && RAISES_DOPAMINE.includes(a));
  const competition = sharedSites.length > 0 || antagonistVsDopamine;
  const metabolic = (fa.slows?.includes(b) ? 1 : 0) + (fb.slows?.includes(a) ? 1 : 0);
  // A releaser needs the transporter a blocker is sitting on, so that pair competes instead of stacking.
  const substrateClash = NT_LIST.filter(
    (n) =>
      (fa.reverses?.includes(n) && fb.blocksClearance?.[n] === 'transporter' && !fb.reverses?.includes(n)) ||
      (fb.reverses?.includes(n) && fa.blocksClearance?.[n] === 'transporter' && !fa.reverses?.includes(n)),
  );
  return {
    stacking: stacking.filter((n) => !substrateClash.includes(n)),
    competition: competition || substrateClash.length > 0,
    metabolic,
  };
}

describe('interaction rules agree with the fact base for all pairs (same start time)', () => {
  it.each(pairs)('%s + %s', (a, b) => {
    const r = simulate([sel(a), sel(b)]);
    const exp = expectedRules(a, b);
    const stackedNTs = r.rules.flatMap((x) => (x.kind === 'stacking' ? [x.nt] : [])).sort();
    expect(stackedNTs, 'reuptake stacking').toEqual([...exp.stacking].sort());
    expect(r.rules.some((x) => x.kind === 'competition'), 'receptor competition').toBe(exp.competition);
    expect(r.rules.filter((x) => x.kind === 'metabolic').length, 'metabolic interactions').toBe(exp.metabolic);
  });
});

describe('textbook scenarios', () => {
  it('cocaine + SSRI: stacked serotonin reuptake inhibition', () => {
    const r = simulate([sel('cocaine'), sel('ssri')]);
    expect(r.rules.map((x) => (x.kind === 'stacking' ? x.nt : x.kind))).toEqual(['5HT']);
  });
  it('morphine + naloxone: competitive antagonism reduces agonist potency more than antagonist', () => {
    const r = simulate([sel('morphine-heroin'), sel('opioid-antagonists')]);
    const comp = r.rules.find((x) => x.kind === 'competition');
    expect(comp && comp.kind === 'competition' && comp.antagonist).toBe(1);
    expect(r.subs[0].potency).toBeLessThan(r.subs[1].potency);
  });
  it('alcohol + benzodiazepine: distinct GABA-A sites do not compete; metabolism is slowed', () => {
    const r = simulate([sel('alcohol'), sel('benzodiazepines')]);
    expect(kinds(r)).toEqual(['convergence', 'metabolic']);
    expect(r.blurb.join(' ')).toMatch(/distinct binding sites/);
  });
  it('LSD + psilocybin compete at 5-HT2A', () => {
    const r = simulate([sel('lsd'), sel('psilocybin')]);
    expect(kinds(r)).toEqual(['competition']);
  });
  it('antipsychotic blunts amphetamine dopamine effects', () => {
    const solo = simulate([sel('amphetamines')]);
    const combo = simulate([sel('amphetamines'), sel('antipsychotics')]);
    expect(Math.max(...combo.nt.DA)).toBeLessThan(Math.max(...solo.nt.DA));
  });
  it('two depressants at different receptors are reported as convergent, not as no interaction', () => {
    const r = simulate([sel('morphine-heroin'), sel('benzodiazepines')]);
    expect(kinds(r)).toEqual(['convergence']);
    expect(r.blurb.join(' ')).toMatch(/brainstem/);
    expect(r.blurb.join(' ')).not.toMatch(/No modeled interaction rules/);
    const solo = simulate([sel('morphine-heroin')]);
    expect(Math.max(...r.axes.load)).toBeGreaterThan(Math.max(...solo.axes.load) + 8);
  });
  it('a releaser and a blocker of the same transporter compete for it', () => {
    const r = simulate([sel('mdma'), sel('ssri')]);
    const comp = r.rules.find((x) => x.kind === 'competition');
    expect(comp && comp.kind === 'competition' && comp.site).toBe('SERT (substrate site)');
    expect(r.rules.some((x) => x.kind === 'stacking' && x.nt === '5HT')).toBe(false);
    const solo = simulate([sel('mdma')]);
    expect(Math.max(...r.cleft['5HT']), 'an SSRI should blunt MDMA release, not amplify it').toBeLessThan(Math.max(...solo.cleft['5HT']));
  });
  it('a competitive antagonist leaves the agonist with little potency', () => {
    expect(simulate([sel('morphine-heroin'), sel('opioid-antagonists')]).subs[0].potency).toBeLessThan(0.2);
  });
  it('caffeine + nicotine: no interaction rules', () => {
    expect(simulate([sel('caffeine'), sel('nicotine')]).rules).toEqual([]);
  });
  it('MAOI + SSRI stack on serotonin through different routes', () => {
    const r = simulate([sel('maoi'), sel('ssri')]);
    const s = r.rules.find((x) => x.kind === 'stacking');
    expect(s && s.kind === 'stacking' && [...s.via].sort()).toEqual(['enzyme', 'transporter']);
  });
});

describe('cleft amount vs. receptor signaling', () => {
  const peakChange = (r: SimResult, n: (typeof NT_LIST)[number], key: 'cleft' | 'nt') =>
    r[key][n].reduce((m, v) => (Math.abs(v - 1) > Math.abs(m) ? v - 1 : m), 0);
  it.each(['lsd', 'psilocybin', 'mescaline'])('%s acts at 5-HT2A without adding serotonin to the cleft', (id) => {
    const r = simulate([sel(id)]);
    expect(Math.abs(peakChange(r, '5HT', 'cleft'))).toBeLessThan(0.05);
    expect(peakChange(r, '5HT', 'nt')).toBeGreaterThan(0.2);
  });
  it.each(['alcohol', 'barbiturates', 'benzodiazepines', 'inhalants'])('%s boosts GABA-A signaling without adding GABA to the cleft', (id) => {
    const r = simulate([sel(id)]);
    expect(Math.abs(peakChange(r, 'GABA', 'cleft'))).toBeLessThan(0.05);
    expect(peakChange(r, 'GABA', 'nt')).toBeGreaterThan(0.2);
  });
  it('antipsychotics lower dopamine signaling but do not remove dopamine from the cleft', () => {
    const r = simulate([sel('antipsychotics')]);
    expect(peakChange(r, 'DA', 'nt')).toBeLessThan(-0.2);
    expect(Math.min(...r.cleft.DA)).toBeGreaterThanOrEqual(1);
  });
  it.each([
    ['cocaine', 'DA'],
    ['ssri', '5HT'],
    ['amphetamines', 'DA'],
    ['mdma', '5HT'],
    ['maoi', '5HT'],
    ['ldopa', 'DA'],
    ['morphine-heroin', 'DA'],
  ] as const)('%s raises %s in the cleft', (id, n) => {
    expect(peakChange(simulate([sel(id)]), n, 'cleft')).toBeGreaterThan(0.2);
  });
});

describe('timing', () => {
  it('rules do not fire when activity does not overlap', () => {
    // cocaine is mostly cleared by +4 h (half-life ~1 h)
    const r = simulate([sel('cocaine'), sel('ssri', 'typical', 4)]);
    expect(r.rules).toEqual([]);
  });
  it('a substance has no activity before its start time', () => {
    const r = simulate([sel('caffeine'), sel('nicotine', 'typical', 2)]);
    const k2 = Math.round((2 / DURATION) * STEPS);
    for (let k = 0; k <= k2; k++) expect(r.subs[1].activity[k]).toBe(0);
  });
  it('everything is at baseline at t = 0', () => {
    for (const [a, b] of pairs.slice(0, 40)) {
      const r = simulate([sel(a), sel(b)]);
      for (const n of NT_LIST) expect(r.nt[n][0]).toBe(1);
      for (const ax of Object.keys(AXIS_INFO) as (keyof typeof AXIS_INFO)[]) expect(r.axes[ax][0]).toBe(AXIS_INFO[ax].base);
    }
  });
  it('model half-life shows up in the decay curve', () => {
    const r = simulate([sel('cocaine')]);
    const act = r.subs[0].activity;
    const peakK = act.indexOf(Math.max(...act));
    const hl = FACTS.cocaine.halfLife!;
    const k1 = peakK + Math.round((1 / DURATION) * STEPS);
    const measured = Math.LN2 / Math.log(act[peakK] / act[k1]);
    expect(measured).toBeGreaterThanOrEqual(hl[0]);
    expect(measured).toBeLessThanOrEqual(hl[1]);
  });
});

describe('competition timing', () => {
  it('an antagonist given later does not reduce the agonist before it arrives, then reverses it', () => {
    const solo = simulate([sel('morphine-heroin')]);
    const combo = simulate([sel('morphine-heroin'), sel('opioid-antagonists', 'typical', 1)]);
    const k1 = Math.round((1 / DURATION) * STEPS);
    for (let k = 0; k <= k1; k++) expect(combo.subs[0].activity[k]).toBeCloseTo(solo.subs[0].activity[k], 9);
    const k15 = Math.round((1.25 / DURATION) * STEPS);
    expect(combo.subs[0].activity[k15]).toBeLessThan(solo.subs[0].activity[k15] * 0.7);
  });
  it('an antagonist alone adds almost no regional activity', () => {
    const r = simulate([sel('opioid-antagonists')]);
    for (const vals of Object.values(r.regions)) expect(Math.max(...vals)).toBeLessThan(0.1);
  });
  it('reversing an opioid lowers brainstem involvement', () => {
    const solo = simulate([sel('morphine-heroin')]);
    const combo = simulate([sel('morphine-heroin'), sel('opioid-antagonists', 'typical', 1)]);
    const k = Math.round((1.5 / DURATION) * STEPS);
    expect(combo.regions.brainstem[k]).toBeLessThan(solo.regions.brainstem[k]);
  });
});

describe('metabolic timing', () => {
  it('clearance is unchanged until the slowing substance arrives, then the curve decays more slowly', () => {
    const solo = simulate([sel('benzodiazepines')]);
    const combo = simulate([sel('benzodiazepines'), sel('alcohol', 'typical', 4)]);
    expect(combo.rules.map((r) => r.kind).sort()).toEqual(['convergence', 'metabolic']);
    const k4 = Math.round((4 / DURATION) * STEPS);
    for (let k = 0; k <= k4; k++) expect(combo.subs[0].activity[k]).toBeCloseTo(solo.subs[0].activity[k], 9);
    expect(combo.subs[0].activity[STEPS]).toBeGreaterThan(solo.subs[0].activity[STEPS]);
  });
});

describe('rule math', () => {
  it(`reuptake stacking = ${STACK_FACTOR}× the linear sum of solo effects on the stacked neurotransmitter`, () => {
    const a = simulate([sel('cocaine')]);
    const b = simulate([sel('ssri')]);
    const ab = simulate([sel('cocaine'), sel('ssri')]);
    for (let k = 1; k <= STEPS; k++) {
      const linear = a.nt['5HT'][k] - 1 + (b.nt['5HT'][k] - 1);
      expect(ab.nt['5HT'][k] - 1).toBeCloseTo(linear * STACK_FACTOR, 6);
      // non-stacked neurotransmitters stay linear
      expect(ab.nt.DA[k] - 1).toBeCloseTo(a.nt.DA[k] - 1 + (b.nt.DA[k] - 1), 6);
    }
  });
  it('receptor competition dampens each substance below its solo activity', () => {
    const a = simulate([sel('lsd')]);
    const ab = simulate([sel('lsd'), sel('psilocybin')]);
    const peak = (x: number[]) => Math.max(...x);
    expect(peak(ab.subs[0].activity)).toBeLessThan(peak(a.subs[0].activity));
    expect(ab.subs[0].potency).toBeLessThan(1);
    expect(ab.subs[1].potency).toBeLessThan(1);
  });
  it(`metabolic interaction stretches the slowed substance's half-life ${HALF_LIFE_STRETCH}×`, () => {
    const solo = simulate([sel('benzodiazepines')]);
    const combo = simulate([sel('benzodiazepines'), sel('alcohol')]);
    expect(combo.subs[0].halfLife / solo.subs[0].halfLife).toBeCloseTo(HALF_LIFE_STRETCH, 6);
    const last = STEPS;
    expect(combo.subs[0].activity[last]).toBeGreaterThan(solo.subs[0].activity[last]);
  });
  it('higher intensity never produces a smaller peak', () => {
    for (const id of ids) {
      const peaks = (['low', 'typical', 'high'] as Intensity[]).map((i) => Math.max(...simulate([sel(id, i)]).subs[0].activity));
      expect(peaks[0]).toBeLessThan(peaks[1]);
      expect(peaks[1]).toBeLessThan(peaks[2]);
    }
  });
  it('never simulates more than 3 substances', () => {
    const r = simulate([sel('caffeine'), sel('nicotine'), sel('thc'), sel('lsd')]);
    expect(r.subs.length).toBe(3);
  });
});

describe('invariants across every pair at every intensity', () => {
  const intensities: Intensity[] = ['low', 'typical', 'high'];
  it('values stay finite and within their ranges', () => {
    const bad: string[] = [];
    for (const [a, b] of pairs)
      for (const i of intensities) {
        const r = simulate([sel(a, i), sel(b, i)]);
        const tag = `${a}+${b} @${i}`;
        for (const n of NT_LIST)
          for (let k = 0; k <= STEPS; k++) {
            if (!Number.isFinite(r.nt[n][k]) || r.nt[n][k] < 0.15) bad.push(`${tag} nt.${n}[${k}]=${r.nt[n][k]}`);
            if (!(r.blockade[n][k] >= 0 && r.blockade[n][k] <= 0.97)) bad.push(`${tag} blockade.${n}[${k}]`);
          }
        for (const [ax, vals] of Object.entries(r.axes)) vals.forEach((v, k) => !(v >= 0 && v <= 100) && bad.push(`${tag} ${ax}[${k}]=${v}`));
        for (const [reg, vals] of Object.entries(r.regions)) vals.forEach((v, k) => !(v >= 0 && v <= 1) && bad.push(`${tag} ${reg}[${k}]=${v}`));
      }
    expect(bad.slice(0, 10)).toEqual([]);
  }, 60_000);
});

describe('natural messengers', () => {
  it('match the fact base (name, receptor location, source)', () => {
    for (const [family, fact] of Object.entries(NATURAL_LIGANDS)) {
      const l = ENDOGENOUS[family];
      expect(l, family).toBeDefined();
      expect({ name: l.name, receptorOn: l.receptorOn, source: l.source }, family).toEqual(fact);
    }
  });
  it('every drug-only receptor drawn in any pair or triple shows its natural messenger', () => {
    const missing = new Set<string>();
    for (const [a, b] of pairs) for (const f of synapseLigandsMissing([sel(a), sel(b)])) missing.add(f);
    expect([...missing]).toEqual([]);
  });
  it.each([
    ['morphine-heroin', 'Endorphins'],
    ['rx-opioids', 'Endorphins'],
    ['opioid-antagonists', 'Endorphins'],
    ['thc', 'Anandamide'],
    ['caffeine', 'Adenosine'],
    ['pcp', 'Glutamate'],
  ] as const)('%s shows %s', (id, name) => {
    const names = synapseLigands(simulate([sel(id), sel('ldopa')])).map((l) => l.ligand.name);
    expect(names).toContain(name);
  });
});

function synapseLigandsMissing(sels: Selection[]) {
  const r = simulate(sels);
  const shown = synapseLigands(r).map((l) => l.family);
  const own = new Set(Object.values(NT_INFO).map((n) => n.receptor));
  return synapseTerms(r).filter((t) => ENDOGENOUS[t] === undefined && !own.has(t) && t in GLOSSARY && isReceptorFamily(t) && !shown.includes(t));
}
const isReceptorFamily = (t: string) => SUBSTANCES.some((s) => s.sim.receptors.some((r) => r.family === t));

describe('card wording matches what the model does', () => {
  const NAMES: Record<string, NT> = {
    serotonin: '5HT',
    dopamine: 'DA',
    norepinephrine: 'NE',
    gaba: 'GABA',
    acetylcholine: 'ACh',
  };
  const UP = ['increas', 'rais', 'releasing', 'more '];
  const DOWN = ['reduc', 'lower', 'decreas', 'less ', 'blocking the breakdown of'];

  /**
   * Does this sentence claim the substance raises or lowers this transmitter?
   * Only counts a verb in the same clause that is not separated from the word by another transmitter,
   * so "raises dopamine by inhibiting GABA interneurons" is a claim about dopamine, not about GABA.
   */
  function claimFor(sentence: string, word: string): 'up' | 'down' | null {
    const text = sentence.toLowerCase();
    const at = text.indexOf(word);
    if (at < 0) return null;
    const bounds = [text.lastIndexOf(',', at), text.lastIndexOf(';', at), text.lastIndexOf(' and ', at), 0];
    const clause = text.slice(Math.max(...bounds), at);
    const verbs = [...UP.map((v) => [v, 'up'] as const), ...DOWN.map((v) => [v, 'down'] as const)]
      .map(([v, dir]) => ({ v, dir, at: clause.lastIndexOf(v) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => b.at - a.at);
    if (!verbs.length) return null;
    const between = clause.slice(verbs[0].at);
    if (Object.keys(NAMES).some((other) => other !== word && between.includes(other))) return null;
    return verbs[0].dir;
  }

  it.each(SUBSTANCES.map((s) => [s.id, s] as const))(
    '%s: any claim of raising or lowering a transmitter shows up in the simulation',
    (_id, sub) => {
      const r = simulate([sel(sub.id)]);
      for (const [word, nt] of Object.entries(NAMES)) {
        const claim = claimFor(sub.mechanism, word);
        if (!claim) continue;
        const ext = (arr: number[]) => arr.reduce((m, v) => (Math.abs(v - 1) > Math.abs(m - 1) ? v : m), 1);
        const cleft = ext(r.cleft[nt]);
        const signal = ext(r.nt[nt]);
        if (claim === 'up') expect(Math.max(cleft, signal), `"${sub.mechanism}" claims more ${word}`).toBeGreaterThan(1.05);
        else expect(Math.min(cleft, signal), `"${sub.mechanism}" claims less ${word}`).toBeLessThan(0.95);
      }
    },
  );

  it.each(SUBSTANCES.map((s) => [s.id, s] as const))('%s: mechanism sentence names its actual target', (_id, sub) => {
    const targets = [
      ...sub.sim.receptors.filter((x) => x.direct).map((x) => x.family.toLowerCase().replace('μ-opioid', 'opioid')),
      ...Object.keys(sub.sim.clearance).map((n) => NT_INFO[n as NT].transporter.toLowerCase()),
      ...Object.keys(sub.sim.clearance).map((n) => NT_INFO[n as NT].name.toLowerCase()),
      ...(sub.sim.clearanceVia === 'enzyme' ? ['monoamine oxidase', 'mao'] : []),
      ...(sub.sim.release.length ? ['releas'] : []),
      'reuptake',
      'synthesis',
      'precursor',
      'dopamine',
    ];
    const text = `${sub.mechanism} ${sub.target}`.toLowerCase();
    expect(targets.some((t) => text.includes(t)), `"${sub.mechanism}" should name what it acts on`).toBe(true);
  });

  it('every substance card has all the fields the library shows', () => {
    for (const s of SUBSTANCES) {
      expect(s.name.length, s.id).toBeGreaterThan(2);
      expect(s.mechanism.endsWith('.'), `${s.id} mechanism should be a sentence`).toBe(true);
      expect(s.mechanism.split(/\s+/).length, `${s.id} mechanism should stay short`).toBeLessThanOrEqual(28);
      expect(s.target.length, `${s.id} target`).toBeGreaterThan(5);
      expect(s.tag.split(/\s+/).length, `${s.id} chart tag should be a few words`).toBeLessThanOrEqual(5);
    }
  });
});

describe('AP-curriculum classification', () => {
  const EXPECTED_CLASSES: Record<string, string[]> = {
    Depressant: ['alcohol', 'barbiturates', 'benzodiazepines', 'inhalants'],
    Stimulant: ['caffeine', 'nicotine', 'amphetamines', 'cocaine', 'mdma'],
    Opioid: ['morphine-heroin', 'rx-opioids', 'opioid-antagonists'],
    Hallucinogen: ['lsd', 'psilocybin', 'mescaline', 'pcp', 'thc'],
    Other: ['ssri', 'maoi', 'antipsychotics', 'ldopa'],
  };
  it.each(Object.entries(EXPECTED_CLASSES))('%s contains exactly the expected substances', (cls, ids) => {
    expect(SUBSTANCES.filter((s) => s.cls === cls).map((s) => s.id).sort()).toEqual([...ids].sort());
  });
});

describe('generated text', () => {
  it('summary is 1-4 sentences, names every substance in a fired rule, and avoids forbidden language', () => {
    for (const [a, b] of pairs) {
      const r = simulate([sel(a), sel(b)]);
      expect(r.blurb.length).toBeGreaterThanOrEqual(1);
      expect(r.blurb.length).toBeLessThanOrEqual(4);
      const text = r.blurb.join(' ');
      for (const rule of r.rules) {
        const involved = rule.kind === 'metabolic' ? [rule.slower, rule.slowed] : rule.subs;
        for (const i of involved) expect(text, `${a}+${b}`).toContain(r.subs[i].sub.name);
      }
      for (const re of FORBIDDEN_TEXT) expect(text, `${a}+${b}`).not.toMatch(re);
      for (const d of Object.values(r.drivers)) for (const re of FORBIDDEN_TEXT) expect(d).not.toMatch(re);
    }
  });
  it('every label drawn in the synapse has a glossary definition', () => {
    for (const [a, b] of pairs) for (const t of synapseTerms(simulate([sel(a), sel(b)]))) expect(GLOSSARY[t], t).toBeDefined();
    for (const n of NT_LIST) expect(GLOSSARY[NT_INFO[n].transporter]).toBeDefined();
  });
  it('glossary definitions are short and avoid forbidden language', () => {
    for (const [term, g] of Object.entries(GLOSSARY)) {
      expect(g.def.split(/\s+/).length, term).toBeLessThanOrEqual(20);
      for (const re of FORBIDDEN_TEXT) expect(g.def, term).not.toMatch(re);
    }
  });
});
