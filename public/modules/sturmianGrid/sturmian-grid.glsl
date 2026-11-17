const vec3 BG = vec3(13.0, 16.0, 24.0) / 255.0;

vec3 laneColor(int lane) {
  // soundemote-dev TRACK_COLORS: #ffd27a, #7af0c8, #9ad0ff, #ff9ad6
  if (lane == 0) return vec3(255.0, 210.0, 122.0) / 255.0;
  if (lane == 1) return vec3(122.0, 240.0, 200.0) / 255.0;
  if (lane == 2) return vec3(154.0, 208.0, 255.0) / 255.0;
  return vec3(255.0, 154.0, 214.0) / 255.0;
}

// 5x7 glyphs: 0-2, K,S,H,M, 3-9, R,E,T, F. Rows are 5 bits, MSB is the left pixel.
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
  if (code == 7) { // 3
    if (row == 0 || row == 6) return 30;
    if (row == 3) return 14;
    return 1;
  }
  if (code == 8) { // 4
    if (row == 3) return 31;
    if (row <= 2) return 18;
    return 2;
  }
  if (code == 9) { // 5
    if (row == 0) return 31;
    if (row == 1 || row == 2) return 16;
    if (row == 3 || row == 6) return 30;
    return 1;
  }
  if (code == 10) { // 6
    if (row == 0 || row == 6) return 14;
    if (row == 1 || row == 2) return 16;
    if (row == 3) return 30;
    return 17;
  }
  if (code == 11) { // 7
    if (row == 0) return 31;
    if (row == 1) return 1;
    if (row == 2) return 2;
    return 4;
  }
  if (code == 12) { // 8
    if (row == 0 || row == 3 || row == 6) return 14;
    return 17;
  }
  if (code == 13) { // 9
    if (row == 0 || row == 6) return 14;
    if (row == 1 || row == 2) return 17;
    if (row == 3) return 15;
    return 1;
  }
  if (code == 14) { // R
    if (row == 0 || row == 3) return 30;
    if (row == 1 || row == 2) return 17;
    if (row == 4) return 20;
    if (row == 5) return 18;
    return 17;
  }
  if (code == 15) { // E
    if (row == 0 || row == 6) return 31;
    if (row == 3) return 30;
    return 16;
  }
  if (code == 16) { // T
    if (row == 0) return 31;
    return 4;
  }
  if (code == 19) { // F
    if (row == 0) return 31;
    if (row == 3) return 30;
    return 16;
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

int sturmianDigitGlyph(int d) {
  if (d <= 2) return d;
  if (d >= 3 && d <= 9) return 4 + d;
  return 0;
}

bool sturmianGlyphSpan(int c0, int c1, int c2, int c3, int c4, int count, vec2 p, float scale, float gap) {
  if (scale < 0.5 || count <= 0) return false;
  float advance = 5.0 * scale + gap;
  float width = float(count) * 5.0 * scale + float(count > 1 ? count - 1 : 0) * gap;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= width || p.y >= 7.0 * scale) return false;
  int i = int(floor(p.x / advance));
  if (i < 0 || i >= count) return false;
  int code = c0;
  if (i == 1) code = c1;
  else if (i == 2) code = c2;
  else if (i == 3) code = c3;
  else if (i == 4) code = c4;
  return sturmianGlyphAt(code, vec2(p.x - float(i) * advance, p.y), scale);
}

// Largest whole-pixel glyph scale that fits needW x needH into avail. 0 if even 1x overflows.
float sturmianFitScale(float availW, float availH, float needW, float needH) {
  if (needW < 1.0 || needH < 1.0 || availW < 1.0 || availH < 1.0) return 0.0;
  return max(0.0, min(floor(availW / needW), floor(availH / needH)));
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
bool gutter = false;
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
  // 1-texel gutters when the cell is at least 16 screen pixels. Below that
  // the 1px stroke is relatively thick, so squares touch. Track-span and
  // playhead frames stay 1px with their Display Settings alphas.
  float colStartDev = floor(col * cell * pr + 1e-4);
  float rowStartDev = floor(row * cell * pr + 1e-4);
  float gridEndX = floor(gridW * pr + 1e-4);
  float gridEndY = floor(gridSpanH * pr + 1e-4);
  gutter = cell >= 16.0 && (devX < colStartDev + 1.0 || devY < rowStartDev + 1.0
    || devX >= gridEndX - 1.0 || devY >= gridEndY - 1.0);
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
    if (frame) base = mix(base, tc, clamp(trackStrokeAlpha, 0.0, 1.0));
  }
} else if (px.y >= gridLimit && px.y < faceH && px.x >= 0.0 && px.x < w) {
  base = BG;
  float colW = max(1.0, floor((w - stripPadX * 2.0 - stripGapX - resetGap - resetCellSize) * 0.5));
  float rowH = max(1.0, floor((faceH - gridLimit - stripPadY * 2.0 - stripGapY) * 0.5));
  for (int lane = 0; lane < 4; lane++) {
    float lc = float(lane - (lane / 2) * 2);
    float lr = float(lane / 2);
    float x0 = stripPadX + lc * (colW + stripGapX);
    float y0 = gridLimit + stripPadY + lr * (rowH + stripGapY);
    vec3 lcCol = laneColor(lane);
    // Largest whole-pixel scale that fits the 5x7 letter in the label slot.
    float lgs = sturmianFitScale(labelW - 2.0, rowH - 2.0, 5.0, 7.0);
    if (lgs < 1.0) lgs = sturmianFitScale(labelW, rowH, 5.0, 7.0);
    if (lgs >= 1.0) {
      float lgw = 5.0 * lgs;
      float lgh = 7.0 * lgs;
      if (sturmianGlyphAt(3 + lane, vec2(px.x - (x0 + floor((labelW - lgw) * 0.5)), px.y - (y0 + floor((rowH - lgh) * 0.5))), lgs))
        base = lcCol;
    }
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
          float inner = btnSize - 2.0;
          float gs = sturmianFitScale(inner - 2.0, inner - 2.0, 5.0, 7.0);
          if (gs < 1.0) gs = sturmianFitScale(inner, inner, 5.0, 7.0);
          if (gs >= 1.0) {
            float gw = 5.0 * gs;
            float gh = 7.0 * gs;
            vec2 gp = vec2(px.x - (bx + floor((btnSize - gw) * 0.5)), px.y - (by + floor((btnSize - gh) * 0.5)));
            int code = t < 3 ? t : 6;
            if (sturmianGlyphAt(code, gp, gs)) base = on ? vec3(13.0, 16.0, 24.0) / 255.0 : vec3(199.0, 211.0, 229.0) / 255.0;
          }
        }
      }
      bx += btnSize + innerGap;
    }
  }
  float rx = resetCellX;
  float ry = resetCellY;
  float rs = resetCellSize;
  if (rs > 0.5 && px.x >= rx && px.x < rx + rs && px.y >= ry && px.y < ry + rs) {
    base = vec3(24.0, 29.0, 40.0) / 255.0;
    bool edge = px.x < rx + 1.0 || px.y < ry + 1.0
      || px.x >= rx + rs - 1.0 || px.y >= ry + rs - 1.0;
    if (edge) base = vec3(151.0, 151.0, 255.0) / 255.0 * 0.35 + base * 0.65;
    else {
      int c0 = 0;
      int c1 = 19;
      int c2 = 19;
      int c3 = 0;
      int c4 = 0;
      int n = 3;
      if (reset >= 0.5) {
        int v = int(floor(reset + 0.5));
        if (v < 0) v = 0;
        if (v > 99999) v = 99999;
        int place = 1;
        if (v >= 10) place = 10;
        if (v >= 100) place = 100;
        if (v >= 1000) place = 1000;
        if (v >= 10000) place = 10000;
        n = 0;
        c0 = 0; c1 = 0; c2 = 0; c3 = 0; c4 = 0;
        int left = v;
        for (int i = 0; i < 5; i++) {
          if (place < 1) break;
          int d = left / place;
          left = left - d * place;
          place = place / 10;
          int code = sturmianDigitGlyph(d);
          if (n == 0) c0 = code;
          else if (n == 1) c1 = code;
          else if (n == 2) c2 = code;
          else if (n == 3) c3 = code;
          else c4 = code;
          n += 1;
        }
      }
      // Fit RESET+value, then "R"+value, then value only. Prefer 1px inner
      // padding and letter gaps; if even 1x overflows, hide rather than clip.
      float gs = 0.0;
      float gap = 0.0;
      float pad = 0.0;
      int labelCount = 0;
      float valG = float(n) * 5.0 + float(n > 1 ? n - 1 : 0);
      float valT = float(n) * 5.0;
      for (int pass = 0; pass < 2; pass++) {
        if (gs >= 1.0) break;
        float p = pass == 0 ? 1.0 : 0.0;
        float availW = rs - 2.0 - 2.0 * p;
        float availH = rs - 2.0 - 2.0 * p;
        float s = sturmianFitScale(availW, availH, max(29.0, valG), 15.0);
        if (s >= 1.0) { gs = s; gap = s; pad = p; labelCount = 5; break; }
        s = sturmianFitScale(availW, availH, max(25.0, valT), 15.0);
        if (s >= 1.0) { gs = s; gap = 0.0; pad = p; labelCount = 5; break; }
        s = sturmianFitScale(availW, availH, max(5.0, valG), 15.0);
        if (s >= 1.0) { gs = s; gap = s; pad = p; labelCount = 1; break; }
        s = sturmianFitScale(availW, availH, max(5.0, valT), 15.0);
        if (s >= 1.0) { gs = s; gap = 0.0; pad = p; labelCount = 1; break; }
        s = sturmianFitScale(availW, availH, max(5.0, valG), 7.0);
        if (s >= 1.0) { gs = s; gap = s; pad = p; labelCount = 0; break; }
        s = sturmianFitScale(availW, availH, max(1.0, valT), 7.0);
        if (s >= 1.0) { gs = s; gap = 0.0; pad = p; labelCount = 0; break; }
      }
      if (gs >= 1.0) {
        vec3 ink = vec3(199.0, 211.0, 229.0) / 255.0;
        float availW = rs - 2.0 - 2.0 * pad;
        float availH = rs - 2.0 - 2.0 * pad;
        float boxX = rx + 1.0 + pad;
        float boxY = ry + 1.0 + pad;
        float gh = 7.0 * gs;
        float vgap = labelCount > 0 ? max(1.0, gs) : 0.0;
        float lw = labelCount > 0
          ? float(labelCount) * 5.0 * gs + float(labelCount > 1 ? labelCount - 1 : 0) * gap
          : 0.0;
        float nw = float(n) * 5.0 * gs + float(n > 1 ? n - 1 : 0) * gap;
        float blockH = labelCount > 0 ? gh + vgap + gh : gh;
        float oy = boxY + floor((availH - blockH) * 0.5);
        if (labelCount > 0) {
          int l0 = 14;
          int l1 = 15;
          int l2 = 4;
          int l3 = 15;
          int l4 = 16;
          float lx = boxX + floor((availW - lw) * 0.5);
          if (sturmianGlyphSpan(l0, l1, l2, l3, l4, labelCount, vec2(px.x - lx, px.y - oy), gs, gap)) base = ink;
        }
        float nx = boxX + floor((availW - nw) * 0.5);
        float ny = oy + (labelCount > 0 ? gh + vgap : 0.0);
        if (sturmianGlyphSpan(c0, c1, c2, c3, c4, n, vec2(px.x - nx, px.y - ny), gs, gap)) base = ink;
      }
    }
  }
}

// Playhead wash stays (16% white column). Hit flash fills the triggered
// square with its track color (no inset / inner stroke). Black gutters stay
// when the cell is at least 16px; below that, squares touch.
// 1px track-span and playhead strokes use Display Settings alphas (default 1).
if (playing > 0.5 && px.y >= 0.0 && px.y < gridLimit) {
  float stepCol = padLeft + floor(playStep + 0.5);
  float x0 = ox + stepCol * cell;
  if (px.x >= x0 && px.x < x0 + cell) {
    base = mix(base, vec3(1.0), 0.16);
  }
}
if (inGrid && !gutter && flashAmt > 0.0 && abs(m - flashStep) < 0.5 && trackHit >= 0
    && mod(floor(flashMask / exp2(float(trackHit))), 2.0) > 0.5) {
  base = mix(base, laneColor(trackHit), flashAmt);
}
if (playing > 0.5 && px.y >= 0.0 && px.y < gridLimit) {
  float stepCol = padLeft + floor(playStep + 0.5);
  float x0 = ox + stepCol * cell;
  if (px.x >= x0 && px.x < x0 + cell) {
    bool frame = px.x < x0 + 1.0 || px.x >= x0 + cell - 1.0
      || px.y < 1.0 || px.y >= gridLimit - 1.0;
    if (frame) base = mix(base, vec3(1.0), clamp(playheadStrokeAlpha, 0.0, 1.0));
  }
}
out_color = vec4(base, 1.0);
