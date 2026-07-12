import { NWSAlert, RotationPin, TelemetryConditions } from '../types';

interface ExportData {
  alerts: NWSAlert[];
  rotationPins: RotationPin[];
  telemetry: TelemetryConditions | null;
  capeHistory?: any[];
  geminiReport?: string | null;
}

export const syncToGoogleSheets = async (
  data: ExportData
): Promise<boolean> => {
  try {
    const appsScriptUrl = (import.meta as any).env?.VITE_APPS_SCRIPT_URL;

    if (!appsScriptUrl) {
      throw new Error('VITE_APPS_SCRIPT_URL environment variable is not defined.');
    }

    const res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // Using text/plain avoids some CORS preflight issues with Apps Script
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error(`Failed to sync to Google Sheets (status: ${res.status})`);
    }

    return true;
  } catch (error) {
    console.error('Google Sheets Sync Error:', error);
    throw error;
  }
};
