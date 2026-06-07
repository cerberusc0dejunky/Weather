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
}

export interface SystemSettings {
  audio: boolean;
  vibrate: boolean;
  flash: boolean;
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

