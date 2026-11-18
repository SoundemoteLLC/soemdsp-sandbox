// soemdsp-native-module: material_resonator
// soemdsp-native-label: Material Resonator
// soemdsp-native-target: materialResonator
// soemdsp-native-kind: effect
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>

namespace {
constexpr int maxModes=64,capacity=64;
constexpr double pi=3.14159265358979323846;
double unit(double x) {return x<0?0:x>1?1:x;}
double sine(double x) {double s,c;soemdsp_maths::dsp_sin_cos(x,&s,&c);return s;}
struct Mode {
  double re[2],im[2],ratio,targetRatio,gain[2],targetGain[2];
  double lastF,lastDecay,lastDamping,lastRate,lastMaterial,cr,ci,excitation,fade;
};
struct State {
  Mode modes[maxModes];
  double natural[maxModes];int mx[maxModes],my[maxModes];
  int material,count,ramp;
  double inharmonicity,position,spread,right,error,lastRate;
  void reset() {
    for(auto& m:modes) {m={};m.lastF=-1;}
    material=-1;count=0;ramp=0;inharmonicity=position=spread=-1;right=error=lastRate=0;
  }
  void geometry(int kind,int number,double inharm,double pos,double width,double rate) {
    if(material==kind&&count==number&&inharmonicity==inharm&&position==pos&&spread==width)return;
    const bool first=material<0;
    if(material!=kind) {
      for(int i=0;i<maxModes;++i) {
        mx[i]=kind==1?i/8+1:i+1;my[i]=kind==1?i%8+1:1;
        if(kind==0) {const double root=i==0?4.730040744862704:(i+1.5)*pi;natural[i]=root*root/(4.730040744862704*4.730040744862704);}
        else if(kind==1) natural[i]=(mx[i]*mx[i]+1.8769*my[i]*my[i])/2.8769;
        else natural[i]=1+1.75*i+.27*i*i;
      }
      if(kind==1) for(int i=0;i<maxModes-1;++i) {
        int lowest=i;for(int j=i+1;j<maxModes;++j)if(natural[j]<natural[lowest])lowest=j;
        const double r=natural[i];natural[i]=natural[lowest];natural[lowest]=r;
        const int x=mx[i],y=my[i];mx[i]=mx[lowest];my[i]=my[lowest];mx[lowest]=x;my[lowest]=y;
      }
    }
    material=kind;count=number;inharmonicity=inharm;position=pos;spread=width;
    ramp=(int)(.01*rate);if(ramp<1)ramp=1;
    for(int i=0;i<maxModes;++i) {
      Mode& m=modes[i];m.targetRatio=(i+1)+inharm*(natural[i]-(i+1));
      const double strike=kind==1?sine(mx[i]*pi*pos)*sine(my[i]*pi*(.2+.6*pos)):sine(mx[i]*pi*pos);
      const double weight=.5/__builtin_sqrt(m.targetRatio);
      for(int c=0;c<2;++c) {
        const double pickup=.37+(c?.18:-.18)*width;
        const double receive=kind==1?sine(mx[i]*pi*pickup)*sine(my[i]*pi*.61):sine(mx[i]*pi*pickup);
        m.targetGain[c]=i<number?strike*receive*weight:0;
        if(first)m.gain[c]=m.targetGain[c];
      }
      if(first)m.ratio=m.targetRatio;
      m.lastF=-1;
    }
    if(first)ramp=0;
  }
  double tick(double l,double r,double frequency,double decay,double damping,double inharm,double pos,
    double width,double driveDb,double mix,int kind,int number,double rate) {
    const double values[]={l,r,frequency,decay,damping,inharm,pos,width,driveDb,mix,rate};
    for(double v:values)if(!__builtin_isfinite(v)){reset();error=1;return 0;}
    if(kind<0||kind>2||number<1||number>maxModes||decay<0||damping<=0||rate<8000||rate>192000){error=1;right=0;return 0;}
    if(lastRate&&lastRate!=rate)reset();lastRate=rate;error=0;
    geometry(kind,number,unit(inharm),unit(pos),unit(width),rate);
    const double drive=soemdsp_maths::dsp_exp(driveDb*.1151292546497023);
    const double input[2]={l*drive,r*drive};double wet[2]={0,0};
    for(int i=0;i<maxModes;++i) {
      Mode& m=modes[i];
      if(ramp) {m.ratio+=(m.targetRatio-m.ratio)/ramp;for(int c=0;c<2;++c)m.gain[c]+=(m.targetGain[c]-m.gain[c])/ramp;}
      if(m.gain[0]==0&&m.gain[1]==0&&m.targetGain[0]==0&&m.targetGain[1]==0){for(int c=0;c<2;++c)m.re[c]=m.im[c]=0;continue;}
      const double f=(frequency<0?-frequency:frequency)*m.ratio;
      if(f!=m.lastF||decay!=m.lastDecay||damping!=m.lastDamping||rate!=m.lastRate||kind!=m.lastMaterial) {
        m.lastF=f;m.lastDecay=decay;m.lastDamping=damping;m.lastRate=rate;m.lastMaterial=kind;
        const double hz=f<rate*.499?f:rate*.499;
        const double relative=hz/damping,loss=kind==0?2.5:kind==1?1:.35;
        const double exponent=decay>0?-6.907755278982137*(1+loss*relative*relative)/(rate*decay):-1000;
        const double radius=exponent>=-4?soemdsp_maths::dsp_exp_squaring(exponent):soemdsp_maths::dsp_exp(exponent);
        double sn,cs;soemdsp_maths::dsp_sin_cos(2*pi*hz/rate,&sn,&cs);
        const double rotationNorm=1/__builtin_sqrt(sn*sn+cs*cs);
        m.cr=radius*cs*rotationNorm;m.ci=radius*sn*rotationNorm;
        // Near-unity peak gain per mode; damping changes bandwidth, not hidden resonant makeup.
        m.excitation=2*(1-radius);
        double fade=(rate*.5-f)/(rate*.05);fade=unit(fade);
        m.fade=f>0?fade*fade*(3-2*fade):0;
      }
      for(int c=0;c<2;++c) {
        const double re=m.cr*m.re[c]-m.ci*m.im[c]+input[c]*m.excitation*m.fade;
        const double im=m.ci*m.re[c]+m.cr*m.im[c];m.re[c]=re;m.im[c]=im;
        wet[c]+=im*m.gain[c]*m.fade;
      }
    }
    if(ramp)--ramp;
    mix=unit(mix);const double out=l+mix*(wet[0]-l);right=r+mix*(wet[1]-r);
    if(!__builtin_isfinite(out)||!__builtin_isfinite(right)){reset();error=1;return 0;}
    return out;
  }
};
State* pool[capacity]{};
State* get(int h){return h>0&&h<=capacity?pool[h-1]:nullptr;}
const char metadata[]=R"json({"module":"material_resonator","targetType":"materialResonator","label":"Material Resonator","kind":"effect","inputs":["In","Left","Right","f"],"outputs":["Mono","Left","Right","Error"],"parameters":[
{"key":"material","label":"Material","kind":"choice","choices":["Wood","Metal","Glass"],"choiceKeys":["wood","metal","glass"],"choiceIds":[0,1,2],"defaultValue":"metal","min":"0","mid":"1","max":"2","step":"1","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Procedural modal character: beam-like Wood, rectangular-plate Metal, or stylized Glass. Not measured material samples or an exact physical simulation. Material/position changes ramp modal ratios and pickup gains over 10 ms without clearing ringing state."},
{"key":"frequency","label":"Fundamental","kind":"frequency","defaultValue":"220","min":"20","mid":"220","max":"4000","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"Lowest modal frequency in Hz. A wired f input replaces this knob, including zero. Retuning preserves modal state; rapid modulation bends the ringing modes. Modes fade smoothly from 90% of Nyquist to Nyquist instead of folding back."},
{"key":"decay","label":"Base RT60","kind":"time","defaultValue":"1","min":"0.005","mid":"1","max":"20","step":"any","unit":"s","nonlinearSlider":true,"tooltip":"Low-frequency modal decay to -60 dB in seconds. Higher modes decay faster according to Damping and material. Zero stops wet resonance. Each mode is approximately peak-gain normalized; this is not impulse-normalized synthesis and very short impulses can be quiet."},
{"key":"dampingHz","label":"Damping","kind":"frequency","defaultValue":"4000","min":"20","mid":"2000","max":"20000","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"Frequency scale in Hz for shortening higher-mode RT60. Lower settings sound duller and die faster. Wood loses high modes faster than Metal; Glass retains them longer. This is frequency-dependent modal decay, not an input lowpass."},
{"key":"inharmonicity","label":"Inharmonicity","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Zero makes harmonic mode spacing; 100% uses the selected material's procedural mode ratios. Changes ramp over 10 ms. No IR files, random samples, convolution or FFT buffering."},
{"key":"position","label":"Excitation Position","defaultValue":"0.31","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Virtual strike position changes how strongly modes are excited, including nodal cancellations. The exact endpoints are fixed-boundary nodes and may be silent. This is a live audio effect, not a trigger-driven exciter."},
{"key":"stereoSpread","label":"Pickup Spread","defaultValue":"0.6","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Separation of the two virtual pickups. Mono excitation can produce different modal balances on left and right; zero links pickup weighting. Input channel histories remain separate with no mono downmix or crossfeed."},
{"key":"modes","label":"Modes","defaultValue":"32","min":"1","mid":"16","max":"64","step":"1","linearSmoothing":false,"tooltip":"Mode count, structurally bounded to 1 through 64. More modes add object detail and CPU work; modes beyond Nyquist are faded out. Mode-count changes ramp output weights instead of abruptly dumping every tail."},
{"key":"inputGainDb","label":"Input Gain","defaultValue":"0","min":"-24","mid":"0","max":"36","step":"any","unit":"dB","tooltip":"Explicit excitation gain in dB, applied only to wet processing. Raise it for single-sample impulses; start at 0 dB for sustained audio. There is no hidden limiter, clipping, automatic makeup or mode-count loudness normalization."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Immediate dry versus resonant wet audio. Zero algorithmic buffering latency; no lookahead or delay compensation required."}
]})json";
}
extern "C" int soemdsp_material_resonator_create(){for(int i=0;i<capacity;++i)if(!pool[i]){auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));if(!s)return 0;s->reset();pool[i]=s;return i+1;}return 0;}
extern "C" void soemdsp_material_resonator_destroy(int h){if(auto* s=get(h)){soemdsp::memory_pool::release(s);pool[h-1]=nullptr;}}
extern "C" void soemdsp_material_resonator_reset(int h){if(auto* s=get(h))s->reset();}
extern "C" double soemdsp_material_resonator_sample(int h,double l,double r,double f,double decay,double damping,double inharm,double pos,double width,double gain,double mix,int material,int count,double rate){auto* s=get(h);return s?s->tick(l,r,f,decay,damping,inharm,pos,width,gain,mix,material,count,rate):0;}
extern "C" double soemdsp_material_resonator_right(int h){auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_material_resonator_error(int h){auto* s=get(h);return s?s->error:1;}
extern "C" double soemdsp_material_resonator_mode_frequency(int h,int i){auto* s=get(h);return s&&i>=0&&i<s->count?s->modes[i].lastF:0;}
extern "C" int soemdsp_material_resonator_latency(){return 0;}
extern "C" int soemdsp_material_resonator_version(){return 1;}
extern "C" const char* soemdsp_material_resonator_metadata_json(){return metadata;}
extern "C" int soemdsp_material_resonator_metadata_json_size(){return sizeof(metadata)-1;}
