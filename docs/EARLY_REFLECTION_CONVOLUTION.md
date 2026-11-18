# Early Reflection Convolution

Native room-IR listening proof on `codex/convolution-resonator`.
Module Browser: Space. Stable type `earlyReflectionConvolution`, native type 274.
The existing `earlyReflections` module is separately named Early Reflection Delay.

## Try It

1. Music, voice, pulse oscillator or impulses -> Mono, or Left/Right inputs.
2. Left/Right outputs -> Output. Start with Mix 35%; 100% auditions reflections.
3. For a tiny box, try Width 0.3 m, Depth 0.4 m, Height 0.25 m, Order 3 or 4,
   Absorption 50-80%, Damping 1000-5000 Hz. Begin at a low monitoring level.
4. For a bathroom, try 2 x 3 x 2.4 m, Absorption 20-40%, Damping 8000 Hz.
5. For distinct slap reflections, increase dimensions and use Order 1.
6. Move Source/Listener positions to change reflection timing and coloration.
7. Try Diffusion 70-100%, Diffusion Time 8-20 ms to break up sharp, regularly
   spaced reflections. These are static clusters, not moving-delay modulation.

Small dimensions and low absorption can produce substantial coherent gain. There
is no hidden limiter, normalization, late reverb, feedback or automatic makeup.

## Model And Controls

- Width/Depth/Height: meters. Rectangular image-source model, sound speed 343 m/s.
- Source X/Y/Z and Listener X/Y/Z: percentages of the corresponding dimension.
  Source is the average of incoming Left and Right; dry channels remain separate.
  Opposite-polarity stereo therefore cancels in the wet excitation intentionally.
- Reflection Order: 1..4 wall bounces, producing 6/24/62/128 paths per receiver.
  This is a finite early-reflection response, not an infinite room-decay model.
- Absorption: energy loss per bounce. Path amplitude is sqrt(1-absorption)^order
  divided by distance in meters. The singularity floor is 1 mm.
- Damping: actual Hz. Each path is a finite exponential lowpass impulse with pole
  exp(-2*pi*damping/(sampleRate*order)), truncated at -100 dB amplitude. It is a
  simplified wall-loss model, not measured absorption or a cascaded wall material.
- Ear Distance: meters of receiver separation along room X. Receivers stay at
  least 1 mm inside side walls. Zero gives matching wet channels. No HRTF model.
- Diffusion: 0..100%, default 0. Blends each geometric reflection into a static
  nine-arrival cluster. Six +1/3 and three -1/3 weights preserve the original DC
  sum and have unit isolated-tap energy at full diffusion. This is a designed
  kernel, not automatic signal normalization; overlaps and wall damping still
  change frequency response and energy. Partial amounts blend the two responses.
- Diffusion Time: maximum additional cluster spread in ms, default 8. Each image
  path has deterministic jittered arrivals across eight time strata, plus its
  original onset. Zero time or zero Diffusion retains the geometric response.
  Receiver channels share the same per-path cluster, preserving mono at zero ear
  spacing. No moving delays, pitch wobble, random changes on reload or added
  convolution buffering latency. This imaginary rough-wall effect is not exact
  specular box geometry and is not guaranteed to remove every comb resonance.
- Mix: delayed dry stereo versus stereo reflections. Direct sound is deliberately
  excluded from the generated IR, so Mix does not secretly add another direct path.
- Ready output: 1 after the first valid kernel is active, including during edits.
- Error output: 1 for invalid configuration or a requested IR exceeding capacity.
  The last valid kernel remains active. Correcting the request clears the error.

Fractional arrivals use two-sample interpolation, not sample-quantized delays.
That deliberately simple interpolation has high-frequency magnitude loss; this
is not an ideal bandlimited fractional-delay model or a claim of perfect acoustics.

## Runtime

Stereo generated IR, mono excitation. Uniform partitioned overlap-save convolution
uses 256-sample partitions and 512-point FFTs. This is convolution, not STFT
resynthesis; it adds 256 samples of buffering latency without an analysis window
smearing the reflection times. Dry shares that latency (5.33 ms at 48 kHz).
Plugin-host latency compensation is not verified.

Kernel capacity is 65536 samples per receiver; sample rates 8..192 kHz. Dimensions
have no arbitrary DSP upper clamp, but impossible/over-capacity geometry is rejected
explicitly. Positive damping can be extended below its spawn range until the finite
IR exceeds capacity. Order is structurally bounded at four wall bounces.

Two kernels and a shared retained input-spectrum history are preallocated from
the native memory pool. Preparation clears 4096 IR positions, adds at most 1024
path-tail positions (up to nine cluster taps each), or transforms one stereo
partition per 256-sample block.
New kernels crossfade over 50 ms using the same retained history; they do not
start with empty input buffers. Rapid edits coalesce to the latest queued settings
after the current build/handoff, rather than restarting and starving every build.
The default kernel is ready in roughly 0.15 seconds at 48 kHz on the native test.

No callback allocation, JavaScript DSP fallback or private drawing implementation.
The module face uses the existing shared GL 1D Trace renderer for its live output.

## Verification

- `test_early_reflection_convolution.mjs`: 44.1/48/96/192 kHz. Output impulse equals
  the generated IR including its exact buffering latency. Arbitrary multi-impulse
  input matches direct convolution across partition boundaries. First-order wall
  arrivals and gains match independent geometry. Checks stereo spacing, full
  absorption, over-capacity error/recovery, crossfaded edits, nonfinite recovery
  and no processing-time memory growth.
  Diffusion tests verify original/half/full blends, static determinism, preserved
  DC sum, linked ears, increased arrival density, actual convolution against the
  diffused IR and explicit rejection of over-capacity cluster durations.
- `test_early_reflection_convolution_graph.mjs`: stereo native graph matches direct
  processing, including room edits and real Ready/Error signal outputs.
- `test_early_reflection_convolution_browser.mjs`: spawn/plan/native audio, UI room
  edit reaches the actual IR, parameter persists in the patch, desktop/mobile GL.

Listening acceptance remains required. This proof does not add IR export, per-wall
materials, editable individual reflections, room rotation, a late diffuse tail or
a general shared convolution framework.
