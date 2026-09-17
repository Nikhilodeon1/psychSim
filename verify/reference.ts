/**
 * Independent fact base used to check the simulator's data and behavior.
 *
 * Written separately from src/data/substances.ts on purpose: the app data is what we ship, this file is
 * what we believe is true. Tests fail when the two disagree. Review this file on its own against the
 * sources below; do not edit it just to make a test pass.
 *
 * Sources (textbook level):
 *  - Myers & DeWall, Psychology (AP edition), ch. on consciousness & psychoactive drugs: class assignments.
 *  - Carlson & Birkett, Physiology of Behavior, ch. "Drug Abuse": sites of action.
 *  - Stahl, Stahl's Essential Psychopharmacology: SSRIs, MAOIs, antipsychotics, receptor mechanisms.
 *  - Goodman & Gilman's Pharmacological Basis of Therapeutics: half-life / Tmax ranges, CYP interactions.
 *
 * Timing ranges are for common routes of use and are approximate. The model window is 8 h, so ranges
 * are only checked where they are meaningful (see engine tests).
 */
import type { NT } from '../src/data/substances';

export type Mode = 'agonist' | 'antagonist' | 'modulator';

export type Fact = {
  cls: 'Depressant' | 'Stimulant' | 'Hallucinogen' | 'Opioid' | 'Other';
  polarity: 'Agonist' | 'Antagonist' | 'Mixed';
  /** Neurotransmitter systems a textbook would list; the app must include all of these. */
  systems: NT[];
  /** Neurotransmitters whose clearance is a primary target, and how. */
  blocksClearance?: Partial<Record<NT, 'transporter' | 'enzyme'>>;
  /** Transporters driven in reverse (releasers). */
  reverses?: NT[];
  /** Direct binding actions: exact site → mode. Different sites on one receptor do not compete. */
  sites?: Record<string, Mode>;
  /** Substances whose clearance this one meaningfully slows when co-present (acute, illustrative). */
  slows?: string[];
  /** Hours to peak effect/concentration, common route. */
  tmax: [number, number];
  /** Elimination half-life in hours, common agents in the class. null = not a simple first-order half-life. */
  halfLife: [number, number] | null;
  /** Expected sign of the model's effect axes at typical intensity (0 = no substantial effect). */
  direction: { arousal: -1 | 0 | 1; cognition: -1 | 0 | 1 };
  /** Region expected to have the strongest modeled involvement. */
  topRegion?: 'accumbens' | 'pfc' | 'amygdala' | 'brainstem';
  note?: string;
};

export const FACTS: Record<string, Fact> = {
  alcohol: {
    cls: 'Depressant',
    polarity: 'Agonist',
    systems: ['GABA'],
    sites: { 'GABA-A (ethanol site)': 'modulator', 'NMDA (ethanol site)': 'antagonist' },
    slows: ['cocaine', 'benzodiazepines', 'barbiturates'],
    tmax: [0.5, 1.5],
    halfLife: null,
    direction: { arousal: -1, cognition: -1 },
    note: 'Zero-order elimination; acute ethanol inhibits metabolism of diazepam and pentobarbital and forms cocaethylene with cocaine.',
  },
  barbiturates: {
    cls: 'Depressant',
    polarity: 'Agonist',
    systems: ['GABA'],
    sites: { 'GABA-A (barbiturate site)': 'modulator' },
    tmax: [0.5, 4],
    halfLife: [15, 100],
    direction: { arousal: -1, cognition: -1 },
    topRegion: 'brainstem',
  },
  benzodiazepines: {
    cls: 'Depressant',
    polarity: 'Agonist',
    systems: ['GABA'],
    sites: { 'GABA-A (benzodiazepine site)': 'modulator' },
    tmax: [0.5, 2],
    halfLife: [2, 100],
    direction: { arousal: -1, cognition: -1 },
    topRegion: 'amygdala',
  },
  inhalants: {
    cls: 'Depressant',
    polarity: 'Mixed',
    systems: ['GABA'],
    sites: { 'GABA-A (solvent site)': 'modulator' },
    tmax: [0, 0.2],
    halfLife: null,
    direction: { arousal: -1, cognition: -1 },
    topRegion: 'pfc',
    note: 'Effects begin within seconds of inhaling and fade within tens of minutes of stopping; solvent elimination itself is slower.',
  },
  caffeine: {
    cls: 'Stimulant',
    polarity: 'Antagonist',
    systems: ['NE', 'DA', 'ACh'],
    sites: { 'Adenosine A2A': 'antagonist' },
    tmax: [0.5, 2],
    halfLife: [3, 7],
    direction: { arousal: 1, cognition: 0 },
  },
  nicotine: {
    cls: 'Stimulant',
    polarity: 'Agonist',
    systems: ['ACh', 'DA'],
    sites: { nAChR: 'agonist' },
    tmax: [0.03, 0.5],
    halfLife: [1, 3],
    direction: { arousal: 1, cognition: 0 },
    topRegion: 'accumbens',
  },
  amphetamines: {
    cls: 'Stimulant',
    polarity: 'Agonist',
    systems: ['DA', 'NE'],
    blocksClearance: { DA: 'transporter', NE: 'transporter' },
    reverses: ['DA', 'NE'],
    tmax: [1, 4],
    halfLife: [9, 14],
    direction: { arousal: 1, cognition: 0 },
    topRegion: 'accumbens',
  },
  cocaine: {
    cls: 'Stimulant',
    polarity: 'Agonist',
    systems: ['DA', 'NE', '5HT'],
    blocksClearance: { DA: 'transporter', NE: 'transporter', '5HT': 'transporter' },
    tmax: [0.05, 1],
    halfLife: [0.5, 1.5],
    direction: { arousal: 1, cognition: 0 },
    topRegion: 'accumbens',
  },
  mdma: {
    cls: 'Stimulant',
    polarity: 'Agonist',
    systems: ['5HT', 'DA', 'NE'],
    blocksClearance: { '5HT': 'transporter', NE: 'transporter' },
    reverses: ['5HT', 'NE'],
    tmax: [1.5, 3],
    halfLife: [6, 10],
    direction: { arousal: 1, cognition: -1 },
    note: 'MDMA releases NE via NET with potency comparable to or greater than 5-HT via SERT; DA release is weaker.',
  },
  'morphine-heroin': {
    cls: 'Opioid',
    polarity: 'Agonist',
    systems: ['DA'],
    sites: { 'Mu-opioid': 'agonist' },
    tmax: [0.1, 1.5],
    halfLife: [2, 4],
    direction: { arousal: -1, cognition: -1 },
    topRegion: 'brainstem',
    note: 'Heroin is rapidly converted to morphine; morphine half-life used.',
  },
  'rx-opioids': {
    cls: 'Opioid',
    polarity: 'Agonist',
    systems: ['DA'],
    sites: { 'Mu-opioid': 'agonist' },
    tmax: [0.5, 2],
    halfLife: [3, 5],
    direction: { arousal: -1, cognition: -1 },
    topRegion: 'brainstem',
  },
  'opioid-antagonists': {
    cls: 'Opioid',
    polarity: 'Antagonist',
    systems: [],
    sites: { 'Mu-opioid': 'antagonist' },
    tmax: [0.02, 0.5],
    halfLife: [1, 1.5],
    direction: { arousal: 0, cognition: 0 },
  },
  lsd: {
    cls: 'Hallucinogen',
    polarity: 'Agonist',
    systems: ['5HT'],
    sites: { '5-HT2A': 'agonist' },
    tmax: [1, 2.5],
    halfLife: [3, 4],
    direction: { arousal: 1, cognition: -1 },
    topRegion: 'pfc',
  },
  psilocybin: {
    cls: 'Hallucinogen',
    polarity: 'Agonist',
    systems: ['5HT'],
    sites: { '5-HT2A': 'agonist' },
    tmax: [1, 2.5],
    halfLife: [1.5, 3],
    direction: { arousal: 0, cognition: -1 },
    topRegion: 'pfc',
  },
  mescaline: {
    cls: 'Hallucinogen',
    polarity: 'Agonist',
    systems: ['5HT'],
    sites: { '5-HT2A': 'agonist' },
    tmax: [1.5, 3],
    halfLife: [5, 7],
    direction: { arousal: 1, cognition: -1 },
    topRegion: 'pfc',
  },
  pcp: {
    cls: 'Hallucinogen',
    polarity: 'Antagonist',
    systems: ['DA'],
    sites: { 'NMDA (channel pore)': 'antagonist' },
    tmax: [0.1, 1],
    halfLife: [2, 3],
    direction: { arousal: 0, cognition: -1 },
    topRegion: 'pfc',
    note: 'Ketamine values; PCP half-life is much longer (7-46 h).',
  },
  thc: {
    cls: 'Hallucinogen',
    polarity: 'Agonist',
    systems: ['DA', 'GABA'],
    sites: { CB1: 'agonist' },
    tmax: [0.1, 3],
    halfLife: [1.5, 4],
    direction: { arousal: 0, cognition: -1 },
    note: 'Initial distribution half-life; terminal half-life is days.',
  },
  ssri: {
    cls: 'Other',
    polarity: 'Agonist',
    systems: ['5HT'],
    blocksClearance: { '5HT': 'transporter' },
    slows: ['mdma', 'amphetamines', 'rx-opioids', 'antipsychotics'],
    tmax: [4, 8],
    halfLife: [20, 100],
    direction: { arousal: 0, cognition: 0 },
    note: 'Fluoxetine/paroxetine inhibit CYP2D6, which metabolizes MDMA, amphetamine, oxycodone (partly) and haloperidol.',
  },
  maoi: {
    cls: 'Other',
    polarity: 'Agonist',
    systems: ['5HT', 'NE', 'DA'],
    blocksClearance: { '5HT': 'enzyme', NE: 'enzyme', DA: 'enzyme' },
    tmax: [1, 3],
    halfLife: null,
    direction: { arousal: 0, cognition: 0 },
    note: 'Irreversible MAO inhibition outlasts plasma half-life.',
  },
  antipsychotics: {
    cls: 'Other',
    polarity: 'Antagonist',
    systems: ['DA'],
    sites: { D2: 'antagonist' },
    tmax: [2, 6],
    halfLife: [14, 37],
    direction: { arousal: -1, cognition: 0 },
    topRegion: 'accumbens',
  },
  ldopa: {
    cls: 'Other',
    polarity: 'Agonist',
    systems: ['DA'],
    tmax: [0.5, 2],
    halfLife: [1, 2],
    direction: { arousal: 0, cognition: 0 },
    topRegion: 'accumbens',
  },
};

/** Substances that raise synaptic dopamine and therefore act (indirectly) at D2 receptors. */
export const RAISES_DOPAMINE = ['nicotine', 'amphetamines', 'cocaine', 'morphine-heroin', 'rx-opioids', 'thc', 'ldopa'];

/** Words that must never appear in generated text: dosing, subjective effects, encouragement. */
export const FORBIDDEN_TEXT = [
  /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|ml|mL|units?)\b/i,
  /\bdos(e|es|ing|age)\b/i,
  /\bfeel(s|ing)?\b/i,
  /\beuphori/i,
  /\bhigh\b/i,
  /\bsafe(ly|r)?\b/i,
  /\brecommend/i,
  /\b(try|enjoy|fun|recreational use)\b/i,
  /\b(dizz|nause|vomit|slurr|red eyes|paranoi|hallucinat(e|ions) you)/i,
];

/**
 * The body's own messenger at each receptor family, and which membrane carries the receptor at the synapse
 * being drawn. CB1 receptors are presynaptic; endocannabinoids are retrograde messengers made by the
 * postsynaptic neuron (Carlson & Birkett; Kandel, Principles of Neural Science).
 */
export const NATURAL_LIGANDS: Record<string, { name: string; receptorOn: 'presynaptic' | 'postsynaptic'; source: 'presynaptic' | 'postsynaptic' | 'surroundings' }> = {
  'μ-opioid': { name: 'Endorphins', receptorOn: 'postsynaptic', source: 'surroundings' },
  CB1: { name: 'Anandamide', receptorOn: 'presynaptic', source: 'postsynaptic' },
  A2A: { name: 'Adenosine', receptorOn: 'postsynaptic', source: 'surroundings' },
  NMDA: { name: 'Glutamate', receptorOn: 'postsynaptic', source: 'presynaptic' },
  nAChR: { name: 'Acetylcholine', receptorOn: 'postsynaptic', source: 'presynaptic' },
  'GABA-A': { name: 'GABA', receptorOn: 'postsynaptic', source: 'presynaptic' },
  D2: { name: 'Dopamine', receptorOn: 'postsynaptic', source: 'presynaptic' },
  '5-HT2A': { name: 'Serotonin', receptorOn: 'postsynaptic', source: 'presynaptic' },
  Adrenergic: { name: 'Norepinephrine', receptorOn: 'postsynaptic', source: 'presynaptic' },
};
