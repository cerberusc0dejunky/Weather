import React, { useEffect, useRef, useState } from 'react';
import { LocationAsset, NWSAlert, MesoscaleDiscussion, RotationPin } from '../types';
import { getDistance, getBearing, getGeometryCentroid, getMemoizedMinPolygonDistance } from '../utils/geoUtils';
import { Compass, Eye, Shield, MapPin, Layers, RefreshCcw, Globe, CloudRain, Wind, Search, Navigation, Info } from 'lucide-react';
import { useWindyFailsafe } from '../utils/useWindyFailsafe';

// Helper to convert cardinal directions or degrees into azimuth bearing degrees
function getDegreesFromDirection(dirStr: string): number | null {
  let clean = dirStr.trim().toUpperCase();
  const degreeMatch = clean.match(/^(\d+)/);
  if (degreeMatch) {
    return parseInt(degreeMatch[1], 10) % 360;
  }

  clean = clean.replace(/[-\s]/g, '');
  const directionMap: Record<string, string> = {
    EASTNORTHEAST: 'ENE',
    WESTSOUTHWEST: 'WSW',
    WESTNORTHWEST: 'WNW',
    EASTSOUTHEAST: 'ESE',
    NORTHNORTHEAST: 'NNE',
    NORTHNORTHWEST: 'NNW',
    SOUTHSOUTHEAST: 'SSE',
    SOUTHSOUTHWEST: 'SSW',
    NORTHEAST: 'NE',
    NORTHWEST: 'NW',
    SOUTHEAST: 'SE',
    SOUTHWEST: 'SW',
    NORTH: 'N',
    SOUTH: 'S',
    EAST: 'E',
    WEST: 'W',
  };

  const code = directionMap[clean] || clean;
  const cardinalBearings: Record<string, number> = {
    N: 0, NORTH: 0,
    NNE: 22.5,
    NE: 45, NORTHEAST: 45,
    ENE: 67.5,
    E: 90, EAST: 90,
    ESE: 112.5,
    SE: 135, SOUTHEAST: 135,
    SSE: 157.5,
    S: 180, SOUTH: 180,
    SSW: 202.5,
    SW: 225, SOUTHWEST: 225,
    WSW: 247.5,
    W: 270, WEST: 270,
    WNW: 292.5,
    NW: 315, NORTHWEST: 315,
    NNW: 337.5,
  };

  return cardinalBearings[code] !== undefined ? cardinalBearings[code] : null;
}

// Great circle coordinate projection helper
function projectCoordinates(lat: number, lon: number, bearing: number, distanceMiles: number): { lat: number; lon: number } {
  const R = 3958.8; // Radius of Earth in miles
  const ad = distanceMiles / R; // angular distance in radians
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lon * Math.PI) / 180;
  const θ = (bearing * Math.PI) / 180; // highly stable approximation for weather motion vectors

  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(ad) +
    Math.cos(la1) * Math.sin(ad) * Math.cos(θ)
  );
  const lo2 = lo1 + Math.atan2(
    Math.sin(θ) * Math.sin(ad) * Math.cos(la1),
    Math.cos(ad) - Math.sin(la1) * Math.sin(la2)
  );

  return {
    lat: (la2 * 180) / Math.PI,
    lon: (((lo2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

interface RadarMapProps {
  userLat: number;
  userLon: number;
  assets: LocationAsset[];
  alerts: NWSAlert[];
  activeThreats?: NWSAlert[];
  discussions?: MesoscaleDiscussion[];
  rotationPins?: RotationPin[];
  mapMode: 'radar' | 'wind';
  onMapModeChange: (mode: 'radar' | 'wind') => void;
  onSetCoordinates?: (lat: number, lon: number) => void;
  customMapKey?: string;
}

declare global {
  interface Window {
    windyInit?: (options: any, callback: (windyAPI: any) => void) => void;
    windyMap?: any;
    windyStore?: any;
    L?: any;
    onMapSetCoordinates?: (lat: number, lon: number) => void;
  }
}

export default function RadarMap({
  userLat,
  userLon,
  assets,
  alerts,
  activeThreats,
  discussions = [],
  rotationPins = [],
  mapMode,
  onMapModeChange,
  onSetCoordinates,
  customMapKey,
}: RadarMapProps) {
  const [apiLoaded, setApiLoaded] = useState<boolean>(false);
  const [initError, setInitError] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [reflectivityType, setReflectivityType] = useState<'standard' | 'high-res'>('standard');
  
  const [retryCount, setRetryCount] = useState<number>(0);
  const [mapDimensions, setMapDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // Custom HUD and interactivity states
  const [zoomLevel, setZoomLevel] = useState<number>(8);
  const [isLegendExpanded, setIsLegendExpanded] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [addressSearchQuery, setAddressSearchQuery] = useState<string>('');
  const [searchError, setSearchError] = useState<string | null>(null);

  const coordsDisplayRef = useRef<HTMLSpanElement>(null);
  const windyMapRef = useRef<any>(null);
  const windyStoreRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const polygonLayersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const assetMarkersRef = useRef<any[]>([]);
  const alertMarkersRef = useRef<any[]>([]);
  const lastSetCoordinatesRef = useRef<{ lat: number; lon: number } | null>(null);

  const {
    notification: failsafeNotification,
    transitionMapMode,
    clearNotification: clearFailsafeNotification,
  } = useWindyFailsafe(
    windyStoreRef.current,
    onMapModeChange,
    windyMapRef
  );

  // Trigger brief transition visual state when mapMode changes
  useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), 500);
    return () => clearTimeout(timer);
  }, [mapMode]);

  // Dynamically link setCoordinates trigger to global window to allow integration from leaflet popups
  useEffect(() => {
    if (onSetCoordinates) {
      window.onMapSetCoordinates = onSetCoordinates;
    }
    return () => {
      delete window.onMapSetCoordinates;
    };
  }, [onSetCoordinates]);

  // Geocode location search utilizing Nominatim (failsafe free API)
  const handleGeoSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressSearchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
          addressSearchQuery
        )}`
      );
      const data = await response.json();
      if (data && data.length > 0) {
        const first = data[0];
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);
        
        // Centering the map
        const map = windyMapRef.current;
        if (map) {
          map.setView([lat, lon], 10);
        }
        
        // Propagate state update
        if (onSetCoordinates) {
          onSetCoordinates(lat, lon);
        }
      } else {
        setSearchError('Location not found.');
        setTimeout(() => setSearchError(null), 3000);
      }
    } catch (err) {
      console.error('Error during geocoding search:', err);
      setSearchError('Search failed. Check connection.');
      setTimeout(() => setSearchError(null), 3000);
    } finally {
      setIsSearching(false);
    }
  };

  // Monitor script presence on mount
  useEffect(() => {
    const windyKey = customMapKey || localStorage.getItem('daisy-windy-map-key') || (import.meta as any).env?.VITE_WINDY_MAP_KEY;
    if (!windyKey) {
      console.warn('[RadarMap] No Windy API key configured. Instantly falling back to Leaflet failsafe map.');
      setInitError(true);
      return;
    }

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

    // Smart 3.5s loading timeout to fall back if Windy script is rate-limited or fails to boot
    const timeout = setTimeout(() => {
      if (!window.windyInit || !window.L) {
        console.warn('[RadarMap] Windy Map API failed to load within 3.5s. Falling back to Leaflet.');
        setInitError(true);
      }
    }, 3500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [customMapKey]);

  // Track map container dimensions and safety state
  useEffect(() => {
    const container = document.getElementById(initError ? 'fallback-leaflet-map' : 'windy');
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setMapDimensions({
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [initError, apiLoaded]);

  // Initialize Windy Map or Fallback with retry and timeout logic
  useEffect(() => {
    if (!apiLoaded || initError || !window.windyInit || !window.L) return;

    const container = document.getElementById('windy');
    if (!container) return;

    const height = container.clientHeight || 0;
    if (height === 0) {
      console.warn(`[RadarMap] Map container height is 0px. Postponing initialization (retry ${retryCount}/5)...`);
      if (retryCount < 5) {
        const timer = setTimeout(() => setRetryCount(prev => prev + 1), 1000);
        return () => clearTimeout(timer);
      } else {
        console.error('[RadarMap] Failed to initialize Windy: container height remained 0px.');
        setInitError(true);
        return;
      }
    }

    container.innerHTML = '';

    let isSuccess = false;
    
    // Set 3.5-second timeout to transition cleanly to failsafe Leaflet + NEXRAD if windyInit callback never triggers (e.g., key restricted/expired)
    const bootTimeout = setTimeout(() => {
      if (!isSuccess) {
        console.warn('[RadarMap] windyInit callback timed out. Switching to failsafe Leaflet + NEXRAD radar map.');
        if (container) {
          container.innerHTML = '';
        }
        setInitError(true);
      }
    }, 3500);

    try {
      const windyKey = customMapKey || localStorage.getItem('daisy-windy-map-key') || (import.meta as any).env?.VITE_WINDY_MAP_KEY;
      const options = {
        key: windyKey,
        lat: userLat,
        lon: userLon,
        zoom: 8,
      };

      window.windyInit(options, (windyAPI: any) => {
        isSuccess = true;
        clearTimeout(bootTimeout);
        
        const { map, store } = windyAPI;
        windyMapRef.current = map;
        windyStoreRef.current = store;

        // Sync initial map overlay mode
        store.set('overlay', mapMode);

        lastSetCoordinatesRef.current = { lat: userLat, lon: userLon };

        // Draw overlays
        updateInteractiveElements();
      });
    } catch (err) {
      console.error('Windy Map initialization error:', err);
      clearTimeout(bootTimeout);
      if (retryCount < 5) {
        setRetryCount(prev => prev + 1);
      } else {
        setInitError(true);
      }
    }

    return () => {
      clearTimeout(bootTimeout);
      cleanupInteractiveElements();
    };
  }, [apiLoaded, initError, customMapKey, retryCount]);

  // Sync Map Overlay Mode instantly (no reload!)
  useEffect(() => {
    console.log(`[RadarMap Monitor] mapMode state transition triggered. Target mode: "${mapMode}"`);
    if (windyStoreRef.current) {
      try {
        windyStoreRef.current.set('overlay', mapMode);
        const currentOverlayValue = windyStoreRef.current.get('overlay');
        console.log(`[RadarMap Monitor - Windy Live Sync] Method call 'store.set("overlay", "${mapMode}")' executed. Active Windy overlay store value is currently verified as: "${currentOverlayValue}"`);
      } catch (err) {
        console.error(`[RadarMap Monitor - Windy Live Sync Error] API method call execution failed for mode "${mapMode}":`, err);
      }
    } else {
      console.log(`[RadarMap Monitor] Windy API store instance is not initialized yet. Mode change to "${mapMode}" will apply on Windy load or run under failsafe Leaflet tile overlays.`);
    }
  }, [mapMode]);

  // Support fallback interactive Leaflet map if Windy is blocked
  const fallbackMapRef = useRef<any>(null);

  useEffect(() => {
    if (!initError || !window.L) return;

    const element = document.getElementById('fallback-leaflet-map');
    if (!element) return;

    let resizeObserver: ResizeObserver | null = null;

    if (!fallbackMapRef.current) {
      try {
        const L = window.L;
        const fMap = L.map('fallback-leaflet-map', {
          zoomControl: false,
        }).setView([userLat, userLon], assets.length > 0 ? 8 : 6);

        // Add CartoDB Dark Matter base tile grid layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 20
        }).addTo(fMap);
        
        L.control.zoom({ position: 'topright' }).addTo(fMap);
        
        fallbackMapRef.current = fMap;
        windyMapRef.current = fMap;

        // ResizeObserver to dynamically trigger map size invalidation
        resizeObserver = new ResizeObserver(() => {
          try {
            fMap.invalidateSize();
          } catch (e) {}
        });
        resizeObserver.observe(element);

        // Force initial update of elements on fallback map
        updateInteractiveElements();
      } catch (err) {
        console.error('Error creating fallback Leaflet map:', err);
      }
    } else {
      try {
        const currentCenter = fallbackMapRef.current.getCenter();
        const dist = Math.sqrt(
          Math.pow(currentCenter.lat - userLat, 2) + 
          Math.pow(currentCenter.lng - userLon, 2)
        );
        // Only setView if target coordinate is significantly shifted (e.g. searching a new location)
        if (dist > 0.05) {
          fallbackMapRef.current.setView([userLat, userLon], assets.length > 0 ? 8 : 6);
        }
      } catch (e) {
        try {
          fallbackMapRef.current.setView([userLat, userLon], assets.length > 0 ? 8 : 6);
        } catch (err) {}
      }
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (fallbackMapRef.current) {
        try {
          fallbackMapRef.current.remove();
        } catch (e) {}
        fallbackMapRef.current = null;
        if (windyMapRef.current === fallbackMapRef.current) {
          windyMapRef.current = null;
        }
      }
    };
  }, [initError, userLat, userLon, apiLoaded]);

  // Failsafe Canvas Wind Particles Overlay
  useEffect(() => {
    if (!initError || mapMode !== 'wind' || !window.L || !fallbackMapRef.current) return;

    const canvas = document.getElementById('wind-particle-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const L = window.L;
    const map = fallbackMapRef.current;
    
    // Resize canvas to match the container
    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      canvas.width = rect?.width || canvas.clientWidth;
      canvas.height = rect?.height || canvas.clientHeight;
    };
    resizeCanvas();

    // Create particles
    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      maxLife: number;
      speed: number;
      color: string;
    }

    const numParticles = 180;
    const particles: Particle[] = [];

    // Helper to generate a particle
    const createParticle = (randomizeLife = false): Particle => {
      const px = Math.random() * canvas.width;
      const py = Math.random() * canvas.height;
      return {
        x: px,
        y: py,
        vx: 0,
        vy: 0,
        life: randomizeLife ? Math.random() * 80 : 0,
        maxLife: 40 + Math.random() * 60,
        speed: 1 + Math.random() * 2,
        color: 'rgba(6, 182, 212, 0.4)' // default Cyan/Aqua
      };
    };

    for (let i = 0; i < numParticles; i++) {
      particles.push(createParticle(true));
    }

    // Active hazard locations in screen coords
    interface HazardCentroid {
      x: number;
      y: number;
      isTornado: boolean;
      isSevere: boolean;
    }

    let animationFrameId: number;

    const animate = () => {
      ctx.fillStyle = 'rgba(10, 15, 36, 0.15)'; // Slightly translucent dark backdrop for trail effect
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Get current hazard centroids in screen coordinates
      const hazards: HazardCentroid[] = [];

      // 1. Vortex pins
      rotationPins.forEach((pin) => {
        try {
          const latlng = L.latLng(pin.lat, pin.lon);
          const pos = map.latLngToContainerPoint(latlng);
          hazards.push({
            x: pos.x,
            y: pos.y,
            isTornado: pin.pinType === 'vortex' || pin.threatLevel === 'Extreme',
            isSevere: true
          });
        } catch (e) {}
      });

      // 2. Alert centroids
      alerts.forEach((alert) => {
        if (alert.geometry && alert.geometry.coordinates) {
          try {
            const centroid = getGeometryCentroid(alert.geometry.coordinates);
            if (centroid) {
              const latlng = L.latLng(centroid.lat, centroid.lon);
              const pos = map.latLngToContainerPoint(latlng);
              hazards.push({
                x: pos.x,
                y: pos.y,
                isTornado: alert.event.toUpperCase().includes('TORNADO'),
                isSevere: alert.event.toUpperCase().includes('WARNING')
              });
            }
          } catch (e) {}
        }
      });

      particles.forEach((p, idx) => {
        // Base flow field: West-Northwest (WNW) to East-Southeast (ESE)
        let angle = (25 * Math.PI) / 180; // 25 degrees
        let targetSpeed = p.speed;
        let color = 'rgba(6, 182, 212, 0.4)'; // Translucent Cyan/Aqua for background current

        // Calculate pull from active convective hazards (suction effect)
        let pullX = 0;
        let pullY = 0;
        let closestDist = 999999;
        let closestHazard: HazardCentroid | null = null;

        hazards.forEach((h) => {
          const dx = h.x - p.x;
          const dy = h.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) {
            closestDist = dist;
            closestHazard = h;
          }

          if (dist < 250) {
            const force = (250 - dist) / 250;
            const angleToCenter = Math.atan2(dy, dx);
            const cyclonicAngle = angleToCenter - Math.PI / 2; // -90 deg for CCW rotation

            pullX += Math.cos(cyclonicAngle) * force * 3;
            pullY += Math.sin(cyclonicAngle) * force * 3;

            pullX += Math.cos(angleToCenter) * force * 1.5;
            pullY += Math.sin(angleToCenter) * force * 1.5;
          }
        });

        // Apply forces
        let baseVx = Math.cos(angle) * targetSpeed;
        let baseVy = Math.sin(angle) * targetSpeed;

        p.vx = baseVx + pullX;
        p.vy = baseVy + pullY;

        // Determine particle color and speed boost based on closest hazard
        if (closestHazard && closestDist < 250) {
          const force = (250 - closestDist) / 250;
          if (closestHazard.isTornado) {
            // Tornado vortex -> Neon Pink / Magenta
            color = `rgba(255, 105, 180, ${0.4 + force * 0.5})`; // neon pink
            p.vx *= 1.4; // accelerate
            p.vy *= 1.4;
          } else if (closestHazard.isSevere) {
            // Severe inflow -> Electric Amber / Orange
            color = `rgba(249, 115, 22, ${0.4 + force * 0.5})`; // amber
            p.vx *= 1.2;
            p.vy *= 1.2;
          }
        }

        // Update position
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        // Draw particle trail segment
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Respawn if out of bounds or dead
        if (
          p.x < 0 || p.x > canvas.width ||
          p.y < 0 || p.y > canvas.height ||
          p.life >= p.maxLife
        ) {
          particles[idx] = createParticle(false);
        }
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleMapUpdate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    map.on('zoomstart dragstart movestart', handleMapUpdate);
    map.on('resize', resizeCanvas);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (map) {
        map.off('zoomstart dragstart movestart', handleMapUpdate);
        map.off('resize', resizeCanvas);
      }
    };
  }, [initError, mapMode, rotationPins, alerts, zoomLevel]);

  // Pan the Windy Map if the top-level user coordinates change (e.g. from the main search bar)
  useEffect(() => {
    const map = windyMapRef.current;
    if (map && lastSetCoordinatesRef.current) {
      const dist = Math.sqrt(
        Math.pow(lastSetCoordinatesRef.current.lat - userLat, 2) + 
        Math.pow(lastSetCoordinatesRef.current.lon - userLon, 2)
      );
      // Only pan if the location changed significantly (prevents tiny GPS jitter from interrupting the user)
      if (dist > 0.05) { 
        try {
          map.setView([userLat, userLon]);
          lastSetCoordinatesRef.current = { lat: userLat, lon: userLon };
        } catch (e) {}
      }
    }
  }, [userLat, userLon]);

  // Sync Positions and Alert Polygons
  useEffect(() => {
    updateInteractiveElements();
  }, [userLat, userLon, assets, alerts, activeThreats, discussions, rotationPins, mapMode, reflectivityType]);

  const cleanupInteractiveElements = () => {
    const L = window.L;
    const map = windyMapRef.current;
    if (!L || !map) return;

    // Clean custom overlay TileLayer if exists
    if (tileLayerRef.current) {
      try {
        map.removeLayer(tileLayerRef.current);
      } catch (e) {}
      tileLayerRef.current = null;
    }

    // Clean storm polygons and trajectory polylines
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

    // Clean alert markers
    alertMarkersRef.current.forEach((marker) => {
      try {
        map.removeLayer(marker);
      } catch (e) {}
    });
    alertMarkersRef.current = [];
  };

  const updateInteractiveElements = () => {
    const L = window.L;
    const map = windyMapRef.current;
    if (!L || !map) return;

    cleanupInteractiveElements();

    // Setup interactive map action event listeners
    try {
      if (!(map as any).hasDaisyEvents) {
        (map as any).hasDaisyEvents = true;

        map.on('mousemove', (e: any) => {
          const { lat, lng } = e.latlng;
          if (coordsDisplayRef.current) {
            coordsDisplayRef.current.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          }
        });

      map.on('mouseout', () => {
        if (coordsDisplayRef.current) {
          coordsDisplayRef.current.innerText = 'Hover Map';
        }
      });

      map.on('zoomend', () => {
        setZoomLevel(map.getZoom());
      });

      map.on('click', (e: any) => {
        const { lat, lng } = e.latlng;

        L.popup()
          .setLatLng(e.latlng)
          .setContent(`
            <div class="text-slate-950 font-sans p-2 min-w-[170px] leading-tight">
              <div class="font-black text-[11px] uppercase text-slate-800 flex items-center gap-1">COORDINATE PROBE</div>
              <p class="text-[10px] text-slate-500 font-mono mt-1 font-semibold">${lat.toFixed(5)}, ${lng.toFixed(5)}</p>
              <div class="mt-2.5 pt-2 border-t border-slate-100">
                <button onclick="window.onMapSetCoordinates?.(${lat}, ${lng})" class="w-full px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[9px] rounded uppercase cursor-pointer border-none shadow-sm transition-colors">
                  Set As Primary Gateway
                </button>
              </div>
            </div>
          `)
          .openOn(map);
      });
      }
    } catch (e) {
      console.warn('Click/Hover listeners subscription failed:', e);
    }

    try {
      // 1. Center map around current active coordinates ONLY if they have changed!
      const coordsChanged = !lastSetCoordinatesRef.current || 
                            lastSetCoordinatesRef.current.lat !== userLat || 
                            lastSetCoordinatesRef.current.lon !== userLon;
      if (coordsChanged) {
        map.setView([userLat, userLon], assets.length > 0 ? 8 : 6);
        lastSetCoordinatesRef.current = { lat: userLat, lon: userLon };
      }

      // 1.5. Check overlay map mode and add solid, premium tile layers as fallback/primary if Windy CDN or server encounters strict CSP boundaries
      if (mapMode === 'radar' && (initError || !windyStoreRef.current)) {
        tileLayerRef.current = L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png', {
          attribution: 'Live Weather Radar &copy; IEM NEXRAD',
          maxZoom: 18,
          opacity: reflectivityType === 'high-res' ? 0.9 : 0.65,
          className: reflectivityType === 'high-res' ? 'radar-high-res-enhanced' : 'radar-standard-rendering',
        }).addTo(map);
      } else if (initError && mapMode === 'wind') {
        tileLayerRef.current = L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/goes_east_conus_ch13/{z}/{x}/{y}.png', {
          attribution: 'GOES East Infrared Satellite &copy; NOAA/IEM',
          maxZoom: 18,
          opacity: 0.6,
        }).addTo(map);
      }

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
          .bindPopup(`<div class="text-slate-950"><div class="font-extrabold font-sans text-xs uppercase">${asset.name}</div><p class="text-[10px] font-mono mt-1">lat/lon: ${asset.lat.toFixed(3)}, ${asset.lon.toFixed(3)}</p></div>`);
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
          .bindPopup(`<div class="text-slate-950 font-sans p-1"><div class="font-black text-xs uppercase text-red-600">${alert.event}</div><p class="text-[10px] mt-1 text-slate-700 leading-tight">${alert.areaDesc}</p></div>`);

        polygonLayersRef.current.push(layer);
      });

      // 4.1. Project and render active convective storm tracking trajectories
      alerts.forEach((alert) => {
        if (!alert.keywords?.vector || !alert.geometry || !alert.geometry.coordinates) return;

        const centroid = getGeometryCentroid(alert.geometry.coordinates);
        if (!centroid) return;

        const [dir, speedStr, unit] = alert.keywords.vector;
        if (!dir || !speedStr) return;

        const bearing = getDegreesFromDirection(dir);
        let speed = parseInt(speedStr, 10);
        if (isNaN(speed) || speed <= 0 || bearing === null) return;

        const normUnit = (unit || 'MPH').toUpperCase();
        if (normUnit.startsWith('KT') || normUnit.startsWith('KNOT')) {
          speed = Math.round(speed * 1.1515); // convert knots to conversion factor
        }

        // Project positions 15m, 30m, 45m, and 60 minutes along storm motion vector
        const intervals = [15, 30, 45, 60];
        const pathCoords: [number, number][] = [[centroid.lat, centroid.lon]];
        const customStepNodes: { lat: number; lon: number; label: string }[] = [];

        intervals.forEach((mins) => {
          const travelDistanceMiles = speed * (mins / 60);
          const projectedPt = projectCoordinates(centroid.lat, centroid.lon, bearing, travelDistanceMiles);
          pathCoords.push([projectedPt.lat, projectedPt.lon]);
          customStepNodes.push({ lat: projectedPt.lat, lon: projectedPt.lon, label: `${mins}m` });
        });

        // Draw main vector line
        const vectorColor = alert.event.toUpperCase().includes('TORNADO') ? '#ef4444' : '#e11d48';
        const trajectoryLine = L.polyline(pathCoords, {
          color: vectorColor,
          weight: 4,
          dashArray: '6, 8',
          opacity: 0.9,
          className: 'convective-vector-line',
        }).addTo(map);

        polygonLayersRef.current.push(trajectoryLine);

        // Draw solid visual arrowhead at the tip of the 60m projected endpoint
        const lastPt = pathCoords[pathCoords.length - 1];
        const arrowLengthMiles = Math.max(1.5, speed * 0.04); // Arrowhead scale proportional to storm speed
        const leftWing = projectCoordinates(lastPt[0], lastPt[1], (bearing + 155) % 360, arrowLengthMiles);
        const rightWing = projectCoordinates(lastPt[0], lastPt[1], (bearing - 155) % 360, arrowLengthMiles);

        const arrowhead = L.polygon([
          [lastPt[0], lastPt[1]], // Arrow tip
          [leftWing.lat, leftWing.lon], // Left wing
          [rightWing.lat, rightWing.lon] // Right wing
        ], {
          color: vectorColor,
          fillColor: vectorColor,
          fillOpacity: 1.0,
          weight: 1.5,
        }).addTo(map);

        polygonLayersRef.current.push(arrowhead);

        // Draw high-contrast directional chevrons along each segment, oriented matching the calculated bearing
        for (let i = 0; i < pathCoords.length - 1; i++) {
          const ptStart = pathCoords[i];
          const ptEnd = pathCoords[i+1];
          const midLat = (ptStart[0] + ptEnd[0]) / 2;
          const midLon = (ptStart[1] + ptEnd[1]) / 2;
          const rotationAngle = bearing - 90; // Chevron natively points East (90 deg), adjust by -90 for North-aligned bearing

          const chevronHtml = `
            <div style="transform: rotate(${rotationAngle}deg); display: flex; align-items: center; justify-content: center; width: 16px; height: 16px;">
              <svg class="w-3.5 h-3.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] animate-pulse" viewBox="0 0 24 24" fill="none" stroke="${vectorColor}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          `;

          const chevronIcon = L.divIcon({
            className: 'trajectory-chevron-marker',
            html: chevronHtml,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });

          const chevronMarker = L.marker([midLat, midLon], { icon: chevronIcon }).addTo(map);
          alertMarkersRef.current.push(chevronMarker);
        }

        // Render point node milestones with pulse elements & micro info popups
        customStepNodes.forEach((node) => {
          const milestoneHtml = `
            <div class="relative flex items-center justify-center">
              <div class="absolute w-5 h-5 rounded-full bg-slate-950 border border-rose-500 flex items-center justify-center shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                <span class="text-[8px] font-black font-mono text-rose-400 select-none">${node.label}</span>
              </div>
              <div class="absolute w-2 h-2 rounded-full bg-rose-500 animate-[ping_1.5s_infinite]"></div>
            </div>
          `;

          const nodeIcon = L.divIcon({
            className: 'trajectory-milestone-pin',
            html: milestoneHtml,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });

          const stepMarker = L.marker([node.lat, node.lon], { icon: nodeIcon })
            .addTo(map)
            .bindPopup(`
              <div class="text-slate-950 font-sans p-1.5 max-w-[200px]">
                <div class="font-extrabold text-xs text-rose-600 uppercase flex items-center gap-1">
                  <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg> Track Milestone
                </div>
                <p class="text-[10px] mt-1 text-slate-700 leading-snug">
                  Estimated storm core impact arrival: <b>${node.label} out</b>.
                </p>
                <div class="mt-2 pt-1 border-t border-slate-100 flex justify-between text-[8px] font-mono text-slate-500">
                  <span>HEAD: ${dir} (${bearing}°)</span>
                  <span>SPEED: ${speed} MPH</span>
                </div>
              </div>
            `);

          alertMarkersRef.current.push(stepMarker);
        });

        // 4.2. Draw custom visual trajectory lines specifically relative to saved coordinates with calculated ETAs
        assets.forEach((asset) => {
          const result = getMemoizedMinPolygonDistance(asset.id, asset.lat, asset.lon, alert.id, alert.geometry.coordinates);
          if (!result.closestPt) return;

          const startLat = result.isInside ? centroid.lat : result.closestPt[1];
          const startLon = result.isInside ? centroid.lon : result.closestPt[0];
          const targetDist = result.isInside
            ? getDistance(centroid.lat, centroid.lon, asset.lat, asset.lon)
            : result.minDist;

          const bearingToAsset = getBearing(startLat, startLon, asset.lat, asset.lon);
          const diff = Math.abs(bearing - bearingToAsset);
          const coreBearingToAsset = getBearing(centroid.lat, centroid.lon, asset.lat, asset.lon);
          const coreDiff = Math.abs(bearing - coreBearingToAsset);

          const isHeading = result.isInside
            ? Math.min(coreDiff, 360 - coreDiff) <= 60
            : Math.min(diff, 360 - diff) <= 45 || Math.min(coreDiff, 360 - coreDiff) <= 45;

          if (isHeading && targetDist > 0 && targetDist < 150) {
            const assetEta = Math.max(1, Math.round((targetDist / speed) * 60));
            
            // Draw a visual trajectory connection line from nearest polygon edge (or storm core if inside) directly to saved location
            const connectionCoords: [number, number][] = [
              [startLat, startLon],
              [asset.lat, asset.lon]
            ];

            const pathColor = alert.event.toUpperCase().includes('TORNADO') ? '#f43f5e' : '#06b6d1';
            const connectionLine = L.polyline(connectionCoords, {
              color: pathColor,
              weight: 3,
              dashArray: '4, 6',
              opacity: 0.85,
              className: 'coordinate-impact-vector-line',
            }).addTo(map);

            connectionLine.bindPopup(`
              <div class="text-slate-950 font-sans p-1.5 max-w-[220px]">
                <div class="font-extrabold text-xs text-cyan-700 uppercase flex items-center gap-1">
                  Collision Path: ${asset.name}
                </div>
                <p class="text-[10px] mt-1 text-slate-700 leading-snug font-medium">
                  Storm tracking model projects impact path intersecting this saved location.
                </p>
                <div class="mt-2 pt-1.5 border-t border-slate-100 flex flex-col gap-1 text-[9px] text-slate-500 font-mono">
                  <div class="flex justify-between"><span>${result.isInside ? 'CORE DIST:' : 'EDGE DIST:'}</span> <b class="text-slate-800">${targetDist.toFixed(1)} miles</b></div>
                  <div class="flex justify-between"><span>HEADING:</span> <b class="text-slate-800">${dir} (${bearing}°)</b></div>
                  <div class="flex justify-between"><span>STORM SPEED:</span> <b class="text-slate-800">${speed} MPH</b></div>
                  <div class="flex justify-between text-rose-500 font-bold border-t border-dashed border-slate-100 pt-1 mt-0.5">
                    <span>EST. IMPACT ETA:</span>
                    <span>${assetEta} MINUTES</span>
                  </div>
                </div>
              </div>
            `);

            polygonLayersRef.current.push(connectionLine);

            // Midpoint visual ETA status badge
            const midLat = (startLat + asset.lat) / 2;
            const midLon = (startLon + asset.lon) / 2;

            const badgeHtml = `
              <div class="relative flex items-center justify-center">
                <div class="px-2 py-0.5 bg-slate-950/95 border border-cyan-400 rounded shadow-[0_2px_8px_rgba(6,182,212,0.5)] flex items-center gap-1 whitespace-nowrap animate-pulse">
                  <span class="text-[8px] font-black font-mono text-cyan-300">ETA: ${assetEta}m</span>
                </div>
              </div>
            `;

            const badgeIcon = L.divIcon({
              className: 'trajectory-mid-badge',
              html: badgeHtml,
              iconSize: [60, 18],
              iconAnchor: [30, 9],
            });

            const badgeMarker = L.marker([midLat, midLon], { icon: badgeIcon })
              .addTo(map)
              .bindPopup(`
                <div class="text-slate-950 font-sans p-1.5 max-w-[220px]">
                  <div class="font-extrabold text-xs text-cyan-700 uppercase">
                    ETA Timeline Tracker
                  </div>
                  <p class="text-[10px] mt-1 text-slate-700 leading-tight">
                    Estimated storm ${result.isInside ? 'core' : 'boundary'} arrival at <b>${asset.name}</b> in approximately <b>${assetEta} minutes</b>.
                  </p>
                </div>
              `);

            alertMarkersRef.current.push(badgeMarker);
          }
        });
      });

      // 4.5. Render clickable marker pins for all 'High' or 'Extreme' threat level alerts on centroids using activeThreats
      const threatSource = activeThreats || alerts;
      threatSource.forEach((alert) => {
        if (alert.threatLevel === 'High' || alert.threatLevel === 'Extreme') {
          if (!alert.geometry || !alert.geometry.coordinates) return;
          const centroid = getGeometryCentroid(alert.geometry.coordinates);
          if (!centroid) return;

          const isExtreme = alert.threatLevel === 'Extreme';
          const pulseClass = isExtreme ? 'extreme-threat-pulse' : 'high-threat-pulse';
          const pinColorClass = isExtreme ? 'bg-rose-600' : 'bg-orange-500';
          const pinBorderColor = isExtreme ? 'border-rose-300' : 'border-orange-200';
          const threatBadgeText = alert.threatLevel.toUpperCase();

          const markerHtml = `
            <div class="${pulseClass} rounded-full w-6 h-6 flex items-center justify-center">
              <div class="w-3.5 h-3.5 ${pinColorClass} rounded-full border-2 ${pinBorderColor} flex items-center justify-center shadow-lg">
                <div class="w-1 h-1 bg-white rounded-full"></div>
              </div>
            </div>
          `;

          const alertDivIcon = L.divIcon({
            className: 'custom-alert-marker',
            html: markerHtml,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });

          const popupContent = `
            <div class="text-slate-950 font-sans p-1.5 max-w-[220px]">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[9px] font-black uppercase tracking-wider text-slate-400">Hazard Anchor</span>
                <span class="px-2 py-0.5 rounded text-[8px] font-black text-white ${isExtreme ? 'bg-rose-600' : 'bg-orange-500'}">
                  ${threatBadgeText} THREAT
                </span>
              </div>
              <div class="font-extrabold text-xs uppercase text-slate-900 leading-tight">${alert.event}</div>
              <p class="text-[9px] font-semibold text-slate-500 mt-1 uppercase">Distance: ${alert.minDist === 0 ? 'Direct Hit' : `${alert.minDist.toFixed(1)} miles`}</p>
              <p class="text-[9px] text-slate-600 mt-1.5 leading-snug font-medium line-clamp-3">${alert.areaDesc}</p>
            </div>
          `;

          const alertMarker = L.marker([centroid.lat, centroid.lon], { icon: alertDivIcon })
            .addTo(map)
            .bindPopup(popupContent);

          alertMarkersRef.current.push(alertMarker);
        }
      });

      // 4.6. Render clickable visual pins indicating ROTATION OR DIRECT TORNADO VORTEX DETECTED from props
      rotationPins.forEach((pin) => {
        let markerHtml = '';
        let popupTitle = '';
        let popupSubTitle = '';
        let popupBadgeColor = '';
        let popupDesc = '';
        let pinSize: [number, number] = [32, 32];
        let pinAnchor: [number, number] = [16, 16];

        if (pin.pinType === 'vortex') {
          // ACTIVE GROUND VORTEX / TDS DETECTED
          markerHtml = `
            <div class="relative flex items-center justify-center w-10 h-10">
              <div class="absolute inset-0 bg-red-600/30 rounded-full animate-ping" style="animation-duration: 1s;"></div>
              <div class="rounded-full w-9 h-9 flex items-center justify-center bg-rose-950 border-2 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.95)]">
                <svg class="w-5.5 h-5.5 text-red-500 animate-spin" style="animation-duration: 1.2s;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  <path d="M3 4h18M6 8h12M8 12h8M10 16h4M11 20h2" stroke-width="2" />
                </svg>
              </div>
            </div>
          `;
          popupTitle = 'ACTIVE GROUND TORNADO';
          popupSubTitle = 'TORNADIC DEBRIS SIGNATURE (TDS)';
          popupBadgeColor = 'bg-rose-700 text-white animate-pulse';
          popupDesc = 'CRITICAL TORNADO CONTACT. Doppler radar dual-polarization data confirms debris detection or emergency spotters verify a destructive tornado on the ground at this location. Take immediate, absolute life safety action.';
          pinSize = [40, 40];
          pinAnchor = [20, 20];
        } else if (pin.pinType === 'radar_indicated') {
          // RADAR-INDICATED TORNADO WARNING
          markerHtml = `
            <div class="relative flex items-center justify-center w-8.5 h-8.5">
              <div class="absolute inset-0 bg-orange-500/20 rounded-full animate-ping" style="animation-duration: 1.8s;"></div>
              <div class="rounded-full w-8 h-8 flex items-center justify-center bg-slate-950 border-2 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.8)]">
                <svg class="w-4.5 h-4.5 text-orange-400 animate-spin" style="animation-duration: 2.2s;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2a10 10 0 0 0-10 10" />
                  <path d="M12 2v10l-7 7" />
                  <path d="M12 12h10a10 10 0 0 0-10-10" />
                  <path d="M12 12l7 7" />
                </svg>
              </div>
            </div>
          `;
          popupTitle = 'RADAR-INDICATED TORNADO';
          popupSubTitle = 'TORNADO WARNING ACTIVE';
          popupBadgeColor = 'bg-orange-600 text-white';
          popupDesc = 'DOPPLER VELOCITY COUPLING. Strong gate-to-gate velocity shear indicative of low-level tornadogenesis or a high-probability vortex formation aloft.';
          pinSize = [34, 34];
          pinAnchor = [17, 17];
        } else {
          // MESOCYCLONE OR PRECURSOR ROTATION
          markerHtml = `
            <div class="rounded-full w-7.5 h-7.5 flex items-center justify-center bg-slate-950 border border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.55)]">
              <svg class="w-4 h-4 text-amber-500 animate-spin" style="animation-duration: 3.5s;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </div>
          `;
          popupTitle = 'MESOCYCLONE UPDRAFT';
          popupSubTitle = 'VELOCITY SHEAR CLASSIFIED';
          popupBadgeColor = 'bg-amber-500 text-slate-950 font-extrabold';
          popupDesc = 'DEEP CONVECTIVE ROTATION. Atmospheric velocity shear detected inside the supercell core. This rotating updraft is a precursor structure capable of supporting severe hazards.';
          pinSize = [30, 30];
          pinAnchor = [15, 15];
        }

        const rotationDivIcon = L.divIcon({
          className: 'custom-rotation-marker',
          html: markerHtml,
          iconSize: pinSize,
          iconAnchor: pinAnchor,
        });

        const popupContent = `
          <div class="text-slate-950 font-sans p-2.5 max-w-[250px]">
            <div class="flex items-center justify-between mb-1.5 border-b border-slate-100 pb-1.5">
              <span class="text-[9px] font-black uppercase tracking-wider text-rose-600 flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-rose-600 animate-ping inline-block"></span>
                ${popupTitle}
              </span>
              <span class="px-2 py-0.5 rounded text-[8px] font-black uppercase ${popupBadgeColor}">
                ${popupSubTitle}
              </span>
            </div>
            <div class="font-extrabold text-xs uppercase text-slate-900 leading-tight">${pin.eventName}</div>
            <p class="text-[9px] font-semibold text-slate-500 mt-1 uppercase">BOUNDARIES: ${pin.areaDesc}</p>
            
            <div class="mt-2 p-2 bg-slate-50 border border-slate-100 rounded-lg">
              <p class="text-[8.5px] text-slate-700 font-bold leading-normal uppercase">
                ${popupDesc}
              </p>
            </div>
            <div class="mt-1.5 text-[8px] text-slate-400 font-mono text-right">
              Acquired: ${new Date(pin.detectedAt).toLocaleTimeString()}
            </div>
          </div>
        `;

        // Offset slightly in coordinate space (about 0.002 degrees) so it does not perfectly overlap centroid pin
        const offsetLat = pin.lat + 0.002;
        const offsetLon = pin.lon + 0.002;

        const rotationMarker = L.marker([offsetLat, offsetLon], { icon: rotationDivIcon })
          .addTo(map)
          .bindPopup(popupContent);

        alertMarkersRef.current.push(rotationMarker);
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
              <div class="font-black text-xs uppercase text-amber-600">SPC Mesoscale Discussion #${md.number}</div>
              <p class="text-[10px] uppercase font-bold text-slate-600 mt-0.5">${md.concerning}</p>
              <p class="text-[10px] uppercase font-bold text-slate-500 mt-1">Probability of Watch: ${md.probability}%</p>
              <p class="text-[10px] mt-1 text-slate-700 leading-tight"><b>Areas:</b> ${md.areasAffected}</p>
              ${md.watchBox ? `<p class="text-[9px] font-mono mt-1 text-slate-600"><b>Watch Corridor:</b> LAT ${md.watchBox.minLat.toFixed(2)}°–${md.watchBox.maxLat.toFixed(2)}°N, LON ${md.watchBox.minLon.toFixed(2)}°–${md.watchBox.maxLon.toFixed(2)}°W</p>` : ''}
              ${md.peakTornadoIntensity ? `<p class="text-[9px] font-mono font-bold text-rose-600 mt-0.5">Peak Tornado: ${md.peakTornadoIntensity}</p>` : ''}
              ${md.peakWindGust ? `<p class="text-[9px] font-mono font-bold text-cyan-700 mt-0.5">Peak Wind: ${md.peakWindGust}</p>` : ''}
              ${md.peakHailSize ? `<p class="text-[9px] font-mono font-bold text-amber-700 mt-0.5">Peak Hail: ${md.peakHailSize}</p>` : ''}
            </div>`);

          polygonLayersRef.current.push(mcdLayer);
        });
      }
    } catch (e) {
      console.warn('Error rendering elements to Leaflet layer:', e);
    }
  };

  return (
    <div className="w-full flex flex-col neon-border overflow-hidden rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-none transition-colors duration-300">
      {/* Upper Mode Selector Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-50 dark:bg-slate-900 px-4 py-3 border-b border-slate-200 dark:border-slate-800 transition-colors gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-400 tracking-wider flex items-center gap-2">
            <Compass className="w-4 h-4 text-rose-500 dark:text-neon-pink" /> 
            Live Radar Overlays
          </span>
        </div>
        
        <div className="flex flex-wrap gap-1.5 bg-white dark:bg-slate-950 p-1 rounded-full border border-slate-200 dark:border-slate-800 transition-colors">
          <button
            id="radar-mode-btn"
            onClick={() => transitionMapMode('radar')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
              mapMode === 'radar'
                ? 'bg-slate-100 dark:bg-slate-800 border border-neon-aqua/20 dark:border-neon-aqua/40 text-cyan-700 dark:text-neon-aqua shadow-[0_0_8px_rgba(0,255,255,0.15)] dark:shadow-[0_0_8px_rgba(0,255,255,0.2)]'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <CloudRain className="w-3 h-3" />
            Precipitation Intensity
          </button>
          
          <button
            id="wind-mode-btn"
            onClick={() => transitionMapMode('wind')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
              mapMode === 'wind'
                ? 'bg-slate-100 dark:bg-slate-800 border border-neon-pink/20 dark:border-neon-pink/40 text-rose-600 dark:text-neon-pink shadow-[0_0_8px_rgba(255,105,180,0.15)] dark:shadow-[0_0_8px_rgba(255,105,180,0.2)]'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Wind className="w-3 h-3" />
            Wind Velocity
          </button>
        </div>
      </div>

      {/* Reflectivity Index Selector sub-toolbar */}
      {mapMode === 'radar' && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-100/90 dark:bg-slate-900/60 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 transition-all gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse inline-block"></span>
            Reflectivity Mode:
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setReflectivityType('standard')}
              className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-colors ${
                reflectivityType === 'standard'
                  ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-600 dark:text-neon-aqua shadow-[0_0_6px_rgba(0,255,255,0.1)]'
                  : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              Standard base dBZ
            </button>
            <button
              onClick={() => setReflectivityType('high-res')}
              className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border cursor-pointer transition-all duration-200 ${
                reflectivityType === 'high-res'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-neon-pink shadow-[0_0_8px_rgba(255,105,180,0.15)]'
                  : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              High-Res Debris & Hook Echo Filter
            </button>
          </div>
        </div>
      )}

      {/* Map display field */}
      <div className={`h-[320px] md:h-[400px] w-full relative transition-all duration-300 ${
        isTransitioning ? 'brightness-95 contrast-105 saturate-125' : 'brightness-100 contrast-100 saturate-100'
      }`}>
        {/* Failsafe Notification Toast */}
        {failsafeNotification && failsafeNotification.visible && (
          <div className="absolute top-16 left-3 right-3 z-[855] pointer-events-none flex justify-center">
            <div className="bg-slate-950/95 border-2 border-rose-500/80 hover:border-emerald-500/80 rounded-xl px-4 py-3 shadow-[0_0_20px_rgba(239,68,68,0.3)] max-w-lg text-white backdrop-blur-md flex items-start gap-3 pointer-events-auto transition-all">
              <span className="flex h-2 w-2 translate-y-1.5 rounded-full bg-rose-500 shrink-0 shadow-[0_0_8px_#ef4444] animate-ping" />
              <div className="flex-1">
                <div className="text-[10px] font-black uppercase tracking-wider text-rose-400 mb-0.5">
                  CAPE MAP OVERLAY ENGINE
                </div>
                <p className="text-[9px] text-slate-300 font-semibold leading-tight font-mono uppercase tracking-tight">
                  {failsafeNotification.message}
                </p>
              </div>
              <button
                onClick={clearFailsafeNotification}
                className="text-[9px] font-mono hover:text-emerald-400 text-slate-500 cursor-pointer uppercase font-black bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded transition-colors self-start animate-pulse"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Mode Switching Transition Effect Overlay */}
        <div className={`absolute inset-0 bg-slate-900/40 pointer-events-none transition-all duration-300 z-[1000] backdrop-blur-sm flex items-center justify-center ${
          isTransitioning ? 'opacity-100' : 'opacity-0'
        }`}>
          <div className="flex flex-col items-center gap-1 text-white bg-slate-950/80 border border-slate-800 p-3.5 rounded-xl shadow-2xl scale-100 transition-all duration-300">
            <RefreshCcw className="w-5 h-5 text-cyan-500 dark:text-neon-aqua animate-spin" />
            <span className="text-[9px] font-black tracking-widest font-mono uppercase text-slate-300">
              {mapMode === 'radar' ? 'LOADING RADAR OVERLAY...' : 'ANALYZING WIND VELOCITY...'}
            </span>
          </div>
        </div>

        {/* Premium Floating Interactive HUD controls */}
        <div className="absolute top-3 left-3 right-3 z-[800] flex flex-col sm:flex-row flex-wrap gap-2 pointer-events-none max-w-full">
          {/* Geocoder Place Search form */}
          <form onSubmit={handleGeoSearch} className="flex items-center bg-slate-950/90 border border-slate-800 rounded-xl px-2.5 py-1.5 shadow-2xl backdrop-blur-md pointer-events-auto shrink-0 w-full sm:w-auto">
            <Search className="w-3.5 h-3.5 text-cyan-400 mr-2 shrink-0 animate-pulse" />
            <input
              type="text"
              value={addressSearchQuery}
              onChange={(e) => setAddressSearchQuery(e.target.value)}
              placeholder="Search location/radar..."
              className="bg-transparent border-none text-white text-[10px] placeholder-slate-500 focus:outline-none w-full sm:w-40 font-bold uppercase tracking-wider py-1.5 px-2"
              disabled={isSearching}
            />
            {isSearching ? (
              <RefreshCcw className="w-3.5 h-3.5 text-cyan-400 animate-spin ml-1.5 shrink-0" />
            ) : (
              <button type="submit" className="text-[9px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded font-black uppercase cursor-pointer shrink-0 ml-1.5 transition-colors">
                Go
              </button>
            )}
          </form>

          {/* HUD dynamic info metrics block */}
          <div className="flex flex-wrap gap-1.5 pointer-events-auto">
            {/* Live Hover Coordinates Tracker */}
            <div className="flex items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-1.5 shadow-2xl backdrop-blur-md text-white font-mono text-[9px] leading-none shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-slate-400 uppercase font-bold tracking-wider">POS:</span>
              <span ref={coordsDisplayRef} className="font-black text-rose-400 tracking-wide">Hover Map</span>
            </div>

            {/* Dynamic Zoom level display */}
            <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-1.5 shadow-2xl backdrop-blur-md text-white font-mono text-[9px] leading-none">
              <span className="text-slate-400 uppercase font-bold tracking-wider">ZOOM:</span>
              <span className="font-black text-cyan-400 tracking-wider">{zoomLevel}x</span>
            </div>

            {/* Recenter button */}
            <button
              onClick={() => {
                const map = windyMapRef.current;
                if (map) {
                  map.setView([userLat, userLon], assets.length > 0 ? 8 : 6);
                }
              }}
              className="flex items-center gap-1 bg-slate-950/90 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500 rounded-xl px-3 py-1.5 shadow-2xl backdrop-blur-md text-white hover:text-cyan-400 text-[9px] font-black uppercase cursor-pointer transition-all leading-none"
            >
              <Navigation className="w-3 h-3 text-cyan-400" />
              Recenter
            </button>
          </div>

          {searchError && (
            <div className="bg-rose-950/95 border border-rose-800 text-rose-300 font-black font-mono text-[8px] tracking-wider uppercase px-2.5 py-1 rounded-lg shadow-2xl animate-pulse pointer-events-auto">
              {searchError}
            </div>
          )}
        </div>

        {/* Collapsible interactive Storm Legend HUD overlay */}
        <div className="absolute bottom-3 left-3 z-[800] flex flex-col items-start gap-1.5 max-w-[260px]">
          {isLegendExpanded ? (
            <div className="bg-slate-950/95 backdrop-blur-md border border-slate-800 text-white rounded-xl p-3 shadow-2xl w-56 animate-fade-in pointer-events-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  Telemetry Legend
                </span>
                <button
                  onClick={() => setIsLegendExpanded(false)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer text-[8px] font-black uppercase border border-slate-800"
                >
                  Hide
                </button>
              </div>

              <div className="space-y-2.5 text-[9px] font-bold leading-none">
                {/* 1. Core Alerts */}
                <div className="space-y-1.5">
                  <div className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest">NWS Warning Boundaries</div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-1.5 bg-rose-600 rounded inline-block"></span>
                    <span>Tornado Warning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-1.5 bg-orange-500 rounded inline-block"></span>
                    <span>Severe Thunderstorm</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-1.5 border border-dashed border-yellow-500 rounded inline-block"></span>
                    <span>Severe Storm/Tornado Watch</span>
                  </div>
                </div>

                {/* 2. Storm Vector Trajectories */}
                <div className="pt-2 border-t border-slate-900 space-y-1.5">
                  <div className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest">Storm Trajectories</div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-0.5 border-t border-dashed border-rose-500 inline-block"></span>
                    <span>Radar Vector Path Line</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 bg-slate-950 border border-rose-500 rounded-full flex items-center justify-center text-[7px] font-black font-mono text-rose-400 scale-90">30m</span>
                    <span>Impact Core Milestone (ETA)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-0.5 border-t border-dashed border-cyan-400 inline-block"></span>
                    <span>Directional Collision Path</span>
                  </div>
                </div>

                {/* 3. Potential Rotation */}
                <div className="pt-2 border-t border-slate-900 space-y-1.5">
                  <div className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest">Doppler Hazards</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block text-[10px] leading-none animate-[spin_5s_linear_infinite]">O</span>
                    <span>Convective Rotation Coupling</span>
                  </div>
                </div>

                {/* 4. Core Landmarks */}
                <div className="pt-2 border-t border-slate-900 space-y-1.5">
                  <div className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest">Landmarks</div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 border border-white inline-block"></span>
                    <span>Active GPS Gateway</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-neon-aqua border border-slate-950 rounded-md rotate-45 transform flex items-center justify-center shrink-0 inline-block"><span className="w-1 h-1 bg-slate-950 rounded-full"></span></span>
                    <span>Monitored Anchor Point</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsLegendExpanded(true)}
              className="flex items-center gap-1.5 bg-slate-950/90 hover:bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 shadow-2xl text-white hover:text-cyan-400 text-[9px] font-black uppercase cursor-pointer transition-all pointer-events-auto backdrop-blur-md leading-none"
            >
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              Viewer Legend
            </button>
          )}
        </div>

        {initError ? (
          <div key="failsafe-map" className="w-full h-full relative" id="fallback-leaflet-map-wrapper">
            <div id="fallback-leaflet-map" className="w-full h-full map-pane-resizable"></div>
            {/* Custom HTML5 Canvas for wind particle streams */}
            {mapMode === 'wind' && (
              <canvas
                id="wind-particle-canvas"
                className="absolute inset-0 z-[399] pointer-events-none w-full h-full"
              />
            )}
            
            {/* Proximity alerts status overlay */}
            <div className="absolute bottom-3 right-3 z-[400] bg-slate-950/90 border border-slate-800 p-2.5 rounded-xl text-[9px] font-mono text-slate-300 shadow-2xl backdrop-blur-md max-w-[240px]">
              <div className="flex justify-between font-bold text-slate-400 border-b border-slate-800 pb-1 mb-1 text-[8px]">
                <span>LOCALIZED PIN</span>
                <span>RANGE</span>
              </div>
              {assets.length === 0 ? (
                <div className="text-slate-500 text-center uppercase py-0.5 text-[8px]">Active GPS Gateway</div>
              ) : (
                assets.slice(0, 2).map(a => {
                  let bestDist = 999;
                  alerts.forEach(alert => {
                    const d = alert.geometry?.coordinates ? (() => { const r = getMemoizedMinPolygonDistance(a.id, a.lat, a.lon, alert.id, alert.geometry.coordinates); return r.isInside ? 0 : r.minDist; })() : alert.minDist;
                    if (d < bestDist) bestDist = d;
                  });
                  return (
                    <div key={a.id} className="flex justify-between gap-4 text-[9px]">
                      <span className="font-bold truncate text-white max-w-[100px]">{a.name}</span>
                      <span className="text-neon-pink font-black shrink-0">
                        {bestDist < 999 ? `${bestDist.toFixed(1)}mi` : 'SAFE'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div key="windy-map" className="w-full h-full relative">
            <div id="windy" className="w-full h-full"></div>
            {/* Display loader until API initialized */}
            {!apiLoaded && (
              <div className="absolute inset-0 bg-slate-950 flex flex-col justify-center items-center text-center p-6 z-20">
                <Compass className="w-12 h-12 text-neon-aqua animate-spin mb-4" />
                <h4 className="text-sm font-black uppercase tracking-wider text-white">
                  Securing Satellite Link
                </h4>
                <p className="text-slate-500 text-[10px] font-mono mt-1 mb-4">
                  Connecting to Windy Map API...
                </p>
                {/* Manual Bypass Button */}
                <button
                  onClick={() => setInitError(true)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[9px] font-black uppercase rounded-lg border border-slate-700 cursor-pointer shadow-md transition-colors"
                >
                  Bypass & Use Failsafe Map
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
