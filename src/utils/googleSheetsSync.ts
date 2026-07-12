import { NWSAlert, RotationPin, TelemetryConditions } from '../types';

interface ExportData {
  latitude?: number;
  longitude?: number;
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
      mode: 'no-cors', // Crucial for Google Apps Script Webhooks to bypass the 302 redirect changing POST to GET
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify(data),
    });

    // When using no-cors, the response is opaque (status 0). 
    // We cannot read the success message from Google, but the data was sent.
    if (res.type !== 'opaque' && !res.ok) {
      throw new Error(`Failed to sync to Google Sheets (status: ${res.status})`);
    }

    return true;
  } catch (error) {
    console.error('Google Sheets Sync Error:', error);
    throw error;
  }
};
