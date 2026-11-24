// Pitch Mutator engine (first slice).
// Bake in JS: 128-entry LUTs, frequency as log2(Hz), knob lanes as slider-space offsets.
// No DSP here — lookup tables are pushed to the native graph for Freq Out.

(function (root) {
  const LUT_SIZE = 128;
  const A4_HZ = 440;
  const A4_NOTE = 69;
  const DEFAULT_COLOR = '#c45a7a';
  const DEFAULT_NAME = 'Pitch Mutator';
  const KEYBOARD_SPAN = Object.freeze({ min: 24, max: 96 }); // C1-C7
  const SNAP_TOLERANCE = 0.5;
  const MIN_HZ = 1e-6;
  const DEFAULT_SHAPE = 'rational';

  function finite(n, fallback) {
    const v = Number(n);
    return Number.isFinite(v) ? v : fallback;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function hzFromNote(note) {
    const n = finite(note, NaN);
    if (!Number.isFinite(n)) return NaN;
    return A4_HZ * Math.pow(2, (n - A4_NOTE) / 12);
  }

  function noteFromHz(hz) {
    const f = finite(hz, NaN);
    if (!(f > 0)) return NaN;
    return A4_NOTE + 12 * (Math.log(f / A4_HZ) / Math.LN2);
  }

  function log2Hz(hz) {
    const f = Math.max(MIN_HZ, finite(hz, NaN));
    if (!Number.isFinite(f)) return NaN;
    return Math.log(f) / Math.LN2;
  }

  function exp2(log2v) {
    const v = finite(log2v, NaN);
    if (!Number.isFinite(v)) return NaN;
    return Math.pow(2, v);
  }

  function curve01(p, shape, skew) {
    const t = clamp(finite(p, 0), 0, 1);
    if (typeof root.nodeGraphSegmentCurve01 === 'function') {
      const y = root.nodeGraphSegmentCurve01(t, shape || DEFAULT_SHAPE, finite(skew, 0));
      return Number.isFinite(y) ? y : t;
    }
    return t;
  }

  function normalizeShape(shape) {
    const s = String(shape || '').trim().toLowerCase();
    return s || DEFAULT_SHAPE;
  }

  function normalizeKey(raw, kind) {
    if (!raw || typeof raw !== 'object') return null;
    const x = finite(raw.x, NaN);
    if (!Number.isFinite(x)) return null;
    const key = {
      x,
      shape: normalizeShape(raw.shape),
      skew: clamp(finite(raw.skew, 0), -1, 1),
    };
    if (kind === 'freq') {
      const hz = finite(raw.hz, NaN);
      if (!(hz > 0)) return null;
      key.hz = hz;
    } else {
      key.offset = finite(raw.offset, 0);
    }
    return key;
  }

  function sortKeys(keys) {
    return (Array.isArray(keys) ? keys.slice() : []).sort((a, b) => a.x - b.x);
  }

  function normalizeFreqLane(raw) {
    const keys = sortKeys((raw && raw.keys) || [])
      .map((k) => normalizeKey(k, 'freq'))
      .filter(Boolean);
    return { keys };
  }

  function normalizeTarget(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const nodeId = String(raw.nodeId || '').trim();
    const paramKey = String(raw.paramKey || '').trim();
    if (!nodeId || !paramKey) return null;
    return { nodeId, paramKey };
  }

  function normalizeKnobLane(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const target = normalizeTarget(raw.target);
    if (!target) return null;
    const keys = sortKeys(raw.keys)
      .map((k) => normalizeKey(k, 'offset'))
      .filter(Boolean);
    return {
      id: String(raw.id || ('L' + (index + 1))),
      target,
      keys,
      discrete: Boolean(raw.discrete),
    };
  }

  function normalizeColor(value) {
    const s = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return DEFAULT_COLOR;
  }

  function normalizeMutatorState(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const lanes = Array.isArray(src.lanes)
      ? src.lanes.map((lane, i) => normalizeKnobLane(lane, i)).filter(Boolean)
      : [];
    return {
      freqLane: normalizeFreqLane(src.freqLane),
      lanes,
      autoPin: Boolean(src.autoPin),
      snap: src.snap !== false,
      activeLane: String(src.activeLane || 'freq'),
    };
  }

  function snapNote(x, snapOn) {
    const n = finite(x, NaN);
    if (!Number.isFinite(n)) return NaN;
    return snapOn ? Math.round(n) : n;
  }

  function findKeyIndex(keys, x, tolerance) {
    const tol = finite(tolerance, SNAP_TOLERANCE);
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < keys.length; i++) {
      const d = Math.abs(keys[i].x - x);
      if (d <= tol && d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  function evalKeysAt(keys, x, pick, interpolate, discrete) {
    if (!keys || !keys.length) return null;
    if (keys.length === 1 || x <= keys[0].x) return pick(keys[0]);
    const last = keys[keys.length - 1];
    if (x >= last.x) return pick(last);
    let i = 0;
    while (i + 1 < keys.length && keys[i + 1].x < x) i += 1;
    const a = keys[i];
    const b = keys[i + 1];
    if (discrete || a.shape === 'hold') return pick(a);
    const span = b.x - a.x;
    if (!(span > 0)) return pick(a);
    const t = curve01((x - a.x) / span, a.shape, a.skew);
    return interpolate(a, b, t);
  }

  function bakeLane(keys, pick, interpolate, discrete) {
    const table = new Float64Array(LUT_SIZE);
    const valid = Boolean(keys && keys.length);
    if (!valid) return { table, valid: false };
    for (let i = 0; i < LUT_SIZE; i++) {
      table[i] = evalKeysAt(keys, i, pick, interpolate, discrete);
    }
    return { table, valid: true };
  }

  function bakeFreqLane(freqLane) {
    const keys = normalizeFreqLane(freqLane).keys;
    return bakeLane(
      keys,
      (k) => log2Hz(k.hz),
      (a, b, t) => log2Hz(a.hz) + (log2Hz(b.hz) - log2Hz(a.hz)) * t,
      false,
    );
  }

  function bakeOffsetLane(lane) {
    const normalized = lane && lane.target ? normalizeKnobLane(lane, 0) : null;
    const keys = sortKeys(((normalized && normalized.keys) || (lane && lane.keys) || []))
      .map((k) => normalizeKey(k, 'offset'))
      .filter(Boolean);
    const discrete = Boolean((normalized && normalized.discrete) || (lane && lane.discrete));
    return bakeLane(
      keys,
      (k) => k.offset,
      (a, b, t) => a.offset + (b.offset - a.offset) * t,
      discrete,
    );
  }

  function lookupLut(table, x, valid) {
    if (!valid || !table || !table.length) return null;
    const n = finite(x, NaN);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return table[0];
    const last = table.length - 1;
    if (n >= last) return table[last];
    const i = Math.floor(n);
    const f = n - i;
    return table[i] + (table[i + 1] - table[i]) * f;
  }

  function lookupFreqHz(table, x, valid) {
    const logv = lookupLut(table, x, valid);
    return logv == null ? null : exp2(logv);
  }

  function lookupOffset(table, x, valid) {
    return lookupLut(table, x, valid);
  }

  function metaNumber(meta, key, fallback) {
    if (!meta) return fallback;
    const v = finite(meta[key], NaN);
    return Number.isFinite(v) ? v : fallback;
  }

  function sliderFromDomain(meta, value) {
    const min = metaNumber(meta, 'min', 0);
    const max = metaNumber(meta, 'max', 1);
    const range = max - min;
    if (!(Math.abs(range) > 0)) return 0;
    const v = finite(value, min);
    if (meta && meta.wraparound) {
      return ((v - min) / range) % 1;
    }
    return clamp((v - min) / range, 0, 1);
  }

  function domainFromSlider(meta, slider) {
    const min = metaNumber(meta, 'min', 0);
    const max = metaNumber(meta, 'max', 1);
    const t = clampSlider(meta, slider);
    return min + (max - min) * t;
  }

  function clampSlider(meta, slider) {
    const t = finite(slider, 0);
    if (meta && meta.wraparound) {
      const w = t % 1;
      return w < 0 ? w + 1 : w;
    }
    return clamp(t, 0, 1);
  }

  function finalSlider(baseSlider, offsets, meta) {
    const sum = (Array.isArray(offsets) ? offsets : [offsets]).reduce(
      (acc, off) => acc + finite(off, 0),
      0,
    );
    return clampSlider(meta, finite(baseSlider, 0) + sum);
  }

  function pinKey(keys, x, valueField, value, snapOn, defaults) {
    const snapped = snapNote(x, snapOn);
    if (!Number.isFinite(snapped)) return keys.slice();
    const next = keys.slice();
    const idx = findKeyIndex(next, snapped, snapOn ? SNAP_TOLERANCE : 1e-6);
    const shape = normalizeShape((defaults && defaults.shape) || DEFAULT_SHAPE);
    const skew = clamp(finite(defaults && defaults.skew, 0), -1, 1);
    if (idx >= 0) {
      next[idx] = { ...next[idx], x: snapped, [valueField]: value };
    } else {
      next.push({ x: snapped, [valueField]: value, shape, skew });
    }
    return sortKeys(next);
  }

  function shiftOffsets(keys, delta, meta) {
    const d = finite(delta, 0);
    if (!d) return keys.slice();
    return keys.map((k) => ({ ...k, offset: clampSlider(meta, k.offset + d) }));
  }

  function shiftFreqKeysLog(keys, logDelta) {
    const d = finite(logDelta, 0);
    if (!d) return keys.slice();
    return keys.map((k) => ({ ...k, hz: Math.max(MIN_HZ, exp2(log2Hz(k.hz) + d)) }));
  }

  function remapLaneTargets(lanes, idMap) {
    if (!idMap || typeof idMap !== 'object') return lanes;
    return (lanes || []).map((lane) => {
      const id = lane && lane.target && lane.target.nodeId;
      if (id && Object.prototype.hasOwnProperty.call(idMap, id)) {
        return { ...lane, target: { ...lane.target, nodeId: idMap[id] } };
      }
      return lane;
    });
  }

  function dropMissingTargets(lanes, existsFn, warnings) {
    return (lanes || []).filter((lane) => {
      const ok = typeof existsFn !== 'function' || existsFn(lane.target);
      if (!ok && Array.isArray(warnings)) {
        warnings.push('Dropped Mutator lane ' + lane.id + ' (missing target).');
      }
      return ok;
    });
  }

  const api = {
    LUT_SIZE,
    A4_HZ,
    A4_NOTE,
    DEFAULT_COLOR,
    DEFAULT_NAME,
    KEYBOARD_SPAN,
    SNAP_TOLERANCE,
    hzFromNote,
    noteFromHz,
    log2Hz,
    exp2,
    normalizeColor,
    normalizeMutatorState,
    normalizeFreqLane,
    normalizeKnobLane,
    snapNote,
    bakeFreqLane,
    bakeOffsetLane,
    lookupLut,
    lookupFreqHz,
    lookupOffset,
    sliderFromDomain,
    domainFromSlider,
    clampSlider,
    finalSlider,
    pinKey,
    shiftOffsets,
    shiftFreqKeysLog,
    remapLaneTargets,
    dropMissingTargets,
  };

  root.PitchMutatorEngine = api;
  root.pitchMutatorEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
