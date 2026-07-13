import { describe, it, expect } from 'vitest';
import { getDistance, getBearing, isPointInPolygon, getGeometryCentroid, parseStormTrajectory } from '../geoUtils';

describe('Spherical Geometry Utilities', () => {
  it('should calculate distance between two coordinates correctly', () => {
    // Dallas, TX to Austin, TX
    const dallas = { lat: 32.7767, lon: -96.7970 };
    const austin = { lat: 30.2672, lon: -97.7431 };
    
    const distance = getDistance(dallas.lat, dallas.lon, austin.lat, austin.lon);
    
    // The great-circle distance is ~182 miles
    expect(distance).toBeGreaterThan(170);
    expect(distance).toBeLessThan(195);
  });

  it('should calculate identical distance in reverse', () => {
    const p1 = { lat: 40.7128, lon: -74.0060 }; // NYC
    const p2 = { lat: 34.0522, lon: -118.2437 }; // LA
    
    const d1 = getDistance(p1.lat, p1.lon, p2.lat, p2.lon);
    const d2 = getDistance(p2.lat, p2.lon, p1.lat, p1.lon);
    
    expect(Math.abs(d1 - d2)).toBeLessThan(0.1);
  });

  it('should calculate cardinal bearings correctly', () => {
    // Dallas to Oklahoma City (Almost straight North)
    const dallas = { lat: 32.7767, lon: -96.7970 };
    const okc = { lat: 35.4676, lon: -97.5164 };
    
    const bearing = getBearing(dallas.lat, dallas.lon, okc.lat, okc.lon);
    
    // Bearing should be North/North-West (~340-360 degrees)
    expect(bearing).toBeGreaterThan(340);
    expect(bearing).toBeLessThan(360);
  });

  it('should verify if a point is inside a polygon using winding number', () => {
    // Simple square polygon
    const polygon: [number, number][] = [
      [-100, 30], // [lon, lat]
      [-90, 30],
      [-90, 40],
      [-100, 40]
    ];
    
    // Inside point
    expect(isPointInPolygon(35, -95, polygon)).toBe(true);
    // Outside point
    expect(isPointInPolygon(25, -95, polygon)).toBe(false);
  });

  it('should correctly calculate the geographic centroid of a multi-point geometry', () => {
    const coords = [
      [[-90, 30], [-80, 30], [-80, 40], [-90, 40]]
    ];
    
    // getGeometryCentroid takes the deeply nested NWS format
    const centroid = getGeometryCentroid(coords);
    expect(centroid).not.toBeNull();
    if (centroid) {
      expect(centroid.lat).toBeCloseTo(35);
      expect(centroid.lon).toBeCloseTo(-85);
    }
  });

  it('should correctly parse storm trajectory from alert text', () => {
    // Valid trajectory text
    const text = "A SEVERE THUNDERSTORM WAS LOCATED NEAR DALLAS... MOVING NORTHEAST AT 35 MPH.";
    const result = parseStormTrajectory("SEVERE THUNDERSTORM WARNING", text);
    
    expect(result.hasTrajectory).toBe(true);
    expect(result.direction).toBe('NORTHEAST');
    expect(result.speed).toBe(35);
    expect(result.unit).toBe('MPH');
    
    // Invalid/non-convective text
    const resultNoTrajectory = parseStormTrajectory("FLASH FLOOD WARNING", "Heavy rain is falling.");
    expect(resultNoTrajectory.hasTrajectory).toBe(false);
  });
});
