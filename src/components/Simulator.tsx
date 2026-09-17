import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_ORDER, NT_INFO, SUBSTANCES } from '../data/substances';
import type { DrugClass, Region, Substance } from '../data/substances';
import { DURATION, OFFSETS, STEPS, simulate } from '../sim/engine';
import type { Intensity, Rule, Selection, SimResult } from '../sim/engine';
import { NT_COLOR, SLOT_COLOR, SLOT_LETTER } from '../colors';
import { SynapseCanvas } from './SynapseCanvas';
import { sample, shownNTs, synapseLigands, synapseTerms } from '../sim/sample';
import type { Ligand } from '../data/endogenous';
import { Term } from './Term';
import { GLOSSARY } from '../data/glossary';
import { BrainMap } from './BrainMap';
import { AxisCharts, NTChart } from './Charts';

const INTENSITIES: { v: Intensity; label: string }[] = [
  { v: 'low', label: 'Low' },
  { v: 'typical', label: 'Typical' },
  { v: 'high', label: 'High' },
];

const CLASS_LABEL: Record<DrugClass, string> = {
  Depressant: 'Depressants',
  Stimulant: 'Stimulants',
  Opioid: 'Opioids',
  Hallucinogen: 'Hallucinogens',
  Other: 'Therapeutic',
};

const RUN_SECONDS = 26;

function Shape({ slot, size = 14 }: { slot: number; size?: number }) {
  const c = SLOT_COLOR[slot];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="shape" aria-hidden>
      {slot === 0 && <path d="M8 1 15 8 8 15 1 8Z" fill={c} stroke="#4E342B" strokeWidth="1" />}
      {slot === 1 && <rect x="2.5" y="2.5" width="11" height="11" fill={c} stroke="#4E342B" strokeWidth="1" />}
      {slot === 2 && <path d="M8 1.5 15 14H1Z" fill={c} stroke="#4E342B" strokeWidth="1" />}
    </svg>
  );
}

function LigandIcon({ ligand }: { ligand: Ligand }) {
  const common = { fill: ligand.color, stroke: '#4E342B', strokeWidth: 1 };
  return (
    <svg viewBox="0 0 22 12" width="22" height="12" aria-hidden>
      {ligand.shape === 'peptide' && (
        <>
          <circle cx="4.5" cy="7" r="3.3" {...common} />
          <circle cx="11" cy="5" r="3.3" {...common} />
          <circle cx="17.5" cy="7" r="3.3" {...common} />
        </>
      )}
      {ligand.shape === 'lipid' && (
        <>
          <path d="M10 6 Q15 2 20 7" stroke={ligand.color} strokeWidth="2" fill="none" />
          <circle cx="7" cy="6" r="4" {...common} />
        </>
      )}
      {ligand.shape === 'small' && <circle cx="11" cy="6" r="4.3" {...common} />}
    </svg>
  );
}

function ReceptorIcon({ state }: { state: 'active' | 'blocked' | 'idle' }) {
  const fill = state === 'active' ? '#E39A2D' : state === 'blocked' ? '#AEB4B9' : '#D6DEE4';
  return (
    <svg viewBox="0 0 20 22" width="16" height="18" aria-hidden className="rec-icon">
      <rect x="2" y="1" width="6.5" height="14" rx="3" fill={fill} stroke="#4E342B" strokeWidth="1.1" />
      <rect x="11.5" y="1" width="6.5" height="14" rx="3" fill={fill} stroke="#4E342B" strokeWidth="1.1" />
      {state === 'active' && <path d="M10 16v5M8 19l2 2 2-2" stroke="#E39A2D" strokeWidth="1.4" fill="none" />}
      {state === 'blocked' && <path d="M6 19h8" stroke="#6F767C" strokeWidth="1.8" />}
    </svg>
  );
}

const RULE_NAME: Record<Rule['kind'], string> = {
  stacking: 'Reuptake stacking',
  competition: 'Receptor competition',
  metabolic: 'Metabolic interaction',
  convergence: 'Convergent depression',
};

function ruleDetail(r: Rule, res: SimResult) {
  const n = (i: number) => res.subs[i].sub.name;
  if (r.kind === 'stacking') return `${NT_INFO[r.nt].transporter}: ${r.subs.map(n).join(' + ')}`;
  if (r.kind === 'competition') return `${r.family}: ${r.subs.map(n).join(' vs ')}`;
  if (r.kind === 'convergence') return `brainstem: ${r.subs.map(n).join(' + ')}`;
  return `${n(r.slower)} slows ${n(r.slowed)}`;
}

function polarity(s: Substance) {
  if (s.action.startsWith('Agonist / antagonist')) return 'Mixed';
  return s.action.startsWith('Agonist') ? 'Agonist' : 'Antagonist';
}

export function Simulator() {
  const [selections, setSelections] = useState<Selection[]>([
    { id: 'cocaine', intensity: 'typical', offset: 0 },
    { id: 'ssri', intensity: 'typical', offset: 0 },
  ]);
  const [result, setResult] = useState<SimResult | null>(null);
  const [ranWith, setRanWith] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DrugClass | 'All'>('All');
  const [open, setOpen] = useState<string | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const seekRef = useRef(0);
  playingRef.current = playing;

  const setPlay = (on: boolean) => {
    // Update the ref immediately so the animation stops on the frame that was on screen.
    playingRef.current = on;
    setPlaying(on);
    if (!on) setTime(timeRef.current);
  };

  const key = JSON.stringify(selections);
  const stale = result !== null && key !== ranWith;
  const canRun = selections.length >= 2;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastPush = 0;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(DURATION, timeRef.current + (dt * DURATION) / RUN_SECONDS);
      timeRef.current = next;
      if (now - lastPush > 60 || next >= DURATION) {
        setTime(next);
        lastPush = now;
      }
      if (next >= DURATION) setPlay(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const run = () => {
    setResult(simulate(selections));
    setRanWith(key);
    timeRef.current = 0;
    seekRef.current++;
    setTime(0);
    setPlay(true);
  };

  const scrub = (v: number) => {
    setPlay(false);
    timeRef.current = v;
    seekRef.current++;
    setTime(v);
  };

  const update = (i: number, patch: Partial<Selection>) => setSelections(selections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = (id: string) => {
    if (selections.length < 3) setSelections([...selections, { id, intensity: 'typical', offset: 0 }]);
  };
  const remove = (id: string) => setSelections(selections.filter((s) => s.id !== id));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SUBSTANCES.filter(
      (s) => (filter === 'All' || s.cls === filter) && (!q || [s.name, s.examples, s.target, s.mechanism].join(' ').toLowerCase().includes(q)),
    );
  }, [filter, query]);

  const k = Math.round((time / DURATION) * STEPS);
  const regions = useMemo(() => {
    const keys: Region[] = ['accumbens', 'pfc', 'amygdala', 'brainstem'];
    const vals = {} as Record<Region, number>;
    const boosted = {} as Record<Region, boolean>;
    for (const r of keys) {
      vals[r] = result ? result.regions[r][k] : 0;
      boosted[r] = result ? result.regionBoost[r][k] > 0.05 : false;
    }
    return { vals, boosted };
  }, [result, k]);
  const nts = useMemo(() => shownNTs(result), [result]);
  const terms = useMemo(() => synapseTerms(result), [result]);
  const ligands = useMemo(() => synapseLigands(result).filter((l) => !nts.some((n) => NT_INFO[n].name === l.ligand.name)), [result, nts]);

  return (
    <div className="layout">
      <aside className="side">
        <section className="side-block">
          <h2 className="side-title">
            Substances <span>{selections.length}/3</span>
          </h2>
          <ol className="slots">
            {selections.map((sel, i) => {
              const s = SUBSTANCES.find((x) => x.id === sel.id)!;
              return (
                <li key={sel.id} className="slot">
                  <div className="slot-head">
                    <Shape slot={i} />
                    <span className="slot-name">{s.name}</span>
                    <button className="icon-btn" onClick={() => remove(sel.id)} aria-label={`Remove ${s.name}`}>
                      <svg viewBox="0 0 16 16" aria-hidden>
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>
                  <div className="field">
                    <span className="field-label" id={`int-${i}`}>Intensity</span>
                    <div className="seg" role="radiogroup" aria-labelledby={`int-${i}`}>
                      {INTENSITIES.map((o) => (
                        <button key={o.v} role="radio" aria-checked={sel.intensity === o.v} onClick={() => update(i, { intensity: o.v })}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label" id={`off-${i}`}>Starts</span>
                    <div className="seg" role="radiogroup" aria-labelledby={`off-${i}`}>
                      {OFFSETS.map((o) => (
                        <button key={o} role="radio" aria-checked={sel.offset === o} onClick={() => update(i, { offset: o })}>
                          {o === 0 ? '0 h' : `+${o} h`}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
            {Array.from({ length: 3 - selections.length }, (_, i) => (
              <li key={`empty-${i}`} className="slot empty">
                <Shape slot={selections.length + i} />
                Add one from the library
              </li>
            ))}
          </ol>
          <button className="btn primary run" onClick={run} disabled={!canRun}>
            {result && !stale ? 'Run again' : 'Run simulation'}
          </button>
          {!canRun && <p className="hint">Pick at least two.</p>}
          {stale && <p className="hint warn">Changed since last run.</p>}
        </section>

        <section className="side-block lib">
          <h2 className="side-title">
            Drug library <span>{SUBSTANCES.length}</span>
          </h2>
          <input className="search" type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search drug library" />
          <div className="chips" role="group" aria-label="Filter by class">
            {(['All', ...CLASS_ORDER] as const).map((c) => (
              <button key={c} className="chip" aria-pressed={filter === c} onClick={() => setFilter(c)}>
                {c === 'All' ? 'All' : CLASS_LABEL[c]}
              </button>
            ))}
          </div>

          {CLASS_ORDER.map((cls) => {
            const items = visible.filter((s) => s.cls === cls);
            if (!items.length) return null;
            return (
              <div key={cls} className="lib-group">
                <h3 className="lib-class">{CLASS_LABEL[cls]}</h3>
                <ul className="lib-list">
                  {items.map((s) => {
                    const slot = selections.findIndex((x) => x.id === s.id);
                    const isOpen = open === s.id;
                    return (
                      <li key={s.id} className={`lib-item${isOpen ? ' open' : ''}`}>
                        <button className="lib-row" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                          <span className="lib-name">
                            {s.name}
                            {slot >= 0 && <Shape slot={slot} size={11} />}
                          </span>
                          <span className={`pol ${polarity(s).toLowerCase()}`} title={GLOSSARY[polarity(s)].def}>
                            {polarity(s)}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="lib-detail">
                            {s.examples && <p className="lib-ex">{s.examples}</p>}
                            <p className="lib-mech">{s.mechanism}</p>
                            <dl>
                              <dt>Class</dt>
                              <dd>{s.cls}</dd>
                              <dt>Action</dt>
                              <dd>{s.action}</dd>
                              <dt>Acts at</dt>
                              <dd>{s.target}</dd>
                              <dt>Systems</dt>
                              <dd className="sys">
                                {s.systems.map((n) => (
                                  <span key={n}>
                                    <i style={{ background: NT_COLOR[n] }} />
                                    {NT_INFO[n].name}
                                  </span>
                                ))}
                                {s.otherSystems?.map((o) => (
                                  <span key={o}>
                                    <i className="hollow" />
                                    {o}
                                  </span>
                                ))}
                              </dd>
                            </dl>
                            {s.teachingNote && <p className="lib-note">{s.teachingNote}</p>}
                            {slot >= 0 ? (
                              <button className="btn ghost small" onClick={() => remove(s.id)}>
                                Remove from simulation
                              </button>
                            ) : (
                              <button className="btn ghost small" onClick={() => add(s.id)} disabled={selections.length >= 3}>
                                {selections.length >= 3 ? 'Simulation full (3 max)' : `Add as ${SLOT_LETTER[selections.length]}`}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {visible.length === 0 && <p className="hint">No matches.</p>}
        </section>

        <details className="side-block about">
          <summary>About this model</summary>
          <ul>
            <li>Values are illustrative teaching numbers, not measured pharmacology. Timing follows published ranges for peak effect and half-life, compressed into an 8-hour window.</li>
            <li>Intensity is Low / Typical / High only. The tool shows no amounts and no subjective effects.</li>
            <li>
              Three interaction rules are modeled: blocking clearance of the same transmitter (1.3× the added effect),
              competing for the same binding site (each reaches less of the receptor), and one substance slowing another's
              clearance (up to 1.6× longer half-life).
            </li>
            <li>Drugs acting at different sites of the same receptor (for example alcohol and benzodiazepines at GABA-A) add together rather than compete.</li>
          </ul>
        </details>
      </aside>

      <main className="stage">
        <figure className="plate">
          <figcaption className="plate-bar">
            <span className="fig-no">Fig. 1</span>
            <span className="fig-title">Synapse</span>
            <div className="transport">
              <button
                className="play"
                onClick={() => {
                  if (!result) return run();
                  if (timeRef.current >= DURATION) {
                    timeRef.current = 0;
                    seekRef.current++;
                    setTime(0);
                  }
                  setPlay(!playing);
                }}
                disabled={!result && !canRun}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <rect x="3" y="2" width="3.5" height="12" />
                    <rect x="9.5" y="2" width="3.5" height="12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="M4 2l10 6-10 6z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={DURATION}
                step={0.05}
                value={time}
                disabled={!result}
                onChange={(e) => scrub(Number(e.target.value))}
                aria-label="Simulation time"
                style={{ ['--p' as string]: `${(time / DURATION) * 100}%` }}
              />
              <span className="clock">{time.toFixed(1)} h</span>
            </div>
          </figcaption>
          <div className="canvas-wrap">
            <SynapseCanvas result={result} timeRef={timeRef} playingRef={playingRef} seekRef={seekRef} />
            {!result && <p className="plate-empty">Baseline synapse. Run the simulation to add substances.</p>}
          </div>
          <div className="syn-legend">
            {nts.map((n) => (
              <span key={n} className="lg">
                <i className="dot" style={{ background: NT_COLOR[n] }} />
                {NT_INFO[n].name}
                {result && <b title="Amount in the synaptic cleft vs. baseline">{sample(result.cleft[n], time).toFixed(2)}× in cleft</b>}
              </span>
            ))}
            {ligands.map(({ family, ligand }) => (
              <span key={family} className="lg" title={`The body's own messenger at ${family} receptors`}>
                <LigandIcon ligand={ligand} />
                {ligand.name} <em className="natural">natural</em>
              </span>
            ))}
            {result?.subs.map((s) => (
              <span key={s.slot} className="lg">
                <Shape slot={s.slot} size={12} />
                {s.sub.name}
                {s.stretched && <em>slower clearance</em>}
              </span>
            ))}
            <span className="lg-sep" />
            <span className="lg">
              <ReceptorIcon state="active" /> Activated
            </span>
            <span className="lg">
              <ReceptorIcon state="blocked" /> Blocked
            </span>
            <span className="lg">
              <ReceptorIcon state="idle" /> Empty
            </span>
          </div>
          <div className="syn-terms">
            <span className="terms-label">What these labels mean</span>
            {terms.map((t) => (
              <Term key={t} term={t} />
            ))}
          </div>
        </figure>

        <section className="panel summary">
          <h2 className="cap">
            <span className="fig-title">Mechanism summary</span>
          </h2>
          {result ? (
            <>
              <div className="blurb">
                {result.blurb.map((b, i) => (
                  <p key={i}>{b}</p>
                ))}
              </div>
              {result.rules.length > 0 && (
                <ul className="rules">
                  {result.rules.map((r, i) => (
                    <li key={i} className={`rule${r.overlap[k] > 0.1 ? ' live' : ''}`}>
                      <span className="rule-name">
                        <Term term={RULE_NAME[r.kind]} />
                      </span>
                      <span className="rule-detail">{ruleDetail(r, result)}</span>
                      <span className="rule-state">{r.overlap[k] > 0.1 ? 'Active now' : 'Not active now'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="hint">Appears after a run.</p>
          )}
        </section>
        <figure className="panel">
          <figcaption className="cap">
            <span className="fig-no">Fig. 2</span>
            <span className="fig-title">Brain regions</span>
            <span className="fig-sub">how strongly each region is affected, not the direction</span>
          </figcaption>
          <BrainMap values={regions.vals} boosted={regions.boosted} />
        </figure>

        {result && (
          <>
            <figure className="panel">
              <figcaption className="cap">
                <span className="fig-no">Fig. 3</span>
                <span className="fig-title">Neurotransmitter signaling</span>
                <span className="fig-sub">net effect at receptors vs. baseline (1.0×)</span>
              </figcaption>
              <NTChart result={result} time={time} />
            </figure>
            <figure className="panel">
              <figcaption className="cap">
                <span className="fig-no">Fig. 4</span>
                <span className="fig-title">Effect axes</span>
                <span className="fig-sub">0–100, dashed line = baseline</span>
              </figcaption>
              <AxisCharts result={result} time={time} />
              <p className="axis-note">
                Mood valence shows the acute effect within 8 hours only. SSRIs and MAO inhibitors raise serotonin within
                hours but take two to six weeks to change mood, so their mood line stays flat here.
              </p>
            </figure>
          </>
        )}
      </main>
    </div>
  );
}
