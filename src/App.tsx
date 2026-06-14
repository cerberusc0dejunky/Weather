import { useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { LocationAsset, NWSAlert, TelemetryConditions, SystemSettings, MesoscaleDiscussion, RotationPin } from './types';
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
import ThreatCard from './components/ThreatCard';
import GeolocationModal from './components/GeolocationModal';
import RadarMap from './components/RadarMap';
import AlertHistory, { ResolvedAlert } from './components/AlertHistory';
import WindGauge from './components/WindGauge';
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
  Info,
  ShieldCheck,
  Download,
  AlertOctagon,
  Sun,
  Moon,
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
  const [alertHistory, setAlertHistory] = useState<ResolvedAlert[]>(() => {
    const raw = localStorage.getItem('daisy-alert-history');
    return raw ? JSON.parse(raw) : [];
  });
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
  });

  // PWA deferred installation prompt
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);

  // Potential rotation pins state derived from active alerts
  const [rotationPins, setRotationPins] = useState<RotationPin[]>([]);

  // Keep rotationPins synchronized with active alerts
  useEffect(() => {
    setRotationPins(translateAlertsToRotationPins(alerts));
  }, [alerts]);

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

  // Handle barometric pressure trend tracking (last 6 polls)
  // Seeds a slight dropping trend initially to allow direct analysis of storm intensity indicators
  useEffect(() => {
    if (!telemetry?.pressure) return;
    const livePressureNum = parseFloat(telemetry.pressure);
    if (isNaN(livePressureNum)) return;

    if (pressureHistory.length === 0) {
      const now = new Date();
      const historicalPoints = [];
      for (let i = 5; i > 0; i--) {
        const pastTime = new Date(now.getTime() - i * 60000);
        const formattedTime = pastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // Model a subtle downward barometric drift representing severe storm entry profile
        const simulatedPressure = parseFloat((livePressureNum + i * 0.02).toFixed(2));
        historicalPoints.push({
          time: formattedTime,
          pressure: simulatedPressure
        });
      }
      const currentFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setPressureHistory([...historicalPoints, { time: currentFormatted, pressure: livePressureNum }]);
    } else {
      const lastPoint = pressureHistory[pressureHistory.length - 1];
      const now = new Date();
      const currentFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Append new point if we have a fresh polling timestamp minutes bucket
      if (lastPoint.time !== currentFormatted) {
        setPressureHistory((prev) => {
          const updated = [...prev, { time: currentFormatted, pressure: livePressureNum }];
          return updated.slice(-6);
        });
      } else if (lastPoint.pressure !== livePressureNum) {
        // Otherwise just update the latest value on same-minute ticks
        setPressureHistory((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { time: currentFormatted, pressure: livePressureNum };
          return updated;
        });
      }
    }
  }, [telemetry?.pressure, telemetry?.stationId]);

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

  // Periodic Alert Syncing Loop (60s cycle)
  useEffect(() => {
    if (!armed) return;

    fetchNationalAlerts();
    fetchTelemetry(currentLat, currentLon);
    fetchMesoscaleDiscussions();

    const interval = setInterval(() => {
      fetchNationalAlerts();
      fetchTelemetry(currentLat, currentLon);
      fetchMesoscaleDiscussions();
    }, 60000);

    return () => {
      clearInterval(interval);
      siren.stop();
    };
  }, [armed]);

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
    try {
      // Fetch filtered list of alerts based on tracked conditions
      const encodedEvents = TRACKED_ALERTS_FILTER.map((e) => encodeURIComponent(e)).join(',');
      const nwsUrl = `https://api.weather.gov/alerts/active?event=${encodedEvents}`;

      const res = await fetch(nwsUrl, {
        headers: {
          'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)',
          'Accept': 'application/geo+json'
        }
      });
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      
      const payload = await res.json();
      const features = payload.features || [];

      processNWSFeatures(features);
      setSyncStatus(`LIVE: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    } catch (err) {
      console.error('Failed to acquire weather alerts:', err);
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
        if (hasEmergency || hasObserved || isDestructive || isTornado) {
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
    const windyPointKey = (import.meta as any).env?.VITE_WINDY_POINT_KEY || 'SLQqAHupkugAsBbqWw6WsFvtJZsG1B4a';
    if (!windyPointKey) return;

    setWindyPointLoading(true);
    try {
      const isUS = lat > 24 && lat < 50 && lon > -125 && lon < -66;
      const model = isUS ? 'namConus' : 'gfs';
      
      const url = 'https://api.windy.com/api/point-forecast/v2';
      const body = {
        lat: lat,
        lon: lon,
        model: model,
        parameters: ['temp', 'wind', 'gust', 'pressure', 'dewpoint', 'precip', 'cape'],
        levels: ['surface'],
        key: windyPointKey
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }

      const data = await res.json();
      
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
          if (val === undefined) return undefined;
          return (val * 2.23694).toFixed(0);
        };

        const parsePaToInHg = (val: number | undefined) => {
          if (val === undefined) return undefined;
          return (val * 0.0002953).toFixed(2);
        };

        const tempVal = data['temp-surface']?.[closestIndex];
        const dewVal = data['dewpoint-surface']?.[closestIndex];
        const windVal = data['wind-surface']?.[closestIndex];
        const gustVal = data['gust-surface']?.[closestIndex];
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
    } catch (err) {
      console.warn('Silent fallback: Windy Point Forecast API query failed', err);
      setWindyPointTelemetry(null);
    } finally {
      setWindyPointLoading(false);
    }
  };

  // NWS XML Telemetry Observations Engine (Layer 2 Telemetry)
  const fetchTelemetry = async (lat: number, lon: number) => {
    // Synchronize predictive convective modeling in parallel
    fetchWindyPointTelemetry(lat, lon);
    try {
      const stationCacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
      let stationId = resolvedStationsRef.current[stationCacheKey];
      let stationName = '';

      if (!stationId) {
        // Step A: Find closest observation station endpoint (if not cached)
        const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
        const ptRes = await fetch(pointsUrl, {
          headers: {
            'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
          }
        });
        if (!ptRes.ok) return;

        const ptData = await ptRes.json();
        const stationsUrl = ptData.properties?.observationStations;
        if (!stationsUrl) return;

        // Step B: Grab nearest weather station identity (if not cached)
        const stationRes = await fetch(stationsUrl, {
          headers: {
            'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
          }
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
      const obsRes = await fetch(obsUrl, {
        headers: {
          'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)'
        }
      });
      if (!obsRes.ok) return;

      const obsData = await obsRes.json();
      const props = obsData.properties || {};

      const cToF = (val: number | null) => {
        if (val === null) return undefined;
        return ((val * 9) / 5 + 32).toFixed(1);
      };

      const mpsToMph = (val: number | null) => {
        if (val === null) return undefined;
        return (val * 2.23694).toFixed(0);
      };

      const paToInHg = (val: number | null) => {
        if (val === null) return undefined;
        return (val * 0.0002953).toFixed(2);
      };

      setTelemetry({
        stationId: stationId,
        stationName: stationName,
        temperature: cToF(props.temperature?.value),
        dewPoint: cToF(props.dewpoint?.value),
        windSpeed: mpsToMph(props.windSpeed?.value),
        windGust: mpsToMph(props.windGust?.value),
        windDirection: props.windDirection?.value ? `${props.windDirection.value}°` : undefined,
        pressure: paToInHg(props.barometricPressure?.value),
        textDescription: props.textDescription || undefined,
        timestamp: props.timestamp ? new Date(props.timestamp).toLocaleTimeString() : undefined,
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
    siren.init(); // engage Web Audio context immediately inside click gesture callback
    setShowLocationModal(true);
  };

  const handleLocationAccept = () => {
    setShowLocationModal(false);
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
            setAssets((prev) => [
              ...prev,
              { id: `current-gps`, name: 'CURRENT GPS BASE', lat, lon },
            ]);
          }

          setArmed(true);
        },
        () => {
          // Defaults if geolocation is denied inside browser popups
          setArmed(true);
        }
      );
    } else {
      setArmed(true);
    }
  };

  const handleLocationDecline = () => {
    setShowLocationModal(false);
    setArmed(true);
  };

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

  const handleResolveAlert = (alert: NWSAlert) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    addAlertsToHistory([alert]);
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
    (a) => a.isDirectHit && (a.event.includes('WARNING') || a.keywords.rotation || a.keywords.possible)
  );

  const activeIntersectingMD = discussions.find(
    (d) => d.isIntersecting && d.probability >= 40
  );

  return (
    <div className={`min-h-screen flex flex-col text-slate-900 dark:text-slate-100 ${settings.flash && isAnyDirectHitWarningActive ? 'flash-active-severe' : 'bg-slate-50 dark:bg-slate-950'} transition-colors duration-300`}>
      {/* Geolocation Modal Engagement */}
      {showLocationModal && (
        <GeolocationModal onAccept={handleLocationAccept} onDecline={handleLocationDecline} />
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

          <button
            id="activate-alarms-btn"
            onClick={handleArmActivation}
            className="neon-border px-10 py-5 rounded-2xl text-slate-100 font-black tracking-[0.2em] text-xs uppercase cursor-pointer hover:shadow-[0_0_25px_rgba(255,105,180,0.6)] active:scale-95 transition-all text-shadow"
          >
            Activate Alarms
          </button>
        </div>
      )}

      {/* Primary Dashboard Area */}
      <div className="main-container flex-grow flex flex-col gap-6 py-6 font-sans px-4 md:px-6 max-w-7xl mx-auto w-full transition-all">
        
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

        {/* SPC Mesoscale Discussion Watch Advisory */}
        {activeIntersectingMD && !isAnyDirectHitWarningActive && (
          <div className="bg-amber-950/70 border-2 border-amber-500 p-4 rounded-2xl flex justify-between items-center shadow-[0_0_20px_rgba(245,158,11,0.2)]">
            <div className="flex items-center gap-3 text-white">
              <Radio className="w-5 h-5 text-amber-500 shrink-0 animate-pulse" />
              <div>
                <h4 className="text-xs font-black uppercase text-amber-200">
                  SPC Mesoscale Discussion #{activeIntersectingMD.number} Watch Advisory
                </h4>
                <p className="text-amber-300 text-[10px] font-semibold leading-relaxed">
                  Severe convective potential is rising. Watch Issuance Probability: <span className="font-black text-white bg-amber-500 px-1 py-0.5 rounded text-[9px]">{activeIntersectingMD.probability}%</span>. Zone: {activeIntersectingMD.areasAffected}.
                </p>
              </div>
            </div>

            <button
              onClick={() => handleFocusMD(activeIntersectingMD)}
              className="px-3 py-1.5 bg-slate-900 text-amber-400 hover:text-amber-200 border border-amber-700 hover:border-amber-500 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer shrink-0"
            >
              Examine Corridor
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
            />
          </div>

          {/* 2. Anchor Coordinates Manager (Selected custom locations list under the map) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-8">
              <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm transition-colors h-full flex flex-col justify-between" aria-label="Coordinates Manager">
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

            {/* Disclaimer & Information Strip */}
            <div className="lg:col-span-4 flex flex-col justify-between">
              <div className="h-full p-5 bg-rose-50 dark:bg-rose-950/10 border border-rose-200 dark:border-red-500/20 rounded-3xl flex gap-3 text-rose-700 dark:text-red-400 transition-colors">
                <Info className="w-5 h-5 text-rose-600 dark:text-red-500 shrink-0" />
                <p className="text-[10px] font-bold leading-relaxed uppercase tracking-tight">
                  Disclaimer: DAISY is built as secondary informational tracking only. Do not rely solely on DAISY for life-safety choices in critical scenarios.
                </p>
              </div>
            </div>
          </div>

          {/* 3. Observational & Convective Prognostic Telemetry Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Ground Surface: NWS ASOS ground sensors on left */}
            <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-sm transition-colors flex flex-col justify-between" aria-label="NWS Telemetry observations">
              <div>
                <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                  Ground Surface Air Telemetry (NWS ASOS)
                </h3>
                
                {telemetry ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
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
                    </div>

                    {/* Barometric Pressure Trend Recharts Area Chart */}
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
                          <ResponsiveContainer width="100%" height="100%">
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
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Wind Velocity Differential Gauge */}
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
              {telemetry && (
                <div className="flex justify-between items-center text-[8px] font-mono font-semibold text-slate-400 dark:text-slate-600 mt-3 pt-2 border-t border-slate-200 dark:border-slate-800/50">
                  <span>STATION METAR ID: {telemetry.stationId}</span>
                  <span>SYNCED: {telemetry.timestamp || 'STABLE'}</span>
                </div>
              )}
            </section>

            {/* Windy Predictive model: Convective environment analyzer on right */}
            <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-5 shadow-sm transition-colors flex flex-col justify-between" aria-label="Windy Point Convective analysis">
              <div>
                <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-rose-500 dark:text-neon-pink animate-[spin_12s_linear_infinite]" />
                  Convective Environment Prognosis (Windy Point Model)
                </h3>

                {windyPointLoading ? (
                  <div className="h-full flex flex-col justify-center items-center text-center p-8">
                    <Activity className="w-8 h-8 text-rose-500 dark:text-neon-pink animate-pulse mb-3" />
                    <span className="text-[10px] font-mono uppercase font-black tracking-widest text-slate-400">
                      Querying Atmospheric Convective Elements...
                    </span>
                  </div>
                ) : windyPointTelemetry ? (
                  <div className="flex flex-col gap-3.5">
                    {/* CAPE Severe Tornado Potential Analyzer Slider */}
                    <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-2xl transition-colors">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                          Convective Instability (CAPE Index)
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-black border uppercase ${
                          (windyPointTelemetry.cape || 0) > 2500
                            ? 'bg-red-500/10 border-red-500 text-red-500'
                            : (windyPointTelemetry.cape || 0) > 1000
                            ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                            : 'bg-emerald-500/10 border-emerald-500 text-emerald-500'
                        }`}>
                          {windyPointTelemetry.cape || 0} J/kg
                        </span>
                      </div>

                      {/* Continuous Visual Progress Representation */}
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden relative">
                        <div
                          className={`h-full transition-all duration-500 ${
                            (windyPointTelemetry.cape || 0) > 2500
                              ? 'bg-red-600 shadow-[0_0_8px_#dc2626]'
                              : (windyPointTelemetry.cape || 0) > 1000
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, ((windyPointTelemetry.cape || 0) / 3000) * 100)}%` }}
                        ></div>
                      </div>

                      <div className="flex justify-between font-mono text-[7px] text-slate-400 dark:text-slate-600 mt-1 uppercase font-semibold">
                        <span>STABLE (0)</span>
                        <span>SEVERE POTENTIAL (1000)</span>
                        <span>EXTREME TORNADO RISK (2500)</span>
                      </div>
                    </div>

                    {/* Parameter grids */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-2.5 rounded-xl transition-colors">
                        <span className="text-[8px] font-black uppercase text-slate-400 dark:text-slate-500 block leading-none">Model Temp / Dew</span>
                        <span className="text-xs font-black text-slate-800 dark:text-white mt-1.5 block">
                          {windyPointTelemetry.temp ? `${windyPointTelemetry.temp}°F` : 'N/A'}{' '}
                          <span className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold">({windyPointTelemetry.dewpoint || '--'}°)</span>
                        </span>
                      </div>

                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-2.5 rounded-xl transition-colors">
                        <span className="text-[8px] font-black uppercase text-slate-400 dark:text-slate-500 block leading-none">Model Wind / Gusts</span>
                        <span className="text-xs font-black text-slate-800 dark:text-white mt-1.5 block">
                          {windyPointTelemetry.wind ? `${windyPointTelemetry.wind} mph` : 'Calm'}
                          {windyPointTelemetry.gust && (
                            <span className="text-rose-500 dark:text-neon-pink font-bold inline-block ml-1">G: {windyPointTelemetry.gust} mph</span>
                          )}
                        </span>
                      </div>

                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-2.5 rounded-xl transition-colors">
                        <span className="text-[8px] font-black uppercase text-slate-400 dark:text-slate-500 block leading-none">Model Baro Pressure</span>
                        <span className="text-xs font-black text-slate-800 dark:text-white mt-1.5 block">
                          {windyPointTelemetry.pressure ? `${windyPointTelemetry.pressure} InHg` : 'N/A'}
                        </span>
                      </div>

                      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-2.5 rounded-xl transition-colors">
                        <span className="text-[8px] font-black uppercase text-slate-400 dark:text-slate-500 block leading-none">Model Precip Rate</span>
                        <span className="text-xs font-black text-slate-800 dark:text-white mt-1.5 block">
                          {windyPointTelemetry.precip !== undefined ? `${windyPointTelemetry.precip} in/hr` : '0.00 in/hr'}
                        </span>
                      </div>
                    </div>

                    {/* CAPE index Convective available potential energy 6-hour history chart */}
                    <CapeHistoryChart
                      history={capeHistory}
                      currentCape={windyPointTelemetry.cape || 0}
                      loading={windyPointLoading}
                    />
                  </div>
                ) : (
                  <div className="py-8 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 font-mono text-[9px] uppercase text-center rounded-xl flex flex-col items-center justify-center gap-1.5 min-h-[180px]">
                    <span>Model Telemetry ready on Gateway Arming state</span>
                    <span className="text-[8px] text-slate-500">Active model target: ({currentLat.toFixed(3)}, {currentLon.toFixed(3)})</span>
                  </div>
                )}
              </div>

              {windyPointTelemetry && (
                <div className="flex justify-between items-center text-[8px] font-mono font-semibold text-slate-400 dark:text-slate-600 mt-3 pt-2 border-t border-slate-200 dark:border-slate-800/50">
                  <span>FORECAST MODEL: {windyPointTelemetry.modelUsed} High-Res Point</span>
                  <span>COORDINATES TARGET: ({currentLat.toFixed(2)}, {currentLon.toFixed(2)})</span>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Spatial Proximity alerts listings section */}
        <section className="mt-8 flex flex-col gap-4">
          <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white font-sans tracking-wide uppercase flex items-center gap-2">
            <Radio className="w-6 h-6 text-rose-500 dark:text-neon-pink animate-[pulse_1.5s_infinite]" />
            Active Proximity Alerts
          </h2>

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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {alerts.map((alert) => (
                <ThreatCard
                  key={alert.id}
                  alert={alert}
                  hasAssets={assets.length > 0}
                  onViewTrajectory={handleFocusTrajectory}
                  onResolve={handleResolveAlert}
                />
              ))}
            </div>
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
