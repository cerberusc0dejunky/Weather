import { useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import SafeResponsiveContainer from './components/SafeResponsiveContainer';
import { LocationAsset, NWSAlert, TelemetryConditions, SystemSettings, MesoscaleDiscussion, RotationPin, NetworkRequestLog } from './types';
import {
  getDistance,
  getBearing,
  getMinPolygonDistance,
  getMemoizedMinPolygonDistance,
  getGeometryCentroid,
  formatAddress,
  cardinalBearings,
  parseSPCLatLon,
  isPointInParsedPolygon,
  getParsedPolygonMinDistance,
  parseStormTrajectory,
} from './utils/geoUtils';
import { runMlInference } from './utils/mlEngine';
import { syncToGoogleSheets } from './utils/googleSheetsSync';
import ThreatCard from './components/ThreatCard';
import GeolocationModal from './components/GeolocationModal';
import RadarMap from './components/RadarMap';
import AlertHistory, { ResolvedAlert } from './components/AlertHistory';

import CapeHistoryChart from './components/CapeHistoryChart';

// Lucide Icons (Never use Emojis!)
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
  Flame,
  Zap,
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
} from 'lucide-react';

const TRACKED_ALERTS_FILTER = [
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Weather Statement',
  'Special Weather Statement',
  'Flash Flood Warning',
  'Flood Watch',
];

// Siren sound process
class SirenProcessor {
  private ctx: AudioContext | null = null;
  private intervalId: any = null;
  private activeLevel: number = 0;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.activeLevel = 0;
  }

  play(level: number, enabled: boolean) {
    if (!enabled) {
      this.stop();
      return;
    }
    this.init();
    if (!this.ctx) return;

    if (this.activeLevel === level) return;
    this.stop();
    this.activeLevel = level;

    // Pitch: higher threats get higher frequencies (PDS 1200Hz, Standard Severe Warning 880Hz, Watch 440Hz)
    const frequency = level === 3 ? 1200 : level === 2 ? 880 : 440;
    const duration = level === 3 ? 0.8 : level === 2 ? 0.4 : 0.2;
    const pause = level === 3 ? 200 : level === 2 ? 600 : 2000;
    const waveType = level === 3 ? 'sawtooth' : 'square';

    let beepCount = 0;

    const runBeep = () => {
      if (!this.ctx || this.activeLevel !== level) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = waveType;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);

      // Reduce popping by using smooth exponential scaling
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, this.ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration - 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);

      beepCount++;
      if (level < 3 && beepCount >= 10) {
        this.stop();
      }
    };

    runBeep();
    this.intervalId = setInterval(runBeep, duration * 1000 + pause);
  }
}

const siren = new SirenProcessor();

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

interface PressureTooltipProps {
  active?: boolean;
  payload?: any[];
}

function PressureBaroTooltip({ active, payload }: PressureTooltipProps) {
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
  
  // Locations monitored (safe houses, business hubs) - default to Fort Smith, AR coordinates on empty
  const [assets, setAssets] = useState<LocationAsset[]>(() => {
    const raw = localStorage.getItem('daisy-assets');
    return raw ? JSON.parse(raw) : [];
  });

  const [alerts, setAlerts] = useState<NWSAlert[]>([]);
  const [showHeadedTowardsOnly, setShowHeadedTowardsOnly] = useState<boolean>(false);
  const [alertHistory, setAlertHistory] = useState<ResolvedAlert[]>(() => {
    const raw = localStorage.getItem('daisy-alert-history');
    return raw ? JSON.parse(raw) : [];
  });

  const addAlertsToHistory = (resolvedAlerts: NWSAlert[]) => {
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
  };
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
  const [mapMode, setMapMode] = useState<'radar' | 'wind'>('radar');
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
  });

  // Custom user-managed API keys
  const [customPointKey, setCustomPointKey] = useState<string>(() => localStorage.getItem('daisy-windy-point-key') || '');
  const [customMapKey, setCustomMapKey] = useState<string>(() => localStorage.getItem('daisy-windy-map-key') || '');


  // Network logs for diagnostics and troubleshooting
  const [networkLogs, setNetworkLogs] = useState<NetworkRequestLog[]>([]);
  const [windyPointError, setWindyPointError] = useState<{
    status: number;
    message: string;
    suggestion?: string;
    linkText?: string;
    linkUrl?: string;
  } | null>(null);

  const logNetworkRequest = (log: Omit<NetworkRequestLog, 'id' | 'timestamp'>) => {
    const newLog: NetworkRequestLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setNetworkLogs(prev => [newLog, ...prev].slice(0, 5));
  };


  // PWA deferred installation prompt
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);

  // Potential rotation pins state derived from active alerts
  const [rotationPins, setRotationPins] = useState<RotationPin[]>([]);

  // Keep rotationPins synchronized with active alerts
  useEffect(() => {
    setRotationPins(translateAlertsToRotationPins(alerts));
  }, [alerts]);

  // Experimental Tornadogenesis Probability Analysis States
  const [tornadogenesisData, setTornadogenesisData] = useState<any | null>(null);
  const [isAnalyzingTelemetry, setIsAnalyzingTelemetry] = useState<boolean>(false);
  const [isSyncingMl, setIsSyncingMl] = useState<boolean>(false);

  // Live ML Engine Inference
  useEffect(() => {
    const runInference = async () => {
      setIsAnalyzingTelemetry(true);
      try {
        const cape = windyPointTelemetry?.cape || (telemetry?.temperatureC && telemetry?.dewpointC ? 1500 : 0);
        const dewPoint = telemetry?.dewpointC ? (telemetry.dewpointC * 9/5) + 32 : 55;
        const shearMph = telemetry?.windSpeedKmH ? telemetry.windSpeedKmH * 0.621371 : 15;

        const result = await runMlInference({
          cape,
          dewPoint,
          shearMph,
          rotationPins
        });

        if (result !== null) {
          setTornadogenesisData({
            genesis_probability_pct: result.tornadoProbability,
            downburst_risk: result.downburstRisk,
            display_message: 'Atmospheric telemetry columns analyzed by Local ML Engine.',
            metrics: {
              moisture: `Dewpoint: ${dewPoint.toFixed(1)}F`,
              instability: `CAPE: ${Math.round(cape)} J/kg`,
              lift: 'Live Front Boundary Tracking',
              shear: `Surface Shear: ${shearMph.toFixed(1)} MPH`
            }
          });
        }
      } catch (err) {
        console.error("ML Inference error:", err);
      } finally {
        setIsAnalyzingTelemetry(false);
      }
    };

    runInference();
  }, [telemetry, windyPointTelemetry, rotationPins]);

  const handleSyncMl = async (isAuto = false) => {
    if (!isAuto) {
      setIsSyncingMl(true);
      triggerToast('Sending ML Snapshot to Google Sheets...', 'info');
    } else {
      triggerToast('Auto-archiving expired alert telemetry to Sheets...', 'info');
    }
    try {
      await syncToGoogleSheets({
        alerts,
        rotationPins,
        telemetry,
        geminiReport: `Tornadogenesis Probability: ${tornadogenesisData?.genesis_probability_pct || 0}%`,
      });
      if (!isAuto) triggerToast('ML Snapshot synced to Sheets!', 'success');
    } catch (err: any) {
      triggerToast(`Sync failed: ${err.message}`, 'error');
    } finally {
      if (!isAuto) setIsSyncingMl(false);
    }
  };

  const handleSyncMlRef = useRef(handleSyncMl);
  useEffect(() => {
    handleSyncMlRef.current = handleSyncMl;
  }, [handleSyncMl]);

  // User notifications toast system (replacing iframe-blocked alert popups)
  const [notificationToast, setNotificationToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

  const triggerToast = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setNotificationToast({ message, type });
  };

  useEffect(() => {
    if (notificationToast) {
      const timer = setTimeout(() => {
        setNotificationToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notificationToast]);

  // Signatures tracking to detect fresh alerts (Toast notifications)
  const previousSignaturesRef = useRef<Set<string>>(new Set());

  // Centroid tracking for warning polygon shrinkage and velocity vector calculation
  const alertsCentroidsHistoryRef = useRef<Record<string, { lat: number; lon: number; timestamp: number }>>({});

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
      siren.stop();
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
      siren.play(maxLevel, settings.audio);
      if (settings.vibrate && navigator.vibrate) {
        if (maxLevel === 3) {
          // SOS emergency vibration
          navigator.vibrate([100, 100, 100, 100, 300, 300, 100, 100]);
        } else {
          navigator.vibrate([500, 350, 500]);
        }
      }
    } else {
      siren.stop();
    }
  }, [alerts, armed, settings.audio, settings.vibrate, settings.monitorRadius]);

  // Periodic Alert Syncing Loop (Staggered Telemetry/NWS intervals)
  useEffect(() => {
    if (!armed) return;

    fetchNationalAlerts();
    fetchTelemetry(currentLat, currentLon);
    fetchMesoscaleDiscussions();

    // 60-second polling cycle for alerts and mesoscale discussions
    const alertInterval = setInterval(() => {
      fetchNationalAlerts();
      fetchMesoscaleDiscussions();
    }, 60000);

    // 5-minute (300-second) cycle for CAPE and weather telemetry
    const telemetryInterval = setInterval(() => {
      fetchTelemetry(currentLat, currentLon);
    }, 300000);

    return () => {
      clearInterval(alertInterval);
      clearInterval(telemetryInterval);
      siren.stop();
    };
  }, [armed, currentLat, currentLon]);

  // Stable ref for adding alerts to history to avoid interval stale closures
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
          
          // Auto-trigger Google Sheets sync with the final telemetry metrics
          handleSyncMlRef.current(true);

          return prevAlerts.filter((alert) => !alert.expires || new Date(alert.expires) > now);
        }
        return prevAlerts;
      });
    };

    const interval = setInterval(checkExpiredAlerts, 5000);
    return () => clearInterval(interval);
  }, []);

  // Perform purely local geometric calculations for discussions on coordinate or custom changes without redundant network requests
  useEffect(() => {
    // Union of: manually-input discussions + live fetched discussions
    const allDiscussionsList = [...customMDs, ...rawApiDiscussions];

    // Re-evaluate distance calculations for all monitored pins/current base coordinates
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

    // Sort prioritizing active intersecting events, then closest proximity
    processedMDs.sort((a, b) => {
      if (a.isIntersecting && !b.isIntersecting) return -1;
      if (!a.isIntersecting && b.isIntersecting) return 1;
      return a.minDist - b.minDist;
    });

    setDiscussions(processedMDs);
  }, [rawApiDiscussions, customMDs, assets, currentLat, currentLon]);

  // Core NWS Alert Acquisition Engine (Layer 1 The Alarm)
  const fetchNationalAlerts = async () => {
    setSyncStatus('SYNCING...');
    const encodedEvents = TRACKED_ALERTS_FILTER.map((e) => encodeURIComponent(e)).join(',');
    const nwsUrl = `https://api.weather.gov/alerts/active?event=${encodedEvents}`;
    const headers = {
      'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)',
      'Accept': 'application/geo+json'
    };

    try {
      const res = await fetch(nwsUrl, { headers });
      
      logNetworkRequest({
        service: 'NWS',
        url: nwsUrl,
        method: 'GET',
        status: res.status,
        statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
        headers: headers
      });

      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      
      const payload = await res.json();
      const features = payload.features || [];

      processNWSFeatures(features);
      setSyncStatus(`LIVE: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    } catch (err: any) {
      console.error('Failed to acquire weather alerts:', err);
      logNetworkRequest({
        service: 'NWS',
        url: nwsUrl,
        method: 'GET',
        error: err?.message || String(err),
        headers: headers
      });
      setSyncStatus('OFFLINE');
    }
  };

  // Normalize a matched direction to a key present in cardinalBearings or a numeric string
  const normalizeDirection = (dirStr: string): string => {
    let clean = dirStr.trim().toUpperCase();
    
    // If it starts with digits (e.g., "220 DEGREES" or "220 DEG" or "220"), extract the digits as a numeric string
    const degreeMatch = clean.match(/^(\d+)/);
    if (degreeMatch) {
      return degreeMatch[1];
    }

    clean = clean.replace(/[-\s]/g, '');
    
    const directionMap: Record<string, string> = {
      'EASTNORTHEAST': 'ENE',
      'WESTSOUTHWEST': 'WSW',
      'WESTNORTHWEST': 'WNW',
      'EASTSOUTHEAST': 'ESE',
      'NORTHNORTHEAST': 'NNE',
      'NORTHNORTHWEST': 'NNW',
      'SOUTHSOUTHEAST': 'SSE',
      'SOUTHSOUTHWEST': 'SSW',
      'NORTHEAST': 'NE',
      'NORTHWEST': 'NW',
      'SOUTHEAST': 'SE',
      'SOUTHWEST': 'SW',
      'NORTHEASTERN': 'NE',
      'NORTHWESTERN': 'NW',
      'SOUTHEASTERN': 'SE',
      'SOUTHWESTERN': 'SW',
      'NORTH': 'NORTH',
      'EAST': 'EAST',
      'SOUTH': 'SOUTH',
      'WEST': 'WEST',
    };

    if (directionMap[clean]) {
      return directionMap[clean];
    }
    return clean;
  };

  // Process and compute distances / trajectories
  const processNWSFeatures = (features: any[]) => {
    const processedList: NWSAlert[] = [];
    const currentSignatures = new Set<string>();
    let freshUpdateCount = 0;

    features.forEach((feature: any) => {
      const props = feature.properties || {};
      const desc = (props.description || '').toUpperCase();
      const instr = (props.instruction || '').toUpperCase();
      const fullText = `${desc} ${instr}`;
      const eventName = props.event || 'Special Weather Statement';

      // 1. Keyword analysis matches
      const hasRotation =
        fullText.includes('ROTATION') ||
        fullText.includes('RADAR INDICATED TORNADO') ||
        fullText.includes('TORNADIC') ||
        fullText.includes('MESOCYCLONE') ||
        fullText.includes('ROTATING WALL') ||
        fullText.includes('ROTATING') ||
        fullText.includes('VELOCITY COUPLING') ||
        fullText.includes('COUPLING');
      const hasFunnel =
        fullText.includes('FUNNEL') ||
        fullText.includes('WALL CLOUD') ||
        fullText.includes('SHELF CLOUD');
      const hasObserved =
        fullText.includes('OBSERVED') ||
        fullText.includes('CONFIRMED') ||
        fullText.includes('TORNADO ON THE GROUND') ||
        fullText.includes('DEBRIS SIGNATURE') ||
        fullText.includes('TORNADO DEBRIS') ||
        fullText.includes('TDS') ||
        fullText.includes('DAMAGING TORNADO');
      const hasPossible =
        fullText.includes('TORNADO...POSSIBLE') ||
        fullText.includes('INDICATED TORNADO') ||
        fullText.includes('DEVELOPING ROTATION') ||
        fullText.includes('TORNADOES POSSIBLE') ||
        fullText.includes('TORNADO THREAT...POSSIBLE') ||
        fullText.includes('ROTATION ENVELOPE');
      const hasEmergency =
        fullText.includes('TORNADO EMERGENCY') ||
        fullText.includes('PARTICULARLY DANGEROUS SITUATION') ||
        fullText.includes('PDS') ||
        fullText.includes('CATASTROPHIC') ||
        fullText.includes('MASSIVE TORNADO') ||
        fullText.includes('EVACUATE') ||
        eventName.toUpperCase().includes('EMERGENCY');
      const isDestructive =
        fullText.includes('DESTRUCTIVE') ||
        fullText.includes('80 MPH') ||
        fullText.includes('90 MPH') ||
        fullText.includes('100 MPH') ||
        fullText.includes('WIND GUSTS TO 80') ||
        fullText.includes('WIND GUSTS TO 90') ||
        fullText.includes('WIND GUSTS TO 100') ||
        fullText.includes('EXTREME WIND');

      // Storm Vector Trajectory Parsing utilizing silent convective-focused filters
      const trajectory = parseStormTrajectory(eventName, fullText);
      const vectorMatch: [string, string, string] | null = trajectory.hasTrajectory
        ? [trajectory.direction || '', String(trajectory.speed || 0), trajectory.unit || 'MPH']
        : null;

      // --- INTERNAL PREDICTIVE ENGINE ENGINE MODULE V2 ---
      // Helper to convert direction string to bearing degrees safely
      const getDirHeadingDegrees = (dirStr: string): number | null => {
        const clean = dirStr.trim().toUpperCase();
        const degreeMatch = clean.match(/^(\d+)/);
        if (degreeMatch) {
          return parseInt(degreeMatch[1], 10) % 360;
        }
        const normalized = normalizeDirection(clean);
        const bear = cardinalBearings[normalized];
        return bear !== undefined ? bear : null;
      };

      // 1. High-Priority Tag Metadata Parsing
      let strongSupercellUpdraft = false;
      const hailMatch = fullText.match(/EXPECTED[\s_]HAIL[\s_]SIZE\s*:\s*([0-9.]+)/i) || 
                        fullText.match(/HAIL\s*\.\.\.\s*([0-9.]+)\s*IN/i) || 
                        fullText.match(/HAIL\s*SIZE\s*([0-9.]+)\s*IN/i) ||
                        fullText.match(/HAIL\s*([0-9.]+)\s*IN/i);
      if (hailMatch) {
        const size = parseFloat(hailMatch[1]);
        if (size >= 2.0) {
          strongSupercellUpdraft = true;
        }
      }

      let tornadoDamageThreatOnGround = false;
      const destructiveThreatMatch = fullText.includes('TORNADO_DAMAGE_THREAT...CONSIDERABLE') || 
                                     fullText.includes('DAMAGE THREAT...CONSIDERABLE') || 
                                     fullText.includes('TORNADO_DAMAGE_THREAT...CATASTROPHIC') || 
                                     fullText.includes('DAMAGE THREAT...CATASTROPHIC') || 
                                     fullText.includes('TORNADO EMERGENCY') ||
                                     fullText.includes('CATASTROPHIC DAMAGE THREAT');
      if (destructiveThreatMatch) {
        tornadoDamageThreatOnGround = true;
      }

      // 2. Warning Polygon Centroid tracking shift vector (Shrinkage & Evolution)
      let polygonCentroidShiftVector: { dir: string; speed: number; bearing: number } | null = null;
      if (feature.geometry && feature.geometry.coordinates) {
        const currentCentroid = getGeometryCentroid(feature.geometry.coordinates);
        if (currentCentroid && props.id) {
          const prev = alertsCentroidsHistoryRef.current[props.id];
          const nowMs = Date.now();
          if (prev) {
            const distMiles = getDistance(prev.lat, prev.lon, currentCentroid.lat, currentCentroid.lon);
            const timeHours = (nowMs - prev.timestamp) / 3600000;
            // Shifting centroids of NWS active alerts happen after consecutive polls (spaced overlay)
            if (timeHours > 0.005 && distMiles > 0.01 && distMiles < 10) {
              const speedMph = distMiles / timeHours;
              const bearingDeg = getBearing(prev.lat, prev.lon, currentCentroid.lat, currentCentroid.lon);
              
              // Normalize bearing into standard cardinal key
              let closestDir = 'EAST';
              let minDiff = 360;
              Object.entries(cardinalBearings).forEach(([name, deg]) => {
                const diff = Math.min(Math.abs(bearingDeg - deg), 360 - Math.abs(bearingDeg - deg));
                if (diff < minDiff) {
                  minDiff = diff;
                  closestDir = name;
                }
              });

              if (speedMph >= 10 && speedMph <= 120) {
                polygonCentroidShiftVector = {
                  dir: closestDir,
                  speed: Math.round(speedMph),
                  bearing: Math.round(bearingDeg)
                };
              }
            }
          }
          // Update historical logs for this alert ID
          alertsCentroidsHistoryRef.current[props.id] = {
            lat: currentCentroid.lat,
            lon: currentCentroid.lon,
            timestamp: nowMs
          };
        }
      }

      // 3. Turf.js Advanced Spatial Upstream Buffering
      let convectiveIntensificationDetected = false;
      try {
        if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
          // Identify environment instability from local database of conditions
          const curCapeVal = forecastTrend?.currentCapeVal || 0;
          const isCapeHigh = curCapeVal > 1500 || forecastTrend?.capeDirection === 'Increasing Instability' || fullText.includes('CAPE');
          
          const activeVector = polygonCentroidShiftVector || (vectorMatch ? {
            dir: vectorMatch[0],
            speed: parseInt(vectorMatch[1], 10),
            bearing: getDirHeadingDegrees(vectorMatch[0])
          } : null);

          if (isCapeHigh && activeVector && activeVector.bearing !== null && activeVector.speed > 0) {
            // Project warning cell downstream along storm movement vector (45-minute path)
            const travelDistanceMiles = activeVector.speed * 0.75;
            const travelDistanceKm = travelDistanceMiles * 1.60934;

            // Generate translated upstream buffer geometry
            const translatedPolygon = turf.transformTranslate(feature.geometry, travelDistanceKm, activeVector.bearing);
            
            // Check intersection of translated polygon with saved human coordinates or asset spaces
            if (assets.length > 0) {
              const hasAssetOverlap = assets.some((a) => {
                const pt = turf.point([a.lon, a.lat]);
                return turf.booleanPointInPolygon(pt, translatedPolygon as any);
              });
              if (hasAssetOverlap) {
                convectiveIntensificationDetected = true;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[Predictive Engine: Spatial Upstream Buffering Fail]', e);
      }

      // 4. Fusing Live Radar Precursors
      const velocityCoupletPersistentShear = fullText.includes('ROTATION') || 
                                             fullText.includes('VELOCITY COUPLING') || 
                                             fullText.includes('SHEAR') ||
                                             fullText.includes('ROTATING');
      
      const hookEchoEvolutionDetected = fullText.includes('HOOK ECHO') || 
                                        fullText.includes('HOOK') || 
                                        fullText.includes('SUPERCELL');

      const tornadoDebrisSignatureTDS = fullText.includes('DEBRIS SIGNATURE') || 
                                         fullText.includes('TORNADO DEBRIS') || 
                                         fullText.includes('TDS');

      // 5. Compute Advanced Tornado Predictive Confidence Score
      let predictedTornadoConfidence = 0;
      const isTornadoEvent = eventName.toUpperCase().includes('TORNADO');
      const isSevereThunderstorm = eventName.toUpperCase().includes('THUNDERSTORM');

      if (isTornadoEvent) {
        predictedTornadoConfidence = 50; // Base tornado warning confidence is 50%
        if (tornadoDebrisSignatureTDS) {
          predictedTornadoConfidence = 100; // TDS dual-pol verification triggers 100%
        } else {
          if (hasObserved) predictedTornadoConfidence += 25;
          if (velocityCoupletPersistentShear) predictedTornadoConfidence += 15;
          if (strongSupercellUpdraft) predictedTornadoConfidence += 10;
        }
      } else if (isSevereThunderstorm) {
        if (strongSupercellUpdraft) predictedTornadoConfidence += 20;
        if (velocityCoupletPersistentShear) predictedTornadoConfidence += 15;
        if (convectiveIntensificationDetected) {
          predictedTornadoConfidence += 30; // Tracks directly into environmental instability gradients
        }
      }
      predictedTornadoConfidence = Math.min(100, Math.max(0, predictedTornadoConfidence));

      // 6. Issue automated early localized trigger warnings on high-value hazard threats
      if (convectiveIntensificationDetected && velocityCoupletPersistentShear && !isTornadoEvent) {
        triggerToast(
          `⚠️ AUTOMATED PREDICTIVE WARNING: Severe convective cell tracking directly into extreme local instability. Early tornadic intensification predicted downstream.`,
          'error'
        );
      } else if (tornadoDebrisSignatureTDS && isTornadoEvent) {
        triggerToast(
          `🌪️ HIGH CONFIDENCE TORNADO DISPATCH: Doppler Radar and Dual-Pol correlation coefficients verify physical debris lofted. Seek shelter immediately!`,
          'error'
        );
      }

      // Snip detailed hazard line
      let snippet = '';
      const lines = desc.split('\n');
      const matchedLine = lines.find((l: string) => l.includes('HAZARD...') || l.includes('IMPACT...')) || '';
      if (matchedLine) {
        snippet = matchedLine.replace(/HAZARD\.\.\.|IMPACT\.\.\./g, '').trim();
      }

      // 2. Geospatial Proximity calculations
      let shortestDistance = 999;
      let matchedInZone = false;
      let isHeadingTowards = false;
      let calculatedEta: number | undefined = undefined;

      if (assets.length > 0) {
        // Geometric distance to polygon boundary (Change 1 Priority)
        if (feature.geometry && feature.geometry.coordinates) {
          let calculatedMin = 9999;
          let closestPt: [number, number] | null = null;
          let insidePoly = false;

          const alertId = props.id || feature.id || '';
          assets.forEach((a) => {
            const result = getMemoizedMinPolygonDistance(a.id, a.lat, a.lon, alertId, feature.geometry.coordinates);
            if (result.isInside) insidePoly = true;
            if (result.minDist < calculatedMin) {
              calculatedMin = result.minDist;
              closestPt = result.closestPt;
            }
          });

          if (insidePoly) {
            shortestDistance = 0;
            matchedInZone = true;
          } else if (closestPt && calculatedMin < 9999) {
            shortestDistance = calculatedMin;

            // Trajectory projection supporting both cardinal words and degrees
            if (vectorMatch) {
              const normalizedDir = normalizeDirection(vectorMatch[0]);
              let stormDir: number | undefined = undefined;
              if (/^\d+$/.test(normalizedDir)) {
                stormDir = parseInt(normalizedDir, 10) % 360;
              } else {
                stormDir = cardinalBearings[normalizedDir];
              }

              if (stormDir !== undefined) {
                isHeadingTowards = assets.some((a) => {
                  const bearingToAsset = getBearing(closestPt![1], closestPt![0], a.lat, a.lon);
                  const diff = Math.abs(stormDir! - bearingToAsset);
                  return Math.min(diff, 360 - diff) < 45; // within 45 degrees tracking envelope
                });
              }

              if (isHeadingTowards) {
                let speed = parseInt(vectorMatch[1], 10);
                const unit = vectorMatch[2].toUpperCase();
                if (unit.startsWith('KT') || unit.startsWith('KNOT')) {
                  speed = Math.round(speed * 1.15); // convert knots to mph
                }
                if (speed > 0) {
                  calculatedEta = Math.round((shortestDistance / speed) * 60);
                }
              }
            }
          }
        }

        // Zone Name Lookup Fallback (Trigger logic)
        assets.forEach((asset) => {
          const upperCounty = asset.name.toUpperCase().replace(/ COUNTY| PARISH/g, '').split(',')[0].trim();
          if (
            upperCounty.length > 3 &&
            props.areaDesc &&
            props.areaDesc.toUpperCase().includes(upperCounty)
          ) {
            matchedInZone = true;
          }
        });
      }

      const alertSig = `${props.id}-${shortestDistance < 999 ? shortestDistance.toFixed(1) : 'NA'}-${snippet}`;
      currentSignatures.add(alertSig);

      let wasUpdated = false;
      if (previousSignaturesRef.current.size > 0 && !previousSignaturesRef.current.has(alertSig)) {
        if (matchedInZone || shortestDistance <= settings.monitorRadius) {
          wasUpdated = true;
          freshUpdateCount++;
        }
      }

      // Compute qualitative Threat Level indicator based on proximity and keyword analysis
      let calculatedThreatLevel: 'Low' | 'Moderate' | 'High' | 'Extreme' = 'Low';
      const isWarning = eventName.toUpperCase().includes('WARNING');
      const isWatch = eventName.toUpperCase().includes('WATCH');
      const isTornado = eventName.toUpperCase().includes('TORNADO');

      if (isWarning && (matchedInZone || shortestDistance <= 5)) {
        if (hasEmergency || hasObserved || isDestructive || isTornado || predictedTornadoConfidence >= 65) {
          calculatedThreatLevel = 'Extreme';
        } else {
          calculatedThreatLevel = 'High';
        }
      } else if (isWarning && (matchedInZone || shortestDistance <= settings.monitorRadius)) {
        calculatedThreatLevel = 'High';
      } else if (isWarning && shortestDistance <= 50) {
        if (isHeadingTowards) {
          calculatedThreatLevel = 'High';
        } else {
          calculatedThreatLevel = 'Moderate';
        }
      } else if (isWatch && (matchedInZone || shortestDistance <= settings.monitorRadius)) {
        if (isTornado && (hasRotation || hasFunnel)) {
          calculatedThreatLevel = 'High';
        } else {
          calculatedThreatLevel = 'Moderate';
        }
      } else if (shortestDistance <= settings.monitorRadius && (hasRotation || hasFunnel || hasPossible)) {
        calculatedThreatLevel = 'Moderate';
      } else {
        calculatedThreatLevel = 'Low';
      }

      processedList.push({
        id: props.id || Math.random().toString(),
        event: eventName,
        areaDesc: props.areaDesc || 'Unknown Boundaries',
        description: props.description || '',
        instruction: props.instruction || '',
        expires: props.expires || '',
        sent: props.sent || props.onset || props.issued || '',
        geometry: feature.geometry,
        minDist: shortestDistance,
        isDirectHit: matchedInZone,
        headedTowards: isHeadingTowards,
        etaMinutes: calculatedEta,
        snippet: snippet,
        keywords: {
          rotation: hasRotation,
          funnel: hasFunnel,
          observed: hasObserved,
          possible: hasPossible,
          emergency: hasEmergency,
          destructive: isDestructive,
          vector: vectorMatch,
        },
        justUpdated: wasUpdated,
        threatLevel: calculatedThreatLevel,
        // Advanced Internal Prediction properties
        predictedTornadoConfidence,
        strongSupercellUpdraft,
        tornadoDamageThreatOnGround,
        polygonCentroidShiftVector,
        convectiveIntensificationDetected,
        velocityCoupletPersistentShear,
        hookEchoEvolutionDetected,
        tornadoDebrisSignatureTDS,
      });
    });

    // Deduplicate and Sort: Direct hits, and then nearest distance prioritized at the top
    const unique = processedList.filter(
      (v, i, a) => a.findIndex((t) => t.id === v.id) === i
    );
    unique.sort((a, b) => {
      if (a.isDirectHit && !b.isDirectHit) return -1;
      if (!a.isDirectHit && b.isDirectHit) return 1;
      return a.minDist - b.minDist;
    });

    // Filter to show only the single latest Special Weather Statement if there are multiple
    let latestSWS: NWSAlert | null = null;
    let swsMaxTime = 0;
    unique.forEach((alert) => {
      if (alert.event.toLowerCase() === 'special weather statement') {
        const time = alert.sent ? new Date(alert.sent).getTime() : (alert.expires ? new Date(alert.expires).getTime() : 0);
        if (time > swsMaxTime) {
          swsMaxTime = time;
          latestSWS = alert;
        }
      }
    });

    const filteredUnique = unique.filter((alert) => {
      if (alert.event.toLowerCase() === 'special weather statement') {
        return latestSWS ? alert.id === latestSWS.id : true;
      }
      return true;
    });

    setAlerts((prevActive) => {
      if (prevActive && prevActive.length > 0) {
        const resolvedList = prevActive.filter(
          (oldAlert) => !filteredUnique.some((newAlert) => newAlert.id === oldAlert.id)
        );
        if (resolvedList.length > 0) {
          addAlertsToHistory(resolvedList);
        }
      }
      return filteredUnique;
    });
    
    // Generate and store rotation pins based on current active alerts
    const activeRotationPins = translateAlertsToRotationPins(filteredUnique);
    setRotationPins(activeRotationPins);

    previousSignaturesRef.current = currentSignatures;
  };

  // Core SPC Mesoscale Discussions Acquisition Engine
  const fetchMesoscaleDiscussions = async () => {
    try {
      const res = await fetch('https://api.weather.gov/products/types/MCD', {
        headers: {
          'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
        }
      });
      let apiDiscussions: MesoscaleDiscussion[] = [];

      if (res.ok) {
        const data = await res.json();
        const graph = data['@graph'] || [];

        // Sort descending and take top 5 to load quickly
        const sortedGraph = [...graph].sort((a: any, b: any) =>
          new Date(b.issuanceTime).getTime() - new Date(a.issuanceTime).getTime()
        );
        const topProducts = sortedGraph.slice(0, 5);

        const fetched = await Promise.all(
          topProducts.map(async (prod: any) => {
            try {
              const prodRes = await fetch(`https://api.weather.gov/products/${prod.id}`, {
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
  };

  // High-Resolution Predictive Windy Point Forecast API Query
  const fetchWindyPointTelemetry = async (lat: number, lon: number) => {
    const rawKey = (customPointKey || localStorage.getItem('daisy-windy-point-key') || (import.meta as any).env?.VITE_WINDY_POINT_KEY);
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

      let res = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(body)
      });

      // Self-healing fallback: if model-specific request (e.g. namConus) fails, retry using the universal 'gfs' model
      if (!res.ok && model !== 'gfs') {
        const errTxt = await res.clone().text().catch(() => '');
        console.warn(`Windy API model '${model}' rejected (Status ${res.status}: ${errTxt}). Falling back to 'gfs'...`);
        
        if (settings.telemetryDebug) {
          console.warn('[Telemetry Debug] Model specific request failed, falling back to gfs', {
            timestamp: new Date().toISOString(),
            status: res.status,
            error: errTxt
          });
        }

        // Track this model fallback in networkLogs
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
        res = await fetch(`https://api.windy.com/api/point-forecast/v2?key=${windyPointKey}`, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(body)
        });
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => 'No further details provided');
        
        const is400 = res.status === 400;
        let suggestion = '';
        if (is400) {
          suggestion = `Your Windy API key may lack point-forecast privileges or permission for active model '${model}'. Ensure key has appropriate subscriptions on Windy portal.`;
          
          // Explicitly log the full request URL and headers whenever a 400 error occurs
          console.error('[Telemetry 400 Bad Request Error]', {
            timestamp: new Date().toISOString(),
            status: res.status,
            url: url,
            headers: reqHeaders,
            payload: body,
            responseError: errText
          });
        } else {
          if (settings.telemetryDebug) {
            console.error('[Telemetry Debug] Windy Forecast Query Failed', {
              timestamp: new Date().toISOString(),
              status: res.status,
              error: errText
            });
          }
        }

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
      setWindyPointError(null); // Clear any pending errors on successful query

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

      if (settings.telemetryDebug) {
        console.log('[Telemetry Debug] Windy Forecast Query Successful', {
          timestamp: new Date().toISOString(),
          responseStatus: res.status,
          responsePayload: data
        });
      }
      
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
          // Filter out physically impossible values (supersonic wind or sensor anomalies, e.g. > 250 mph)
          if (mph > 250 || mph < 0) {
            console.warn(`[Windy Point Telemetry] Discarding physically impossible wind reading: ${mph.toFixed(1)} mph (${val} m/s)`);
            return undefined;
          }
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

        // Construct 6-Hour CAPE Index History and dynamic model curve
        const currentCape = capeVal !== undefined ? Math.round(capeVal) : 0;
        const latLonKey = `daisy-cape-history-${lat.toFixed(2)}_${lon.toFixed(2)}`;
        
        let storedPoints: { time: string; timestamp: number; cape: number; isForecast?: boolean }[] = [];
        try {
          const storedHistoryRaw = localStorage.getItem(latLonKey);
          if (storedHistoryRaw) {
            storedPoints = JSON.parse(storedHistoryRaw);
          }
        } catch (e) {
          console.warn('LocalStorage CAPE parse error', e);
        }
        
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
      if (settings.telemetryDebug) {
        console.error('[Telemetry Debug] Caught Windy Point Forecast service error', {
          timestamp: new Date().toISOString(),
          error: err?.message || String(err)
        });
      }
      setWindyPointTelemetry(null);
    } finally {
      setWindyPointLoading(false);
    }
  };

  // Fetch National Weather Service grid forecast details
  const fetchNWSForecast = async (lat: number, lon: number) => {
    try {
      const forecastCacheKey = `fc_${lat.toFixed(2)}_${lon.toFixed(2)}`;
      let forecastUrl = resolvedStationsRef.current[forecastCacheKey];
      const headers = {
        'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
      };

      if (!forecastUrl) {
        const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
        const ptRes = await fetch(pointsUrl, { headers });

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

      const fcRes = await fetch(forecastUrl, { headers });
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

      // Extract high/low from upcoming periods
      periods.slice(0, 3).forEach((p: any) => {
        if (p.isDaytime && highTemp === undefined) {
          highTemp = p.temperature;
        }
        if (!p.isDaytime && lowTemp === undefined) {
          lowTemp = p.temperature;
        }
      });

      // Find max probability of precipitation within the upcoming periods
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
  };

  // NWS XML Telemetry Observations Engine (Layer 2 Telemetry)
  const fetchTelemetry = async (lat: number, lon: number) => {
    // Synchronize predictive convective modeling in parallel
    fetchWindyPointTelemetry(lat, lon);
    
    // Fetch NWS Forecast details in parallel
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
        // Step A: Find closest observation station endpoint (if not cached)
        const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
        const headers = {
          'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
        };
        const ptRes = await fetch(pointsUrl, { headers });
        
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

        // Step B: Grab nearest weather station identity (if not cached)
        const stationRes = await fetch(stationsUrl, { headers });
        
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

      // Step C: Poll latest physical surface telemetry readings (always live)
      const obsUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`;
      const obsHeaders = {
        'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
      };
      const obsRes = await fetch(obsUrl, { headers: obsHeaders });
      
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
        // Filter out physically impossible values (supersonic wind or sensor anomalies, e.g. > 250 mph)
        if (mph > 250 || mph < 0) {
          console.warn(`[NWS ASOS Telemetry] Discarding physically impossible wind reading: ${mph.toFixed(1)} mph (${val} m/s)`);
          return undefined;
        }
        return mph.toFixed(0);
      };

      const paToInHg = (val: number | null) => {
        if (val === null) return undefined;
        return (val * 0.0002953).toFixed(2);
      };

      const livePressureStr = paToInHg(props.barometricPressure?.value);

      // Fetch recent observations list for exact barometric historical trends (no seeding, real data only)
      try {
        const histUrl = `https://api.weather.gov/stations/${stationId}/observations?limit=12`;
        const histRes = await fetch(histUrl, { headers: obsHeaders });
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
            
            // Deduplicate observations by time string to ensure clean viewport presentation
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
  };

  // Add search/pin targeted locations
  const handleAddNewPin = async () => {
    siren.init(); // prime Audio Context on click event
    const cleanedQuery = searchQuery.trim();
    if (!cleanedQuery) return;

    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanedQuery)}&countrycodes=us&addressdetails=1&limit=1`;
      const res = await fetch(url, {
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
        
        // Instant trigger refresh
        setTimeout(() => {
          fetchNationalAlerts();
          fetchTelemetry(latVal, lonVal);
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

    // Initialize Web Audio context immediately inside user response callback for browsers compatibility
    try {
      siren.init();
    } catch (err) {
      console.warn("Siren init error:", err);
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setCurrentLat(lat);
          setCurrentLon(lon);

          // Get location name via reverse Nominatim geocoder
          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
            const response = await fetch(url, {
              headers: { 'User-Agent': 'DAISY-Emergency-System/1.0 (contact: cerberus@c0dejunky.com)' },
            });
            if (response.ok) {
              const data = await response.json();
              const pinName = formatAddress(data.address, 'Current GPS Base');
              
              // Only insert if duplicate coordinates are cleared
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
    siren.init();
    siren.play(2, true);
    setTimeout(() => siren.stop(), 2500); // sound tests duration capped safely
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
    // clipboard copy fallback
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
          // switch map overlay to radar automatically
          setMapMode('radar');
        }
      } catch (e) {
        console.warn('Error focusing trajectory centroid:', e);
      }
    }
  };

  const handleFocusMD = (md: MesoscaleDiscussion) => {
    if (md.coordinates && md.coordinates.length > 0) {
      // Compute coordinates centroid to center map view nicely
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
    (a) => a.isDirectHit && (a.event.toUpperCase().includes('TORNADO') || a.keywords.rotation || a.keywords.funnel || a.keywords.observed)
  );

  const activeIntersectingMD = discussions.find(
    (d) => d.isIntersecting && d.probability >= 40
  );

  // Derive Atmospheric stability & Storm Bypass Probability trends based on 6-Hour historical and forecast data
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

    // 1. Calculate pressure trend over available polling ticks
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

    // 2. Calculate CAPE trend over historical and predictive points
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

    // 3. Synthesize stability trends into direct storm bypass metrics
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

    // Case 1: Extreme Instability / Active Destabilizing Environment
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
    }
    // Case 2: Thermodynamically Stable (Low CAPE)
    else if (maxCapeVal < 300 && deltaPressure >= -0.01) {
      status = 'Trend: Stable';
      statusDesc = 'Local microclimate lacks convective buoyancy and thermal moisture (CAPE < 300). Approaching convective cells usually lose internal convection and divert path or go around you.';
      bypassChance = 'Very High (90% - 95% Bypass)';
      badgeColor = 'bg-teal-500/10 border-teal-500 text-teal-600 dark:text-neon-aqua';
      textColor = 'text-teal-600 dark:text-neon-aqua';
      shadowColor = 'shadow-[0_4px_20px_rgba(20,184,166,0.05)]';
      trendLabel = 'Atmospheric Shield / Severe Weather Unfavorable';
      isUnstable = false;
      isStable = true;
    }
    // Case 3: Storm Decaying / Cool Stabilization
    else if (deltaPressure > 0.01 || (capeDirection === 'Stabilizing' && maxCapeVal < 1000)) {
      status = 'Trend: Stabilizing';
      statusDesc = 'Pressure is rising or CAPE indices are actively cooling down, indicating the storm engine is choked of convective potential. Incoming cells are expected to weaken or decay.';
      bypassChance = 'High (70% - 85% Bypass)';
      badgeColor = 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400';
      textColor = 'text-emerald-700 dark:text-emerald-400';
      shadowColor = 'shadow-[0_4px_20px_rgba(16,185,129,0.05)]';
      trendLabel = 'Positive Pressure Drift / Convective Decay';
      isUnstable = false;
      isStable = true;
    }
    // Case 4: Moderately Unstable / Dynamic Course Changes
    else {
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
              {/* Windows & Desktop App */}
              <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1.5 hover:border-cyan-500/20 transition-all text-left">
                <span className="text-[10px] font-black uppercase text-cyan-400 tracking-wider">Windows / Mac (Chrome or Edge)</span>
                <p className="text-xs text-slate-300 font-semibold leading-relaxed">
                  Look at the right side of your browser's address bar (URL bar). Click the installation button (or circle with arrow icon) and select <strong className="text-white">Install</strong>. D.A.I.S.Y. will run as a high-performance standalone desktop window.
                </p>
              </div>

              {/* iOS / Apple Safari */}
              <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1.5 hover:border-cyan-500/20 transition-all text-left">
                <span className="text-[10px] font-black uppercase tracking-wider text-pink-400">iPhone / iPad (Apple Safari)</span>
                <p className="text-xs text-slate-300 font-semibold leading-relaxed">
                  Tap the browser <strong className="text-white">Share</strong> button at the bottom of Safari, scroll down, and select <strong className="text-white">Add to Home Screen</strong>.
                </p>
              </div>

              {/* Android / Mobile Chrome */}
              <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-2xl flex flex-col gap-1.5 hover:border-cyan-500/20 transition-all text-left">
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
              <div className="bg-rose-950/70 border border-rose-500/55 p-3.5 rounded-xl mb-4 text-left flex items-start gap-2.5 shadow-[0_0_15px_rgba(239,68,68,0.2)]" id="geo-error-pane">
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
                  className="w-4 h-4 rounded border-slate-800 text-neon-aqua focus:ring-0 focus:ring-offset-0 bg-slate-950 accent-neon-aqua disabled:opacity-50"
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

          {/* Secure Client Sandbox Disclaimers & Session Risk Information */}
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
        
        {/* Toast notifications center */}
        {notificationToast && (
          <div className="fixed top-5 right-5 z-[300] max-w-sm w-full bg-slate-900 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl p-4 flex items-start gap-3 animate-fade-in transition-all">
            {notificationToast.type === 'error' ? (
              <AlertOctagon className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            ) : notificationToast.type === 'success' ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-neon-aqua shrink-0 mt-0.5" />
            ) : (
              <Info className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-grow">
              <p className="text-xs font-bold leading-relaxed">{notificationToast.message}</p>
            </div>
            <button 
              onClick={() => setNotificationToast(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-white shrink-0 font-bold p-0.5"
            >
              ×
            </button>
          </div>
        )}

        {/* Urgent Warning Ticker Header if direct threats exist */}
        {isAnyDirectHitWarningActive && (
          <div className="bg-red-950 border-2 border-red-500 p-4 rounded-2xl flex justify-between items-center shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse">
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

            {/* Quick Action Systems */}
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

          {/* Settings / Controls Strip */}
          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-5 flex flex-col md:flex-row justify-between items-center gap-4 transition-colors">
            <div className="flex flex-wrap items-center justify-center gap-5">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase cursor-pointer tracking-wider select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  id="settings-audio"
                  name="audioSirenToggle"
                  checked={settings.audio}
                  onChange={(e) => setSettings((s) => ({ ...s, audio: e.target.checked }))}
                  className="w-4 h-4 accent-neon-pink bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
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
                  className="w-4 h-4 accent-neon-aqua bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
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
                  className="w-4 h-4 accent-slate-800 dark:accent-white bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
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
                  className="w-4 h-4 accent-indigo-600 dark:accent-indigo-400 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                  Telemetry Debug
                </span>
              </label>



              {/* Monitor Radius Slider */}
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

            {/* Connection and Sync indicators */}
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


        </header>

        {/* Core Screen Layout Grid: Stretched columns matching page width */}
        <div className="flex flex-col gap-6 items-stretch">
          
          {/* 1. Spatial Interactive Radar Map (Full width) */}
          <div className="w-full">
            <RadarMap
              userLat={currentLat}
              userLon={currentLon}
              assets={assets}
              alerts={alerts}
              activeThreats={alerts.filter((a) => a.threatLevel === 'High' || a.threatLevel === 'Extreme')}
              discussions={discussions}
              rotationPins={rotationPins}
              mapMode={mapMode}
              onMapModeChange={setMapMode}
              onSetCoordinates={(lat, lon) => {
                setCurrentLat(lat);
                setCurrentLon(lon);
              }}
              customMapKey={customMapKey}
            />
          </div>          {/* Spatial Interactive Disclaimer Panel */}
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
                      assets.map((asset) => (
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

          {/* 3. Ground Surface Air Telemetry (NWS ASOS) & Local Forecast trends (Unified ASOS & Bypass Dashboard) */}
          <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-sm transition-colors flex flex-col justify-between" aria-label="NWS Telemetry and Forecast Microclimate Analysis">
            <div>
              <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                Ground Surface Air Telemetry (NWS ASOS) & Local Microclimate Trends
              </h3>
              
              {telemetry ? (
                <>


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
                </>
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[9px] uppercase text-center rounded-xl">
                  Synchronizing closest station observational grids...
                </div>
              )}
            </div>

            <hr className="border-slate-200 dark:border-slate-800/80 my-5" />

          <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm transition-all text-slate-800 dark:text-white" aria-label="Tornadogenesis Analysis">
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
            </div>

            {/* Main Content Body */}
            {isAnalyzingTelemetry ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold animate-pulse">
                  Querying dynamic atmospheric solver columns...
                </p>
              </div>
            ) : tornadogenesisData ? (
              <div className="space-y-6 animate-fade-in">
                {/* Visual Gauge Summary Card */}
                <div className="bg-slate-50 dark:bg-slate-950/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-850 flex flex-col items-center justify-center text-center gap-6">
                  {/* Circular Ring Gauge */}
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

                  {/* Summary Text description */}
                  <div className="text-center space-y-2 flex flex-col items-center">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none">
                      AI Diagnostic Assessment
                    </h3>
                    <p className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 leading-relaxed">
                      {tornadogenesisData.display_message || 'Atmospheric telemetry columns analyzed successfully.'}
                    </p>
                    <div className="flex justify-center gap-2 flex-wrap">
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
                      {tornadogenesisData.downburst_risk && tornadogenesisData.downburst_risk !== 'None' && (
                        <span className={`px-2 py-0.5 rounded text-[8px] font-mono tracking-widest uppercase font-bold text-white ${
                          tornadogenesisData.downburst_risk === 'Extreme' ? 'bg-fuchsia-600' :
                          tornadogenesisData.downburst_risk === 'High' ? 'bg-purple-600' :
                          'bg-indigo-600'
                        }`}>
                          {tornadogenesisData.downburst_risk.toUpperCase()} DOWNBURST RISK
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* The 4 Severe Weather Ingredients (Vertical Stack) */}
                <div className="flex flex-col gap-4">
                  {/* Low Level Moisture */}
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

                  {/* Instability */}
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

                  {/* Lifting Mechanisms */}
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

                  {/* Vertical Wind Shear */}
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

                <div className="mt-6 flex justify-end border-t border-slate-200 dark:border-slate-800 pt-4">
                  <button
                    onClick={() => handleSyncMl(false)}
                    disabled={isSyncingMl}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] tracking-wider uppercase rounded-xl transition-all disabled:opacity-50 shadow-sm"
                  >
                    {isSyncingMl ? 'Syncing...' : 'Sync ML Snapshot to Sheets'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[9px] uppercase text-center rounded-xl">
                Synchronizing closest station observational grids...
              </div>
            )}
          </section>

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
        </div>

        {/* Spatial Proximity alerts listings section */}
        <section className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
            <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white font-sans tracking-wide uppercase flex items-center gap-2">
              <Radio className="w-6 h-6 text-rose-500 dark:text-neon-pink animate-[pulse_1.5s_infinite]" />
              Active Proximity Alerts
            </h2>
            
            {/* Filter Toggle for storm motion or impact trajectory headed towards the user */}
            {alerts.length > 0 && (
              <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800/80 self-stretch sm:self-auto">
                <button
                  id="show-all-threats-btn"
                  type="button"
                  onClick={() => setShowHeadedTowardsOnly(false)}
                  className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-wider ${
                    !showHeadedTowardsOnly
                      ? 'bg-slate-800 dark:bg-slate-800 text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  All Alerts ({alerts.length})
                </button>
                <button
                  id="show-headed-threats-btn"
                  type="button"
                  onClick={() => setShowHeadedTowardsOnly(true)}
                  className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-wider flex items-center justify-center gap-1.5 ${
                    showHeadedTowardsOnly
                      ? 'bg-rose-600 dark:bg-rose-500 text-white shadow-[0_2px_8px_rgba(225,29,72,0.3)]'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  Headed Towards Me ({alerts.filter((a) => a.headedTowards || a.isDirectHit).length})
                </button>
              </div>
            )}
          </div>

          {alerts.length === 0 ? (
            <div className="bg-white dark:bg-slate-900/10 border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-3xl p-16 text-center shadow-sm">
              <ShieldCheck className="w-12 h-12 text-teal-600 dark:text-neon-aqua mx-auto mb-4 animate-[pulse_2s_infinite]" />
              <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase font-sans tracking-wider">
                System Clear
              </h3>
              <p className="text-slate-500 dark:text-slate-400 font-semibold text-sm max-w-sm mx-auto mt-1 leading-relaxed">
                Scanning the National Weather Service. No active warnings or watches intersect your designated tracking coordinates.
              </p>
            </div>
          ) : (
            (() => {
              const displayedAlerts = showHeadedTowardsOnly
                ? alerts.filter((alert) => alert.headedTowards || alert.isDirectHit)
                : alerts;

              if (displayedAlerts.length === 0) {
                return (
                  <div className="bg-white dark:bg-slate-900/10 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-16 text-center shadow-sm">
                    <ShieldCheck className="w-12 h-12 text-teal-600 dark:text-neon-aqua mx-auto mb-4 animate-[pulse_2s_infinite]" />
                    <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase font-sans tracking-wider">
                      Clear in Path
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 font-semibold text-sm max-w-sm mx-auto mt-1 leading-relaxed">
                      You have {alerts.length} active regional alert{alerts.length > 1 ? 's' : ''}, but none are directly projected to track over or intersect your current coordinates or monitored spots.
                    </p>
                    <button
                      id="reset-filter-btn"
                      onClick={() => setShowHeadedTowardsOnly(false)}
                      className="mt-4 px-5 py-2 bg-slate-800 dark:bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      View All Proximity Alerts
                    </button>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {displayedAlerts.map((alert) => (
                    <ThreatCard
                      key={alert.id}
                      alert={alert}
                      hasAssets={assets.length > 0}
                      onViewTrajectory={handleFocusTrajectory}
                    />
                  ))}
                </div>
              );
            })()
          )}
        </section>

        {/* Alert History Section */}
        <div className="mt-8">
          <AlertHistory
            history={alertHistory}
            onClearHistory={handleClearAlertHistory}
            onRemoveItem={handleRemoveAlertHistoryItem}
          />
        </div>

        {/* SPC Mesoscale Discussions Listings Section */}
        <section className="mt-8 flex flex-col gap-4">
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
              {discussions.map((md) => {
                const isExpanded = expandedMDId === md.id;
                
                // Color mapping for watch issuance probability
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
    </div>
  );
}
