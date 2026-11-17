# Convolution Resonator Progress

Branch: `codex/convolution-resonator`

## Native Timing Proof

Implemented in a separate C++ native module:

- 64 instance handles; storage allocated on demand from the shared memory pool.
- Two independent delay channels, with exactly 2048 samples of latency.
- Unclipped samples; non-finite input clears both channels.
- Reset, destroy, capacity exhaustion, and released-storage reuse.
- Registered exports in the native build script.

`node scripts/test_convolution_resonator.mjs` passes against the standalone WASM.
The test covers exact impulse timing, signal identity after delay, stereo
isolation, instance isolation, non-finite recovery, handle exhaustion and reuse.

## Graph Integration

- Native type 268, dedicated create/destroy/dispatch and pooled-memory marking.
- Stereo routing uses stereo_route.h, including lone-side inputs and mono outs.
- Space-category Module Browser entry, native catalog, efficient-product
  allowlist and pass-through bypass classification.
- Existing lineBurn display; no JavaScript DSP or drawing fallback added.
- No parameters exposed before their DSP stages are implemented.

All 199 native modules and combined WASM build successfully.
`node scripts/test_convolution_resonator_graph.mjs` verifies eight graph routing
cases, exact delay, channel identity and native dispatch. A headless browser
boot confirms module discovery and node creation with no page errors.

The separate browser Render Sample attempt stalled and was stopped; this is
not a passing audio acceptance test. Live listening and browser Render Sample
still need verification before this scaffold is accepted as complete.

This remains a delayed-dry timing foundation, not a resonator or vocoder.

## Next

1. Diagnose the browser Render Sample stall, with a bounded test and diagnostics.
2. Verify live and rendered delayed dry audio before building the Body.
3. Implement Buzz, String and Tube with matching IR probes.
4. Coordinate shared FFT extraction from Noise Convolution Reverb. Do not
   modify Sandy's worktree. The FFT remains private to her module at this point.
5. Fixed-size STFT, then Crunch transitions, anti-aliasing and pinned displays.

The 2048-sample latency is provisional until oversampled filter group delay is
known. All wet branches and dry must share the final reported latency.
