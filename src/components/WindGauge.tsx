import { Wind, ShieldAlert, ArrowUpRight } from 'lucide-react';

interface WindGaugeProps {
  windSpeed?: string | number;
  windGust?: string | number;
}

export default function WindGauge({ windSpeed, windGust }: WindGaugeProps) {
  const speed = parseFloat(String(windSpeed || '0')) || 0;
  const gust = parseFloat(String(windGust || '0')) || 0;

  // Maximum scale dynamically adjusts, but defaults to at least 80 mph
  const maxScale = Math.max(80, speed * 1.25, gust * 1.25);

  // Helper to convert polar angular coordinates to Cartesian SVG space
  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    // 0 degrees is left (9 o'clock), 180 degrees is right (3 o'clock). Sweep goes clockwise over the top.
    const angleInRadians = (angleInDegrees - 180) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  };

  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ");
  };

  const speedAngle = Math.min(180, Math.max(0, (speed / maxScale) * 180));
  const gustAngle = Math.min(180, Math.max(0, (gust / maxScale) * 180));

  // Concentric arc layout parameters
  const centerX = 120;
  const centerY = 120;
  
  // Gust Arc (Outer ring)
  const outerRadius = 88;
  const gustArcBg = describeArc(centerX, centerY, outerRadius, 0, 180);
  const gustArcFill = gustAngle > 0 ? describeArc(centerX, centerY, outerRadius, 0, gustAngle) : '';

  // Sustained Arc (Inner ring)
  const innerRadius = 72;
  const speedArcBg = describeArc(centerX, centerY, innerRadius, 0, 180);
  const speedArcFill = speedAngle > 0 ? describeArc(centerX, centerY, innerRadius, 0, speedAngle) : '';

  // Wind intensity assessment
  let threatLabel = "Calm / Low";
  let threatBg = "bg-slate-100/50 dark:bg-slate-950 text-slate-500 border-slate-200 dark:border-slate-800";
  let threatColor = "text-slate-500";
  
  const peakWind = Math.max(speed, gust);
  if (peakWind >= 80) {
    threatLabel = "DESTRUCTIVE WIND GUSTS";
    threatBg = "bg-rose-500/10 border-rose-500/20 text-rose-500 dark:text-neon-pink";
    threatColor = "text-rose-500 dark:text-neon-pink";
  } else if (peakWind >= 58) {
    threatLabel = "SEVERE CONVECTIVE WIND";
    threatBg = "bg-amber-500/10 border-amber-500/20 text-amber-500";
    threatColor = "text-amber-500";
  } else if (peakWind >= 40) {
    threatLabel = "HIGH WIND ADVISORY";
    threatBg = "bg-yellow-500/10 border-yellow-500/20 text-yellow-500";
    threatColor = "text-yellow-500";
  } else if (peakWind >= 20) {
    threatLabel = "MODERATE BREEZE";
    threatBg = "bg-cyan-500/10 border-cyan-500/20 text-cyan-600 dark:text-neon-aqua";
    threatColor = "text-cyan-600 dark:text-neon-aqua";
  }

  // Gust Multiplier calculation
  const multiplier = speed > 0 ? (gust / speed) : 0;
  const showMultiplier = gust > speed && speed >= 3;

  return (
    <div className="mt-4 border border-slate-200 dark:border-slate-800/80 p-4 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 transition-all flex flex-col items-center">
      <div className="w-full flex justify-between items-center mb-3">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5 text-cyan-600 dark:text-neon-aqua animate-pulse" />
          Wind Velocity Differential Gauge
        </span>
        <span className="text-[8px] font-black tracking-widest text-slate-400 font-mono uppercase bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded">
          Max: {maxScale} mph
        </span>
      </div>

      <div className="relative w-full max-w-[240px] aspect-[2/1] flex justify-center overflow-hidden">
        <svg viewBox="0 0 240 120" className="w-full h-full">
          {/* Background Track - Outer (Gust / Neon Pink) */}
          <path
            d={gustArcBg}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-slate-200 dark:text-slate-800/40 stroke-linecap-round"
            style={{ strokeLinecap: 'round' }}
          />

          {/* Background Track - Inner (Sustained / Neon Aqua) */}
          <path
            d={speedArcBg}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-slate-200 dark:text-slate-800/40"
            style={{ strokeLinecap: 'round' }}
          />

          {/* Active Fill - Gust (Outer, Rose / neon-pink) */}
          {gustArcFill && (
            <path
              d={gustArcFill}
              fill="none"
              stroke="#ff69b4"
              strokeWidth="8"
              className="stroke-neon-pink"
              style={{ strokeLinecap: 'round', transition: 'stroke-dasharray 0.5s ease-out' }}
            />
          )}

          {/* Active Fill - Sustained (Inner, Cyan / neon-aqua) */}
          {speedArcFill && (
            <path
              d={speedArcFill}
              fill="none"
              stroke="#00ffff"
              strokeWidth="8"
              className="stroke-neon-aqua"
              style={{ strokeLinecap: 'round', transition: 'stroke-dasharray 0.5s ease-out' }}
            />
          )}

          {/* Center Digital Readout */}
          <text
            x="120"
            y="95"
            textAnchor="middle"
            className="font-black font-mono text-[22px] fill-slate-800 dark:fill-white"
          >
            {speed}
            <tspan className="text-xs font-bold text-slate-400 dark:text-slate-600 font-sans"> mph</tspan>
          </text>
          
          <text
            x="120"
            y="112"
            textAnchor="middle"
            className="font-black text-[9px] uppercase tracking-wider fill-slate-500 dark:fill-slate-400 font-sans"
          >
            Sustained Speed
          </text>
        </svg>

        {/* Legend overlays */}
        <div className="absolute left-1 bottom-1 text-[8px] font-black uppercase text-cyan-600 dark:text-neon-aqua flex items-center gap-1 font-sans">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-neon-aqua" />
          Sustained: {speed}
        </div>
        <div className="absolute right-1 bottom-1 text-[8px] font-black uppercase text-rose-500 dark:text-neon-pink flex items-center gap-1 font-sans">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-neon-pink" />
          Peak Gust: {gust || '--'}
        </div>
      </div>

      {/* Numerical Comparison & Threat Diagnosis */}
      <div className="w-full mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="bg-slate-100/60 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800/50 transition-colors">
          <span className="text-[8px] font-black uppercase text-slate-500 dark:text-slate-400 block tracking-wider mb-0.5">
            Gust Differential
          </span>
          <span className="text-xs font-black text-slate-800 dark:text-white font-mono flex items-center justify-center gap-0.5">
            {gust > speed ? `+${(gust - speed).toFixed(0)}` : '0'}
            <span className="text-[9px] font-medium text-slate-500"> mph</span>
          </span>
        </div>

        <div className="bg-slate-100/60 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800/50 transition-colors">
          <span className="text-[8px] font-black uppercase text-slate-500 dark:text-slate-400 block tracking-wider mb-0.5">
            Storm Kinetic Ratio
          </span>
          <span className="text-xs font-black text-slate-800 dark:text-white font-mono flex items-center justify-center gap-0.5">
            {showMultiplier ? (
              <span className="flex items-center text-rose-500 dark:text-neon-pink font-extrabold">
                {multiplier.toFixed(1)}x
                <ArrowUpRight className="w-3 h-3 text-rose-500 dark:text-neon-pink" />
              </span>
            ) : (
              <span className="text-slate-500 font-semibold uppercase text-[8px]">Uniform</span>
            )}
          </span>
        </div>
      </div>

      {/* Threat Level Indicator Bar */}
      <div className={`w-full mt-2.5 p-2 border rounded-lg text-center font-bold text-[9px] tracking-wide uppercase font-sans flex items-center justify-center gap-1.5 ${threatBg}`}>
        <ShieldAlert className={`w-3.5 h-3.5 ${threatColor}`} />
        <span>{threatLabel}</span>
      </div>
    </div>
  );
}
