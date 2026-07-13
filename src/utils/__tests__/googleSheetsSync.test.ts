import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncToGoogleSheets } from '../googleSheetsSync';

describe('Google Sheets Synchronization', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    // Provide a fake apps script url for testing
    vi.stubEnv('VITE_APPS_SCRIPT_URL', 'https://script.google.com/macros/s/test-url/exec');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('should send a correctly formatted POST request to the Google Apps Script endpoint', async () => {
    // Mock a successful fetch response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' })
    });

    const mockPayload = {
      event: 'Tornado Warning',
      threatLevel: 'Extreme',
      closestDistance: 15,
      cape: 2500,
      shear: 50,
      dewpoint: 70,
      mlTornadoProb: 85,
      downburstRisk: 'None',
      geminiAnalysis: 'Critical supercell approaching.',
      latitude: 35.1234,
      longitude: -95.1234,
      isTest: true
    };

    const result = await syncToGoogleSheets(mockPayload as any);

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Assert the fetch arguments
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain('https://script.google.com/macros/s/');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('text/plain');
    
    // The payload should be stringified
    const sentBody = JSON.parse(options.body);
    expect(sentBody.event).toBe('Tornado Warning');
    expect(sentBody.cape).toBe(2500);
    expect(sentBody.isTest).toBe(true);
  });

  it('should gracefully handle fetch failures', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network error'));
    
    // We expect it to return false on error without crashing the app
    const result = await syncToGoogleSheets({ event: 'Test' } as any);
    
    expect(result).toBe(false);
  });
});
