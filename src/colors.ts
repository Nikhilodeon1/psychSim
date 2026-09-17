import type { NT } from './data/substances';

/** Neurotransmitter colors, shared by the synapse illustration and charts. */
export const NT_COLOR: Record<NT, string> = {
  '5HT': '#8A63D2',
  DA: '#E39A2D',
  NE: '#2E9E8F',
  GABA: '#3E78D6',
  ACh: '#5E9E45',
};

/** Substance slot colors A / B / C (paired with diamond / square / triangle shapes). */
export const SLOT_COLOR = ['#D1437B', '#34414C', '#B8322A'];

export const SLOT_LETTER = ['A', 'B', 'C'];
