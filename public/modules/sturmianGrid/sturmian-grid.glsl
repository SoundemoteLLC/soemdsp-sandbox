const vec3 BG = vec3(13.0, 16.0, 24.0) / 255.0;

vec3 laneColor(int lane) {
  if (lane == 0) return vec3(1.0, 0.82, 0.48);
  if (lane == 1) return vec3(0.48, 0.94, 0.78);
  if (lane == 2) return vec3(0.60, 0.82, 1.0);
  return vec3(1.0, 0.56, 0.80);
}

// --- MAIN ---
vec2 px = vec2(uv.x * resolution.x, (1.0 - uv.y) * resolution.y);
float w = resolution.x;
float h = resolution.y;
float playCols = max(2.0, floor(steps + 0.5));
float spreadN = max(1.0, floor(spread + 0.5));
float walkN = max(0.0, floor(walk + 0.5));
// Cell size fits Steps and the Track Spread window. The same square
// then tiles the whole face; extra columns/rows continue the word.
// Sub-cell remainder becomes equal margins so no half cells are drawn.
float rowsNeeded = max(1.0, 3.0 * spreadN + 1.0);
float cell = max(2.0, floor(min(w / playCols, h / rowsNeeded)));
float cols = max(1.0, floor(w / cell));
float rows = max(1.0, floor(h / cell));
float padLeft = max(0.0, floor((cols - playCols) * 0.5));
float ox = floor((w - cols * cell) * 0.5);
float oy = floor((h - rows * cell) * 0.5);
float firstN = playBar * walkN;
float span = 3.0 * spreadN + 1.0;
float above = max(0.0, floor((rows - span) * 0.5));
float nTop = firstN - above;
float gridX = px.x - ox;
float gridY = px.y - oy;
if (gridX < 0.0 || gridY < 0.0 || gridX >= cols * cell || gridY >= rows * cell) {
  out_color = vec4(BG, 1.0);
} else {
  float col = floor(gridX / cell);
  float row = floor(gridY / cell);
  float m = col - padLeft;
  float n = nTop + row;
  float aa = alpha; float bb = beta;
  if (snap > 0.5) { aa = floor(aa * steps + 0.5) / steps; bb = floor(bb * steps + 0.5) / steps; }
  float z = fract(m * aa + n * bb + rho + drift * time);
  float tile = z >= 1.0-aa ? 1.0 : (z >= 1.0-aa-bb ? 2.0 : 0.0);
  vec3 base = vec3(16.0,19.0,28.0)/255.0;
  if(view < 0.5) base = tile < 0.5 ? BG : (tile < 1.5 ? vec3(150.0,151.0,255.0)/255.0 : vec3(255.0,42.0,101.0)/255.0);
  else if(view < 1.5) base = tile == 1.0 ? vec3(255.0,42.0,101.0)/255.0 : vec3(26.0,30.0,40.0)/255.0;
  else base = mix(vec3(18.0,20.0,30.0)/255.0, vec3(255.0,42.0,101.0)/255.0, z);
  float mask = floor(stepPattern + 0.5);
  bool onTrack = false;
  int trackHit = -1;
  for (int track = 0; track < 4; track++) {
    float trackN = firstN + float(track) * spreadN;
    if (abs(n - trackN) < 0.5) { onTrack = true; trackHit = track; }
  }
  bool inBar = m >= 0.0 && m < playCols;
  if (!onTrack || !inBar) base *= 0.55;

  float pr = max(1e-6, pixelRatio);
  float devX = floor(gridX * pr + 1e-4);
  float devY = floor(gridY * pr + 1e-4);
  float cellDev = cell * pr;
  float fx = mod(gridX, cell);
  float fy = mod(gridY, cell);
  float gridW = cols * cell;
  float gridH = rows * cell;
  // 1-texel gutters (left/top of each cell, plus the outer right/bottom).
  // The face texture is sized to screen resolution, so one texel is one
  // screen/device pixel at every zoom and the seams do not grow. Solid black
  // so tile red/blue cannot bleed. The track-span frame is painted after this
  // so it stays one contiguous stroke across those seams.
  float colStartDev = floor(col * cell * pr + 1e-4);
  float colEndDev = floor((col + 1.0) * cell * pr + 1e-4);
  float rowStartDev = floor(row * cell * pr + 1e-4);
  float gridEndX = floor(gridW * pr + 1e-4);
  float gridEndY = floor(gridH * pr + 1e-4);
  bool gutter = devX < colStartDev + 1.0 || devY < rowStartDev + 1.0
    || devX >= gridEndX - 1.0 || devY >= gridEndY - 1.0;
  float barX0 = padLeft * cellDev;
  float barX1 = (padLeft + playCols) * cellDev;
  // Sounding-bar bounds sit just inside the gutter so the dashed line stays visible.
  if (!gutter && ((devX >= barX0 + 1.0 && devX < barX0 + 2.0)
      || (devX >= barX1 - 2.0 && devX < barX1 - 1.0))
      && mod(devY, 8.0) < 4.0)
    base = mix(base, vec3(1.0), 0.35);
  // Playhead: sounding-bar column (m = col - padLeft), full face height, inset
  // one texel so the white frame is inside the cell, not on the gutter.
  bool playCol = playing > 0.5 && inBar && abs(m - playStep) < 0.5;
  if (playCol && !gutter) {
    base = mix(base, vec3(1.0), 0.22);
    bool frame = (devX >= colStartDev + 1.0 && devX < colStartDev + 2.0)
      || (devX >= colEndDev - 1.0 && devX < colEndDev)
      || (devY >= 1.0 && devY < 2.0)
      || (devY >= gridEndY - 1.0 && devY < gridEndY);
    if (frame) base = vec3(1.0);
    if (trackHit >= 0) {
      if (mod(floor(mask / exp2(float(12 + trackHit))), 2.0) < 0.5
          && mod(floor(mask / exp2(float(trackHit * 3) + tile)), 2.0) > 0.5
          && fx >= 2.0 && fx < cell - 2.0 && fy >= 2.0 && fy < cell - 2.0)
        base = mix(laneColor(trackHit), base, 0.15);
    }
  }
  // Hit flash: lit when this column just fired, fading over one beat, inset.
  if (!gutter && flashAmt > 0.0 && abs(m - flashStep) < 0.5 && trackHit >= 0
      && mod(floor(flashMask / exp2(float(trackHit))), 2.0) > 0.5
      && fx >= 2.0 && fx < cell - 2.0 && fy >= 2.0 && fy < cell - 2.0) {
    base = mix(base, vec3(1.0), 0.55 * flashAmt);
    base = mix(base, laneColor(trackHit), 0.35 * flashAmt);
  }
  if (gutter) base = vec3(0.0);
  // One 1-device-pixel stroke around the whole sounding-bar track row
  // (d7cf6bc8 / soundemote-dev strokeRect around the selection). Continuous
  // across gutters; 1 device pixel thick at any zoom (devX/devY, pixelRatio).
  for (int track = 0; track < 4; track++) {
    float trackN = firstN + float(track) * spreadN;
    if (abs(n - trackN) > 0.5) continue;
    if (!inBar) continue;
    bool muted = mod(floor(mask / exp2(float(12 + track))), 2.0) > 0.5;
    vec3 tc = muted ? vec3(0.55) : laneColor(track);
    float spanLeft = floor(padLeft * cellDev);
    float spanRight = floor((padLeft + playCols) * cellDev);
    float spanTop = floor(row * cellDev);
    float spanBot = floor((row + 1.0) * cellDev);
    bool inside = devX >= spanLeft && devX < spanRight && devY >= spanTop && devY < spanBot;
    bool frame = inside && (devX < spanLeft + 1.0 || devX >= spanRight - 1.0
      || devY < spanTop + 1.0 || devY >= spanBot - 1.0);
    if (frame) base = tc;
  }
  out_color = vec4(base, 1.0);
}
