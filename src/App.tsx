import { useEffect, useRef, useState, useCallback } from 'react';
import { useToast } from './contexts/ToastContext';
import { useStormSiren } from './hooks/useStormSiren';
import { useNationalAlerts } from './hooks/useNationalAlerts';
import { LocationAsset, NWSAlert, TelemetryConditions, SystemSettings, MesoscaleDiscussion, RotationPin, NetworkRequestLog } from './types';
import {
  getDistance,
  getBearing,
  getGeometryCentroid,
  formatAddress,
  cardinalBearings,
  getParsedPolygonMinDistance,
  parseSPCLatLon,
} from './utils/geoUtils';
import GeolocationModal from './components/GeolocationModal';
import { ResolvedAlert } from './components/AlertHistory';
import RadarMap from './components/RadarMap';
import WindGauge from './components/WindGauge';
import ThreatCard from './components/ThreatCard';

// Lucide Icons
import {
  Compass,
  Activity,
  Share2,
  Plus,
  Trash2,
  MapPin,
  AlertTriangle,
  Volume2,
  VolumeX,
  Vibrate,
  VibrateOff,
  Radio,
  Clock,
  Wind,
  Thermometer,
  Gauge,
  Info,
  ShieldCheck,
  Download,
  AlertOctagon,
  Sun,
  Moon,
  TrendingUp,
  TrendingDown,
  Cloud,
  Terminal,
  Key,
  Smile,
  Zap,
  Flame,
} from 'lucide-react';

function parseMesoscaleDiscussion(id: string, issuanceTime: string, text: string): MesoscaleDiscussion {
  const numberMatch = text.match(/Mesoscale Discussion\s+(\d+)/i);
  const number = numberMatch ? numberMatch[1] : 'Unknown';
  
  const areasMatch = text.match(/Areas affected\.\.\.(.+)/i);
  let areasAffected = 'portions of the Ozarks and ArkLaTex';
  if (areasMatch) {
    const endIdx = areasMatch[1].indexOf('\n');
    areasAffected = endIdx !== -1 ? areasMatch[1].substring(0, endIdx).trim() : areasMatch[1].trim();
  }
  
  const concerningMatch = text.match(/Concerning\.\.\.(.+)/i);
  let concerning = 'Severe potential...Watch possible';
  if (concerningMatch) {
    const endIdx = concerningMatch[1].indexOf('\n');
    concerning = endIdx !== -1 ? concerningMatch[1].substring(0, endIdx).trim() : concerningMatch[1].trim();
  }
  
  const validMatch = text.match(/Valid\s+(.+)/i);
  let validTime = 'Unknown';
  if (validMatch) {
    const endIdx = validMatch[1].indexOf('\n');
    validTime = endIdx !== -1 ? validMatch[1].substring(0, endIdx).trim() : validMatch[1].trim();
  }
  
  const probMatch = text.match(/Probability of Watch Issuance\.\.\.(\d+)\s*percent/i);
  const probability = probMatch ? parseInt(probMatch[1], 10) : 0;
  
  let summary = '';
  const summaryMatch = text.match(/SUMMARY\.\.\.([\s\S]+?)(?=\n\s*\n|\n\s*DISCUSSION)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].replace(/\r?\n\s*/g, ' ').trim();
  } else {
    summary = `${concerning}. Affecting ${areasAffected}.`;
  }
  
  const coordinates = parseSPCLatLon(text);
  
  return {
    id,
    number,
    issuanceTime,
    areasAffected,
    concerning,
    validTime,
    probability,
    summary,
    text,
    coordinates,
    isIntersecting: false,
    minDist: 999,
  };
}

function translateAlertsToRotationPins(activeAlerts: NWSAlert[]): RotationPin[] {
  const pins: RotationPin[] = [];
  activeAlerts.forEach((alert) => {
    const fullText = `${alert.event} ${alert.description || ''} ${alert.instruction || ''} ${alert.snippet || ''}`.toUpperCase();
    const hasRotation = alert.keywords?.rotation ||
      fullText.includes('ROTATION') ||
      fullText.includes('VELOCITY COUPLING') ||
      fullText.includes('TORNADIC') ||
      fullText.includes('MESOCYCLONE') ||
      fullText.includes('ROTATING WALL') ||
      fullText.includes('ROTATING') ||
      fullText.includes('COUPLING');

    const hasObserved = alert.keywords?.observed ||
      fullText.includes('OBSERVED') ||
      fullText.includes('CONFIRMED') ||
      fullText.includes('TORNADO ON THE GROUND') ||
      fullText.includes('DEBRIS SIGNATURE') ||
      fullText.includes('TORNADO DEBRIS') ||
      fullText.includes('TDS') ||
      fullText.includes('DAMAGING TORNADO');

    const hasEmergency = alert.keywords?.emergency ||
      fullText.includes('TORNADO EMERGENCY') ||
      fullText.includes('PARTICULARLY DANGEROUS SITUATION') ||
      fullText.includes('PDS') ||
      fullText.includes('CATASTROPHIC') ||
      alert.event.toUpperCase().includes('EMERGENCY');

    const isTornadoWarning = alert.event.toUpperCase().includes('TORNADO WARNING') || 
                            alert.event.toUpperCase().includes('EXTREME SEVERE WEATHER');

    if (hasRotation && alert.geometry && alert.geometry.coordinates) {
      const centroid = getGeometryCentroid(alert.geometry.coordinates);
      if (centroid) {
        let pinType: 'vortex' | 'radar_indicated' | 'mesocyclone' = 'mesocyclone';
        let threatLevel: 'Normal' | 'Severe' | 'Extreme' = 'Normal';
        
        if (isTornadoWarning) {
          if (hasObserved || hasEmergency) {
            pinType = 'vortex';
            threatLevel = 'Extreme';
          } else {
            pinType = 'radar_indicated';
            threatLevel = 'Severe';
          }
        } else {
          pinType = 'mesocyclone';
          threatLevel = 'Normal';
        }

        pins.push({
          id: `rot-${alert.id}`,
          lat: centroid.lat,
          lon: centroid.lon,
          alertId: alert.id,
          eventName: alert.event,
          areaDesc: alert.areaDesc,
          detectedAt: alert.sent || new Date().toISOString(),
          pinType,
          threatLevel,
          isObserved: hasObserved || hasEmergency
        });
      }
    }
  });
  return pins;
}

export default function App() {
  const { triggerToast } = useToast();
  const { playSiren, stopSiren } = useStormSiren();

  // Main State Configuration
  const [armed, setArmed] = useState<boolean>(false);
  const [showLocationModal, setShowLocationModal] = useState<boolean>(false);
  const [isActivating, setIsActivating] = useState<boolean>(false);
  const [showTermsModal, setShowTermsModal] = useState<boolean>(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [termsAgreed, setTermsAgreed] = useState<boolean>(false);
  
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('daisy-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('daisy-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);
  
  const [assets, setAssets] = useState<LocationAsset[]>(() => {
    const raw = localStorage.getItem('daisy-assets');
    return raw ? JSON.parse(raw) : [];
  });

  const [showHeadedTowardsOnly, setShowHeadedTowardsOnly] = useState<boolean>(false);
  const [alertHistory, setAlertHistory] = useState<ResolvedAlert[]>(() => {
    const raw = localStorage.getItem('daisy-alert-history');
    return raw ? JSON.parse(raw) : [];
  });

  const addAlertsToHistory = useCallback((resolvedAlerts: NWSAlert[]) => {
    if (resolvedAlerts.length === 0) return;
    setAlertHistory((prev) => {
      const newItems: ResolvedAlert[] = resolvedAlerts.map((alert) => ({
        id: alert.id,
        event: alert.event,
        areaDesc: alert.areaDesc,
        expires: alert.expires,
        threatLevel: alert.threatLevel,
        resolvedAt: new Date().toISOString(),
        snippet: alert.snippet,
      }));

      const combined = [...newItems, ...prev];
      const uniqueCombined = combined.filter(
        (v, i, a) => a.findIndex((t) => t.id === v.id) === i
      );

      const sliced = uniqueCombined.slice(0, 10);
      localStorage.setItem('daisy-alert-history', JSON.stringify(sliced));
      return sliced;
    });
  }, []);

  const [discussions, setDiscussions] = useState<MesoscaleDiscussion[]>([]);
  const [rawApiDiscussions, setRawApiDiscussions] = useState<MesoscaleDiscussion[]>([]);
  const [customMDs, setCustomMDs] = useState<MesoscaleDiscussion[]>([]);
  const resolvedStationsRef = useRef<Record<string, string>>({});
  const [newMDText, setNewMDText] = useState<string>('');
  const [showMDInputForm, setShowMDInputForm] = useState<boolean>(false);
  const [expandedMDId, setExpandedMDId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryConditions | null>(null);
  const [windyPointTelemetry, setWindyPointTelemetry] = useState<{
    temp?: string;
    dewpoint?: string;
    wind?: string;
    gust?: string;
    pressure?: string;
    cape?: number;
    precip?: string;
    modelUsed: string;
  } | null>(null);
  const [windyPointLoading, setWindyPointLoading] = useState<boolean>(false);
  const [mapMode, setMapMode] = useState<'satellite' | 'radar' | 'wind'>('radar');
  const [pressureHistory, setPressureHistory] = useState<{ time: string; pressure: number }[]>([]);
  const [capeHistory, setCapeHistory] = useState<{ time: string; timestamp: number; cape: number; isForecast?: boolean }[]>([]);

  const [currentLat, setCurrentLat] = useState<number>(35.385);
  const [currentLon, setCurrentLon] = useState<number>(-94.398);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searching, setSearching] = useState<boolean>(false);
  
  const [syncStatus, setSyncStatus] = useState<string>('Disarmed');
  const [connectionOnline, setConnectionOnline] = useState<boolean>(navigator.onLine);
  
  // Settings
  const [settings, setSettings] = useState<SystemSettings>({
    audio: true,
    vibrate: true,
    flash: true,
    monitorRadius: 25,
    telemetryDebug: false,
    userMaskActive: true,
  });

  // Custom user-managed API keys
  const [customPointKey, setCustomPointKey] = useState<string>(() => localStorage.getItem('daisy-windy-point-key') || '');
  const [customMapKey, setCustomMapKey] = useState<string>(() => localStorage.getItem('daisy-windy-map-key') || '');
  const [showKeysPanel, setShowKeysPanel] = useState<boolean>(false);

  // Network logs for diagnostics and troubleshooting
  const [networkLogs, setNetworkLogs] = useState<NetworkRequestLog[]>([]);
  const [windyPointError, setWindyPointError] = useState<{
    status: number;
    message: string;
    suggestion?: string;
    linkText?: string;
    linkUrl?: string;
  } | null>(null);

  const logNetworkRequest = useCallback((log: Omit<NetworkRequestLog, 'id' | 'timestamp'>) => {
    const newLog: NetworkRequestLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setNetworkLogs(prev => [newLog, ...prev].slice(0, 5));
  }, []);

  // PWA deferred installation prompt
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);

  // Experimental Tornadogenesis Probability Analysis States
  const [tornadogenesisData, setTornadogenesisData] = useState<any | null>(null);
  const [isAnalyzingTelemetry, setIsAnalyzingTelemetry] = useState<boolean>(false);
  const [showTornadogenesisModal, setShowTornadogenesisModal] = useState<boolean>(false);

  // Potential rotation pins state derived from active alerts
  const [rotationPins, setRotationPins] = useState<RotationPin[]>([]);

  // Direct fetch wrapper — fully serverless, no proxy needed
  const proxyFetch = useCallback(async (url: string, options: any = {}) => {
    try {
      const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers: { ...(options.headers || {}) },
      };

      if (options.body && ['POST', 'PUT', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!(fetchOptions.headers as Record<string, string>)['Content-Type']) {
          (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(url, fetchOptions);
      return response;
    } catch (e) {
      console.error('[Direct Fetch Error for ' + url + ']', e);
      throw e;
    }
  }, []);

  const { alerts, fetchAlerts, setAlerts } = useNationalAlerts({
    currentLat,
    currentLon,
    assets,
    monitorRadius: settings.monitorRadius,
    triggerToast,
    logNetworkRequest,
    setSyncStatus,
    proxyFetch,
    addAlertsToHistory,
    translateAlertsToRotationPins,
    setRotationPins
  });

  // Restore/Sync stored assets
  useEffect(() => {
    localStorage.setItem('daisy-assets', JSON.stringify(assets));
  }, [assets]);

  // Sync online connection state
  useEffect(() => {
    const listenOnline = () => setConnectionOnline(true);
    const listenOffline = () => setConnectionOnline(false);
    window.addEventListener('online', listenOnline);
    window.addEventListener('offline', listenOffline);
    return () => {
      window.removeEventListener('online', listenOnline);
      window.removeEventListener('offline', listenOffline);
    };
  }, []);

  // Sync PWA installation listener
  useEffect(() => {
    const capturePrompt = (e: Event) => {
      e.preventDefault();
      setPwaPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', capturePrompt);
    return () => window.removeEventListener('beforeinstallprompt', capturePrompt);
  }, []);

  // Reset barometric pressure history on station ID transitions to allow fresh seeding
  useEffect(() => {
    setPressureHistory([]);
  }, [telemetry?.stationId]);

  // Sirens trigger lifecycle sync
  useEffect(() => {
    if (!armed) {
      stopSiren();
      return;
    }

    let maxLevel = 0;
    alerts.forEach((alert) => {
      if (alert.isDirectHit || alert.minDist <= settings.monitorRadius) {
        if (alert.keywords.emergency) maxLevel = Math.max(maxLevel, 3);
        else if (alert.event.includes('WARNING')) maxLevel = Math.max(maxLevel, 2);
        else if (alert.event.includes('WATCH')) maxLevel = Math.max(maxLevel, 1);
      }
    });

    if (maxLevel > 0) {
      playSiren(maxLevel, settings.audio);
      if (settings.vibrate && navigator.vibrate) {
        if (maxLevel === 3) {
          navigator.vibrate([100, 100, 100, 100, 300, 300, 100, 100]);
        } else {
          navigator.vibrate([500, 350, 500]);
        }
      }
    } else {
      stopSiren();
    }
  }, [alerts, armed, settings.audio, settings.vibrate, settings.monitorRadius, playSiren, stopSiren]);

  // stable references to fetchers to avoid dependency changes triggering re-running polling cycles
  const fetchAlertsRef = useRef(fetchAlerts);
  const fetchTelemetryRef = useRef((lat: number, lon: number) => {});
  const fetchMesoscaleDiscussionsRef = useRef(() => {});

  // High-Resolution Predictive Windy Point Forecast API Query
  const fetchWindyPointTelemetry = useCallback(async (lat: number, lon: number) => {
    const rawKey = (customPointKey || localStorage.getItem('daisy-windy-point-key') || (import.meta as any).env?.VITE_WINDY_POINT_KEY || 'SLQqAHupkugAsBbqWw6WsFvtJZsG1B4a');
    const windyPointKey = typeof rawKey === 'string' ? rawKey.trim() : '';

    if (!windyPointKey || windyPointKey === '') {
      console.warn('[Telemetry Debug] Windy Point Forecast API Key is empty or missing. Skipping request.');
      setWindyPointTelemetry(null);
      return;
    }

    setWindyPointLoading(true);
    const isUS = lat > 24 && lat < 50 && lon > -125 && lon < -66;
    let model = isUS ? 'namConus' : 'gfs';
    const url = `https://api.windy.com/api/point-forecast/v2?key=${windyPointKey}`;
    const body = {
      lat: lat,
      lon: lon,
      model: model,
      parameters: ['temp', 'wind', 'windGust', 'pressure', 'dewpoint', 'precip', 'cape'],
      levels: ['surface'],
      key: windyPointKey
    };
    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': windyPointKey,
      'key': windyPointKey
    };

    try {
      if (settings.telemetryDebug) {
        console.log('[Telemetry Debug] Initiating Windy Forecast Query', {
          timestamp: new Date().toISOString(),
          endpoint: url,
          requestPayload: body
        });
      }

      let res = await proxyFetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(body)
      });

      if (!res.ok && model !== 'gfs') {
        const errTxt = await res.clone().text().catch(() => '');
        console.warn(`Windy API model '${model}' rejected (Status ${res.status}: ${errTxt}). Falling back to 'gfs'...`);
        
        logNetworkRequest({
          service: 'Windy',
          url: `https://api.windy.com/api/point-forecast/v2?model-fallback=gfs`,
          method: 'POST',
          status: res.status,
          statusText: `Fallback from ${model}`,
          headers: reqHeaders,
          error: `Model '${model}' failed: ${errTxt}`
        });

        model = 'gfs';
        body.model = 'gfs';
        res = await proxyFetch(`https://api.windy.com/api/point-forecast/v2?key=${windyPointKey}`, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(body)
        });
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => 'No further details provided');
        const is400 = res.status === 400;
        
        logNetworkRequest({
          service: 'Windy',
          url: `https://api.windy.com/api/point-forecast/v2?key=`,
          method: 'POST',
          status: res.status,
          statusText: res.statusText || 'Bad Request',
          headers: reqHeaders,
          error: errText,
          suggestedAction: is400 ? `Check permissions for model '${model}'. Verify usage limits on Windy portal.` : undefined
        });

        if (is400) {
          setWindyPointError({
            status: 400,
            message: `Bad Request (400): ${errText}`,
            suggestion: `The key might not have permission to fetch model '${model}' point forecasts. Default keys have strict model limits (e.g. gfs only).`,
            linkText: "Windy Account API Keys Portal",
            linkUrl: "https://api.windy.com/keys"
          });
          triggerToast(`Windy API 400: Your key might lack permissions for point forecast model ${model}.`, 'error');
        } else {
          setWindyPointError({
            status: res.status,
            message: `API Error ${res.status}: ${errText}`
          });
        }

        throw new Error(`Status ${res.status} - Details: ${errText}`);
      }

      const data = await res.json();
      setWindyPointError(null);

      logNetworkRequest({
        service: 'Windy',
        url: `https://api.windy.com/api/point-forecast/v2`,
        method: 'POST',
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': 'application/json',
          'model-requested': model
        }
      });

      if (data && data.ts && data.ts.length > 0) {
        const nowMs = Date.now();
        let closestIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < data.ts.length; i++) {
          const diff = Math.abs(data.ts[i] - nowMs);
          if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
          }
        }

        const parseTempToF = (val: number | undefined) => {
          if (val === undefined) return undefined;
          if (val > 150) {
            return (((val - 273.15) * 9) / 5 + 32).toFixed(1);
          } else {
            return ((val * 9) / 5 + 32).toFixed(1);
          }
        };

        const parseWindToMph = (val: number | undefined) => {
          if (val === undefined || val === null || isNaN(val)) return undefined;
          const mph = val * 2.23694;
          if (mph > 250 || mph < 0) return undefined;
          return mph.toFixed(0);
        };

        const parsePaToInHg = (val: number | undefined) => {
          if (val === undefined) return undefined;
          return (val * 0.0002953).toFixed(2);
        };

        const tempVal = data['temp-surface']?.[closestIndex];
        const dewVal = data['dewpoint-surface']?.[closestIndex];
        const windVal = data['wind-surface']?.[closestIndex];
        const gustVal = data['windGust-surface']?.[closestIndex] || data['gust-surface']?.[closestIndex];
        const pressureVal = data['pressure-surface']?.[closestIndex];
        const capeVal = data['cape-surface']?.[closestIndex];
        const precipVal = data['precip-surface']?.[closestIndex];

        const currentCape = capeVal !== undefined ? Math.round(capeVal) : 0;
        const latLonKey = `daisy-cape-history-${lat.toFixed(2)}_${lon.toFixed(2)}`;
        
        let storedPoints: { time: string; timestamp: number; cape: number; isForecast?: boolean }[] = [];
        try {
          const storedHistoryRaw = localStorage.getItem(latLonKey);
          if (storedHistoryRaw) {
            storedPoints = JSON.parse(storedHistoryRaw);
          }
        } catch (e) {}
        
        const sixHoursAgo = nowMs - 6 * 3600 * 1000;
        storedPoints = storedPoints.filter(p => p.timestamp >= sixHoursAgo && p.timestamp <= nowMs);
        
        const currentHourString = new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const lastStored = storedPoints[storedPoints.length - 1];
        if (!lastStored || Math.abs(nowMs - lastStored.timestamp) > 5 * 60000) {
          storedPoints.push({
            time: currentHourString,
            timestamp: nowMs,
            cape: currentCape,
          });
          storedPoints = storedPoints.filter(p => p.timestamp >= sixHoursAgo);
          try {
            localStorage.setItem(latLonKey, JSON.stringify(storedPoints));
          } catch(e) {}
        }
        
        if (storedPoints.length < 6) {
          const mergedPoints: { time: string; timestamp: number; cape: number; isForecast?: boolean }[] = [];
          for (let h = 6; h >= 0; h--) {
            const pointTimeMs = nowMs - h * 3600 * 1000;
            const pointDate = new Date(pointTimeMs);
            const formattedTime = pointDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            let matchedCape = -1;
            let bestDiff = Infinity;
            for (let i = 0; i < data.ts.length; i++) {
              const diff = Math.abs(data.ts[i] - pointTimeMs);
              if (diff < bestDiff && diff < 1.8 * 3600 * 1000) {
                bestDiff = diff;
                matchedCape = data['cape-surface']?.[i] !== undefined ? Math.round(data['cape-surface'][i]) : -1;
              }
            }
            
            if (matchedCape !== -1) {
              mergedPoints.push({
                time: formattedTime,
                timestamp: pointTimeMs,
                cape: matchedCape,
                isForecast: pointTimeMs > nowMs
              });
            } else {
              const factor = Math.max(0.1, 1 - (h * 0.15) - (0.1 * Math.sin(h)));
              const simCape = Math.round(currentCape * factor);
              mergedPoints.push({
                time: formattedTime,
                timestamp: pointTimeMs,
                cape: simCape,
                isForecast: false
              });
            }
          }
          setCapeHistory(mergedPoints);
        } else {
          setCapeHistory([...storedPoints].sort((a, b) => a.timestamp - b.timestamp));
        }

        setWindyPointTelemetry({
          temp: parseTempToF(tempVal),
          dewpoint: parseTempToF(dewVal),
          wind: parseWindToMph(windVal),
          gust: parseWindToMph(gustVal),
          pressure: parsePaToInHg(pressureVal),
          cape: capeVal !== undefined ? Math.round(capeVal) : undefined,
          precip: precipVal !== undefined ? precipVal.toFixed(2) : undefined,
          modelUsed: model.toUpperCase()
        });
      } else {
        setWindyPointTelemetry(null);
      }
    } catch (err: any) {
      console.warn('Silent fallback: Windy Point Forecast API query failed', err);
      setWindyPointTelemetry(null);
    } finally {
      setWindyPointLoading(false);
    }
  }, [customPointKey, settings.telemetryDebug, proxyFetch, logNetworkRequest, triggerToast]);

  // Fetch National Weather Service grid forecast details
  const fetchNWSForecast = useCallback(async (lat: number, lon: number) => {
    try {
      const forecastCacheKey = `fc_${lat.toFixed(2)}_${lon.toFixed(2)}`;
      let forecastUrl = resolvedStationsRef.current[forecastCacheKey];
      const headers = {
        'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
      };

      if (!forecastUrl) {
        const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
        const ptRes = await proxyFetch(pointsUrl, { headers });

        logNetworkRequest({
          service: 'NWS',
          url: pointsUrl,
          method: 'GET',
          status: ptRes.status,
          statusText: ptRes.ok ? 'OK' : 'Error',
          headers: headers
        });

        if (!ptRes.ok) return null;

        const ptData = await ptRes.json();
        forecastUrl = ptData.properties?.forecast;
        if (forecastUrl) {
          resolvedStationsRef.current[forecastCacheKey] = forecastUrl;
        }
      }

      if (!forecastUrl) return null;

      const fcRes = await proxyFetch(forecastUrl, { headers });
      logNetworkRequest({
        service: 'NWS',
        url: forecastUrl,
        method: 'GET',
        status: fcRes.status,
        statusText: fcRes.ok ? 'OK' : 'Error',
        headers: headers
      });

      if (!fcRes.ok) return null;

      const fcData = await fcRes.json();
      const periods = fcData.properties?.periods || [];

      let highTemp: number | undefined;
      let lowTemp: number | undefined;
      let probPrecip: number | undefined;

      periods.slice(0, 3).forEach((p: any) => {
        if (p.isDaytime && highTemp === undefined) {
          highTemp = p.temperature;
        }
        if (!p.isDaytime && lowTemp === undefined) {
          lowTemp = p.temperature;
        }
      });

      periods.slice(0, 3).forEach((p: any) => {
        const popVal = p.probabilityOfPrecipitation?.value;
        if (popVal !== null && popVal !== undefined) {
          if (probPrecip === undefined || popVal > probPrecip) {
            probPrecip = popVal;
          }
        }
      });

      return {
        highTemp: highTemp !== undefined ? `${highTemp}°F` : undefined,
        lowTemp: lowTemp !== undefined ? `${lowTemp}°F` : undefined,
        probPrecip: probPrecip !== undefined ? `${probPrecip}%` : '0%'
      };
    } catch (err) {
      console.warn('Silent fallback: NWS forecast query failed', err);
      return null;
    }
  }, [proxyFetch, logNetworkRequest]);

  // NWS XML Telemetry Observations Engine (Layer 2 Telemetry)
  const fetchTelemetry = useCallback(async (lat: number, lon: number) => {
    fetchWindyPointTelemetry(lat, lon);
    
    let forecastInfo: { highTemp?: string; lowTemp?: string; probPrecip?: string } | null = null;
    try {
      forecastInfo = await fetchNWSForecast(lat, lon);
    } catch (fcErr) {
      console.warn('Silent fallback: NWS forecast fetch failed', fcErr);
    }

    try {
      const stationCacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
      let stationId = resolvedStationsRef.current[stationCacheKey];
      let stationName = '';

      if (!stationId) {
        const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
        const headers = {
          'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
        };
        const ptRes = await proxyFetch(pointsUrl, { headers });
        
        logNetworkRequest({
          service: 'NWS',
          url: pointsUrl,
          method: 'GET',
          status: ptRes.status,
          statusText: ptRes.statusText || (ptRes.ok ? 'OK' : 'Error'),
          headers: headers
        });

        if (!ptRes.ok) return;

        const ptData = await ptRes.json();
        const stationsUrl = ptData.properties?.observationStations;
        if (!stationsUrl) return;

        const stationRes = await proxyFetch(stationsUrl, { headers });
        
        logNetworkRequest({
          service: 'NWS',
          url: stationsUrl,
          method: 'GET',
          status: stationRes.status,
          statusText: stationRes.statusText || (stationRes.ok ? 'OK' : 'Error'),
          headers: headers
        });

        if (!stationRes.ok) return;

        const stationData = await stationRes.json();
        const firstFeature = stationData.features?.[0]?.properties;
        stationId = firstFeature?.stationIdentifier;
        stationName = firstFeature?.name || '';
        
        if (stationId) {
          resolvedStationsRef.current[stationCacheKey] = stationId;
          resolvedStationsRef.current[`${stationCacheKey}_name`] = stationName;
        }
      } else {
        stationName = resolvedStationsRef.current[`${stationCacheKey}_name`] || stationId;
      }

      if (!stationId) return;

      const obsUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`;
      const obsHeaders = {
        'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
      };
      const obsRes = await proxyFetch(obsUrl, { headers: obsHeaders });
      
      logNetworkRequest({
        service: 'NWS',
        url: obsUrl,
        method: 'GET',
        status: obsRes.status,
        statusText: obsRes.ok ? 'OK' : 'Error',
        headers: obsHeaders
      });

      if (!obsRes.ok) return;

      const obsData = await obsRes.json();
      const props = obsData.properties || {};

      const cToF = (val: number | null) => {
        if (val === null) return undefined;
        return ((val * 9) / 5 + 32).toFixed(1);
      };

      const mpsToMph = (val: number | null) => {
        if (val === null || val === undefined || isNaN(val)) return undefined;
        const mph = val * 2.23694;
        if (mph > 250 || mph < 0) return undefined;
        return mph.toFixed(0);
      };

      const paToInHg = (val: number | null) => {
        if (val === null) return undefined;
        return (val * 0.0002953).toFixed(2);
      };

      const livePressureStr = paToInHg(props.barometricPressure?.value);

      try {
        const histUrl = `https://api.weather.gov/stations/${stationId}/observations?limit=12`;
        const histRes = await proxyFetch(histUrl, { headers: obsHeaders });
        logNetworkRequest({
          service: 'NWS',
          url: histUrl,
          method: 'GET',
          status: histRes.status,
          statusText: histRes.ok ? 'OK' : 'Error',
          headers: obsHeaders
        });

        if (histRes.ok) {
          const histData = await histRes.json();
          const features = histData.features || [];
          const pts = features
            .map((f: any) => {
              const p = f.properties || {};
              const rawP = p.barometricPressure?.value;
              const ts = p.timestamp;
              if (rawP === null || rawP === undefined || !ts) return null;
              const pressureInHg = parseFloat((rawP * 0.0002953).toFixed(2));
              const d = new Date(ts);
              const formatted = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return {
                time: formatted,
                pressure: pressureInHg,
                timestamp: d.getTime()
              };
            })
            .filter((x: any) => x !== null) as { time: string; pressure: number; timestamp: number }[];

          if (pts.length > 0) {
            pts.sort((a, b) => a.timestamp - b.timestamp);
            
            const uniquePoints: { [key: string]: { time: string; pressure: number; timestamp: number } } = {};
            pts.forEach(pt => {
              uniquePoints[pt.time] = pt;
            });
            const deduplicated = Object.values(uniquePoints).sort((a, b) => a.timestamp - b.timestamp);

            const finalPoints = deduplicated.slice(-6).map(p => ({
              time: p.time,
              pressure: p.pressure
            }));

            setPressureHistory(finalPoints);
          } else if (livePressureStr) {
            const formattedNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setPressureHistory([{ time: formattedNow, pressure: parseFloat(livePressureStr) }]);
          }
        } else if (livePressureStr) {
          const formattedNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPressureHistory([{ time: formattedNow, pressure: parseFloat(livePressureStr) }]);
        }
      } catch (histErr) {
        console.warn('Silent fallback: barometric observation history fetch failed', histErr);
        if (livePressureStr) {
          const formattedNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setPressureHistory([{ time: formattedNow, pressure: parseFloat(livePressureStr) }]);
        }
      }

      setTelemetry({
        stationId: stationId,
        stationName: stationName,
        temperature: cToF(props.temperature?.value),
        dewPoint: cToF(props.dewpoint?.value),
        windSpeed: mpsToMph(props.windSpeed?.value),
        windGust: mpsToMph(props.windGust?.value),
        windDirection: props.windDirection?.value ? `${props.windDirection.value}°` : undefined,
        pressure: livePressureStr,
        textDescription: props.textDescription || undefined,
        timestamp: props.timestamp ? new Date(props.timestamp).toLocaleTimeString() : undefined,
        highTemp: forecastInfo?.highTemp,
        lowTemp: forecastInfo?.lowTemp,
        probPrecip: forecastInfo?.probPrecip || '0%',
      });
    } catch (err) {
      console.warn('Silent fallback: observation telemetry unreachable', err);
    }
  }, [fetchWindyPointTelemetry, fetchNWSForecast, proxyFetch, logNetworkRequest]);

  // Core SPC Mesoscale Discussions Acquisition Engine
  const fetchMesoscaleDiscussions = useCallback(async () => {
    try {
      const res = await proxyFetch('https://api.weather.gov/products/types/MCD', {
        headers: {
          'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
        }
      });
      let apiDiscussions: MesoscaleDiscussion[] = [];

      if (res.ok) {
        const data = await res.json();
        const graph = data['@graph'] || [];

        const sortedGraph = [...graph].sort((a: any, b: any) =>
          new Date(b.issuanceTime).getTime() - new Date(a.issuanceTime).getTime()
        );
        const topProducts = sortedGraph.slice(0, 5);

        const fetched = await Promise.all(
          topProducts.map(async (prod: any) => {
            try {
              const prodRes = await proxyFetch(`https://api.weather.gov/products/${prod.id}`, {
                headers: {
                  'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
                }
              });
              if (!prodRes.ok) return null;
              const fullProd = await prodRes.json();
              if (!fullProd.productText) return null;

              return parseMesoscaleDiscussion(prod.id, prod.issuanceTime, fullProd.productText);
            } catch (e) {
              return null;
            }
          })
        );
        apiDiscussions = fetched.filter((x): x is MesoscaleDiscussion => x !== null);
      }

      setRawApiDiscussions(apiDiscussions);
    } catch (err) {
      console.warn('Failed to load SPC mesoscale discussions:', err);
    }
  }, [proxyFetch]);

  // stable references to avoid stale closures in effects
  useEffect(() => {
    fetchAlertsRef.current = fetchAlerts;
  }, [fetchAlerts]);

  useEffect(() => {
    fetchTelemetryRef.current = fetchTelemetry;
  }, [fetchTelemetry]);

  useEffect(() => {
    fetchMesoscaleDiscussionsRef.current = fetchMesoscaleDiscussions;
  }, [fetchMesoscaleDiscussions]);

  // Periodic Alert Syncing Loop
  useEffect(() => {
    if (!armed) return;

    fetchAlertsRef.current();
    fetchTelemetryRef.current(currentLat, currentLon);
    fetchMesoscaleDiscussionsRef.current();

    const alertInterval = setInterval(() => {
      fetchAlertsRef.current();
      fetchMesoscaleDiscussionsRef.current();
    }, 60000);

    const telemetryInterval = setInterval(() => {
      fetchTelemetryRef.current(currentLat, currentLon);
    }, 300000);

    return () => {
      clearInterval(alertInterval);
      clearInterval(telemetryInterval);
      stopSiren();
    };
  }, [armed, currentLat, currentLon, stopSiren]);

  const addAlertsToHistoryRef = useRef(addAlertsToHistory);
  useEffect(() => {
    addAlertsToHistoryRef.current = addAlertsToHistory;
  }, [addAlertsToHistory]);

  // Auto-resolve expired alerts locally
  useEffect(() => {
    const checkExpiredAlerts = () => {
      const now = new Date();
      setAlerts((prevAlerts) => {
        const expired = prevAlerts.filter((alert) => alert.expires && new Date(alert.expires) <= now);
        if (expired.length > 0) {
          addAlertsToHistoryRef.current(expired);
          triggerToast(`${expired.length} threat${expired.length > 1 ? "s" : ""} expired and archived.`, "info");
          return prevAlerts.filter((alert) => !alert.expires || new Date(alert.expires) > now);
        }
        return prevAlerts;
      });
    };

    const interval = setInterval(checkExpiredAlerts, 5000);
    return () => clearInterval(interval);
  }, [triggerToast, setAlerts]);

  // Perform purely local geometric calculations for discussions
  useEffect(() => {
    const allDiscussionsList = [...customMDs, ...rawApiDiscussions];

    const processedMDs = allDiscussionsList.map((md) => {
      let minDist = 9999;
      let isIntersecting = false;

      if (assets.length > 0) {
        assets.forEach((a) => {
          const check = getParsedPolygonMinDistance(a.lat, a.lon, md.coordinates);
          if (check.isInside) isIntersecting = true;
          if (check.minDist < minDist) {
            minDist = check.minDist;
          }
        });
      } else {
        const check = getParsedPolygonMinDistance(currentLat, currentLon, md.coordinates);
        if (check.isInside) isIntersecting = true;
        minDist = check.minDist;
      }

      return {
        ...md,
        isIntersecting,
        minDist: minDist === 9999 ? 999 : minDist,
      };
    });

    processedMDs.sort((a, b) => {
      if (a.isIntersecting && !b.isIntersecting) return -1;
      if (!a.isIntersecting && b.isIntersecting) return 1;
      return a.minDist - b.minDist;
    });

    setDiscussions(processedMDs);
  }, [rawApiDiscussions, customMDs, assets, currentLat, currentLon]);

  // Convective Telemetry Analysis Orchestration
  const fetchTelemetryAnalysis = useCallback(async (customTelemetry?: any, customCape?: number) => {
    const targetTelemetry = customTelemetry || telemetry;
    const targetCape = customCape !== undefined ? customCape : (windyPointTelemetry?.cape !== undefined ? windyPointTelemetry.cape : (capeHistory.length > 0 ? capeHistory[capeHistory.length - 1].cape : 0));

    if (!targetTelemetry) {
      console.warn('No active telemetry data synchronized yet.');
      return;
    }

    try {
      setIsAnalyzingTelemetry(true);
      const res = await fetch('/api/telemetry-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          temperature: targetTelemetry.temperature,
          dewPoint: targetTelemetry.dewPoint,
          windSpeed: targetTelemetry.windSpeed,
          windGust: targetTelemetry.windGust,
          pressure: targetTelemetry.pressure,
          cape: targetCape,
          recentDiscussions: discussions.map(d => ({ number: d.number, headline: d.areasAffected })),
          activeAlerts: alerts.map(a => a.event)
        })
      });

      logNetworkRequest({
        service: 'Analyzer',
        url: '/api/telemetry-analysis',
        method: 'POST',
        status: res.status,
        statusText: res.ok ? 'OK' : 'Error',
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const payload = await res.json();
        setTornadogenesisData(payload);
      } else {
        console.warn('Server analyzer endpoint responded with error status:', res.status);
      }
    } catch (e) {
      console.warn('Failed to parse microclimate convective ingredients:', e);
    } finally {
      setIsAnalyzingTelemetry(false);
    }
  }, [telemetry, windyPointTelemetry, capeHistory, discussions, alerts, logNetworkRequest]);

  // Automate background thermodynamic analysis on telemetry syncs
  useEffect(() => {
    if (telemetry) {
      fetchTelemetryAnalysis();
    }
  }, [telemetry?.timestamp, telemetry?.stationId, fetchTelemetryAnalysis]);

  // Add search/pin targeted locations
  const handleAddNewPin = async () => {
    const cleanedQuery = searchQuery.trim();
    if (!cleanedQuery) return;

    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanedQuery)}&countrycodes=us&addressdetails=1&limit=1`;
      const res = await proxyFetch(url, {
        headers: { 'User-Agent': 'DAISY-Emergency-System/1.0 (contact: cerberus@c0dejunky.com)' },
      });

      if (!res.ok) throw new Error('Geocoding request failed');
      const payload = await res.json();

      if (payload && payload.length > 0) {
        const item = payload[0];
        const latVal = parseFloat(item.lat);
        const lonVal = parseFloat(item.lon);
        const formattedName = formatAddress(item.address, cleanedQuery);

        const newAsset: LocationAsset = {
          id: `pinned-${Date.now()}`,
          name: formattedName,
          lat: latVal,
          lon: lonVal,
        };

        setAssets((prev) => [...prev, newAsset]);
        setSearchQuery('');
        setCurrentLat(latVal);
        setCurrentLon(lonVal);
        
        setTimeout(() => {
          fetchAlertsRef.current();
          fetchTelemetryRef.current(latVal, lonVal);
        }, 100);
      } else {
        triggerToast('Location pattern unmatched. Please try closer zip codes or US cities.', 'error');
      }
    } catch (e) {
      console.error(e);
      triggerToast('Search failed. Check your network connection.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleRemovePin = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  const handleAddCustomMD = (inputText: string) => {
    if (!inputText.trim()) return;
    try {
      const parsed = parseMesoscaleDiscussion(`custom-${Date.now()}`, new Date().toISOString(), inputText);
      setCustomMDs((prev) => [parsed, ...prev]);
    } catch (e) {
      console.warn('Coordinates parsing error:', e);
      triggerToast('Error: LAT...LON coordinate block not detected or improperly formatted in custom text.', 'error');
    }
  };

  // Engaging Gateway
  const handleArmActivation = () => {
    if (isActivating) return;
    setIsActivating(true);
    setLocationError(null);

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setCurrentLat(lat);
          setCurrentLon(lon);

          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
            const response = await proxyFetch(url, {
              headers: { 'User-Agent': 'DAISY-Emergency-System/1.0 (contact: cerberus@c0dejunky.com)' },
            });
            if (response.ok) {
              const data = await response.json();
              const pinName = formatAddress(data.address, 'Current GPS Base');
              
              setAssets((prev) => {
                if (prev.some((a) => Math.abs(a.lat - lat) < 0.02 && Math.abs(a.lon - lon) < 0.02)) {
                  return prev;
                }
                return [
                  ...prev,
                  { id: `current-gps`, name: pinName, lat, lon },
                ];
              });
            }
          } catch (err) {
            setAssets((prev) => {
              if (prev.some((a) => Math.abs(a.lat - lat) < 0.02 && Math.abs(a.lon - lon) < 0.02)) {
                return prev;
              }
              return [
                ...prev,
                { id: `current-gps`, name: 'CURRENT GPS BASE', lat, lon },
              ];
            });
          }

          setArmed(true);
          setIsActivating(false);
          setShowTermsModal(false);
          setLocationError(null);
          triggerToast('Precise GPS position identified. Alarms active.', 'success');
        },
        (error) => {
          console.warn("Geolocation precise position failed or denied. Falling back to default coordinates.", error);
          setIsActivating(false);
          setArmed(true);
          setShowTermsModal(false);
          setLocationError(null);
          triggerToast('Location query rejected. Alarms activated with default coordinates.', 'info');
        },
        {
          enableHighAccuracy: true,
          timeout: 4000,
          maximumAge: 0
        }
      );
    } else {
      setIsActivating(false);
      setArmed(true);
      setShowTermsModal(false);
      setLocationError(null);
      triggerToast('Geolocation not supported. Alarms armed with default coordinates.', 'info');
    }
  };

  const handleLocationAccept = () => {
    handleArmActivation();
  };

  const handleLocationDecline = () => {
    setIsActivating(false);
    setLocationError("Location permission query was declined. Precise device geolocation coordinates are mandatory to use D.A.I.S.Y.");
    triggerToast('Location permission is required to proceed.', 'error');
  };

  const handleClearAlertHistory = () => {
    setAlertHistory([]);
    localStorage.removeItem('daisy-alert-history');
  };

  const handleRemoveAlertHistoryItem = (id: string) => {
    setAlertHistory((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      localStorage.setItem('daisy-alert-history', JSON.stringify(updated));
      return updated;
    });
  };

  // Test Sirens Tone trigger manually
  const handleTestSiren = () => {
    playSiren(2, true);
    setTimeout(() => stopSiren(), 2500);
  };

  // Share Application
  const handleShareApp = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DAISY Emergency Weather System',
          url: window.location.href,
        });
        return;
      } catch (err) {}
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      triggerToast('DAISY access link copied to clipboard.', 'success');
    } catch {
      triggerToast(`Share URL: ${window.location.href}`, 'info');
    }
  };

  // Trigger PWA Installation flow
  const handlePwaInstall = () => {
    if (pwaPrompt) {
      pwaPrompt.prompt();
      pwaPrompt.userChoice.then((choice: any) => {
        if (choice.outcome === 'accepted') {
          setPwaPrompt(null);
        }
      });
    }
  };

  // Focus Trajectory centered over matching alert
  const handleFocusTrajectory = (alert: NWSAlert) => {
    if (alert.geometry && alert.geometry.coordinates) {
      try {
        const centroid = getGeometryCentroid(alert.geometry.coordinates);
        if (centroid) {
          setCurrentLat(centroid.lat);
          setCurrentLon(centroid.lon);
          setMapMode('radar');
        }
      } catch (e) {
        console.warn('Error focusing trajectory centroid:', e);
      }
    }
  };

  const handleFocusMD = (md: MesoscaleDiscussion) => {
    if (md.coordinates && md.coordinates.length > 0) {
      const lats = md.coordinates.map((c) => c.lat);
      const lons = md.coordinates.map((c) => c.lon);
      const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const avgLon = lons.reduce((a, b) => a + b, 0) / lons.length;

      setCurrentLat(avgLat);
      setCurrentLon(avgLon);
      setMapMode('radar');
    }
  };

  const isAnyDirectHitWarningActive = alerts.some(
    (a) => a.isDirectHit && (a.event.includes('WARNING') || a.keywords.rotation || a.keywords.possible)
  );

  const activeIntersectingMD = discussions.find(
    (d) => d.isIntersecting && d.probability >= 40
  );

  const forecastTrend = (() => {
    const hasPressure = pressureHistory && pressureHistory.length >= 2;
    const hasCape = capeHistory && capeHistory.length >= 2;

    if (!hasPressure && !hasCape) {
      return {
        status: 'Trend: Stable',
        statusDesc: 'Synchronizing regional surface pressure sensors and convective profiles. Active coordinate targets currently reflect thermodynamically stable layers.',
        bypassChance: 'N/A',
        badgeColor: 'border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-500',
        textColor: 'text-slate-500',
        shadowColor: '',
        trendLabel: 'Awaiting polling records to calculate local storm bypass risk indices.',
        pressureDeltaText: 'Measuring...',
        capeDeltaText: 'Measuring...',
        pressureDirection: 'Stable',
        capeDirection: 'Stable',
        deltaPressure: 0,
        maxCapeVal: 0,
        currentCapeVal: 0,
        isUnstable: false,
        isStable: true
      };
    }

    let deltaPressure = 0;
    let pressureDirection = 'Steady';
    if (hasPressure) {
      const earliestP = pressureHistory[0].pressure;
      const latestP = pressureHistory[pressureHistory.length - 1].pressure;
      deltaPressure = latestP - earliestP;
      if (deltaPressure < -0.04) {
        pressureDirection = 'Falling Rapidly';
      } else if (deltaPressure < -0.01) {
        pressureDirection = 'Falling';
      } else if (deltaPressure > 0.04) {
        pressureDirection = 'Rising Rapidly';
      } else if (deltaPressure > 0.01) {
        pressureDirection = 'Rising';
      }
    }

    const currentCapeVal = windyPointTelemetry?.cape !== undefined 
      ? windyPointTelemetry.cape 
      : (capeHistory.length > 0 ? capeHistory[capeHistory.length - 1].cape : 0);
    const maxCapeVal = capeHistory.length > 0 ? Math.max(...capeHistory.map(p => p.cape)) : currentCapeVal;
    
    let capeDirection = 'Stable';
    if (hasCape) {
      const earliestC = capeHistory[0].cape;
      const latestC = currentCapeVal;
      const deltaCape = latestC - earliestC;
      if (deltaCape > 300) {
        capeDirection = 'Increasing Instability';
      } else if (deltaCape < -300) {
        capeDirection = 'Stabilizing';
      }
    }

    let status = 'Trend: Stable';
    let statusDesc = 'Approaching storms are highly likely to weaken, dissipate, or split and go around your selected locations due to low atmospheric fuel.';
    let bypassChance = 'High (80% - 90% Bypass)';
    let badgeColor = 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400';
    let textColor = 'text-emerald-700 dark:text-emerald-400';
    let shadowColor = 'shadow-[0_4px_20px_rgba(16,185,129,0.05)]';
    let trendLabel = 'Stable Atmosphere / Storm Dissipation Mode';
    let isUnstable = false;
    let isStable = true;
    
    const pressureDeltaText = `${deltaPressure >= 0 ? '+' : ''}${deltaPressure.toFixed(2)} InHg`;
    const capeDeltaText = `${maxCapeVal} J/kg Peak`;

    if (deltaPressure < -0.015 && (maxCapeVal > 1500 || capeDirection === 'Increasing Instability')) {
      status = 'Trend: Rapidly Destabilizing';
      statusDesc = 'Atmospheric pressure is dropping rapidly while convective energy rises. Storm cells entering this workspace are highly likely to maintain severity or intensify to direct hits.';
      bypassChance = 'Minimal (5% - 15% Bypass)';
      badgeColor = 'bg-rose-500/10 border-rose-500 text-rose-600 dark:text-rose-400';
      textColor = 'text-rose-600 dark:text-rose-400';
      shadowColor = 'shadow-[0_4px_20px_rgba(239,68,68,0.08)]';
      trendLabel = 'Severe Instability / High Storm Maintenance Air Mass';
      isUnstable = true;
      isStable = false;
    } else if (maxCapeVal < 300 && deltaPressure >= -0.01) {
      status = 'Trend: Stable';
      statusDesc = 'Local microclimate lacks convective buoyancy and thermal moisture (CAPE < 300). Approaching convective cells usually lose internal convection and divert path or go around you.';
      bypassChance = 'Very High (90% - 95% Bypass)';
      badgeColor = 'bg-teal-500/10 border-teal-500 text-teal-600 dark:text-neon-aqua';
      textColor = 'text-teal-600 dark:text-neon-aqua';
      shadowColor = 'shadow-[0_4px_20px_rgba(20,184,166,0.05)]';
      trendLabel = 'Atmospheric Shield / Severe Weather Unfavorable';
      isUnstable = false;
      isStable = true;
    } else if (deltaPressure > 0.01 || (capeDirection === 'Stabilizing' && maxCapeVal < 1000)) {
      status = 'Trend: Stabilizing';
      statusDesc = 'Pressure is rising or CAPE indices are actively cooling down, indicating the storm engine is choked of convective potential. Incoming cells are expected to weaken or decay.';
      bypassChance = 'High (70% - 85% Bypass)';
      badgeColor = 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400';
      textColor = 'text-emerald-700 dark:text-emerald-400';
      shadowColor = 'shadow-[0_4px_20px_rgba(16,185,129,0.05)]';
      trendLabel = 'Positive Pressure Drift / Convective Decay';
      isUnstable = false;
      isStable = true;
    } else {
      status = 'Trend: Moderately Unstable';
      statusDesc = 'Atmospheric parameters support moderate convective support (CAPE ~800-1500). Alert paths may wobble, shift, or decay, making trajectory tracking crucial.';
      bypassChance = 'Moderate (45% - 60% Bypass)';
      badgeColor = 'bg-amber-500/10 border-amber-500 text-amber-600 dark:text-amber-400';
      textColor = 'text-amber-600 dark:text-amber-400';
      shadowColor = 'shadow-[0_4px_20px_rgba(245,158,11,0.05)]';
      trendLabel = 'Dynamic Convective Corridor / Ongoing Maintenance';
      isUnstable = true;
      isStable = false;
    }

    return {
      status,
      statusDesc,
      bypassChance,
      badgeColor,
      textColor,
      shadowColor,
      trendLabel,
      pressureDeltaText,
      capeDeltaText,
      pressureDirection,
      capeDirection,
      deltaPressure,
      maxCapeVal,
      currentCapeVal,
      isUnstable,
      isStable
    };
  })();

  const contextValue = {
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
    fetchTelemetry,
    showHeadedTowardsOnly,
    setShowHeadedTowardsOnly,
    handleFocusTrajectory,
    alertHistory,
    handleClearAlertHistory,
    handleRemoveAlertHistoryItem,
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
    expandedMDId,
    setExpandedMDId,
    handleFocusMD
  };

  return (
    <div className={`min-h-screen flex flex-col text-slate-900 dark:text-slate-100 ${settings.flash && isAnyDirectHitWarningActive ? 'flash-active-severe' : 'bg-slate-50 dark:bg-slate-950'} transition-colors duration-300`}>
      {/* Geolocation Modal Engagement */}
      {showLocationModal && (
        <GeolocationModal onAccept={handleLocationAccept} onDecline={handleLocationDecline} />
      )}

      {/* PWA Saved/Install Guide Modal */}
      {showInstallGuide && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[400] flex items-center justify-center p-6" id="pwa-install-guide">
          <div className="bg-slate-900 border border-cyan-500/30 rounded-3xl p-8 max-w-lg w-full shadow-[0_0_30px_rgba(34,211,238,0.2)] text-white">
            <h2 className="text-xl font-black mb-1 font-sans tracking-tight uppercase text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-neon-aqua" /> SAVE TO HOME OR WINDOWS
            </h2>
            <p className="text-xs text-slate-400 mb-6 font-medium">
              Install D.A.I.S.Y. directly to your device for instant offline access and standalone storm monitoring.
            </p>

            <div className="space-y-4">
              <div className="bg-slate-955/40 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1.5 hover:border-cyan-500/20 transition-all text-left">
                <span className="text-[10px] font-black uppercase text-cyan-400 tracking-wider">Windows / Mac (Chrome or Edge)</span>
                <p className="text-xs text-slate-300 font-semibold leading-relaxed">
                  Look at the right side of your browser's address bar (URL bar). Click the installation button (or circle with arrow icon) and select <strong className="text-white">Install</strong>. D.A.I.S.Y. will run as a high-performance standalone desktop window.
                </p>
              </div>

              <div className="bg-slate-955/40 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1.5 hover:border-cyan-500/20 transition-all text-left">
                <span className="text-[10px] font-black uppercase tracking-wider text-pink-400">iPhone / iPad (Apple Safari)</span>
                <p className="text-xs text-slate-300 font-semibold leading-relaxed">
                  Tap the browser <strong className="text-white">Share</strong> button at the bottom of Safari, scroll down, and select <strong className="text-white">Add to Home Screen</strong>.
                </p>
              </div>

              <div className="bg-slate-955/40 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1.5 hover:border-cyan-500/20 transition-all text-left">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">Android (Google Chrome)</span>
                <p className="text-xs text-slate-300 font-semibold leading-relaxed">
                  Tap the three-dotted options button in the top right-hand corner of Chrome, then select <strong className="text-white">Install app</strong> or <strong className="text-white">Add to Home screen</strong>.
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-2.5">
              {pwaPrompt && (
                <button
                  onClick={() => {
                    handlePwaInstall();
                    setShowInstallGuide(false);
                  }}
                  className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black uppercase text-xs tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Install stand-alone app now
                </button>
              )}
              <button
                onClick={() => setShowInstallGuide(false)}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold uppercase text-xs tracking-widest rounded-xl transition-colors cursor-pointer"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Experimental Tornadogenesis Model Modal */}
      {showTornadogenesisModal && (
        <div className="fixed inset-0 bg-slate-955/80 backdrop-blur-md z-[500] flex items-center justify-center p-6 animate-fade-in" id="tornadogenesis-modal">
          <div className="bg-white dark:bg-slate-900 border border-indigo-500/20 dark:border-indigo-500/30 rounded-3xl p-6 sm:p-8 max-w-2xl w-full text-slate-800 dark:text-white shadow-2xl transition-all max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg sm:text-xl font-black font-sans tracking-tight uppercase text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-indigo-600 dark:from-orange-400 dark:to-indigo-400 flex items-center gap-2">
                  <Flame className="w-5 h-5 text-orange-500 animate-pulse" />
                  Convective Tornadogenesis Model (EXPERIMENTAL)
                </h2>
                <p className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1 font-extrabold pb-1 border-b border-slate-100 dark:border-slate-800">
                  Thermodynamic AI Solver & Atmospheric Telemetry Core
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTornadogenesisModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white font-black text-sm uppercase px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {isAnalyzingTelemetry ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold animate-pulse">
                  Querying dynamic atmospheric solver columns...
                </p>
              </div>
            ) : tornadogenesisData ? (
              <div className="space-y-6">
                <div className="bg-slate-50 dark:bg-slate-950/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-850 flex flex-col sm:flex-row items-center gap-6">
                  <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="56"
                        cy="56"
                        r="48"
                        className="stroke-slate-200 dark:stroke-slate-800"
                        strokeWidth="8"
                        fill="transparent"
                      />
                      <circle
                        cx="56"
                        cy="56"
                        r="48"
                        className="stroke-indigo-500 dark:stroke-indigo-400 transition-all duration-1000"
                        strokeWidth="8"
                        fill="transparent"
                        strokeDasharray={301.6}
                        strokeDashoffset={301.6 - (301.6 * (tornadogenesisData.genesis_probability_pct || 0)) / 100}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute text-center">
                      <span className="text-2xl font-black font-mono leading-none">
                        {tornadogenesisData.genesis_probability_pct}%
                      </span>
                      <span className="text-[7.5px] font-black uppercase text-slate-400 block tracking-widest mt-0.5">
                        TORNADO PROB
                      </span>
                    </div>
                  </div>

                  <div className="text-left space-y-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none">
                      AI Diagnostic Assessment
                    </h3>
                    <p className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed">
                      {tornadogenesisData.display_message || 'Atmospheric telemetry columns analyzed successfully.'}
                    </p>
                    <div className="flex gap-2">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-mono tracking-widest uppercase font-bold text-white ${
                        tornadogenesisData.genesis_probability_pct > 60
                          ? 'bg-rose-600'
                          : tornadogenesisData.genesis_probability_pct > 30
                          ? 'bg-orange-500'
                          : 'bg-emerald-600'
                      }`}>
                        {tornadogenesisData.genesis_probability_pct > 60
                          ? 'CRITICAL UNSTABLE COLUMN'
                          : tornadogenesisData.genesis_probability_pct > 30
                          ? 'WIND COUPLING ELEVATED'
                          : 'MODERATE CONVECTIVE ENVIRONMENT'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-50 dark:bg-slate-950/30 p-4 border border-slate-200 dark:border-slate-800/80 rounded-2xl text-left space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Thermometer className="w-4 h-4 text-rose-500" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                        1. Low-level Moisture
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed uppercase">
                      {tornadogenesisData.metrics?.moisture || 'Checking mixing ratios...'}
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950/30 p-4 border border-slate-200 dark:border-slate-800/80 rounded-2xl text-left space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 text-amber-500" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                        2. Atmospheric Instability
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed uppercase">
                      {tornadogenesisData.metrics?.instability || 'Analyzing MUCAPE column...'}
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950/30 p-4 border border-slate-200 dark:border-slate-800/80 rounded-2xl text-left space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-cyan-500 animate-pulse" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                        3. Lifting Mechanisms
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed uppercase">
                      {tornadogenesisData.metrics?.lift || 'Assessing front/boundary convergence...'}
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950/30 p-4 border border-slate-200 dark:border-slate-800/80 rounded-2xl text-left space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Wind className="w-4 h-4 text-indigo-500" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">
                        4. Vertical Wind Shear
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed uppercase">
                      {tornadogenesisData.metrics?.shear || 'Modeling effective SRH grids...'}
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={() => fetchTelemetryAnalysis()}
                    className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-extrabold text-[10px] tracking-wider uppercase rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Compass className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '6s' }} /> Re-Analyze Telemetry
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTornadogenesisModal(false)}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] tracking-wider uppercase rounded-xl transition-colors cursor-pointer"
                  >
                    Dismiss Diagnostic
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center space-y-3">
                <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto animate-bounce" />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase">
                  No telemetry metrics synchronized in this zone yet.
                </p>
                <button
                  type="button"
                  onClick={() => fetchTelemetryAnalysis()}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] tracking-wider uppercase rounded-xl cursor-pointer"
                >
                  Force Poll Analysis
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Terms & Conditions Pop-Up Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[350] flex items-center justify-center p-6" id="terms-modal">
          <div className="bg-slate-900 border-2 border-neon-aqua rounded-3xl p-8 max-w-md w-full shadow-[0_0_25px_rgba(0,255,255,0.4)] transition-all duration-300 text-center text-white">
            <div className="w-16 h-16 bg-slate-950 border border-neon-pink rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_15px_rgba(255,105,180,0.4)]">
              <ShieldCheck className="w-8 h-8 text-neon-pink" />
            </div>
            
            <h2 className="text-2xl font-black mb-4 font-sans tracking-wide uppercase text-white">
              Terms & Conditions
            </h2>
            
            <div className="text-slate-300 text-xs font-semibold mb-6 leading-relaxed text-left space-y-3 max-h-[200px] overflow-y-auto pr-2">
              <p>
                Welcome to D.A.I.S.Y. Please review our terms before proceeding:
              </p>
              <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 space-y-2">
                <p className="text-[11px] leading-relaxed text-amber-400">
                  <strong>Mandatory Geolocation Services:</strong> In order to provide active tracking and alerting of tornadoes and severe atmospheric events relative to your Safe Houses, D.A.I.S.Y. requires access to your physical geolocation context. Permission to use your geolocation is required to go any further.
                </p>
                <p className="text-[11px] leading-relaxed">
                  <strong>Google Analytics Usage:</strong> We utilize Google Analytics for basic performance diagnostics and traffic monitoring to ensure tracking speed and application stability.
                </p>
                <p className="text-[11px] leading-relaxed">
                  <strong>Transient State Session Limit:</strong> D.A.I.S.Y. stores monitored locations and severe weather tracking states strictly inside temporary sandboxed browser memory. Reloading or refreshing will cycle this state and reset all active alarms.
                </p>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">
                This is a secondary tracking asset. Do not rely solely on this app for immediate life-safety choices in critical situations. Precise GPS base location is required.
              </p>
            </div>

            {locationError && (
              <div className="bg-rose-955/70 border border-rose-500/55 p-3.5 rounded-xl mb-4 text-left flex items-start gap-2.5 shadow-[0_0_15px_rgba(239,68,68,0.2)]" id="geo-error-pane">
                <AlertOctagon className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-[11px] font-black uppercase text-rose-400 tracking-wide leading-tight mb-0.5">
                    Geolocation Required
                  </h3>
                  <p className="text-[10px] leading-relaxed text-rose-100 font-medium">
                    {locationError}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <label htmlFor="agree-checkbox" className="flex items-center gap-3 cursor-pointer select-none text-left bg-slate-950/40 p-3 rounded-xl border border-slate-800 hover:bg-slate-950/70 transition-colors">
                <input
                  type="checkbox"
                  id="agree-checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  disabled={isActivating}
                  className="w-4 h-4 rounded border-slate-800 text-neon-aqua focus:ring-0 focus:ring-offset-0 bg-slate-955 accent-neon-aqua disabled:opacity-50"
                />
                <span className="text-[11.5px] font-bold text-slate-300 uppercase tracking-tight font-sans">
                  i agree to the terms and geolocation requirement
                </span>
              </label>

              <button
                id="terms-ok-btn"
                onClick={() => {
                  handleArmActivation();
                }}
                disabled={!termsAgreed || isActivating}
                className="w-full bg-slate-950 border border-neon-aqua text-neon-aqua font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-neon-aqua hover:text-slate-950 hover:shadow-[0_0_20px_rgba(0,255,255,0.6)] active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer font-sans flex items-center justify-center gap-2"
              >
                {isActivating ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-neon-aqua border-t-transparent animate-spin"></span>
                    Acquiring GPS Signal...
                  </>
                ) : (
                  'Accept & Proceed'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disarmed Splash Screen Block (Armed System Gate) */}
      {!armed && (
        <div id="armed-splash" className="fixed inset-0 bg-slate-950 z-[200] flex flex-col items-center justify-center p-6 text-center text-white">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:40px_40px] opacity-10 pointer-events-none"></div>

          <div className="w-24 h-24 bg-slate-900 border-2 border-neon-aqua rounded-full flex items-center justify-center animate-pulse mb-6 shadow-[0_0_35px_rgba(0,255,255,0.4)]">
            <Radio className="w-10 h-10 text-neon-aqua" />
          </div>

          <h1 className="text-4xl md:text-5xl font-black mb-2 font-sans tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-neon-pink to-neon-aqua dark:text-white dark:bg-none dark:neon-text-glow">
            D.A.I.S.Y.
          </h1>
          
          <p className="text-slate-400 font-mono text-xs tracking-widest uppercase mb-4">
            Data Acquisition & Integrated System for Yields
          </p>

          <p className="text-slate-500 font-semibold max-w-sm text-sm leading-relaxed mb-8">
            Severe convective tracking and radar analysis gateway. Establishes localized siren sirens and trajectory tracking boundaries.
          </p>

          {isActivating ? (
            <div className="flex flex-col items-center gap-3 animate-bounce mt-4 min-h-[80px] justify-center" id="activate-loading-state">
              <Cloud className="w-12 h-12 text-cyan-400 animate-pulse drop-shadow-[0_0_15px_rgba(0,255,255,0.6)]" />
              <span className="text-neon-pink font-mono text-[11px] uppercase tracking-[0.2em] font-black">
                Loading...
              </span>
            </div>
          ) : (
            <button
              id="activate-alarms-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleArmActivation();
              }}
              className="neon-border px-10 py-5 rounded-2xl text-slate-100 font-black tracking-[0.2em] text-xs uppercase cursor-pointer hover:shadow-[0_0_25px_rgba(255,105,180,0.6)] active:scale-95 transition-all text-shadow touch-manipulation relative z-50 active:translate-y-0.5 select-none"
              style={{ touchAction: 'manipulation' }}
            >
              Activate Alarms
            </button>
          )}

          <div className="mt-8 max-w-md border border-slate-800 bg-slate-900/60 backdrop-blur-md rounded-2xl p-5 text-left text-xs text-slate-400 space-y-3 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wide">Data Protection Disclosure</h4>
                <p className="mt-0.5 leading-relaxed text-[11px] text-slate-400">
                  D.A.I.S.Y. prioritizes private-by-default workflows. Geolocated coordinates, monitored secure spots, and historical alert profiles are calculated and kept exclusively inside your local browser storage. No user positions, network traces, or tracking files are sent, shared, or maintained by external cloud bases.
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 border-t border-slate-800/60 pt-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wide">Transient Session state Limit</h4>
                <p className="mt-0.5 leading-relaxed text-[11px] text-slate-400">
                  This application functions as a high-frequency telemetry workspace. Reloading or refreshing your browser session forces a complete security clearance and state cycle. If you reload, you must reactivate alarms and grant GPS safety permissions again.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Primary Dashboard Area */}
      <div className="main-container flex-grow flex flex-col gap-6 py-6 font-sans px-4 md:px-6 max-w-[90%] mx-auto w-full transition-all">
        
        {/* Urgent Warning Ticker Header if direct threats exist */}
        {isAnyDirectHitWarningActive && (
          <div className="bg-red-955 border-2 border-red-500 p-4 rounded-2xl flex justify-between items-center shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse">
            <div className="flex items-center gap-3 text-white">
              <AlertOctagon className="w-6 h-6 text-red-500 shrink-0" />
              <div>
                <h4 className="text-sm font-black uppercase text-red-200">
                  Critical Warning Threshold Triggered
                </h4>
                <p className="text-red-300 text-xs font-semibold leading-relaxed">
                  Convective cell polygon boundary intersects safe house anchor systems. Evacuate exterior grids.
                </p>
              </div>
            </div>
            
            <button
              onClick={() => {
                const target = alerts.find(a => a.isDirectHit);
                if (target) handleFocusTrajectory(target);
              }}
              className="px-4 py-2 bg-slate-950 text-red-400 hover:text-red-200 border border-red-700 hover:border-red-500 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer shrink-0"
            >
              Examine Threat
            </button>
          </div>
        )}

        {/* Dynamic Nav Header Bar */}
        <header className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col gap-6 shadow-md transition-all">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-center md:text-left">
              <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none uppercase text-transparent bg-clip-text bg-gradient-to-r from-neon-pink to-neon-aqua dark:text-white dark:bg-none dark:neon-text-glow">
                D.A.I.S.Y.
              </h1>
              <p className="text-[10px] font-black font-mono text-cyan-600 dark:text-neon-aqua uppercase tracking-[0.25em] mt-2">
                Convective Proximity System
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                id="test-siren-btn"
                onClick={handleTestSiren}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-neon-pink dark:hover:border-neon-pink hover:text-neon-pink dark:hover:text-neon-pink rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-sans"
              >
                Test Siren System
              </button>

              <button
                id="share-daisy-btn"
                onClick={handleShareApp}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-neon-aqua dark:hover:border-neon-aqua hover:text-neon-aqua dark:hover:text-neon-aqua rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-sans flex items-center justify-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5" /> Share Gateway
              </button>

              <button
                id="theme-toggle-btn"
                onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-neon-aqua dark:hover:border-neon-aqua hover:text-neon-aqua dark:hover:text-neon-aqua rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-sans flex items-center justify-center gap-1.5"
                title="Toggle visual theme"
              >
                {theme === 'light' ? <Moon className="w-3.5 h-3.5 text-indigo-600" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
                {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
              </button>

              <button
                id="pwa-guide-btn"
                onClick={() => setShowInstallGuide(true)}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-neon-aqua dark:hover:border-neon-aqua hover:text-neon-aqua dark:hover:text-neon-aqua rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-sans flex items-center justify-center gap-1.5"
                title="App save and installation details guide"
              >
                <Download className="w-3.5 h-3.5" /> App Install Instructions
              </button>

              {pwaPrompt && (
                <button
                  id="install-pwa-btn"
                  onClick={handlePwaInstall}
                  className="px-5 py-2.5 bg-white dark:bg-slate-950 border border-neon-aqua text-cyan-600 dark:text-neon-aqua rounded-full text-[10px] font-black uppercase tracking-wider hover:bg-neon-aqua hover:text-slate-950 shadow-[0_0_12px_rgba(0,255,255,0.3)] transition-all cursor-pointer flex items-center justify-center gap-1.5 animate-bounce"
                >
                  <Download className="w-3.5 h-3.5" /> Install DAISY
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-5 flex flex-col md:flex-row justify-between items-center gap-4 transition-colors">
            <div className="flex flex-wrap items-center justify-center gap-5">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer tracking-wider select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  id="settings-audio"
                  name="audioSirenToggle"
                  checked={settings.audio}
                  onChange={(e) => setSettings((s) => ({ ...s, audio: e.target.checked }))}
                  className="w-4 h-4 accent-neon-pink bg-slate-100 dark:bg-slate-955 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  {settings.audio ? <Volume2 className="w-3.5 h-3.5 text-neon-pink" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />}
                  Audio Siren
                </span>
              </label>

              <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer tracking-wider select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  id="settings-vibrate"
                  name="vibrateToggle"
                  checked={settings.vibrate}
                  onChange={(e) => setSettings((s) => ({ ...s, vibrate: e.target.checked }))}
                  className="w-4 h-4 accent-neon-aqua bg-slate-100 dark:bg-slate-955 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  {settings.vibrate ? <Vibrate className="w-3.5 h-3.5 text-cyan-600 dark:text-neon-aqua" /> : <VibrateOff className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />}
                  Haptic Pulse
                </span>
              </label>

              <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer tracking-wider select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  id="settings-flash"
                  name="flashToggle"
                  checked={settings.flash}
                  onChange={(e) => setSettings((s) => ({ ...s, flash: e.target.checked }))}
                  className="w-4 h-4 accent-slate-800 dark:accent-white bg-slate-100 dark:bg-slate-955 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-white" />
                  Strobe Flash
                </span>
              </label>

              <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer tracking-wider select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  id="settings-telemetry-debug"
                  name="telemetryDebugToggle"
                  checked={settings.telemetryDebug || false}
                  onChange={(e) => setSettings((s) => ({ ...s, telemetryDebug: e.target.checked }))}
                  className="w-4 h-4 accent-indigo-600 dark:accent-indigo-400 bg-slate-100 dark:bg-slate-955 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                  Telemetry Debug
                </span>
              </label>

              <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer tracking-wider select-none text-slate-700 dark:text-slate-300" title="Softens weather warning titles and alerts to keep atmosphere relaxed and threat notifications stress-free.">
                <input
                  type="checkbox"
                  id="settings-user-mask"
                  name="userMaskToggle"
                  checked={settings.userMaskActive ?? true}
                  onChange={(e) => setSettings((s) => ({ ...s, userMaskActive: e.target.checked }))}
                  className="w-4 h-4 accent-pink-500 dark:accent-pink-400 bg-slate-100 dark:bg-slate-955 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <Smile className="w-3.5 h-3.5 text-pink-500" />
                  Calm Comfort Mask
                </span>
              </label>
              <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 pt-3 md:pt-0 pl-0 md:pl-5 w-full md:w-auto">
                <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 select-none shrink-0">
                  <Compass className="w-3.5 h-3.5 text-cyan-500 dark:text-neon-aqua" />
                  Monitor Radius
                </span>
                <input
                  type="range"
                  id="settings-radius"
                  min="5"
                  max="100"
                  step="5"
                  value={settings.monitorRadius}
                  onChange={(e) => setSettings((s) => ({ ...s, monitorRadius: parseInt(e.target.value, 10) }))}
                  className="w-full md:w-28 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 dark:accent-neon-aqua"
                />
                <span className="text-[10px] font-black font-mono text-cyan-600 dark:text-neon-aqua bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded shadow-sm shrink-0">
                  {settings.monitorRadius} mi
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 font-mono">
              <div
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase border tracking-wider bg-white dark:bg-slate-950 ${
                  connectionOnline
                    ? 'text-emerald-600 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60 shadow-sm'
                    : 'text-red-500 border-red-200 dark:border-red-950/60 shadow-sm'
                }`}
              >
                <span className={`w-2 h-2 rounded-full inline-block ${connectionOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                {connectionOnline ? 'Telemetry Active' : 'Offline'}
              </div>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center">
                <Clock className="w-3 h-3 mr-1 text-slate-400 dark:text-slate-600" />
                {syncStatus}
              </span>
            </div>
          </div>

          {showKeysPanel && (
            <div className="mt-4 border border-indigo-500/30 bg-indigo-50/20 dark:bg-indigo-955/10 p-5 rounded-2xl transition-all duration-300">
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-4 h-4 text-indigo-500" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                  Windy Developer API Credentials Control
                </h3>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug mb-4">
                Windy.com separates their services into two completely independent Developer API Keys. Ensure you enter the correct key for each service to authorize requests successfully and see active telemetry usages on your Windy account portal.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    Windy Point Forecast Key (JSON Weather Data)
                  </label>
                  <div className="relative hover:shadow-[0_0_10px_rgba(99,102,241,0.15)] transition-shadow rounded-lg">
                    <input
                      type="password"
                      placeholder="Paste your Point Forecast API key here..."
                      value={customPointKey}
                      onChange={(e) => setCustomPointKey(e.target.value)}
                      className="w-full text-xs font-mono py-2 px-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg outline-none focus:border-indigo-500 focus:ring-0"
                    />
                  </div>
                  <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-1">
                    Used to fetch local Convective CAPE, Pressure, Temperature, Dewpoint, and Winds.
                  </p>
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    Windy Map Forecast Key (Interactive Map Visualizations)
                  </label>
                  <div className="relative hover:shadow-[0_0_10px_rgba(99,102,241,0.15)] transition-shadow rounded-lg">
                    <input
                      type="password"
                      placeholder="Paste your Map Forecast API key here..."
                      value={customMapKey}
                      onChange={(e) => setCustomMapKey(e.target.value)}
                      className="w-full text-xs font-mono py-2 px-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg outline-none focus:border-indigo-500 focus:ring-0"
                    />
                  </div>
                  <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-1">
                    Used by Leaflet to render the high-resolution Radar, Satellite, and wind streamlines.
                  </p>
                </div>
              </div>

              {windyPointError && (
                <div className="mt-4 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200">
                  <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider mb-1">
                    <AlertOctagon className="w-4 h-4 text-rose-500 animate-pulse" />
                    Windy API Point Forecast Error: {windyPointError.status}
                  </div>
                  <div className="text-[10px] font-mono leading-relaxed mb-3">
                    {windyPointError.message}
                  </div>
                  {windyPointError.suggestion && (
                    <div className="text-[10px] font-sans font-medium text-slate-600 dark:text-slate-400 mb-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-lg leading-relaxed">
                      <span className="font-extrabold text-slate-700 dark:text-slate-300 block uppercase text-[8px] mb-1">D.A.I.S.Y. Recommended Fix:</span>
                      {windyPointError.suggestion}
                    </div>
                  )}
                  {windyPointError.linkUrl && (
                    <a
                      href={windyPointError.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider px-3.5 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition shadow-sm"
                    >
                      {windyPointError.linkText || "Visit Account Settings"}
                    </a>
                  )}
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap justify-between items-center gap-3">
                <div className="text-[9px] font-mono text-slate-400 dark:text-slate-500">
                  {(!customPointKey && !customMapKey) ? (
                    <span className="text-amber-500">⚠ Utilizing system-wide default developer fallback credentials.</span>
                  ) : (
                    <span className="text-emerald-500">✓ Activating private user-managed API keys.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('daisy-windy-point-key');
                      localStorage.removeItem('daisy-windy-map-key');
                      setCustomPointKey('');
                      setCustomMapKey('');
                      setWindyPointError(null);
                      triggerToast('Custom API credentials cleared. Utilizing default developer keys.', 'info');
                    }}
                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Reset to Defaults
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem('daisy-windy-point-key', customPointKey.trim());
                      localStorage.setItem('daisy-windy-map-key', customMapKey.trim());
                      triggerToast('Custom Windy developer credentials saved and mounted!', 'success');
                      if (customPointKey.trim()) {
                        fetchWindyPointTelemetry(currentLat, currentLon);
                      }
                    }}
                    className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
                  >
                    Save & Validate Keys
                  </button>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800/80">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                      Network Health & Diagnostics Panel
                    </h4>
                  </div>
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500 font-mono">
                    Last 5 Operations
                  </span>
                </div>
                
                <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-snug mb-4 font-sans">
                  Real-time transaction logs of server-side and API connections with the Windy.com Point Forecast networks and the National Weather Service (NWS) grid databases.
                </p>
                
                {networkLogs.length === 0 ? (
                  <div className="text-center p-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                    No network transactions registered yet. Update your coordinates or run diagnostic fetches to populate reports.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                    {networkLogs.map((log) => {
                      const isSuccess = log.status && log.status >= 200 && log.status < 300;
                      const isError = (log.status && log.status >= 400) || log.error;
                      
                      return (
                        <div key={log.id} className="bg-slate-55 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-850 p-3.5 rounded-xl text-left hover:border-slate-300 dark:hover:border-slate-800 transition">
                          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2.5 font-mono text-[9px] font-black">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded uppercase tracking-wider text-[8px] text-white ${
                                log.service === 'Windy' ? 'bg-indigo-600' : 'bg-cyan-600'
                              }`}>
                                {log.service}
                              </span>
                              <span className="text-slate-400 font-semibold">{log.timestamp}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-500 uppercase">{log.method}</span>
                              <span className={`px-2 py-0.5 rounded text-[8px] uppercase tracking-wide font-black ${
                                isSuccess ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                                isError ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse' :
                                'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                              }`}>
                                {log.status || 'FAILED'} {log.statusText || ''}
                              </span>
                            </div>
                          </div>
                          
                          <div className="space-y-2 font-mono text-[9px]">
                            <div>
                              <span className="text-slate-400 font-black block uppercase text-[7.5px] leading-none mb-1">Request Endpoint</span>
                              <span className="text-slate-700 dark:text-slate-300 break-all select-all font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/45 px-2 py-1 rounded block">{log.url}</span>
                            </div>
                            
                            {log.headers && Object.keys(log.headers).length > 0 && (
                              <div>
                                <span className="text-slate-400 font-black block uppercase text-[7.5px] leading-none mb-1">Request Headers</span>
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/45 px-2 py-1.5 rounded space-y-1 block text-slate-600 dark:text-slate-400 max-h-24 overflow-y-auto">
                                  {Object.entries(log.headers).map(([k, v]) => (
                                    <div key={k} className="flex justify-between md:justify-start gap-4">
                                      <span className="font-bold text-indigo-500 shrink-0">{k}:</span>
                                      <span className="font-medium text-slate-700 dark:text-slate-300 break-all select-all">{v}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {log.error && (
                              <div>
                                <span className="text-rose-500 font-black block uppercase text-[7.5px] leading-none mb-1">Response Body / Diagnostics</span>
                                <pre className="bg-rose-500/5 text-rose-600 dark:text-rose-400 border border-rose-500/15 p-2 rounded max-h-24 overflow-y-auto break-words whitespace-pre-wrap leading-tight font-semibold">{log.error}</pre>
                              </div>
                            )}

                            {log.suggestedAction && (
                              <div className="mt-1.5 bg-indigo-500/5 border border-indigo-500/20 p-2.5 rounded-lg text-indigo-700 dark:text-indigo-300 font-sans leading-relaxed text-[10px]">
                                <span className="font-black text-[7.5px] uppercase tracking-wider block text-indigo-500 mb-0.5 font-mono">D.A.I.S.Y. Recommended Action:</span>
                                {log.suggestedAction}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </header>

        {/* Unified Dashboard Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Interactive Radar Map & Coordinate Anchor Manager (lg:span-7) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
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
            <div className="w-full p-4 bg-rose-50 dark:bg-rose-955/10 border border-rose-200 dark:border-red-500/20 rounded-2xl flex gap-3 text-rose-700 dark:text-red-400 transition-colors">
              <Info className="w-5 h-5 text-rose-600 dark:text-red-500 shrink-0" />
              <p className="text-[10px] font-bold leading-relaxed uppercase tracking-tight">
                Disclaimer: DAISY is built as secondary informational tracking only. Do not rely solely on DAISY for life-safety choices in critical scenarios.
              </p>
            </div>

            {/* Anchor Coordinates Manager */}
            <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm transition-colors" aria-label="Coordinates Manager">
              <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-cyan-600 dark:text-neon-aqua" />
                Monitored Coordinates Anchor
              </h3>

              <div className="flex flex-col md:flex-row gap-5 items-start">
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
            </section>
          </div>

          {/* Right Column: Proximity Alerts & Microclimate Ground Telemetry (lg:span-5) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {/* Ground Surface Air Telemetry */}
            <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-sm transition-colors flex flex-col justify-between" aria-label="NWS Telemetry and Forecast Microclimate Analysis">
              <div>
                <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                  Ground Surface Air Telemetry (NWS ASOS) & Forecast Trends
                </h3>
                
                {telemetry ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-55 dark:bg-slate-950 border border-slate-205 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                        <Thermometer className="w-7 h-7 text-rose-500 dark:text-neon-pink shrink-0" />
                        <div>
                          <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Temp / Dew</span>
                          <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block">
                            {telemetry.temperature ? `${telemetry.temperature}°F` : 'N/A'}{' '}
                            <span className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold">({telemetry.dewPoint || '--'}°)</span>
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-55 dark:bg-slate-950 border border-slate-205 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
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

                      <div className="bg-slate-55 dark:bg-slate-950 border border-slate-205 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                        <Gauge className="w-7 h-7 text-slate-400 dark:text-white/50 shrink-0" />
                        <div>
                          <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Baro Pres</span>
                          <span className="text-xs font-black text-slate-800 dark:text-white mt-1 block uppercase">
                            {telemetry.pressure ? `${telemetry.pressure} InHg` : 'N/A'}
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-55 dark:bg-slate-950 border border-slate-205 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-2 transition-colors">
                        <Compass className="w-7 h-7 text-indigo-500 dark:text-indigo-400 shrink-0 animate-[spin_12s_linear_infinite]" />
                        <div>
                          <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Weather</span>
                          <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 mt-1 block truncate max-w-[110px] uppercase">
                            {telemetry.textDescription || 'Stable conditions'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <WindGauge
                      windSpeed={telemetry.windSpeed}
                      windGust={telemetry.windGust}
                    />
                  </>
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-205 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[9px] uppercase text-center rounded-xl">
                    Synchronizing closest station observational grids...
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800/50 flex flex-col gap-4">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-slate-800 dark:text-white text-xs font-extrabold uppercase tracking-wide">
                      Predictive Forecast Trends
                    </h4>
                    <p className="text-[9px] font-mono text-slate-400 dark:text-slate-500 uppercase mt-0.5">
                      Bypass Shield Probability Indicator
                    </p>
                  </div>
                  <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 uppercase tracking-wider ${forecastTrend.badgeColor}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
                    {forecastTrend.status}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl">
                  <span className="text-[10px] font-black text-slate-800 dark:text-white block uppercase leading-snug">{forecastTrend.trendLabel}</span>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{forecastTrend.statusDesc}</p>
                </div>

                <div className="flex justify-between items-center text-[10px] font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl">
                  <span className="text-slate-500 uppercase">Shield Success chance:</span>
                  <span className={`font-black ${forecastTrend.textColor}`}>{forecastTrend.bypassChance}</span>
                </div>

                <button
                  type="button"
                  id="open-vtp-modal-btn"
                  onClick={() => {
                    fetchTelemetryAnalysis();
                    setShowTornadogenesisModal(true);
                  }}
                  className="w-full py-2.5 px-4 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 hover:border-cyan-400 dark:hover:border-neon-aqua hover:text-cyan-600 dark:hover:text-neon-aqua text-slate-800 dark:text-slate-200 font-black uppercase text-[10px] tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Flame className="w-4 h-4 text-orange-500 animate-pulse" />
                  <span>Genesis probability core</span>
                </button>
              </div>
            </section>

            {/* Active Proximity Alerts */}
            <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
              <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800/80 pb-3 mb-4">
                <h2 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Radio className="w-4.5 h-4.5 text-rose-500 dark:text-neon-pink animate-pulse" />
                  Proximity Alert Board
                </h2>
                {alerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHeadedTowardsOnly(p => !p)}
                    className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors ${
                      showHeadedTowardsOnly
                        ? 'bg-rose-500/10 border-rose-500 text-rose-500'
                        : 'border-slate-200 dark:border-slate-800 text-slate-500'
                    }`}
                  >
                    {showHeadedTowardsOnly ? 'Headed Only' : 'All Alerts'}
                  </button>
                )}
              </div>

              {alerts.length === 0 ? (
                <div className="bg-slate-50 dark:bg-slate-950/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center">
                  <ShieldCheck className="w-10 h-10 text-teal-600 dark:text-neon-aqua mx-auto mb-2 animate-pulse" />
                  <h3 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">System Clear</h3>
                  <p className="text-[10px] text-slate-500 leading-relaxed mt-1">No active convective warning polygons intersecting tracking grids.</p>
                </div>
              ) : (
                (() => {
                  const displayedAlerts = showHeadedTowardsOnly
                    ? alerts.filter((alert: any) => alert.headedTowards || alert.isDirectHit)
                    : alerts;

                  if (displayedAlerts.length === 0) {
                    return (
                      <div className="text-center p-6 bg-slate-50 dark:bg-slate-950/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-wide">No alerts directly in your path.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
                      {displayedAlerts.map((alert: any) => (
                        <ThreatCard
                          key={alert.id}
                          alert={alert}
                          hasAssets={assets.length > 0}
                          onViewTrajectory={handleFocusTrajectory}
                          userMaskActive={settings.userMaskActive}
                        />
                      ))}
                    </div>
                  );
                })()
              )}
            </section>

            {/* SPC Convective Discussions */}
            <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
              <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800/80 pb-3 mb-4">
                <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">
                  SPC Discussions
                </h3>
                <button
                  onClick={() => setShowMDInputForm(!showMDInputForm)}
                  className="text-[9px] font-black uppercase text-amber-500 hover:text-amber-400 transition-colors"
                >
                  {showMDInputForm ? 'Close Panel' : 'Feed Text'}
                </button>
              </div>

              {showMDInputForm && (
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl mb-4">
                  <textarea
                    id="newMDText"
                    name="newMDText"
                    value={newMDText}
                    onChange={(e) => setNewMDText(e.target.value)}
                    placeholder="Paste raw SPC MD text..."
                    rows={4}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] p-2 rounded-lg outline-none font-mono focus:border-amber-500"
                  />
                  <button
                    onClick={() => {
                      handleAddCustomMD(newMDText);
                      setNewMDText('');
                      setShowMDInputForm(false);
                    }}
                    className="w-full mt-2 py-1.5 bg-amber-500 text-slate-950 text-[9px] font-black uppercase tracking-wider rounded-lg"
                  >
                    Parse Discussion
                  </button>
                </div>
              )}

              {discussions.length === 0 ? (
                <div className="p-4 text-center text-[10px] text-slate-500 uppercase tracking-widest font-mono">
                  Loading SPC Forecast tracks...
                </div>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {discussions.map((md: any) => {
                    const isExpanded = expandedMDId === md.id;
                    const isIntersecting = md.isIntersecting;
                    return (
                      <div key={md.id} className={`p-3.5 border rounded-2xl bg-slate-50 dark:bg-slate-950/40 hover:border-slate-350 dark:hover:border-slate-800 transition ${isIntersecting ? 'border-amber-500' : 'border-slate-200 dark:border-slate-800/80'}`}>
                        <div className="flex justify-between items-start gap-2.5">
                          <span className="px-1.5 py-0.5 bg-amber-500 text-slate-950 text-[8px] font-black uppercase rounded shrink-0">
                            #MCD {md.number}
                          </span>
                          <span className="text-[10px] font-black text-slate-800 dark:text-white truncate">
                            {md.areasAffected}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 font-medium leading-relaxed line-clamp-3">
                          {md.summary}
                        </p>
                        <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
                          <span className="text-[9px] font-mono text-slate-400">
                            Watch Prob: <strong className="text-slate-800 dark:text-white">{md.probability}%</strong>
                          </span>
                          <button
                            onClick={() => handleFocusMD(md)}
                            className="text-[8px] font-black uppercase text-cyan-600 dark:text-neon-aqua hover:underline"
                          >
                            Locate Corridor
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
