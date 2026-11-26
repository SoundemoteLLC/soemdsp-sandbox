# Divider Sequencer

Four native clock dividers, integer offsets, and gate logic. This is a separate
module from Euclidean Sequencer, not an identified reconstruction of the old
MOTM module or Nord Modular demonstration.

## Timing

- Rate is master-clock frequency in Hz. Zero pauses the internal clock.
- The f inlet replaces Rate. The Clock inlet (canonical key Adv) overrides both.
- Each external Clock trigger advances one master tick. Its high/low states
  supply the two half-cycle positions; no period estimation or free-running
  interpolation is applied to an external clock.
- Restart clears all divider positions and gate detectors. Internal timing
  starts at tick zero; externally clocked timing waits for a Clock trigger.
- Reset after restarts all lanes after N master ticks. Zero disables automatic
  restart. The master clock retains its fractional phase, so it does not drift.
- Live parameter changes preserve clock state. They can create legitimate gate
  transitions and therefore triggers; edits do not silently reset the sequence.

## Lanes And Logic

Each Divide value N is a positive integer: one full lane cycle spans N master
ticks. Offset is measured in master ticks, wraps modulo N, and positive values
delay the pattern. Internal gates are high for half of their lane cycle.
With external Clock, gate timing also reflects the incoming clock's pulse width.

A/B/C/D each emit a one-sample pulse when their own gate rises. Combined applies
logic to those four gates, then detects the resulting rising edge:

- OR: any gate high.
- XOR: an odd number of gates high, not exactly one.
- AND: all four gates high.

Combined is not a sum or OR of trigger pulses. Coincident transitions are
evaluated together once per engine sample. Defaults: 8 Hz, divisions 2/3/5/7,
zero offsets, XOR. Musical ranges belong to parameter metadata; native code only
guards the positive-integer divisor and non-finite inputs.

## Implementation

- Native header: `native_modules/graph_engine/divider_sequencer.h`.
- Graph type 285; moved during integration to preserve master's Spectral Smear ID 282.
- Slots: Frequency=Rate, Lane Vol 1..4=Divide, Lane Bias 1..4=Offset,
  Mode=stable OR(0)/XOR(1)/AND(2), Oversample=Reset after (master ticks).
- Mono/Left/Right/Saw=A/B/C/D, Ramp=Combined.
- Hidden scope taps carry gates, tick and phase. A read-only native getter
  provides effective Divide/Offset, including modulation, to the face.
- Standard controls, tooltips and module registration live under
  `public/modules/dividerSequencer/`. Spawn width is 7 GU.
- The face uses the shared WebGL2 line renderer for all tracks, dots, gate
  indicators and text. No Canvas2D, SVG graphics, private GL context, JS DSP,
  or workspace-zoom-dependent backing resize.
- The larger lane labels fit their available width. The combined-gate indicator
  shows the native active logic name (OR/XOR/AND), not a cramped Combined label.

## Verification

Temporary native WASM proof passes: divisions 1..128, negative/wrapped offsets,
all 16 input combinations for each logic mode, one-sample pulses, Restart,
external clock ownership, and 8 Hz / 2 = four triggers per second.

Browser acceptance passes: native telemetry, sample-accurate rendered pulses,
OR/XOR/AND with identical gates, f overriding Rate, a held external Clock stopping
internal advances, visible parameter edits reaching native state, saved parameter
values and named logic keys, and constant backing dimensions at 0.5x/1x/2x zoom.
All graphics use the shared GL renderer. Desktop and narrow-viewport captures
were inspected. The canonical smoke reference is sample-exact (88200 channel
samples, zero difference). No new permanent per-module smoke gate is introduced.

## Deliberate Non-Goals

No feedback, probability, automatic divisor changes, pitch generation, Swing,
per-lane duty controls, or claim of matching the historical recording yet.
