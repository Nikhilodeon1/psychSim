import type { Region } from '../data/substances';
import { Term } from './Term';

type Props = {
  values: Record<Region, number>;
  boosted: Record<Region, boolean>;
};

// Coordinates are in the source image's pixel space (960 × 1061).
const IMG_W = 960;
const IMG_H = 1061;

/** Sequential scale: none → low → high modeled activity. */
const STOPS: [number, number, number][] = [
  [226, 238, 250],
  [128, 178, 226],
  [45, 108, 186],
  [22, 54, 120],
];
function heat(v: number) {
  const x = Math.max(0, Math.min(0.999, v)) * (STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const c = STOPS[i].map((s, k) => Math.round(s + (STOPS[i + 1][k] - s) * f));
  return `rgb(${c.join(',')})`;
}
const RAMP = `linear-gradient(90deg, ${[0, 0.33, 0.66, 1].map((v) => heat(v * 0.999)).join(', ')})`;

/** Numbered markers; the same numbers label the rows of the key. */
const MARKERS: { key: Region; n: number; x: number; y: number; deep: boolean }[] = [
  { key: 'pfc', n: 1, x: 150, y: 300, deep: false },
  { key: 'accumbens', n: 2, x: 372, y: 392, deep: true },
  { key: 'amygdala', n: 3, x: 414, y: 500, deep: true },
  { key: 'brainstem', n: 4, x: 505, y: 575, deep: false },
];

const ROWS: { key: Region; n: number; label: string; note: string }[] = [
  { key: 'pfc', n: 1, label: 'Prefrontal cortex', note: 'Executive function' },
  { key: 'accumbens', n: 2, label: 'Nucleus accumbens', note: 'Reward (dopamine)' },
  { key: 'amygdala', n: 3, label: 'Amygdala', note: 'Arousal, threat' },
  { key: 'brainstem', n: 4, label: 'Brainstem', note: 'Breathing, heart rate' },
];

const pct = (v: number) => Math.round(v * 100);

export function BrainMap({ values, boosted }: Props) {
  const tint = (v: number) => ({ background: heat(v), opacity: v < 0.02 ? 0 : 0.35 + 0.6 * Math.min(1, v * 1.4) });

  return (
    <div className="brain-wrap">
      <div className="brain-figure" style={{ aspectRatio: `${IMG_W} / ${IMG_H}` }}>
        <img src="/brain.png" alt="Midline (sagittal) section of the human brain" draggable={false} />
        <div className="brain-mask" style={{ ...tint(values.pfc), maskImage: 'url(/mask-pfc.png)', WebkitMaskImage: 'url(/mask-pfc.png)' }} />
        <div className="brain-mask" style={{ ...tint(values.brainstem), maskImage: 'url(/mask-brainstem.png)', WebkitMaskImage: 'url(/mask-brainstem.png)' }} />
        <svg viewBox={`0 0 ${IMG_W} ${IMG_H}`} className="brain-overlay" aria-hidden>
          {/* mesolimbic dopamine pathway: VTA → nucleus accumbens → prefrontal cortex */}
          <path
            d="M458 412 C430 404 404 398 378 392 C320 378 250 330 170 290"
            className="pathway"
            style={{ strokeOpacity: 0.35 + values.accumbens * 0.65 }}
          />
          <circle cx="458" cy="412" r="11" className="vta" />

          <text x="474" y="398" className="brain-tag halo">VTA</text>
          {MARKERS.map((m) => (
            <g key={m.key}>
              {m.deep && <circle cx={m.x} cy={m.y} r="34" fill={heat(values[m.key])} className="deep" />}
              <circle cx={m.x} cy={m.y} r="21" className="badge" />
              <text x={m.x} y={m.y + 11} textAnchor="middle" className="badge-num">
                {m.n}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="brain-key">
        <table className="region-table">
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key}>
                <td>
                  <span className="num">{r.n}</span>
                </td>
                <td>
                  <i className="swatch" style={{ background: heat(values[r.key]) }} />
                </td>
                <td>
                  <span className="rt-name">{r.label}</span>
                  <span className="rt-note">{r.note}</span>
                </td>
                <td className="rt-val">
                  {pct(values[r.key])}
                  {boosted[r.key] && <span className="rt-boost" title="Includes extra activity from an interaction rule">+</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="scale">
          <div className="scale-bar" style={{ background: RAMP }} />
          <div className="scale-ticks">
            <span>0 · unaffected</span>
            <span>50</span>
            <span>100 · strongest effect</span>
          </div>
        </div>
        <ul className="key-notes">
          <li>Shade = how strongly the selected substances <b>affect</b> that region right now (0–100 model index). It shows strength, not direction: a depressant slowing the brainstem and a stimulant driving the accumbens both shade dark.</li>
          <li>
            <span className="key-circle" /> Deep structure, not visible in a midline cut; drawn at its approximate position.
          </li>
          <li>
            <span className="key-path" /> Dopamine pathway from the <Term term="VTA" /> to the nucleus accumbens and prefrontal cortex.
          </li>
          <li>
            <span className="rt-boost">+</span> Includes extra activity from an interaction rule.
          </li>
        </ul>
      </div>
    </div>
  );
}
