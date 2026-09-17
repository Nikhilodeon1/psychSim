/**
 * Simulation log for human or LLM accuracy review.
 *
 *   npm run log
 *
 * Runs curated scenarios through both layers of the app:
 *   1. the model (src/sim/engine.ts): signaling, cleft levels, blockade, effect axes, brain regions, rules, summary
 *   2. the synapse animation's particle model (src/sim/synapseWorld.ts), stepped headlessly with a fixed seed
 *      exactly as the canvas steps it during playback: molecules in the cleft, receptor occupancy by what,
 *      activated / blocked receptors, transporter status
 * Every 30 simulated minutes it records both, plus automatic checks and the textbook expectation for review.
 *
 * Output: verify/out/sim-log.md (for reading) and verify/out/sim-log.json (full data).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { BY_ID, NT_INFO, NT_LIST } from '../src/data/substances';
import type { NT } from '../src/data/substances';
import { AXIS_INFO, DURATION, STEPS, simulate } from '../src/sim/engine';
import type { SimResult } from '../src/sim/engine';
import { sample, shownNTs, synapseTerms } from '../src/sim/sample';
import { createWorld, moleculeTarget, seededRandom, snapshotWorld, stepWorld } from '../src/sim/synapseWorld';
import type { World } from '../src/sim/synapseWorld';
import { parseSelection } from './trace';
import { FACTS } from './reference';

const RUN_SECONDS = 26; // playback length used by the app
const FPS = 30;
const CHECKPOINT_HOURS = 0.5;
const AVERAGE_FRAMES = FPS; // average animation counts over the last second before each checkpoint

// ---------------------------------------------------------------------------------------------------------
// Scenarios

type Log = ReturnType<typeof runScenario>;
type Check = { desc: string; test: (log: Log) => boolean };
type Scenario = { id: string; title: string; args: string[]; expect: string; checks?: Check[] };

const at = (log: Log, hour: number) => log.timeline.reduce((best, c) => (Math.abs(c.t - hour) < Math.abs(best.t - hour) ? c : best));
const peak = (log: Log, f: (c: Log['timeline'][number]) => number) => Math.max(...log.timeline.map(f));
const recv = (c: Log['timeline'][number], family: string) => c.animation.receptors.find((r) => r.family === family);

const SCENARIOS: Scenario[] = [
  {
    id: 'cocaine-ssri',
    title: 'Two SERT blockers',
    args: ['cocaine', 'ssri'],
    expect: 'Both block serotonin reuptake (SERT), so synaptic serotonin should rise more than with either alone. Cocaine also blocks DAT/NET. SSRIs reach peak slowly (hours); cocaine acts and clears within ~2 h.',
    checks: [
      { desc: 'Reuptake stacking fires on serotonin', test: (l) => l.rules.some((r) => r.startsWith('stacking') && r.includes('Serotonin')) },
      { desc: 'SERT shown as blocked in the animation at 2 h', test: (l) => (at(l, 2).animation.transporters.find((p) => p.name === 'SERT')?.blockedPct ?? 0) > 30 },
      { desc: 'Cleft serotonin above baseline at 2 h', test: (l) => at(l, 2).model.cleft['5HT'] > 1.2 },
    ],
  },
  {
    id: 'amph-cocaine',
    title: 'Releaser + reuptake blocker (dopamine)',
    args: ['amphetamines', 'cocaine'],
    expect: 'Amphetamine reverses DAT/NET (pumps dopamine out); cocaine blocks DAT/NET/SERT. Dopamine and norepinephrine rise strongly.',
    checks: [
      { desc: 'DAT shown reversed at 2 h', test: (l) => at(l, 2).animation.transporters.some((p) => p.name === 'DAT' && p.status.startsWith('Reversed')) },
      { desc: 'Cleft dopamine > 2× at peak', test: (l) => peak(l, (c) => c.model.cleft.DA) > 2 },
    ],
  },
  {
    id: 'mdma-ssri',
    title: 'MDMA with an SSRI',
    args: ['mdma', 'ssri'],
    expect: 'REVIEW CAREFULLY: MDMA needs SERT to enter the terminal and reverse it. SSRI pretreatment is documented to blunt MDMA-induced serotonin release. SSRIs also slow MDMA metabolism (CYP2D6).',
  },
  {
    id: 'maoi-ssri',
    title: 'MAO inhibitor + SSRI',
    args: ['maoi', 'ssri'],
    expect: 'Blocking both serotonin breakdown (MAO) and reuptake (SERT) raises synaptic serotonin supra-additively; the classic mechanism behind serotonin syndrome risk.',
    checks: [{ desc: 'Stacking via enzyme + transporter', test: (l) => l.rules.some((r) => r.includes('enzyme') && r.includes('transporter')) }],
  },
  {
    id: 'maoi-mdma',
    title: 'MAO inhibitor + MDMA',
    args: ['maoi', 'mdma'],
    expect: 'MDMA releases serotonin; MAO inhibition prevents its breakdown. Serotonin should rise strongly.',
    checks: [{ desc: 'Cleft serotonin > 3× at peak', test: (l) => peak(l, (c) => c.model.cleft['5HT']) > 3 }],
  },
  {
    id: 'morphine-naloxone-same',
    title: 'Opioid agonist + antagonist together',
    args: ['morphine-heroin', 'opioid-antagonists'],
    expect: 'Naloxone is a competitive mu-opioid antagonist with higher affinity; it occupies receptors without activating them and blocks both morphine and endorphins. Net opioid effect is strongly reduced.',
    checks: [
      { desc: 'Competition rule names the antagonist', test: (l) => l.rules.some((r) => r.startsWith('competition') && r.includes('antagonist')) },
      { desc: 'Endorphins shown', test: (l) => l.labels.includes('Endorphins') },
      { desc: 'Some mu-opioid receptors shown blocked at 0.5 h', test: (l) => (recv(at(l, 0.5), 'μ-opioid')?.blocked ?? 0) > 0 },
    ],
  },
  {
    id: 'morphine-naloxone-late',
    title: 'Naloxone given 2 h after morphine',
    args: ['morphine-heroin', 'opioid-antagonists:typical:+2'],
    expect: 'Morphine acts unopposed for 2 h; naloxone then rapidly reverses it. Naloxone has a shorter half-life than morphine, so opioid effects can partly return as naloxone wears off (re-narcotization).',
    checks: [
      { desc: 'No blocked mu receptors before naloxone (1.5 h)', test: (l) => (recv(at(l, 1.5), 'μ-opioid')?.blocked ?? 0) === 0 },
      { desc: 'Blocked mu receptors after naloxone (2.5 h)', test: (l) => (recv(at(l, 2.5), 'μ-opioid')?.blocked ?? 0) > 0 },
      { desc: 'Brainstem index lower at 2.5 h than at 2.0 h', test: (l) => at(l, 2.5).model.regions.brainstem < at(l, 2).model.regions.brainstem },
    ],
  },
  {
    id: 'oxy-ssri',
    title: 'Prescription opioid + SSRI',
    args: ['rx-opioids', 'ssri'],
    expect: 'Fluoxetine/paroxetine inhibit CYP2D6, which contributes to oxycodone metabolism; illustrative slowed clearance. No shared receptor or transporter.',
    checks: [{ desc: 'Metabolic interaction only', test: (l) => l.rules.length === 1 && l.rules[0].startsWith('metabolic') }],
  },
  {
    id: 'alcohol-benzo',
    title: 'Alcohol + benzodiazepine',
    args: ['alcohol', 'benzodiazepines'],
    expect: 'Both enhance GABA-A signaling at DIFFERENT binding sites, so effects add rather than compete (dangerous CNS depression). Acute alcohol inhibits benzodiazepine metabolism. Neither adds GABA to the cleft; they strengthen the receptor response.',
    checks: [
      { desc: 'No competition rule', test: (l) => !l.rules.some((r) => r.startsWith('competition')) },
      { desc: 'Cleft GABA stays at baseline', test: (l) => peak(l, (c) => Math.abs(c.model.cleft.GABA - 1)) < 0.05 },
      { desc: 'GABA signaling above baseline', test: (l) => peak(l, (c) => c.model.signaling.GABA) > 1.5 },
      { desc: 'Modulators seen on GABA-A side sites', test: (l) => l.timeline.some((c) => (recv(c, 'GABA-A')?.modulatorBound ?? 0) > 0) },
    ],
  },
  {
    id: 'depressant-triple',
    title: 'Alcohol + barbiturate + morphine',
    args: ['alcohol', 'barbiturates', 'morphine-heroin'],
    expect: 'Three CNS depressants converging on brainstem function (GABA-A enhancement + mu-opioid). Physiological load and brainstem involvement should be among the highest of any scenario. Alcohol slows barbiturate metabolism.',
    checks: [{ desc: 'Physiological load peak > 55', test: (l) => peak(l, (c) => c.model.axes.load) > 55 }],
  },
  {
    id: 'lsd-psilocybin',
    title: 'Two 5-HT2A agonists',
    args: ['lsd', 'psilocybin'],
    expect: 'Both act at 5-HT2A; they compete for the same receptor (the basis of cross-tolerance). Neither increases serotonin in the cleft.',
    checks: [
      { desc: 'Competition at 5-HT2A', test: (l) => l.rules.some((r) => r.startsWith('competition') && r.includes('5-HT2A')) },
      { desc: 'Cleft serotonin stays at baseline', test: (l) => peak(l, (c) => Math.abs(c.model.cleft['5HT'] - 1)) < 0.05 },
    ],
  },
  {
    id: 'antipsychotic-amph',
    title: 'D2 antagonist + amphetamine',
    args: ['antipsychotics', 'amphetamines'],
    expect: 'Amphetamine raises synaptic dopamine; the antipsychotic blocks D2 receptors, blunting its effects. Synaptic dopamine is not reduced by the antipsychotic.',
    checks: [
      { desc: 'Competition at D2', test: (l) => l.rules.some((r) => r.startsWith('competition') && r.includes('D2')) },
      { desc: 'Some D2 receptors shown blocked', test: (l) => l.timeline.some((c) => (recv(c, 'D2')?.blocked ?? 0) > 0) },
    ],
  },
  {
    id: 'antipsychotic-ldopa',
    title: 'D2 antagonist + L-DOPA',
    args: ['antipsychotics', 'ldopa'],
    expect: 'L-DOPA increases dopamine synthesis and release; D2 blockade opposes its effect (why typical antipsychotics worsen Parkinsonism).',
  },
  {
    id: 'caffeine-nicotine',
    title: 'Caffeine + nicotine',
    args: ['caffeine', 'nicotine'],
    expect: 'Different targets (adenosine receptor antagonist vs nicotinic agonist); no shared mechanism. Effects on arousal add.',
    checks: [{ desc: 'No rules fire', test: (l) => l.rules.length === 0 }],
  },
  {
    id: 'thc-alcohol',
    title: 'THC + alcohol',
    args: ['thc', 'alcohol'],
    expect: 'No shared binding site. THC acts at presynaptic CB1 receptors (reducing GABA release); anandamide is the natural messenger and travels backward from the receiving neuron.',
    checks: [
      { desc: 'CB1 drawn on the presynaptic membrane', test: (l) => l.timeline[0].animation.receptors.some((r) => r.family === 'CB1' && r.membrane === 'presynaptic') },
      { desc: 'Anandamide shown', test: (l) => l.labels.includes('Anandamide') },
    ],
  },
  {
    id: 'pcp-alcohol',
    title: 'PCP/ketamine + alcohol',
    args: ['pcp', 'alcohol'],
    expect: 'Both reduce NMDA receptor function at different sites (channel pore vs ethanol site), so effects add rather than compete. Glutamate is the natural messenger.',
    checks: [
      { desc: 'No competition rule', test: (l) => !l.rules.some((r) => r.startsWith('competition')) },
      { desc: 'Glutamate shown', test: (l) => l.labels.includes('Glutamate') },
    ],
  },
  {
    id: 'cocaine-alcohol',
    title: 'Cocaine + alcohol',
    args: ['cocaine', 'alcohol'],
    expect: 'Liver forms cocaethylene and alcohol slows cocaine clearance, so cocaine-related effects last longer. Opposing effects on arousal.',
    checks: [{ desc: 'Metabolic: alcohol slows cocaine', test: (l) => l.rules.some((r) => r.startsWith('metabolic') && r.includes('Alcohol slows Cocaine')) }],
  },
  {
    id: 'caffeine-benzo',
    title: 'Stimulant + depressant with opposing arousal',
    args: ['caffeine:high', 'benzodiazepines'],
    expect: 'No shared mechanism. Opposing effects on arousal partially offset; cognitive/motor effects of the benzodiazepine are not reversed by caffeine.',
    checks: [{ desc: 'Cognitive/motor function still below baseline at 1 h', test: (l) => at(l, 1).model.axes.cognition < AXIS_INFO.cognition.base - 5 }],
  },
  {
    id: 'nicotine-thc',
    title: 'Nicotine + THC',
    args: ['nicotine', 'thc'],
    expect: 'Both indirectly raise mesolimbic dopamine by different routes (nicotinic receptors on dopamine neurons; CB1-mediated reduction of GABA inhibition). No shared binding site.',
    checks: [{ desc: 'No rules fire', test: (l) => l.rules.length === 0 }],
  },
  {
    id: 'inhalant-alcohol-late',
    title: 'Inhalant, then alcohol 1 h later',
    args: ['inhalants', 'alcohol:typical:+1'],
    expect: 'Inhalant effects last minutes; by the time alcohol acts the inhalant has largely cleared, so little overlap.',
    checks: [{ desc: 'Inhalant activity below 15% of peak by 1 h (effects fade within tens of minutes)', test: (l) => l.subs[0].activityAt1h < 0.15 }],
  },
  {
    id: 'mescaline-ssri',
    title: '5-HT2A agonist + SSRI',
    args: ['mescaline', 'ssri'],
    expect: 'No shared binding site: mescaline activates 5-HT2A receptors directly, the SSRI blocks the serotonin transporter. Serotonin in the cleft rises from the SSRI alone.',
    checks: [
      { desc: 'No competition rule', test: (l) => !l.rules.some((r) => r.startsWith('competition')) },
      { desc: 'Cleft serotonin rises above baseline', test: (l) => peak(l, (c) => c.model.cleft['5HT']) > 1.2 },
    ],
  },

  // --- single substances, for checking each mechanism on its own
  {
    id: 'cocaine-solo',
    title: 'Cocaine alone',
    args: ['cocaine'],
    expect: 'Blocks DAT, SERT and NET. Fast on, fast off (half-life ~1 h). Dopamine in the cleft rises well above baseline; transporters shown blocked with cocaine molecules sitting in them.',
    checks: [
      { desc: 'DAT blocked above 50% at peak', test: (l) => peak(l, (c) => c.animation.transporters.find((p) => p.name === 'DAT')?.blockedPct ?? 0) > 50 },
      { desc: 'Largely cleared by 4 h', test: (l) => at(l, 4).model.cleft.DA < 1.15 },
    ],
  },
  {
    id: 'amphetamine-solo',
    title: 'Amphetamine alone',
    args: ['amphetamines'],
    expect: 'Reverses DAT and NET so dopamine and norepinephrine are pumped out of the terminal; slower peak (1-4 h) and much longer half-life than cocaine.',
    checks: [{ desc: 'Transporter shown reversed', test: (l) => l.timeline.some((c) => c.animation.transporters.some((p) => p.status.startsWith('Reversed'))) }],
  },
  {
    id: 'ssri-solo',
    title: 'SSRI alone',
    args: ['ssri'],
    expect: 'Blocks only SERT. Serotonin in the cleft rises; dopamine and norepinephrine should be unchanged. Slow to peak (hours) and still present at 8 h.',
    checks: [
      { desc: 'Dopamine unchanged', test: (l) => peak(l, (c) => Math.abs(c.model.cleft.DA - 1)) < 0.05 },
      { desc: 'Still active at 8 h', test: (l) => at(l, 8).model.cleft['5HT'] > 1.3 },
    ],
  },
  {
    id: 'morphine-solo',
    title: 'Morphine / heroin alone',
    args: ['morphine-heroin'],
    expect: 'Mu-opioid agonist. Endorphins, the natural messenger, should also be visible at the same receptors. Dopamine rises indirectly (GABA interneurons are inhibited). Brainstem involvement is the highest of any region.',
    checks: [
      { desc: 'Endorphins visible alongside the drug', test: (l) => l.timeline.some((c) => (c.animation.free.Endorphins ?? 0) + (c.animation.bound.Endorphins ?? 0) > 0) },
      { desc: 'Mu receptors occupied by the drug', test: (l) => l.timeline.some((c) => (recv(c, 'μ-opioid')?.occupiedBy['Morphine / heroin'] ?? 0) > 0) },
      { desc: 'Brainstem is the strongest region at peak', test: (l) => { const c = at(l, 0.5).model.regions; return c.brainstem >= Math.max(c.accumbens, c.pfc, c.amygdala); } },
    ],
  },
  {
    id: 'naloxone-solo',
    title: 'Naloxone alone (no opioid present)',
    args: ['opioid-antagonists'],
    expect: 'With no opioid on board, a mu antagonist has little effect beyond displacing endorphins. Effect axes should stay near baseline.',
    checks: [
      { desc: 'Arousal stays near baseline', test: (l) => peak(l, (c) => Math.abs(c.model.axes.arousal - AXIS_INFO.arousal.base)) < 5 },
      { desc: 'Mu receptors shown blocked', test: (l) => l.timeline.some((c) => (recv(c, 'μ-opioid')?.blocked ?? 0) > 0) },
    ],
  },
  {
    id: 'benzo-solo',
    title: 'Benzodiazepine alone',
    args: ['benzodiazepines'],
    expect: 'Positive modulator at the benzodiazepine site of GABA-A: it does not add GABA to the cleft and does not open the channel by itself; it strengthens the response to GABA. Amygdala is the strongest region.',
    checks: [
      { desc: 'Drug bound at modulator sites, not the GABA site', test: (l) => l.timeline.some((c) => (recv(c, 'GABA-A')?.modulatorBound ?? 0) > 0) },
      { desc: 'Cleft GABA at baseline', test: (l) => peak(l, (c) => Math.abs(c.model.cleft.GABA - 1)) < 0.05 },
    ],
  },
  {
    id: 'caffeine-solo',
    title: 'Caffeine alone',
    args: ['caffeine'],
    expect: 'Adenosine receptor antagonist: it blocks A2A receptors rather than acting on a neurotransmitter transporter. Adenosine, the natural messenger, should be visible and displaced. Arousal rises.',
    checks: [
      { desc: 'Adenosine shown', test: (l) => l.labels.includes('Adenosine') },
      { desc: 'A2A receptors shown blocked', test: (l) => l.timeline.some((c) => (recv(c, 'A2A')?.blocked ?? 0) > 0) },
      { desc: 'No transporter blockade', test: (l) => l.timeline.every((c) => c.animation.transporters.every((p) => p.blockedPct === 0)) },
    ],
  },
  {
    id: 'nicotine-solo',
    title: 'Nicotine alone',
    args: ['nicotine'],
    expect: 'Nicotinic acetylcholine receptor agonist; triggers dopamine release in the reward pathway. Very fast onset. Nucleus accumbens is the strongest region.',
    checks: [{ desc: 'Accumbens is the strongest region at peak', test: (l) => { const c = at(l, 0.5).model.regions; return c.accumbens >= Math.max(c.pfc, c.amygdala, c.brainstem); } }],
  },
  {
    id: 'thc-solo',
    title: 'THC alone',
    args: ['thc'],
    expect: 'CB1 agonist. CB1 receptors sit on the sending neuron, and anandamide is made by the receiving neuron and travels backward to them. THC reduces GABA release, which indirectly raises dopamine.',
    checks: [
      { desc: 'CB1 on the presynaptic membrane', test: (l) => l.timeline[0].animation.receptors.some((r) => r.family === 'CB1' && r.membrane === 'presynaptic') },
      { desc: 'Cleft GABA falls below baseline', test: (l) => Math.min(...l.timeline.map((c) => c.model.cleft.GABA)) < 0.95 },
    ],
  },
  {
    id: 'lsd-solo',
    title: 'LSD alone',
    args: ['lsd'],
    expect: '5-HT2A agonist: it mimics serotonin at the receptor rather than raising serotonin levels. Prefrontal cortex is the strongest region; cognitive/motor score drops.',
    checks: [
      { desc: 'Cleft serotonin at baseline while signaling rises', test: (l) => peak(l, (c) => Math.abs(c.model.cleft['5HT'] - 1)) < 0.05 && peak(l, (c) => c.model.signaling['5HT']) > 1.2 },
      { desc: 'PFC is the strongest region at peak', test: (l) => { const c = at(l, 1).model.regions; return c.pfc >= Math.max(c.accumbens, c.amygdala, c.brainstem); } },
    ],
  },
  {
    id: 'antipsychotic-solo',
    title: 'Antipsychotic alone',
    args: ['antipsychotics'],
    expect: 'D2 antagonist: dopamine signaling falls, but dopamine in the cleft is not removed. Receptors should show as blocked, not activated.',
    checks: [
      { desc: 'Signaling falls below baseline', test: (l) => Math.min(...l.timeline.map((c) => c.model.signaling.DA)) < 0.8 },
      { desc: 'Cleft dopamine not reduced', test: (l) => Math.min(...l.timeline.map((c) => c.model.cleft.DA)) >= 1 },
    ],
  },
  {
    id: 'inhalants-solo',
    title: 'Inhalants alone',
    args: ['inhalants'],
    expect: 'Very fast onset and very short duration. Enhances GABA-A and inhibits NMDA; the largest drop in the cognitive/motor score of any single substance.',
    checks: [{ desc: 'Peak within the first 30 min', test: (l) => l.subs[0].peakActivityAt <= 0.5 }],
  },
  {
    id: 'cocaine-high-vs-low',
    title: 'Cocaine at high intensity',
    args: ['cocaine:high'],
    expect: 'Same mechanism as a typical amount, scaled up: more transporter blockade, higher dopamine, higher physiological load. Timing of the peak should not change.',
    checks: [{ desc: 'Peak time matches the typical run', test: (l) => Math.abs(l.subs[0].peakActivityAt - 0.25) < 0.3 }],
  },
];

// --- further combinations, one per mechanism pattern a class might ask about
const MORE: Scenario[] = [
  {
    id: 'barb-benzo',
    title: 'Barbiturate + benzodiazepine',
    args: ['barbiturates', 'benzodiazepines'],
    expect: 'Both enhance GABA-A but at different sites (barbiturates lengthen channel opening, benzodiazepines increase opening frequency), so effects add rather than compete. Barbiturates are the more dangerous of the two.',
    checks: [
      { desc: 'No competition rule', test: (l) => !l.rules.some((r) => r.startsWith('competition')) },
      { desc: 'Summary explains distinct sites', test: (l) => l.summary.join(' ').includes('distinct binding sites') },
    ],
  },
  {
    id: 'morphine-benzo',
    title: 'Opioid + benzodiazepine',
    args: ['morphine-heroin', 'benzodiazepines'],
    expect: 'Different receptors (mu-opioid and GABA-A) but both depress brainstem function; physiological load should be high. No shared binding site, so no competition rule.',
    checks: [{ desc: 'Brainstem above 50 at peak', test: (l) => peak(l, (c) => c.model.regions.brainstem * 100) > 50 }],
  },
  {
    id: 'naloxone-rx',
    title: 'Naloxone + prescription opioid',
    args: ['rx-opioids', 'opioid-antagonists'],
    expect: 'Same competitive antagonism as with morphine: naloxone occupies mu receptors and reduces the agonist effect.',
    checks: [{ desc: 'Competition with a named antagonist', test: (l) => l.rules.some((r) => r.startsWith('competition') && r.includes('antagonist')) }],
  },
  {
    id: 'amph-ssri',
    title: 'Amphetamine + SSRI',
    args: ['amphetamines', 'ssri'],
    expect: 'Different transporters (DAT/NET vs SERT), so no reuptake stacking. Fluoxetine-type SSRIs inhibit CYP2D6 and slow amphetamine clearance.',
    checks: [{ desc: 'Metabolic interaction, no stacking', test: (l) => l.rules.some((r) => r.startsWith('metabolic')) && !l.rules.some((r) => r.startsWith('stacking')) }],
  },
  {
    id: 'ssri-antipsychotic',
    title: 'SSRI + antipsychotic',
    args: ['ssri', 'antipsychotics'],
    expect: 'No shared transporter or binding site; the SSRI slows antipsychotic clearance (CYP2D6). Dopamine signaling falls, serotonin in the cleft rises.',
    checks: [{ desc: 'Metabolic interaction only', test: (l) => l.rules.length === 1 && l.rules[0].startsWith('metabolic') }],
  },
  {
    id: 'antipsychotic-cocaine',
    title: 'D2 antagonist + cocaine',
    args: ['antipsychotics', 'cocaine'],
    expect: 'Cocaine raises synaptic dopamine; D2 blockade blunts its postsynaptic effect. Cocaine still blocks transporters, so dopamine in the cleft still rises.',
    checks: [
      { desc: 'Competition at D2', test: (l) => l.rules.some((r) => r.includes('D2')) },
      { desc: 'Cleft dopamine still rises', test: (l) => peak(l, (c) => c.model.cleft.DA) > 1.5 },
    ],
  },
  {
    id: 'lsd-mescaline',
    title: 'LSD + mescaline',
    args: ['lsd', 'mescaline'],
    expect: 'Both are 5-HT2A agonists and compete for the same receptor (cross-tolerance).',
    checks: [{ desc: 'Competition at 5-HT2A', test: (l) => l.rules.some((r) => r.includes('5-HT2A')) }],
  },
  {
    id: 'caffeine-amph',
    title: 'Caffeine + amphetamine',
    args: ['caffeine', 'amphetamines'],
    expect: 'Different mechanisms (adenosine blockade vs transporter reversal); arousal effects add but no rule should fire.',
    checks: [{ desc: 'No rules fire', test: (l) => l.rules.length === 0 }],
  },
  {
    id: 'nicotine-alcohol',
    title: 'Nicotine + alcohol',
    args: ['nicotine', 'alcohol'],
    expect: 'No shared site. Opposite directions on arousal; both raise dopamine in the reward pathway by different routes.',
    checks: [{ desc: 'No rules fire', test: (l) => l.rules.length === 0 }],
  },
  {
    id: 'thc-lsd',
    title: 'THC + LSD',
    args: ['thc', 'lsd'],
    expect: 'Different receptors (CB1 vs 5-HT2A). Both reduce the cognitive/motor score; neither raises serotonin in the cleft.',
    checks: [{ desc: 'Cognitive/motor score well below baseline', test: (l) => Math.min(...l.timeline.map((c) => c.model.axes.cognition)) < AXIS_INFO.cognition.base - 25 }],
  },
  {
    id: 'inhalant-benzo',
    title: 'Inhalant + benzodiazepine',
    args: ['inhalants', 'benzodiazepines'],
    expect: 'Both act at GABA-A through different sites; the inhalant is brief, the benzodiazepine long. Effects add early on.',
  },
  {
    id: 'cocaine-late-ssri',
    title: 'SSRI first, cocaine 4 h later',
    args: ['ssri', 'cocaine:typical:+4'],
    expect: 'The SSRI is near its peak when cocaine arrives, so serotonin reuptake stacking should fire in the second half of the run, not the first.',
    checks: [
      { desc: 'Stacking rule fires', test: (l) => l.rules.some((r) => r.startsWith('stacking')) },
      { desc: 'No rule active at 2 h', test: (l) => at(l, 2).model.activeRules.length === 0 },
      { desc: 'Rule active at 5 h', test: (l) => at(l, 5).model.activeRules.length > 0 },
    ],
  },
  {
    id: 'alcohol-high-morphine',
    title: 'High alcohol + morphine',
    args: ['alcohol:high', 'morphine-heroin'],
    expect: 'Two depressants by different mechanisms; brainstem involvement and physiological load should be among the highest seen.',
    checks: [{ desc: 'Load above 60 at peak', test: (l) => peak(l, (c) => c.model.axes.load) > 60 }],
  },
  {
    id: 'mdma-low',
    title: 'MDMA at low intensity',
    args: ['mdma:low'],
    expect: 'Same mechanism as a typical amount with smaller changes; serotonin should still be the dominant change.',
    checks: [{ desc: 'Serotonin is the largest change', test: (l) => peak(l, (c) => c.model.cleft['5HT']) > peak(l, (c) => c.model.cleft.DA) }],
  },
];
SCENARIOS.push(...MORE);

// --- every substance on its own, so each drug has a documented trial.
// The expectation is generated from the independent fact base, not from the app's own data.
for (const [id, f] of Object.entries(FACTS)) {
  if (SCENARIOS.some((sc) => sc.args.length === 1 && sc.args[0].split(':')[0] === id)) continue;
  const sub = BY_ID[id];
  const parts = [
    `Class: ${f.cls}. ${f.polarity}.`,
    f.sites ? `Binds: ${Object.entries(f.sites).map(([site, mode]) => `${site} (${mode})`).join(', ')}.` : '',
    f.blocksClearance ? `Blocks clearance of: ${Object.entries(f.blocksClearance).map(([n, via]) => `${NT_INFO[n as NT].name} (${via})`).join(', ')}.` : '',
    f.reverses ? `Reverses transporters: ${f.reverses.map((n) => NT_INFO[n].name).join(', ')}.` : '',
    `Peak ${f.tmax[0]}-${f.tmax[1]} h${f.halfLife ? `, half-life ${f.halfLife[0]}-${f.halfLife[1]} h` : ', no simple half-life'}.`,
    `Expected direction: arousal ${f.direction.arousal > 0 ? 'up' : f.direction.arousal < 0 ? 'down' : 'little change'}, cognitive/motor ${f.direction.cognition < 0 ? 'down' : 'little change'}.`,
    f.topRegion ? `Strongest region: ${f.topRegion}.` : '',
    f.note ?? '',
  ];
  SCENARIOS.push({
    id: `${id}-solo-auto`,
    title: `${sub.name} alone`,
    args: [id],
    expect: parts.filter(Boolean).join(' '),
  });
}

// ---------------------------------------------------------------------------------------------------------
// Runner

function runScenario(sc: Scenario) {
  const sels = sc.args.map(parseSelection);
  const result: SimResult = simulate(sels);
  const world: World = createWorld(result, seededRandom(20260917));
  // The canvas settles the particle model before its first frame; do the same here.
  for (let i = 0; i < 240; i++) stepWorld(world, 0, 1 / FPS);

  const ruleText = result.rules.map((r) => {
    const name = (i: number) => result.subs[i].sub.name;
    if (r.kind === 'stacking') return `stacking: ${NT_INFO[r.nt].name} clearance by ${r.subs.map(name).join(' + ')} (via ${[...new Set(r.via)].join(' + ')})`;
    if (r.kind === 'competition')
      return `competition: ${r.site} between ${r.subs.map(name).join(' and ')}${r.antagonist !== null ? ` (antagonist: ${name(r.antagonist)})` : ''}`;
    return `metabolic: ${name(r.slower)} slows ${name(r.slowed)}`;
  });

  const timeline: {
    t: number;
    model: {
      signaling: Record<NT, number>;
      cleft: Record<NT, number>;
      blockade: Record<NT, number>;
      axes: Record<string, number>;
      regions: Record<string, number>;
      activeRules: string[];
    };
    animation: ReturnType<typeof snapshotWorld>;
  }[] = [];

  const framesPerHour = (RUN_SECONDS / DURATION) * FPS;
  let frame = 0;
  for (let t = 0; t <= DURATION + 1e-9; t += CHECKPOINT_HOURS) {
    // step the animation forward at playback speed to this checkpoint
    const target = Math.round(t * framesPerHour);
    for (; frame < target; frame++) stepWorld(world, (frame / framesPerHour), 1 / FPS);
    // average over the last second of animation so single-frame randomness does not dominate
    const samples: ReturnType<typeof snapshotWorld>[] = [];
    for (let i = 0; i < AVERAGE_FRAMES; i++) {
      samples.push(snapshotWorld(world, t));
      stepWorld(world, t, 1 / FPS);
    }
    const mean = (pick: (s: (typeof samples)[number]) => number) => samples.reduce((n, s) => n + pick(s), 0) / samples.length;
    const meanTally = (pick: (s: (typeof samples)[number]) => Record<string, number>) => {
      const keys = new Set(samples.flatMap((s) => Object.keys(pick(s))));
      return Object.fromEntries([...keys].map((k) => [k, Math.round(mean((s) => pick(s)[k] ?? 0))])) as Record<string, number>;
    };
    const last = samples[samples.length - 1];
    const averaged = {
      ...last,
      free: meanTally((s) => s.free),
      bound: meanTally((s) => s.bound),
      receptors: last.receptors.map((r, ri) => ({
        ...r,
        activated: Math.round(mean((s) => s.receptors[ri]?.activated ?? 0)),
        blocked: Math.round(mean((s) => s.receptors[ri]?.blocked ?? 0)),
        modulatorBound: Math.round(mean((s) => s.receptors[ri]?.modulatorBound ?? 0)),
      })),
    };
    const k = Math.round((t / DURATION) * STEPS);
    timeline.push({
      t,
      model: {
        signaling: Object.fromEntries(NT_LIST.map((n) => [n, +result.nt[n][k].toFixed(2)])) as Record<NT, number>,
        cleft: Object.fromEntries(NT_LIST.map((n) => [n, +result.cleft[n][k].toFixed(2)])) as Record<NT, number>,
        blockade: Object.fromEntries(NT_LIST.map((n) => [n, Math.round(result.blockade[n][k] * 100)])) as Record<NT, number>,
        axes: Object.fromEntries(Object.keys(AXIS_INFO).map((a) => [a, Math.round(result.axes[a as keyof typeof result.axes][k])])),
        regions: Object.fromEntries(Object.keys(result.regions).map((r) => [r, +(result.regions[r as keyof typeof result.regions][k]).toFixed(2)])),
        activeRules: result.rules.filter((r) => r.overlap[k] > 0.1).map((r, i) => ruleText[result.rules.indexOf(r)] ?? ruleText[i]),
      },
      animation: averaged,
    });
  }

  const log = {
    id: sc.id,
    title: sc.title,
    args: sc.args,
    expect: sc.expect,
    labels: synapseTerms(result),
    shownNeurotransmitters: shownNTs(result).map((n) => NT_INFO[n].name),
    subs: result.subs.map((s) => ({
      name: s.sub.name,
      mechanism: s.sub.mechanism,
      intensity: s.sel.intensity,
      offsetH: s.sel.offset,
      halfLifeH: +s.halfLife.toFixed(2),
      slowedClearance: s.stretched,
      lowestPotency: +s.potency.toFixed(2),
      peakActivityAt: +((s.activity.indexOf(Math.max(...s.activity)) / STEPS) * DURATION).toFixed(2),
      activityAt1h: +sample(s.activity, 1).toFixed(3),
    })),
    rules: ruleText,
    summary: result.blurb,
    drivers: result.drivers,
    timeline,
    checks: [] as { desc: string; pass: boolean }[],
  };
  log.checks = (sc.checks ?? []).map((c) => ({ desc: c.desc, pass: c.test(log) }));

  // Applies to every scenario: what the animation draws must follow the model's cleft levels.
  const shown = shownNTs(result);
  const drift = log.timeline.flatMap((c) =>
    shown.map((n) => {
      const name = NT_INFO[n].name;
      const count = (c.animation.free[name] ?? 0) + (c.animation.bound[name] ?? 0);
      const want = moleculeTarget(c.model.cleft[n]);
      return { t: c.t, name, count, want, off: Math.abs(count - want) > Math.max(4, want * 0.6) };
    }),
  );
  const worst = drift.filter((d) => d.off).slice(0, 3);
  log.checks.push({
    desc: `Molecules drawn in the cleft track the model${worst.length ? ` — off at ${worst.map((d) => `${d.t} h ${d.name} ${d.count} vs ~${d.want.toFixed(0)}`).join('; ')}` : ''}`,
    pass: worst.length === 0,
  });
  return log;
}

// ---------------------------------------------------------------------------------------------------------
// Report

const f2 = (v: number) => v.toFixed(2);
const pad = (v: string | number, n: number) => String(v).padStart(n);

function scenarioMarkdown(log: Log) {
  const out: string[] = [];
  out.push(`## ${log.title}`);
  out.push('');
  out.push(`\`${log.args.join(' + ')}\``);
  out.push('');
  out.push(`**Textbook expectation:** ${log.expect}`);
  out.push('');
  out.push('**Substances as modeled**');
  out.push('');
  out.push('| Substance | Mechanism in the app | Intensity | Starts | Peak at | Half-life | Notes |');
  out.push('|---|---|---|---|---|---|---|');
  for (const s of log.subs)
    out.push(
      `| ${s.name} | ${s.mechanism} | ${s.intensity} | +${s.offsetH} h | ${s.peakActivityAt} h | ${s.halfLifeH} h | ${[
        s.slowedClearance ? 'clearance slowed by another substance' : '',
        s.lowestPotency < 1 ? `potency reduced to ×${s.lowestPotency} at most` : '',
      ]
        .filter(Boolean)
        .join('; ') || '—'} |`,
    );
  out.push('');
  out.push(`**Rules fired:** ${log.rules.length ? log.rules.map((r) => `\`${r}\``).join('; ') : 'none'}`);
  out.push('');
  out.push(`**Summary shown to the student:** ${log.summary.join(' ')}`);
  out.push('');
  out.push(`**Synapse shows:** ${log.shownNeurotransmitters.join(' and ')} · labels: ${log.labels.join(', ')}`);
  out.push('');
  out.push('**Model over time** (signaling = net effect at receptors, cleft = amount in the gap, both vs baseline 1.00)');
  out.push('');
  const nts = NT_LIST;
  out.push(`| t | ${nts.map((n) => `${NT_INFO[n].short} sig`).join(' | ')} | ${nts.map((n) => `${NT_INFO[n].short} cleft`).join(' | ')} | arousal | mood | cognition | load | NAcc | PFC | Amyg | Stem |`);
  out.push(`|${'---|'.repeat(nts.length * 2 + 9)}`);
  for (const c of log.timeline)
    out.push(
      `| ${c.t.toFixed(1)} h | ${nts.map((n) => f2(c.model.signaling[n])).join(' | ')} | ${nts.map((n) => f2(c.model.cleft[n])).join(' | ')} | ${c.model.axes.arousal} | ${c.model.axes.mood} | ${c.model.axes.cognition} | ${c.model.axes.load} | ${Math.round(c.model.regions.accumbens * 100)} | ${Math.round(c.model.regions.pfc * 100)} | ${Math.round(c.model.regions.amygdala * 100)} | ${Math.round(c.model.regions.brainstem * 100)} |`,
    );
  out.push('');
  out.push('**What the animation shows**');
  out.push('');
  out.push('```');
  for (const c of log.timeline) {
    const a = c.animation;
    const mols = Object.entries(a.free)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const recs = a.receptors
      .map((r) => {
        const who = Object.entries(r.occupiedBy)
          .map(([k, v]) => `${k}×${v}`)
          .join(', ');
        return `${r.family}[${r.membrane === 'presynaptic' ? 'pre' : 'post'}] ${r.activated}/${r.total} on${r.blocked ? `, ${r.blocked} blocked` : ''}${r.modulatorBound ? `, ${r.modulatorBound} modulator` : ''}${who ? ` (${who})` : ''}`;
      })
      .join(' | ');
    const pumps = a.transporters.map((p) => `${p.name}: ${p.status}${p.pluggedBy ? ` (${p.pluggedBy} docked)` : ''}`).join(' | ');
    const enz = Object.entries(a.enzymes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
    out.push(`${pad(c.t.toFixed(1), 4)} h  in cleft: ${mols || '—'}`);
    out.push(`        receptors: ${recs || '—'}`);
    out.push(`        transporters: ${pumps || '—'}${enz ? `  enzymes: ${enz}` : ''}`);
    if (c.model.activeRules.length) out.push(`        rules active: ${c.model.activeRules.join('; ')}`);
  }
  out.push('```');
  out.push('');
  if (log.checks.length) {
    out.push('**Automatic checks**');
    out.push('');
    for (const c of log.checks) out.push(`- ${c.pass ? 'PASS' : '**FAIL**'} — ${c.desc}`);
    out.push('');
  }
  out.push('**Reviewer:** does anything above contradict the expectation or standard pharmacology? _(leave notes here)_');
  out.push('');
  return out.join('\n');
}

const logs = SCENARIOS.map(runScenario);
const failed = logs.flatMap((l) => l.checks.filter((c) => !c.pass).map((c) => `${l.title}: ${c.desc}`));

const md = [
  '# Simulation log for accuracy review',
  '',
  `${logs.length} scenarios, each run for the full 8-hour window and sampled every ${CHECKPOINT_HOURS * 60} minutes.`,
  'Both layers are recorded: the model (numbers behind the charts) and the synapse animation (what a student actually sees).',
  'The animation uses a fixed random seed, so re-running this produces the same log.',
  '',
  '## How to review this',
  '',
  '1. For each scenario, read the textbook expectation, then check the tables below it.',
  '2. Flag anything that contradicts standard pharmacology: wrong direction, wrong timing, a rule that should not apply, a missing interaction, or an animation that disagrees with the numbers.',
  '3. Rate each problem: wrong / misleading / nitpick. Ignore simplifications unless they would teach something false.',
  '',
  'Counts in the animation sections are averaged over one second of playback, so activated / blocked / occupied figures may not add up exactly.',
  '',
  'Definitions: **signaling** = net effect at receptors (includes drugs acting directly on the receptor); **cleft** = how much transmitter is in the gap; **blockade** = share of transporters blocked; effect axes run 0-100 with baselines arousal 50, mood 50, cognition 85, load 12; region values are a 0-100 model index.',
  '',
  `**Automatic checks:** ${logs.reduce((n, l) => n + l.checks.length, 0)} run, ${failed.length} failed.`,
  failed.length ? failed.map((f) => `- **FAIL** ${f}`).join('\n') : '',
  '',
  '---',
  '',
  ...logs.map(scenarioMarkdown),
].join('\n');

mkdirSync('verify/out', { recursive: true });
writeFileSync('verify/out/sim-log.md', md);
writeFileSync('verify/out/sim-log.json', JSON.stringify(logs, null, 2));
console.log(`Scenarios: ${logs.length} · checks: ${logs.reduce((n, l) => n + l.checks.length, 0)} · failed: ${failed.length}`);
for (const f of failed) console.log(`FAIL ${f}`);
console.log('Wrote verify/out/sim-log.md and verify/out/sim-log.json');
