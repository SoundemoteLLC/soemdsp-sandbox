// soemdsp-native-module: spectral_warp
// soemdsp-native-label: Spectral Shift / Warp
// soemdsp-native-target: spectralWarp
// soemdsp-native-kind: effect
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/atan2.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int maximum=16384,bins=maximum/2+1,capacity=64;
constexpr double pi=3.14159265358979323846,twoPi=2*pi;
soemdsp::fft::Radix2<512> f512{};
soemdsp::fft::Radix2<1024> f1024{};
soemdsp::fft::Radix2<2048> f2048{};
soemdsp::fft::Radix2<4096> f4096{};
soemdsp::fft::Radix2<8192> f8192{};
soemdsp::fft::Radix2<maximum> f16384{};
bool validSize(int n){return n==512||n==1024||n==2048||n==4096||n==8192||n==16384;}
void prepare(){f512.ensure();f1024.ensure();f2048.ensure();f4096.ensure();f8192.ensure();f16384.ensure();}
void transform(int n,float* re,float* im,bool inverse){
  switch(n){case 512:f512.transform(re,im,inverse);break;case 1024:f1024.transform(re,im,inverse);break;
    case 2048:f2048.transform(re,im,inverse);break;case 4096:f4096.transform(re,im,inverse);break;
    case 8192:f8192.transform(re,im,inverse);break;default:f16384.transform(re,im,inverse);break;}
}
double wrap(double phase){return phase-twoPi*__builtin_floor((phase+pi)/twoPi);}
double unit(double x){return x<0?0:x>1?1:x;}
struct Settings{double shift=0,warp=1,pivot=1000,rate=48000,pitch=0,ratio=1,stereo=0;};
double mapped(double hz,const Settings& s,int channel){
  const double warped=s.warp==1?hz:(hz>0?s.pivot*soemdsp_maths::dsp_exp(s.warp*soemdsp_maths::dsp_ln(hz/s.pivot)):0);
  return warped*s.ratio+s.shift+(channel?.5:-.5)*s.stereo;
}
struct Core{
  float input[2][maximum],ola[2][maximum],window[maximum];
  float re[maximum],im[maximum],outRe[maximum],outIm[maximum];
  float prevRe[2][bins],prevIm[2][bins];
  double correction[2][bins],nextCorrection[bins],power[bins];
  int peaks[bins];
  int size,position,hop;bool first,fault;double right;
  void reset(int n){
    size=n;position=hop=0;first=true;fault=false;right=0;
    for(int j=0;j<maximum;++j){
      const int k=j<n?(j<n/2?j:n-j)*(maximum/n):0;
      window[j]=j>=n?0:j==n/2?1:.5f-.5f*f16384.twRe[k];
      for(int c=0;c<2;++c)input[c][j]=ola[c][j]=0;
    }
    for(int c=0;c<2;++c)for(int k=0;k<bins;++k)prevRe[c][k]=prevIm[c][k]=correction[c][k]=0;
  }
  double peakFrequency(int c,int k,const Settings& s)const{
    const double hz=(double)k*s.rate/size;
    if(k==0||k==size/2||first)return hz;
    const double a=prevRe[c][k],b=prevIm[c][k];
    if(a*a+b*b<=1e-24)return hz;
    const double dr=re[k]*a+im[k]*b,di=im[k]*a-re[k]*b;
    const int q=k%4;const double cr=q==0?1:q==2?-1:0,ci=q==1?1:q==3?-1:0;
    const double residual=soemdsp::math::atan2_approx(di*cr-dr*ci,dr*cr+di*ci);
    return hz+residual*s.rate/(twoPi*(size/4));
  }
  bool frame(const Settings& s){
    const int count=size/2+1;const double df=s.rate/size;
    for(int c=0;c<2;++c){
      // Center the FFT at time zero so fractional region translation does not cancel adjacent bins.
      for(int j=0;j<size;++j){const int t=(j+size/2)%size;re[j]=input[c][(position+1+t)%size]*window[t];im[j]=0;outRe[j]=outIm[j]=0;}
      transform(size,re,im,false);
      int peakCount=0,biggest=0;
      for(int k=0;k<count;++k){
        power[k]=(double)re[k]*re[k]+(double)im[k]*im[k];if(!__builtin_isfinite(power[k]))return false;
        if(power[k]>power[biggest])biggest=k;
      }
      for(int k=0;k<count;++k)if(power[k]>0&&(k==0||power[k]>power[k-1])&&(k==count-1||power[k]>=power[k+1]))peaks[peakCount++]=k;
      if(!peakCount)peaks[peakCount++]=biggest;
      int left=0;
      for(int p=0;p<peakCount;++p){
        const int peak=peaks[p],right=p+1<peakCount?(peak+peaks[p+1])/2:count-1;
        const double hz=peakFrequency(c,peak,s),target=mapped(hz,s,c),delta=(target-hz)/df;
        const double phase=wrap(correction[c][peak]+(first?0:twoPi*(target-hz)*(size/4)/s.rate));
        double sn=0,cs=1;if(__builtin_isfinite(phase))soemdsp_maths::dsp_sin_cos(phase,&sn,&cs);
        const bool neutral=s.shift+(c?.5:-.5)*s.stereo==0&&s.warp==1&&s.ratio==1;
        const bool valid=neutral||(__builtin_isfinite(target)&&target>=0&&target<=s.rate*.5);
        for(int k=left;k<=right;++k){
          nextCorrection[k]=__builtin_isfinite(phase)?phase:0;
          const double dest=k+delta;
          if(!valid||dest<0||dest>count-1)continue;
          const int j=(int)dest;const double fraction=dest-j;
          const double ar=re[k]*cs-im[k]*sn,ai=re[k]*sn+im[k]*cs;
          // Preserve real-signal DC/Nyquist versus doubled interior-bin normalization.
          for(int tap=0;tap<2;++tap){
            const int out=j+tap;if(out>=count)continue;
            const double weight=tap?fraction:1-fraction;if(weight==0)continue;
            const bool srcEdge=k==0||k==count-1,dstEdge=out==0||out==count-1;
            const double scale=(srcEdge?1.0:2.0)/(dstEdge?1.0:2.0);
            outRe[out]+=(float)(weight*scale*ar);outIm[out]+=(float)(weight*scale*ai);
          }
        }
        left=right+1;
      }
      for(int k=0;k<count;++k){
        prevRe[c][k]=re[k];prevIm[c][k]=im[k];correction[c][k]=nextCorrection[k];
        if(k==0||k==count-1)outIm[k]=0;
        else{outRe[size-k]=outRe[k];outIm[size-k]=-outIm[k];}
      }
      transform(size,outRe,outIm,true);
      for(int j=0;j<size;++j){
        const double y=outRe[(j+size/2)%size]*window[j]*(2.0/3);
        if(!__builtin_isfinite(y))return false;
        ola[c][(position+1+j)%size]+=(float)y;
      }
    }
    first=false;return true;
  }
  double tick(double l,double r,const Settings& s){
    fault=false;
    const double out=ola[0][position];right=ola[1][position];ola[0][position]=ola[1][position]=0;
    input[0][position]=(float)l;input[1][position]=(float)r;
    if(++hop==size/4){hop=0;if(!frame(s)){reset(size);fault=true;return 0;}}
    position=(position+1)%size;return out;
  }
};
struct State{
  Core cores[2];Settings settings;float dry[2][maximum+1];
  int desired,current,warm,dryPosition,configError;bool started,changing;
  double fade,right,error;
  void reset(){
    for(auto& c:cores)c.reset(desired);
    for(auto& c:dry)for(auto& v:c)v=0;
    current=warm=dryPosition=0;started=changing=false;fade=right=error=0;
  }
  void initialize(){prepare();settings=Settings{};desired=1024;configError=0;reset();}
  double dryAt(int c,int delay)const{return dry[c][(dryPosition+maximum+1-delay)%(maximum+1)];}
  double tick(double l,double r,double mix,double gainDb){
    const double values[]={l,r,mix,gainDb};
    for(double v:values)if(!__builtin_isfinite(v)){reset();error=1;return 0;}
    if(!__builtin_isfinite((float)l)||!__builtin_isfinite((float)r)){reset();error=1;return 0;}
    if(!started){cores[current].reset(desired);started=true;}
    if(!changing&&cores[current].size!=desired){cores[1-current].reset(desired);warm=desired;fade=0;changing=true;}
    dry[0][dryPosition]=(float)l;dry[1][dryPosition]=(float)r;
    const double a=cores[current].tick(l,r,settings),ar=cores[current].right;
    double outL=dryAt(0,cores[current].size)+unit(mix)*(a-dryAt(0,cores[current].size));
    double outR=dryAt(1,cores[current].size)+unit(mix)*(ar-dryAt(1,cores[current].size));
    error=configError||cores[current].fault?1:0;
    if(changing){
      const auto& next=cores[1-current];const double b=cores[1-current].tick(l,r,settings);
      const double br=cores[1-current].right;
      if(next.fault)error=1;
      if(warm>0)--warm;
      else{
        const double g=fade*fade*(3-2*fade),dl=dryAt(0,next.size),dr=dryAt(1,next.size);
        outL+=g*(dl+unit(mix)*(b-dl)-outL);outR+=g*(dr+unit(mix)*(br-dr)-outR);
        fade+=1/(.05*settings.rate);if(fade>=1){current=1-current;changing=false;}
      }
    }
    dryPosition=(dryPosition+1)%(maximum+1);
    const double gain=soemdsp_maths::dsp_exp(gainDb*.1151292546497023);
    right=outR*gain;outL*=gain;
    if(!__builtin_isfinite(outL)||!__builtin_isfinite(right)){reset();error=1;return 0;}return outL;
  }
};
State* pool[capacity]{};
State* get(int h){return h>0&&h<=capacity?pool[h-1]:nullptr;}
const char metadata[]=R"json({
  "module": "spectral_warp",
  "targetType": "spectralWarp",
  "label": "Spectral Shift / Warp",
  "kind": "effect",
  "inputs": [
    "In",
    "Left",
    "Right"
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
      "defaultValue": "1024",
      "min": "0",
      "mid": "2.5",
      "max": "5",
      "step": "1",
      "unit": "samples",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "STFT window and dry/wet reference delay in samples. Hop is one quarter of size. Small is tighter; large separates nearby partials. Size edits warm a second engine then crossfade for 50 ms. Requests queue the latest size. No automatic host delay compensation."
    },
    {
      "key": "shiftHz",
      "label": "Shift",
      "defaultValue": "0",
      "min": "-2000",
      "mid": "0",
      "max": "2000",
      "step": "any",
      "unit": "Hz",
      "tooltip": "Add this many Hz after nonlinear warping. Positive shifts up; negative shifts down. This is additive frequency shifting, not a semitone pitch control. Frequencies leaving 0..Nyquist are rejected, not folded or wrapped."
    },
    {
      "key": "pitchSemitones",
      "label": "Pitch",
      "defaultValue": "0",
      "min": "-24",
      "mid": "0",
      "max": "24",
      "step": "any",
      "unit": "st",
      "tooltip": "Multiply warped partial frequencies by 2^(Pitch/12), before adding Shift. Warp one and Shift zero give musical transposition. Preserves local peak-region shape, not formant-corrected or transient-perfect pitch shifting. Continuous native smoothing; no fixed semitone range clamp."
    },
    {
      "key": "stereoShiftHz",
      "label": "Stereo Shift",
      "defaultValue": "0",
      "min": "-1000",
      "mid": "0",
      "max": "1000",
      "step": "any",
      "unit": "Hz",
      "tooltip": "Total right-minus-left additive frequency-shift difference in Hz. Left gets -half, right +half, after Warp and Pitch, around the main Shift value. Zero preserves matched stereo processing. Negative reverses sides; out-of-band frequencies are rejected."
    },
    {
      "key": "warp",
      "label": "Warp",
      "defaultValue": "1",
      "min": ".25",
      "mid": "1",
      "max": "4",
      "step": "any",
      "tooltip": "Positive dimensionless exponent: warped = Pivot * (f_in / Pivot)^Warp. Pitch then multiplies it, followed by Shift and per-channel Stereo Shift. One gives linear frequency mapping. Above one spreads partials away from Pivot; below one crowds them. Peak regions retain local phase structure."
    },
    {
      "key": "pivotHz",
      "label": "Pivot",
      "kind": "frequency",
      "defaultValue": "1000",
      "min": "20",
      "mid": "1000",
      "max": "16000",
      "step": "any",
      "unit": "Hz",
      "nonlinearSlider": true,
      "tooltip": "Actual Hz held fixed by Warp before Shift is added. Must be above zero and below Nyquist. Warp one ignores Pivot. Partial frequencies are estimated from frame-to-frame phase; nearby unresolved partials can move together."
    },
    {
      "key": "mix",
      "label": "Mix",
      "defaultValue": "1",
      "min": "0",
      "mid": ".5",
      "max": "1",
      "step": "any",
      "tooltip": "Delayed dry to spectral wet, aligned at the active FFT Size. Partial wet/dry intentionally mixes original and transformed frequencies. FFT changes alter delay during the warmed crossfade."
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
      "tooltip": "Explicit final gain in dB. No hidden amplitude normalization, limiter or clipping. Mapped spectral regions can overlap and add in level."
    }
  ]
})json";
}
extern "C" int soemdsp_spectral_warp_create(){for(int i=0;i<capacity;++i)if(!pool[i]){auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));if(!s)return 0;s->initialize();pool[i]=s;return i+1;}return 0;}
extern "C" void soemdsp_spectral_warp_destroy(int h){if(auto* s=get(h)){soemdsp::memory_pool::release(s);pool[h-1]=nullptr;}}
extern "C" void soemdsp_spectral_warp_reset(int h){if(auto* s=get(h))s->reset();}
extern "C" int soemdsp_spectral_warp_configure(int h,int size,double shift,double warp,double pivot,double rate){
  auto* s=get(h);if(!s)return -1;
  const double v[]={shift,warp,pivot,rate};for(double x:v)if(!__builtin_isfinite(x)){s->configError|=1;return -2;}
  if(!validSize(size)||warp<=0||rate<8000||rate>192000||pivot<=0||pivot>=rate*.5){s->configError|=1;return -2;}
  s->desired=size;if(s->settings.rate!=rate)s->reset();
  s->settings.shift=shift;s->settings.warp=warp;s->settings.pivot=pivot;s->settings.rate=rate;
  s->configError&=~1;return 0;
}
extern "C" int soemdsp_spectral_warp_set_pitch_stereo(int h,double semitones,double stereoHz){
  auto* s=get(h);if(!s)return -1;
  if(!__builtin_isfinite(semitones)||!__builtin_isfinite(stereoHz)){s->configError|=2;return -2;}
  const double ratio=semitones==s->settings.pitch?s->settings.ratio:soemdsp_maths::dsp_exp(semitones*.0577622650466621);
  if(!__builtin_isfinite(ratio)||ratio<=0){s->configError|=2;return -2;}
  s->settings.pitch=semitones;s->settings.ratio=ratio;s->settings.stereo=stereoHz;
  s->configError&=~2;return 0;
}
extern "C" double soemdsp_spectral_warp_sample(int h,double l,double r,double mix,double gainDb){auto* s=get(h);return s?s->tick(l,r,mix,gainDb):0;}
extern "C" double soemdsp_spectral_warp_right(int h){auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_spectral_warp_error(int h){auto* s=get(h);return s?s->error:1;}
extern "C" int soemdsp_spectral_warp_fft_size(int h){auto* s=get(h);return s?(s->started?s->cores[s->current].size:s->desired):0;}
extern "C" int soemdsp_spectral_warp_latency(){return 1024;}
extern "C" int soemdsp_spectral_warp_latency_for_handle(int h){return soemdsp_spectral_warp_fft_size(h);}
extern "C" double soemdsp_spectral_warp_state_bytes(){return sizeof(State);}
extern "C" int soemdsp_spectral_warp_version(){return 1;}
extern "C" const char* soemdsp_spectral_warp_metadata_json(){return metadata;}
extern "C" int soemdsp_spectral_warp_metadata_json_size(){return sizeof(metadata)-1;}
