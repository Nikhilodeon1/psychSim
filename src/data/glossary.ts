/** Short plain-language definitions for terms shown in the figures. Keep each under ~20 words. */
export const GLOSSARY: Record<string, { full?: string; def: string }> = {
  // transporters and enzymes
  DAT: { full: 'Dopamine transporter', def: 'Pump that pulls dopamine back into the sending neuron (reuptake).' },
  SERT: { full: 'Serotonin transporter', def: 'Pump that pulls serotonin back into the sending neuron (reuptake).' },
  NET: { full: 'Norepinephrine transporter', def: 'Pump that pulls norepinephrine back into the sending neuron (reuptake).' },
  GAT: { full: 'GABA transporter', def: 'Pump that clears GABA from the synapse.' },
  AChE: { full: 'Acetylcholinesterase', def: 'Enzyme in the synaptic cleft that breaks down acetylcholine.' },
  MAO: { full: 'Monoamine oxidase', def: 'Enzyme inside the neuron that breaks down serotonin, dopamine and norepinephrine.' },

  // receptor families
  D2: { full: 'Dopamine D2 receptor', def: 'Dopamine receptor involved in reward and movement. Blocked by antipsychotics.' },
  '5-HT2A': { full: 'Serotonin 2A receptor', def: 'Serotonin receptor in the cortex. Main target of LSD, psilocybin and mescaline.' },
  Adrenergic: { full: 'Adrenergic receptors', def: 'Receptors for norepinephrine and epinephrine. Involved in arousal and alertness.' },
  'GABA-A': { full: 'GABA-A receptor', def: 'Main inhibitory receptor. Lets chloride in, making the neuron less likely to fire.' },
  nAChR: { full: 'Nicotinic acetylcholine receptor', def: 'Ion-channel receptor opened by acetylcholine. Nicotine also activates it.' },
  'μ-opioid': { full: 'Mu-opioid receptor', def: 'Receptor for endorphins. Main target of morphine, heroin and oxycodone.' },
  NMDA: { full: 'NMDA glutamate receptor', def: 'Excitatory glutamate receptor. Blocked by PCP and ketamine; inhibited by alcohol.' },
  CB1: { full: 'Cannabinoid receptor 1', def: "Receptor for the brain's own endocannabinoids. Activated by THC." },
  A2A: { full: 'Adenosine A2A receptor', def: 'Adenosine receptor that dampens neural activity. Blocked by caffeine.' },

  // general
  Agonist: { def: 'A substance that mimics or strengthens a neurotransmitter’s effect.' },
  Antagonist: { def: 'A substance that blocks a neurotransmitter’s effect, often by occupying its receptor.' },
  Mixed: { def: 'Acts as an agonist at some receptors and an antagonist at others.' },
  Reuptake: { def: 'The sending neuron pumping released neurotransmitter back in, ending its signal.' },
  VTA: { full: 'Ventral tegmental area', def: 'Midbrain dopamine neurons where the reward pathway begins.' },

  // natural messengers
  Endorphins: { def: "The body's own opioids. Released during pain or stress; activate mu-opioid receptors." },
  Anandamide: { def: 'An endocannabinoid. Made by the receiving neuron and sent backward to CB1 receptors, reducing release.' },
  Adenosine: { def: 'Builds up outside neurons as energy (ATP) is used; activates A2A receptors and dampens activity.' },
  Glutamate: { def: 'The main excitatory neurotransmitter; activates NMDA receptors.' },
  Acetylcholine: { def: 'Neurotransmitter for muscle movement, attention and memory; activates nicotinic receptors.' },
  GABA: { def: 'The main inhibitory neurotransmitter; activates GABA-A receptors.' },
  Serotonin: { def: 'Neurotransmitter involved in mood, sleep and perception; activates 5-HT receptors such as 5-HT2A.' },
  Dopamine: { def: 'Neurotransmitter involved in reward, motivation and movement; activates D2 and other dopamine receptors.' },
  Norepinephrine: { def: 'Neurotransmitter involved in alertness and arousal; activates adrenergic receptors.' },

  // interaction rules
  'Reuptake stacking': { def: 'Two substances block clearance of the same neurotransmitter, so it builds up more than either alone.' },
  'Receptor competition': { def: 'Two substances target the same binding site, so each binds less than it would alone.' },
  'Metabolic interaction': { def: 'One substance slows the body’s clearance of another, so the second lasts longer.' },
};
