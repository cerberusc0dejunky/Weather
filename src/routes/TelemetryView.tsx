import React from 'react';
import { useOutletContext } from 'react-router';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import SafeResponsiveContainer from '../components/SafeResponsiveContainer';
import WindGauge from '../components/WindGauge';
import PressureBaroTooltip from '../components/PressureBaroTooltip';
import { Activity, Thermometer, Wind, Gauge, Compass, TrendingUp, TrendingDown, Cloud, Flame } from 'lucide-react';

export default function TelemetryView() {
  const context = useOutletContext<any>();
  const {
    telemetry,
    pressureHistory,
    windyPointTelemetry,
    capeHistory,
    forecastTrend,
    fetchTelemetryAnalysis,
    setShowTornadogenesisModal,
    showMDInputForm,
    setShowMDInputForm,
    newMDText,
    setNewMDText,
    handleAddCustomMD,
    discussions,
    expandedMDId,
    setExpandedMDId,
    handleFocusMD,
  } = context;

  return (
    <div className="flex flex-col gap-6 items-stretch">
      {/* 3. Ground Surface Air Telemetry (NWS ASOS) & Local Forecast trends (Unified ASOS & Bypass Dashboard) */}
      <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-sm transition-colors flex flex-col justify-between" aria-label="NWS Telemetry and Forecast Microclimate Analysis">
        <div>
          <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
            Ground Surface Air Telemetry (NWS ASOS) & Local Microclimate Trends
          </h3>
          
          {telemetry ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                  <Thermometer className="w-7 h-7 text-rose-500 dark:text-neon-pink shrink-0" />
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Temp / Dew</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block">
                      {telemetry.temperature ? `${telemetry.temperature}°F` : 'N/A'}{' '}
                      <span className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold">({telemetry.dewPoint || '--'}°)</span>
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                  <Wind className="w-7 h-7 text-cyan-600 dark:text-neon-aqua shrink-0" />
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Surf Wind</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block uppercase">
                      {telemetry.windSpeed ? `${telemetry.windSpeed} mph` : 'Calm'}
                      {telemetry.windGust && (
                        <span className="text-rose-500 dark:text-neon-pink text-[10px] font-bold block">G: {telemetry.windGust} mph</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                  <Gauge className="w-7 h-7 text-slate-400 dark:text-white/50 shrink-0" />
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Baro Pres</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block uppercase">
                      {telemetry.pressure ? `${telemetry.pressure} InHg` : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                  <Compass className="w-7 h-7 text-indigo-500 dark:text-indigo-400 shrink-0 animate-[spin_12s_linear_infinite]" />
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Weather</span>
                    <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 mt-1 block truncate max-w-[110px] uppercase">
                      {telemetry.textDescription || 'Stable conditions'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                  <TrendingUp className="w-7 h-7 text-amber-500 dark:text-amber-400 shrink-0" />
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Forecast H/L</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block uppercase">
                      {telemetry.highTemp && telemetry.lowTemp ? `${telemetry.highTemp} / ${telemetry.lowTemp}` : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                  <Cloud className="w-7 h-7 text-blue-500 dark:text-blue-400 shrink-0" />
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Precip Prob</span>
                    <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block uppercase">
                      {telemetry.probPrecip || '0%'}
                    </span>
                  </div>
                </div>
              </div>

              {pressureHistory && pressureHistory.length > 0 && (
                <div className="mt-3 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 transition-colors">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 mb-2">
                    <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center gap-1 font-sans">
                      <Gauge className="w-3 h-3 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                      Barometric Decay (Last 6 Polls)
                    </span>
                    {pressureHistory.length >= 2 && (
                      <div className="text-[8px] font-extrabold uppercase tracking-widest font-mono">
                        {pressureHistory[pressureHistory.length - 1].pressure < pressureHistory[0].pressure ? (
                          <span className="text-amber-500 dark:text-amber-400">
                            DECAY: -{(pressureHistory[0].pressure - pressureHistory[pressureHistory.length - 1].pressure).toFixed(2)} InHg
                          </span>
                        ) : (
                          <span className="text-teal-500">BAROMETER STABLE</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="h-20 w-full mt-1">
                    <SafeResponsiveContainer minWidth={100} minHeight={80} loadingLabel="CALIBRATING BARO VIEWPORT...">
                      <AreaChart
                        data={pressureHistory}
                        margin={{ top: 2, right: 5, left: -32, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="pressureGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0891b2" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#0891b2" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} vertical={false} />
                        <XAxis
                          dataKey="time"
                          tick={{ fill: '#64748b', fontSize: 7, fontFamily: 'monospace' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          domain={['dataMin - 0.05', 'dataMax + 0.05']}
                          tick={{ fill: '#64748b', fontSize: 7, fontFamily: 'monospace' }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(val) => val.toFixed(2)}
                        />
                        <Tooltip content={<PressureBaroTooltip />} cursor={{ stroke: '#0891b2', strokeWidth: 1, strokeDasharray: '4 4' }} />
                        <Area
                          type="monotone"
                          dataKey="pressure"
                          stroke="#0891b2"
                          strokeWidth={1.5}
                          fillOpacity={1}
                          fill="url(#pressureGrad)"
                          activeDot={{ r: 3, strokeWidth: 0, fill: '#06b6d4' }}
                        />
                      </AreaChart>
                    </SafeResponsiveContainer>
                  </div>
                </div>
              )}

              <WindGauge
                windSpeed={telemetry.windSpeed}
                windGust={telemetry.windGust}
              />
            </>
          ) : (
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[9px] uppercase text-center rounded-xl">
              Synchronizing closest station observational grids...
            </div>
          )}
        </div>

        <hr className="border-slate-200 dark:border-slate-800/80 my-5" />

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2">
            <div>
              <h4 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                D.A.I.S.Y. Microclimate Forecast Trends & Storm Bypass Index
              </h4>
              <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 uppercase font-mono">
                Thermodynamic course & intensity prediction computed over 6-hour trailing metrics
              </p>
            </div>
            <div className={`px-3 py-1 rounded-xl text-xs font-bold border flex items-center gap-2 uppercase tracking-wider ${forecastTrend.badgeColor} ${forecastTrend.shadowColor} mt-2 sm:mt-0`}>
              <span className="w-2 h-2 rounded-full bg-current animate-pulse"></span>
              {forecastTrend.status}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block font-mono">
                  Environment Diagnostic
                </span>
                <p className="text-slate-800 dark:text-white font-black text-lg md:text-xl font-sans tracking-tight leading-snug">
                  {forecastTrend.trendLabel}
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold leading-relaxed">
                  {forecastTrend.statusDesc}
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 p-4 border border-slate-200 dark:border-slate-800/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 block leading-none font-mono mb-1">
                    Bypass / Shield Probability
                  </span>
                  <span className={`text-xl font-black ${forecastTrend.textColor}`}>
                    {forecastTrend.bypassChance}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 leading-relaxed max-w-xs font-semibold uppercase font-mono">
                  Severe cells may change course, split, or fail completely when encountering local stable air masses.
                </div>
              </div>

              <button
                type="button"
                id="open-vtp-modal-btn"
                onClick={() => {
                  fetchTelemetryAnalysis();
                  setShowTornadogenesisModal(true);
                }}
                className="w-full py-3 px-4 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 hover:border-cyan-400 dark:hover:border-neon-aqua hover:text-cyan-600 dark:hover:text-neon-aqua text-slate-800 dark:text-slate-200 font-black uppercase text-[10px] tracking-wider rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm"
              >
                <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
                <span>View Tornadogenesis Probability (EXPERIMENTAL)</span>
              </button>
            </div>

            <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-32 transition-transform hover:scale-[1.01]">
                <div className="flex justify-between items-start">
                  <span className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider font-mono">
                    Surface Pressure Change
                  </span>
                  <Gauge className="w-4.5 h-4.5 text-cyan-600 dark:text-neon-aqua" />
                </div>
                <div>
                  <div className="text-2xl font-black text-slate-800 dark:text-white flex items-baseline gap-1 font-mono">
                    {forecastTrend.pressureDeltaText}
                    {forecastTrend.deltaPressure < -0.01 ? (
                      <TrendingDown className="w-5 h-5 text-rose-500 inline shrink-0" />
                    ) : forecastTrend.deltaPressure > 0.01 ? (
                      <TrendingUp className="w-5 h-5 text-teal-500 inline shrink-0" />
                    ) : null}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 block font-mono">
                    Trend: {forecastTrend.pressureDirection}
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-32 transition-transform hover:scale-[1.01]">
                <div className="flex justify-between items-start">
                  <span className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider font-mono">
                    Convective Availability
                  </span>
                  <Compass className="w-4.5 h-4.5 text-rose-500 dark:text-neon-pink animate-[spin_20s_linear_infinite]" />
                </div>
                <div>
                  <div className="text-2xl font-black text-slate-800 dark:text-white flex items-baseline gap-1 font-mono">
                    {forecastTrend.capeDeltaText}
                    {forecastTrend.currentCapeVal > 1500 ? (
                      <TrendingUp className="w-5 h-5 text-rose-500 inline shrink-0" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-teal-500 inline shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 block font-mono">
                    Analysis: {forecastTrend.capeDirection}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {telemetry && (
          <div className="flex justify-between items-center text-[8px] font-mono font-semibold text-slate-400 dark:text-slate-600 mt-5 pt-2 border-t border-slate-200 dark:border-slate-800/50">
            <span>STATION METAR ID: {telemetry.stationId}</span>
            <span>SYNCED: {telemetry.timestamp || 'STABLE'}</span>
          </div>
        )}
      </section>

      {/* SPC Mesoscale Discussions Listings Section */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white font-sans tracking-wide uppercase flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-500 dark:text-amber-400 animate-pulse" />
            SPC Mesoscale Convective Discussions
          </h2>
          
          <button
            onClick={() => setShowMDInputForm(!showMDInputForm)}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-905 border border-slate-300 dark:border-slate-800 hover:border-amber-500 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-sans"
          >
            {showMDInputForm ? 'Close Input Panel' : 'Feed Custom SPC Text'}
          </button>
        </div>

        {/* Collapsible custom input board */}
        {showMDInputForm && (
          <div className="bg-white dark:bg-slate-900 border border-amber-500/30 rounded-3xl p-5 shadow-inner transition-all">
            <h4 className="text-xs font-black uppercase text-amber-600 dark:text-amber-400 font-sans tracking-wide mb-2">
              Manual Forecast Segment Direct Infiltration (MCD Parser)
            </h4>
            <p className="text-[10px] text-slate-400 mb-4 font-semibold uppercase tracking-wider">
              Paste the full SPC Mesoscale Discussion raw text below (must contain the "LAT...LON" block at the end).
            </p>
            
            <textarea
              id="newMDText"
              name="newMDText"
              value={newMDText}
              onChange={(e) => setNewMDText(e.target.value)}
              placeholder="Mesoscale Discussion 1014... \n\n LAT...LON   34079493 34539504 ..."
              rows={8}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-700 font-mono text-xs p-4 rounded-2xl focus:border-amber-500 focus:ring-0 outline-none"
            />
            
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  handleAddCustomMD(newMDText);
                  setNewMDText('');
                  setShowMDInputForm(false);
                }}
                className="px-4 py-2 bg-amber-500 text-slate-950 hover:bg-amber-400 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Parse & Overlay Corridor
              </button>
            </div>
          </div>
        )}

        {/* Discussions Cards Deck */}
        {discussions.length === 0 ? (
          <div className="bg-white dark:bg-slate-900/10 border-2 border-dashed border-slate-200 dark:border-slate-800/85 rounded-3xl p-10 text-center shadow-sm">
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest leading-relaxed">
              Loading Storm Prediction Center Discussions...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {discussions.map((md: any) => {
              const isExpanded = expandedMDId === md.id;
              
              let probColorClass = 'text-green-500 border-green-200 bg-green-50/50 dark:bg-green-950/10 dark:border-green-950/10';
              if (md.probability >= 70) {
                probColorClass = 'text-red-500 border-red-200 bg-red-50/50 dark:bg-red-950/10 dark:border-red-950/10';
              } else if (md.probability >= 40) {
                probColorClass = 'text-amber-500 border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 dark:border-amber-950/10';
              }
              
              return (
                <div
                  key={md.id}
                  className={`bg-white dark:bg-slate-900 border ${
                    md.isIntersecting
                      ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/30'
                      : 'border-slate-200 dark:border-slate-800/80'
                  } rounded-3xl p-6 flex flex-col justify-between transition-all`}
                >
                  <div>
                    {/* Top Meta info */}
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-amber-500 text-slate-950 text-[9px] font-black uppercase rounded">
                            SPC MCD #{md.number}
                          </span>
                          {md.isIntersecting && (
                            <span className="px-2 py-0.5 bg-rose-600 text-white text-[9px] font-black uppercase rounded animate-pulse">
                              Intersects base
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase font-sans tracking-tight mt-2 leading-none">
                          MCD {md.number}
                        </h3>
                      </div>
                      
                      <div className={`px-3 py-1.5 border rounded-xl text-center flex flex-col items-center justify-center shrink-0 ${probColorClass}`}>
                        <span className="text-[14px] font-black font-sans leading-none">{md.probability}%</span>
                        <span className="text-[7px] font-bold uppercase tracking-widest mt-0.5">Watch Probability</span>
                      </div>
                    </div>

                    {/* Sub details */}
                    <div className="space-y-1.5 mt-4">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Affecting:</span>
                        <span className="truncate">{md.areasAffected}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Valid:</span>
                        <span>{md.validTime}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Proximity:</span>
                        <span className={md.isIntersecting ? 'text-red-500 font-extrabold' : ''}>
                          {md.isIntersecting ? 'Direct Grid Overlapping' : `${md.minDist.toFixed(1)} miles away`}
                        </span>
                      </div>
                    </div>

                    {/* Summary Paragraph */}
                    <p className="mt-4 text-xs font-semibold leading-relaxed text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-4 border border-slate-200 dark:border-slate-800/60 rounded-2xl">
                      {md.summary}
                    </p>

                    {/* Collapsible raw text block */}
                    {isExpanded && (
                      <div className="mt-4 bg-slate-950 text-slate-200 border border-slate-800/80 text-[10px] p-4 rounded-2xl font-mono whitespace-pre-wrap max-h-[220px] overflow-y-auto leading-relaxed uppercase tracking-wider">
                        {md.text}
                      </div>
                    )}
                  </div>

                  {/* Bottom Action strip */}
                  <div className="flex items-center gap-3 mt-6 border-t border-slate-100 dark:border-slate-800/80 pt-4 shrink-0">
                    <button
                      onClick={() => handleFocusMD(md)}
                      className="px-4 py-2 flex-1 bg-slate-950 text-amber-500 border border-slate-800 hover:border-amber-500 hover:text-amber-400 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer text-center"
                    >
                      Locate Corridor
                    </button>
                    <button
                      onClick={() => setExpandedMDId(isExpanded ? null : md.id)}
                      className="px-4 py-2 flex-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer text-center"
                    >
                      {isExpanded ? 'Hide Details' : 'Read Full Text'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
