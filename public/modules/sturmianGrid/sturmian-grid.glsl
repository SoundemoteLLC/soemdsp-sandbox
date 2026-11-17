const vec3 BG = vec3(13.0, 16.0, 24.0) / 255.0;

vec3 laneColor(int lane) {
  // soundemote-dev TRACK_COLORS: #ffd27a, #7af0c8, #9ad0ff, #ff9ad6
  if (lane == 0) return vec3(255.0, 210.0, 122.0) / 255.0;
  if (lane == 1) return vec3(122.0, 240.0, 200.0) / 255.0;
  if (lane == 2) return vec3(154.0, 208.0, 255.0) / 255.0;
  return vec3(255.0, 154.0, 214.0) / 255.0;
}

// 5x7 glyphs: 0,1,2,K,S,H,M. Rows are 5 bits, MSB is the left pixel.
int sturmianGlyphRow(int code, int row) {
  if (row < 0 || row > 6) return 0;
  if (code == 0) {
    if (row == 0 || row == 6) return 14;
    return 17;
  }
  if (code == 1) {
    if (row == 0) return 4;
    if (row == 1) return 12;
    if (row == 6) return 14;
    return 4;
  }
  if (code == 2) {
    if (row == 0) return 14;
    if (row == 1) return 17;
    if (row == 2) return 1;
    if (row == 3) return 6;
    if (row == 4) return 8;
    if (row == 5) return 16;
    return 31;
  }
  if (code == 3) { // K
    if (row == 0 || row == 6) return 17;
    if (row == 1 || row == 5) return 18;
    if (row == 2 || row == 4) return 20;
    return 24;
  }
  if (code == 4) { // S
    if (row == 0) return 15;
    if (row == 1 || row == 2) return 16;
    if (row == 3) return 14;
    if (row == 4 || row == 5) return 1;
    return 30;
  }
  if (code == 5) { // H
    if (row == 3) return 31;
    return 17;
  }
  if (code == 6) { // M
    if (row == 1) return 27;
    if (row == 2) return 21;
    return 17;
  }
  return 0;
}

bool sturmianGlyphAt(int code, vec2 p, float scale) {
  if (scale < 0.5) return false;
  int gx = int(floor(p.x / scale));
  int gy = int(floor(p.y / scale));
  if (gx < 0 || gx > 4 || gy < 0 || gy > 6) return false;
  return ((sturmianGlyphRow(code, gy) >> (4 - gx)) & 1) == 1;
}

// --- MAIN ---
vec2 px = vec2(uv.x * resolution.x, (1.0 - uv.y) * resolution.y);
float w = resolution.x;
float faceH = resolution.y;
float gridLimit = gridH > 0.5 ? gridH : faceH;
float playCols = max(2.0, floor(steps + 0.5));
float spreadN = max(1.0, floor(spread + 0.5));
float walkN = max(0.0, floor(walk + 0.5));
// Layout comes from JS (floor(baseCell * zoom), packed whole cells, integer
// centered remainder). Do not re-fit cell to the plate — leftover is margin.
float cell = max(2.0, layoutCell);
float cols = max(1.0, layoutCols);
float rows = max(1.0, layoutRows);
float padLeft = max(0.0, layoutPadLeft);
float ox = layoutOx;
float oy = layoutOy;
float firstN = playBar * walkN;
float span = 3.0 * spreadN + 1.0;
float above = max(0.0, floor((rows - span) * 0.5));
float nTop = firstN - above;
float gridX = px.x - ox;
float gridY = px.y - oy;
// Leftover sub-cell space in the grid region is a black margin, not a stretch.
vec3 base = vec3(0.0);
bool inGrid = px.y < gridLimit && gridX >= 0.0 && gridY >= 0.0
  && gridX < cols * cell && gridY < rows * cell;
float col = 0.0;
float row = 0.0;
float m = 0.0;
float n = 0.0;
float tile = 0.0;
float fx = 0.0;
float fy = 0.0;
int trackHit = -1;
bool inBar = false;
float mask = floor(stepPattern + 0.5);
if (inGrid) {
  col = floor(gridX / cell);
  row = floor(gridY / cell);
  m = col - padLeft;
  n = nTop + row;
  float aa = alpha; float bb = beta;
  if (snap > 0.5) { aa = floor(aa * steps + 0.5) / steps; bb = floor(bb * steps + 0.5) / steps; }
  float z = fract(m * aa + n * bb + rho + drift * time);
  tile = z >= 1.0-aa ? 1.0 : (z >= 1.0-aa-bb ? 2.0 : 0.0);
  base = vec3(16.0,19.0,28.0)/255.0;
  if(view < 0.5) base = tile < 0.5 ? BG : (tile < 1.5 ? vec3(150.0,151.0,255.0)/255.0 : vec3(255.0,42.0,101.0)/255.0);
  else if(view < 1.5) base = tile == 1.0 ? vec3(255.0,42.0,101.0)/255.0 : vec3(26.0,30.0,40.0)/255.0;
  else base = mix(vec3(18.0,20.0,30.0)/255.0, vec3(255.0,42.0,101.0)/255.0, z);
  bool onTrack = false;
  trackHit = -1;
  for (int track = 0; track < 4; track++) {
    float trackN = firstN + float(track) * spreadN;
    if (abs(n - trackN) < 0.5) { onTrack = true; trackHit = track; }
  }
  inBar = m >= 0.0 && m < playCols;
  if (!onTrack || !inBar) base *= 0.55;

  float pr = max(1e-6, pixelRatio);
  float devX = floor(gridX * pr + 1e-4);
  float devY = floor(gridY * pr + 1e-4);
  float cellDev = cell * pr;
  fx = mod(gridX, cell);
  fy = mod(gridY, cell);
  float gridW = cols * cell;
  float gridSpanH = rows * cell;
  // 1-texel gutters: left/top of each cell plus the outer right/bottom.
  float colStartDev = floor(col * cell * pr + 1e-4);
  float rowStartDev = floor(row * cell * pr + 1e-4);
  float gridEndX = floor(gridW * pr + 1e-4);
  float gridEndY = floor(gridSpanH * pr + 1e-4);
  bool gutter = devX < colStartDev + 1.0 || devY < rowStartDev + 1.0
    || devX >= gridEndX - 1.0 || devY >= gridEndY - 1.0;
  if (!gutter && flashAmt > 0.0 && abs(m - flashStep) < 0.5 && trackHit >= 0
      && mod(floor(flashMask / exp2(float(trackHit))), 2.0) > 0.5
      && fx >= 2.0 && fx < cell - 2.0 && fy >= 2.0 && fy < cell - 2.0) {
    base = mix(base, vec3(1.0), 0.55 * flashAmt);
    base = mix(base, laneColor(trackHit), 0.35 * flashAmt);
  }
  if (gutter) base = vec3(0.0);
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
} else if (px.y >= gridLimit && px.y < faceH && px.x >= 0.0 && px.x < w) {
  base = BG;
  float colW = max(1.0, floor((w - stripPadX * 2.0 - stripGapX) * 0.5));
  float rowH = max(1.0, floor((faceH - gridLimit - stripPadY * 2.0 - stripGapY) * 0.5));
  for (int lane = 0; lane < 4; lane++) {
    float lc = float(lane - (lane / 2) * 2);
    float lr = float(lane / 2);
    float x0 = stripPadX + lc * (colW + stripGapX);
    float y0 = gridLimit + stripPadY + lr * (rowH + stripGapY);
    vec3 lcCol = laneColor(lane);
    float gx = 5.0 * max(1.0, floor(labelW / 6.0));
    float gy = 7.0 * max(1.0, floor(labelW / 6.0));
    if (sturmianGlyphAt(3 + lane, vec2(px.x - x0, px.y - (y0 + floor((rowH - gy) * 0.5))), max(1.0, floor(labelW / 6.0))))
      base = lcCol;
    float by = y0 + floor((rowH - btnSize) * 0.5);
    float bx = x0 + labelW + innerGap;
    for (int t = 0; t < 4; t++) {
      if (px.x >= bx && px.x < bx + btnSize && px.y >= by && px.y < by + btnSize) {
        int bit = t < 3 ? lane * 3 + t : 12 + lane;
        bool on = mod(floor(mask / exp2(float(bit))), 2.0) > 0.5;
        base = on ? lcCol : vec3(24.0, 29.0, 40.0) / 255.0;
        bool edge = px.x < bx + 1.0 || px.y < by + 1.0
          || px.x >= bx + btnSize - 1.0 || px.y >= by + btnSize - 1.0;
        if (edge) base = on ? vec3(1.0) : vec3(151.0, 151.0, 255.0) / 255.0 * 0.35 + base * 0.65;
        else {
          float gs = max(1.0, floor(btnSize / 9.0));
          float gw = 5.0 * gs;
          float gh = 7.0 * gs;
          vec2 gp = vec2(px.x - (bx + floor((btnSize - gw) * 0.5)), px.y - (by + floor((btnSize - gh) * 0.5)));
          int code = t < 3 ? t : 6;
          if (sturmianGlyphAt(code, gp, gs)) base = on ? vec3(13.0, 16.0, 24.0) / 255.0 : vec3(199.0, 211.0, 229.0) / 255.0;
        }
      }
      bx += btnSize + innerGap;
    }
  }
}

// Playhead last, matching soundemote-dev page.js: fillRect(x,0,cs,H) at
// rgba(255,255,255,0.16), strokeRect 1px #fff around the column, then
// sounding cells fillRect(x+2,y+2,cs-4,cs-4) in TRACK_COLORS at alpha 0.85.
if (playing > 0.5 && px.y >= 0.0 && px.y < gridLimit) {
  float stepCol = padLeft + floor(playStep + 0.5);
  float x0 = ox + stepCol * cell;
  if (px.x >= x0 && px.x < x0 + cell) {
    base = mix(base, vec3(1.0), 0.16);
    bool frame = px.x < x0 + 1.0 || px.x >= x0 + cell - 1.0
      || px.y < 1.0 || px.y >= gridLimit - 1.0;
    if (frame) base = vec3(1.0);
    if (inGrid && inBar && trackHit >= 0
        && mod(floor(mask / exp2(float(12 + trackHit))), 2.0) < 0.5
        && mod(floor(mask / exp2(float(trackHit * 3) + tile)), 2.0) > 0.5
        && fx >= 2.0 && fx < cell - 2.0 && fy >= 2.0 && fy < cell - 2.0) {
      base = mix(base, laneColor(trackHit), 0.85);
    }
  }
}
out_color = vec4(base, 1.0);
