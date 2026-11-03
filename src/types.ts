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
  stormCoreAddress?: string; // Free OSM Nominatim reverse-geocoded road/locality at storm centroid
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
  telemetryDebug?: boolean;
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
  probability: number;
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

export interface CorrelationMetricRecord {
  recordId: string;
  capturedAt: string;
  triggerType: 'ROTATION_DETECTED' | 'MESOSCALE_CORRELATION_SAMPLE' | 'TORNADO_WARNING_ACTIVE';
  // Storm & Rotation Metrics (Strictly Storm Polygon Coordinates - Zero User PII)
  alertId: string;
  event: string;
  rotationType: 'vortex' | 'radar_indicated' | 'mesocyclone' | 'none';
  threatLevel: string;
  stormCentroidLat: number | null;
  stormCentroidLon: number | null;
  stormAreaDesc: string;
  stormVectorDir: string | null;
  stormVectorSpeedMph: number | null;
  polygonShiftDir: string | null;
  polygonShiftSpeedMph: number | null;
  predictedTornadoConfidence: number;
  hasTDS: boolean;
  hasObservedTornado: boolean;
  hasVelocityCouplet: boolean;
  hasHookEcho: boolean;
  hasSupercellHailUpdraft: boolean;
  hasConvectiveIntensification: boolean;
  isPDSOrEmergency: boolean;
  // Public NWS ASOS Surface Station Telemetry
  asosStationId: string;
  asosStationName: string;
  temperatureF: string;
  dewPointF: string;
  barometricPressureInHg: string;
  pressureDelta6PollInHg: number;
  pressureTrend: string;
  windSpeedMph: string;
  windGustMph: string;
  windDirectionDeg: string;
  precipProbPct: string;
  // Convective Instability & Bypass Metrics
  currentCapeJkg: number;
  max6HrCapeJkg: number;
  capeTrend: string;
  stormBypassChance: string;
  environmentStatus: string;
  // Correlated SPC Mesoscale Discussion (MCD) Metrics
  correlatedMcdNumber: string | null;
  mcdWatchProbabilityPct: number | null;
  mcdConcerning: string | null;
  mcdAreasAffected: string | null;
  mcdCentroidLat: number | null;
  mcdCentroidLon: number | null;
  mcdWatchBox: string | null;
  mcdPolygonCoordinates: string | null;
  mcdPeakTornadoMph: string | null;
  mcdPeakWindMph: string | null;
  mcdPeakHailIn: string | null;
  mcdTargetedWFOs: string | null;
  isRotationInsideMcdCorridor: boolean;
}


