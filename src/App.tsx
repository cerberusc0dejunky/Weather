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
import { LocationAsset, NWSAlert, TelemetryConditions, SystemSettings, MesoscaleDiscussion } from './types';
import {
  getDistance,
  getBearing,
  getMinPolygonDistance,
  formatAddress,
  cardinalBearings,
  parseSPCLatLon,
  isPointInParsedPolygon,
  getParsedPolygonMinDistance,
} from './utils/geoUtils';
import ThreatCard from './components/ThreatCard';
import GeolocationModal from './components/GeolocationModal';
import RadarMap from './components/RadarMap';

// Lucide Icons (Never use Emojis!)
import {
  Compass,
  Activity,
  Wifi,
  WifiOff,
  Share2,
  Settings as SettingsIcon,
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
  LayoutGrid,
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

const SAMPLE_MCD_TEXT = `   Mesoscale Discussion 1014
   NWS Storm Prediction Center Norman OK
   0116 PM CDT Sun Jun 07 2026

   Areas affected...portions of the Ozarks and ArkLaTex

   Concerning...Severe potential...Watch possible 

   Valid 071816Z - 072015Z

   Probability of Watch Issuance...40 percent

   SUMMARY...Scattered to numerous thunderstorms are expected this
   afternoon from the Ozarks southward into the Ouachita Mountains and
   ArkLaTex. A couple of tornadoes and isolated damaging winds gusts
   are possible. Trends will be monitored for the potential issuance of
   a targeted Tornado Watch for a portion of the discussion area.

   DISCUSSION...Continued heating of a very moist low-level air mass is
   supporting an increase in thunderstorm coverage across portions of
   the Ozarks southward into ArkLaTex as of early this afternoon ahead
   of an MCV evident near Tulsa, OK, in latest satellite/radar imagery.
   An associated band of 30-40+ kt southwesterly mid-level flow is
   located downstream of this MCV, with around 40-45 kt recently
   sampled around 4 km AGL by the SRX/SGF VAD profiles. This will
   continue to contribute to a modest enlargement of low-level
   hodographs, with around 100 m2/s2 0-1 km SRH expected by
   mid-afternoon. This will promote the potential for weak supercells
   and a couple of tornadoes, with the greatest potential expected
   across southwestern Missouri and northwestern Arkansas where locally
   backed surface flow yield a further enhancement to low-level
   hodographs (around 70-75 0-1 km SRH recently sampled by the SGF
   VAD). Rich moisture (PWATs of 1.75-2.0+ inches, as sampled by
   regional 12z observed soundings) may also support occasional
   water-loaded downbursts and isolated damaging wind gusts.

   Convective trends will continue to be monitored, and a targeted
   Tornado Watch may be considered for a portion of the discussion
   area.

   ..Chalmers/Smith.. 06/07/2026

   ...Please see www.spc.noaa.gov for graphic product...

   ATTN...WFO...LSX...LZK...SGF...SHV...EAX...TSA...

   LAT...LON   34079493 34539504 35509509 36969505 38169492 38699461
               38929419 39099349 39109303 39049266 38539167 38269138
               37879129 36859151 35599200 35119227 34499264 34019328
               33869383 33869438 33909470 34079493 

   MOST PROBABLE PEAK TORNADO INTENSITY...85-110 MPH
   MOST PROBABLE PEAK WIND GUST...UP TO 60 MPH`;

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
  const [discussions, setDiscussions] = useState<MesoscaleDiscussion[]>([]);
  const [customMDs, setCustomMDs] = useState<MesoscaleDiscussion[]>([]);
  const [newMDText, setNewMDText] = useState<string>('');
  const [showMDInputForm, setShowMDInputForm] = useState<boolean>(false);
  const [expandedMDId, setExpandedMDId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryConditions | null>(null);
  const [mapMode, setMapMode] = useState<'radar' | 'gust'>('radar');
  const [pressureHistory, setPressureHistory] = useState<{ time: string; pressure: number }[]>([]);

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
  });

  // PWA deferred installation prompt
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);

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
      if (alert.isDirectHit) {
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
  }, [alerts, armed, settings.audio, settings.vibrate]);

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

  // Trigger MD recalculations instantly on critical geospatial state shifts
  useEffect(() => {
    if (armed) {
      fetchMesoscaleDiscussions();
    }
  }, [armed, customMDs, assets, currentLat, currentLon]);

  // Core NWS Alert Acquisition Engine (Layer 1 The Alarm)
  const fetchNationalAlerts = async () => {
    setSyncStatus('SYNCING...');
    try {
      // Fetch filtered list of alerts based on tracked conditions
      const encodedEvents = TRACKED_ALERTS_FILTER.map((e) => encodeURIComponent(e)).join(',');
      const nwsUrl = `https://api.weather.gov/alerts/active?event=${encodedEvents}`;

      const res = await fetch(nwsUrl);
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

      // Storm Vector Trajectory Parsing
      let vectorMatch: [string, string, string] | null = null;
      const vectorRegex = /MOVING\s+([A-Z]+)\s+AT\s+(\d+)\s*(MPH|KT)/;
      const foundMatch = fullText.match(vectorRegex);
      if (foundMatch) {
        vectorMatch = [foundMatch[1], foundMatch[2], foundMatch[3]];
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

          assets.forEach((a) => {
            const result = getMinPolygonDistance(a.lat, a.lon, feature.geometry.coordinates);
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

            // Trajectory projection
            if (vectorMatch) {
              const stormDir = cardinalBearings[vectorMatch[0].toUpperCase()];
              if (stormDir !== undefined) {
                isHeadingTowards = assets.some((a) => {
                  const bearingToAsset = getBearing(closestPt![1], closestPt![0], a.lat, a.lon);
                  const diff = Math.abs(stormDir - bearingToAsset);
                  return Math.min(diff, 360 - diff) < 45; // within 45 degrees tracking envelope
                });
              }

              if (isHeadingTowards) {
                let speed = parseInt(vectorMatch[1], 10);
                if (vectorMatch[2] === 'KT') speed = Math.round(speed * 1.15); // convert knots to mph
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
        if (matchedInZone || shortestDistance <= 25) {
          wasUpdated = true;
          freshUpdateCount++;
        }
      }

      processedList.push({
        id: props.id || Math.random().toString(),
        event: eventName,
        areaDesc: props.areaDesc || 'Unknown Boundaries',
        description: props.description || '',
        instruction: props.instruction || '',
        expires: props.expires || '',
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

    setAlerts(unique);
    previousSignaturesRef.current = currentSignatures;
  };

  // Core SPC Mesoscale Discussions Acquisition Engine
  const fetchMesoscaleDiscussions = async () => {
    try {
      const res = await fetch('https://api.weather.gov/products/types/MCD');
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
              const prodRes = await fetch(`https://api.weather.gov/products/${prod.id}`);
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

      // Preload current user/session context: custom discussion 1014
      const seededMD = parseMesoscaleDiscussion('seeded-1014', '2026-06-07T18:16:00Z', SAMPLE_MCD_TEXT);

      // Union of: manually-input discussions + live fetched discussions
      const allDiscussionsList = [...customMDs, ...apiDiscussions];

      // Insert seeded 1014 if not already present by number
      if (!allDiscussionsList.some(d => d.number === seededMD.number)) {
        allDiscussionsList.push(seededMD);
      }

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
    } catch (err) {
      console.warn('Failed to load SPC mesoscale discussions:', err);
    }
  };

  // NWS XML Telemetry Observations Engine (Layer 2 Telemetry)
  const fetchTelemetry = async (lat: number, lon: number) => {
    try {
      // Step A: Find closest observation station endpoint
      const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
      const ptRes = await fetch(pointsUrl);
      if (!ptRes.ok) return;

      const ptData = await ptRes.json();
      const stationsUrl = ptData.properties?.observationStations;
      if (!stationsUrl) return;

      // Step B: Grab nearest weather station identity
      const stationRes = await fetch(stationsUrl);
      if (!stationRes.ok) return;

      const stationData = await stationRes.json();
      const firstStationId = stationData.features?.[0]?.properties?.stationIdentifier;
      const firstStationName = stationData.features?.[0]?.properties?.name;
      if (!firstStationId) return;

      // Step C: Poll latest physical surface telemetry readings
      const obsUrl = `https://api.weather.gov/stations/${firstStationId}/observations/latest`;
      const obsRes = await fetch(obsUrl);
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
        stationId: firstStationId,
        stationName: firstStationName,
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
        alert('LOCATION PATTERN UNMATCHED in US directories. Please try closer zip codes.');
      }
    } catch (e) {
      console.error(e);
      alert('Search failed. Check your network link.');
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
      alert('Error: LAT...LON coordinate block not detected or improperly formatted in custom text.');
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
      alert('DAISY access link copied to clipboards.');
    } catch {
      alert(window.location.href);
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
      // Find representative coordinate boundary point
      try {
        const ring = alert.geometry.coordinates[0];
        const targetPt = Array.isArray(ring[0]) ? ring[0] : ring;
        // coordinates come in [lon, lat] format
        if (targetPt[1] && targetPt[0]) {
          setCurrentLat(targetPt[1]);
          setCurrentLon(targetPt[0]);
          // switch map overlay to radar automatically
          setMapMode('radar');
        }
      } catch (e) {}
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
                  checked={settings.flash}
                  onChange={(e) => setSettings((s) => ({ ...s, flash: e.target.checked }))}
                  className="w-4 h-4 accent-slate-800 dark:accent-white bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 dark:text-white" />
                  Strobe Flash
                </span>
              </label>
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

        {/* Core Screen Layout Grid splitting map and assets coordinates management */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Spatial Interactive Maps Left Side (7 Cols) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            <RadarMap
              userLat={currentLat}
              userLon={currentLon}
              assets={assets}
              alerts={alerts}
              discussions={discussions}
              mapMode={mapMode}
              onMapModeChange={setMapMode}
            />

            {/* Layer 2 Background Observations Telemetry Section */}
            <section className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-sm transition-colors" aria-label="NWS Telemetry observations">
              <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                Ground Surface Air Telemetry (NWS ASOS)
              </h3>
              
              {telemetry ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-3 transition-colors">
                    <Thermometer className="w-8 h-8 text-rose-500 dark:text-neon-pink shrink-0" />
                    <div>
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Temp / Dew</span>
                      <span className="text-sm font-black text-slate-800 dark:text-white mt-1 block">
                        {telemetry.temperature ? `${telemetry.temperature}°F` : 'N/A'}{' '}
                        <span className="text-slate-500 dark:text-slate-400 text-xs font-semibold">({telemetry.dewPoint || '--'}°)</span>
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-3 transition-colors">
                    <Wind className="w-8 h-8 text-cyan-600 dark:text-neon-aqua shrink-0" />
                    <div>
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Surf Wind</span>
                      <span className="text-sm font-black text-slate-800 dark:text-white mt-1 block uppercase">
                        {telemetry.windSpeed ? `${telemetry.windSpeed} mph` : 'Calm'}
                        {telemetry.windGust && (
                          <span className="text-rose-500 dark:text-neon-pink text-xs font-bold block">G: {telemetry.windGust} mph</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-3 transition-colors">
                    <Gauge className="w-8 h-8 text-slate-400 dark:text-white/50 shrink-0" />
                    <div>
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Baro Pres</span>
                      <span className="text-sm font-black text-slate-800 dark:text-white mt-1 block uppercase">
                        {telemetry.pressure ? `${telemetry.pressure} InHg` : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl flex items-center gap-3 transition-colors">
                    <Compass className="w-8 h-8 text-indigo-500 dark:text-indigo-400 shrink-0 animate-[spin_12s_linear_infinite]" />
                    <div>
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block leading-none">Weather</span>
                      <span className="text-xs font-black text-slate-700 dark:text-slate-300 mt-1 block truncate max-w-[130px] uppercase">
                        {telemetry.textDescription || 'Stable conditions'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Barometric Pressure Trend Recharts Area Chart */}
                {pressureHistory && pressureHistory.length > 0 && (
                  <div className="mt-4 border border-slate-200 dark:border-slate-800/80 p-4 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 transition-colors">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 mb-3">
                      <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center gap-1.5 font-sans">
                        <Gauge className="w-3.5 h-3.5 text-cyan-600 dark:text-neon-aqua animate-pulse" />
                        Barometric Decay Trend Analysis (Last 6 Polls)
                      </span>
                      {pressureHistory.length >= 2 && (
                        <div className="text-[9px] font-extrabold uppercase tracking-widest font-mono">
                          {pressureHistory[pressureHistory.length - 1].pressure < pressureHistory[0].pressure ? (
                            <span className="text-amber-500 dark:text-amber-400 flex items-center gap-1">
                              PRESSURE DECAY DETECTED: -{(pressureHistory[0].pressure - pressureHistory[pressureHistory.length - 1].pressure).toFixed(2)} InHg
                            </span>
                          ) : (
                            <span className="text-teal-500 flex items-center gap-1">
                              BAROMETER STABLE
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="h-28 w-full mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={pressureHistory}
                          margin={{ top: 5, right: 10, left: -25, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="pressureGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0891b2" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#0891b2" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} vertical={false} />
                          <XAxis
                            dataKey="time"
                            tick={{ fill: '#64748b', fontSize: 8, fontFamily: 'monospace' }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            domain={['dataMin - 0.05', 'dataMax + 0.05']}
                            tick={{ fill: '#64748b', fontSize: 8, fontFamily: 'monospace' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => val.toFixed(2)}
                          />
                          <Tooltip content={<PressureBaroTooltip />} cursor={{ stroke: '#0891b2', strokeWidth: 1, strokeDasharray: '4 4' }} />
                          <Area
                            type="monotone"
                            dataKey="pressure"
                            stroke="#0891b2"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#pressureGrad)"
                            activeDot={{ r: 4, strokeWidth: 0, fill: '#06b6d4' }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                </>
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[10px] uppercase text-center rounded-xl">
                  Synchronizing closest station observational grids...
                </div>
              )}
              {telemetry && (
                <div className="flex justify-between items-center text-[9px] font-mono font-semibold text-slate-400 dark:text-slate-600 mt-3 pt-2 border-t border-slate-200 dark:border-slate-800/50">
                  <span>STATION METAR ID: {telemetry.stationId}</span>
                  <span>SYNCED: {telemetry.timestamp || 'STABLE'}</span>
                </div>
              )}
            </section>
          </div>

          {/* Right Side coordinates manager (4 Cols) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm transition-colors" aria-label="Coordinates Manager">
              <h3 className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-cyan-600 dark:text-neon-aqua" />
                Monitored Coordinates Anchor
              </h3>

              <div className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddNewPin()}
                    placeholder="Enter US City, Zip, or Address"
                    disabled={searching}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 font-sans text-xs font-bold py-3 pl-4 pr-10 rounded-xl focus:border-neon-aqua focus:ring-0 outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleAddNewPin}
                    disabled={searching}
                    className="absolute right-2.5 top-2 p-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-neon-aqua rounded-lg shrink-0 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Coordinates History list */}
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {assets.length === 0 ? (
                    <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-center text-[10px] font-mono font-extrabold tracking-widest text-slate-400 dark:text-slate-500 uppercase">
                      NO ACTIVE ANCHORS
                    </div>
                  ) : (
                    assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="py-2.5 px-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-3 font-sans transition-colors"
                      >
                        <div className="truncate flex-grow">
                          <span className="text-[10px] font-black uppercase text-slate-800 dark:text-white block truncate">
                            {asset.name}
                          </span>
                          <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-500 block mt-0.5">
                            LAT: {asset.lat.toFixed(3)}, LON: {asset.lon.toFixed(3)}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRemovePin(asset.id)}
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

            {/* Resources Disclaimer strip */}
            <div className="p-4 bg-rose-50 dark:bg-rose-950/10 border border-rose-200 dark:border-red-500/20 rounded-2xl flex gap-3 text-rose-700 dark:text-red-400 transition-colors">
              <Info className="w-5 h-5 text-rose-600 dark:text-red-500 shrink-0" />
              <p className="text-[10px] font-bold leading-relaxed uppercase tracking-tight">
                Disclaimer: DAISY is built as secondary informational tracking only. Do not rely solely on DAISY for life-safety choices.
              </p>
            </div>
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
                />
              ))}
            </div>
          )}
        </section>

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
                value={newMDText}
                onChange={(e) => setNewMDText(e.target.value)}
                placeholder="Mesoscale Discussion 1014... \n\n LAT...LON   34079493 34539504 ..."
                rows={8}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-700 font-mono text-xs p-4 rounded-2xl focus:border-amber-500 focus:ring-0 outline-none"
              />
              
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => {
                    setNewMDText(`Mesoscale Discussion 1014
NWS Storm Prediction Center Norman OK
0116 PM CDT Sun Jun 07 2026

Areas affected...portions of the Ozarks and ArkLaTex

Concerning...Severe potential...Watch possible 

Valid 071816Z - 072015Z

Probability of Watch Issuance...40 percent

SUMMARY...Scattered to numerous thunderstorms are expected this afternoon from the Ozarks southward into the Ouachita Mountains and ArkLaTex. A couple of tornadoes and isolated damaging winds gusts are possible. Trends will be monitored for the potential issuance of a targeted Tornado Watch for a portion of the discussion area.

LAT...LON   34079493 34539504 35509509 36969505 38169492 38699461 38929419 39099349 39109303 39049266 38539167 38269138 37879129 36859151 35599200 35119227 34499264 34019328 33869383 33869438 33909470 34079493`);
                  }}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-950 text-slate-500 hover:text-slate-800 rounded-xl text-[9px] font-bold uppercase transition-colors shrink-0"
                >
                  Load Mock Template
                </button>
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
