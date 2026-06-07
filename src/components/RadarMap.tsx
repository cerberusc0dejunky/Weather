import { useEffect, useRef, useState } from 'react';
import { LocationAsset, NWSAlert, MesoscaleDiscussion } from '../types';
import { getDistance, getBearing } from '../utils/geoUtils';
import { Compass, Eye, Shield, MapPin, Layers, RefreshCcw } from 'lucide-react';

interface RadarMapProps {
  userLat: number;
  userLon: number;
  assets: LocationAsset[];
  alerts: NWSAlert[];
  discussions?: MesoscaleDiscussion[];
  mapMode: 'radar' | 'gust';
  onMapModeChange: (mode: 'radar' | 'gust') => void;
}

declare global {
  interface Window {
    windyInit?: (options: any, callback: (windyAPI: any) => void) => void;
    windyMap?: any;
    windyStore?: any;
    L?: any;
  }
}

export default function RadarMap({
  userLat,
  userLon,
  assets,
  alerts,
  discussions = [],
  mapMode,
  onMapModeChange,
}: RadarMapProps) {
  const [apiLoaded, setApiLoaded] = useState<boolean>(false);
  const [initError, setInitError] = useState<boolean>(false);
  const windyMapRef = useRef<any>(null);
  const windyStoreRef = useRef<any>(null);
  const polygonLayersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const assetMarkersRef = useRef<any[]>([]);

  // Monitor script presence on mount
  useEffect(() => {
    let checkCount = 0;
    const interval = setInterval(() => {
      checkCount++;
      if (window.windyInit && window.L) {
        setApiLoaded(true);
        clearInterval(interval);
      } else if (checkCount > 15) {
        // Fall back gracefully after 3 seconds of checking
        setInitError(true);
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // Initialize Windy Map or Fallback
  useEffect(() => {
    if (!apiLoaded || initError || !window.windyInit || !window.L) return;

    // Remove any stale container inside #windy to prevent duplicates
    const container = document.getElementById('windy');
    if (container) {
      container.innerHTML = '';
    }

    try {
      const options = {
        // Provided valid developer Map Forecast Windy API key
        key: 'KvQl4qaj2eO8bFGJySVskrZhpgYaMfqQ',
        lat: userLat,
        lon: userLon,
        zoom: 8,
      };

      window.windyInit(options, (windyAPI: any) => {
        const { map, store } = windyAPI;
        windyMapRef.current = map;
        windyStoreRef.current = store;

        // Sync initial map overlay mode
        store.set('overlay', mapMode === 'radar' ? 'radar' : 'wind');

        // Draw overlays
        updateInteractiveElements();
      });
    } catch (err) {
      console.error('Windy Map initialization error:', err);
      setInitError(true);
    }

    return () => {
      cleanupInteractiveElements();
    };
  }, [apiLoaded, initError]);

  // Sync Map Overlay Mode instantly (no reload!)
  useEffect(() => {
    if (windyStoreRef.current) {
      windyStoreRef.current.set('overlay', mapMode === 'radar' ? 'radar' : 'wind');
    }
  }, [mapMode]);

  // Sync Positions and Alert Polygons
  useEffect(() => {
    updateInteractiveElements();
  }, [userLat, userLon, assets, alerts, discussions]);

  const cleanupInteractiveElements = () => {
    const L = window.L;
    const map = windyMapRef.current;
    if (!L || !map) return;

    // Clean storm polygons
    polygonLayersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {}
    });
    polygonLayersRef.current = [];

    // Clean user position marker
    if (userMarkerRef.current) {
      try {
        map.removeLayer(userMarkerRef.current);
      } catch (e) {}
      userMarkerRef.current = null;
    }

    // Clean pinned asset markers
    assetMarkersRef.current.forEach((marker) => {
      try {
        map.removeLayer(marker);
      } catch (e) {}
    });
    assetMarkersRef.current = [];
  };

  const updateInteractiveElements = () => {
    const L = window.L;
    const map = windyMapRef.current;
    if (!L || !map) return;

    cleanupInteractiveElements();

    try {
      // 1. Center map around current active coordinates
      map.setView([userLat, userLon], assets.length > 0 ? 8 : 6);

      // 2. Plot precise user GPS marker with a custom pulsing element
      const userDivIcon = L.divIcon({
        className: 'user-marker-container',
        html: `<div class="user-marker-pulse w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      userMarkerRef.current = L.marker([userLat, userLon], { icon: userDivIcon })
        .addTo(map)
        .bindPopup('<b>Active GPS Gateway</b>');

      // 3. Plot pinned safe locations (Assets)
      assets.forEach((asset) => {
        const assetDivIcon = L.divIcon({
          className: 'asset-marker-container',
          html: `<div class="w-4 h-4 bg-neon-aqua border-2 border-slate-950 rounded-md shadow-pink rotate-45 transform flex items-center justify-center"><div class="w-1.5 h-1.5 bg-slate-950 rounded-full"></div></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });

        const m = L.marker([asset.lat, asset.lon], { icon: assetDivIcon })
          .addTo(map)
          .bindPopup(`<div class="text-slate-950"><h4 class="font-extrabold font-sans text-xs uppercase">${asset.name}</h4><p class="text-[10px] font-mono mt-1">lat/lon: ${asset.lat.toFixed(3)}, ${asset.lon.toFixed(3)}</p></div>`);
        assetMarkersRef.current.push(m);
      });

      // 4. Draw NWS Alert Polygons directly over Windy Live Radar
      alerts.forEach((alert) => {
        if (!alert.geometry || !alert.geometry.coordinates) return;

        let color = '#3b82f6'; // default blue
        if (alert.event.includes('TORNADO')) {
          color = '#ef4444'; // Red
        } else if (alert.event.includes('THUNDERSTORM')) {
          color = '#f97316'; // Orange
        } else if (alert.event.includes('WATCH')) {
          color = '#eab308'; // Yellow
        }

        const layer = L.geoJSON(alert.geometry as any, {
          style: {
            color: color,
            weight: 3,
            fillColor: color,
            fillOpacity: 0.25,
            dashArray: alert.event.includes('WARNING') ? '' : '5, 5',
          },
        })
          .addTo(map)
          .bindPopup(`<div class="text-slate-950 font-sans p-1"><h4 class="font-black text-xs uppercase text-red-600">${alert.event}</h4><p class="text-[10px] mt-1 text-slate-700 leading-tight">${alert.areaDesc}</p></div>`);

        polygonLayersRef.current.push(layer);
      });

      // 5. Draw SPC Mesoscale Convective Discussion Polygons
      if (discussions && discussions.length > 0) {
        discussions.forEach((md) => {
          if (!md.coordinates || md.coordinates.length < 3) return;

          const latlngs = md.coordinates.map((pt) => [pt.lat, pt.lon]);

          const mcdLayer = L.polygon(latlngs, {
            color: '#f59e0b', // Amber
            weight: 3,
            fillColor: '#f59e0b',
            fillOpacity: 0.15,
            dashArray: '6, 6',
          })
            .addTo(map)
            .bindPopup(`<div class="text-slate-950 font-sans p-1">
              <h4 class="font-black text-xs uppercase text-amber-600">SPC Mesoscale Discussion #${md.number}</h4>
              <p class="text-[10px] uppercase font-bold text-slate-500 mt-1">Probability of Watch: ${md.probability}%</p>
              <p class="text-[10px] mt-1 text-slate-700 leading-tight"><b>Areas:</b> ${md.areasAffected}</p>
            </div>`);

          polygonLayersRef.current.push(mcdLayer);
        });
      }
    } catch (e) {
      console.warn('Error rendering elements to Leaflet layer:', e);
    }
  };

  // SVG Fallback Interface: rendered if Windy API script fails to register or loads in highly restricted context
  const renderSvgFallback = () => {
    return (
      <div className="w-full h-full bg-slate-950 border-2 border-neon-aqua/30 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
        {/* Decorative Grid Lines */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:40px_40px] opacity-20 pointer-events-none"></div>

        {/* Floating Scanner Sweep Decoration */}
        <div className="absolute inset-0 bg-gradient-to-t from-neon-aqua/5 via-transparent to-transparent h-1/2 w-full animate-[pulse_3s_infinite] pointer-events-none"></div>

        {/* Fallback Headers */}
        <div className="flex justify-between items-center z-10 bg-slate-900/90 border border-slate-800 p-3 rounded-xl text-white">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-neon-aqua" />
            <span className="text-xs font-black uppercase tracking-wider font-mono">
              Proximity Alert Scanner
            </span>
          </div>
          <div className="text-[10px] bg-slate-950 text-neon-aqua/80 px-2 py-0.5 rounded font-mono font-bold uppercase">
            Standby Mode
          </div>
        </div>

        {/* Vector Positioning Center Grid */}
        <div className="flex-grow flex flex-col items-center justify-center z-10 text-center py-6">
          <div className="relative w-36 h-36 border-4 border-dashed border-neon-pink/40 rounded-full flex items-center justify-center animate-[spin_20s_linear_infinite] mb-4">
            <Compass className="w-16 h-16 text-neon-aqua/80 opacity-60" />
            <div className="absolute w-2 h-2 bg-neon-aqua rounded-full"></div>
          </div>

          <h4 className="text-sm font-black uppercase tracking-widest text-white leading-tight">
            Precision Live Visualizer
          </h4>
          <p className="text-slate-400 text-xs font-semibold max-w-xs mt-1">
            Tracking {assets.length} anchored points of interest against {alerts.length} convective polygons.
          </p>

          <div className="mt-4 flex flex-wrap gap-2 justify-center max-w-sm">
            <div className="text-[10px] bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-blue-500 rounded-full inline-block pulsing-dot"></span>
              <span className="font-bold text-slate-300">USER ({userLat.toFixed(2)}, {userLon.toFixed(2)})</span>
            </div>
            {assets.slice(0, 2).map((a) => (
              <div key={a.id} className="text-[10px] bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-neon-aqua rounded-full inline-block"></span>
                <span className="font-bold text-slate-300 truncate max-w-[100px]">{a.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Distance calculations tracker */}
        <div className="z-10 bg-slate-900/90 border border-slate-800 p-3 rounded-xl divide-y divide-slate-800 font-mono">
          <div className="pb-1.5 flex justify-between text-[10px] font-bold text-slate-400">
            <span>MONITORED ANCHOR</span>
            <span>CLOSEST EDGE RANGE</span>
          </div>
          {assets.length === 0 ? (
            <div className="pt-2 text-[10px] font-semibold text-center text-slate-500 uppercase">
              No locations pinned — system tracking broad warning coverage
            </div>
          ) : (
            assets.slice(0, 3).map((asset) => {
              // Find closest warning distance
              let bestDist = 999;
              alerts.forEach((alert) => {
                if (alert.minDist < bestDist) {
                  bestDist = alert.minDist;
                }
              });

              return (
                <div key={asset.id} className="pt-2 flex justify-between items-center text-xs">
                  <span className="font-bold uppercase text-white tracking-tight truncate max-w-[160px]">{asset.name}</span>
                  <span className="font-black text-neon-pink">
                    {bestDist < 999 ? `${bestDist.toFixed(1)} MILES` : 'CLEARED ZONE'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col neon-border overflow-hidden rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-none transition-colors duration-300">
      {/* Upper Mode Selector Header */}
      <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-800 transition-colors">
        <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-400 tracking-wider flex items-center gap-2">
          <Compass className="w-4 h-4 text-rose-500 dark:text-neon-pink" /> 
          Live Radar Overlays
        </span>
        
        <div className="flex gap-1.5 bg-white dark:bg-slate-950 p-1 rounded-full border border-slate-200 dark:border-slate-800 transition-colors">
          <button
            id="radar-mode-btn"
            onClick={() => onMapModeChange('radar')}
            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              mapMode === 'radar'
                ? 'bg-slate-100 dark:bg-slate-850 border border-neon-aqua/20 dark:border-neon-aqua/40 text-cyan-600 dark:text-neon-aqua shadow-[0_0_8px_rgba(0,255,255,0.15)] dark:shadow-[0_0_8px_rgba(0,255,255,0.2)]'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            Radar Map
          </button>
          
          <button
            id="gust-mode-btn"
            onClick={() => onMapModeChange('gust')}
            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              mapMode === 'gust'
                ? 'bg-slate-100 dark:bg-slate-850 border border-neon-pink/20 dark:border-neon-pink/40 text-rose-500 dark:text-neon-pink shadow-[0_0_8px_rgba(255,105,180,0.15)] dark:shadow-[0_0_8px_rgba(255,105,180,0.2)]'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            Wind Gusts
          </button>
        </div>
      </div>

      {/* Map display field */}
      <div className="h-[320px] md:h-[400px] w-full relative">
        {initError ? (
          renderSvgFallback()
        ) : (
          <div id="windy" className="w-full h-full">
            {/* Display loader until API initialized */}
            {!apiLoaded && (
              <div className="absolute inset-0 bg-slate-950 flex flex-col justify-center items-center text-center p-6 z-20">
                <Compass className="w-12 h-12 text-neon-aqua animate-spin mb-4" />
                <h4 className="text-sm font-black uppercase tracking-wider text-white">
                  Securing Satellite Link
                </h4>
                <p className="text-slate-500 text-[10px] font-mono mt-1">
                  Connecting to Windy Map API...
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
