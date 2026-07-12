import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { ShieldAlert, Info, TrendingUp, Sparkles, Activity } from 'lucide-react';
import SafeResponsiveContainer from './SafeResponsiveContainer';

interface CapeHistoryPoint {
  time: string;
  timestamp: number;
  cape: number;
  isForecast?: boolean;
}

interface CapeHistoryChartProps {
  history: CapeHistoryPoint[];
  currentCape: number;
  loading?: boolean;
}

export default function CapeHistoryChart({ history, currentCape, loading }: CapeHistoryChartProps) {
  // Determine instability status color and tag
  const getInstabilityLevel = (val: number) => {
    if (val > 2500) {
      return {
        label: 'Extreme Instability',
        desc: 'Violent tornadoes, explosive updrafts, and catastrophic giant hail possible.',
        color: 'text-red-500 dark:text-red-400 border-red-500/30 bg-red-500/10',
        glow: 'shadow-[0_0_15px_rgba(239,68,68,0.2)]',
        accentColor: '#ef4444',
      };
    }
    if (val >= 1000) {
      return {
        label: 'Moderate Instability',
        desc: 'Organized severe storms, strong rotation, and supercells likely if triggered.',
        color: 'text-amber-500 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
        glow: 'shadow-[0_0_15px_rgba(245,158,11,0.2)]',
        accentColor: '#f59e0b',
      };
    }
    return {
      label: 'Stable / Marginal Instability',
      desc: 'Typical showers or weak thunderstorms. Outflows generally non-destructive.',
      color: 'text-emerald-500 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      glow: '',
      accentColor: '#10b981',
    };
  };

  const status = getInstabilityLevel(currentCape);

  // Generate a detailed tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as CapeHistoryPoint;
      const pointStatus = getInstabilityLevel(data.cape);
      return (
        <div className="bg-slate-950/95 border border-slate-800 p-2.5 rounded-xl shadow-2xl backdrop-blur-md text-[10px] space-y-1 font-mono text-slate-100 min-w-[150px] leading-tight select-none">
          <p className="text-slate-400 font-bold uppercase tracking-wider">{data.time}</p>
          <div className="flex justify-between items-center pr-1.5 pt-1 border-t border-slate-900">
            <span className="text-slate-400">CAPE VALUE:</span>
            <span className="font-extrabold text-cyan-400 font-mono">{data.cape} J/kg</span>
          </div>
          <div className="text-[8px] font-black uppercase text-center py-0.5 rounded px-1.5 mt-1 border" style={{ color: pointStatus.accentColor, borderColor: `${pointStatus.accentColor}30`, backgroundColor: `${pointStatus.accentColor}10` }}>
            {pointStatus.label}
          </div>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="h-48 flex flex-col justify-center items-center text-center p-6 border border-slate-200 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/10">
        <Activity className="w-6 h-6 text-cyan-500 dark:text-neon-aqua animate-pulse mb-2" />
        <span className="text-[10px] font-mono uppercase font-black tracking-widest text-slate-400">
          Recompiling Convective Timeline...
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4 border border-slate-200 dark:border-slate-800/80 p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-950/40 transition-colors">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
        <div>
          <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center gap-1.5 font-sans">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-500 dark:text-neon-aqua" />
            Convective Energy History & Trend
          </span>
          <p className="text-[9px] text-slate-400 font-semibold uppercase mt-0.5 font-mono">
            6-Hour Rolling CAPE Index Tracker (J/kg)
          </p>
        </div>

        {/* Instability badge */}
        <div className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border font-mono tracking-widest flex items-center gap-1.5 ${status.color} ${status.glow}`}>
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          {status.label}
        </div>
      </div>

      {/* Recharts Area Chart */}
      <div className="h-32 w-full mt-2 select-none">
        {history && history.length > 0 ? (
          <SafeResponsiveContainer minWidth={100} minHeight={128} loadingLabel="CALIBRATING CAPE GRID VIEWPORT...">
            <AreaChart
              data={history}
              margin={{ top: 5, right: 10, left: -25, bottom: 0 }}
            >
              <defs>
                <linearGradient id="capeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.12} vertical={false} />
              
              <XAxis
                dataKey="time"
                tick={{ fill: '#64748b', fontSize: 8, fontFamily: 'monospace', fontWeight: 'bold' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, (dataMax: number) => Math.max(3000, Math.ceil(dataMax / 500) * 500)]}
                tick={{ fill: '#64748b', fontSize: 8, fontFamily: 'monospace', fontWeight: 'bold' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `${val}`}
              />
              
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#06b6d4', strokeWidth: 1.2, strokeDasharray: '4 4' }} />
              
              {/* Reference line at 1000 J/kg - Severe Potential */}
              <ReferenceLine 
                y={1000} 
                stroke="#f59e0b" 
                strokeWidth={1}
                strokeDasharray="3 3" 
                label={{ 
                  value: 'SEVERE THRESHOLD', 
                  fill: '#f59e0b', 
                  fontSize: 7, 
                  fontFamily: 'monospace',
                  fontWeight: 'black',
                  position: 'top',
                  offset: 4
                }} 
              />

              {/* Reference line at 2500 J/kg - Extreme supercell risk */}
              <ReferenceLine 
                y={2500} 
                stroke="#ef4444" 
                strokeWidth={1}
                strokeDasharray="3 3" 
                label={{ 
                  value: 'EXTREME CONVECTIVE RISK', 
                  fill: '#ef4444', 
                  fontSize: 7, 
                  fontFamily: 'monospace',
                  fontWeight: 'black',
                  position: 'top',
                  offset: 4
                }} 
              />

              <Area
                type="monotone"
                dataKey="cape"
                stroke="#06b6d4"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#capeGrad)"
                activeDot={{ r: 4, strokeWidth: 0, fill: '#22d3ee' }}
              />
            </AreaChart>
          </SafeResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 font-mono text-[9px] uppercase border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            Insufficent history points to plot trend
          </div>
        )}
      </div>

      {/* Dynamic educational threshold analysis panel */}
      <div className="mt-3.5 pt-3.5 border-t border-slate-200 dark:border-slate-800/60 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Dynamic Warning Alert Summary */}
        <div className="flex gap-2.5 items-start p-2.5 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl">
          <Info className="w-4 h-4 text-cyan-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5 leading-tight">
            <span className="text-[9px] font-black uppercase text-slate-700 dark:text-slate-300 block">
              Atmospheric Convective State
            </span>
            <p className="text-[8.5px] text-slate-500 dark:text-slate-400 leading-snug">
              {status.desc}
            </p>
          </div>
        </div>

        {/* Index Quick Reference Guides */}
        <div className="text-[8.5px] font-mono text-slate-400 dark:text-slate-500 space-y-1.5 flex flex-col justify-center leading-none">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span className="font-bold text-slate-600 dark:text-slate-300">0 - 1000 J/kg</span>
            <span>Stable or weak instability</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span className="font-bold text-slate-600 dark:text-slate-300">1000 - 2500 J/kg</span>
            <span className="text-amber-500/90 font-bold">Moderate severe trigger environment</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
            <span className="font-bold text-slate-600 dark:text-slate-300">&gt; 2500 J/kg</span>
            <span className="text-rose-500/90 font-bold">Explosive storm updrafts probable</span>
          </div>
        </div>
      </div>
    </div>
  );
}
