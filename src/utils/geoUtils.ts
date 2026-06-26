export function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of Earth in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const cardinalBearings: Record<string, number> = {
  N: 0,
  NORTH: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  EAST: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SOUTH: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WEST: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

function isLeft(x1: number, y1: number, x2: number, y2: number, px: number, py: number): number {
  return (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
}

export function isPointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let wn = 0; // Winding number counter

  for (let i = 0; i < polygon.length; i++) {
    const nextIdx = (i + 1) % polygon.length;
    const x1 = polygon[i][0]; // lon
    const y1 = polygon[i][1]; // lat
    const x2 = polygon[nextIdx][0]; // lon
    const y2 = polygon[nextIdx][1]; // lat

    if (y1 <= lat) {
      if (y2 > lat) { // Upward crossing
        if (isLeft(x1, y1, x2, y2, lon, lat) > 0) {
          wn++;
        }
      }
    } else {
      if (y2 <= lat) { // Downward crossing
        if (isLeft(x1, y1, x2, y2, lon, lat) < 0) {
          wn--;
        }
      }
    }
  }
  return wn !== 0;
}

export function getMinPolygonDistance(
  assetLat: number,
  assetLon: number,
  geometryCoordinates: any
): { minDist: number; closestPt: [number, number] | null; isInside: boolean } {
  let minDist = 9999;
  let closestPt: [number, number] | null = null;
  let isInside = false;

  function traverse(arr: any) {
    if (!Array.isArray(arr)) return;

    if (
      arr.length >= 2 &&
      typeof arr[0] === 'number' &&
      typeof arr[1] === 'number'
    ) {
      // longitude is index 0, latitude is index 1
      const d = getDistance(assetLat, assetLon, arr[1], arr[0]);
      if (d < minDist) {
        minDist = d;
        closestPt = [arr[0], arr[1]];
      }
    } else {
      if (Array.isArray(arr[0]) && typeof arr[0][0] === 'number') {
        const ring: [number, number][] = arr.map((pt: any) => [pt[0], pt[1]]);
        if (isPointInPolygon(assetLat, assetLon, ring)) {
          isInside = true;
        }
      }
      for (let i = 0; i < arr.length; i++) {
        traverse(arr[i]);
      }
    }
  }

  traverse(geometryCoordinates);
  return { minDist, closestPt, isInside };
}

interface MemoizedPolygonDistanceResult {
  minDist: number;
  closestPt: [number, number] | null;
  isInside: boolean;
}

const polygonDistanceCache = new Map<string, MemoizedPolygonDistanceResult>();

export function getMemoizedMinPolygonDistance(
  assetId: string,
  assetLat: number,
  assetLon: number,
  alertId: string,
  geometryCoordinates: any
): MemoizedPolygonDistanceResult {
  if (!alertId) {
    return getMinPolygonDistance(assetLat, assetLon, geometryCoordinates);
  }
  
  const cacheKey = `${alertId}_${assetId}_${assetLat.toFixed(5)}_${assetLon.toFixed(5)}`;
  
  if (polygonDistanceCache.has(cacheKey)) {
    return polygonDistanceCache.get(cacheKey)!;
  }

  const result = getMinPolygonDistance(assetLat, assetLon, geometryCoordinates);
  
  // Guard memory growth: prune-on-overflow simple check
  if (polygonDistanceCache.size > 2000) {
    polygonDistanceCache.clear();
  }
  
  polygonDistanceCache.set(cacheKey, result);
  return result;
}

export function getGeometryCentroid(geometryCoordinates: any): { lat: number; lon: number } | null {
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;

  function traverse(arr: any) {
    if (!Array.isArray(arr)) return;

    if (
      arr.length >= 2 &&
      typeof arr[0] === 'number' &&
      typeof arr[1] === 'number'
    ) {
      sumLon += arr[0];
      sumLat += arr[1];
      count++;
    } else {
      for (let i = 0; i < arr.length; i++) {
        traverse(arr[i]);
      }
    }
  }

  traverse(geometryCoordinates);
  if (count > 0) {
    return { lat: sumLat / count, lon: sumLon / count };
  }
  return null;
}

export const usStatesAbbr: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'District of Columbia': 'DC',
};

export function formatAddress(addr: any, fallback: string): string {
  if (!addr) return fallback.toUpperCase();
  const city = addr.city || addr.town || addr.village || addr.municipality || '';
  const state = addr.state ? (usStatesAbbr[addr.state] || addr.state.toUpperCase()) : '';

  if (city) {
    return `${city}${state ? ', ' + state : ''}`.toUpperCase();
  }
  if (addr.county) {
    return `${addr.county.replace(/ County/i, '')}${state ? ', ' + state : ''}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

export function parseSPCLatLon(text: string): { lat: number; lon: number }[] {
  const coordinates: { lat: number; lon: number }[] = [];
  const lines = text.split('\n');
  let inLineBlock = false;
  let blockText = '';
  
  for (const line of lines) {
    if (line.includes('LAT...LON')) {
      inLineBlock = true;
      blockText += line.replace('LAT...LON', '') + ' ';
    } else if (inLineBlock) {
      if (line.trim() === '' || (!/^\s*\d+/.test(line) && !line.includes('...'))) {
        inLineBlock = false;
      } else {
        blockText += line + ' ';
      }
    }
  }
  
  const matches = blockText.match(/\b\d{8}\b/g) || [];
  
  for (const match of matches) {
    const latStr = match.substring(0, 4);
    const lonStr = match.substring(4, 8);
    
    let lat = parseInt(latStr, 10) / 100;
    let lon = parseInt(lonStr, 10) / 100;
    
    if (lon < 50) {
      lon += 100;
    }
    
    lon = -lon;
    coordinates.push({ lat, lon });
  }
  
  return coordinates;
}

export function isPointInParsedPolygon(lat: number, lon: number, polygon: { lat: number; lon: number }[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let wn = 0; // Winding number counter

  for (let i = 0; i < polygon.length; i++) {
    const nextIdx = (i + 1) % polygon.length;
    const x1 = polygon[i].lon;
    const y1 = polygon[i].lat;
    const x2 = polygon[nextIdx].lon;
    const y2 = polygon[nextIdx].lat;

    if (y1 <= lat) {
      if (y2 > lat) { // Upward crossing
        if (isLeft(x1, y1, x2, y2, lon, lat) > 0) {
          wn++;
        }
      }
    } else {
      if (y2 <= lat) { // Downward crossing
        if (isLeft(x1, y1, x2, y2, lon, lat) < 0) {
          wn--;
        }
      }
    }
  }
  return wn !== 0;
}

export function getParsedPolygonMinDistance(
  assetLat: number,
  assetLon: number,
  polygon: { lat: number; lon: number }[]
): { minDist: number; isInside: boolean } {
  let minDist = 9999;
  
  if (polygon.length === 0) return { minDist, isInside: false };
  
  const isInside = isPointInParsedPolygon(assetLat, assetLon, polygon);
  if (isInside) {
    return { minDist: 0, isInside: true };
  }
  
  for (const pt of polygon) {
    const d = getDistance(assetLat, assetLon, pt.lat, pt.lon);
    if (d < minDist) {
      minDist = d;
    }
  }
  
  return { minDist, isInside: false };
}

export interface StormTrajectory {
  direction: string | null;
  speed: number | null;
  unit: string | null;
  hasTrajectory: boolean;
}

/**
 * Parses the NWS alert text to extract storm motion vectors safely.
 * Only enforces warnings on event types known to carry tracking vectors.
 */
export function parseStormTrajectory(
  eventName: string,
  fullText: string
): StormTrajectory {
  const text = fullText || "";
  const eventType = eventName || "";

  // Define convective events where a tracking vector is expected
  const vectorExpectedEvents = [
    "Tornado Warning",
    "Severe Thunderstorm Warning",
    "Special Marine Warning",
    "Flash Flood Warning" ,
  ];

  // Standard NWS vector pattern match (e.g., "MOVING NORTHEAST AT 35 MPH") supporting hyphenated directions and knots
  const vectorRegex = /MOVING\s+(?:TO\s+THE\s+)?([0-9A-Z-\s]+?)\s+AT\s+(\d+)\s*(MPH|KT|KTS|KNOTS|KNOT)/i;
  const match = text.match(vectorRegex);

  if (match) {
    return {
      direction: match[1].toUpperCase(),
      speed: parseInt(match[2], 10),
      unit: match[3].toUpperCase(),
      hasTrajectory: true
    };
  }

  // If no match is found, check if we actually expected one for this event type
  const isConvectiveWarning = vectorExpectedEvents.some(evt => 
    eventType.toLowerCase().includes(evt.toLowerCase())
  );

  if (isConvectiveWarning) {
    // Only log an actual tracking failure if the event type is supposed to have a vector
    console.warn(
      `[NWS TRAJECTORY PARSING FAIL] Expected vector pattern but failed to match regex. ` +
      `Event: "${eventType}". Substring context: "${text.substring(0, 60).replace(/\n/g, ' ')}..."`
    );
  }

  // Return clean fallback state for watches, fire advisories, and statements
  return {
    direction: null,
    speed: null,
    unit: null,
    hasTrajectory: false
  };
}


