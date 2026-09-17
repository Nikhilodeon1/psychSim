/**
 * Sweep every combination the app allows and write a report for human or LLM review.
 *
 *   npm run audit
 *
 * Output: verify/out/audit-report.md (readable), verify/out/audit.json (machine-readable).
 * Errors are rule/fact-base mismatches or broken invariants; warnings are results worth a second look.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { NT_INFO, NT_LIST, SUBSTANCES } from '../src/data/substances';
import { AXIS_INFO, DURATION, OFFSETS, STEPS, simulate } from '../src/sim/engine';
import type { Intensity, Selection, SimResult } from '../src/sim/engine';
import { FACTS, FORBIDDEN_TEXT, RAISES_DOPAMINE } from './reference';
import { formatTrace } from './trace';

type Finding = { level: 'error' | 'warn'; combo: string; message: string };

const ids = SUBSTANCES.map((s) => s.id);
const hours = (k: number) => ((k / STEPS) * DURATION).toFixed(1);
const label = (sels: Selection[]) => sels.map((s) => `${s.id}${s.intensity !== 'typical' ? ':' + s.intensity : ''}${s.offset ? ':+' + s.offset : ''}`).join(' + ');
const findings: Finding[] = [];
const add = (level: Finding['level'], combo: string, message: string) => findings.push({ level, combo, message });

function checkRun(sels: Selection[], r: SimResult) {
  const combo = label(sels);
  for (const n of NT_LIST) {
    const peak = Math.max(...r.nt[n]);
    if (r.nt[n].some((v) => !Number.isFinite(v))) add('error', combo, `${n} has non-finite values`);
    if (peak > 5) add('warn', combo, `${NT_INFO[n].name} peaks at ${peak.toFixed(2)}× baseline (t=${hours(r.nt[n].indexOf(peak))} h)`);
    if (Math.min(...r.nt[n]) <= 0.15 + 1e-9) add('warn', combo, `${NT_INFO[n].name} hits the 0.15× floor`);
  }
  for (const [ax, vals] of Object.entries(r.axes)) {
    const sat = vals.filter((v) => v <= 1 || v >= 99).length;
    if (sat * (DURATION / STEPS) >= 0.5) add('warn', combo, `${AXIS_INFO[ax as keyof typeof AXIS_INFO].label} is pinned near 0/100 for ${(sat * DURATION / STEPS).toFixed(1)} h`);
  }
  for (const [reg, vals] of Object.entries(r.regions)) {
    const sat = vals.filter((v) => v >= 0.98).length;
    if (sat * (DURATION / STEPS) >= 1) add('warn', combo, `${reg} region is pinned near 100 for ${(sat * DURATION / STEPS).toFixed(1)} h`);
  }
  for (const rule of r.rules) {
    const peak = Math.max(...rule.overlap);
    if (peak < 0.25) add('warn', combo, `${rule.kind} rule fired with weak overlap (${peak.toFixed(2)})`);
  }
  const stackGroups = new Set(r.rules.flatMap((x) => (x.kind === 'stacking' ? [x.subs.join(',') + x.via.join(',')] : []))).size;
  const sentences = stackGroups + r.rules.filter((x) => x.kind !== 'stacking').length;
  if (sentences > 4) add('warn', combo, `${sentences} rule sentences but summary shows only 4`);
  const text = [...r.blurb, ...Object.values(r.drivers)].join(' ');
  for (const re of FORBIDDEN_TEXT) if (re.test(text)) add('error', combo, `generated text matches forbidden pattern ${re}`);
}

function expectedPairRules(a: string, b: string) {
  const fa = FACTS[a];
  const fb = FACTS[b];
  const substrateClash = NT_LIST.filter(
    (n) =>
      (fa.reverses?.includes(n) && fb.blocksClearance?.[n] === 'transporter' && !fb.reverses?.includes(n)) ||
      (fb.reverses?.includes(n) && fa.blocksClearance?.[n] === 'transporter' && !fa.reverses?.includes(n)),
  );
  return {
    stacking: NT_LIST.filter((n) => fa.blocksClearance?.[n] && fb.blocksClearance?.[n] && !substrateClash.includes(n)).sort(),
    competition:
      Object.keys(fa.sites ?? {}).some((site) => fb.sites?.[site]) ||
      (fa.sites?.D2 === 'antagonist' && RAISES_DOPAMINE.includes(b)) ||
      (fb.sites?.D2 === 'antagonist' && RAISES_DOPAMINE.includes(a)) ||
      substrateClash.length > 0,
    metabolic: (fa.slows?.includes(b) ? 1 : 0) + (fb.slows?.includes(a) ? 1 : 0),
  };
}

// 1. Solo profiles
const solo = ids.map((id) => {
  const r = simulate([{ id, intensity: 'typical', offset: 0 }]);
  const act = r.subs[0].activity;
  const peak = Math.max(...act);
  const ntPeaks = NT_LIST.map((n) => {
    const v = r.nt[n];
    const ext = v.reduce((m, x) => (Math.abs(x - 1) > Math.abs(m - 1) ? x : m), 1);
    return `${NT_INFO[n].short} ${ext.toFixed(2)}`;
  });
  const axisPeaks = Object.entries(r.axes).map(([ax, v]) => {
    const base = AXIS_INFO[ax as keyof typeof AXIS_INFO].base;
    const ext = v.reduce((m, x) => (Math.abs(x - base) > Math.abs(m - base) ? x : m), base);
    return `${ax} ${ext - base >= 0 ? '+' : ''}${Math.round(ext - base)}`;
  });
  checkRun([{ id, intensity: 'typical', offset: 0 }], r);
  return { id, peakAt: hours(act.indexOf(peak)), remainingAt8h: act[STEPS] / peak, ntPeaks, axisPeaks };
});

// 2. All pairs × intensities × offsets (second substance offset), checked against the fact base at offset 0
const intensities: Intensity[] = ['low', 'typical', 'high'];
const ruleCounts = { stacking: 0, competition: 0, metabolic: 0, convergence: 0, none: 0 };
let runs = 0;
const pairDetails: string[] = [];
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++) {
    const [a, b] = [ids[i], ids[j]];
    for (const intensity of intensities)
      for (const offset of OFFSETS) {
        const sels: Selection[] = [{ id: a, intensity, offset: 0 }, { id: b, intensity, offset }];
        const r = simulate(sels);
        runs++;
        checkRun(sels, r);
        if (intensity === 'typical' && offset === 0) {
          if (!r.rules.length) ruleCounts.none++;
          for (const rule of r.rules) ruleCounts[rule.kind]++;
          const exp = expectedPairRules(a, b);
          const gotStack = [...new Set(r.rules.flatMap((x) => (x.kind === 'stacking' ? [x.nt] : [])))].sort();
          if (JSON.stringify(gotStack) !== JSON.stringify(exp.stacking)) add('error', label(sels), `stacking ${JSON.stringify(gotStack)} but fact base expects ${JSON.stringify(exp.stacking)}`);
          if (r.rules.some((x) => x.kind === 'competition') !== exp.competition) add('error', label(sels), `competition ${!exp.competition} but fact base expects ${exp.competition}`);
          const gotMet = r.rules.filter((x) => x.kind === 'metabolic').length;
          if (gotMet !== exp.metabolic) add('error', label(sels), `metabolic ${gotMet} but fact base expects ${exp.metabolic}`);
          if (r.rules.length) pairDetails.push(`### ${a} + ${b}\n\n\`\`\`\n${formatTrace(r, 1)}\n\`\`\``);
        }
      }
  }

// 3. All triples at typical, offset 0
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++)
    for (let k = j + 1; k < ids.length; k++) {
      const sels: Selection[] = [ids[i], ids[j], ids[k]].map((id) => ({ id, intensity: 'typical', offset: 0 }));
      checkRun(sels, simulate(sels));
      runs++;
    }

// Report
const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const groupWarn = new Map<string, string[]>();
for (const w of warns) {
  const key = w.message.replace(/[\d.]+/g, '#');
  groupWarn.set(key, [...(groupWarn.get(key) ?? []), `${w.combo}: ${w.message}`]);
}

const md = [
  '# Simulation audit report',
  '',
  `Runs: ${runs} (all pairs × 3 intensities × 4 start offsets, plus all triples at typical intensity).`,
  `Errors: **${errors.length}** · Warnings: **${warns.length}** (${groupWarn.size} kinds)`,
  '',
  'Pair rule counts at typical intensity, same start time: ' + Object.entries(ruleCounts).map(([k, v]) => `${k} ${v}`).join(', '),
  '',
  '## Errors',
  errors.length ? errors.map((e) => `- ${e.combo}: ${e.message}`).join('\n') : 'None.',
  '',
  '## Warnings (grouped, first 5 examples each)',
  ...[...groupWarn.entries()].map(([, list]) => `- **${list.length}×** ${list[0].split(': ').slice(1).join(': ')}\n${list.slice(0, 5).map((x) => `  - ${x}`).join('\n')}`),
  '',
  '## Solo profiles (typical intensity)',
  '',
  '| Substance | Peak activity at | Remaining at 8 h | Most-changed NT values | Largest axis changes |',
  '|---|---|---|---|---|',
  ...solo.map((s) => `| ${s.id} | ${s.peakAt} h | ${Math.round(s.remainingAt8h * 100)}% | ${s.ntPeaks.join(', ')} | ${s.axisPeaks.join(', ')} |`),
  '',
  '## Every pair that fires a rule (typical, same start)',
  '',
  ...pairDetails,
].join('\n');

mkdirSync('verify/out', { recursive: true });
writeFileSync('verify/out/audit-report.md', md);
writeFileSync('verify/out/audit.json', JSON.stringify({ runs, ruleCounts, findings, solo }, null, 2));
console.log(`Runs ${runs} · errors ${errors.length} · warnings ${warns.length} (${groupWarn.size} kinds)`);
console.log('Report: verify/out/audit-report.md');
for (const e of errors.slice(0, 20)) console.log(`ERROR ${e.combo}: ${e.message}`);
for (const [, list] of groupWarn) console.log(`WARN ×${list.length} ${list[0]}`);
if (errors.length) process.exit(1);
