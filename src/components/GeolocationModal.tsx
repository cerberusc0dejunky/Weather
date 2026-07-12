import { MapPin, Compass, Settings, ShieldCheck, AlertTriangle } from 'lucide-react';

interface GeolocationModalProps {
  onAccept: () => void;
  onDecline: () => void;
}

export default function GeolocationModal({ onAccept, onDecline }: GeolocationModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[300] flex items-center justify-center p-6" id="location-modal">
      <div className="bg-slate-900 border-2 border-neon-aqua rounded-3xl p-8 max-w-sm w-full shadow-[0_0_25px_rgba(0,255,255,0.4)] transition-all animate-in fade-in zoom-in-95 duration-300 text-center">
        <div className="w-16 h-16 bg-slate-950 border border-neon-pink rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_15px_rgba(255,105,180,0.4)]">
          <MapPin className="w-8 h-8 text-neon-pink" />
        </div>
        
        <h2 className="text-2xl font-black mb-2 text-white bg-clip-text font-sans tracking-wide uppercase">
          Enable Precise Tracking
        </h2>
        
        <p className="text-slate-400 text-sm font-semibold mb-6 leading-relaxed">
          DAISY calculates real-time distances between your current coordinates and active tornado warning polygons to keep you informed of threats.
        </p>

        {/* Local Security & Refresh Risk Disclosure */}
        <div className="border border-slate-800 bg-slate-950/40 rounded-xl p-4 text-left text-[11px] text-slate-400 space-y-2 mb-6">
          <div>
            <p className="font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              Privacy Protection
            </p>
            <p className="leading-relaxed mt-0.5">
              Warning computations and GPS tags run purely within your sandboxed browser. No location metrics are aggregated, transmitted, or stored on external servers.
            </p>
          </div>
          <div className="border-t border-slate-800 pt-2">
            <p className="font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              Transient Client State
            </p>
            <p className="leading-relaxed mt-0.5">
              Refresh means reset no browser history saved but we do need your location to give you proximity alerts.
            </p>
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <button
            id="geo-accept-btn"
            onClick={onAccept}
            className="w-full bg-slate-950 border border-neon-aqua text-neon-aqua font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-neon-aqua hover:text-slate-950 hover:shadow-[0_0_20px_rgba(0,255,255,0.6)] active:scale-95 transition-all cursor-pointer font-sans"
          >
            Enable Precise Position
          </button>
          
          <button
            id="geo-decline-btn"
            onClick={onDecline}
            className="w-full bg-transparent text-slate-500 hover:text-slate-300 text-xs font-bold py-3 rounded-xl uppercase transition-colors cursor-pointer font-mono"
          >
            Skip - Use Home Default
          </button>
        </div>
      </div>
    </div>
  );
}
