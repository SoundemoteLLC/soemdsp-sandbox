// Visual-only twin of native spectral_prism::field. No audio evaluation.
const NodeGraphSpectralPrismCurve = (() => {
  const unit = (x) => Math.max(0, Math.min(1, x));
  const smooth = (x) => { x = unit(x); return x*x*x*(x*(x*6-15)+10); };
  const hash = (x) => {
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  const random = (index, seed) => hash((index >>> 0) ^ hash(seed)) / 2147483647.5 - 1;
  function noise(grid,seed) {
    if (!Number.isFinite(grid)) return 0;
    const i=Math.floor(grid),t=smooth(grid-i);
    return random(i,seed)*(1-t)+random(i+1,seed)*t;
  }
  function evolutionSeed(index,seed) {
    return index===0?seed:hash(seed ^ hash((index>>>0)^0x9e3779b9));
  }
  function field(k, size, rate, p, shimmerOffset = 0, evolution = 0) {
    // Match native logarithm/division domains; invalid controls never emit NaN geometry.
    if (!(p.monoBassHz > 0 && p.smoothCents > 0 && rate > 0)) return 0;
    if (k <= 0 || k >= size/2) return 0;
    const hz = k*rate/size;
    const logBass = Math.log2(hz/p.monoBassHz);
    const bass = smooth(logBass+.5);
    const span = Math.log2(rate*.5/p.monoBassHz);
    const u = span > 0 ? unit(logBass/span) : 0;
    const tilt = p.tilt >= 0 ? 1-p.tilt+p.tilt*u : 1+p.tilt*u;
    const grid = 1200*Math.log2(hz/55)/p.smoothCents;
    if (!Number.isFinite(grid)) return 0;
    const seed = Math.floor(p.seed+.5) >>> 0;
    let position=shimmerOffset;
    if (p.shimmerQuantize > 0) {
      const amount=unit(p.shimmerQuantize),cell=Math.floor(position);
      position=amount>=1?Math.floor(position+.5)
        :cell+unit((position-cell-.5*amount)/(1-amount));
    }
    const base=noise(grid,seed),travel=noise(grid-position,seed);
    let pattern=base+p.shimmerDepth*(travel-base);
    if(p.evolveDepth){
      if(!Number.isFinite(evolution)||Math.abs(evolution)>4503599627370495)return 0;
      const index=Math.floor(evolution),duration=unit(p.evolveTransition??1);
      const blend=duration>0?smooth((evolution-index-(1-duration))/duration):0;
      const a=evolutionSeed(index,seed),b=evolutionSeed(index+1,seed);
      const fixed=noise(grid,a)*(1-blend)+noise(grid,b)*blend;
      const moving=noise(grid-position,a)*(1-blend)+noise(grid-position,b)*blend;
      const evolving=fixed+p.shimmerDepth*(moving-fixed);
      pattern+=p.evolveDepth*(evolving-pattern);
    }
    const driven=pattern*(1+p.fold);
    const wrapped=driven-4*Math.floor((driven+1)/4),folded=wrapped<=1?wrapped:2-wrapped;
    const value = p.spread*bass*tilt*folded*smooth(k/3)*smooth((size/2-k)/3);
    return Number.isFinite(value) ? value : 0;
  }
  function frequencyAt(t, lo, hi, curve) {
    if(curve<=0)return lo+t*(hi-lo);
    if(curve>=1)return lo*Math.pow(hi/lo,t);
    const logSpan=Math.log(hi/lo);
    let low=lo,high=hi;
    for(let i=0;i<24;i++){
      const f=(low+high)*.5;
      const x=(1-curve)*(f-lo)/(hi-lo)+curve*Math.log(f/lo)/logSpan;
      if(x<t)low=f;else high=f;
    }
    return (low+high)*.5;
  }
  function coefficients(q,centreDb) {
    const norm=1/Math.hypot(1,q);
    return {side:q*norm,centre:Math.pow(10,centreDb/20)*norm};
  }
  function points(W,H,rate,p,offset=0,evolution=0) {
    const lo=20,hi=Math.max(lo+1,rate/2),logSpan=Math.log(hi/lo);
    const curve=unit(p.frequencyCurve),size=p.fftSize;
    const at=t=>{
      const f=lo*Math.exp(logSpan*t),q=field(f*size/rate,size,rate,p,offset,evolution);
      const x=W*((1-curve)*(f-lo)/(hi-lo)+curve*t);
      const response=coefficients(q,p.centreDb);
      return {t,x,y:H*(.5-.43*response.side),centreY:H*(.5-.43*response.centre)};
    };
    // Seed in the field's own correlation domain, not on a moving pixel lattice.
    const regions=1200*Math.log2(hi/lo)/p.smoothCents;
    const steps=Math.min(16384,Math.max(16,Math.ceil(regions*8*(1+Math.abs(p.fold)))));
    const knots=Array.from({length:steps+1},(_,i)=>i/steps);
    // Stable colour boundaries also belong to the geometry.
    for(let i=1;i<32;i++)knots.push(Math.log(frequencyAt(i/32,lo,hi,curve)/lo)/logSpan);
    knots.sort((a,b)=>a-b);
    const out=[],centre=[];
    function append(a,b,depth=0){
      const dx=b.x-a.x;
      const m=at((a.t+b.t)*.5),l=at(a.t+(b.t-a.t)*.25),r=at(a.t+(b.t-a.t)*.75);
      const error=(v,key)=>{
        const dy=b[key]-a[key],lengthSquared=dx*dx+dy*dy;
        const u=unit(lengthSquared?((v.x-a.x)*dx+(v[key]-a[key])*dy)/lengthSquared:0);
        return Math.hypot(v.x-a.x-u*dx,v[key]-a[key]-u*dy);
      };
      if(depth<16&&Math.max(error(l,"y"),error(m,"y"),error(r,"y"),error(l,"centreY"),error(m,"centreY"),error(r,"centreY"))>.125){append(a,m,depth+1);append(m,b,depth+1);}
      else {out.push(b.x,b.y);centre.push(b.x,b.centreY);}
    }
    let a=at(knots[0]);out.push(a.x,a.y);centre.push(a.x,a.centreY);
    for(let i=1;i<knots.length;i++){
      const b=at(knots[i]);
      append(a,b);a=b;
    }
    return {side:new Float32Array(out),centre:new Float32Array(centre)};
  }
  return Object.freeze({ field, frequencyAt, coefficients, points });
})();
