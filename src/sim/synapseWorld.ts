/**
 * The synapse animation's particle model, independent of drawing.
 * The canvas steps this every frame; verify/log.ts steps it headlessly (with a seeded RNG) to record
 * what the animation shows over time.
 */
import { NT_INFO } from '../data/substances';
import type { NT } from '../data/substances';
import { ENDOGENOUS } from '../data/endogenous';
import { extraFamilies, sample, shownNTs } from './sample';
import type { SimResult } from './engine';

export const W = 960;
export const H = 540;
export const PRE_Y = 206; // presynaptic membrane (cleft face)
export const POST_Y = 356; // postsynaptic membrane (cleft face)
export const CLEFT_TOP = PRE_Y + 10;
export const CLEFT_BOT = POST_Y - 28;

export type Mol = {
  kind: 'nt' | 'drug' | 'endo';
  /** receptor family whose natural messenger this is (kind 'endo') */
  lig?: string;
  nt?: NT;
  slot?: number;
  sub?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: 'free' | 'bound' | 'uptake' | 'docked' | 'fade';
  timer: number;
  pump?: number;
  alpha: number;
  seed?: number;
};

export type Vesicle = { x: number; y: number; hx: number; hy: number; nt: NT; phase: 'idle' | 'moving' | 'fusing'; t: number };

export type Receptor = {
  x: number;
  family: string;
  nt: NT | null;
  /** natural messenger drawn for this receptor, when its transmitter isn't one of the two shown */
  lig: string | null;
  /** receptor sits on the presynaptic membrane (e.g. CB1) */
  pre: boolean;
  main: Mol | null;
  side: Mol | null;
  signal: number;
};

export type Pump = { x: number; nt: NT; enzyme: boolean; phase: number; stall: number; reverse: number; plug: Mol | null; emit: number };


/** How many molecules of a transmitter the cleft should show at a given modeled level (1 = baseline). */
export const moleculeTarget = (level: number) => Math.min(40, 7 * level);

let rng: () => number = Math.random;
const rand = (a: number, b: number) => a + rng() * (b - a);

/** Small deterministic RNG (mulberry32) so logged runs can be reproduced exactly. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout(result: SimResult | null) {
  const nts = shownNTs(result);

  const receptors: Receptor[] = [];
  const addGroup = (family: string, nt: NT | null, from: number, to: number, count: number, lig: string | null = null, pre = false) => {
    for (let i = 0; i < count; i++)
      receptors.push({ x: from + ((to - from) * (i + 0.5)) / count, family, nt, lig, pre, main: null, side: null, signal: 0 });
  };
  addGroup(NT_INFO[nts[0]].receptor, nts[0], 290, 450, 4);
  addGroup(NT_INFO[nts[1]].receptor, nts[1], 510, 670, 4);
  const postSlots: [number, number][] = [[110, 250], [710, 850]];
  for (const family of extraFamilies(result)) {
    const lig = ENDOGENOUS[family] ? family : null;
    if (lig && ENDOGENOUS[family].receptorOn === 'presynaptic') addGroup(family, null, 436, 524, 3, lig, true);
    else if (postSlots.length) {
      const [from, to] = postSlots.shift()!;
      addGroup(family, null, from, to, 3, lig);
    }
  }

  const pump = (x: number, nt: NT): Pump => ({ x, nt, enzyme: nt === 'ACh', phase: rng() * 6, stall: 0, reverse: 0, plug: null, emit: 0 });
  const pumps: Pump[] = [pump(140, nts[0]), pump(222, nts[0]), pump(738, nts[1]), pump(820, nts[1])];

  const vesicles: Vesicle[] = [];
  const addVes = (nt: NT, cx: number) => {
    [[-48, 150], [0, 158], [48, 150], [-24, 108], [24, 106]].forEach(([dx, y]) =>
      vesicles.push({ x: cx + dx, y, hx: cx + dx, hy: y, nt, phase: 'idle', t: rng() * 1.5 }),
    );
  };
  addVes(nts[0], 370);
  addVes(nts[1], 590);

  return { nts, receptors, pumps, vesicles, mols: [] as Mol[] };
}

export type World = ReturnType<typeof createWorld>;

export function createWorld(result: SimResult | null, random: () => number = Math.random) {
  rng = random;
  const subs = result?.subs ?? [];
  const directActions = subs.flatMap((s, i) => s.sub.sim.receptors.filter((r) => r.direct).map((r) => ({ subIdx: i, slot: s.slot, ...r })));
  return { ...layout(result), result, subs, directActions, random };
}

/** Advance the particle model by dt seconds of animation at simulation time t (hours). */
export function stepWorld(world: World, t: number, dt: number) {
  rng = world.random;
  const { result, subs, directActions } = world;
  const releaseReceptor = (m: Mol) => {
    for (const r of world.receptors) {
      if (r.main === m) r.main = null;
      if (r.side === m) r.side = null;
    }
  };

  const { nts, receptors, pumps, vesicles, mols } = world;
  const level = (n: NT) => (result ? sample(result.cleft[n], t) : 1);

  // Vesicle release keeps the number of molecules in the cleft tracking the modeled level:
  // release only while below target, and only one vesicle at a time per transmitter.
  for (const n of nts) {
    const live = mols.filter((m) => m.kind === 'nt' && m.nt === n && m.state !== 'fade').length;
    const inFlight = vesicles.filter((v) => v.nt === n && v.phase !== 'idle').length;
    const deficit = moleculeTarget(level(n)) - live;
    // a second vesicle only when far below target, so release does not overshoot
    if (deficit > 2 && inFlight < (deficit > 6 ? 2 : 1)) {
      const v = vesicles.find((ves) => ves.nt === n && ves.phase === 'idle' && ves.t <= 0);
      if (v) v.phase = 'moving';
    }
  }
  for (const v of vesicles) {
    const rel = result ? sample(result.release[v.nt], t) : 1;
    if (v.phase === 'idle') v.t -= dt * rel;
    else if (v.phase === 'moving') {
      v.y += (PRE_Y - 14 - v.y) * Math.min(1, dt * 4 * rel);
      if (v.y > PRE_Y - 19) {
        v.phase = 'fusing';
        v.t = 0;
        for (let i = 0; i < 3; i++)
          mols.push({ kind: 'nt', nt: v.nt, x: v.x + rand(-8, 8), y: CLEFT_TOP + 2, vx: rand(-30, 30), vy: rand(60, 120), state: 'free', timer: 0, alpha: 1 });
      }
    } else {
      v.t += dt;
      if (v.t > 0.45) Object.assign(v, { phase: 'idle', x: v.hx, y: v.hy, t: rand(0.3, 1) });
    }
  }

  // Transporters: blockade, reversal (efflux) and docked blocker molecules.
  pumps.forEach((p, pi) => {
    const b = result ? sample(result.blockade[p.nt], t) : 0;
    const r = result ? sample(result.reversal[p.nt], t) : 0;
    p.stall = b;
    p.reverse = r;
    const dir = r > 0.15 ? -1 : 1;
    p.phase += dt * 5 * dir * Math.max(0.03, 1 - Math.max(b, r * 0.3));
    if (r > 0.15 && !p.enzyme) {
      p.emit += dt * r * 3;
      const liveNt = mols.filter((m) => m.kind === 'nt' && m.nt === p.nt && m.state !== 'fade').length;
      if (p.emit >= 1 && liveNt < moleculeTarget(level(p.nt))) {
        p.emit = 0;
        mols.push({ kind: 'nt', nt: p.nt, x: p.x + rand(-3, 3), y: CLEFT_TOP + 2, vx: rand(-20, 20), vy: rand(50, 90), state: 'free', timer: 0, alpha: 1 });
      }
    }
    if (p.plug && (b < 0.15 || p.plug.state === 'fade')) {
      p.plug.state = 'fade';
      p.plug = null;
    }
    if (!p.plug && b > 0.2 && !p.enzyme) {
      const blocker = mols.find((m) => {
        if (m.kind !== 'drug' || m.state !== 'free') return false;
        const sim = subs[m.sub!].sub.sim;
        return (sim.clearance[p.nt] ?? 0) >= 0.3 && sim.clearanceVia !== 'enzyme' && Math.abs(m.x - p.x) < 160;
      });
      if (blocker) {
        blocker.state = 'docked';
        blocker.pump = pi;
        p.plug = blocker;
      }
    }
  });

  // Natural messengers keep a steady baseline presence at their receptors.
  for (const lig of new Set(receptors.flatMap((r) => (r.lig ? [r.lig] : [])))) {
    const group = receptors.filter((r) => r.lig === lig);
    const cx = (group[0].x + group[group.length - 1].x) / 2;
    const live = mols.filter((m) => m.kind === 'endo' && m.lig === lig && m.state !== 'fade').length;
    if (live < 5 && rng() < dt * 4) {
      const src = ENDOGENOUS[lig].source;
      const fromSide = rng() < 0.5 ? -1 : 1;
      const spawn =
        src === 'presynaptic'
          ? { x: cx + rand(-50, 50), y: CLEFT_TOP + 2, vx: rand(-20, 20), vy: rand(50, 90) }
          : src === 'postsynaptic'
            ? { x: cx + rand(-60, 60), y: CLEFT_BOT - 2, vx: rand(-20, 20), vy: rand(-90, -50) }
            : { x: cx + fromSide * 90, y: rand(CLEFT_TOP + 20, CLEFT_BOT - 20), vx: -fromSide * rand(30, 60), vy: 0 };
      mols.push({ kind: 'endo', lig, ...spawn, state: 'free', timer: rand(3, 6), alpha: 1 });
    }
  }

  // Drug molecules enter the cleft in proportion to modeled activity.
  subs.forEach((s, i) => {
    const target = Math.round(Math.min(12, sample(s.activity, t) * 10));
    const live = mols.filter((m) => m.kind === 'drug' && m.sub === i && m.state !== 'fade');
    if (live.length < target) {
      const left = rng() < 0.5;
      mols.push({ kind: 'drug', slot: s.slot, sub: i, x: left ? 70 : W - 70, y: rand(CLEFT_TOP + 10, CLEFT_BOT - 10), vx: left ? rand(40, 90) : rand(-90, -40), vy: 0, state: 'free', timer: 0, alpha: 1, seed: Math.floor(rng() * 1000) });
    } else if (live.length > target) {
      const m = live.find((mm) => mm.state === 'free') ?? live[0];
      releaseReceptor(m);
      for (const p of pumps) if (p.plug === m) p.plug = null;
      m.state = 'fade';
    }
  });

  for (const m of mols) {
    if (m.state === 'fade') {
      m.alpha -= dt * 2.5;
      continue;
    }
    if (m.state === 'docked') {
      const p = pumps[m.pump!];
      m.x += (p.x - m.x) * Math.min(1, dt * 8);
      m.y += (PRE_Y - 4 - m.y) * Math.min(1, dt * 8);
      continue;
    }
    if (m.state === 'bound') {
      m.timer -= dt;
      if (m.timer <= 0) {
        releaseReceptor(m);
        m.state = 'free';
        const onPre = m.kind === 'endo' && receptors.some((r) => r.lig === m.lig && r.pre);
        m.vy = onPre ? rand(30, 70) : rand(-70, -30);
        if (m.kind === 'endo') m.timer = rand(1, 3);
      }
      continue;
    }

    if (m.state === 'uptake') {
      const p = pumps[m.pump!];
      const ty = p.enzyme ? POST_Y - 34 : PRE_Y + 2;
      m.vx += (p.x - m.x) * dt * 7;
      m.vy += (ty - m.y) * dt * 7;
      m.vx *= 0.88;
      m.vy *= 0.88;
      if (Math.hypot(p.x - m.x, ty - m.y) < 9) {
        const refused = !p.enzyme && rng() < Math.max(p.stall, p.reverse);
        if (refused) {
          m.state = 'free';
          m.vy = rand(50, 90);
        } else m.alpha = 0;
      }
    } else {
      m.vx += rand(-150, 150) * dt;
      m.vy += rand(-150, 150) * dt + (m.kind === 'nt' ? 40 : m.kind === 'drug' ? 20 : 0) * dt;
      if (m.kind === 'drug') m.vx += (W / 2 - m.x) * dt * 0.12;
      if (m.kind === 'endo') {
        // stay near own receptors; broken down after a few seconds
        const group = receptors.filter((r) => r.lig === m.lig);
        if (group.length) {
          m.vx += ((group[0].x + group[group.length - 1].x) / 2 - m.x) * dt * 0.5;
          m.vy += ((group[0].pre ? CLEFT_TOP : CLEFT_BOT) - m.y) * dt * 0.5;
        }
        m.timer -= dt;
        if (m.timer <= 0) m.state = 'fade';
      }
      m.vx *= 0.96;
      m.vy *= 0.96;
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.y < CLEFT_TOP) { m.y = CLEFT_TOP; m.vy = Math.abs(m.vy); }
    if (m.y > CLEFT_BOT) { m.y = CLEFT_BOT; m.vy = -Math.abs(m.vy); }
    if (m.x < 70) { m.x = 70; m.vx = Math.abs(m.vx); }
    if (m.x > W - 70) { m.x = W - 70; m.vx = -Math.abs(m.vx); }
    if (m.state !== 'free') continue;

    if (m.kind === 'nt') {
      const live = mols.filter((x) => x.kind === 'nt' && x.nt === m.nt && x.state !== 'fade').length;
      // clear the excess quickly, so the count in the cleft follows the modeled level
      const excess = live - moleculeTarget(level(m.nt!));
      const rate = excess > 0 ? 1.2 + excess * 0.5 : 0.04;
      if (rng() < dt * rate) {
        const own = pumps.map((p, i) => (p.nt === m.nt ? i : -1)).filter((i) => i >= 0);
        m.pump = own[Math.floor(rng() * own.length)];
        m.state = 'uptake';
        continue;
      }
      if (m.y > CLEFT_BOT - 12) {
        const r = receptors.find((rr) => rr.nt === m.nt && !rr.main && Math.abs(rr.x - m.x) < 14);
        if (r && rng() < 0.6) {
          r.main = m;
          m.state = 'bound';
          m.timer = rand(0.5, 1);
        }
      }
    } else if (m.kind === 'endo') {
      const r = receptors.find(
        (rr) => rr.lig === m.lig && !rr.main && Math.abs(rr.x - m.x) < 14 && (rr.pre ? m.y < CLEFT_TOP + 14 : m.y > CLEFT_BOT - 14),
      );
      if (r && rng() < 0.6) {
        r.main = m;
        m.state = 'bound';
        m.timer = rand(0.6, 1.2);
      }
    } else {
      const acts = directActions.filter((d) => d.subIdx === m.sub);
      for (const act of acts) {
        const cands = receptors.filter(
          (rr) => rr.family === act.family && Math.abs(rr.x - m.x) < 26 && (rr.pre ? m.y < CLEFT_TOP + 26 : m.y > CLEFT_BOT - 26),
        );
        for (const r of cands) {
          if (act.mode === 'modulator') {
            if (!r.side) {
              r.side = m;
              m.state = 'bound';
              m.timer = rand(1.2, 2.4) * (subs[m.sub!].stretched ? 1.5 : 1);
            }
          } else {
            const occ = r.main;
            // competitive antagonists push out both drug agonists and the natural messenger
            const displace =
              act.mode === 'antagonist' && ((occ?.kind === 'drug' && occ.slot !== m.slot) || occ?.kind === 'endo') && rng() < 0.4;
            if (!occ || displace) {
              if (occ) {
                occ.state = 'free';
                occ.vy = r.pre ? rand(50, 90) : rand(-90, -50);
                if (occ.kind === 'endo') occ.timer = rand(1, 2);
              }
              r.main = m;
              m.state = 'bound';
              m.timer = rand(0.9, 1.8) * (act.mode === 'antagonist' ? 2 : 1) * (subs[m.sub!].stretched ? 1.5 : 1);
            }
          }
          if (m.state === 'bound') break;
        }
        if (m.state === 'bound') break;
      }
      if (m.state === 'free') {
        // Drift toward the transporter or receptor family this substance targets.
        const s = subs[m.sub!];
        const pumpTargets = pumps.filter((p) => !p.enzyme && (s.sub.sim.clearance[p.nt] ?? 0) >= 0.3 && s.sub.sim.clearanceVia !== 'enzyme');
        const recTargets = receptors.filter((r) => acts.some((a) => a.family === r.family));
        if (pumpTargets.length) {
          // hover loosely near the transporters it blocks
          const p = pumpTargets[(m.seed ?? 0) % pumpTargets.length];
          m.vx += (p.x - m.x) * dt * 0.35;
          m.vy += (PRE_Y + 50 - m.y) * dt * 0.35;
        } else if (recTargets.length) {
          const r = recTargets.reduce((a, b) => (Math.abs(a.x - m.x) < Math.abs(b.x - m.x) ? a : b));
          m.vx += (r.x - m.x) * dt * 0.6;
          m.vy += ((r.pre ? CLEFT_TOP : CLEFT_BOT) - m.y) * dt * 0.6;
        }
      }
    }
  }
  for (let i = mols.length - 1; i >= 0; i--) if (mols[i].alpha <= 0) mols.splice(i, 1);

  for (const r of receptors) {
    const occ = r.main;
    let on = 0;
    if (occ) {
      const antagonist = occ.kind === 'drug' && directActions.some((d) => d.subIdx === occ.sub && d.family === r.family && d.mode === 'antagonist');
      on = antagonist ? 0 : 1;
    }
    if (on && r.side) on = 1.6;
    r.signal += (on - r.signal) * Math.min(1, dt * 10);
  }
}

export type WorldSnapshot = {
  /** Molecules loose in the cleft, by label. */
  free: Record<string, number>;
  /** Molecules currently bound to a receptor, by label. */
  bound: Record<string, number>;
  receptors: {
    family: string;
    membrane: 'presynaptic' | 'postsynaptic';
    total: number;
    activated: number;
    blocked: number;
    modulatorBound: number;
    occupiedBy: Record<string, number>;
  }[];
  transporters: { name: string; blockedPct: number; status: string; pluggedBy: string | null }[];
  enzymes: Record<string, string>;
  vesiclesReleasing: number;
};

/** What the animation is showing right now, as counts and words, for logging and review. */
export function snapshotWorld(world: World, t: number): WorldSnapshot {
  const { result, subs, directActions, receptors, pumps, vesicles, mols } = world;
  const labelOf = (m: Mol) =>
    m.kind === 'nt' ? NT_INFO[m.nt!].name : m.kind === 'endo' ? ENDOGENOUS[m.lig!].name : subs[m.sub!].sub.name;
  const tally = (list: Mol[]) => {
    const out: Record<string, number> = {};
    for (const m of list) out[labelOf(m)] = (out[labelOf(m)] ?? 0) + 1;
    return out;
  };

  const families: WorldSnapshot['receptors'] = [];
  for (const r of receptors) {
    let f = families.find((x) => x.family === r.family);
    if (!f) {
      f = { family: r.family, membrane: r.pre ? 'presynaptic' : 'postsynaptic', total: 0, activated: 0, blocked: 0, modulatorBound: 0, occupiedBy: {} };
      families.push(f);
    }
    f.total++;
    if (r.signal > 0.5) f.activated++;
    if (r.side) f.modulatorBound++;
    const occ = r.main;
    if (occ) {
      f.occupiedBy[labelOf(occ)] = (f.occupiedBy[labelOf(occ)] ?? 0) + 1;
      const isAntagonist =
        occ.kind === 'drug' && directActions.some((d) => d.subIdx === occ.sub && d.family === r.family && d.mode === 'antagonist');
      if (isAntagonist) f.blocked++;
    }
  }

  const transporters: WorldSnapshot['transporters'] = [];
  const enzymes: WorldSnapshot['enzymes'] = {};
  for (const p of pumps) {
    if (p.enzyme) {
      enzymes.AChE = 'breaking down acetylcholine in the cleft';
      continue;
    }
    const name = NT_INFO[p.nt].transporter;
    if (transporters.some((x) => x.name === name)) continue;
    const blockedPct = Math.round((result ? sample(result.blockade[p.nt], t) : 0) * 100);
    const reversed = (result ? sample(result.reversal[p.nt], t) : 0) > 0.15;
    transporters.push({
      name,
      blockedPct,
      status: reversed ? 'Reversed: pumping out' : blockedPct > 5 ? `${blockedPct}% blocked` : 'Working normally',
      pluggedBy: p.plug ? labelOf(p.plug) : null,
    });
  }
  if (result)
    for (const s of subs)
      if (s.sub.sim.clearanceVia === 'enzyme')
        for (const n of Object.keys(s.sub.sim.clearance) as NT[])
          enzymes[`MAO (${NT_INFO[n].name})`] = `${Math.round(sample(result.enzymeBlock[n], t) * 100)}% inhibited`;

  return {
    free: tally(mols.filter((m) => m.state === 'free' || m.state === 'uptake')),
    bound: tally(mols.filter((m) => m.state === 'bound')),
    receptors: families,
    transporters,
    enzymes,
    vesiclesReleasing: vesicles.filter((v) => v.phase !== 'idle').length,
  };
}
