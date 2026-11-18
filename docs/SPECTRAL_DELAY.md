# Spectral Delay

Native C++/WASM listening proof on `codex/convolution-resonator`.
Module Browser: Space. Type `spectralDelay`, native ID 275, version 2.

## First Listening Tests

- Voice or music -> Mono, or Left/Right -> Spectral Delay -> Output Left/Right.
- Cascading echoes: FFT 2048, Base 80 ms, Spread +600 ms, Pivot 1000 Hz,
  Curve 0, Feedback 45%, Mix 50%. Reverse Spread to hear lows arriving later.
- Tight coloration: FFT 512, Base 0 ms, Spread 8 ms, Feedback 30%, Mix 35%.
- Long spectral trails: FFT 4096 or 8192, Base 200 ms, Spread 1500 ms,
  Feedback 70%, Mix 70%. Start quietly; no hidden limiter or automatic gain.
- For a neutral check, Base 0, Spread 0, Feedback 0 reconstructs delayed input.
- Darker repeats: Feedback Tilt -12 dB. Brighter repeats: +12 dB. The first echo
  is unchanged; filtering is applied only on subsequent feedback passes.
- Ping-pong: Stereo Crossfeed 100%, Feedback 60%, Spread 0 and Base 200 ms.
  Use differing L/R inputs. With this app's mono-fold routing, a single connected
  input feeds both lanes; for a left-only test, also wire explicit silence to Right.

## Controls

- FFT Size: 512/1024/2048/4096/8192/16384 samples, default 4096. Quarter-window
  hop, Hann analysis/synthesis and four-way normalized overlap-add. Larger sizes
  distinguish closer frequencies but smear short events and increase latency.
- Base Delay: minimum added delay in ms, default 120. This is additional to the
  FFT Size buffering latency; dry only shares the FFT buffering, not band delay.
- Delay Spread: signed ms, default +180. Its magnitude is the extra delay range.
  Positive places highs later; negative places lows later. No negative delay or
  hidden look-ahead. DC and Nyquist are the exact endpoints of the distribution.
- Frequency Pivot: Hz, default 1000. At Curve 0, this frequency receives halfway
  between minimum and maximum delay. Must be positive and below Nyquist.
- Delay Curve: rational contour -1..1, default 0. Uses the existing shared segment
  curve math; positive shifts more bins toward the high endpoint of the mapped
  distribution, negative toward the low endpoint. It does not change amplitudes.
- Feedback: signed coefficient, default 35%. No hidden maximum below 100%, signal
  clipping or limiter. Absolute values below 100% decay; unity can sustain and
  user-extended values above unity can grow. A feedback read is always at least
  one hop old, even when the band's requested output delay is shorter.
- Feedback Tilt: endpoint contrast in dB, default 0. Positive attenuates low-band
  feedback and retains high-band feedback; negative does the reverse. The shape
  uses the existing Frequency Pivot independently of Delay Curve. At Pivot,
  attenuation is half the absolute Tilt in dB. The retained endpoint stays at the
  main Feedback coefficient; the other is attenuated by abs(Tilt). It is neither
  dB/octave nor a boost, normalization or change to the first echo/dry signal.
- Stereo Crossfeed: feedback-routing blend, default 0%. Zero keeps lanes separate;
  50% averages both feedback lanes; 100% swaps lanes each feedback pass. Read heads
  are always historical, so channel processing order cannot introduce an extra
  hop or same-frame feedback. Centered mono remains centered. The initial wet echo
  stays on its source channel; crossfeed applies only to following repeats.
- Mix: dry/wet, default 100%. Both channels remain independent; no downmix or
  stereo crossfeed is applied. Mono wiring follows the existing stereo router.
- Error output: invalid settings/capacity request or detected numerical failure.
  Invalid configuration retains the last valid settings. Numerical failure clears
  only local delay state; it does not stop the global audio engine.

## Fractional Timing And Modulation

Each spectral bin has a complex-valued frame delay. Fractional frame reads align
neighboring frames using their measured phase advance around the expected bin
advance, interpolate, then restore the requested fractional-delay phase. This
avoids the deep tone cancellations caused by raw complex-frame interpolation.

It is still STFT resynthesis, not an exact sample-domain fractional delay for
arbitrary transients. Fractional interpolation includes a phase estimate and is
not promised to be a fixed linear filter for every input. Integer-hop uniform
delays with feedback off reconstruct exactly within floating-point rounding.

The standard native parameter controls smooth edits. Delay maps are evaluated at
the analysis hop. Read heads move continuously rather than crossfading fixed taps:
time edits may bend pitch; fast modulation may create intentional sidebands and
texture. There is no hidden modulation cap or claim of alias-free arbitrary FM.

## FFT Changes, Memory And Capacity

Two preallocated cores allow size edits without immediately dumping the active
tail. The new core receives live audio until its window plus the longest current
requested delay have filled, then crossfades over 50 ms. Increasing delays during
warming extends that wait. Rapid size edits queue the latest size after handoff.

Old feedback history is not reprojected to the new FFT bins: after handoff its
remaining tail is replaced by the new resolution's history. Size edits change
timing and texture intentionally; this is not Spectral Freeze's held-spectrum
remapping. At long delays the edit can take seconds to become active.

Each core reserves 1,048,576 complex values per channel, using only valid written
frames after reset. Entire delay histories are not memset on audio callbacks.
Instance memory is approximately 33.25 MiB from the existing shared native pool;
there is no allocation or memory growth while processing or resizing FFTs.
Pool exhaustion fails creation explicitly; JavaScript does not substitute DSP.

FFT 16384 produced an approximately 3.7 ms maximum 128-sample callback in the
local JS harness, above the 2.67 ms quantum duration at 48 kHz. This is not a DAW
measurement, but it is a real peak-work warning: large FFTs can underrun at small
host buffers despite low average CPU. Start at 2048/4096; two-core transitions add
temporary work. A worst-case host realtime guarantee is not established.

Capacity depends slightly on FFT size and inversely on sample rate: approximately
10.7-10.9 seconds at 48 kHz and 2.67-2.72 seconds at 192 kHz. Base plus absolute
Spread must fit both active and requested sizes during a transition. Native
`max_delay_ms(handle)` reports the active capacity. Over-capacity requests raise
Error instead of silently clamping the delay. Supported sample rates: 8..192 kHz.

The native latency getter reports active FFT Size, not the additional spectral
delays. Host/plugin latency compensation is not verified. Shared GL 1D Trace face;
no private Canvas2D rendering or JavaScript DSP fallback.

## Verification

- `test_spectral_delay.mjs`: all FFT sizes at 44.1/48/96/192 kHz; neutral stereo
  reconstruction, exact integer-hop impulse delay, phase-aware fractional tone,
  feedback echo timing/amplitude and polarity, actual low/high burst arrival
  ordering, capacity errors, local recovery and no processing-time memory growth.
  Crossfeed tests verify alternating 100% routing and equal 50% routing; Tilt
  tests verify actual endpoint/pivot gains and an unchanged first echo.
- `test_spectral_delay_graph.mjs`: Mono/Left/Right/all routing combinations,
  live spread-direction edit, real Error output, pooled native lifecycle and
  sample-by-sample agreement with direct native processing.
- `test_spectral_delay_browser.mjs`: native plan/audio, real UI timing updates,
  actual worklet FFT changes, capacity telemetry and desktop/mobile GL views.

Base delay listening acceptance is complete. Listening acceptance remains for
Tilt/Crossfeed, extreme feedback and FFT transitions on long tails. Band-pattern
editing and tempo sync remain future work. No new lookahead or latency is added
by Tilt/Crossfeed.
