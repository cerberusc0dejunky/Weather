export interface LocationAsset {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface AlertKeywords {
  rotation: boolean;
  funnel: boolean;
  observed: boolean;
  possible: boolean;
  emergency: boolean;
  destructive: boolean;
  vector: [string, string, string] | null; // [dir, speed, unit]
}

export interface NWSAlert {
  id: string;
  event: string;
  areaDesc: string;
  description: string;
  instruction: string;
  expires: string;
  sent?: string;
  geometry?: {
    type: string;
    coordinates: any;
  } | null;
  minDist: number; // in miles to nearest polygon edge (or centroid if no polygon), 999 if unset
  centroidDist?: number; // in miles to storm polygon core/centroid
  centroidDir?: string; // cardinal direction from user to storm core (e.g. "WSW")
  edgeDir?: string; // cardinal direction from user to nearest polygon edge
  closestAssetName?: string; // name of user anchor closest to the storm
  radarLocationHeadline?: string; // NWS "At 715 PM CDT, a tornado/thunderstorm was located..."
  impactedLocations?: string; // NWS "Locations impacted include..." and highway mile markers
  maxWindHailTag?: string; // NWS bottom tags e.g. "MAX WIND: 70 MPH • MAX HAIL: 1.75 IN"
  stormCoreAddress?: string; // Free OSM Nominatim reverse-geocoded road/locality at storm core
  stormCoreLat?: number; // Exact NWS TIME...MOT...LOC Doppler radar fix latitude (or polygon centroid fallback)
  stormCoreLon?: number; // Exact NWS TIME...MOT...LOC Doppler radar fix longitude (or polygon centroid fallback)
  isRadarPinpoint?: boolean; // True when stormCoreLat/Lon came from exact NWS TIME...MOT...LOC Doppler radar fix
  isDirectHit: boolean;
  headedTowards: boolean;
  etaMinutes?: number;
  snippet: string;
  keywords: AlertKeywords;
  justUpdated: boolean;
  threatLevel: 'Low' | 'Moderate' | 'High' | 'Extreme';
  // Advanced Internal Prediction properties
  predictedTornadoConfidence?: number; // 0 to 100% confidence
  strongSupercellUpdraft?: boolean; // Hail size > 2.0 inches
  tornadoDamageThreatOnGround?: boolean; // Considerable or Catastrophic damage threats
  polygonCentroidShiftVector?: { dir: string; speed: number; bearing: number } | null;
  convectiveIntensificationDetected?: boolean; // CAPE or SRH instability intersection
  velocityCoupletPersistentShear?: boolean; // Radar shear signature
  hookEchoEvolutionDetected?: boolean; // Reflectivity hook-echo shape
  tornadoDebrisSignatureTDS?: boolean; // Dual-pol TDS signature
  soundingScenarioSummary?: string; // Step 4 composite MD + sounding verification note
}

export interface TelemetryConditions {
  stationId?: string;
  stationName?: string;
  temperature?: string; // in F
  dewPoint?: string;
  windSpeed?: string;
  windGust?: string;
  windDirection?: string;
  pressure?: string; // in inHg
  textDescription?: string;
  timestamp?: string;
  highTemp?: string;
  lowTemp?: string;
  probPrecip?: string;
}

export interface SystemSettings {
  audio: boolean;
  vibrate: boolean;
  flash: boolean;
  monitorRadius: number;
  highContrast?: boolean;
  browserAlerts?: boolean;
}

export interface MesoscaleDiscussion {
  id: string;
  number: string;
  issuanceTime: string;
  areasAffected: string;
  concerning: string;
  validTime: string;
  validStartMs?: number | null;
  validEndMs?: number | null;
  isTemporallyActive?: boolean;
  probability: number;
  threatTypes?: {
    tornado: boolean;
    wind: boolean;
    hail: boolean;
  };
  qualitativeSeverity?: 'PDS' | 'STRONG_TORNADO' | 'CONDITIONAL' | 'STANDARD';
  summary: string;
  text: string;
  coordinates: { lat: number; lon: number }[];
  centroid?: { lat: number; lon: number } | null;
  watchBox?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  } | null;
  wfoList?: string[];
  peakTornadoIntensity?: string;
  peakWindGust?: string;
  peakHailSize?: string;
  isIntersecting: boolean;
  minDist: number;
}

export interface ConvectiveSoundingMetrics {
  sbcape: number; // J/kg
  cin: number; // J/kg (convective inhibition magnitude, >= 0)
  lclMeters: number; // Lifted Condensation Level height (m AGL)
  srh01km: number; // 0-1 km Storm-Relative Helicity (m^2/s^2)
  bulkShear06kmMph: number; // 0-6 km Bulk Wind Shear (mph)
  stp: number; // Significant Tornado Parameter (composite index)
  updatedAt: string;
}

export type TornadicRegimeScenario =
  | 'HIGH_CONFIDENCE_TORNADO'
  | 'CONDITIONAL_CAPPED'
  | 'WIND_HAIL_DOMINATED'
  | 'SUB_SEVERE';

export interface CompositeThreatEvaluation {
  threatScore: number; // 0 - 100 weighted heuristic score
  scenario: TornadicRegimeScenario;
  scenarioLabel: string;
  scenarioReasoning: string;
  activeMdNumber: string | null;
  activeMdWatchProb: number;
  activeMdTemporallyValid: boolean;
  activeMdInsidePolygon: boolean;
  stpScore: number;
  srhScore: number;
  suppressTornadoWarning: boolean;
  elevateTornadoAlert: boolean;
}

export interface RotationPin {
  id: string;
  lat: number;
  lon: number;
  alertId: string;
  eventName: string;
  areaDesc: string;
  detectedAt: string;
  pinType?: 'vortex' | 'radar_indicated' | 'mesocyclone';
  threatLevel?: 'Normal' | 'Severe' | 'Extreme';
  isObserved?: boolean;
}

export interface NetworkRequestLog {
  id: string;
  timestamp: string;
  service: 'Windy' | 'NWS';
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  error?: string;
  suggestedAction?: string;
}
