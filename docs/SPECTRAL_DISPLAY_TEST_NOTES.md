# Spectral display test notes (handoff)

Listening/visual acceptance by Argi of the spectral display pass (commit 23716368, brief docs/SPECTRAL_DISPLAY_VISION.md).
Fix everything below in one pass after testing is complete.

## Checklist

1. 1D Spectrum - tested
2. Spectrogram - tested
3. Circular Spectrogram - tested
4. Spectrum Circle - tested
5. Vocoder - tested (needs rework)
6. STFT Gate - tested
7. STFT Contrast - tested
8. Spectral Blur (particle face + Cloud mode sound) - tested
9. Spectral Freeze - tested
10. Spectral Delay - tested (face needs redesign)
11. Spectral Warp - tested
12. Spectral Cross Synthesis - tested

## 1. 1D Spectrum

Passed: levels, frequency placement, Exact dB / Linear, over-Ceiling cap, Floor/Ceiling knobs, bass separation, peak caps, layout.

Bugs:

- Ghost peak with Bass detail on: a SinCos sine input produces a spurious peak around 280 Hz at roughly -70 dB. It rises with SinCos amplitude, disappears at amplitude 0, and only appears with Bass detail on. Likely leakage or a splice artifact at the long-FFT / normal-FFT handoff near 200 Hz. Fix with a proper crossfade across the handoff region and check the long window's sidelobes. Add a test: a pure 1 kHz sine shows nothing above the floor near 200-300 Hz with Bass detail on.
- Unplug discrepancy: when the input is unplugged, the spectrum trace freezes on its last frame but peak hold keeps decaying. They must agree. On disconnect, deliver one silent/empty analysis so the trace falls to the floor along with the peaks, then both stop. Event-driven only, no timers.
## 2. Spectrogram - tested

Bugs:

- Freezes when unplugged: when the input is unplugged, the scroll freezes on its last state even with "Pause on silence" unchecked. With Pause on silence off, an unplugged input must be treated as silence and keep scrolling (silent columns at the floor). Same root cause as the 1D Spectrum unplug bug: on disconnect the analysis stops receiving frames. Fix once in the shared path so a disconnected input delivers silent frames to every spectrum display (event-driven, no timers), and Pause on silence decides whether the display then stops.
Keep: lowering Ceiling on the circular display produces a beautiful soft blue glow ring (Argi loves it). Preserve this look; consider saving it as a display preset.
## 3. Circular Spectrogram - tested

Unplugging the input keeps it animating (correct, unlike 1D Spectrum and Spectrogram, so its path can be a reference for the shared unplug fix).
Bug:

- Seam pixel at the wrap: at certain zooms/aspect ratios a 1-pixel black line appears where the circle starts/ends (top center), running from the outer radius to the center (one vertical pixel column when mirrored). Likely the angle wrap seam in the shader (atan2 discontinuity at +/-pi, or a texture-coordinate edge sampling outside [0,1] / no wrap at the boundary). Fix: sample with wrap or clamp at the seam (e.g. fract/clamp of the angle coordinate, half-texel inset), so there is no gap at any zoom or ratio.
## 4. Spectrum Circle

Changes:

- Brightness should spawn with default 1.0.
- Rotate offset: at Rotate 0.0 the circle looks off-centre / rotated; about -0.11 looks correct. Find the angular offset (likely a bin/half-band or start-angle offset) so 0.0 is visually centred, and keep the parameter definition's range.
- Min/Max frequency: turn the max frequency control into a single min/max range slider.
- dB Floor and dB Ceiling become module parameters (on the face), not Display Settings.
- Bright, Decay and Smooth: put them as 3 sliders on the same row (they become vertical sliders).
## 5. Vocoder

Main problem: the face is a generic bar-based spectral display, not a picture of the vocoder.

- Bar count must come from the Vocoder's own Bands parameter (one bar per real band at its real centre), not from a separate Display Settings bar count. Remove the display bar-count setting for the Vocoder face.
- Width (band width / Q) must be visible: bars get wider or narrower as Width changes, drawn at each band's true bandwidth on the frequency axis.
- In general the face should show the vocoder's settings and state (bands, widths, envelopes), driven by the native band tap, not a re-binned spectrum.
## 6. STFT Gate

Working, with changes:

- New noise profile option: add "Use Profile Inv" (inverted profile) as a 4th noise profile setting.
- Missing FFT option: the module has no FFT size choice; add one (limits from the parameter definition).
- dB Floor / dB Ceiling: make them a min/max range parameter on the module, not Display Settings.
- Wrong settings set: it uses the generic "Spectral" Display Settings, which include a Particles setting that does nothing here. Each module should only show settings its styles use; remove irrelevant ones (no dead settings).
- Band gain bars not pixel perfect: bar widths/gaps are uneven, which makes it hard to read. Snap bars to whole pixels with even gaps at every zoom.
- Band gain is unreadable: there's a centre line (colour from gradient, keep) with bars animating above and below it, and it isn't clear what above vs below, bright vs dark, or dim means. Redesign so the meaning is obvious: e.g. one clear encoding (bar height = gain reduction in dB from the top line, or input level vs gate threshold), a single consistent use of brightness, and a short real description in the docked tips panel. Document the encoding.
## 7. STFT Contrast

Looks good. Changes:

- Default style should be Overlay; probably make Overlay the only style for this module.

## Cross-cutting: specialize, don't share one generic "Spectral" settings set

All processor faces use the same generic "Spectral" Display Settings, which makes every one clunky and shows dead options (e.g. Particles on Gate). Direction from Argi:

- Give each module its own face design and its own Display Settings, containing only what that face uses.
- Only STFT Contrast is limited to a single style (Overlay); other modules may keep several styles where it makes sense. Wherever a module has only one style, put the effort into options tailored to making that style look great.
- Shared rendering/analysis code can stay shared underneath; the user-facing settings and look are per module.- Later, Argi will go through each module and likely lock down one style per module; keep the style plumbing easy to restrict per module.
## 8. Spectral Blur

- Styles: only Overlay, Particles and Waterfall should be available for Spectral Blur (remove the others from its menu).

- Inactive parameters must look inactive: Swarm, Level, Rate and Drift only affect the Warble character, so in Cloud mode they appear to do nothing. Use the app's existing "under construction" / not-applicable look on any parameter that doesn't apply to the current Character (and likewise for Cloud-only params in Warble), driven by events when Character changes.- Frequency Blur sounds metallic: it appears to make wider bands as frequency increases, and the result sounds metallic. Argi's guess: the blur isn't pitch-aware. Investigate how Frequency Blur's width maps across bins (Hz vs bins vs cents); likely fix is a pitch-aware (constant-cents / log-spaced) blur kernel, matching the cents-based approach of Cloud Fuzz, possibly with a Hz/cents mode. Confirm whether the metallic tone comes from the kernel shape (hard box edges, comb-like spacing) and smooth it.
## 9. Spectral Freeze

Passed. Argi loves it (music in, infinite ambiences). No changes.

## 10. Spectral Delay

Sounds good, but it is hard to dial in and none of the current display styles help. The scrolling spectrogram (right-to-left) works as a quick fix but doesn't show what the settings do.

Needs a specialized face that visualizes the settings themselves, e.g. per-frequency delay time drawn as a curve or bars across the spectrum (delay time on one axis, frequency on the other), feedback/decay per band shown as brightness or tail length, plus the live signal faintly behind it so you can see echoes land where the settings say. Turning any delay knob should visibly reshape the picture immediately (even without audio). Drop the generic styles that don't help.
## 11. Spectral Warp (Spectral Shift)

Sounds great on music; everything works and is easy to dial in.

- Default face should be the scrolling spectrogram view (it needs that view).
- Stereo control seems to do more than just stereo (sounds like it changes more than width/L-R difference). Argi's second thought: Stereo may be a stereo shift (different shift per channel), not a mono-to-stereo widener. Check what it actually does; if it is a per-channel shift offset, rename/describe it accurately (e.g. Stereo Offset) in the parameter description so it isn't mistaken for width.- Argi likes the effect as is; keep it, just name/describe it honestly.

## New module idea: Spectral Prism (stereo widener)

A real mono-to-stereo spectral module, separate from Spectral Warp. Name decided: Spectral Prism. Rough idea: per-bin decorrelation (small per-bin phase and/or pan offsets, seeded), Width control, frequency-dependent width (keep bass mono below a crossover), and a mono-compatibility check so the mono sum stays clean. Plan separately before building.
## Rename

- Rename Spectral Shift / Spectral Warp to just "Spectral Warp" everywhere user-visible (module name, browser, docs). Keep saved-patch type ids compatible.

## 12. Spectral Cross Synthesis

Sounds good. Changes:

- Display: needs bars that reflect the module's settings (like the Vocoder note): bands/resolution, how much of each input is used per band, driven by the module's real state, not a generic spectrum.
- Smaller FFT sizes: 512 sounds good; add 256, 128 and 64 for a crunchier lo-fi sound (minimum 64 for now; 32/16 maybe later) (limits in the parameter definition). Check that the native STFT core, window, hop and any latency/buffer math handle tiny sizes, and keep CPU sane at small hops.
- Rename: needs a better two-word name. Candidates: Spectral Blend (Misty's pick), Spectral Merge, Spectral Morph, Spectral Swap, Spectral Mask, Spectral Fuse. Argi to decide.
## Mirrored display for Vocoder and Spectral Cross Synthesis

Try a mirrored face for both modules, split by a centre line:

- Above the line: the output spectrum.
- Below the line: the synth (carrier) spectrum.

Use the module's real bands (bars from Bands/Width for Vocoder, Crunch-widened bands for Cross Synthesis), so the two halves line up band for band and you can see how the synth gets shaped into the output.- Width must show visually in the mirrored face too: each bar's width follows the module's Width (band width) setting, on both halves, updating as you turn it, even without audio.
