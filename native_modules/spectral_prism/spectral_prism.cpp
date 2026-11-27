// soemdsp-native-module: spectral_prism
// soemdsp-native-label: Spectral Prism
// soemdsp-native-target: spectralPrism
// soemdsp-native-kind: effect
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int maximum = 16384, bins = maximum / 2 + 1, capacity = 64;
constexpr double pi = 3.14159265358979323846;
soemdsp::fft::Radix2<512> f512{};
soemdsp::fft::Radix2<1024> f1024{};
soemdsp::fft::Radix2<2048> f2048{};
soemdsp::fft::Radix2<4096> f4096{};
soemdsp::fft::Radix2<8192> f8192{};
soemdsp::fft::Radix2<maximum> f16384{};
bool validSize(int n) { return n == 512 || n == 1024 || n == 2048 || n == 4096 || n == 8192 || n == maximum; }
void prepare() { f512.ensure(); f1024.ensure(); f2048.ensure(); f4096.ensure(); f8192.ensure(); f16384.ensure(); }
void transform(int n, float* re, float* im, bool inverse) {
  switch (n) {
    case 512: f512.transform(re, im, inverse); break;
    case 1024: f1024.transform(re, im, inverse); break;
    case 2048: f2048.transform(re, im, inverse); break;
    case 4096: f4096.transform(re, im, inverse); break;
    case 8192: f8192.transform(re, im, inverse); break;
    default: f16384.transform(re, im, inverse); break;
  }
}
double unit(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
double smooth(double x) { x = unit(x); return x*x*x*(x*(x*6-15)+10); }
unsigned hash(unsigned x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; return x ^ (x >> 16); }
double randomAt(double index, unsigned seed) {
  // Reduce to the uint32 hash domain before conversion (negative grid positions are valid).
  const double wrapped=index-__builtin_floor(index/4294967296.0)*4294967296.0;
  if(!(wrapped>=0&&wrapped<4294967296.0))return __builtin_nan("");
  const unsigned i = (unsigned)wrapped;
  return hash(i ^ hash(seed)) / 2147483647.5 - 1;
}
struct Settings {
  double rate = 48000, spread = 1, bass = 120, tilt = 0, smoothCents = 300;
  double phase = .25, shimmerSpeed = 0, shimmerDepth = .5, quantize = 0;
  double centre = 1, fold = 0;
  double evolveRate = 1, evolveDepth = 0, evolveTransition = 1;
  unsigned seed = 1;
};
double noise(double grid, unsigned seed) {
  // Extreme finite controls can overflow the log-grid calculation; never cast infinity to uint32.
  if(!__builtin_isfinite(grid)) return __builtin_nan("");
  const double index=__builtin_floor(grid),t=smooth(grid-index);
  return randomAt(index,seed)*(1-t)+randomAt(index+1,seed)*t;
}
// Shared with the visual-only twin: one offset unit is one Smooth correlation
// length. Only the seeded field travels; bass/tilt/edge envelopes stay in place.
unsigned evolutionSeed(double index,unsigned seed) {
  if(index==0)return seed;
  const double wrapped=index-__builtin_floor(index/4294967296.0)*4294967296.0;
  return hash(seed ^ hash((unsigned)wrapped ^ 0x9e3779b9u));
}
double field(int k, int size, const Settings& s, double shimmerOffset,double evolution=0) {
  if (k <= 0 || k >= size/2) return 0;
  const double hz = (double)k*s.rate/size;
  const double logBass = soemdsp_maths::dsp_ln(hz/s.bass) / .6931471805599453;
  const double bass = smooth(logBass + .5);
  const double span = soemdsp_maths::dsp_ln((s.rate*.5)/s.bass) / .6931471805599453;
  const double u = span > 0 ? unit(logBass/span) : 0;
  const double tilt = s.tilt >= 0 ? 1-s.tilt+s.tilt*u : 1+s.tilt*u;
  const double grid = 1200*soemdsp_maths::dsp_ln(hz/55)/.6931471805599453/s.smoothCents;
  double position=shimmerOffset;
  if(s.quantize>0) {
    const double amount=unit(s.quantize);
    const double cell=__builtin_floor(position);
    // Hold around each correlation cell; shrink the travel interval toward a snap.
    position=amount>=1 ? __builtin_floor(position+.5)
      : cell+unit((position-cell-.5*amount)/(1-amount));
  }
  const double base=noise(grid,s.seed),travel=noise(grid-position,s.seed);
  double pattern=base+s.shimmerDepth*(travel-base);
  if(s.evolveDepth!=0){
    if(!__builtin_isfinite(evolution)||__builtin_fabs(evolution)>4503599627370495.0)return __builtin_nan("");
    const double index=__builtin_floor(evolution),duration=unit(s.evolveTransition);
    const double blend=duration>0?smooth((evolution-index-(1-duration))/duration):0;
    const unsigned a=evolutionSeed(index,s.seed),b=evolutionSeed(index+1,s.seed);
    const double fixed=noise(grid,a)*(1-blend)+noise(grid,b)*blend;
    const double moving=noise(grid-position,a)*(1-blend)+noise(grid-position,b)*blend;
    const double evolving=fixed+s.shimmerDepth*(moving-fixed);
    pattern+=s.evolveDepth*(evolving-pattern);
  }
  const double p=pattern*(1+s.fold);
  const double wrapped=p-4*__builtin_floor((p+1)/4);
  const double folded=wrapped<=1?wrapped:2-wrapped;
  const double edge = smooth((double)k/3)*smooth((double)(size/2-k)/3);
  return s.spread*bass*tilt*folded*edge;
}
struct Core {
  float input[2][maximum], ola[2][maximum], window[maximum];
  float re[maximum], im[maximum], midRe[bins], midIm[bins], rightRe[bins], rightIm[bins];
  float hz[bins], pan[bins], level[bins], applied[bins];
  int size = 2048, position = 0, hop = 0;
  unsigned serial = 0;
  double shimmerOffset = 0, displayPosition = 0;
  double evolution = 0, displayEvolution = 0;
  double right = 0;
  bool fault = false;
  void reset(int n) {
    size=n; position=hop=0; serial=0; shimmerOffset=displayPosition=right=evolution=displayEvolution=0; fault=false;
    for (int j=0;j<maximum;++j) {
      const int k=j<n?(j<n/2?j:n-j)*(maximum/n):0;
      window[j]=j>=n?0:j==n/2?1:.5f-.5f*f16384.twRe[k];
      input[0][j]=input[1][j]=ola[0][j]=ola[1][j]=0;
    }
    for(int k=0;k<bins;++k) hz[k]=pan[k]=level[k]=applied[k]=0;
  }
  bool frame(const Settings& s) {
    displayPosition=shimmerOffset;
    displayEvolution=evolution;
    for(int c=0;c<2;++c) {
      for(int j=0;j<size;++j) { re[j]=input[c][(position+1+j)%size]*window[j]; im[j]=0; }
      transform(size,re,im,false);
      if(c==0) for(int k=0;k<=size/2;++k) { midRe[k]=re[k]; midIm[k]=im[k]; }
    }
    double sn=0,cs=1;
    soemdsp_maths::dsp_sin_cos(s.phase*pi*.5,&sn,&cs);
    for(int k=0;k<=size/2;++k) {
      const double mr=.5*(midRe[k]+re[k]), mi=.5*(midIm[k]+im[k]);
      const double sr=.5*(midRe[k]-re[k]), si=.5*(midIm[k]-im[k]);
      const double q=field(k,size,s,shimmerOffset,evolution);
      const double magnitude=__builtin_fabs(q);
      const double norm=magnitude>1?1/magnitude/__builtin_sqrt(1+1/magnitude/magnitude):1/__builtin_sqrt(1+q*q),side=q*norm;
      // Unitary complex M/S rotation: Spread redistributes energy, never adds it.
      // Centre attenuates the rotated mid, after the side has been generated.
      const double outMr=s.centre*(norm*mr-side*(sr*cs+si*sn));
      const double outMi=s.centre*(norm*mi-side*(si*cs-sr*sn));
      const double outSr=norm*sr+side*(mr*cs-mi*sn);
      const double outSi=norm*si+side*(mr*sn+mi*cs);
      const double dmR=outMr-mr,dmI=outMi-mi,dsR=outSr-sr,dsI=outSi-si;
      const double power=mr*mr+mi*mi, total=outMr*outMr+outMi*outMi+outSr*outSr+outSi*outSi;
      hz[k]=(float)((double)k*s.rate/size); applied[k]=(float)q;
      pan[k]=(float)(total>1e-30?2*(outMr*outSr+outMi*outSi)/total:0);
      level[k]=(float)(__builtin_sqrt(power)*(k==0||k==size/2?2:4)/size);
      re[k]=(float)(dmR+dsR); im[k]=k==0||k==size/2?0:(float)(dmI+dsI);
      rightRe[k]=(float)(dmR-dsR);rightIm[k]=k==0||k==size/2?0:(float)(dmI-dsI);
      if(!__builtin_isfinite(re[k])||!__builtin_isfinite(im[k])||!__builtin_isfinite(rightRe[k])||!__builtin_isfinite(rightIm[k])) return false;
      if(k>0&&k<size/2) { re[size-k]=re[k]; im[size-k]=-im[k]; }
    }
    for(int c=0;c<2;++c){
      if(c==1)for(int k=0;k<=size/2;++k){
        re[k]=rightRe[k];im[k]=rightIm[k];
        if(k>0&&k<size/2){re[size-k]=re[k];im[size-k]=-im[k];}
      }
      transform(size,re,im,true);
      for(int j=0;j<size;++j) {
        const double y=(double)re[j]*window[j]*(2.0/3.0);
        if(!__builtin_isfinite(y)) return false;
        ola[c][(position+1+j)%size]+=(float)y;
      }
    }
    shimmerOffset+=s.shimmerSpeed*((size/4)/s.rate);
    evolution+=s.evolveRate*((size/4)/s.rate);
    if(!__builtin_isfinite(shimmerOffset)||!__builtin_isfinite(evolution)) return false;
    ++serial; return true;
  }
  double tick(double l,double r,const Settings& s) {
    fault=false;
    const double out=ola[0][position];right=ola[1][position];ola[0][position]=ola[1][position]=0;
    input[0][position]=(float)l; input[1][position]=(float)r;
    if(++hop==size/4) { hop=0; if(!frame(s)) { reset(size); fault=true; return 0; } }
    position=(position+1)%size; return out;
  }
};
struct State {
  Core cores[2]; Settings settings; float dry[2][maximum+1];
  int desired=2048,current=0,warm=0,dryPosition=0;
  bool started=false,changing=false; int configError=0;
  double fade=0,right=0,error=0; unsigned serial=0;
  void reset() {
    for(auto& c:cores) c.reset(desired);
    for(auto& c:dry) for(auto& x:c) x=0;
    current=warm=dryPosition=0; started=changing=false; fade=right=error=0; ++serial;
  }
  void initialize() { prepare(); settings=Settings{}; desired=2048; configError=0; serial=0; reset(); }
  double dryAt(int c,int n) const { return dry[c][(dryPosition+maximum+1-n)%(maximum+1)]; }
  double tick(double l,double r,double mix,double amplitude) {
    // Reject non-finite/unrepresentable input before float ring storage, not ordinary signal levels.
    if(!__builtin_isfinite((float)l)||!__builtin_isfinite((float)r)||!__builtin_isfinite(mix)||!__builtin_isfinite(amplitude)) { reset(); error=1; return 0; }
    if(!started) { cores[current].reset(desired); started=true; }
    if(!changing&&cores[current].size!=desired) {
      cores[1-current].reset(desired);
      cores[1-current].shimmerOffset=cores[current].shimmerOffset;
      cores[1-current].evolution=cores[current].evolution;
      warm=desired; fade=0; changing=true;
    }
    dry[0][dryPosition]=(float)l; dry[1][dryPosition]=(float)r;
    const unsigned before=cores[current].serial;
    const double delta=cores[current].tick(l,r,settings);
    double outL=dryAt(0,cores[current].size)+mix*delta;
    double outR=dryAt(1,cores[current].size)+mix*cores[current].right;
    if(before!=cores[current].serial) ++serial;
    error=configError||cores[current].fault?1:0;
    if(changing) {
      const double next=cores[1-current].tick(l,r,settings);
      if(cores[1-current].fault) error=1;
      if(warm>0) --warm;
      else {
        const double g=fade*fade*(3-2*fade);
        outL+=g*(dryAt(0,cores[1-current].size)+mix*next-outL);
        outR+=g*(dryAt(1,cores[1-current].size)+mix*cores[1-current].right-outR);
        fade+=1/(.05*settings.rate);
        if(fade>=1) { current=1-current; changing=false; ++serial; }
      }
    }
    dryPosition=(dryPosition+1)%(maximum+1);outL*=amplitude;right=outR*amplitude;
    if(!__builtin_isfinite(outL)||!__builtin_isfinite(right)) { reset(); error=1; return 0; }
    return outL;
  }
};
State* pool[capacity]{};
State* get(int h) { return h>0&&h<=capacity?pool[h-1]:nullptr; }
const char metadata[]=R"json({
  "module":"spectral_prism","targetType":"spectralPrism","label":"Spectral Prism","kind":"effect",
  "inputs":["In","Left","Right"],"outputs":["Mono","Left","Right","Error"],
  "parameters":[
    {"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"2048","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"STFT window and reference delay in samples; hop is one quarter. Size edits warm a second engine then crossfade for 50 ms. Latest size request wins. No automatic host delay compensation."},
    {"key":"centreDb","label":"Centre","defaultValue":"0","min":"-60","mid":"-12","max":"0","step":"any","unit":"dB","tooltip":"Attenuate the rotated mid after side generation. 0 dB leaves it unchanged; lower values reduce the centre and mono fold-down without turning up the sides. Not output amplitude."},
    {"key":"spread","label":"Spread","defaultValue":"1","min":"0","mid":"1","max":"40","step":"any","tooltip":"Energy-normalized spectral stereo rotation. Zero leaves stereo placement unchanged; larger values move more mid into side without the old Width boost. Stereo power is preserved per bin before Centre attenuation. Mono fold-down changes."},
    {"key":"fold","label":"Fold","defaultValue":"0","min":"0","mid":"1","max":"12","step":"any","tooltip":"Triangle-fold the seeded pattern before Spread. Zero preserves the original pattern; higher values reflect it repeatedly to create more alternating spectral structure. Does not fold the audio waveform."},
    {"key":"monoBassHz","label":"Mono Bass","kind":"frequency","defaultValue":"120","min":"20","mid":"120","max":"500","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"Generated spread fades in over one octave centred here. Existing stereo bass is retained; mono input below this region stays mono."},
    {"key":"tilt","label":"Tilt","defaultValue":"0","min":"-1","mid":"0","max":"1","step":"any","bipolar":true,"tooltip":"Spread slope above Mono Bass. Zero is even; positive favours highs, negative favours low-mids. Never bypasses the bass fade."},
    {"key":"smoothCents","label":"Smooth","defaultValue":"300","min":"50","mid":"300","max":"2400","step":"any","unit":"¢","nonlinearSlider":true,"tooltip":"Correlation length of the seeded pan field in cents. Narrow is more independent and metallic; wide is a gentle wash. Only the field is smoothed, not the audio mid."},
    {"key":"phase","label":"Phase","defaultValue":"0.25","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Rotate the spectral M/S exchange from coherent at zero to quadrature at one. Stereo power is preserved; this changes phase, not the coefficient magnitudes shown on the display."},
    {"key":"shimmerSpeedHz","label":"Shimmer Speed","defaultValue":"0","min":"-50","mid":"0","max":"50","step":"any","unit":"Hz","bipolar":true,"nonlinearSlider":true,"tooltip":"Continuous travel of the seeded pattern: positive moves right toward higher frequencies, negative left. One Hz moves one Smooth correlation length per second. Zero freezes the current position; never reverses like an LFO. Motion advances at native STFT hops."},
    {"key":"shimmerDepth","label":"Shimmer Depth","defaultValue":"0.5","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Blend from the fixed seeded pattern at zero to the travelling pattern at one. Controls how strongly each frequency moves left/right as the pattern passes, without changing Shimmer Speed. With speed zero, blends against the frozen position."},
    {"key":"evolveRateHz","label":"Evolve Rate","defaultValue":"1","min":"0","mid":"1","max":"100","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"New independently seeded patterns per second, joined by smooth quintic transitions. Unlike Shimmer, changes the pattern itself rather than sliding it. Zero freezes evolution. Evaluated at STFT hops; smaller FFT sizes reveal faster motion."},
    {"key":"evolveDepth","label":"Evolve Depth","defaultValue":"0","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Blend from the original pattern at zero to continuously evolving seeded patterns at one. Works with or without Shimmer, and before Fold. Seed makes the evolution deterministic. Fast rates intentionally create noisy stereo motion and sidebands."},
    {"key":"evolveTransition","label":"Evolve Transition","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Fraction of each Evolve period spent morphing to the next pattern. One morphs throughout; lower values hold longer then change faster. Zero is hard seeded steps. Transition time = this value / Evolve Rate seconds; quintic transitions, evaluated at STFT hops."},
    {"key":"shimmerQuantize","label":"Quantize","defaultValue":"0","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Shimmer transition sharpness: zero is continuous travel, one holds then snaps. Intermediate values shorten the transition between fixed steps of one Smooth region. STFT overlap still softens the sound. Does not quantize input pitch."},
    {"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Aligned delayed dry to prism wet. Delay follows the active FFT size through its warmed crossfade."},
    {"key":"amplitude","label":"Amp","defaultValue":"1","min":"0","mid":"1","max":"2","step":"any","tooltip":"Final amplitude multiplier after dry/wet Mix. Zero silences both outputs. Independent of Centre, Spread and Fold."},
    {"key":"seed","kind":"seed","label":"Seed","defaultValue":"0","min":"0","mid":"0","max":"16777215","maxDigits":0,"step":"1","linearSmoothing":false,"nonlinearSlider":false,"smoothingType":"none","tooltip":"Prism pattern seed. Same Seed = same pattern; new modules get their own."}
  ]
})json";
}
extern "C" int soemdsp_spectral_prism_create() {
  for(int i=0;i<capacity;++i) if(!pool[i]) { auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State))); if(!s)return 0; s->initialize(); pool[i]=s; return i+1; } return 0;
}
extern "C" void soemdsp_spectral_prism_destroy(int h) { if(auto* s=get(h)) { soemdsp::memory_pool::release(s); pool[h-1]=nullptr; } }
extern "C" void soemdsp_spectral_prism_reset(int h) { if(auto* s=get(h))s->reset(); }
extern "C" int soemdsp_spectral_prism_configure(int h,int size,double rate,double spread,double bass,double tilt,double smoothCents,double phase,double shimmerSpeed,double shimmerDepth,double seed,double quantize,double centreDb,double fold,double evolveRate,double evolveDepth,double evolveTransition) {
  auto* s=get(h); if(!s)return -1;
  const double values[]={rate,spread,bass,tilt,smoothCents,phase,shimmerSpeed,shimmerDepth,seed,quantize,centreDb,fold,evolveRate,evolveDepth,evolveTransition};
  for(double x:values) if(!__builtin_isfinite(x)) { s->configError=1; return -2; }
  // Positive rate, bass and correlation length are logarithm/division domains, not musical limits.
  if(!validSize(size)||rate<=0||bass<=0||smoothCents<=0) { s->configError=1; return -2; }
  s->desired=size; if(s->settings.rate!=rate)s->reset();
  const double rounded=__builtin_floor(seed+.5);
  const double wrapped=rounded-__builtin_floor(rounded/4294967296.0)*4294967296.0;
  // Guard conversion precision/domain, not the user-editable seed range.
  if(!(wrapped>=0&&wrapped<4294967296.0)||!__builtin_isfinite(phase*pi*.5)) { s->configError=1; return -2; }
  const unsigned seed32=(unsigned)wrapped;
  const double centre=soemdsp_maths::dsp_exp(centreDb*.1151292546497023);
  if(!__builtin_isfinite(centre)){s->configError=1;return -2;}
  s->settings={rate,spread,bass,tilt,smoothCents,phase,shimmerSpeed,shimmerDepth,quantize,centre,fold,evolveRate,evolveDepth,evolveTransition,seed32}; s->configError=0; return 0;
}
extern "C" double soemdsp_spectral_prism_sample(int h,double l,double r,double mix,double amplitude) { auto* s=get(h); return s?s->tick(l,r,mix,amplitude):0; }
extern "C" double soemdsp_spectral_prism_right(int h) { auto* s=get(h); return s?s->right:0; }
extern "C" double soemdsp_spectral_prism_error(int h) { auto* s=get(h); return s?s->error:1; }
extern "C" int soemdsp_spectral_prism_fft_size(int h) { auto* s=get(h); return s?(s->started?s->cores[s->current].size:s->desired):0; }
extern "C" int soemdsp_spectral_prism_latency() { return 2048; }
extern "C" int soemdsp_spectral_prism_latency_for_handle(int h) { return soemdsp_spectral_prism_fft_size(h); }
extern "C" double soemdsp_spectral_prism_state_bytes() { return sizeof(State); }
extern "C" int soemdsp_spectral_prism_version() { return 1; }
extern "C" const char* soemdsp_spectral_prism_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_prism_metadata_json_size() { return sizeof(metadata)-1; }
extern "C" int soemdsp_spectral_prism_display_count(int h) { auto* s=get(h); return s&&s->started?s->cores[s->current].size/2+1:0; }
extern "C" unsigned soemdsp_spectral_prism_display_serial(int h) { auto* s=get(h); return s?s->serial:0; }
extern "C" double soemdsp_spectral_prism_display_position(int h) { auto* s=get(h); return s?s->cores[s->current].displayPosition:0; }
extern "C" double soemdsp_spectral_prism_display_evolution(int h) { auto* s=get(h); return s?s->cores[s->current].displayEvolution:0; }
extern "C" const float* soemdsp_spectral_prism_display_hz(int h) { auto* s=get(h); return s?s->cores[s->current].hz:nullptr; }
extern "C" const float* soemdsp_spectral_prism_display_pan(int h) { auto* s=get(h); return s?s->cores[s->current].pan:nullptr; }
extern "C" const float* soemdsp_spectral_prism_display_level(int h) { auto* s=get(h); return s?s->cores[s->current].level:nullptr; }
extern "C" const float* soemdsp_spectral_prism_display_field(int h) { auto* s=get(h); return s?s->cores[s->current].applied:nullptr; }
