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

This is a timing foundation, not the finished scaffold: it does not yet appear
in the Module Browser, run inside the graph, generate a carrier, or process a
Body/STFT wet path. No controls are exposed pretending those stages exist.

## Next

1. Connect the native module to the graph and UI using stereo_route.h.
2. Verify live and rendered delayed dry audio before building the Body.
3. Implement Buzz, String and Tube with matching IR probes.
4. Coordinate shared FFT extraction from Noise Convolution Reverb. Do not
   modify Sandy's worktree. The FFT remains private to her module at this point.
5. Fixed-size STFT, then Crunch transitions, anti-aliasing and pinned displays.

The 2048-sample latency is provisional until oversampled filter group delay is
known. All wet branches and dry must share the final reported latency.
