/**
 * Every word the app shows, next to the fact base, for a teacher or reviewer to check.
 *
 *   npm run content
 *
 * The simulation can be right while a card still says something a teacher would mark wrong, so this
 * pulls the visible text out of the app: library cards, glossary definitions, figure labels, axis and
 * region names, and a sample of generated summaries.
 *
 * Output: verify/out/content-review.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CLASS_ORDER, NT_INFO, NT_LIST, SUBSTANCES } from '../src/data/substances';
import type { NT } from '../src/data/substances';
import { GLOSSARY } from '../src/data/glossary';
import { ENDOGENOUS } from '../src/data/endogenous';
import { AXIS_INFO, REGION_INFO, simulate } from '../src/sim/engine';
import { FACTS, NATURAL_LIGANDS } from './reference';

const sub = (id: string) => SUBSTANCES.find((s) => s.id === id)!;
const polarity = (action: string) => (action.startsWith('Agonist / antagonist') ? 'Mixed' : action.startsWith('Agonist') ? 'Agonist' : 'Antagonist');

const out: string[] = [
  '# Content review: everything the app says',
  '',
  'The numbers can be right while the wording is still wrong. This lists the text a student (or teacher) actually reads,',
  'with the fact base beside it. Check the wording, the classification, and whether anything is stated more strongly than the evidence supports.',
  '',
  '## 1. Drug library cards',
  '',
  'Each card in the app shows: name, examples, class, agonist/antagonist tag, what it acts at, the mechanism sentence, and the neurotransmitter systems.',
  '',
];

for (const cls of CLASS_ORDER) {
  const items = SUBSTANCES.filter((s) => s.cls === cls);
  out.push(`### ${cls} (${items.length})`, '');
  for (const s of items) {
    const f = FACTS[s.id];
    out.push(`**${s.name}**${s.examples ? ` — _${s.examples}_` : ''}`, '');
    out.push('| Shown in the app | Fact base says |');
    out.push('|---|---|');
    out.push(`| Class: ${s.cls} | ${f.cls} |`);
    out.push(`| Tag: ${polarity(s.action)} (full text "${s.action}") | ${f.polarity} |`);
    out.push(`| Acts at: ${s.target} | ${f.sites ? Object.entries(f.sites).map(([site, mode]) => `${site} (${mode})`).join('; ') : '—'}${f.blocksClearance ? `; blocks ${Object.entries(f.blocksClearance).map(([n, via]) => `${NT_INFO[n as NT].name} ${via}`).join(', ')}` : ''}${f.reverses ? `; reverses ${f.reverses.map((n) => NT_INFO[n].name).join(', ')}` : ''} |`);
    out.push(`| Systems: ${s.systems.map((n) => NT_INFO[n].name).join(', ') || '—'}${s.otherSystems ? ` + ${s.otherSystems.join(', ')}` : ''} | ${f.systems.map((n) => NT_INFO[n].name).join(', ') || '—'} |`);
    out.push(`| Timing: peak ${s.sim.peak} h, half-life ${s.sim.halfLife} h | peak ${f.tmax[0]}–${f.tmax[1]} h, half-life ${f.halfLife ? `${f.halfLife[0]}–${f.halfLife[1]} h` : 'not first-order'} |`);
    out.push('');
    out.push(`> Mechanism sentence: **"${s.mechanism}"**`);
    out.push('');
    if (s.teachingNote) out.push(`> Note shown: "${s.teachingNote}"`, '');
    if (f.note) out.push(`> Fact-base note: ${f.note}`, '');
    out.push(`> Chart label used for this drug: "${s.tag}"`, '');
    out.push('_Reviewer notes:_', '');
  }
}

out.push('## 2. Glossary definitions (shown on hover/tap)', '', '| Term | Definition shown |', '|---|---|');
for (const [term, g] of Object.entries(GLOSSARY)) out.push(`| ${term}${g.full ? ` (${g.full})` : ''} | ${g.def} |`);
out.push('', '_Reviewer notes:_', '');

out.push('## 3. Natural messengers drawn in the synapse', '', '| Receptor | Messenger shown | Receptor sits on | Messenger comes from | Fact base |', '|---|---|---|---|---|');
for (const [family, l] of Object.entries(ENDOGENOUS)) {
  const f = NATURAL_LIGANDS[family];
  out.push(`| ${family} | ${l.name} | ${l.receptorOn} | ${l.source} | ${f ? `${f.name}, receptor ${f.receptorOn}, from ${f.source}` : 'not in fact base'} |`);
}
out.push('', '_Reviewer notes:_', '');

out.push('## 4. Figure labels and axes', '');
out.push('| Where | Text shown |', '|---|---|');
out.push('| Page title | Neurotransmitter Mechanism Simulator — Psychoactive drugs at the synapse |');
out.push('| Disclaimer (always visible) | Conceptual/educational model of neurotransmitter mechanisms and classification. Not medical guidance. Does not represent real dosing, timing, or safety information. |');
out.push('| Fig. 1 | Synapse (presynaptic neuron, synaptic cleft, postsynaptic neuron) |');
out.push('| Fig. 2 | Brain regions, with a 0–100 activity scale |');
out.push('| Fig. 3 | Neurotransmitter signaling — net effect at receptors vs. baseline (1.0×) |');
out.push('| Fig. 4 | Effect axes — 0–100, dashed line = baseline |');
for (const [k, v] of Object.entries(AXIS_INFO)) out.push(`| Effect axis "${k}" | ${v.label} (baseline ${v.base}) |`);
for (const [k, v] of Object.entries(REGION_INFO)) out.push(`| Brain region "${k}" | ${v.label} — ${v.role} |`);
for (const n of NT_LIST) out.push(`| Transmitter ${n} | ${NT_INFO[n].name}; transporter/enzyme label ${NT_INFO[n].transporter}; receptor label ${NT_INFO[n].receptor} |`);
out.push('', '_Reviewer notes:_', '');

out.push('## 5. Generated summaries (samples)', '', 'These sentences are written by the app from whichever rules fire.', '');
const samples: [string, string[]][] = [
  ['Two SERT blockers', ['cocaine', 'ssri']],
  ['Opioid + antagonist', ['morphine-heroin', 'opioid-antagonists']],
  ['Alcohol + benzodiazepine', ['alcohol', 'benzodiazepines']],
  ['Two 5-HT2A agonists', ['lsd', 'psilocybin']],
  ['D2 antagonist + amphetamine', ['antipsychotics', 'amphetamines']],
  ['MAOI + SSRI', ['maoi', 'ssri']],
  ['No shared mechanism', ['caffeine', 'nicotine']],
  ['Three depressants', ['alcohol', 'barbiturates', 'morphine-heroin']],
];
for (const [title, ids] of samples) {
  const r = simulate(ids.map((id) => ({ id, intensity: 'typical' as const, offset: 0 as const })));
  out.push(`**${title}** (${ids.map((i) => sub(i).name).join(' + ')})`, '');
  for (const b of r.blurb) out.push(`> ${b}`, '');
  out.push(`Effect-axis explanations: ${Object.entries(r.drivers).map(([ax, d]) => `_${ax}_: ${d}`).join(' · ')}`, '');
}
out.push('_Reviewer notes:_', '');

out.push('## 6. What this tool deliberately does not do', '');
out.push('- No amounts, doses or units anywhere; intensity is only Low / Typical / High.');
out.push('- No description of subjective effects or symptoms.');
out.push('- No person or body is drawn; only synapse, brain and charts.');
out.push('- Interaction rules are three teaching conventions (supra-additive clearance blockade, competition at a shared site, slowed clearance), not measured pharmacokinetics.');
out.push('- Timing is compressed into an 8-hour window; drugs with half-lives of days appear only as slow curves.');
out.push('');

mkdirSync('verify/out', { recursive: true });
writeFileSync('verify/out/content-review.md', out.join('\n'));
console.log(`Wrote verify/out/content-review.md (${SUBSTANCES.length} cards, ${Object.keys(GLOSSARY).length} glossary terms)`);
