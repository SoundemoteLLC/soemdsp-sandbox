// Sturmian Grid — two-dimensional Sturmian pattern source. The graph engine
// owns its sample clock and five CV/trigger outputs; this module owns only the
// display and controls. Sound generation belongs in separately patchable DSP.

const STURMIAN_DEFAULT_MASK = 3170;

registerNodeGraphChromelessModule("sturmianGrid", {
  label: "Sturmian Grid",
  solidModule: true,
  customDisplayArea: true,
  definition: {
    planRole: "source",
    planFreeRun: true,
    defaultWidthGu: 16,
    displayHeightGu: 8,
    chrome: "LayoutB",
    customDisplayArea: true,
    // LayoutB side-band labels (jack + short text; not labels-hidden).
    layoutBPortLabels: true,
    digitalInputs: ["Restart", "Adv"],
    inputLabels: { Restart: "↺", Adv: "▸" },
    inputs: ["Restart", "Adv"],
    digitalOutputs: ["Kick", "Snare", "Hat", "Melody"],
    outputLabels: {
      Kick: "K",
      Snare: "S",
      Hat: "H",
      Melody: "M",
      Pitch: "♯/♭",
      f: "ƒ",
    },
    outputAliases: { "ƒ": "f", Frequency: "f" },
    outputs: ["Kick", "Snare", "Hat", "Melody", "Pitch", "f"],
    parameters: [
      { key: "alpha", label: "α", defaultValue: "0.2955977425", min: "0.001", max: "0.999", mid: "0.3", step: "0.0001", nonlinearSlider: false, linearSmoothing: false },
      { key: "beta", label: "β", defaultValue: "0.1607132448", min: "0.001", max: "0.999", mid: "0.2", step: "0.0001", nonlinearSlider: false, linearSmoothing: false },
      { key: "rho", label: "ρ", defaultValue: "0", min: "0", max: "1", mid: "0.5", step: "0.0001", nonlinearSlider: false, linearSmoothing: false, wraparound: true },
      { key: "drift", label: "ρ drift", defaultValue: "0", min: "-0.2", max: "0.2", mid: "0", step: "0.0005", nonlinearSlider: false, linearSmoothing: false },
      { key: "rate", label: "Rate", defaultValue: "120", min: "40", max: "300000", mid: "120", step: "any", nonlinearSlider: true, linearSmoothing: false, unit: "BPM" },
      { key: "steps", label: "Steps", defaultValue: "16", min: "2", max: "32", mid: "16", step: "1", nonlinearSlider: false, linearSmoothing: false },
      { key: "reset", label: "Reset after", defaultValue: "16", min: "0", max: "65536", mid: "16", step: "1", nonlinearSlider: false, linearSmoothing: false },
      { key: "spread", label: "Track spread", defaultValue: "1", min: "1", max: "16", mid: "1", step: "1", nonlinearSlider: false, linearSmoothing: false },
      { key: "walk", label: "Bar walk", defaultValue: "1", min: "0", max: "8", mid: "1", step: "1", nonlinearSlider: false, linearSmoothing: false },
      { key: "snap", label: "Rational snap", defaultValue: "0", min: "0", max: "1", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Off", "On"], displayChoices: true },
      { key: "view", label: "View", defaultValue: "0", min: "0", max: "2", mid: "0", step: "1", nonlinearSlider: false, linearSmoothing: false, choices: ["Plane", "Binary", "Level"], displayChoices: true },
      // Kept so saved patches still load. The face ignores this; Steps sets cell size.
      { key: "cell", label: "Cell size", defaultValue: "14", min: "2", max: "48", mid: "14", step: "1", nonlinearSlider: false, linearSmoothing: false, hidden: true },
      { key: "stepPattern", label: "Track map", defaultValue: String(STURMIAN_DEFAULT_MASK), min: "0", max: "65535", mid: String(STURMIAN_DEFAULT_MASK), step: "1", nonlinearSlider: false, linearSmoothing: false, hidden: true },
    ],
  },
  catalog: {
    category: "Sequence",
    description: "A compact 2D Sturmian grid with four trigger lanes, a pentatonic pitch output, and ƒ in Hz. Patch it into separate sound modules.",
    notes: ["sturmian", "grid", "sequence", "kick trigger", "snare trigger", "hat trigger", "melody trigger", "pitch", "frequency", "webgl"],
  },
});
