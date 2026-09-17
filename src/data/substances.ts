// Illustrative, simplified teaching values. Not pharmacokinetic data.

export type NT = '5HT' | 'DA' | 'NE' | 'GABA' | 'ACh';
export type DrugClass = 'Depressant' | 'Stimulant' | 'Hallucinogen' | 'Opioid' | 'Other';
export type Axis = 'arousal' | 'mood' | 'cognition' | 'load';
export type Region = 'accumbens' | 'pfc' | 'amygdala' | 'brainstem';

export const NT_LIST: NT[] = ['5HT', 'DA', 'NE', 'GABA', 'ACh'];

export const NT_INFO: Record<NT, { name: string; short: string; transporter: string; receptor: string }> = {
  '5HT': { name: 'Serotonin', short: '5-HT', transporter: 'SERT', receptor: '5-HT2A' },
  DA: { name: 'Dopamine', short: 'DA', transporter: 'DAT', receptor: 'D2' },
  NE: { name: 'Norepinephrine', short: 'NE', transporter: 'NET', receptor: 'Adrenergic' },
  GABA: { name: 'GABA', short: 'GABA', transporter: 'GAT', receptor: 'GABA-A' },
  ACh: { name: 'Acetylcholine', short: 'ACh', transporter: 'AChE', receptor: 'nAChR' },
};

export type ReceptorAction = {
  /** Binding site. Competition only occurs between substances sharing the exact same site. */
  site: string;
  /** Receptor family shown on the synapse diagram. */
  family: string;
  mode: 'agonist' | 'antagonist' | 'modulator';
  /** false = acts on this receptor indirectly, via the endogenous neurotransmitter it elevates. */
  direct: boolean;
};

export type Substance = {
  id: string;
  name: string;
  examples?: string;
  group: string;
  cls: DrugClass;
  /** Agonist / antagonist summary for the library card. */
  action: string;
  target: string;
  systems: NT[];
  otherSystems?: string[];
  mechanism: string;
  /** Short mechanism tag used in chart annotations. */
  tag: string;
  teachingNote?: string;
  sim: {
    peak: number; // hr to peak (illustrative)
    halfLife: number; // hr (illustrative)
    nt: Partial<Record<NT, number>>;
    clearance: Partial<Record<NT, number>>;
    clearanceVia?: 'transporter' | 'enzyme';
    release: NT[];
    /** Transporters run in reverse (efflux) for these neurotransmitters. */
    reverses?: NT[];
    receptors: ReceptorAction[];
    axes: Record<Axis, number>;
    regions: Record<Region, number>;
    slowsClearanceOf?: string[];
  };
};

const D2_INDIRECT: ReceptorAction = { site: 'D2', family: 'D2', mode: 'agonist', direct: false };

export const SUBSTANCES: Substance[] = [
  // ——— Depressants
  {
    id: 'alcohol',
    name: 'Alcohol',
    examples: 'Ethanol',
    group: 'Depressants',
    cls: 'Depressant',
    action: 'Agonist (positive modulator)',
    target: 'GABA-A receptors; antagonist at NMDA glutamate receptors',
    systems: ['GABA', 'DA'],
    otherSystems: ['Glutamate'],
    mechanism: 'Enhances GABA-A inhibitory signaling and reduces glutamate excitation, slowing neural activity.',
    tag: 'GABA-A potentiation',
    sim: {
      peak: 0.75,
      halfLife: 1.5,
      nt: { GABA: 0.9, DA: 0.35 },
      clearance: {},
      release: [],
      receptors: [
        { site: 'GABA-A (ethanol site)', family: 'GABA-A', mode: 'modulator', direct: true },
        { site: 'NMDA (ethanol site)', family: 'NMDA', mode: 'antagonist', direct: true },
      ],
      axes: { arousal: -22, mood: 8, cognition: -35, load: 22 },
      regions: { accumbens: 0.4, pfc: 0.8, amygdala: 0.5, brainstem: 0.6 },
      slowsClearanceOf: ['cocaine', 'benzodiazepines', 'barbiturates'],
    },
  },
  {
    id: 'barbiturates',
    name: 'Barbiturates',
    examples: 'Phenobarbital class',
    group: 'Depressants',
    cls: 'Depressant',
    action: 'Agonist (positive modulator)',
    target: 'GABA-A receptors, barbiturate binding site',
    systems: ['GABA'],
    mechanism: 'Prolongs GABA-A chloride channel opening, increasing neural inhibition.',
    tag: 'GABA-A channel prolongation',
    sim: {
      peak: 1,
      halfLife: 20,
      nt: { GABA: 1.1 },
      clearance: {},
      release: [],
      receptors: [{ site: 'GABA-A (barbiturate site)', family: 'GABA-A', mode: 'modulator', direct: true }],
      axes: { arousal: -30, mood: 0, cognition: -38, load: 32 },
      regions: { accumbens: 0.2, pfc: 0.7, amygdala: 0.6, brainstem: 0.9 },
    },
  },
  {
    id: 'benzodiazepines',
    name: 'Benzodiazepines',
    examples: 'Diazepam class',
    group: 'Depressants',
    cls: 'Depressant',
    action: 'Agonist (positive modulator)',
    target: 'GABA-A receptors, benzodiazepine binding site',
    systems: ['GABA'],
    mechanism: 'Increases how often GABA-A channels open when GABA binds, amplifying inhibition.',
    tag: 'GABA-A opening frequency',
    sim: {
      peak: 0.75,
      halfLife: 4,
      nt: { GABA: 0.8 },
      clearance: {},
      release: [],
      receptors: [{ site: 'GABA-A (benzodiazepine site)', family: 'GABA-A', mode: 'modulator', direct: true }],
      axes: { arousal: -20, mood: 4, cognition: -25, load: 15 },
      regions: { accumbens: 0.15, pfc: 0.5, amygdala: 0.9, brainstem: 0.4 },
    },
  },
  {
    id: 'inhalants',
    name: 'Inhalants',
    examples: 'Volatile solvents',
    group: 'Depressants',
    cls: 'Depressant',
    action: 'Agonist / antagonist (broad)',
    target: 'GABA-A receptors (enhance); NMDA receptors (inhibit)',
    systems: ['GABA', 'DA'],
    otherSystems: ['Glutamate'],
    mechanism: 'Broadly depresses CNS activity by enhancing GABA-A and inhibiting NMDA receptor function.',
    tag: 'broad CNS depression',
    sim: {
      peak: 0.05,
      halfLife: 0.3,
      nt: { GABA: 0.6, DA: 0.3 },
      clearance: {},
      release: [],
      receptors: [{ site: 'GABA-A (solvent site)', family: 'GABA-A', mode: 'modulator', direct: true }],
      axes: { arousal: -25, mood: 0, cognition: -45, load: 30 },
      regions: { accumbens: 0.4, pfc: 0.9, amygdala: 0.3, brainstem: 0.7 },
    },
  },
  // ——— Stimulants
  {
    id: 'caffeine',
    name: 'Caffeine',
    group: 'Stimulants',
    cls: 'Stimulant',
    action: 'Antagonist',
    target: 'Adenosine A1 / A2A receptors',
    systems: ['NE', 'DA', 'ACh'],
    otherSystems: ['Adenosine'],
    mechanism: 'Blocks adenosine receptors, removing a brake on neural activity and neurotransmitter release.',
    tag: 'adenosine blockade',
    sim: {
      peak: 0.75,
      halfLife: 5,
      nt: { DA: 0.15, NE: 0.3, ACh: 0.25 },
      clearance: {},
      release: ['NE', 'ACh'],
      receptors: [{ site: 'Adenosine A2A', family: 'A2A', mode: 'antagonist', direct: true }],
      axes: { arousal: 25, mood: 5, cognition: 5, load: 8 },
      regions: { accumbens: 0.15, pfc: 0.5, amygdala: 0.3, brainstem: 0.3 },
    },
  },
  {
    id: 'nicotine',
    name: 'Nicotine',
    group: 'Stimulants',
    cls: 'Stimulant',
    action: 'Agonist',
    target: 'Nicotinic acetylcholine receptors (nAChR)',
    systems: ['ACh', 'DA', 'NE'],
    mechanism: 'Mimics acetylcholine at nicotinic receptors, triggering dopamine release in reward pathways.',
    tag: 'nAChR activation',
    sim: {
      peak: 0.1,
      halfLife: 2,
      nt: { ACh: 0.7, DA: 0.5, NE: 0.2 },
      clearance: {},
      release: ['DA', 'ACh'],
      receptors: [{ site: 'nAChR', family: 'nAChR', mode: 'agonist', direct: true }, D2_INDIRECT],
      axes: { arousal: 15, mood: 6, cognition: 3, load: 10 },
      regions: { accumbens: 0.8, pfc: 0.4, amygdala: 0.2, brainstem: 0.3 },
    },
  },
  {
    id: 'amphetamines',
    name: 'Amphetamines',
    examples: 'Amphetamine, methamphetamine',
    group: 'Stimulants',
    cls: 'Stimulant',
    action: 'Agonist (releaser + reuptake inhibitor)',
    target: 'Dopamine (DAT) and norepinephrine (NET) transporters',
    systems: ['DA', 'NE', '5HT'],
    mechanism: 'Reverses DAT and NET, releasing dopamine and norepinephrine while blocking their reuptake.',
    tag: 'DAT/NET reversal',
    sim: {
      peak: 2.5,
      halfLife: 10,
      nt: { DA: 1.8, NE: 1.4, '5HT': 0.3 },
      clearance: { DA: 0.7, NE: 0.6 },
      release: ['DA', 'NE'],
      reverses: ['DA', 'NE'],
      receptors: [D2_INDIRECT],
      axes: { arousal: 40, mood: 18, cognition: 5, load: 30 },
      regions: { accumbens: 1, pfc: 0.7, amygdala: 0.5, brainstem: 0.5 },
    },
  },
  {
    id: 'cocaine',
    name: 'Cocaine',
    group: 'Stimulants',
    cls: 'Stimulant',
    action: 'Agonist (reuptake inhibitor)',
    target: 'DAT, SERT and NET transporters',
    systems: ['DA', 'NE', '5HT'],
    mechanism: 'Blocks dopamine reuptake, increasing synaptic concentration; also blocks serotonin and norepinephrine reuptake.',
    tag: 'DAT/SERT/NET blockade',
    sim: {
      peak: 0.25,
      halfLife: 1,
      nt: { DA: 1.6, NE: 1.0, '5HT': 0.6 },
      clearance: { DA: 0.85, NE: 0.6, '5HT': 0.5 },
      release: [],
      receptors: [D2_INDIRECT],
      axes: { arousal: 38, mood: 20, cognition: 0, load: 30 },
      regions: { accumbens: 1, pfc: 0.6, amygdala: 0.6, brainstem: 0.5 },
    },
  },
  {
    id: 'mdma',
    name: 'MDMA',
    group: 'Stimulants',
    cls: 'Stimulant',
    action: 'Agonist (releaser + reuptake inhibitor)',
    target: 'Serotonin (SERT) and norepinephrine (NET) transporters; weaker at DAT',
    systems: ['5HT', 'DA', 'NE'],
    mechanism: 'Reverses SERT and NET, releasing large amounts of serotonin and norepinephrine, with smaller dopamine release.',
    tag: 'SERT/NET reversal',
    teachingNote: 'Often classed as a stimulant with hallucinogenic properties.',
    sim: {
      peak: 2,
      halfLife: 8,
      nt: { '5HT': 2.2, DA: 0.7, NE: 0.8 },
      clearance: { '5HT': 0.7, DA: 0.2, NE: 0.3 },
      release: ['5HT'],
      reverses: ['5HT', 'NE'],
      receptors: [{ site: '5-HT2A', family: '5-HT2A', mode: 'agonist', direct: false }],
      axes: { arousal: 25, mood: 25, cognition: -15, load: 28 },
      regions: { accumbens: 0.7, pfc: 0.5, amygdala: 0.7, brainstem: 0.5 },
    },
  },
  // ——— Opioids
  {
    id: 'morphine-heroin',
    name: 'Morphine / heroin',
    group: 'Opioids',
    cls: 'Opioid',
    action: 'Agonist',
    target: 'Mu-opioid receptors',
    systems: ['DA'],
    otherSystems: ['Endorphins'],
    mechanism: 'Mimics endorphins at mu-opioid receptors; indirectly raises dopamine by inhibiting GABA interneurons.',
    tag: 'mu-opioid agonism',
    sim: {
      peak: 0.3,
      halfLife: 2.5,
      nt: { DA: 0.8, NE: -0.3, GABA: -0.25 },
      clearance: {},
      release: ['DA'],
      receptors: [{ site: 'Mu-opioid', family: 'μ-opioid', mode: 'agonist', direct: true }, D2_INDIRECT],
      axes: { arousal: -30, mood: 20, cognition: -30, load: 35 },
      regions: { accumbens: 0.9, pfc: 0.4, amygdala: 0.3, brainstem: 1 },
    },
  },
  {
    id: 'rx-opioids',
    name: 'Prescription opioids',
    examples: 'Oxycodone class',
    group: 'Opioids',
    cls: 'Opioid',
    action: 'Agonist',
    target: 'Mu-opioid receptors',
    systems: ['DA'],
    otherSystems: ['Endorphins'],
    mechanism: 'Binds and activates mu-opioid receptors, reducing pain signaling and indirectly increasing dopamine.',
    tag: 'mu-opioid agonism',
    sim: {
      peak: 0.75,
      halfLife: 3.5,
      nt: { DA: 0.6, NE: -0.2, GABA: -0.2 },
      clearance: {},
      release: ['DA'],
      receptors: [{ site: 'Mu-opioid', family: 'μ-opioid', mode: 'agonist', direct: true }, D2_INDIRECT],
      axes: { arousal: -22, mood: 14, cognition: -22, load: 28 },
      regions: { accumbens: 0.8, pfc: 0.35, amygdala: 0.3, brainstem: 0.9 },
    },
  },
  {
    id: 'opioid-antagonists',
    name: 'Opioid antagonists',
    examples: 'Naloxone class',
    group: 'Opioids',
    cls: 'Opioid',
    action: 'Antagonist',
    target: 'Mu-opioid receptors',
    systems: [],
    otherSystems: ['Endorphins'],
    mechanism: 'Occupies mu-opioid receptors without activating them, blocking and displacing opioid agonists.',
    tag: 'mu-opioid blockade',
    teachingNote: 'Classic competitive-antagonist teaching example.',
    sim: {
      peak: 0.1,
      halfLife: 1.2,
      nt: { DA: -0.05 },
      clearance: {},
      release: [],
      receptors: [{ site: 'Mu-opioid', family: 'μ-opioid', mode: 'antagonist', direct: true }],
      axes: { arousal: 0, mood: 0, cognition: 0, load: 2 },
      regions: { accumbens: 0.05, pfc: 0.05, amygdala: 0.05, brainstem: 0.05 },
    },
  },
  // ——— Hallucinogens
  {
    id: 'lsd',
    name: 'LSD',
    group: 'Hallucinogens — serotonergic',
    cls: 'Hallucinogen',
    action: 'Agonist',
    target: '5-HT2A serotonin receptors',
    systems: ['5HT', 'DA'],
    mechanism: 'Activates 5-HT2A receptors on cortical neurons, disrupting normal sensory and cortical signaling.',
    tag: '5-HT2A agonism',
    sim: {
      peak: 1,
      halfLife: 3.5,
      nt: { '5HT': 0.5, DA: 0.2 },
      clearance: {},
      release: [],
      receptors: [{ site: '5-HT2A', family: '5-HT2A', mode: 'agonist', direct: true }],
      axes: { arousal: 15, mood: 5, cognition: -30, load: 10 },
      regions: { accumbens: 0.2, pfc: 1, amygdala: 0.5, brainstem: 0.2 },
    },
  },
  {
    id: 'psilocybin',
    name: 'Psilocybin',
    group: 'Hallucinogens — serotonergic',
    cls: 'Hallucinogen',
    action: 'Agonist (via psilocin)',
    target: '5-HT2A serotonin receptors',
    systems: ['5HT'],
    mechanism: 'Converted to psilocin, which acts as a 5-HT2A partial agonist in the cortex.',
    tag: '5-HT2A partial agonism',
    sim: {
      peak: 1,
      halfLife: 2,
      nt: { '5HT': 0.45 },
      clearance: {},
      release: [],
      receptors: [{ site: '5-HT2A', family: '5-HT2A', mode: 'agonist', direct: true }],
      axes: { arousal: 8, mood: 5, cognition: -28, load: 8 },
      regions: { accumbens: 0.15, pfc: 0.9, amygdala: 0.6, brainstem: 0.15 },
    },
  },
  {
    id: 'mescaline',
    name: 'Mescaline',
    group: 'Hallucinogens — serotonergic',
    cls: 'Hallucinogen',
    action: 'Agonist',
    target: '5-HT2A serotonin receptors',
    systems: ['5HT', 'DA', 'NE'],
    mechanism: 'Acts as a 5-HT2A agonist, with a structure related to the catecholamines.',
    tag: '5-HT2A agonism',
    sim: {
      peak: 1.5,
      halfLife: 5,
      nt: { '5HT': 0.4, DA: 0.15, NE: 0.2 },
      clearance: {},
      release: [],
      receptors: [{ site: '5-HT2A', family: '5-HT2A', mode: 'agonist', direct: true }],
      axes: { arousal: 14, mood: 4, cognition: -25, load: 12 },
      regions: { accumbens: 0.2, pfc: 0.9, amygdala: 0.5, brainstem: 0.25 },
    },
  },
  {
    id: 'pcp',
    name: 'PCP / ketamine',
    group: 'Hallucinogens — dissociative',
    cls: 'Hallucinogen',
    action: 'Antagonist',
    target: 'NMDA glutamate receptors (channel pore)',
    systems: ['DA', 'NE'],
    otherSystems: ['Glutamate'],
    mechanism: 'Blocks the NMDA receptor channel, reducing glutamate signaling and disinhibiting dopamine release.',
    tag: 'NMDA channel blockade',
    teachingNote: 'Timing shown is for ketamine; PCP acts and clears far more slowly.',
    sim: {
      peak: 0.3,
      halfLife: 2,
      nt: { DA: 0.5, NE: 0.3 },
      clearance: {},
      release: ['DA'],
      receptors: [{ site: 'NMDA (channel pore)', family: 'NMDA', mode: 'antagonist', direct: true }],
      axes: { arousal: 5, mood: 0, cognition: -45, load: 22 },
      regions: { accumbens: 0.5, pfc: 1, amygdala: 0.4, brainstem: 0.4 },
    },
  },
  {
    id: 'thc',
    name: 'THC',
    examples: 'Marijuana / cannabis',
    group: 'Cannabinoids',
    cls: 'Hallucinogen',
    action: 'Agonist',
    target: 'CB1 cannabinoid receptors',
    systems: ['DA', 'GABA', 'ACh'],
    otherSystems: ['Endocannabinoids'],
    mechanism: 'Activates CB1 receptors, reducing GABA and acetylcholine release and indirectly increasing dopamine.',
    tag: 'CB1 agonism',
    teachingNote: 'Classed as a mild hallucinogen in most AP texts. Few CB1 receptors in the brainstem.',
    sim: {
      peak: 0.5,
      halfLife: 2.5,
      nt: { DA: 0.35, GABA: -0.2, ACh: -0.2 },
      clearance: {},
      release: [],
      receptors: [{ site: 'CB1', family: 'CB1', mode: 'agonist', direct: true }, D2_INDIRECT],
      axes: { arousal: -5, mood: 8, cognition: -22, load: 10 },
      regions: { accumbens: 0.5, pfc: 0.6, amygdala: 0.6, brainstem: 0.1 },
    },
  },
  // ——— Other (therapeutic teaching examples)
  {
    id: 'ssri',
    name: 'SSRIs',
    examples: 'Fluoxetine class',
    group: 'Therapeutic examples',
    cls: 'Other',
    action: 'Agonist (reuptake inhibitor)',
    target: 'Serotonin transporter (SERT)',
    systems: ['5HT'],
    mechanism: 'Selectively blocks serotonin reuptake, leaving more serotonin in the synaptic cleft.',
    tag: 'SERT blockade',
    sim: {
      peak: 6,
      halfLife: 24,
      nt: { '5HT': 0.7 },
      clearance: { '5HT': 0.8 },
      clearanceVia: 'transporter',
      release: [],
      receptors: [{ site: '5-HT2A', family: '5-HT2A', mode: 'agonist', direct: false }],
      axes: { arousal: 2, mood: 0, cognition: 0, load: 4 },
      regions: { accumbens: 0.1, pfc: 0.4, amygdala: 0.5, brainstem: 0.3 },
      slowsClearanceOf: ['mdma', 'amphetamines', 'rx-opioids', 'antipsychotics'],
    },
  },
  {
    id: 'maoi',
    name: 'MAO inhibitors',
    group: 'Therapeutic examples',
    cls: 'Other',
    action: 'Agonist (breakdown inhibitor)',
    target: 'Monoamine oxidase enzyme',
    systems: ['5HT', 'NE', 'DA'],
    mechanism: 'Blocks the enzyme that breaks down monoamines, raising serotonin, norepinephrine and dopamine levels.',
    tag: 'MAO inhibition',
    sim: {
      peak: 2,
      halfLife: 8,
      nt: { '5HT': 0.6, NE: 0.5, DA: 0.4 },
      clearance: { '5HT': 0.5, NE: 0.5, DA: 0.4 },
      clearanceVia: 'enzyme',
      release: [],
      receptors: [],
      axes: { arousal: 8, mood: 0, cognition: 0, load: 8 },
      regions: { accumbens: 0.3, pfc: 0.4, amygdala: 0.5, brainstem: 0.4 },
    },
  },
  {
    id: 'antipsychotics',
    name: 'Antipsychotics',
    examples: 'Typical (haloperidol class)',
    group: 'Therapeutic examples',
    cls: 'Other',
    action: 'Antagonist',
    target: 'Dopamine D2 receptors',
    systems: ['DA'],
    mechanism: 'Blocks D2 dopamine receptors, reducing dopamine signaling in mesolimbic pathways.',
    tag: 'D2 blockade',
    sim: {
      peak: 2,
      halfLife: 20,
      nt: { DA: -0.45 },
      clearance: {},
      release: [],
      receptors: [{ site: 'D2', family: 'D2', mode: 'antagonist', direct: true }],
      axes: { arousal: -10, mood: -4, cognition: -8, load: 8 },
      regions: { accumbens: 0.8, pfc: 0.5, amygdala: 0.3, brainstem: 0.2 },
    },
  },
  {
    id: 'ldopa',
    name: 'L-DOPA',
    group: 'Therapeutic examples',
    cls: 'Other',
    action: 'Agonist (precursor)',
    target: 'Dopamine synthesis pathway',
    systems: ['DA'],
    mechanism: 'Crosses the blood–brain barrier and is converted to dopamine, increasing dopamine available for release.',
    tag: 'DA precursor loading',
    teachingNote: "Parkinson's disease teaching example.",
    sim: {
      peak: 0.75,
      halfLife: 1.5,
      nt: { DA: 0.9 },
      clearance: {},
      release: ['DA'],
      receptors: [D2_INDIRECT],
      axes: { arousal: 5, mood: 3, cognition: 0, load: 8 },
      regions: { accumbens: 0.5, pfc: 0.3, amygdala: 0.1, brainstem: 0.25 },
    },
  },
];

export const BY_ID: Record<string, Substance> = Object.fromEntries(SUBSTANCES.map((s) => [s.id, s]));

export const CLASS_ORDER: DrugClass[] = ['Depressant', 'Stimulant', 'Opioid', 'Hallucinogen', 'Other'];
