import { NT_INFO, NT_LIST } from '../data/substances';
import type { NT } from '../data/substances';
import { DURATION, STEPS } from './engine';
import type { SimResult } from './engine';
import { ENDOGENOUS } from '../data/endogenous';
import type { Ligand } from '../data/endogenous';

/** Linear interpolation of a simulated series at time t (hours). */
export function sample(arr: number[], t: number) {
  const f = Math.max(0, Math.min(STEPS, (t / DURATION) * STEPS));
  const i = Math.floor(f);
  const j = Math.min(STEPS, i + 1);
  return arr[i] + (arr[j] - arr[i]) * (f - i);
}

/** The two neurotransmitters most affected by a run; these get drawn in the synapse. */
export function shownNTs(result: SimResult | null): NT[] {
  if (!result || result.subs.length === 0) return ['DA', '5HT'];
  const score = NT_LIST.map((n) => ({
    n,
    s:
      Math.max(...result.nt[n].map((v) => Math.abs(v - 1))) +
      Math.max(...result.blockade[n]) * 0.6 +
      Math.max(...result.reversal[n]) * 0.6,
  })).sort((a, b) => b.s - a.s);
  return [score[0].n, score[1].n];
}

/** Receptor families drawn in the synapse beyond the two neurotransmitters' own receptors (max 2). */
export function extraFamilies(result: SimResult | null): string[] {
  const own = shownNTs(result).map((n) => NT_INFO[n].receptor);
  const extra: string[] = [];
  for (const s of result?.subs ?? [])
    for (const r of s.sub.sim.receptors) if (r.direct && !own.includes(r.family) && !extra.includes(r.family)) extra.push(r.family);
  return extra.slice(0, 2);
}

/** Natural messengers drawn for the extra receptor families (e.g. endorphins when an opioid is present). */
export function synapseLigands(result: SimResult | null): { family: string; ligand: Ligand }[] {
  return extraFamilies(result).flatMap((family) => (ENDOGENOUS[family] ? [{ family, ligand: ENDOGENOUS[family] }] : []));
}

/** Labels drawn in the synapse for a run: transporters/enzymes, receptor families and natural messengers. */
export function synapseTerms(result: SimResult | null): string[] {
  const nts = shownNTs(result);
  const terms: string[] = nts.map((n) => NT_INFO[n].transporter);
  if (result?.subs.some((s) => s.sub.sim.clearanceVia === 'enzyme')) terms.push('MAO');
  const families = nts.map((n) => NT_INFO[n].receptor);
  const ligands = synapseLigands(result)
    .map((l) => l.ligand.name)
    .filter((name) => !nts.some((n) => NT_INFO[n].name === name));
  return [...terms, ...families, ...extraFamilies(result), ...ligands];
}
