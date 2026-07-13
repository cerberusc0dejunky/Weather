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
  minDist: number; // in miles, 999 if unset/uncalculated
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

export interface StormChaserProfile {
  email: string;
  isVerified: boolean;
  tags: string[]; // e.g., ['stormchaser']
}

export interface ChaserReport {
  id: string;
  reporterEmail: string;
  timestamp: string;
  lat: number;
  lon: number;
  wallCloud: boolean;
  rotationVisible: boolean; // Ground-truth for velocityCoupletPersistentShear
  tornadoOnGround: boolean; // Ground-truth for tornadoDebrisSignatureTDS
  windGustMph?: number;
  hailSizeInches?: number;
  notes?: string;
}
