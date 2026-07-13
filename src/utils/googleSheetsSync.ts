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
}

export const syncToGoogleSheets = async (
  data: ExportData
): Promise<boolean> => {
  // Sync engine permanently disabled as per user request to abandon background logging.
  // We resolve true to prevent UI errors in DAISY.
  return true;
};
