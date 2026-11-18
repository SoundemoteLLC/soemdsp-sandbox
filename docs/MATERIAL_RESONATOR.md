# Material Resonator

Native type `materialResonator`, ID 276, Space category.
Priority queue: Material Resonator -> Dispersion -> Spectral Cross-Synthesis.

## Purpose And Boundaries

A live-audio material/body effect: incoming sound excites a procedural bank of
damped modes. Wood, Metal and Glass are designed characters, not measured material
recordings or claims of an exact physical object. No IR files or samples.

Existing Mode Ping is a triggered single-mode instrument. Existing Convolution
Resonator has Buzz/String/Tube and STFT body/carrier paths. This module instead
provides a many-mode material spectrum, independent mode damping, continuous
inharmonicity and virtual strike/pickup positions on live audio.

Recursive modal synthesis is used rather than generating a long FIR: long tails
do not require long convolution kernels, and retuning needs no kernel rebuild or
FFT buffering. Consequently it is not marked with the FFT/STFT wave badge.
General modal-bank background: [STK ModalBar reference](https://chuck.stanford.edu/doc/reference/ugens-stk.html).
This implementation does not copy STK's code, preset tables or sampled exciter.

## Try It

1. Music/voice/oscillator -> Mono, or Left/Right -> Material Resonator -> Output.
2. Start with Metal, Fundamental 220 Hz, Base RT60 1 s, Damping 4000 Hz,
   Inharmonicity 100%, Modes 32 and Mix 100%.
3. Compare Wood/Metal/Glass on impulses or short noise bursts.
4. For single-sample excitation, raise the explicit Input Gain to 24-36 dB.
   The modes are approximately peak-gain normalized, not impulse-normalized;
   a very narrow, long-decay mode can therefore be quiet on a single sample.
5. Wire a Hz signal to f to retune the body. A wired zero silences the wet modes.
6. Try Inharmonicity 0% for a harmonic body; raise it toward the material ratios.

No limiter, clipping, automatic makeup or mode-count loudness leveling. Monitor
at a sensible level when increasing Input Gain or exciting many resonances.

## Controls And Model

- Material: Wood uses a beam-like squared-root sequence, Metal a sorted 8x8
  rectangular-plate-like spectrum with aspect 1.37, Glass a stylized increasing
  shell/bell-like polynomial sequence. These intentionally remain procedural.
- Fundamental: actual Hz of the first mode. f input replaces the knob; negative
  frequency has the same resonant magnitude as positive. Modes fade smoothly
  from 90% of Nyquist to Nyquist rather than folding back.
- Base RT60: seconds to -60 dB at low frequencies. Per-mode time is reduced by
  `1 + materialLoss * (modeFrequency / dampingHz)^2`, with materialLoss
  Wood 2.5, Metal 1 and Glass 0.35. Zero has no resonant wet output.
- Damping: Hz scale for faster decay of higher modes, not an input lowpass.
- Inharmonicity: harmonic ratios to the selected procedural material ratios.
- Excitation Position: virtual strike weighting; modal nodes can suppress modes.
  Endpoints are fixed-boundary nodes and can be silent.
- Pickup Spread: two pickup positions around 0.37 of the modeled dimension.
  Produces different mode balances from mono excitation; at zero, equal inputs
  produce equal outputs. Left/Right excitation states remain independent.
- Modes: 1..64, a structural resource bound, default 32.
- Input Gain: actual dB applied only to excitation, default 0. Mix dry is unchanged.
- Mix: immediate dry/wet blend; native buffering latency is zero.
- Error: invalid parameter request or nonfinite-state recovery. Only this module
  resets on numerical failure; it does not stop the global engine.

Each complex resonator has radius set by its decay and a unit-normalized rotation.
The existing narrow-range exponential helper is used near unity for accurate
RT60 at high sample rates. Input coupling `2*(1-radius)` gives approximately
unity peak response per mode before material weights. That is the filter's gain
definition, not an output limiter or an audio-dependent normalization operation.
Modal weights include a fixed 0.5/sqrt(ratio) rolloff and strike/pickup products.

## Updates And Runtime

Frequency and other native continuous controls follow the normal parameter
smoothing path; a wired f signal is consumed per sample. Coefficients are cached
when unchanged and recomputed during modulation. Material, count, position,
inharmonicity and pickup edits ramp modal ratios/gains over 10 ms without clearing
the whole body. Retuning bends existing modal state rather than retriggering it.
Removing modes fades their output weights; numerical resets and sample-rate
changes clear local state deliberately.

State is bounded to 64 modes, allocated once from the existing shared native pool.
No processing-time allocation, JavaScript fallback, FFT latency, lookahead or new
renderer. Face uses the existing shared GL 1D Trace.

## Verification

- `test_material_resonator.mjs`: 44.1/48/96/192 kHz; distinct material ratios,
  harmonic endpoint, measured RT60, immediate dry path, stereo isolation/pickups,
  explicit dB gain, zero/above-Nyquist frequency, audio-rate retuning and recovery.
- `test_material_resonator_graph.mjs`: all routing cases and real wired f override,
  including zero overriding a nonzero knob, against direct native processing.
- `test_material_resonator_browser.mjs`: native plan/audio, actual mode-frequency
  and material updates from UI, shared GL desktop/mobile and no page errors.

Listening acceptance is required; impulse level and material character are the
first listening questions. Exact measured materials, custom modal-table editing,
nonlinear coupling and object-to-object interaction are not part of this proof.
