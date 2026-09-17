# Verification

Three layers, from strictest to broadest.

| Command | What it does |
|---|---|
| `npm test` | Unit tests. Fails if the app data disagrees with the fact base, an interaction rule fires (or doesn't) against expectations, rule math is off, values leave their ranges, or generated text uses forbidden language. |
| `npm run audit` | Runs every pair (× 3 intensities × 4 start times) and every triple — 3,850 simulations. Writes `verify/out/audit-report.md` and `audit.json` with errors, grouped warnings, solo profiles and a full trace for every pair that fires a rule. |
| `npm run log` | Runs 34 curated scenarios (single drugs and combinations) and records both layers every 30 simulated minutes: the model's numbers and what the synapse animation actually shows. Each scenario carries a textbook expectation and automatic checks. Writes `verify/out/sim-log.md` and `sim-log.json`. This is the file to hand to a reviewer. |
| `npm run trace -- cocaine ssri:high:+2` | One simulation, printed as a table every 30 min: cleft/signaling levels, transporter blockade, effect axes, brain regions, rules and summary. Add `--json` for raw output. |

## Files

- `reference.ts` — the fact base: class, agonist/antagonist, transporter targets, binding sites, metabolic interactions, time-to-peak and half-life ranges, expected effect directions. Written independently of `src/data/substances.ts` with sources listed at the top. **Change it only when the pharmacology is wrong, never to make a test pass.**
- `data.test.ts` — app data vs. fact base, per substance.
- `engine.test.ts` — rules for all 210 pairs, textbook scenarios, timing, rule math, invariants, text checks.
- `log.ts` — the review scenarios, their textbook expectations and per-scenario checks. The animation runs on a fixed random seed, so the log reproduces exactly.

## Having another model audit the results

Run `npm run log` and `npm run audit`, then give a reviewer `verify/reference.ts`, `verify/out/sim-log.md` and `verify/out/audit-report.md` with this prompt:

> You are reviewing an educational neuropharmacology simulator for AP Psychology. Using standard textbook pharmacology, check (1) every entry in reference.ts for factual errors, (2) each scenario in sim-log.md — do the model numbers and the synapse animation match the stated expectation, and does the animation agree with the numbers, and (3) the solo profiles and pair traces in the audit report for results that contradict known mechanisms — wrong direction of change, a rule firing for a combination that shares no mechanism, a missing interaction that textbooks describe, or implausible timing. For each problem, name the substance(s), quote the line, explain the correct pharmacology, and rate severity (wrong / misleading / nitpick). Do not comment on the model's simplifications unless they would teach something false.
