// soemdsp-native-module: dispersion
// soemdsp-native-label: Dispersion
// soemdsp-native-target: dispersion
// soemdsp-native-kind: effect
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/segment_curves.h>
namespace {
constexpr int maximum=128,capacity=64;
constexpr double pi=3.14159265358979323846;
struct Stage {double state,a,b,ratio,targetRatio,lastHz,lastDirection;};
struct State {
  Stage stages[2][maximum];
  int current,next,desired,geometryCount,ratioRamp,directionRamp,lastDirection;
  double spread,curve,width,lastRate,directionFactor,targetDirection,fade,right,error;
  bool changing;
  void reset() {
    for(auto& channel:stages)for(auto& s:channel){s={};s.ratio=s.targetRatio=1;s.lastHz=-1;s.lastDirection=3;}
    current=next=desired=ratioRamp=directionRamp=0;geometryCount=lastDirection=-1;
    spread=curve=width=-100;lastRate=0;directionFactor=targetDirection=1;fade=right=error=0;changing=false;
  }
  void geometry(int count,double spreadOct,double contour,double stereo,double rate) {
    if(geometryCount==count&&spread==spreadOct&&curve==contour&&width==stereo)return;
    const bool first=geometryCount<0;geometryCount=count;spread=spreadOct;curve=contour;width=stereo;
    ratioRamp=(int)(.01*rate);if(ratioRamp<1)ratioRamp=1;
    const int depth=changing?(current>next?current:next):count;
    for(int c=0;c<2;++c)for(int i=0;i<depth;++i) {
      const double progress=count>1?(double)i/(count-1):.5;
      const double shaped=soemdsp::math::segment_rational01(progress,contour);
      const double exponent=spreadOct*(shaped-.5)+(c?.5:-.5)*stereo;
      stages[c][i].targetRatio=soemdsp_maths::dsp_exp(exponent*.6931471805599453);
      if(first)stages[c][i].ratio=stages[c][i].targetRatio;
    }
    if(first)ratioRamp=0;
  }
  double tick(double l,double r,double frequency,double spreadOct,double contour,double stereo,double mix,int count,int direction,double rate) {
    const double values[]={l,r,frequency,spreadOct,contour,stereo,mix,rate};
    for(double v:values)if(!__builtin_isfinite(v)){reset();error=1;return 0;}
    if(count<0||count>maximum||direction<0||direction>1||spreadOct<0||rate<8000||rate>192000){right=0;error=1;return 0;}
    if(lastRate&&lastRate!=rate)reset();lastRate=rate;error=0;
    desired=count;
    if(geometryCount<0)current=next=count;
    if(!changing&&current!=desired){next=desired;fade=0;changing=true;}
    geometry(changing?next:current,spreadOct,soemdsp::math::clamp11(contour),stereo,rate);
    if(lastDirection!=direction) {
      targetDirection=direction?-1:1;
      if(lastDirection<0)directionFactor=targetDirection;
      else {directionRamp=(int)(.01*rate);if(directionRamp<1)directionRamp=1;}
      lastDirection=direction;
    }
    if(directionRamp){directionFactor+=(targetDirection-directionFactor)/directionRamp;--directionRamp;}
    const int depth=changing?(current>next?current:next):current;
    const double inputs[2]={l,r};double output[2];
    const double blend=fade*fade*(3-2*fade);
    for(int c=0;c<2;++c) {
      double x=inputs[c],old=current==0?x:0,fresh=next==0?x:0;
      for(int i=0;i<depth;++i) {
        Stage& s=stages[c][i];if(ratioRamp)s.ratio+=(s.targetRatio-s.ratio)/ratioRamp;
        const double hz=(frequency<0?-frequency:frequency)*s.ratio;
        if(hz!=s.lastHz||directionFactor!=s.lastDirection) {
          s.lastHz=hz;s.lastDirection=directionFactor;
          double a;
          if(hz>=rate*.5)a=1;
          else {double sn,cs;soemdsp_maths::dsp_sin_cos(pi*hz/rate,&sn,&cs);a=(sn-cs)/(sn+cs);}
          s.a=soemdsp::math::clamp11(a*directionFactor);s.b=__builtin_sqrt(1-s.a*s.a);
        }
        // Orthogonal lattice scattering: y*y + stateNext*stateNext = x*x + state*state.
        const double y=s.a*x+s.b*s.state;
        s.state=s.b*x-s.a*s.state;x=y;
        if(i+1==current)old=x;if(i+1==next)fresh=x;
      }
      const double wet=changing?old+blend*(fresh-old):old;
      output[c]=inputs[c]+soemdsp::math::clamp01(mix)*(wet-inputs[c]);
    }
    if(ratioRamp)--ratioRamp;
    if(changing) {
      fade+=1/(.05*rate);
      if(fade>=1) {
        current=next;changing=false;
        for(auto& channel:stages)for(int i=current;i<maximum;++i)channel[i].state=0;
      }
    }
    right=output[1];if(!__builtin_isfinite(output[0])||!__builtin_isfinite(right)){reset();error=1;return 0;}
    return output[0];
  }
};
State* pool[capacity]{};
State* get(int h){return h>0&&h<=capacity?pool[h-1]:nullptr;}
const char metadata[]=R"json({"module":"dispersion","targetType":"dispersion","label":"Dispersion","kind":"effect","inputs":["In","Left","Right","f"],"outputs":["Mono","Left","Right","Error"],"parameters":[
{"key":"frequency","label":"Frequency","kind":"frequency","defaultValue":"300","min":"10","mid":"300","max":"10000","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"Geometric center of allpass corner frequencies in Hz. Wired f replaces the knob, including zero; negative uses magnitude. Low Late concentrates delay toward DC; High Late mirrors the response toward Nyquist, so the corner is measured from that edge. Not a narrow resonant peak or a pitch detector."},
{"key":"stages","label":"Stages","defaultValue":"32","min":"0","mid":"32","max":"128","step":"1","linearSmoothing":false,"tooltip":"Number of normalized first-order allpass lattice stages, 0..128. Zero is a wire. More stages increase phase rotation and group delay, not gain. Count edits crossfade output taps over 50 ms; only removed stages are cleared after the fade. Fixed-count wet processing is allpass; tap fades and dry/wet mixes can comb-filter."},
{"key":"spreadOct","label":"Frequency Spread","defaultValue":"2","min":"0","mid":"2","max":"8","step":"any","unit":"oct","tooltip":"Total octave span of stage corner frequencies around Frequency. Zero tunes every stage alike; larger spans distribute frequency-dependent delay more broadly. No delay lines, FFT windows or IR samples."},
{"key":"curve","label":"Distribution Curve","defaultValue":"0","min":"-1","mid":"0","max":"1","step":"any","tooltip":"Rational contour for distributing stage corners across Frequency Spread. Zero distributes uniformly in octaves; positive crowds corners toward the high end, negative toward the low end. Changes ramp geometry over 10 ms."},
{"key":"direction","label":"Direction","kind":"choice","choices":["Low Late","High Late"],"choiceKeys":["lowLate","highLate"],"choiceIds":[0,1],"defaultValue":"lowLate","min":"0","mid":"0.5","max":"1","step":"1","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Low Late delays low frequencies more; High Late reflects the allpass coefficients so delay concentrates toward Nyquist. Does not reverse recorded audio or introduce negative delay. Direction changes ramp coefficients over 10 ms through valid lattice rotations."},
{"key":"stereoOct","label":"Stereo Offset","defaultValue":"0","min":"-2","mid":"0","max":"2","step":"any","unit":"oct","tooltip":"Signed octave difference between right and left stage tuning. Zero gives identical processing with independent channel states. Nonzero offsets turn mono excitation into different stereo phase/time shapes; mono summing may cancel frequencies."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Immediate dry/wet blend. Fully wet static processing preserves spectral magnitude while changing phase and group delay. Mixing dry and wet intentionally produces comb coloration. Zero buffering latency, no lookahead, no automatic gain, limiter or clipping."}
]})json";
}
extern "C" int soemdsp_dispersion_create(){for(int i=0;i<capacity;++i)if(!pool[i]){auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));if(!s)return 0;s->reset();pool[i]=s;return i+1;}return 0;}
extern "C" void soemdsp_dispersion_destroy(int h){if(auto* s=get(h)){soemdsp::memory_pool::release(s);pool[h-1]=nullptr;}}
extern "C" void soemdsp_dispersion_reset(int h){if(auto* s=get(h))s->reset();}
extern "C" double soemdsp_dispersion_sample(int h,double l,double r,double f,double spread,double curve,double stereo,double mix,int count,int direction,double rate){auto* s=get(h);return s?s->tick(l,r,f,spread,curve,stereo,mix,count,direction,rate):0;}
extern "C" double soemdsp_dispersion_right(int h){auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_dispersion_error(int h){auto* s=get(h);return s?s->error:1;}
extern "C" double soemdsp_dispersion_state_energy(int h){auto* s=get(h);double e=0;if(s)for(auto& c:s->stages)for(auto& stage:c)e+=stage.state*stage.state;return e;}
extern "C" double soemdsp_dispersion_group_delay_ms(int h,int channel,double hz){
 auto* s=get(h);if(!s||channel<0||channel>1||!__builtin_isfinite(hz)||!s->lastRate)return 0;
 double sn,cs;soemdsp_maths::dsp_sin_cos(2*pi*hz/s->lastRate,&sn,&cs);double delay=0;
 for(int i=0;i<s->current;++i){const auto& stage=s->stages[channel][i];const double d=1+stage.a*stage.a+2*stage.a*cs;if(d>1e-20)delay+=stage.b*stage.b/d;}
 return delay*1000/s->lastRate;
}
extern "C" int soemdsp_dispersion_latency(){return 0;}
extern "C" int soemdsp_dispersion_version(){return 1;}
extern "C" const char* soemdsp_dispersion_metadata_json(){return metadata;}
extern "C" int soemdsp_dispersion_metadata_json_size(){return sizeof(metadata)-1;}
