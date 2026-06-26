import { useState, useCallback, useRef } from 'react';
import * as turf from '@turf/turf';
import { NWSAlert } from '../types';
import {
  getDistance,
  getBearing,
  getGeometryCentroid,
  getMemoizedMinPolygonDistance,
  parseStormTrajectory
} from '../utils/geoUtils';

const TRACKED_ALERTS_FILTER = [
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Weather Statement',
  'Special Weather Statement',
  'Flash Flood Warning',
  'Flood Watch',
];

interface UseNationalAlertsProps {
  currentLat: number;
  currentLon: number;
  assets: any[];
  monitorRadius: number;
  triggerToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  logNetworkRequest: (log: any) => void;
  setSyncStatus: (status: string) => void;
  proxyFetch: (url: string, options?: any) => Promise<any>;
  addAlertsToHistory: (resolvedAlerts: NWSAlert[]) => void;
  translateAlertsToRotationPins: (activeAlerts: NWSAlert[]) => any[];
  setRotationPins: (pins: any[]) => void;
}

export const useNationalAlerts = ({
  currentLat,
  currentLon,
  assets,
  monitorRadius,
  triggerToast,
  logNetworkRequest,
  setSyncStatus,
  proxyFetch,
  addAlertsToHistory,
  translateAlertsToRotationPins,
  setRotationPins
}: UseNationalAlertsProps) => {
  const [alerts, setAlerts] = useState<NWSAlert[]>([]);
  
  // Ref tracking to persist across renders
  const previousSignaturesRef = useRef<Set<string>>(new Set());
  const alertsCentroidsHistoryRef = useRef<Record<string, { lat: number; lon: number; timestamp: number }>>({});

  // Helper function to normalize direction
  const normalizeDirection = useCallback((dirStr: string): string => {
    let clean = dirStr.trim().toUpperCase();
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

    return directionMap[clean] || clean;
  }, []);

  // Helper to extract degrees
  const getDirHeadingDegrees = useCallback((dirStr: string): number | null => {
    let clean = dirStr.trim().toUpperCase();
    const degreeMatch = clean.match(/^(\d+)/);
    if (degreeMatch) {
      return parseInt(degreeMatch[1], 10) % 360;
    }
    clean = clean.replace(/[-\s]/g, '');
    const normalized = normalizeDirection(clean);
    
    const cardinalBearings: Record<string, number> = {
      N: 0, NORTH: 0, NNE: 22.5, NE: 45, NORTHEAST: 45, ENE: 67.5,
      E: 90, EAST: 90, ESE: 112.5, SE: 135, SOUTHEAST: 135, SSE: 157.5,
      S: 180, SOUTH: 180, SSW: 202.5, SW: 225, SOUTHWEST: 225, WSW: 247.5,
      W: 270, WEST: 270, WNW: 292.5, NW: 315, NORTHWEST: 315, NNW: 337.5,
    };
    
    return cardinalBearings[normalized] !== undefined ? cardinalBearings[normalized] : null;
  }, [normalizeDirection]);

  // Process NWS Features
  const processNWSFeatures = useCallback((features: any[]) => {
    const processedList: NWSAlert[] = [];
    const currentSignatures = new Set<string>();
    let freshUpdateCount = 0;

    features.forEach((feature: any) => {
      const props = feature.properties || {};
      const desc = (props.description || '').toUpperCase();
      const instr = (props.instruction || '').toUpperCase();
      const fullText = `${desc} ${instr}`;
      const eventName = props.event || 'Special Weather Statement';

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
        fullText.includes('BASEBALL SIZE HAIL') ||
        fullText.includes('SOFTBALL SIZE HAIL') ||
        fullText.includes('GIANT HAIL') ||
        fullText.includes('DESTRUCTIVE THUNDERSTORM');

      let threatLevel: 'Low' | 'Moderate' | 'High' | 'Extreme' = 'Low';
      if (hasEmergency) {
        threatLevel = 'Extreme';
      } else if (hasObserved || isDestructive || eventName.includes('Tornado Warning')) {
        threatLevel = 'High';
      } else if (hasRotation || hasPossible || hasFunnel || eventName.includes('Severe Thunderstorm Warning')) {
        threatLevel = 'Moderate';
      }

      let keywords: any = {
        rotation: hasRotation,
        observed: hasObserved,
        emergency: hasEmergency,
        possible: hasPossible,
        destructive: isDestructive,
      };

      const trajectory = parseStormTrajectory(eventName, fullText);
      const vector: [string, string, string] | null = trajectory.hasTrajectory
        ? [trajectory.direction || '', String(trajectory.speed || 0), trajectory.unit || 'MPH']
        : null;
      if (vector) {
        keywords.vector = vector;
      }

      let geometry = feature.geometry;
      let minDist = 999;
      let isDirectHit = false;
      let headedTowards = false;

      if (geometry && geometry.coordinates) {
        const centroid = getGeometryCentroid(geometry.coordinates);
        if (centroid) {
          const currentTimestamp = Date.now();
          const oldRecord = alertsCentroidsHistoryRef.current[feature.id || props.id];
          
          if (oldRecord && vector) {
            const [dir, speedStr] = vector;
            const speed = parseInt(speedStr, 10);
            const bearing = getDirHeadingDegrees(dir);
            
            if (bearing !== null && !isNaN(speed) && speed > 0) {
              const timeDeltaHours = (currentTimestamp - oldRecord.timestamp) / 3600000;
              const expectedDist = speed * timeDeltaHours;
              const actualDist = getDistance(oldRecord.lat, oldRecord.lon, centroid.lat, centroid.lon);
              
              if (actualDist > expectedDist * 1.5) {
                console.warn(`[DAISY Centroid Tracking] Storm cell centroid acceleration detected. Velocity vector: ${dir} @ ${speed} MPH.`);
              }
            }
          }
          alertsCentroidsHistoryRef.current[feature.id || props.id] = {
            lat: centroid.lat,
            lon: centroid.lon,
            timestamp: currentTimestamp,
          };
        }

        if (assets.length > 0) {
          assets.forEach((asset) => {
            const result = getMemoizedMinPolygonDistance(asset.id, asset.lat, asset.lon, feature.id || props.id, geometry.coordinates);
            if (result.isInside) isDirectHit = true;
            if (result.minDist < minDist) {
              minDist = result.minDist;
            }

            if (vector && centroid) {
              const [dir] = vector;
              const bearing = getDirHeadingDegrees(dir);
              if (bearing !== null) {
                const bearingToAsset = getBearing(centroid.lat, centroid.lon, asset.lat, asset.lon);
                const diff = Math.abs(bearing - bearingToAsset);
                const isAligned = Math.min(diff, 360 - diff) < 45;
                if (isAligned && result.minDist < 100) {
                  headedTowards = true;
                }
              }
            }
          });
        } else {
          const result = getMemoizedMinPolygonDistance('current', currentLat, currentLon, feature.id || props.id, geometry.coordinates);
          if (result.isInside) isDirectHit = true;
          minDist = result.minDist;

          if (vector && centroid) {
            const [dir] = vector;
            const bearing = getDirHeadingDegrees(dir);
            if (bearing !== null) {
              const bearingToUser = getBearing(centroid.lat, centroid.lon, currentLat, currentLon);
              const diff = Math.abs(bearing - bearingToUser);
              const isAligned = Math.min(diff, 360 - diff) < 45;
              if (isAligned && result.minDist < 100) {
                headedTowards = true;
              }
            }
          }
        }
      }

      let areaDesc = props.areaDesc || 'Unknown Area';
      let snippet = '';

      if (desc) {
        const lines = desc.split('\n');
        const matchedLine = lines.find((l: string) => l.includes('HAZARD...') || l.includes('IMPACT...'));
        if (matchedLine) {
          snippet = matchedLine.replace(/HAZARD\.\.\.|IMPACT\.\.\./g, '').trim();
        }
      }

      const alertId = feature.id || props.id || String(Math.random());
      const signature = `${alertId}:${props.sent}:${props.expires}:${props.event}`;
      currentSignatures.add(signature);

      if (!previousSignaturesRef.current.has(signature)) {
        freshUpdateCount++;
        
        let shouldNotify = false;
        if (assets.length > 0) {
          shouldNotify = isDirectHit || minDist <= monitorRadius;
        } else {
          shouldNotify = isDirectHit || minDist <= monitorRadius;
        }

        if (shouldNotify) {
          if (threatLevel === 'Extreme') {
            triggerToast(`⚠️ TORNADO EMERGENCY: ${props.event} for ${areaDesc}`, 'error');
          } else if (threatLevel === 'High') {
            triggerToast(`🚨 HIGH THREAT WARNING: ${props.event} for ${areaDesc}`, 'error');
          } else {
            triggerToast(`⚠️ PROXIMITY ALERT: ${props.event} active for ${areaDesc}`, 'info');
          }
        }
      }

      processedList.push({
        id: alertId,
        event: eventName,
        areaDesc,
        sent: props.sent,
        expires: props.expires,
        description: props.description,
        instruction: props.instruction,
        geometry,
        keywords,
        minDist,
        isDirectHit,
        headedTowards,
        threatLevel,
        snippet,
        justUpdated: false,
      });
    });

    previousSignaturesRef.current = currentSignatures;

    setAlerts((prevActive) => {
      const resolved = prevActive.filter((oldAlert) => {
        return !processedList.some((newAlert) => newAlert.id === oldAlert.id);
      });
      if (resolved.length > 0) {
        addAlertsToHistory(resolved);
      }

      const freshActiveCount = processedList.length;
      if (freshUpdateCount > 0) {
        console.log(`[DAISY Watchdog] Fresh data cycles processed. Net active alerts in tracking radius: ${freshActiveCount}`);
      }

      const pins = translateAlertsToRotationPins(processedList);
      setRotationPins(pins);

      return processedList;
    });
  }, [
    currentLat,
    currentLon,
    assets,
    monitorRadius,
    triggerToast,
    getDirHeadingDegrees,
    addAlertsToHistory,
    translateAlertsToRotationPins,
    setRotationPins
  ]);

  // Main Fetcher
  const fetchAlerts = useCallback(async () => {
    setSyncStatus('SYNCING...');
    const encodedEvents = TRACKED_ALERTS_FILTER.map((e) => encodeURIComponent(e)).join(',');
    const nwsUrl = `https://api.weather.gov/alerts/active?event=${encodedEvents}`;
    const headers = {
      'User-Agent': '(DAISY Storm Tracker App, cerberus@c0dejunky.com)',
      'Accept': 'application/geo+json'
    };

    try {
      const res = await proxyFetch(nwsUrl, { headers });
      
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
  }, [proxyFetch, logNetworkRequest, processNWSFeatures, setSyncStatus]);

  return { alerts, fetchAlerts, setAlerts };
};
