import React from 'react';

interface PressureTooltipProps {
  active?: boolean;
  payload?: any[];
}

export default function PressureBaroTooltip({ active, payload }: PressureTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-950 text-slate-100 border border-slate-800 p-2.5 rounded-xl shadow-xl text-[10px] font-mono whitespace-nowrap">
        <div className="font-bold text-slate-400">TIME: {payload[0].payload.time}</div>
        <div className="text-cyan-400 dark:text-cyan-400 font-black mt-0.5">
          PRES: {payload[0].value.toFixed(2)} InHg
        </div>
      </div>
    );
  }
  return null;
}
