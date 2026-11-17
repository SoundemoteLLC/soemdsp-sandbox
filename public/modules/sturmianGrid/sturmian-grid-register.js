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
    // Compact common-slider rows in the param band (not definition.face).
    // definition.face mounts a handwritten WebGL .node-face and hides the
    // common sliders (has-module-face); that path is for Clock / Velvet-style
    // knobs and made Sturmian's controls disappear. Plane is a View choice;
    // there is no separate View Plane control.
    parameterRows: [
      ["rate", "semitoneOffset"],
      ["pitchSource", "pitchRange"],
      ["alpha", "beta", "rho"],
      ["drift"],
      ["steps", "reset"],
      ["spread", "walk"],
      ["snap"],
      ["view"],
    ],
    parameters: [
      { key: "rate", label: "Rate", defaultValue: "8", min: "0", max: "20000", mid: "8", step: "any", nonlinearSlider: true, linearSmoothing: false, kind: "frequency", unit: "Hz" },
      // Same convention as Pitch Quantizer / Acid Sequencer: integer st, -48..+48.
      { key: "semitoneOffset", label: "Semitone Offset", defaultValue: "0", min: "-48", mid: "0", max: "48", step: "1", nonlinearSlider: false, linearSmoothing: false, showSign: true, unit: "st" },
      // Classic (default) is the original floor(x*10) pentatonic map, span 21 st.
      // Tile / Height / X are scale-agnostic; patch ♯/♭ into Pitch Quantizer for scales.
      { key: "pitchSource", label: "Pitch Source", defaultValue: "0", min: "0", max: "3", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Classic", "Tile", "Height", "X"], displayChoices: true },
      { key: "pitchRange", label: "Pitch Range", defaultValue: "21", min: "0", max: "48", mid: "21", step: "1", nonlinearSlider: false, linearSmoothing: false, unit: "st" },
      { key: "alpha", label: "α", defaultValue: "0.2955977425", min: "0.001", max: "0.999", mid: "0.3", step: "0.0001", nonlinearSlider: false, linearSmoothing: false },
      { key: "beta", label: "β", defaultValue: "0.1607132448", min: "0.001", max: "0.999", mid: "0.2", step: "0.0001", nonlinearSlider: false, linearSmoothing: false },
      { key: "rho", label: "ρ", defaultValue: "0", min: "0", max: "1", mid: "0.5", step: "0.0001", nonlinearSlider: false, linearSmoothing: false, wraparound: true },
      { key: "drift", label: "Drift", defaultValue: "0", min: "-0.2", max: "0.2", mid: "0", step: "0.0005", nonlinearSlider: false, linearSmoothing: false },
      { key: "steps", label: "Steps", defaultValue: "16", min: "2", max: "32", mid: "16", step: "1", nonlinearSlider: false, linearSmoothing: false },
      // Spawn 0–128, mid-skew 8 at slider center, default 8. 0 = never reset.
      // hardMax keeps the previous 65536 typed/load ceiling so old patches hold.
      { key: "reset", label: "Reset after", defaultValue: "8", min: "0", max: "128", mid: "8", step: "1", hardMax: "65536", nonlinearSlider: true, sliderCurve: "skew", linearSmoothing: false },
      { key: "spread", label: "Track spread", defaultValue: "1", min: "1", max: "16", mid: "1", step: "1", nonlinearSlider: false, linearSmoothing: false },
      { key: "walk", label: "Bar walk", defaultValue: "1", min: "0", max: "8", mid: "1", step: "1", nonlinearSlider: false, linearSmoothing: false },
      { key: "snap", label: "Rational snap", defaultValue: "0", min: "0", max: "1", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Off", "On"], displayChoices: true },
      { key: "view", label: "View", defaultValue: "0", min: "0", max: "2", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Plane", "Binary", "Level"], displayChoices: true },
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
