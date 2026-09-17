/** Checks the shipped substance data against the independent fact base in reference.ts. */
import { describe, expect, it } from 'vitest';
import { SUBSTANCES } from '../src/data/substances';
import { GLOSSARY } from '../src/data/glossary';
import { FACTS, FORBIDDEN_TEXT, RAISES_DOPAMINE } from './reference';

const PRIMARY = 0.3; // engine threshold for a clearance target to count as primary

describe('library coverage', () => {
  it('every substance has a reference entry and vice versa', () => {
    expect(SUBSTANCES.map((s) => s.id).sort()).toEqual(Object.keys(FACTS).sort());
  });
});

describe.each(SUBSTANCES.map((s) => [s.id, s] as const))('%s', (id, s) => {
  const f = FACTS[id];

  it('class matches textbook classification', () => {
    expect(s.cls).toBe(f.cls);
  });

  it('agonist / antagonist label matches', () => {
    const polarity = s.action.startsWith('Agonist / antagonist') ? 'Mixed' : s.action.startsWith('Agonist') ? 'Agonist' : 'Antagonist';
    expect(polarity).toBe(f.polarity);
  });

  it('lists every textbook neurotransmitter system', () => {
    for (const n of f.systems) expect(s.systems).toContain(n);
  });

  it('primary clearance targets match (transporter vs enzyme)', () => {
    const actual = Object.fromEntries(
      Object.entries(s.sim.clearance)
        .filter(([, v]) => (v ?? 0) >= PRIMARY)
        .map(([n]) => [n, s.sim.clearanceVia ?? 'transporter']),
    );
    expect(actual).toEqual(f.blocksClearance ?? {});
  });

  it('transporter reversal matches', () => {
    expect([...(s.sim.reverses ?? [])].sort()).toEqual([...(f.reverses ?? [])].sort());
  });

  it('direct binding sites and modes match', () => {
    const actual = Object.fromEntries(s.sim.receptors.filter((r) => r.direct).map((r) => [r.site, r.mode]));
    expect(actual).toEqual(f.sites ?? {});
  });

  it('indirect D2 action only for substances that raise dopamine', () => {
    const indirectD2 = s.sim.receptors.some((r) => r.site === 'D2' && !r.direct);
    expect(indirectD2).toBe(RAISES_DOPAMINE.includes(id));
  });

  it('metabolic (clearance-slowing) targets match', () => {
    expect([...(s.sim.slowsClearanceOf ?? [])].sort()).toEqual([...(f.slows ?? [])].sort());
  });

  it('time to peak is within the reference range', () => {
    expect(s.sim.peak).toBeGreaterThanOrEqual(f.tmax[0]);
    expect(s.sim.peak).toBeLessThanOrEqual(f.tmax[1]);
  });

  it('half-life is within the reference range', () => {
    if (!f.halfLife) return;
    expect(s.sim.halfLife).toBeGreaterThanOrEqual(f.halfLife[0]);
    expect(s.sim.halfLife).toBeLessThanOrEqual(f.halfLife[1]);
  });

  it('antidepressants show no acute mood change (therapeutic mood effects take weeks)', () => {
    if (id === 'ssri' || id === 'maoi') expect(s.sim.axes.mood).toBe(0);
  });

  it('effect directions match', () => {
    for (const ax of ['arousal', 'cognition'] as const) {
      const v = s.sim.axes[ax];
      const dir = f.direction[ax];
      if (dir === 0) expect(Math.abs(v), `${ax} should be near zero`).toBeLessThanOrEqual(10);
      else expect(Math.sign(v) * Math.min(1, Math.abs(v) / 5), `${ax} direction`).toBe(dir);
    }
  });

  it('strongest region matches', () => {
    if (!f.topRegion) return;
    const top = Object.entries(s.sim.regions).sort((a, b) => b[1] - a[1])[0][0];
    expect(top).toBe(f.topRegion);
  });

  it('text avoids dosing, subjective-effect and encouraging language', () => {
    for (const text of [s.mechanism, s.target, s.action, s.tag, s.teachingNote ?? '']) {
      for (const re of FORBIDDEN_TEXT) expect(text, `"${text}" matches ${re}`).not.toMatch(re);
    }
  });

  it('receptor families shown in the synapse have glossary definitions', () => {
    for (const r of s.sim.receptors) expect(GLOSSARY[r.family], r.family).toBeDefined();
  });
});
