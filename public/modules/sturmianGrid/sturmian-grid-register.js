// Sturmian Grid — two-dimensional Sturmian pattern source. The graph engine
// owns its sample clock and five CV/trigger outputs; this module owns only the
// display and controls. Sound generation belongs in separately patchable DSP.

const STURMIAN_DEFAULT_MASK = 3170;

registerNodeGraphChromelessModule("sturmianGrid", {
  label: "Sturmian Grid",
  // No solidModule: LayoutA ports sit above the face, with visible labels.
  customDisplayArea: true,
  definition: {
    planRole: "source",
    planFreeRun: true,
    // Face reads hidden __Phase / __Bar taps every paint. customDisplayArea
    // modules are layoutOwned and would otherwise be omitted from scope capture.
    planScopeCapture: true,
    // Display Settings (not the param band): track-span and playhead stroke alphas.
    displayModes: [{
      key: "sturmianGridFace",
      label: "Sturmian Grid",
      renderer: "layoutOwned",
      settingsSchema: "sturmianGridFace",
    }],
    defaultWidthGu: 16,
    displayHeightGu: 8,
    chrome: "LayoutA",
    customDisplayArea: true,
    digitalInputs: ["Restart", "Adv"],
    // Restart uses the app-wide Reset mark (↺). Adv uses ▶ (BLACK RIGHT-POINTING TRIANGLE).
    // ƒ matches Clock / other frequency inlets.
    inputLabels: { Restart: "↺", Adv: "▶", f: "ƒ" },
    inputAliases: { "ƒ": "f", Frequency: "f" },
    inputs: ["Restart", "Adv", "f"],
    inputTooltips: {
      Restart: "Rising edge returns to step 0 and bar 0, and clears accumulated ρ drift.",
      Adv: "External step clock. Each rising edge is one step. While wired, Rate and ƒ are ignored.",
      f: "Steps per second in Hz. Replaces the Rate knob while wired, unless Adv is also wired.",
    },
    // Wired ƒ replaces Rate (Rate row striped). Wired Adv owns Rate and ƒ.
    fJackParam: "rate",
    advJackParam: "rate",
    advJackOwnsInputs: ["f"],
    digitalOutputs: ["Kick", "Snare", "Hat", "Melody"],
    // Named trigger outs keep the lane name plus the app-wide trigger mark (⎍).
    outputLabels: {
      Kick: "Kick ⎍",
      Snare: "Snare ⎍",
      Hat: "Hat ⎍",
      Melody: "Melody ⎍",
      Pitch: "♯/♭",
      f: "ƒ",
    },
    outputAliases: { "ƒ": "f", Frequency: "f" },
    outputs: ["Kick", "Snare", "Hat", "Melody", "Pitch", "f"],
    outputTooltips: {
      Kick: "One-sample trigger when the Kick track fires on a step.",
      Snare: "One-sample trigger when the Snare track fires on a step.",
      Hat: "One-sample trigger when the Hat track fires on a step.",
      Melody: "One-sample trigger when the Melody track fires on a step. Also latches the ♯/♭ and ƒ pitch.",
      Pitch: "Melody pitch as a MIDI note (♯/♭): A3 + Semitone Offset + (Pitch Source × Pitch Range). Holds the last Melody hit.",
      f: "The same melody pitch, as frequency in Hz. Wire to an oscillator ƒ.",
    },
    // Compact common-slider rows in the param band (not definition.face).
    // definition.face mounts a handwritten WebGL .node-face and hides the
    // common sliders (has-module-face); that path is for Clock / Velvet-style
    // knobs and made Sturmian's controls disappear. Plane is a View choice;
    // there is no separate View Plane control.
    parameterRows: [
      ["rate", "drift"],
      ["semitoneOffset", "pitchSource", "pitchRange"],
      ["alpha", "beta", "rho"],
      ["steps", "spread"],
      ["reset", "walk", "snap"],
      ["view"],
    ],
    parameters: [
      { key: "rate", label: "Rate", defaultValue: "8", min: "0", max: "20000", mid: "8", step: "any", nonlinearSlider: true, linearSmoothing: false, kind: "frequency", unit: "Hz",
        tooltip: "How many steps run each second (Hz). A cable into ƒ replaces this knob. A cable into Adv takes over the clock: Rate and ƒ are ignored, and each rising edge is one step." },
      { key: "drift", label: "Drift", defaultValue: "0", min: "-0.2", max: "0.2", mid: "0", step: "0.0005", nonlinearSlider: false, linearSmoothing: false,
        tooltip: "Walks ρ around its 0–1 cycle, in turns per second. Positive and negative drift opposite ways. 0 leaves ρ where you set it." },
      // Same convention as Pitch Quantizer / Acid Sequencer: integer st, -48..+48.
      { key: "semitoneOffset", label: "Semitone Offset", defaultValue: "0", min: "-48", mid: "0", max: "48", step: "1", nonlinearSlider: false, linearSmoothing: false, showSign: true, unit: "st",
        tooltip: "Shifts the ♯/♭ melody in semitones. Pitch is A3 + Semitone Offset + (Pitch Source × Pitch Range)." },
      // Classic (default) is the original floor(x*10) pentatonic map, span 21 st.
      // Tile / Height / X are scale-agnostic; patch ♯/♭ into Pitch Quantizer for scales.
      { key: "pitchSource", label: "Pitch Source", defaultValue: "0", min: "0", max: "3", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Classic", "Tile", "Height", "X"], displayChoices: true,
        tooltip: "What feeds the ♯/♭ pitch, scaled 0–1 then multiplied by Pitch Range. Classic (default): the original pentatonic map — 21 semitones at the default Range. Tile: the cell’s letter (0, 1, or 2) as 0, ½, or 1. Height: only the melody track’s row phase, with no step motion. X: the raw cell phase, continuous 0–1. Tile, Height, and X are scale-free; patch ♯/♭ into Pitch Quantizer for scales." },
      { key: "pitchRange", label: "Pitch Range", defaultValue: "21", min: "0", max: "48", mid: "21", step: "1", nonlinearSlider: false, linearSmoothing: false, unit: "st",
        tooltip: "How many semitones the Pitch Source’s 0–1 span covers. 0 holds a single pitch (A3 + Semitone Offset). 21 matches Classic’s original pentatonic span." },
      { key: "alpha", label: "α", defaultValue: "0.2955977425", min: "0.001", max: "0.999", mid: "0.3", step: "0.0001", nonlinearSlider: false, linearSmoothing: false,
        tooltip: "Horizontal cut: the width of the α cells along each row. Raise it to pack more α hits into the bar. With β it splits every row into three letters (rest, α, β)." },
      { key: "beta", label: "β", defaultValue: "0.1607132448", min: "0.001", max: "0.999", mid: "0.2", step: "0.0001", nonlinearSlider: false, linearSmoothing: false,
        tooltip: "Vertical cut: the width of the β cells. Together with α it partitions the grid into three letters. If α + β reaches 1, the rest letter disappears." },
      { key: "rho", label: "ρ", defaultValue: "0", min: "0", max: "1", mid: "0.5", step: "0.0001", nonlinearSlider: false, linearSmoothing: false, wraparound: true,
        tooltip: "Phase of the cut, wrapping 0–1. Slides the whole pattern along the grid without changing α or β. Drift adds to this over time." },
      { key: "steps", label: "Steps", defaultValue: "16", min: "2", max: "32", mid: "16", step: "1", nonlinearSlider: false, linearSmoothing: false,
        tooltip: "Columns in one cycle — the sounding bar. After this many steps the bar advances and Bar Walk slides the tracks." },
      { key: "spread", label: "Track spread", defaultValue: "1", min: "1", max: "16", mid: "1", step: "1", nonlinearSlider: false, linearSmoothing: false,
        tooltip: "Row spacing between the four tracks (Kick, Snare, Hat, Melody). 1 puts them on neighboring rows; higher values open a gap." },
      // Spawn 0–128, mid-skew 8 at slider center, default 8. 0 = never reset.
      // hardMax keeps the previous 65536 typed/load ceiling so old patches hold.
      { key: "reset", label: "Reset after", defaultValue: "8", min: "0", max: "128", mid: "8", step: "1", hardMax: "65536", nonlinearSlider: true, sliderCurve: "skew", linearSmoothing: false,
        tooltip: "After this many steps, jump back to step 0 and bar 0 (Bar Walk starts over too). 0 means never reset, so bars can keep walking." },
      { key: "walk", label: "Bar walk", defaultValue: "1", min: "0", max: "8", mid: "1", step: "1", nonlinearSlider: false, linearSmoothing: false,
        tooltip: "Each time a Steps cycle finishes, every track slides down this many rows. 0 keeps the same rows every bar." },
      { key: "snap", label: "Rational snap", defaultValue: "0", min: "0", max: "1", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Off", "On"], displayChoices: true,
        tooltip: "On: rounds α and β to the nearest fraction with denominator Steps, so the bar repeats cleanly — Euclidean-like. Off: uses the exact α and β, which can wander from bar to bar." },
      { key: "view", label: "View", defaultValue: "0", min: "0", max: "2", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Plane", "Binary", "Level"], displayChoices: true,
        tooltip: "How the grid is drawn. Plane: three letter colors (rest, α, β). Binary: only α cells light — and only α cells can fire; β is treated as rest, so the pattern changes. Level: shades each cell by its continuous phase, dark to bright." },
      // Zoom-1 cell size in CSS pixels (soundemote-dev default 14). The face
      // uses floor(cell * zoom) so cells grow in whole device pixels. Hidden
      // so saved patches still load; shrinks only if the sounding bar cannot fit.
      { key: "cell", label: "Cell size", defaultValue: "14", min: "2", max: "48", mid: "14", step: "1", nonlinearSlider: false, linearSmoothing: false, hidden: true },
      { key: "stepPattern", label: "Track map", defaultValue: String(STURMIAN_DEFAULT_MASK), min: "0", max: "65535", mid: String(STURMIAN_DEFAULT_MASK), step: "1", nonlinearSlider: false, linearSmoothing: false, hidden: true },
    ],
  },
  catalog: {
    category: "Sequence",
    description: "A compact 2D Sturmian grid with four trigger lanes, a melody pitch output, and ƒ in Hz. Patch it into separate sound modules.",
    notes: ["sturmian", "grid", "sequence", "kick trigger", "snare trigger", "hat trigger", "melody trigger", "pitch", "frequency", "webgl"],
  },
});
