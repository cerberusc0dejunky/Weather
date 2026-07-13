import { ChaserReport, StormChaserProfile } from '../types';

// Mock test profile setup for cerberus@c0dejunky.com
export const ACTIVE_STORM_CHASER: StormChaserProfile = {
  email: 'cerberus@c0dejunky.com',
  isVerified: true,
  tags: ['stormchaser']
};

/**
 * Fetches filtered ground-truth telemetry and spotter reports from the Google Apps Script endpoint.
 * This data is collected from the Chaser Dashboard and verified via the Open-Meteo Weather API Database.
 */
export const fetchChaserReports = async (): Promise<ChaserReport[]> => {
  try {
    // In production, this URL will point to the AppScript endpoint managing the Google Sheet
    const appsScriptUrl = (import.meta as any).env?.VITE_APPS_SCRIPT_URL;
    
    if (!appsScriptUrl) {
      // Return empty telemetry if not configured
      return [];
    }

    // Fetch the data
    const res = await fetch(appsScriptUrl, {
      method: 'GET'
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch chaser telemetry (status: ${res.status})`);
    }

    const data = await res.json();
    
    // The AppScript is expected to return a curated list of reports
    // It filters out irrelevant data before it hits the ML model
    return data.reports || [];
  } catch (error) {
    console.error('Chaser Sync Error:', error);
    return []; // Return empty array gracefully on network failure
  }
};
