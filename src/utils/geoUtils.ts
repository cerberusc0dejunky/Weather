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

function getClosestPointOnSegment(
  lat: number,
  lon: number,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { dist: number; pt: [number, number] } {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dx = (lon2 - lon1) * cosLat;
  const dy = lat2 - lat1;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = (((lon - lon1) * cosLat) * dx + (lat - lat1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const projLon = lon1 + t * (lon2 - lon1);
  const projLat = lat1 + t * (lat2 - lat1);
  return {
    dist: getDistance(lat, lon, projLat, projLon),
    pt: [projLon, projLat],
  };
}

export function getMinPolygonDistance(
  assetLat: number,
  assetLon: number,
  geometryCoordinates: any
): { minDist: number; closestPt: [number, number] | null; isInside: boolean } {
  let minDist = 9999;
  let closestPt: [number, number] | null = null;
  let isInside = false;

  const isRing = (arr: any): boolean =>
    Array.isArray(arr) &&
    arr.length > 0 &&
    Array.isArray(arr[0]) &&
    typeof arr[0][0] === 'number' &&
    typeof arr[0][1] === 'number';

  const isPolygonCoords = (arr: any): boolean =>
    Array.isArray(arr) && arr.length > 0 && isRing(arr[0]);

  function evaluateRingSegments(ringRaw: any[]) {
    const ring: [number, number][] = ringRaw.map((pt: any) => [pt[0], pt[1]]);
    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % ring.length];
      const { dist, pt } = getClosestPointOnSegment(
        assetLat,
        assetLon,
        p1[1],
        p1[0],
        p2[1],
        p2[0]
      );
      if (dist < minDist) {
        minDist = dist;
        closestPt = pt;
      }
    }
  }

  function evaluatePolygon(rings: any[]) {
    if (!rings || rings.length === 0) return;
    const outerRing: [number, number][] = rings[0].map((pt: any) => [pt[0], pt[1]]);
    let inPoly = isPointInPolygon(assetLat, assetLon, outerRing);

    // If inside the outer ring, ensure the point is not inside an interior hole ring
    if (inPoly && rings.length > 1) {
      for (let h = 1; h < rings.length; h++) {
        if (isRing(rings[h])) {
          const holeRing: [number, number][] = rings[h].map((pt: any) => [pt[0], pt[1]]);
          if (isPointInPolygon(assetLat, assetLon, holeRing)) {
            inPoly = false;
            break;
          }
        }
      }
    }

    if (inPoly) {
      isInside = true;
    }

    for (let r = 0; r < rings.length; r++) {
      if (isRing(rings[r])) {
        evaluateRingSegments(rings[r]);
      }
    }
  }

  function traverse(arr: any) {
    if (!Array.isArray(arr) || arr.length === 0) return;

    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
      const d = getDistance(assetLat, assetLon, arr[1], arr[0]);
      if (d < minDist) {
        minDist = d;
        closestPt = [arr[0], arr[1]];
      }
      return;
    }

    if (isRing(arr)) {
      const ring: [number, number][] = arr.map((pt: any) => [pt[0], pt[1]]);
      if (isPointInPolygon(assetLat, assetLon, ring)) {
        isInside = true;
      }
      evaluateRingSegments(arr);
      return;
    }

    if (isPolygonCoords(arr)) {
      evaluatePolygon(arr);
      return;
    }

    for (let i = 0; i < arr.length; i++) {
      traverse(arr[i]);
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
  let totalWeightedLat = 0;
  let totalWeightedLon = 0;
  let totalArea = 0;

  let fallbackSumLat = 0;
  let fallbackSumLon = 0;
  let fallbackCount = 0;

  const isRing = (arr: any): boolean =>
    Array.isArray(arr) &&
    arr.length > 0 &&
    Array.isArray(arr[0]) &&
    typeof arr[0][0] === 'number' &&
    typeof arr[0][1] === 'number';

  function processRing(ring: [number, number][]) {
    if (ring.length === 0) return;

    // Exclude duplicate GeoJSON closing vertex for unique vertex fallback average
    const uniqueLen =
      ring.length > 1 &&
      Math.abs(ring[0][0] - ring[ring.length - 1][0]) < 1e-7 &&
      Math.abs(ring[0][1] - ring[ring.length - 1][1]) < 1e-7
        ? ring.length - 1
        : ring.length;

    for (let i = 0; i < uniqueLen; i++) {
      fallbackSumLon += ring[i][0];
      fallbackSumLat += ring[i][1];
      fallbackCount++;
    }

    if (uniqueLen < 3) return;

    // Shoelace formula for true geometric centroid of the polygon ring
    // Use first vertex as local origin to preserve floating-point precision
    const originLon = ring[0][0];
    const originLat = ring[0][1];
    let signedArea2 = 0;
    let cxAcc = 0;
    let cyAcc = 0;

    for (let i = 0; i < uniqueLen; i++) {
      const x0 = ring[i][0] - originLon;
      const y0 = ring[i][1] - originLat;
      const next = ring[(i + 1) % uniqueLen];
      const x1 = next[0] - originLon;
      const y1 = next[1] - originLat;

      const cross = x0 * y1 - x1 * y0;
      signedArea2 += cross;
      cxAcc += (x0 + x1) * cross;
      cyAcc += (y0 + y1) * cross;
    }

    const ringArea = Math.abs(signedArea2) / 2;
    if (ringArea > 1e-9) {
      const cx = originLon + cxAcc / (3 * signedArea2);
      const cy = originLat + cyAcc / (3 * signedArea2);
      totalWeightedLon += cx * ringArea;
      totalWeightedLat += cy * ringArea;
      totalArea += ringArea;
    }
  }

  function traverse(arr: any) {
    if (!Array.isArray(arr) || arr.length === 0) return;

    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
      fallbackSumLon += arr[0];
      fallbackSumLat += arr[1];
      fallbackCount++;
      return;
    }

    if (isRing(arr)) {
      processRing(arr as [number, number][]);
      return;
    }

    for (let i = 0; i < arr.length; i++) {
      traverse(arr[i]);
    }
  }

  traverse(geometryCoordinates);

  if (totalArea > 1e-9) {
    return {
      lat: totalWeightedLat / totalArea,
      lon: totalWeightedLon / totalArea,
    };
  }

  if (fallbackCount > 0) {
    return { lat: fallbackSumLat / fallbackCount, lon: fallbackSumLon / fallbackCount };
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
  const county = addr.county ? addr.county.replace(/ County| Parish/i, '').trim() : '';
  const state = addr.state ? (usStatesAbbr[addr.state] || addr.state.toUpperCase()) : '';

  if (city) {
    const countySuffix = county && county.toLowerCase() !== city.toLowerCase() ? ` (${county})` : '';
    return `${city}${countySuffix}${state ? ', ' + state : ''}`.toUpperCase();
  }
  if (county) {
    return `${county}${state ? ', ' + state : ''}`.toUpperCase();
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
    
    const lat = parseInt(latStr, 10) / 100;
    let lon = parseInt(lonStr, 10) / 100;
    
    // SPC 8-digit LAT...LON format omits the leading '1' for longitudes >= 100.00°W (00.00 to 59.99)
    if (lon < 60) {
      lon += 100;
    }
    
    lon = -lon;
    coordinates.push({ lat, lon });
  }

  // Strip duplicate closing vertex if SPC repeated the first point at the end of the LAT...LON list
  if (coordinates.length > 2) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-5 && Math.abs(first.lon - last.lon) < 1e-5) {
      coordinates.pop();
    }
  }
  
  return coordinates;
}

export function getParsedPolygonCentroid(
  polygon: { lat: number; lon: number }[]
): { lat: number; lon: number } | null {
  if (!polygon || polygon.length === 0) return null;
  const ring: [number, number][] = polygon.map((p) => [p.lon, p.lat]);
  return getGeometryCentroid([ring]);
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
  
  for (let i = 0; i < polygon.length; i++) {
    const pt = polygon[i];
    const nextPt = polygon[(i + 1) % polygon.length];
    const d = getDistance(assetLat, assetLon, pt.lat, pt.lon);
    if (d < minDist) {
      minDist = d;
    }
    const { dist: segDist } = getClosestPointOnSegment(
      assetLat,
      assetLon,
      pt.lat,
      pt.lon,
      nextPt.lat,
      nextPt.lon
    );
    if (segDist < minDist) {
      minDist = segDist;
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
    "Special Marine Warning"
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

  // Fallback to machine-readable TIME...MOT...LOC line (where DEG is direction moving FROM)
  const tmlMatch = text.match(/TIME\.\.\.MOT\.\.\.LOC\s+\d{4}Z\s+(\d{1,3})DEG\s+(\d{1,3})KT/i);
  if (tmlMatch) {
    const fromDeg = parseInt(tmlMatch[1], 10);
    const toDeg = (fromDeg + 180) % 360;
    const speedKt = parseInt(tmlMatch[2], 10);
    if (!isNaN(toDeg) && !isNaN(speedKt) && speedKt > 0) {
      return {
        direction: String(toDeg),
        speed: speedKt,
        unit: 'KT',
        hasTrajectory: true,
      };
    }
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

/**
 * Extracts the exact NWS Doppler radar pinpoint coordinate of the storm core / rotation couplet
 * from `properties.parameters.eventMotionDescription` or the `TIME...MOT...LOC` block in `description`.
 * Why this matters: An NWS warning polygon extends 15-25 miles downstream of the tornado/rotation, so the
 * geometric center of the polygon is often 10+ miles ahead of where the rotation actually is right now.
 * `TIME...MOT...LOC` is the exact GPS coordinate where the NWS radar meteorologist placed the storm/rotation marker.
 */
export function extractNWSStormCorePosition(
  props: any,
  geometryCoordinates?: any,
  referenceLat?: number,
  referenceLon?: number
): { lat: number; lon: number; isRadarPinpoint: boolean } | null {
  const radarPoints: { lat: number; lon: number }[] = [];

  // 1. Check official NWS GeoJSON `parameters.eventMotionDescription`
  // Format example: ["2026-11-03T08:19:00-00:00...storm...225DEG...39KT...35.81,-94.63"]
  const emd = props?.parameters?.eventMotionDescription;
  if (Array.isArray(emd) && emd.length > 0) {
    for (const entry of emd) {
      if (typeof entry === 'string') {
        const pairMatches = entry.matchAll(/(-?\d{2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)/g);
        for (const m of pairMatches) {
          const lat = parseFloat(m[1]);
          const lon = parseFloat(m[2]);
          if (!isNaN(lat) && !isNaN(lon) && lat >= 15 && lat <= 72 && lon >= -170 && lon <= -60) {
            radarPoints.push({ lat, lon });
          }
        }
      }
    }
  }

  // 2. Check `TIME...MOT...LOC` in raw description text
  // Format example: "TIME...MOT...LOC 0819Z 225DEG 39KT 3581 9463" (or multiple lat/lon pairs for a squall line)
  if (radarPoints.length === 0 && typeof props?.description === 'string') {
    const tmlMatch = props.description.match(
      /TIME\.\.\.MOT\.\.\.LOC\s+\d{4}Z\s+\d{1,3}DEG\s+\d{1,3}KT\s+([\d\s]+)/i
    );
    if (tmlMatch && tmlMatch[1]) {
      const nums = tmlMatch[1].trim().split(/\s+/).filter(( tok: string) => /^\d{4,5}$/.test(tok));
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const lat = parseInt(nums[i], 10) / 100;
        let lon = parseInt(nums[i + 1], 10) / 100;
        if (lon < 60) {
          lon += 100;
        }
        lon = -lon;
        if (lat >= 15 && lat <= 72 && lon >= -170 && lon <= -60) {
          radarPoints.push({ lat, lon });
        }
      }
    }
  }

  if (radarPoints.length > 0) {
    if (
      radarPoints.length > 1 &&
      referenceLat !== undefined &&
      referenceLon !== undefined
    ) {
      let closest = radarPoints[0];
      let minD = getDistance(referenceLat, referenceLon, closest.lat, closest.lon);
      for (let i = 1; i < radarPoints.length; i++) {
        const d = getDistance(referenceLat, referenceLon, radarPoints[i].lat, radarPoints[i].lon);
        if (d < minD) {
          minD = d;
          closest = radarPoints[i];
        }
      }
      return { lat: closest.lat, lon: closest.lon, isRadarPinpoint: true };
    }
    return { lat: radarPoints[0].lat, lon: radarPoints[0].lon, isRadarPinpoint: true };
  }

  // 3. Fallback to geometric shoelace centroid of the warning polygon
  if (geometryCoordinates) {
    const polyCentroid = getGeometryCentroid(geometryCoordinates);
    if (polyCentroid) {
      return { lat: polyCentroid.lat, lon: polyCentroid.lon, isRadarPinpoint: false };
    }
  }

  return null;
}



