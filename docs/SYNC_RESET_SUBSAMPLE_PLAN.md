# Plan: Sub-sample driver / follower sync reset

**Audience:** Codex, implementing in soemdsp-sandbox.  
**Status:** design plan. Implement nothing until this is handed off.  
**Related:** [APP_POLICY.md](./APP_POLICY.md), [GATES_TRIGGERS.md](./GATES_TRIGGERS.md).

## Naming

Always say **driver** for the oscillator feeding the Reset input, and **follower** or **synced** (interchangeable) for the oscillator being reset, the one whose sound you hear. Do not use "master" or "slave" in code, comments, or docs added by this work.

## Background

Argi drove a PolyBLEP follower's Reset with a non-antialiased square from a PolyBLEP driver. Surge's oscillator sync sounds cleaner.

A naive (non-antialiased) driver edge snaps to a whole sample. The driver's phase counter still keeps the true period (for example 10.3 samples) and stays in time, but the output throws away the fraction. The Reset input therefore fires up to a sample early or late each cycle, and the error changes from cycle to cycle. That changing error is **timing jitter**: inharmonic grit and whine, especially at high pitches, or whenever the driver's period is not a whole number of samples.

Surge syncs at the exact sub-sample wrap time and band-limits the follower's jump. See `native_modules/surge_oscillator/surge_oscillator.cpp` (zero-crossing interpolation, then a BLEP on the follower discontinuity). That module is a useful reference for sub-sample timing and for BLEP-ing the follower. This plan does **not** copy its design wholesale: Surge uses a hidden or separate sync-event path and a zero-crossing detector, which is not how sandbox Reset should work.

## Design goals

Keep Argi's analog-like Reset.

- Reset inputs respond to the **change** in the input, sample to sample, not only to a clean digital edge.
- The intended behavior is that the **reset amount is proportional to each sample's change**. That is what makes Reset amplitude-dependent: a quieter or slower driver still moves the follower, just less, or later, the way analog sync does.
- **No side channel.** Modules must not send a separate hidden reset or timing signal. A module's output should honestly be the audio (or CV) signal. Timing is recovered from that signal itself.
- Any signal must still be able to drive Reset: sine, DSF, envelope, pulse, and so on.

## Current code (starting points)

Read-only pointers. Confirm before editing; do not assume line numbers stay put.

| Role | Where |
|------|--------|
| PolyBLEP oscillator (naive vs antialiased waveforms) | `native_modules/polyblep/polyblep.cpp` (`soemdsp_polyblep_set_antialias`: 0 = Off / naive, 1 = PolyBLEP). Shared BLEP/BLAMP: `library/include/soemdsp/math/poly_blep.h`. |
| PolyBLEP hosted in the graph, including Reset | `native_modules/graph_engine/graph_engine.cpp`, `process_polyblep`. Live Reset uses `gate_hit` / `gate_hit_height` / `partial_reset_phase`. Antialiasing is the `lfoStyle` slot. When abs(h) >= 1 it also calls `soemdsp_polyblep_reset` (native state clear, not a timing side channel). |
| Shared Reset law | `library/include/soemdsp/trigger/trigger.h`: `gate_hit` (hits when `\|x[n]\| > \|x[n-1]\|`, or on an upward zero crossing so a bipolar square still fires once per cycle), `gate_hit_height`, `partial_reset_phase` (move phase `\|h\|` of the way to the target; `h < 0` the long way). |
| Oscillator Reset port docs | `public/node-graph-module-definitions.js` (`polyBlep` and other `resetTrigger: true` oscillators: Reset + `ƒ` inputs; height `h` in −1…1 moves phase `\|h\|` of the way to the reset point). |
| DSF (band-limited driver, good test source) | `native_modules/dsf_oscillator/dsf_oscillator.cpp`, `public/node-graph-dsf-oscillator.js`. DSF Reset also uses `partial_reset_phase`. |
| Surge sync (reference only) | `native_modules/surge_oscillator/surge_oscillator.cpp`. |
| Generic Gate / Trigger / Reset spec | `docs/GATES_TRIGGERS.md`. |

**Doc tension to preserve, not "fix" away:** `GATES_TRIGGERS.md` describes generic Reset as a one-shot hit that ignores height. Oscillator Reset is deliberately different: it is change-based and amplitude-dependent via `gate_hit_height` + `partial_reset_phase`. That analog character is a design goal. Do not flatten oscillator Reset to "height ignored" without asking Argi. If the implementation of oscillator Reset changes, update the oscillator comments and, if needed, a short note in `GATES_TRIGGERS.md` so the two docs agree.

**Composition check:** `partial_reset_phase` moves a *fraction of the remaining distance* to the target. Two successive partials of 0.7 and 0.3 therefore do **not** compose to a full reset (the second 0.3 is 0.3 of what is left). If the intended rule is "a step split 70/30 across two samples adds up to one reset," the current composition may be wrong. Verify and fix in the shared helper if needed, so every oscillator that already calls it stays consistent.

## Plan

1. **Drive Reset with antialiased signals.** Recommended drivers are PolyBLEP with antialiasing on, or DSF (band-limited by design). A BLEP spreads one step across about two samples in proportions that encode the sub-sample edge position. That split *is* the timing information. Example: an edge 30% into a sample shows roughly 70% of the change in that sample and 30% in the next.

2. **The follower's Reset must apply its effect in strict proportion to each sample's change.** A step split 70/30 across two samples should produce a 70/30 partial reset that adds up to one sub-sample-accurate reset. Treat a BLEP as **one step**, not a dirty double reset. Nothing nonlinear in the response to change (no "full reset on any change," no squared change, and no remaining-distance composition that fails to sum to one), or the two halves will not add up and the sync will sound dirty.

3. **Apply a BLEP to the follower's own discontinuity** at the matching fractional position. Use the follower's phase value at that fraction, not the value at the start of the sample. Each reset needs that real mid-sample phase.

4. **Optional deadband or hysteresis on tiny changes.** A good BLEP has small overshoot / ringing next to the edge. A strictly proportional Reset will turn those wiggles into tiny back-and-forth nudges. That is mostly fine, and arguably analog-like. If it sounds fizzy, ignore very small changes. Prefer a little hysteresis over a hard nonlinearity that would break the 70/30 sum.

5. **If any Reset path uses a threshold instead of proportional change,** find the crossing fraction with linear interpolation:

   `frac = (threshold - prev) / (curr - prev)`

   Reset at that fraction, and treat neighboring samples of one edge as a **single event** (add the changes, fire once). This avoids missed or doubled resets when a BLEP split leaves neither half, or both halves, above the threshold.

6. **Multiple resets per driver cycle are allowed.** A pulse wave has a rising and a falling edge; complex waves can cross or change several times per cycle. If Reset fires only on rising / positive-going change, a pulse triggers once per cycle at the rising edge (pulse width moves only the falling edge, so sync timing does not change). If it fires in both directions, or the driver crosses several times, each change or crossing is its own reset, with its own fraction and its own follower BLEP, processed in time order. Nothing assumes one reset per driver cycle. Two crossings inside one sample (very high frequencies): process in time order, or let the later one win; a BLEP that small barely matters.

7. **Naive drivers cannot be fully fixed.** Once a non-antialiased edge has snapped to a whole sample, the fraction is already gone and the follower can only guess. Document that antialiased drivers (PolyBLEP antialiasing on, or DSF) are the recommended way to drive Reset. Do not add a hidden reset or timing outlet to "save" the naive case.

Prefer shared code in `library/include/soemdsp` (especially `trigger/trigger.h` and `math/poly_blep.h`) over per-module copies. Library edits need Architect (Argi) approval first (APP_POLICY §19).

## Wider benefit

The same sub-sample crossing / change detection can help anything that triggers off audio-rate signals and currently snaps to a whole sample:

- Sample & Hold — `native_modules/sample_hold/sample_hold.cpp` (external Clock uses `rising_edge` against a threshold).
- Clock / trigger dividers — `native_modules/trigger_divider/trigger_divider.cpp`, and `process_clock_divider` in `graph_engine.cpp`.
- Envelope retriggers — e.g. `native_modules/wavetable_adsr/wavetable_adsr.cpp`, `native_modules/pluck_envelope_fb/pluck_envelope_fb.cpp`, `native_modules/resonant_envelope/resonant_envelope.cpp`.

This plan's first target is oscillator Reset (PolyBLEP follower, then the other oscillators that already share `gate_hit` / `partial_reset_phase`). The wider cases can reuse the same helper once it exists. Do not boil the ocean in the first change.

## Testing

Command-center sample rate in this discussion was **44.1 kHz**. Use that rate, or scale the test frequencies to the actual engine rate (`period_samples = sampleRate / driverHz`).

- A driver at **4410 Hz** is exactly 10 samples per period. No timing jitter is expected, even when the driver is naive.
- A driver at **4411 Hz** is not a whole number of samples per period. Jitter is expected when the driver is naive.
- Put the follower **2–3×** higher than the driver so the sync character is obvious. The driver's pitch, not the follower's, is what has to be the non-integer period for jitter to show up.

Comparisons:

- Naive PolyBLEP square (antialiasing off) vs antialiased PolyBLEP square vs DSF, same patch.
- Sweep DSF harmonics from few to many: if Reset follows each sample's change, sync should get brighter and edgier but stay clean. Grit as the edges sharpen means the Reset is not responding in proportion.
- Sweep the driver's amplitude: analog Reset character should change; timing jitter should not (jitter cares about whether the period is a whole number of samples, not about level).

**Clearest test:** a spectrum of the follower output. Clean sync shows only harmonics of the **driver's** pitch (evenly spaced peaks at 4411, 8822, … at 44.1 kHz). Jitter puts energy *between* those harmonics, often folding into the low end. If the space between harmonics is clean, there is no jitter, whatever it sounds like.

Ideally add an automated render test that measures energy between harmonics of the driver's pitch for naive vs antialiased vs DSF drivers at 4410 Hz and 4411 Hz (or the equivalent pair at the test sample rate).

## Open question

Argi could not tell by ear whether the remaining roughness is the analog Reset character or timing jitter. The spectrum test (and the automated between-harmonic energy check) settles it. Do not spend time chasing a "cleaner" Reset that throws away amplitude dependence until that test has spoken.

## Rules

Follow [APP_POLICY.md](./APP_POLICY.md): no timer polling, audio only during play, prefer shared code. JS is the interface; C++ runs the circuit. Do not add a JS DSP twin of this Reset path.

Work in a git worktree on its own branch. Merge only with Argi's approval. Do not pull, rebase, or push other people's unpushed work.
