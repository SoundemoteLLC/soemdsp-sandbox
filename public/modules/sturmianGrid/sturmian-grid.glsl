const vec3 BG = vec3(13.0, 16.0, 24.0) / 255.0;
const vec3 PANEL = vec3(24.0, 29.0, 40.0) / 255.0;
const vec3 INK = vec3(199.0, 211.0, 229.0) / 255.0;
const vec3 MUTED = vec3(111.0, 126.0, 148.0) / 255.0;
const vec3 VIOLET = vec3(151.0, 151.0, 255.0) / 255.0;

vec3 laneColor(int lane) {
  if (lane == 0) return vec3(1.0, 0.82, 0.48);
  if (lane == 1) return vec3(0.48, 0.94, 0.78);
  if (lane == 2) return vec3(0.60, 0.82, 1.0);
  return vec3(1.0, 0.56, 0.80);
}

int fontRow(int c, int r) {
  if (c == 65) { if (r==0||r==3) return 14; if (r==1||r==2) return 17; if (r==4||r==5||r==6) return 17; }
  if (c == 66) { if (r==0||r==3||r==6) return 30; if (r==1||r==2||r==4||r==5) return 17; }
  if (c == 67) { if (r==0||r==6) return 14; if (r==1||r==2||r==3||r==4||r==5) return 16; }
  if (c == 68) { if (r==0||r==6) return 28; if (r==1||r==2||r==3||r==4||r==5) return 18; }
  if (c == 69) { if (r==0||r==3||r==6) return 31; return 16; }
  if (c == 70) { if (r==0||r==3) return 31; return 16; }
  if (c == 71) { if (r==0||r==6) return 14; if (r==1||r==2) return 16; if (r==3) return 23; if (r==4||r==5) return 17; }
  if (c == 72) { if (r==3) return 31; return 17; }
  if (c == 73) { if (r==0||r==6) return 31; return 4; }
  if (c == 74) { if (r==0) return 7; if (r==1||r==2||r==3||r==4) return 2; if (r==5) return 18; if (r==6) return 12; }
  if (c == 75) { if (r==0||r==1||r==5||r==6) return 17; if (r==2||r==4) return 18; if (r==3) return 20; }
  if (c == 76) { if (r==6) return 31; return 16; }
  if (c == 77) { if (r==0||r==1||r==2) return 17; if (r==3) return 21; if (r==4) return 21; if (r==5) return 21; if (r==6) return 17; }
  if (c == 78) { if (r==0) return 17; if (r==1) return 25; if (r==2) return 21; if (r==3) return 19; if (r==4) return 17; if (r==5) return 17; if (r==6) return 17; }
  if (c == 79) { if (r==0||r==6) return 14; return 17; }
  if (c == 80) { if (r==0||r==3) return 30; if (r==1||r==2) return 17; return 16; }
  if (c == 82) { if (r==0||r==3) return 30; if (r==1||r==2) return 17; if (r==4) return 20; if (r==5) return 18; if (r==6) return 17; }
  if (c == 83) { if (r==0||r==3||r==6) return 15; if (r==1||r==2) return 16; return 1; }
  if (c == 84) { if (r==0) return 31; return 4; }
  if (c == 85) { if (r==6) return 14; return 17; }
  if (c == 86) { if (r<4) return 17; if (r==4) return 17; if (r==5) return 10; return 4; }
  if (c == 87) { if (r==0||r==1) return 17; if (r==2||r==3) return 21; if (r==4) return 21; if (r==5) return 21; if (r==6) return 10; }
  if (c == 89) { if (r<3) return 17; if (r==3) return 10; return 4; }
  if (c == 48) { if (r==0||r==6) return 14; if (r==1||r==5) return 17; if (r==2||r==4) return 19; return 21; }
  if (c == 49) { if (r==0) return 4; if (r==1) return 12; return 4; }
  if (c == 50) { if (r==0) return 14; if (r==1) return 17; if (r==2) return 1; if (r==3) return 2; if (r==4) return 4; if (r==5) return 8; return 31; }
  if (c == 51) { if (r==0||r==3||r==6) return 30; if (r==1||r==2||r==4||r==5) return 1; }
  if (c == 52) { if (r==0||r==1||r==2) return 18; if (r==3) return 31; return 2; }
  if (c == 53) { if (r==0||r==3||r==6) return 31; if (r==1||r==2) return 16; return 1; }
  if (c == 54) { if (r==0||r==6) return 14; if (r==1||r==2) return 16; if (r==3) return 30; if (r==4||r==5) return 17; }
  if (c == 55) { if (r==0) return 31; if (r==1) return 1; if (r==2) return 2; if (r==3) return 4; if (r==4) return 8; if (r==5||r==6) return 8; }
  if (c == 56) { if (r==0||r==3||r==6) return 14; if (r==1||r==2||r==4||r==5) return 17; }
  if (c == 57) { if (r==0) return 14; if (r==1||r==2) return 17; if (r==3) return 15; if (r==4||r==5) return 1; if (r==6) return 14; }
  if (c == 46) return r == 6 ? 4 : 0;
  if (c == 45) return r == 3 ? 14 : 0;
  if (c == 47) { if (r==0) return 1; if (r==1) return 2; if (r==2) return 2; if (r==3) return 4; if (r==4) return 8; if (r==5) return 8; return 16; }
  if (c == 58) return (r == 2 || r == 5) ? 4 : 0;
  if (c == 32) return 0;
  return 0;
}

float textGlyph(vec2 p, int code, float scale) {
  vec2 q = p / scale;
  int x = int(floor(q.x));
  int y = int(floor(q.y));
  if (x < 0 || x >= 5 || y < 0 || y >= 7) return 0.0;
  return float((fontRow(code, y) >> (4 - x)) & 1);
}

int labelChar(int label, int index) {
  // Labels are compacted to fit the two-column shader control bank.
  if (label==0) { if(index==0)return 65; if(index==1)return 76; if(index==2)return 80; if(index==3)return 72; }
  if (label==1) { if(index==0)return 66; if(index==1)return 69; if(index==2)return 84; if(index==3)return 65; }
  if (label==2) { if(index==0)return 82; if(index==1)return 72; if(index==2)return 79; }
  if (label==3) { if(index==0)return 68; if(index==1)return 82; if(index==2)return 73; if(index==3)return 70; if(index==4)return 84; }
  if (label==4) { if(index==0)return 82; if(index==1)return 65; if(index==2)return 84; if(index==3)return 69; }
  if (label==5) { if(index==0)return 83; if(index==1)return 84; if(index==2)return 69; if(index==3)return 80; if(index==4)return 83; }
  if (label==6) { if(index==0)return 82; if(index==1)return 69; if(index==2)return 83; if(index==3)return 69; if(index==4)return 84; }
  if (label==7) { if(index==0)return 83; if(index==1)return 80; if(index==2)return 82; if(index==3)return 69; if(index==4)return 65; if(index==5)return 68; }
  if (label==8) { if(index==0)return 87; if(index==1)return 65; if(index==2)return 76; if(index==3)return 75; }
  if (label==9) { if(index==0)return 83; if(index==1)return 78; if(index==2)return 65; if(index==3)return 80; }
  if (label==10) { if(index==0)return 86; if(index==1)return 73; if(index==2)return 69; if(index==3)return 87; }
  if (label==11) { if(index==0)return 67; if(index==1)return 69; if(index==2)return 76; if(index==3)return 76; }
  if (label==12) { if(index==0)return 83; if(index==1)return 84; if(index==2)return 85; if(index==3)return 82; if(index==4)return 77; if(index==5)return 73; if(index==6)return 65; if(index==7)return 78; }
  if (label==13) { if(index==0)return 80; if(index==1)return 76; if(index==2)return 65; if(index==3)return 78; if(index==4)return 69; }
  if (label==14) { if(index==0)return 66; if(index==1)return 73; if(index==2)return 78; if(index==3)return 65; if(index==4)return 82; if(index==5)return 89; }
  if (label==15) { if(index==0)return 76; if(index==1)return 69; if(index==2)return 86; if(index==3)return 69; if(index==4)return 76; }
  if (label==16) { if(index==0)return 75; if(index==1)return 73; if(index==2)return 67; if(index==3)return 75; }
  if (label==17) { if(index==0)return 83; if(index==1)return 78; if(index==2)return 65; if(index==3)return 82; if(index==4)return 69; }
  if (label==18) { if(index==0)return 72; if(index==1)return 65; if(index==2)return 84; }
  if (label==19) { if(index==0)return 77; if(index==1)return 69; if(index==2)return 76; if(index==3)return 79; if(index==4)return 68; if(index==5)return 89; }
  if (label==20) { if(index==0)return 84; if(index==1)return 82; if(index==2)return 73; if(index==3)return 66; }
  if (label==21) { if(index==0)return 82; if(index==1)return 79; if(index==2)return 79; if(index==3)return 84; }
  if (label==22) { if(index==0)return 71; if(index==1)return 79; if(index==2)return 76; if(index==3)return 68; }
  if (label==23) { if(index==0)return 78; if(index==1)return 69; if(index==2)return 65; if(index==3)return 82; }
  if (label==24) { if(index==0)return 77; if(index==1)return 79; if(index==2)return 73; if(index==3)return 82; if(index==4)return 69; }
  if (label==25) { if(index==0)return 69; if(index==1)return 85; if(index==2)return 67; if(index==3)return 76; if(index==4)return 73; if(index==5)return 68; }
  return 32;
}

int labelLength(int label) {
  if(label==0||label==1||label==4||label==10||label==11)return 4;
  if(label==2)return 3;
  if(label==3||label==5||label==6||label==8||label==9)return 5;
  if(label==12)return 8;
  if(label==13||label==15)return 5;
  if(label==14)return 6;
  if(label==16||label==20||label==21||label==22||label==23)return 4;
  if(label==17||label==24)return 5;
  if(label==18)return 3;
  if(label==19||label==25)return 6;
  return 6;
}

float drawLabel(vec2 p, int label, float scale) {
  float ink = 0.0;
  int n = labelLength(label);
  for (int i=0;i<9;i++) {
    if(i<n) ink=max(ink,textGlyph(p-vec2(float(i)*6.0*scale,0.0),labelChar(label,i),scale));
  }
  return ink;
}

float drawNumber(vec2 p, float value, int precisionDigits, float scale) {
  float ink=0.0;
  bool negative=value<0.0;
  float v=abs(value);
  int whole=int(floor(v));
  int digits=1;
  if(whole>=10)digits=2; if(whole>=100)digits=3; if(whole>=1000)digits=4; if(whole>=10000)digits=5; if(whole>=100000)digits=6;
  int decimals=int(floor(fract(v)*1000.0+0.5));
  for(int i=0;i<9;i++){
    int code=32;
    int pos=i-int(negative);
    if(negative&&i==0)code=45;
    else if(pos>=0&&pos<digits){int div=1; for(int j=0;j<6;j++){if(j<digits-pos-1)div*=10;} code=48+(whole/div)%10;}
    else if(pos==digits && precisionDigits>0)code=46;
    else if(pos>digits && pos<=digits+precisionDigits){int idx=pos-digits-1; int div=idx==0?100:(idx==1?10:1); code=48+(decimals/div)%10;}
    if(code!=32)ink=max(ink,textGlyph(p-vec2(float(i)*6.0*scale,0.0),code,scale));
  }
  return ink;
}

// --- MAIN ---
vec2 px = vec2(uv.x * resolution.x, (1.0 - uv.y) * resolution.y);
float w = resolution.x;
float h = resolution.y;
vec3 color = BG;
float mask = floor(stepPattern + 0.5);
float cellWidth = max(2.0, cell);
float cellHeight = cellWidth;
float gridX = px.x;
float gridY = px.y;
float col = floor(gridX / cellWidth);
float row = floor(gridY / cellHeight);
if (px.y < h * STURM_MAP_TOP) {
  float n = row - 2.0 + playBar * walk;
  float aa = alpha; float bb = beta;
  if (snap > 0.5) { aa = floor(aa * steps + 0.5) / steps; bb = floor(bb * steps + 0.5) / steps; }
  float z = fract(col * aa + n * bb + rho + drift * time);
  float tile = z >= 1.0-aa ? 1.0 : (z >= 1.0-aa-bb ? 2.0 : 0.0);
  vec3 base = vec3(16.0,19.0,28.0)/255.0;
  if(view < 0.5) base = tile < 0.5 ? BG : (tile < 1.5 ? vec3(150.0,151.0,255.0)/255.0 : vec3(255.0,42.0,101.0)/255.0);
  else if(view < 1.5) base = tile == 1.0 ? vec3(255.0,42.0,101.0)/255.0 : vec3(26.0,30.0,40.0)/255.0;
  else base = mix(vec3(18.0,20.0,30.0)/255.0, vec3(255.0,42.0,101.0)/255.0, z);
  // Dim columns outside the sounding bar, like soundemote-dev.
  if (col < -0.5 || col >= steps) base *= 0.55;
  // Grid lines match soundemote-dev: 1 CSS-pixel stroke centered on
  // c * cell + 0.5 (the first CSS pixel of each cell, plus the closing line
  // at the next boundary). Adjacent cells share that one pixel; nothing is
  // drawn on the right/bottom interior of a cell. Snapped to whole device
  // pixels via pixelRatio so the band is exactly 1 CSS px at zoom 1.
  float pr = max(1.0, pixelRatio);
  float devX = floor(gridX * pr + 1e-4);
  float devY = floor(gridY * pr + 1e-4);
  float cellDev = cellWidth * pr;
  float gridH = h * STURM_MAP_TOP;
  float fx = mod(gridX, cellWidth);
  float fy = mod(gridY, cellHeight);
  if (cellWidth >= 8.0 && (mod(devX, cellDev) < pr || (gridY < gridH && mod(devY, cellDev) < pr)))
    base = mix(base, vec3(0.0), 0.45);
  // Dashed bar bounds at 0 and steps (1px at +0.5, like soundemote-dev).
  if (((devX >= 0.0 && devX < pr) || (devX >= steps * cellDev && devX < steps * cellDev + pr))
      && mod(devY, 8.0 * pr) < 4.0 * pr)
    base = mix(base, vec3(1.0), 0.35);
  // One 2px stroke around the whole sounding-bar track row (strokeRect
  // inset by 1 with lineWidth 2), not a per-cell inset on both sides.
  for (int track = 0; track < 4; track++) {
    float trackN = playBar * walk + float(track) * spread;
    if (abs(n - trackN) > 0.5 || col < -0.5 || col >= steps) continue;
    bool muted = mod(floor(mask / exp2(float(12 + track))), 2.0) > 0.5;
    vec3 tc = muted ? vec3(0.55) : laneColor(track);
    bool edge = (devX >= 0.0 && devX < 2.0 * pr)
      || (devX >= steps * cellDev - 2.0 * pr && devX < steps * cellDev)
      || mod(devY, cellDev) < 2.0 * pr
      || mod(devY, cellDev) >= cellDev - 2.0 * pr;
    if (edge) base = mix(base, tc, 0.85);
  }
  // Playhead: pale full-height column, 1px white outline inside the column
  // (strokeRect(x+0.5, 0.5, cs-1, H-1)), inset hits (x+2, y+2, cs-4, cs-4).
  if (playing > 0.5 && abs(col - playStep) < 0.5) {
    base = mix(base, vec3(1.0), 0.16);
    if (mod(devX, cellDev) < pr || mod(devX, cellDev) >= cellDev - pr
        || devY < pr || devY >= floor(gridH * pr + 1e-4) - pr) base = vec3(1.0);
    for (int track = 0; track < 4; track++) {
      float trackN = playBar * walk + float(track) * spread;
      if (abs(n - trackN) > 0.5) continue;
      if (mod(floor(mask / exp2(float(12 + track))), 2.0) > 0.5) continue;
      if (mod(floor(mask / exp2(float(track * 3) + tile)), 2.0) < 0.5) continue;
      if (fx >= 2.0 && fx < cellWidth - 2.0 && fy >= 2.0 && fy < cellHeight - 2.0)
        base = mix(laneColor(track), base, 0.15);
    }
  }
  color=base;
}
// Four color-coded lanes and their 0/1/2/mute shader buttons.
float mapStart = h * STURM_MAP_TOP;
float mapRowH = h * STURM_MAP_ROW;
float mapLabelW = w * STURM_MAP_LABEL;
float mapCellW = (w - mapLabelW - STURM_MAP_PAD) / 4.0;
int lane = int(floor((px.y-mapStart)/mapRowH));
int mapCol = int(floor((px.x-mapLabelW)/mapCellW));
if(px.y>=mapStart && px.y<mapStart+4.0*mapRowH && px.x<mapLabelW){
  vec3 lc=laneColor(lane);
  if(drawLabel(px-vec2(7.0,mapStart+float(lane)*mapRowH+mapRowH*0.5-4.5),16+lane,1.25)>0.5) color=lc;
}
if(px.y>=mapStart && px.y<mapStart+4.0*mapRowH && px.x>=mapLabelW && px.x<w-3.0 && mapCol>=0 && mapCol<4){
  float bitValue=mod(floor(mask/exp2(float(mapCol==3?12+lane:lane*3+mapCol))),2.0);
  vec2 q=vec2(mod(px.x-mapLabelW,mapCellW),mod(px.y-mapStart,mapRowH));
  bool edge=q.x<1.0||q.x>mapCellW-1.0||q.y<1.0||q.y>mapRowH-1.0;
  vec3 lc=laneColor(lane);
  color=bitValue>0.5?mix(PANEL,lc,0.35):PANEL;
  if(edge)color=mix(color,VIOLET,0.45);
  int glyph=mapCol==0?48:(mapCol==1?49:(mapCol==2?50:77));
  if(textGlyph(q-vec2(mapCellW*0.5-3.0,mapRowH*0.5-4.5),glyph,1.25)>0.5)color=bitValue>0.5?vec3(1.0):INK;
}
// Twelve parameter sliders: six rows, two columns, drawn entirely in GLSL.
float controlStart=h*STURM_CTRL_TOP;
float controlEnd=h*STURM_CTRL_BOTTOM;
float rowH=(controlEnd-controlStart)/6.0;
int controlRow=int(floor((px.y-controlStart)/rowH));
int controlCol=px.x<w*0.5?0:1;
int paramIndex=controlRow*2+controlCol;
float itemLeft=float(controlCol)*w*0.5;
float barLeft=itemLeft+12.0;
float barRight=itemLeft+w*0.5-12.0;
if(px.y>=controlStart&&px.y<controlEnd&&paramIndex>=0&&paramIndex<12){
  float rowY=controlStart+float(controlRow)*rowH;
  if(drawLabel(px-vec2(itemLeft+5.0,rowY+2.0),paramIndex,1.8)>0.5)color=INK;
  float vals[12]=float[12](alpha,beta,rho,drift,rate,steps,reset,spread,walk,snap,view,cell);
  float norm;
  if(paramIndex==STURM_LOG_PARAM)norm=log(max(STURM_LO[paramIndex],vals[paramIndex])/STURM_LO[paramIndex])/log(STURM_HI[paramIndex]/STURM_LO[paramIndex]);
  else norm=(vals[paramIndex]-STURM_LO[paramIndex])/max(0.0001,STURM_HI[paramIndex]-STURM_LO[paramIndex]);
  float by=rowY+rowH-7.0;
  if(abs(px.y-by)<5.0&&px.x>=barLeft&&px.x<=barRight){
    color=vec3(55.0,62.0,80.0)/255.0;
    if(px.x<barLeft+(barRight-barLeft)*clamp(norm,0.0,1.0))color=VIOLET;
  }
  if(px.x>itemLeft+w*0.25){
    if(paramIndex==10){int modeLabel=13+int(floor(view+0.5)); if(drawLabel(px-vec2(itemLeft+w*0.25,rowY+2.0),modeLabel,1.8)>0.5)color=INK;}
    else if(drawNumber(px-vec2(itemLeft+w*0.25,rowY+2.0),vals[paramIndex],paramIndex<5?2:0,1.8)>0.5)color=INK;
  }
}
// Preset pills.
float presetY=h*STURM_PRESET_TOP;
float presetW=w/float(STURM_PRESET_COUNT);
if(px.y>=presetY&&px.y<h&&px.x<w){
  int p=int(floor(px.x/presetW));
  vec2 q=vec2(mod(px.x,presetW),px.y-presetY);
  bool edge=q.x<1.0||q.x>presetW-1.0||q.y<1.0||px.y>h-1.0;
  color=PANEL;
  if(edge)color=vec3(67.0,75.0,98.0)/255.0;
  int lab=20+p;
  if(drawLabel(q-vec2(presetW*0.5-float(labelLength(lab))*3.6,(h-presetY)*0.5-4.5),lab,1.2)>0.5)color=INK;
}
out_color=vec4(color,1.0);
