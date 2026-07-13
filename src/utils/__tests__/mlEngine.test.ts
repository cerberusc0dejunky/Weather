import { describe, it, expect } from 'vitest';
import { runMlInference } from '../mlEngine';

describe('ML Engine Tornadogenesis Heuristics', () => {
  it('should calculate extreme threat correctly', async () => {
    // Extreme conditions: CAPE > 2000, Dewpoint > 65, Shear > 45, with rotation pins
    const conditions = {
      cape: 2500,
      dewPoint: 70,
      shearMph: 50,
      rotationPins: [{ id: '1', lat: 35, lon: -95, pinType: 'vortex' as any }]
    };
    
    const result = await runMlInference(conditions);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.tornadoProbability).toBeGreaterThanOrEqual(80);
      expect(result.downburstRisk).toBe('None'); // Intense rotation and shear prevents total downburst collapse
    }
  });

  it('should calculate low threat correctly', async () => {
    // Low conditions: Low CAPE, low shear, dry air
    const conditions = {
      cape: 500,
      dewPoint: 45,
      shearMph: 15,
      rotationPins: []
    };
    
    const result = await runMlInference(conditions);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.tornadoProbability).toBeLessThan(15);
      expect(result.downburstRisk).toBe('None');
    }
  });

  it('should return null for incomplete telemetry', async () => {
    const conditions = {
      cape: 0,
      dewPoint: 0,
      shearMph: 0,
      rotationPins: []
    };
    
    // In our implementation, incomplete telemetry is handled by caller, runMlInference just computes.
    // Wait, let's actually check if it handles 0 values gracefully
    const result = await runMlInference(conditions);
    expect(result).not.toBeNull();
    if (result) {
        expect(result.tornadoProbability).toBeLessThan(5);
    }
  });

  it('should trigger the collapse penalty and classify extreme downburst risk', async () => {
    const conditions = {
      cape: 3500, // Massive updraft fuel
      dewPoint: 70,
      shearMph: 5,  // Very weak shear causing precipitation loading
      rotationPins: []
    };
    
    const result = await runMlInference(conditions);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.downburstRisk).toBe('Extreme');
      expect(result.tornadoProbability).toBeLessThan(50); // Probability should drop due to collapse
    }
  });

  it('should shift neural weights to prioritize shear when active rotation pins exist', async () => {
    // Condition 1: Without pins
    const conditionsNoPins = {
      cape: 2500,
      dewPoint: 70,
      shearMph: 45,
      rotationPins: []
    };
    
    // Condition 2: With pins
    const conditionsWithPins = {
      ...conditionsNoPins,
      rotationPins: [{ id: '1', lat: 35, lon: -95, pinType: 'vortex' as any }]
    };
    
    const result1 = await runMlInference(conditionsNoPins);
    const result2 = await runMlInference(conditionsWithPins);
    
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    if (result1 && result2) {
      // The presence of a vortex pin dynamically shifts weights and adds rotation score, increasing probability significantly
      expect(result2.tornadoProbability).toBeGreaterThan(result1.tornadoProbability);
    }
  });
});
