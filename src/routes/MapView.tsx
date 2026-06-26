import React from 'react';
import { useOutletContext } from 'react-router';
import RadarMap from '../components/RadarMap';
import { Info, MapPin, Plus, Trash2 } from 'lucide-react';

export default function MapView() {
  const context = useOutletContext<any>();
  const {
    currentLat,
    setCurrentLat,
    currentLon,
    setCurrentLon,
    assets,
    alerts,
    discussions,
    rotationPins,
    mapMode,
    setMapMode,
    customMapKey,
    settings,
    searchQuery,
    setSearchQuery,
    searching,
    handleAddNewPin,
    handleRemovePin,
    fetchTelemetry
  } = context;

  return (
    <div className="flex flex-col gap-6 items-stretch">
      {/* 1. Spatial Interactive Radar Map (Full width) */}
      <div className="w-full">
        <RadarMap
          userLat={currentLat}
          userLon={currentLon}
          assets={assets}
          alerts={alerts}
          activeThreats={alerts.filter((a: any) => a.threatLevel === 'High' || a.threatLevel === 'Extreme')}
          discussions={discussions}
          rotationPins={rotationPins}
          mapMode={mapMode}
          onMapModeChange={setMapMode}
          onSetCoordinates={(lat: number, lon: number) => {
            setCurrentLat(lat);
            setCurrentLon(lon);
          }}
          customMapKey={customMapKey}
          userMaskActive={settings.userMaskActive}
        />
      </div>

      {/* Spatial Interactive Disclaimer Panel */}
      <div className="w-full p-5 bg-rose-50 dark:bg-rose-950/10 border border-rose-200 dark:border-red-500/20 rounded-3xl flex gap-3 text-rose-700 dark:text-red-400 transition-colors">
        <Info className="w-5 h-5 text-rose-600 dark:text-red-500 shrink-0" />
        <p className="text-[10px] font-bold leading-relaxed uppercase tracking-tight">
          Disclaimer: DAISY is built as secondary informational tracking only. Do not rely solely on DAISY for life-safety choices in critical scenarios.
        </p>
      </div>

      {/* 2. Anchor Coordinates Manager (Selected custom locations list under the map) */}
      <div className="w-full">
        <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm transition-colors flex flex-col justify-between" aria-label="Coordinates Manager">
          <div>
            <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-cyan-600 dark:text-neon-aqua" />
              Monitored Coordinates Anchor
            </h3>

            <div className="flex flex-col md:flex-row gap-5 items-start">
              {/* Add Coordinates Search Input */}
              <div className="w-full md:w-1/3 relative shrink-0">
                <input
                  type="text"
                  id="searchQuery"
                  name="searchQuery"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddNewPin()}
                  placeholder="Enter US City, Zip, or Address"
                  disabled={searching}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 font-sans text-xs font-bold py-3 pl-4 pr-10 rounded-xl focus:border-neon-aqua focus:ring-0 outline-none disabled:opacity-50"
                  autoComplete="street-address"
                />
                <button
                  onClick={handleAddNewPin}
                  disabled={searching}
                  className="absolute right-2.5 top-2 p-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-neon-aqua rounded-lg shrink-0 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Active Selected Coordinates List */}
              <div className="w-full md:w-2/3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
                {assets.length === 0 ? (
                  <div className="col-span-full p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-center text-[10px] font-mono font-extrabold tracking-widest text-slate-400 dark:text-slate-500 uppercase">
                    No active tracking anchors
                  </div>
                ) : (
                  assets.map((asset: any) => (
                    <div
                      key={asset.id}
                      onClick={() => {
                        setCurrentLat(asset.lat);
                        setCurrentLon(asset.lon);
                        fetchTelemetry(asset.lat, asset.lon);
                      }}
                      className={`py-2 px-3 border rounded-xl flex items-center justify-between gap-3 font-sans transition-all cursor-pointer ${
                        Math.abs(currentLat - asset.lat) < 0.001 && Math.abs(currentLon - asset.lon) < 0.001
                          ? 'bg-cyan-500/10 border-cyan-500 dark:border-neon-aqua/70 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-705'
                      }`}
                    >
                      <div className="truncate flex-grow">
                        <span className="text-[10px] font-black uppercase text-slate-800 dark:text-white block truncate">
                          {asset.name}
                          {Math.abs(currentLat - asset.lat) < 0.001 && Math.abs(currentLon - asset.lon) < 0.001 && (
                            <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                          )}
                        </span>
                        <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-500 block mt-0.5">
                          LAT: {asset.lat.toFixed(3)}, LON: {asset.lon.toFixed(3)}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePin(asset.id);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-500 dark:hover:text-neon-pink shrink-0 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
