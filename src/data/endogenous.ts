import { NT_COLOR } from '../colors';

/**
 * The body's own messenger for each receptor family a drug can target.
 * Shown alongside the drug so its effect can be compared with natural signaling.
 */
export type Ligand = {
  name: string;
  color: string;
  /** peptide = bead chain, lipid = head + tail, small = single dot */
  shape: 'peptide' | 'lipid' | 'small';
  /** Where the messenger comes from. */
  source: 'presynaptic' | 'postsynaptic' | 'surroundings';
  /** Which membrane carries the receptor in this diagram. */
  receptorOn: 'presynaptic' | 'postsynaptic';
};

export const ENDOGENOUS: Record<string, Ligand> = {
  'μ-opioid': { name: 'Endorphins', color: '#B8A02E', shape: 'peptide', source: 'surroundings', receptorOn: 'postsynaptic' },
  // Endocannabinoids are retrograde messengers: made by the receiving neuron, acting on CB1 on the sending neuron.
  CB1: { name: 'Anandamide', color: '#5FB3D8', shape: 'lipid', source: 'postsynaptic', receptorOn: 'presynaptic' },
  // Adenosine builds up outside cells from the breakdown of ATP rather than being released from vesicles.
  A2A: { name: 'Adenosine', color: '#B7835A', shape: 'small', source: 'surroundings', receptorOn: 'postsynaptic' },
  NMDA: { name: 'Glutamate', color: '#E8736B', shape: 'small', source: 'presynaptic', receptorOn: 'postsynaptic' },
  nAChR: { name: 'Acetylcholine', color: NT_COLOR.ACh, shape: 'small', source: 'presynaptic', receptorOn: 'postsynaptic' },
  'GABA-A': { name: 'GABA', color: NT_COLOR.GABA, shape: 'small', source: 'presynaptic', receptorOn: 'postsynaptic' },
  D2: { name: 'Dopamine', color: NT_COLOR.DA, shape: 'small', source: 'presynaptic', receptorOn: 'postsynaptic' },
  '5-HT2A': { name: 'Serotonin', color: NT_COLOR['5HT'], shape: 'small', source: 'presynaptic', receptorOn: 'postsynaptic' },
  Adrenergic: { name: 'Norepinephrine', color: NT_COLOR.NE, shape: 'small', source: 'presynaptic', receptorOn: 'postsynaptic' },
};
