// soemdsp-native-module: spectral_cross_synthesis
// soemdsp-native-label: Spectral Cross-Synthesis
// soemdsp-native-target: spectralCrossSynthesis
// soemdsp-native-kind: effect
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int size=2048, bins=size/2+1, hopSize=size/4, capacity=64;
soemdsp::fft::Radix2<size> fft{};
double unit(double x){return x<0?0:x>1?1:x;}
struct State {
  float input[4][size], ola[2][size], re[2][size], im[2][size], window[size];
  double envelope[2][2][bins], prefix[2][bins+1];
  int position,hop;
  double right,error,lastRate;
  void reset() {
    fft.ensure();
    for(int i=0;i<size;++i) {
      const int j=i<size/2?i:size-i;
      window[i]=i==size/2?1:.5f-.5f*fft.twRe[j];
      for(auto& channel:input)channel[i]=0;
      for(auto& channel:ola)channel[i]=0;
    }
    for(auto& channel:envelope)for(auto& donor:channel)for(auto& v:donor)v=0;
    position=hop=0;right=error=lastRate=0;
  }
  double average(int donor,int bin,int radius) const {
    const int lo=bin>radius?bin-radius:0,hi=bin+radius<bins?bin+radius:bins-1;
    return (prefix[donor][hi+1]-prefix[donor][lo])/(hi-lo+1);
  }
  bool frame(double amount,double width,double attack,double release,double rate) {
    const double ap=attack>0?soemdsp_maths::dsp_exp(-hopSize/(rate*.001*attack)):0;
    const double rp=release>0?soemdsp_maths::dsp_exp(-hopSize/(rate*.001*release)):0;
    double radius=width*.5*size/rate;if(radius>bins-1)radius=bins-1;
    const int r=(int)radius;const double frac=radius-r;
    for(int c=0;c<2;++c) {
      for(int donor=0;donor<2;++donor) {
        for(int i=0;i<size;++i){re[donor][i]=input[2*donor+c][(position+1+i)%size]*window[i];im[donor][i]=0;}
        fft.transform(re[donor],im[donor],false);
        prefix[donor][0]=0;
        for(int k=0;k<bins;++k) {
          const double a=re[donor][k],b=im[donor][k],p=a*a+b*b;
          if(!__builtin_isfinite(p))return false;
          double& v=envelope[c][donor][k];const double pole=p>v?ap:rp;
          v=p+pole*(v-p);prefix[donor][k+1]=prefix[donor][k]+v;
        }
      }
      for(int k=0;k<bins;++k) {
        double e[2];
        for(int donor=0;donor<2;++donor)e[donor]=average(donor,k,r)*(1-frac)+average(donor,k,r+1)*frac;
        // Only normalize an existing Synth component: never invent phase from silence.
        const double ratio=e[1]>1e-24?__builtin_sqrt((e[0]>0?e[0]:0)/e[1]):0;
        const double gain=1+unit(amount)*(ratio-1);
        re[1][k]*=gain;im[1][k]*=gain;
        if(k==0||k==bins-1)im[1][k]=0;
        else {re[1][size-k]=re[1][k];im[1][size-k]=-im[1][k];}
      }
      fft.transform(re[1],im[1],true);
      for(int i=0;i<size;++i) {
        if(!__builtin_isfinite(re[1][i]))return false;
        ola[c][(position+1+i)%size]+=re[1][i]*window[i]*(2.0f/3);
      }
    }
    return true;
  }
  double tick(double vl,double vr,double sl,double sr,double amount,double width,double attack,double release,double mix,double gainDb,double rate) {
    const double values[]={vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,rate};
    for(double v:values)if(!__builtin_isfinite(v)){reset();error=1;return 0;}
    if(width<0||attack<0||release<0||rate<8000||rate>192000){right=0;error=1;return 0;}
    if(lastRate&&lastRate!=rate)reset();lastRate=rate;error=0;
    const double dryL=input[2][position],dryR=input[3][position],wetL=ola[0][position],wetR=ola[1][position];
    ola[0][position]=ola[1][position]=0;
    const double v[4]={vl,vr,sl,sr};for(int c=0;c<4;++c)input[c][position]=(float)v[c];
    if(++hop==hopSize){hop=0;if(!frame(amount,width,attack,release,rate)){reset();error=1;return 0;}}
    position=(position+1)%size;
    const double gain=soemdsp_maths::dsp_exp(gainDb*.1151292546497023);
    const double out=gain*(dryL+unit(mix)*(wetL-dryL));right=gain*(dryR+unit(mix)*(wetR-dryR));
    if(!__builtin_isfinite(out)||!__builtin_isfinite(right)){reset();error=1;return 0;}return out;
  }
};
State* pool[capacity]{};
State* get(int h){return h>0&&h<=capacity?pool[h-1]:nullptr;}
const char metadata[]=R"json({
  "module": "spectral_cross_synthesis",
  "targetType": "spectralCrossSynthesis",
  "label": "Spectral Cross-Synthesis",
  "kind": "effect",
  "inputs": [
    "Voice L",
    "Voice R",
    "Synth L",
    "Synth R"
  ],
  "outputs": [
    "Mono",
    "Left",
    "Right",
    "Error"
  ],
  "parameters": [
    {
      "key": "amount",
      "label": "Transfer",
      "defaultValue": "1",
      "min": "0",
      "mid": ".5",
      "max": "1",
      "step": "any",
      "tooltip": "Spectral-envelope transfer amount. Zero reconstructs Synth; one replaces its broad power envelope with Voice's while retaining Synth fine structure and phase. Not an audio crossfade. Silent Synth stays silent."
    },
    {
      "key": "widthHz",
      "label": "Envelope Width",
      "defaultValue": "300",
      "min": "0",
      "mid": "300",
      "max": "4000",
      "step": "any",
      "unit": "Hz",
      "tooltip": "Full width in Hz of the power-envelope averaging neighborhood. Zero transfers individual-bin magnitudes; wider neighborhoods preserve more Synth harmonic fine structure. Fractional bin widths interpolate continuously. FFT is fixed at 2048 samples, hop 512."
    },
    {
      "key": "attackMs",
      "label": "Attack",
      "defaultValue": "5",
      "min": "0",
      "mid": "10",
      "max": "1000",
      "step": "any",
      "unit": "ms",
      "tooltip": "Rising spectral power-envelope time constant, in milliseconds, measured once per 512-sample hop. Zero is immediate at the frame rate. Both Voice and Synth envelope estimates use this setting."
    },
    {
      "key": "releaseMs",
      "label": "Release",
      "defaultValue": "50",
      "min": "0",
      "mid": "50",
      "max": "2000",
      "step": "any",
      "unit": "ms",
      "tooltip": "Falling spectral power-envelope time constant in milliseconds. Higher values retain the Voice envelope longer, but do not freeze Synth phase or create sound without Synth input."
    },
    {
      "key": "mix",
      "label": "Mix",
      "defaultValue": "1",
      "min": "0",
      "mid": ".5",
      "max": "1",
      "step": "any",
      "tooltip": "Delayed dry Synth to cross-synthesized output. Dry and wet are aligned to the fixed 2048-sample reference delay. Voice is never mixed directly into the output."
    },
    {
      "key": "gainDb",
      "label": "Output Gain",
      "defaultValue": "0",
      "min": "-24",
      "mid": "0",
      "max": "24",
      "step": "any",
      "unit": "dB",
      "tooltip": "Explicit final output gain in dB. No automatic loudness matching, hidden limiter or clipping. Envelope replacement can increase individual spectral components."
    }
  ]
})json";
}
extern "C" int soemdsp_spectral_cross_synthesis_create(){for(int i=0;i<capacity;++i)if(!pool[i]){auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));if(!s)return 0;s->reset();pool[i]=s;return i+1;}return 0;}
extern "C" void soemdsp_spectral_cross_synthesis_destroy(int h){if(auto* s=get(h)){soemdsp::memory_pool::release(s);pool[h-1]=nullptr;}}
extern "C" void soemdsp_spectral_cross_synthesis_reset(int h){if(auto* s=get(h))s->reset();}
extern "C" double soemdsp_spectral_cross_synthesis_sample(int h,double vl,double vr,double sl,double sr,double amount,double width,double attack,double release,double mix,double gainDb,double rate){auto* s=get(h);return s?s->tick(vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,rate):0;}
extern "C" double soemdsp_spectral_cross_synthesis_right(int h){auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_spectral_cross_synthesis_error(int h){auto* s=get(h);return s?s->error:1;}
extern "C" int soemdsp_spectral_cross_synthesis_latency(){return size;}
extern "C" int soemdsp_spectral_cross_synthesis_version(){return 1;}
extern "C" const char* soemdsp_spectral_cross_synthesis_metadata_json(){return metadata;}
extern "C" int soemdsp_spectral_cross_synthesis_metadata_json_size(){return sizeof(metadata)-1;}
