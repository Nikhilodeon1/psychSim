import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { NT_INFO } from '../data/substances';
import { GLOSSARY } from '../data/glossary';
import { sample } from '../sim/sample';
import { H, POST_Y, PRE_Y, W, createWorld, stepWorld } from '../sim/synapseWorld';
import type { Mol } from '../sim/synapseWorld';
import { ENDOGENOUS } from '../data/endogenous';
import type { Ligand } from '../data/endogenous';
import type { SimResult } from '../sim/engine';
import { NT_COLOR, SLOT_COLOR } from '../colors';


const INK = '#4E342B';
const PRE_FILL = '#F4E4DE';
const POST_FILL = '#F1EAD2';
const PROTEIN = '#CFA38D';
const RECEPTOR_IDLE = '#D6DEE4';
const FONT = 'Lexend, system-ui, sans-serif';

type Props = {
  result: SimResult | null;
  timeRef: RefObject<number>;
  playingRef: RefObject<boolean>;
  /** Incremented by the parent whenever time is jumped (scrub, restart). */
  seekRef: RefObject<number>;
};

function drugShape(ctx: CanvasRenderingContext2D, slot: number, x: number, y: number, s: number) {
  ctx.beginPath();
  if (slot === 0) {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
  } else if (slot === 1) {
    ctx.rect(x - s * 0.72, y - s * 0.72, s * 1.44, s * 1.44);
  } else {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.95, y + s * 0.72);
    ctx.lineTo(x - s * 0.95, y + s * 0.72);
  }
  ctx.closePath();
}

function molColor(m: Mol) {
  if (m.kind === 'nt') return NT_COLOR[m.nt!];
  if (m.kind === 'endo') return ENDOGENOUS[m.lig!].color;
  return SLOT_COLOR[m.slot!];
}

/** Natural messengers: peptides as a short bead chain, lipids as head + tail, small molecules as a dot. */
function drawLigand(ctx: CanvasRenderingContext2D, lig: Ligand, x: number, y: number) {
  ctx.fillStyle = lig.color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.1;
  if (lig.shape === 'peptide') {
    for (const dx of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + (dx === 0 ? -2 : 1), 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (lig.shape === 'lipid') {
    ctx.strokeStyle = lig.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 3, y);
    ctx.quadraticCurveTo(x + 9, y - 5, x + 14, y + 1);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

export function SynapseCanvas({ result, timeRef, playingRef, seekRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ term: string; left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const world = createWorld(result);
    const subs = result?.subs ?? [];
    let raf = 0;
    let last = performance.now();
    let seenSeek = seekRef.current ?? 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(((w * H) / W) * dpr);
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const contested = new Set((result?.rules ?? []).flatMap((r) => (r.kind === 'competition' ? [r.family] : [])));
    const hasMAOI = subs.some((s) => s.sub.sim.clearanceVia === 'enzyme');

    // Hovering (or tapping) a transporter, enzyme or receptor group shows its definition.
    const hitTest = (x: number, y: number): string | null => {
      const { pumps, receptors } = world;
      for (const i of [0, 2]) {
        const [a, b] = [pumps[i], pumps[i + 1]];
        if (a.enzyme) {
          if (x > a.x - 40 && x < b.x + 40 && y > POST_Y - 75 && y < POST_Y - 15) return 'AChE';
        } else if (x > a.x - 45 && x < b.x + 45 && y > PRE_Y - 85 && y < PRE_Y + 22) return NT_INFO[a.nt].transporter;
      }
      if (hasMAOI && y > 70 && y < 130 && [280, 680].some((mx) => Math.abs(mx - x) < 70)) return 'MAO';
      for (const r of receptors) {
        const group = receptors.filter((g) => g.family === r.family);
        const inY = r.pre ? y > PRE_Y - 60 && y < PRE_Y + 30 : y > POST_Y - 30 && y < POST_Y + 96;
        if (x > group[0].x - 22 && x < group[group.length - 1].x + 22 && inY) return r.family;
      }
      return null;
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      const y = ((e.clientY - rect.top) / rect.height) * H;
      const term = hitTest(x, y);
      canvas.style.cursor = term ? 'help' : '';
      setTip(term ? { term, left: e.clientX - rect.left, top: e.clientY - rect.top, width: rect.width } : null);
    };
    const onLeave = () => setTip(null);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    const step = (dt: number) => stepWorld(world, timeRef.current ?? 0, dt);

    const bilayer = (y: number, dir: 1 | -1, from: number, to: number, gaps: number[]) => {
      for (let x = from; x <= to; x += 9) {
        if (gaps.some((g) => Math.abs(g - x) < 18)) continue;
        ctx.strokeStyle = '#B09082';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 1.4, y + dir * 3);
        ctx.lineTo(x - 1.4, y + dir * 9);
        ctx.moveTo(x + 1.4, y + dir * 3);
        ctx.lineTo(x + 1.4, y + dir * 9);
        ctx.stroke();
        ctx.fillStyle = '#E9C6B5';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.9;
        for (const hy of [y, y + dir * 12]) {
          ctx.beginPath();
          ctx.arc(x, hy, 3.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    };

    const label = (text: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign } = {}) => {
      ctx.font = `${o.weight ?? 400} ${o.size ?? 13}px ${FONT}`;
      ctx.fillStyle = o.color ?? '#7A6258';
      ctx.textAlign = o.align ?? 'left';
      ctx.fillText(text, x, y);
    };

    const draw = () => {
      const t = timeRef.current ?? 0;
      const { nts, receptors, pumps, vesicles, mols } = world;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);

      // presynaptic terminal
      ctx.beginPath();
      ctx.moveTo(430, -4);
      ctx.bezierCurveTo(430, 40, 60, 30, 60, 120);
      ctx.lineTo(60, PRE_Y - 36);
      ctx.quadraticCurveTo(60, PRE_Y + 6, 100, PRE_Y + 6);
      ctx.lineTo(W - 100, PRE_Y + 6);
      ctx.quadraticCurveTo(W - 60, PRE_Y + 6, W - 60, PRE_Y - 36);
      ctx.lineTo(W - 60, 120);
      ctx.bezierCurveTo(W - 60, 30, 530, 40, 530, -4);
      ctx.closePath();
      ctx.fillStyle = PRE_FILL;
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = INK;
      ctx.stroke();

      // postsynaptic neuron
      ctx.beginPath();
      ctx.moveTo(40, H + 4);
      ctx.lineTo(40, POST_Y + 34);
      ctx.quadraticCurveTo(40, POST_Y - 6, 80, POST_Y - 6);
      ctx.lineTo(W - 80, POST_Y - 6);
      ctx.quadraticCurveTo(W - 40, POST_Y - 6, W - 40, POST_Y + 34);
      ctx.lineTo(W - 40, H + 4);
      ctx.closePath();
      ctx.fillStyle = POST_FILL;
      ctx.fill();
      ctx.stroke();

      bilayer(PRE_Y, -1, 94, W - 94, [...pumps.filter((p) => !p.enzyme).map((p) => p.x), ...receptors.filter((r) => r.pre).map((r) => r.x)]);
      bilayer(POST_Y, 1, 74, W - 74, receptors.filter((r) => !r.pre).map((r) => r.x));

      label('Presynaptic neuron', 16, 30, { size: 18, weight: 500, color: '#5C4137' });
      label('Synaptic', 6, (PRE_Y + POST_Y) / 2 - 4, { size: 15, color: '#9B8378' });
      label('cleft', 6, (PRE_Y + POST_Y) / 2 + 14, { size: 15, color: '#9B8378' });
      label('Postsynaptic neuron', 76, H - 18, { size: 18, weight: 500, color: '#5C4137' });

      // MAO inside the terminal, shown only when an MAO inhibitor is selected
      if (result && hasMAOI) {
        [[280, 110], [680, 110]].forEach(([x, y], i) => {
          const inhib = sample(result.enzymeBlock[nts[i]], t);
          ctx.fillStyle = inhib > 0.2 ? '#DCD3CF' : '#C58F7A';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, 13, 0.5, Math.PI * 2 - 0.5);
          ctx.lineTo(x, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          label(inhib > 0.2 ? `MAO ${Math.round(inhib * 100)}% inhibited` : 'MAO', x, y - 22, { size: 15, align: 'center' });
        });
      }

      // vesicles
      for (const v of vesicles) {
        const fuse = v.phase === 'fusing' ? v.t / 0.45 : 0;
        ctx.globalAlpha = 1 - fuse;
        ctx.beginPath();
        ctx.arc(v.x, v.y, 16 + fuse * 5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.fillStyle = NT_COLOR[v.nt];
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + v.hx;
          ctx.beginPath();
          ctx.arc(v.x + Math.cos(a) * 7.5, v.y + Math.sin(a) * 7.5, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // transporters and enzymes
      for (const p of pumps) {
        if (p.enzyme) {
          const y = POST_Y - 34;
          ctx.fillStyle = '#B9CF96';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4;
          const mouth = 0.35 + Math.abs(Math.sin(p.phase)) * 0.35;
          ctx.beginPath();
          ctx.arc(p.x, y, 12, mouth, Math.PI * 2 - mouth);
          ctx.lineTo(p.x, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = PROTEIN;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.6;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.roundRect(p.x + side * 9 - 7, PRE_Y - 26, 14, 40, 7);
          ctx.fill();
          ctx.stroke();
        }
        // gate slides while transporting, runs backward during efflux, stops when blocked
        const gy = PRE_Y - 6 + Math.sin(p.phase) * 10;
        ctx.strokeStyle = p.stall > 0.5 ? '#A58A7E' : NT_COLOR[p.nt];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x - 3, gy);
        ctx.lineTo(p.x + 3, gy);
        ctx.stroke();
        if (p.reverse > 0.15) {
          ctx.strokeStyle = NT_COLOR[p.nt];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, PRE_Y + 16);
          ctx.lineTo(p.x, PRE_Y + 28);
          ctx.moveTo(p.x - 4, PRE_Y + 23);
          ctx.lineTo(p.x, PRE_Y + 28);
          ctx.lineTo(p.x + 4, PRE_Y + 23);
          ctx.stroke();
        }
      }
      [0, 2].forEach((i) => {
        const p = pumps[i];
        const cx = (pumps[i].x + pumps[i + 1].x) / 2;
        if (p.enzyme) {
          label('AChE breaks down ACh', 180, POST_Y - 58, { size: 15, align: 'center' });
          return;
        }
        label(`${NT_INFO[p.nt].transporter} (reuptake)`, cx, PRE_Y - 66, { size: 17, weight: 500, align: 'center', color: '#5C4137' });
        const status = p.reverse > 0.15 ? 'Reversed: pumping out' : p.stall > 0.05 ? `${Math.round(p.stall * 100)}% blocked` : 'Working normally';
        label(status, cx, PRE_Y - 44, { size: 15, align: 'center', color: p.stall > 0.4 || p.reverse > 0.15 ? '#A2381F' : '#8A7166' });
      });

      // receptors (postsynaptic ones open upward; presynaptic ones, like CB1, hang from the terminal)
      for (let i = 0; i < receptors.length; i++) {
        const r = receptors[i];
        const occ = r.main;
        const x = r.x;
        const dir = r.pre ? -1 : 1; // points into the cell that owns the receptor
        const mem = r.pre ? PRE_Y : POST_Y;
        const occColor = occ ? molColor(occ) : null;
        const blocked = !!occ && occ.kind === 'drug' && r.signal < 0.2;
        ctx.fillStyle = blocked ? '#AEB4B9' : r.signal > 0.2 && occColor ? occColor : RECEPTOR_IDLE;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.roundRect(x + side * 8 - 5.5, r.pre ? PRE_Y - 20 : POST_Y - 22, 11, 42, 5);
          ctx.fill();
          ctx.stroke();
        }
        if (blocked) {
          ctx.strokeStyle = '#6F767C';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(x - 8, mem + dir * 31);
          ctx.lineTo(x + 8, mem + dir * 31);
          ctx.stroke();
        }
        if (r.signal > 0.15) {
          // signal passed into the cell = receptor activated
          ctx.strokeStyle = occColor ?? INK;
          ctx.lineWidth = 1.6;
          ctx.globalAlpha = Math.min(1, r.signal);
          const n = r.signal > 1.2 ? 3 : 2;
          for (let k = 0; k < n; k++) {
            const ax = x + (k - (n - 1) / 2) * 6;
            const tip = mem + dir * 38;
            ctx.beginPath();
            ctx.moveTo(ax, mem + dir * 26);
            ctx.lineTo(ax, tip);
            ctx.moveTo(ax - 2.5, tip - dir * 4);
            ctx.lineTo(ax, tip);
            ctx.lineTo(ax + 2.5, tip - dir * 4);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (i === 0 || receptors[i - 1].family !== r.family) {
          const group = receptors.filter((rr) => rr.family === r.family);
          const cx = (group[0].x + group[group.length - 1].x) / 2;
          if (r.pre) label(r.family, cx, PRE_Y - 50, { size: 15, weight: 500, align: 'center', color: '#5C4137' });
          else {
            label(`${r.family} receptors`, cx, POST_Y + 68, { size: 17, weight: 500, align: 'center', color: '#5C4137' });
            if (contested.has(r.family)) label('Competing for binding sites', cx, POST_Y + 90, { size: 15, align: 'center', color: '#A2381F' });
          }
        }
      }

      // molecules
      for (const m of mols) {
        ctx.globalAlpha = Math.max(0, Math.min(1, m.alpha));
        let x = m.x;
        let y = m.y;
        if (m.state === 'bound') {
          const r = receptors.find((rr) => rr.main === m || rr.side === m);
          if (r) {
            x = r.side === m ? r.x + 19 : r.x;
            y = r.pre ? (r.side === m ? PRE_Y + 4 : PRE_Y + 18) : r.side === m ? POST_Y - 4 : POST_Y - 18;
          }
        }
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.1;
        if (m.kind === 'nt') {
          ctx.fillStyle = NT_COLOR[m.nt!];
          ctx.beginPath();
          ctx.arc(x, y, 4.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (m.kind === 'endo') {
          drawLigand(ctx, ENDOGENOUS[m.lig!], x, y);
        } else {
          if (subs[m.sub!]?.stretched) {
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = SLOT_COLOR[m.slot!];
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = INK;
          }
          drugShape(ctx, m.slot!, x, y, 7.5);
          ctx.fillStyle = SLOT_COLOR[m.slot!];
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    // Settle into a representative state before the first frame.
    for (let i = 0; i < 240; i++) step(1 / 30);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if ((seekRef.current ?? 0) !== seenSeek) {
        // Time was jumped: settle into a representative state for the new time.
        seenSeek = seekRef.current ?? 0;
        for (let n = 0; n < 45; n++) step(1 / 30);
      } else if (playingRef.current) {
        step(dt);
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    document.fonts?.ready.then(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      setTip(null);
    };
  }, [result, timeRef, playingRef, seekRef]);

  const entry = tip ? GLOSSARY[tip.term] : null;
  return (
    <>
      <canvas
        ref={canvasRef}
        className="synapse-canvas"
        role="img"
        aria-label="Synapse diagram showing neurotransmitter release, transporters and receptor binding"
      />
      {tip && entry && (
        <div
          className="canvas-tip"
          role="tooltip"
          style={{ left: Math.min(Math.max(tip.left, 130), tip.width - 130), top: tip.top }}
        >
          <b>{entry.full ?? tip.term}.</b> {entry.def}
        </div>
      )}
    </>
  );
}
