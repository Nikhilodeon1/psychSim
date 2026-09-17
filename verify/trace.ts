/**
 * Run one simulation headlessly and print what the app would show over time.
 *
 *   npm run trace -- cocaine ssri
 *   npm run trace -- morphine-heroin opioid-antagonists:typical:+2 alcohol:low
 *   npm run trace -- lsd psilocybin --json
 *
 * Each argument is id[:low|typical|high][:0|+1|+2|+4].
 */
import { BY_ID, NT_INFO, NT_LIST, SUBSTANCES } from '../src/data/substances';
import { AXIS_INFO, DURATION, STEPS, simulate } from '../src/sim/engine';
import type { Intensity, Offset, Selection, SimResult } from '../src/sim/engine';
import { shownNTs, synapseTerms } from '../src/sim/sample';

export function parseSelection(arg: string): Selection {
  const [id, intensity = 'typical', offset = '0'] = arg.split(':');
  if (!BY_ID[id]) throw new Error(`Unknown substance "${id}". Known: ${SUBSTANCES.map((s) => s.id).join(', ')}`);
  if (!['low', 'typical', 'high'].includes(intensity)) throw new Error(`Intensity must be low, typical or high (got "${intensity}")`);
  const off = Number(offset.replace('+', ''));
  if (![0, 1, 2, 4].includes(off)) throw new Error(`Start offset must be 0, +1, +2 or +4 (got "${offset}")`);
  return { id, intensity: intensity as Intensity, offset: off as Offset };
}

const f2 = (v: number) => v.toFixed(2);
const pad = (s: string | number, n: number) => String(s).padStart(n);

export function formatTrace(r: SimResult, stepHours = 0.5): string {
  const lines: string[] = [];
  lines.push(`Substances: ${r.subs.map((s) => `${s.sub.name} (${s.sel.intensity}, +${s.sel.offset} h, potency ×${f2(s.potency)}, half-life ${f2(s.halfLife)} h${s.stretched ? ' stretched' : ''})`).join('; ')}`);
  lines.push(`Synapse shows: ${shownNTs(r).map((n) => NT_INFO[n].name).join(' + ')} | labels: ${synapseTerms(r).join(', ')}`);
  lines.push('');
  lines.push('Rules fired:');
  if (!r.rules.length) lines.push('  (none)');
  for (const rule of r.rules) {
    const peak = Math.max(...rule.overlap);
    const name = (i: number) => r.subs[i].sub.name;
    const detail =
      rule.kind === 'stacking'
        ? `${NT_INFO[rule.nt].name} via ${rule.via.join('/')} — ${rule.subs.map(name).join(' + ')}`
        : rule.kind === 'competition'
          ? `${rule.site} — ${rule.subs.map(name).join(' vs ')}${rule.antagonist !== null ? ` (blocks access: ${name(rule.antagonist)})` : ''}`
          : rule.kind === 'convergence'
            ? `${rule.subs.map(name).join(' + ')} — both depress brainstem function`
            : `${name(rule.slower)} slows ${name(rule.slowed)}`;
    lines.push(`  ${rule.kind.padEnd(12)} ${detail}  [max overlap ${f2(peak)}]`);
  }
  lines.push('');
  lines.push('Summary:');
  for (const b of r.blurb) lines.push(`  ${b}`);
  lines.push('');

  const header = ['  t h', ...NT_LIST.map((n) => pad(NT_INFO[n].short, 6)), ...NT_LIST.map((n) => pad(`blk${NT_INFO[n].short}`, 8)), ...Object.keys(AXIS_INFO).map((a) => pad(a.slice(0, 5), 6)), '  NAcc   PFC  Amyg  Stem'];
  lines.push(header.join(' '));
  for (let t = 0; t <= DURATION + 1e-9; t += stepHours) {
    const k = Math.round((t / DURATION) * STEPS);
    lines.push(
      [
        pad(t.toFixed(1), 5),
        ...NT_LIST.map((n) => pad(f2(r.nt[n][k]), 6)),
        ...NT_LIST.map((n) => pad(Math.round(r.blockade[n][k] * 100) + '%', 8)),
        ...Object.values(r.axes).map((v) => pad(Math.round(v[k]), 6)),
        ...Object.values(r.regions).map((v) => pad(Math.round(v[k] * 100), 5)),
      ].join(' '),
    );
  }
  lines.push('');
  lines.push('Axis drivers:');
  for (const [ax, d] of Object.entries(r.drivers)) lines.push(`  ${AXIS_INFO[ax as keyof typeof AXIS_INFO].label}: ${d}`);
  return lines.join('\n');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('verify/trace.ts')) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const sels = args.filter((a) => !a.startsWith('--')).map(parseSelection);
  if (!sels.length) {
    console.log('Usage: npm run trace -- <id[:intensity[:+offset]]> ...\nIds: ' + SUBSTANCES.map((s) => s.id).join(', '));
    process.exit(1);
  }
  const r = simulate(sels);
  console.log(json ? JSON.stringify({ ...r, subs: r.subs.map((s) => ({ ...s, sub: s.sub.id })) }, null, 2) : formatTrace(r));
}
