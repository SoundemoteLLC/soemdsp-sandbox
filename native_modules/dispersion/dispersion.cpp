// soemdsp-native-module: dispersion
// soemdsp-native-label: Dispersion
// soemdsp-native-target: dispersion
// soemdsp-native-kind: effect
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/segment_curves.h>
#include <soemdsp/filter/allpass_design.h>
namespace {
constexpr int maximum=256,capacity=64;
constexpr double pi=3.14159265358979323846;
struct Config {int mode=0,tuning=0,reference=0;double low=150,high=600,fShape=0,lowQ=1,highQ=1,qShape=0,gainDb=0;};
struct Stage {double state,innerState,a,b,k1,l1,ratio,targetRatio,q,targetQ,lastHz,lastDirection,lastMode,lastQ;};
struct State {
  Stage stages[2][maximum];Config config;unsigned revision,seenRevision;
  int current,next,desired,geometryCount,ratioRamp,directionRamp,lastDirection,modeRamp,lastMode;
  double spread,curve,width,lastRate,directionFactor,targetDirection,modeAmount,fade,right,error,outputGain;
  bool changing,configError;
  void reset() {
    for(auto& channel:stages)for(auto& s:channel){s={};s.ratio=s.targetRatio=s.q=s.targetQ=1;s.lastHz=-1;s.lastDirection=s.lastMode=3;s.lastQ=-1;}
    current=next=desired=ratioRamp=directionRamp=modeRamp=0;geometryCount=lastDirection=lastMode=-1;
    spread=curve=width=-100;lastRate=0;directionFactor=targetDirection=1;modeAmount=fade=right=error=0;changing=configError=false;seenRevision=0;
  }
  void initialize(){config=Config{};revision=1;outputGain=1;reset();}
  double center() const{return __builtin_sqrt(config.low)*__builtin_sqrt(config.high);}
  void geometry(int count,double spreadOct,double contour,double stereo,double rate) {
    if(geometryCount==count&&spread==spreadOct&&curve==contour&&width==stereo&&seenRevision==revision)return;
    const bool first=geometryCount<0;geometryCount=count;spread=spreadOct;curve=contour;width=stereo;seenRevision=revision;
    ratioRamp=(int)(.01*rate);if(ratioRamp<1)ratioRamp=1;
    const int depth=changing?(current>next?current:next):count;
    const double root=center(),lnF=soemdsp_maths::dsp_ln(config.high/config.low),lnQ=soemdsp_maths::dsp_ln(config.highQ/config.lowQ);
    for(int c=0;c<2;++c)for(int i=0;i<depth;++i) {
      const double p=count>1?soemdsp::math::clamp01((double)i/(count-1)):0;
      const double stereoFactor=soemdsp_maths::dsp_exp((c?.5:-.5)*stereo*.6931471805599453);
      double ratio;
      if(config.tuning)ratio=config.low*soemdsp_maths::dsp_exp(soemdsp::allpass::distribution(p,config.fShape)*lnF)/root;
      else {
        const double progress=count>1?p:.5,shaped=soemdsp::math::segment_rational01(progress,contour);
        ratio=soemdsp_maths::dsp_exp(spreadOct*(shaped-.5)*.6931471805599453);
      }
      Stage& s=stages[c][i];s.targetRatio=ratio*stereoFactor;
      s.targetQ=config.lowQ*soemdsp_maths::dsp_exp(soemdsp::allpass::distribution(p,config.qShape)*lnQ);
      if(first){s.ratio=s.targetRatio;s.q=s.targetQ;}
    }
    if(first)ratioRamp=0;
  }
  double tick(double l,double r,double frequency,double spreadOct,double contour,double stereo,double mix,int count,int direction,double rate) {
    const double values[]={l,r,frequency,spreadOct,contour,stereo,mix,rate};
    for(double v:values)if(!__builtin_isfinite(v)){reset();error=1;return 0;}
    if(count<0||count>maximum||direction<0||direction>1||spreadOct<0||rate<8000||rate>192000){right=0;error=1;return 0;}
    if(lastRate&&lastRate!=rate)reset();lastRate=rate;error=configError?1:0;
    desired=count;if(geometryCount<0)current=next=count;
    if(!changing&&current!=desired){next=desired;fade=0;changing=true;}
    geometry(changing?next:current,spreadOct,soemdsp::math::clamp11(contour),stereo,rate);
    if(lastDirection!=direction){targetDirection=direction?-1:1;if(lastDirection<0)directionFactor=targetDirection;else directionRamp=(int)(.01*rate);lastDirection=direction;}
    if(directionRamp){directionFactor+=(targetDirection-directionFactor)/directionRamp;--directionRamp;}
    if(lastMode!=config.mode){if(lastMode<0)modeAmount=config.mode;else modeRamp=(int)(.01*rate);lastMode=config.mode;}
    if(modeRamp){modeAmount+=(config.mode-modeAmount)/modeRamp;--modeRamp;}
    const int depth=changing?(current>next?current:next):current;
    const double base=config.tuning&&!config.reference?center():(frequency<0?-frequency:frequency);
    const double inputs[2]={l,r};double output[2];const double blend=fade*fade*(3-2*fade);
    for(int c=0;c<2;++c){
      double x=inputs[c],old=current==0?x:0,fresh=next==0?x:0;
      for(int i=0;i<depth;++i){
        Stage& s=stages[c][i];if(ratioRamp){s.ratio+=(s.targetRatio-s.ratio)/ratioRamp;s.q+=(s.targetQ-s.q)/ratioRamp;}
        const double raw=base*s.ratio,hz=raw<rate*.4999?raw:rate*.4999;
        if(hz!=s.lastHz||directionFactor!=s.lastDirection||modeAmount!=s.lastMode||s.q!=s.lastQ){
          s.lastHz=hz;s.lastDirection=directionFactor;s.lastMode=modeAmount;s.lastQ=s.q;
          const auto one=soemdsp::allpass::one_pole(hz,rate);
          const auto two=soemdsp::allpass::biquad(hz,s.q,rate);
          s.a=soemdsp::math::clamp11((1-modeAmount)*one.b0*directionFactor+modeAmount*two.b0);
          s.k1=soemdsp::math::clamp11(1-modeAmount+modeAmount*two.inner*directionFactor);
          s.b=__builtin_sqrt(1-s.a*s.a);s.l1=__builtin_sqrt(1-s.k1*s.k1);
        }
        // Nested orthogonal lattice realizes Robin's second-order allpass; k1=1 reduces it to first order.
        const double y=s.a*x+s.b*s.state,t=s.b*x-s.a*s.state;
        const double inner=s.k1*t+s.l1*s.innerState;
        s.innerState=s.l1*t-s.k1*s.innerState;s.state=inner;x=y;
        if(modeAmount==0&&!modeRamp)s.innerState=0;
        if(i+1==current)old=x;if(i+1==next)fresh=x;
      }
      const double wet=changing?old+blend*(fresh-old):old;output[c]=outputGain*(inputs[c]+soemdsp::math::clamp01(mix)*(wet-inputs[c]));
    }
    if(ratioRamp)--ratioRamp;
    if(changing){fade+=1/(.05*rate);if(fade>=1){current=next;changing=false;for(auto& channel:stages)for(int i=current;i<maximum;++i)channel[i].state=channel[i].innerState=0;}}
    right=output[1];if(!__builtin_isfinite(output[0])||!__builtin_isfinite(right)){reset();error=1;return 0;}return output[0];
  }
};
State* pool[capacity]{};
State* get(int h){return h>0&&h<=capacity?pool[h-1]:nullptr;}
const char metadata[]=R"json({
  "module": "dispersion",
  "targetType": "dispersion",
  "label": "Dispersion",
  "kind": "effect",
  "inputs": [
    "In",
    "Left",
    "Right",
    "f"
  ],
  "outputs": [
    "Mono",
    "Left",
    "Right",
    "Error"
  ],
  "parameters": [
    {
      "key": "filterMode",
      "label": "Filter Mode",
      "kind": "choice",
      "choices": [
        "One-Pole",
        "Biquad"
      ],
      "choiceKeys": [
        "onePole",
        "biquad"
      ],
      "choiceIds": [
        0,
        1
      ],
      "defaultValue": "biquad",
      "min": "0",
      "mid": ".5",
      "max": "1",
      "step": "1",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "One-Pole is the broad first-order disperser. Biquad uses Robin-compatible second-order allpasses with Q control for stronger focused chirps. Both use the same energy-preserving normalized lattice. Mode changes morph valid reflection coefficients over 10 ms."
    },
    {
      "key": "tuningMode",
      "label": "Tuning",
      "kind": "choice",
      "choices": [
        "Center",
        "Range"
      ],
      "choiceKeys": [
        "center",
        "range"
      ],
      "choiceIds": [
        0,
        1
      ],
      "defaultValue": "range",
      "min": "0",
      "mid": ".5",
      "max": "1",
      "step": "1",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "Center uses Center Freq, Center Spread and Center Curve. Range uses Low Freq, High Freq and Freq Shape, matching Robin's logarithmic stage distribution. Wired f sets the geometric center in either mode; Range endpoints are scaled together."
    },
    {
      "key": "lowFreq",
      "label": "Low Freq",
      "kind": "frequency",
      "defaultValue": "15",
      "min": ".01",
      "mid": "150",
      "max": "20000",
      "step": "any",
      "unit": "Hz",
      "nonlinearSlider": true,
      "tooltip": "Range tuning only. Actual Hz of the first stage before stereo offset. Endpoints may be reversed. One stage uses Low Freq. Corner frequencies stay below Nyquist; f input retunes the range center."
    },
    {
      "key": "highFreq",
      "label": "High Freq",
      "kind": "frequency",
      "defaultValue": "8000",
      "min": ".01",
      "mid": "2000",
      "max": "20000",
      "step": "any",
      "unit": "Hz",
      "nonlinearSlider": true,
      "tooltip": "Range tuning only. Actual Hz of the last stage before stereo offset. Endpoints may be reversed. One stage uses Low Freq. Corner frequencies stay below Nyquist; f input retunes the range center."
    },
    {
      "key": "freqShape",
      "label": "Freq Shape",
      "defaultValue": "0",
      "min": "-5",
      "mid": "0",
      "max": "5",
      "step": "any",
      "tooltip": "Range tuning only. Robin's stage-frequency distribution shape, not a normalized amount. Zero is uniform logarithmic spacing; positive and negative crowd stages toward opposite ends. Same mapping as Robin Sinepulse Allpass."
    },
    {
      "key": "lowQ",
      "label": "Low Q",
      "defaultValue": "1",
      "min": ".05",
      "mid": "1",
      "max": "20",
      "step": "any",
      "nonlinearSlider": true,
      "tooltip": "Biquad only. Dimensionless Q at the first stage. Higher values concentrate group delay and make longer, more tonal chirps without boosting static spectral magnitude. Q must be positive; no hidden 1000-Q ceiling in Dispersion."
    },
    {
      "key": "highQ",
      "label": "High Q",
      "defaultValue": "1",
      "min": ".05",
      "mid": "1",
      "max": "20",
      "step": "any",
      "nonlinearSlider": true,
      "tooltip": "Biquad only. Dimensionless Q at the last stage. Higher values concentrate group delay and make longer, more tonal chirps without boosting static spectral magnitude. Q must be positive; no hidden 1000-Q ceiling in Dispersion."
    },
    {
      "key": "qShape",
      "label": "Q Shape",
      "defaultValue": "0",
      "min": "-5",
      "mid": "0",
      "max": "5",
      "step": "any",
      "tooltip": "Biquad only. Robin-compatible logarithmic Q distribution contour between Low Q and High Q. Zero is uniform log spacing. One stage uses Low Q."
    },
    {
      "key": "outputGainDb",
      "label": "Output Gain",
      "defaultValue": "0",
      "min": "-24",
      "mid": "0",
      "max": "24",
      "step": "any",
      "unit": "dB",
      "tooltip": "Explicit final gain in dB after dry/wet Mix. Default 0 dB preserves the allpass level. No limiter, hidden clipping or automatic loudness matching."
    },
    {
      "key": "frequency",
      "label": "Center Freq",
      "kind": "frequency",
      "defaultValue": "300",
      "min": "10",
      "mid": "300",
      "max": "10000",
      "step": "any",
      "unit": "Hz",
      "nonlinearSlider": true,
      "tooltip": "Center tuning only: geometric center in Hz. Wired f replaces this value in Center mode and sets the geometric center of Low/High Freq in Range mode. Zero f collapses corner tuning to DC. Negative f uses magnitude."
    },
    {
      "key": "stages",
      "label": "Stages",
      "defaultValue": "50",
      "min": "0",
      "mid": "32",
      "max": "256",
      "step": "1",
      "linearSmoothing": false,
      "tooltip": "Actual cascade depth, 0..256, matching Robin's structural limit. Zero is a wire. Biquad gives two poles per stage; One-Pole gives one. Count changes crossfade taps over 50 ms; removed states clear only after fading. More stages cost more CPU."
    },
    {
      "key": "spreadOct",
      "label": "Center Spread",
      "defaultValue": "2",
      "min": "0",
      "mid": "2",
      "max": "8",
      "step": "any",
      "unit": "oct",
      "tooltip": "Center tuning only: total octave span around Center Freq. Range tuning instead uses Low/High Freq and Freq Shape."
    },
    {
      "key": "curve",
      "label": "Center Curve",
      "defaultValue": "0",
      "min": "-1",
      "mid": "0",
      "max": "1",
      "step": "any",
      "tooltip": "Center tuning only: normalized rational contour for Center Spread. Range tuning instead uses Robin's Freq Shape."
    },
    {
      "key": "direction",
      "label": "Direction",
      "kind": "choice",
      "choices": [
        "Low Late",
        "High Late"
      ],
      "choiceKeys": [
        "lowLate",
        "highLate"
      ],
      "choiceIds": [
        0,
        1
      ],
      "defaultValue": "lowLate",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "step": "1",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "Low Late delays low frequencies more; High Late reflects the allpass coefficients so delay concentrates toward Nyquist. Does not reverse recorded audio or introduce negative delay. Direction changes ramp coefficients over 10 ms through valid lattice rotations."
    },
    {
      "key": "stereoOct",
      "label": "Stereo Offset",
      "defaultValue": "0",
      "min": "-2",
      "mid": "0",
      "max": "2",
      "step": "any",
      "unit": "oct",
      "tooltip": "Signed octave difference between right and left stage tuning. Zero gives identical processing with independent channel states. Nonzero offsets turn mono excitation into different stereo phase/time shapes; mono summing may cancel frequencies."
    },
    {
      "key": "mix",
      "label": "Mix",
      "defaultValue": "1",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "step": "any",
      "unit": "%",
      "tooltip": "Immediate dry/wet blend. Fully wet static processing preserves spectral magnitude while changing phase and group delay. Mixing dry and wet intentionally produces comb coloration. Zero buffering latency, no lookahead, no automatic gain, limiter or clipping."
    }
  ]
})json";
}
extern "C" int soemdsp_dispersion_create(){for(int i=0;i<capacity;++i)if(!pool[i]){auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));if(!s)return 0;s->initialize();pool[i]=s;return i+1;}return 0;}
extern "C" void soemdsp_dispersion_destroy(int h){if(auto* s=get(h)){soemdsp::memory_pool::release(s);pool[h-1]=nullptr;}}
extern "C" void soemdsp_dispersion_reset(int h){if(auto* s=get(h))s->reset();}
extern "C" double soemdsp_dispersion_sample(int h,double l,double r,double f,double spread,double curve,double stereo,double mix,int count,int direction,double rate){auto* s=get(h);return s?s->tick(l,r,f,spread,curve,stereo,mix,count,direction,rate):0;}
extern "C" double soemdsp_dispersion_right(int h){auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_dispersion_error(int h){auto* s=get(h);return s?s->error:1;}
extern "C" double soemdsp_dispersion_state_energy(int h){auto* s=get(h);double e=0;if(s)for(auto& c:s->stages)for(auto& stage:c)e+=stage.state*stage.state+stage.innerState*stage.innerState;return e;}
extern "C" int soemdsp_dispersion_configure(int h,int mode,int tuning,double low,double high,double fShape,double lowQ,double highQ,double qShape,int reference,double gainDb) {
 auto* s=get(h);if(!s)return -1;const double values[]={low,high,fShape,lowQ,highQ,qShape,gainDb};
 for(double v:values)if(!__builtin_isfinite(v)){s->configError=true;return -2;}
 if(mode<0||mode>1||tuning<0||tuning>1||low<=0||high<=0||lowQ<=0||highQ<=0){s->configError=true;return -2;}
 const Config c={mode,tuning,reference,low,high,fShape,lowQ,highQ,qShape,gainDb};const auto& p=s->config;
 if(gainDb!=p.gainDb)s->outputGain=soemdsp_maths::dsp_exp(gainDb*.1151292546497023);
 if(c.mode!=p.mode||c.tuning!=p.tuning||c.reference!=p.reference||c.low!=p.low||c.high!=p.high||c.fShape!=p.fShape||c.lowQ!=p.lowQ||c.highQ!=p.highQ||c.qShape!=p.qShape){++s->revision;}
 s->config=c;
 s->configError=false;return 0;
}
extern "C" double soemdsp_dispersion_stage_frequency(int h,int channel,int i){auto* s=get(h);return s&&channel>=0&&channel<2&&i>=0&&i<s->current?s->stages[channel][i].lastHz:0;}
extern "C" double soemdsp_dispersion_group_delay_ms(int h,int channel,double hz){
 auto* s=get(h);if(!s||channel<0||channel>1||!__builtin_isfinite(hz)||!s->lastRate)return 0;
 double sn,cs;soemdsp_maths::dsp_sin_cos(2*pi*hz/s->lastRate,&sn,&cs);double delay=0;
 for(int i=0;i<s->current;++i){const auto& stage=s->stages[channel][i];
  if(stage.k1==1){const double d=1+stage.a*stage.a+2*stage.a*cs;if(d>1e-20)delay+=stage.b*stage.b/d;}
  else {const double a1=stage.k1*(1+stage.a),z2r=cs*cs-sn*sn,z2i=-2*sn*cs;
   const double dr=1+a1*cs+stage.a*z2r,di=-a1*sn+stage.a*z2i,nr=a1*cs+2*stage.a*z2r,ni=-a1*sn+2*stage.a*z2i,d=dr*dr+di*di;
   if(d>1e-28)delay+=2-2*(nr*dr+ni*di)/d;
  }
 }
 return delay*1000/s->lastRate;
}
extern "C" int soemdsp_dispersion_latency(){return 0;}
extern "C" int soemdsp_dispersion_version(){return 2;}
extern "C" const char* soemdsp_dispersion_metadata_json(){return metadata;}
extern "C" int soemdsp_dispersion_metadata_json_size(){return sizeof(metadata)-1;}
