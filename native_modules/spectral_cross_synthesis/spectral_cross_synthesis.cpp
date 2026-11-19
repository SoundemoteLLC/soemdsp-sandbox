// soemdsp-native-module: spectral_cross_synthesis
// soemdsp-native-label: Spectral Cross-Synthesis
// soemdsp-native-target: spectralCrossSynthesis
// soemdsp-native-kind: effect
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int size=16384, bins=size/2+1, capacity=64;
soemdsp::fft::Radix2<size> fft{};
soemdsp::fft::Radix2<512> fft512{};
soemdsp::fft::Radix2<1024> fft1024{};
soemdsp::fft::Radix2<2048> fft2048{};
soemdsp::fft::Radix2<4096> fft4096{};
soemdsp::fft::Radix2<8192> fft8192{};
void transform(int length,float* re,float* im,bool inverse) {
  switch(length) {
    case 512:fft512.transform(re,im,inverse);break;
    case 1024:fft1024.transform(re,im,inverse);break;
    case 2048:fft2048.transform(re,im,inverse);break;
    case 4096:fft4096.transform(re,im,inverse);break;
    case 8192:fft8192.transform(re,im,inverse);break;
    default:fft.transform(re,im,inverse);break;
  }
}
double unit(double x){return x<0?0:x>1?1:x;}
struct Core {
  float input[4][size], ola[2][size], re[2][size], im[2][size], window[size];
  double envelope[2][2][bins], prefix[2][bins+1];
  int position,hop,windowSize;
  double right,error,lastRate;
  void reset(int length) {
    windowSize=length;
    fft.ensure();
    for(int i=0;i<size;++i) {
      const int j=i<length?(i<length/2?i:length-i)*(size/length):0;
      window[i]=i>=length?0:i==length/2?1:.5f-.5f*fft.twRe[j];
      for(auto& channel:input)channel[i]=0;
      for(auto& channel:ola)channel[i]=0;
    }
    for(auto& channel:envelope)for(auto& donor:channel)for(auto& v:donor)v=0;
    position=hop=0;right=error=lastRate=0;
  }
  double average(int donor,int bin,int radius) const {
    const int bins=windowSize/2+1;
    const int lo=bin>radius?bin-radius:0,hi=bin+radius<bins?bin+radius:bins-1;
    return (prefix[donor][hi+1]-prefix[donor][lo])/(hi-lo+1);
  }
  double envelopeAt(int donor,double index,int radius,double fraction) const {
    const int last=windowSize/2;
    if(index<0||index>last)return 0;
    const int a=(int)index,b=a<last?a+1:a;
    const double t=index-a;
    const double x=average(donor,a,radius)*(1-fraction)+average(donor,a,radius+1)*fraction;
    const double y=average(donor,b,radius)*(1-fraction)+average(donor,b,radius+1)*fraction;
    return x+(y-x)*t;
  }
  bool frame(double amount,double width,double attack,double release,double shift,double rate) {
    const int size=windowSize,bins=size/2+1,hopSize=size/4;
    const double shiftRatio=soemdsp_maths::dsp_exp(shift*.0577622650466621);
    if(!__builtin_isfinite(shiftRatio)||shiftRatio<=0)return false;
    const double ap=attack>0?soemdsp_maths::dsp_exp(-hopSize/(rate*.001*attack)):0;
    const double rp=release>0?soemdsp_maths::dsp_exp(-hopSize/(rate*.001*release)):0;
    double radius=width*.5*size/rate;if(radius>bins-1)radius=bins-1;
    const int r=(int)radius;const double frac=radius-r;
    for(int c=0;c<2;++c) {
      for(int donor=0;donor<2;++donor) {
        for(int i=0;i<size;++i){re[donor][i]=input[2*donor+c][(position+1+i)%size]*window[i];im[donor][i]=0;}
        transform(size,re[donor],im[donor],false);
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
        e[0]=envelopeAt(0,k/shiftRatio,r,frac);
        e[1]=envelopeAt(1,k,r,frac);
        // Only normalize an existing Synth component: never invent phase from silence.
        const double ratio=e[1]>1e-24?__builtin_sqrt((e[0]>0?e[0]:0)/e[1]):0;
        const double gain=1+unit(amount)*(ratio-1);
        re[1][k]*=gain;im[1][k]*=gain;
        if(k==0||k==bins-1)im[1][k]=0;
        else {re[1][size-k]=re[1][k];im[1][size-k]=-im[1][k];}
      }
      transform(size,re[1],im[1],true);
      for(int i=0;i<size;++i) {
        if(!__builtin_isfinite(re[1][i]))return false;
        ola[c][(position+1+i)%size]+=re[1][i]*window[i]*(2.0f/3);
      }
    }
    return true;
  }
  double tick(double vl,double vr,double sl,double sr,double amount,double width,double attack,double release,double mix,double gainDb,double shift,double rate) {
    const int size=windowSize,hopSize=size/4;
    const double values[]={vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,shift,rate};
    for(double v:values)if(!__builtin_isfinite(v)){reset(windowSize);error=1;return 0;}
    if(width<0||attack<0||release<0||rate<8000||rate>192000){right=0;error=1;return 0;}
    if(lastRate&&lastRate!=rate)reset(windowSize);lastRate=rate;error=0;
    const double dryL=input[2][position],dryR=input[3][position],wetL=ola[0][position],wetR=ola[1][position];
    ola[0][position]=ola[1][position]=0;
    const double v[4]={vl,vr,sl,sr};for(int c=0;c<4;++c)input[c][position]=(float)v[c];
    if(++hop==hopSize){hop=0;if(!frame(amount,width,attack,release,shift,rate)){reset(windowSize);error=1;return 0;}}
    position=(position+1)%size;
    const double gain=soemdsp_maths::dsp_exp(gainDb*.1151292546497023);
    const double out=gain*(dryL+unit(mix)*(wetL-dryL));right=gain*(dryR+unit(mix)*(wetR-dryR));
    if(!__builtin_isfinite(out)||!__builtin_isfinite(right)){reset(windowSize);error=1;return 0;}return out;
  }
};
struct State {
  Core cores[2];
  int current,desired,warm,configError;
  double fade,right,error,lastRate,shift;
  bool changing,started;
  void reset() {
    for(auto& core:cores)core.reset(desired);
    current=warm=0;fade=right=error=lastRate=0;changing=started=false;
  }
  void initialize(){desired=2048;shift=0;configError=0;reset();}
  void beginChange() {
    const auto& from=cores[current];auto& to=cores[1-current];to.reset(desired);
    const double scale=(double)to.windowSize/from.windowSize;
    // Envelope power is in unnormalized FFT units: preserve the estimate in Hz.
    for(int c=0;c<2;++c)for(int donor=0;donor<2;++donor)for(int k=0;k<=to.windowSize/2;++k) {
      const double index=k/scale;const int a=(int)index,b=a<from.windowSize/2?a+1:a;
      to.envelope[c][donor][k]=(from.envelope[c][donor][a]+(index-a)*(from.envelope[c][donor][b]-from.envelope[c][donor][a]))*scale*scale;
    }
    warm=to.windowSize;fade=0;changing=true;
  }
  double tick(double vl,double vr,double sl,double sr,double amount,double width,double attack,double release,double mix,double gainDb,double rate) {
    const double values[]={vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,rate};
    for(double v:values)if(!__builtin_isfinite(v)){reset();error=1;return 0;}
    if(lastRate&&lastRate!=rate)reset();lastRate=rate;
    if(!started){cores[current].reset(desired);started=true;}
    if(!changing&&cores[current].windowSize!=desired)beginChange();
    const double a=cores[current].tick(vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,shift,rate);
    right=cores[current].right;error=configError||cores[current].error?1:0;
    if(!changing)return a;
    const double b=cores[1-current].tick(vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,shift,rate);
    if(cores[1-current].error)error=1;
    if(warm>0){--warm;return a;}
    const double g=fade*fade*(3-2*fade),out=a+g*(b-a);
    right+=g*(cores[1-current].right-right);
    fade+=1/(.05*(rate>=8000?rate:48000));
    if(fade>=1){current=1-current;changing=false;}
    return out;
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
      "key": "fftSize",
      "label": "FFT Size",
      "kind": "choice",
      "choices": [
        "512",
        "1024",
        "2048",
        "4096",
        "8192",
        "16384"
      ],
      "choiceKeys": [
        "512",
        "1024",
        "2048",
        "4096",
        "8192",
        "16384"
      ],
      "choiceIds": [
        512,
        1024,
        2048,
        4096,
        8192,
        16384
      ],
      "defaultValue": "2048",
      "min": "0",
      "mid": "2.5",
      "max": "5",
      "step": "1",
      "unit": "samples",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "FFT analysis window and reference delay in samples. Smaller is tighter; larger resolves finer frequency detail and costs more memory/peak CPU. Hop is one quarter of size. At 48 kHz: 512 = 10.67 ms, 2048 = 42.67 ms, 16384 = 341.33 ms. Changes warm and crossfade over 50 ms; rapid edits queue the latest size. No new host delay compensation."
    },
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
      "tooltip": "Full width in Hz of the power-envelope averaging neighborhood. Zero transfers individual-bin magnitudes; wider neighborhoods preserve more Synth harmonic fine structure. Fractional bin widths interpolate continuously. FFT Size sets analysis resolution."
    },
    {
      "key": "formantShift",
      "label": "Formant Shift",
      "defaultValue": "0",
      "min": "-24",
      "mid": "0",
      "max": "24",
      "step": "any",
      "unit": "st",
      "tooltip": "Shift Voice's spectral envelope in semitones. Positive moves formants up; negative moves them down. Synth harmonic frequencies and phases are unchanged. Out-of-band envelope regions become zero, never wrap. Width is measured before shifting."
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
      "tooltip": "Rising spectral power-envelope time constant in milliseconds. Updated each hop (FFT Size / 4). Zero is immediate at frame rate. Both Voice and Synth use this setting."
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
      "tooltip": "Delayed dry Synth to cross-synthesized output, aligned to the active FFT Size. FFT-size edits warm a second engine then crossfade, intentionally changing delay. Voice is not directly mixed into output."
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
extern "C" int soemdsp_spectral_cross_synthesis_create(){for(int i=0;i<capacity;++i)if(!pool[i]){auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));if(!s)return 0;fft.ensure();fft512.ensure();fft1024.ensure();fft2048.ensure();fft4096.ensure();fft8192.ensure();s->initialize();pool[i]=s;return i+1;}return 0;}
extern "C" void soemdsp_spectral_cross_synthesis_destroy(int h){if(auto* s=get(h)){soemdsp::memory_pool::release(s);pool[h-1]=nullptr;}}
extern "C" void soemdsp_spectral_cross_synthesis_reset(int h){if(auto* s=get(h))s->reset();}
extern "C" double soemdsp_spectral_cross_synthesis_sample(int h,double vl,double vr,double sl,double sr,double amount,double width,double attack,double release,double mix,double gainDb,double rate){auto* s=get(h);return s?s->tick(vl,vr,sl,sr,amount,width,attack,release,mix,gainDb,rate):0;}
extern "C" double soemdsp_spectral_cross_synthesis_right(int h){auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_spectral_cross_synthesis_error(int h){auto* s=get(h);return s?s->error:1;}
extern "C" int soemdsp_spectral_cross_synthesis_latency(){return 2048;}
extern "C" int soemdsp_spectral_cross_synthesis_set_fft_size(int h,int length) {
  auto* s=get(h);if(!s)return -1;
  if(length!=512&&length!=1024&&length!=2048&&length!=4096&&length!=8192&&length!=16384){s->configError|=1;return -2;}
  s->desired=length;s->configError&=~1;return 0;
}
extern "C" int soemdsp_spectral_cross_synthesis_set_formant_shift(int h,double semitones) {
  auto* s=get(h);if(!s)return -1;
  if(!__builtin_isfinite(semitones)){s->configError|=2;return -2;}
  s->shift=semitones;s->configError&=~2;return 0;
}
extern "C" int soemdsp_spectral_cross_synthesis_fft_size(int h){auto* s=get(h);return s?(s->started?s->cores[s->current].windowSize:s->desired):0;}
extern "C" int soemdsp_spectral_cross_synthesis_latency_for_handle(int h){return soemdsp_spectral_cross_synthesis_fft_size(h);}
extern "C" int soemdsp_spectral_cross_synthesis_version(){return 2;}
extern "C" const char* soemdsp_spectral_cross_synthesis_metadata_json(){return metadata;}
extern "C" int soemdsp_spectral_cross_synthesis_metadata_json_size(){return sizeof(metadata)-1;}
