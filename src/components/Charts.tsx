import { useState } from 'react';
import { NT_INFO, NT_LIST } from '../data/substances';
import type { Axis } from '../data/substances';
import { AXIS_INFO, DURATION, STEPS } from '../sim/engine';
import type { SimResult } from '../sim/engine';
import { NT_COLOR } from '../colors';

const pathOf = (vals: number[], x: (i: number) => number, y: (v: number) => number) =>
  vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');

function useHover() {
  const [hover, setHover] = useState<number | null>(null);
  const bind = (left: number, width: number, viewW: number) => ({
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * viewW;
      const f = (px - left) / width;
      setHover(f < 0 || f > 1 ? null : Math.round(f * STEPS));
    },
    onPointerLeave: () => setHover(null),
  });
  return { hover, bind };
}

const HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export function NTChart({ result, time }: { result: SimResult; time: number }) {
  const W = 760;
  const H = 260;
  const L = 44;
  const R = 14;
  const T = 14;
  const B = 30;
  const max = Math.max(3, Math.ceil(Math.max(...NT_LIST.flatMap((n) => result.nt[n]))));
  const x = (i: number) => L + (i / STEPS) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const { hover, bind } = useHover();
  const k = hover ?? Math.round((time / DURATION) * STEPS);
  const ticks = Array.from({ length: max + 1 }, (_, i) => i);

  return (
    <div className="chart">
      <ul className="legend">
        {NT_LIST.map((n) => (
          <li key={n}>
            <i style={{ background: NT_COLOR[n] }} />
            {NT_INFO[n].name}
            <b>{result.nt[n][k].toFixed(2)}×</b>
          </li>
        ))}
        <li className="legend-time">t = {((k / STEPS) * DURATION).toFixed(1)} h</li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" {...bind(L, W - L - R, W)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 1 ? 'grid baseline' : 'grid'} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="tick">{v}×</text>
          </g>
        ))}
        {HOURS.map((h) => (
          <text key={h} x={L + (h / DURATION) * (W - L - R)} y={H - 10} textAnchor="middle" className="tick">{h}h</text>
        ))}
        {NT_LIST.map((n) => (
          <path key={n} d={pathOf(result.nt[n], x, y)} stroke={NT_COLOR[n]} className="line" />
        ))}
        <line x1={x(k)} x2={x(k)} y1={T} y2={H - B} className="cursor" />
      </svg>
    </div>
  );
}

export function AxisCharts({ result, time }: { result: SimResult; time: number }) {
  const W = 360;
  const H = 120;
  const L = 44;
  const R = 8;
  const T = 8;
  const B = 22;
  const x = (i: number) => L + (i / STEPS) * (W - L - R);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const { hover, bind } = useHover();
  const k = hover ?? Math.round((time / DURATION) * STEPS);

  return (
    <div className="axis-grid">
      {(Object.keys(AXIS_INFO) as Axis[]).map((ax) => {
        const vals = result.axes[ax];
        const base = AXIS_INFO[ax].base;
        const area = `${pathOf(vals, x, y)}L${x(STEPS)} ${y(base)}L${x(0)} ${y(base)}Z`;
        return (
          <figure key={ax} className="axis-chart">
            <figcaption>
              <span className="fig-title">{AXIS_INFO[ax].label}</span>
              <b className="axis-val">{Math.round(vals[k])}</b>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" {...bind(L, W - L - R, W)}>
              {[0, 50, 100].map((v) => (
                <g key={v}>
                  <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
                  <text x={L - 6} y={y(v) + 4} textAnchor="end" className="tick">{v}</text>
                </g>
              ))}
              <text
                x={10}
                y={(T + H - B) / 2}
                transform={`rotate(-90 10 ${(T + H - B) / 2})`}
                textAnchor="middle"
                className="axis-label"
              >
                Score (0–100)
              </text>
              <line x1={L} x2={W - R} y1={y(base)} y2={y(base)} className="grid baseline" />
              {[0, 2, 4, 6, 8].map((h) => (
                <text key={h} x={L + (h / DURATION) * (W - L - R)} y={H - 6} textAnchor="middle" className="tick">{h}h</text>
              ))}
              <path d={area} className="axis-area" />
              <path d={pathOf(vals, x, y)} className="line axis-line" />
              <line x1={x(k)} x2={x(k)} y1={T} y2={H - B} className="cursor" />
            </svg>
            <p className="driver">
              <span>Driven by:</span> {result.drivers[ax]}
            </p>
          </figure>
        );
      })}
    </div>
  );
}
