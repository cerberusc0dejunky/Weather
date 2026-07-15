import { NWSAlert, RotationPin, TelemetryConditions } from '../types';

interface ExportData {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lon?: number;
  alerts: NWSAlert[];
  rotationPins: RotationPin[];
  telemetry: TelemetryConditions | null;
  capeHistory?: any[];
  geminiReport?: string | null;
  [key: string]: any;
}

export const syncToGoogleSheets = async (
  data: ExportData
): Promise<boolean> => {
  const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.warn('[Google Sheets Sync] VITE_APPS_SCRIPT_URL is not configured.');
    return false;
  }

  try {
    const res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (err) {
    console.error('[Google Sheets Sync] Failed to sync data to Sheets:', err);
    return false;
  }
};
