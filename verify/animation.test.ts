/** The synapse animation must be smooth: no molecules jumping across the screen and no receptors flickering. */
import { describe, expect, it } from 'vitest';
import { GLITCH_COMBOS, measure } from './glitch';
import { parseSelection } from './trace';

describe('synapse animation is free of visual glitches during playback', () => {
  it.each(GLITCH_COMBOS.map((c) => [c.join(' + '), c] as const))(
    '%s',
    (_name, combo) => {
      const r = measure(combo.map(parseSelection));
      expect(r.teleports, 'molecules jumping more than 25 px in one frame').toBe(0);
      expect(r.blinks, 'receptors switching on/off within 0.3 s').toBeLessThanOrEqual(4);
      expect(r.popIns, 'molecules appearing and vanishing within 0.4 s').toBeLessThanOrEqual(3);
      expect(r.dockChurn, 'drugs docking and leaving a transporter within 1 s').toBeLessThanOrEqual(2);
    },
    120_000,
  );
});

describe('narrated animation agrees with the model', () => {
  it(
    'no runtime flags across every single substance and the mechanism combinations',
    async () => {
      const { NARRATE_COMBOS, narrate } = await import('./narrate');
      const flagged = NARRATE_COMBOS.flatMap((c) => narrate(c.map(parseSelection)).flags.map((f) => `${c.join(' + ')}: ${f}`));
      expect(flagged).toEqual([]);
    },
    300_000,
  );
});
