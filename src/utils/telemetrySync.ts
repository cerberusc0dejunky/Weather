import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  NWSAlert,
  RotationPin,
  TelemetryConditions,
  MesoscaleDiscussion,
  CorrelationMetricRecord,
} from '../types';
import { getDistance, isPointInParsedPolygon } from './geoUtils';

const CORRELATION_STORAGE_KEY = 'daisy-correlation-dataset';
const SPREADSHEET_ID_KEY = 'daisy-google-spreadsheet-id';
const SPREADSHEET_TAB_KEY = 'daisy-google-spreadsheet-tab';
const SPREADSHEET_URL_KEY = 'daisy-google-spreadsheet-url';
const MAX_LOCAL_RECORDS = 150;

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let spreadsheetCreationPromise: Promise<{ spreadsheetId: string; tabName: string; spreadsheetUrl: string } | null> | null = null;

export const CORRELATION_HEADERS: (keyof CorrelationMetricRecord)[] = [
  'recordId',
  'capturedAt',
  'triggerType',
  'alertId',
  'event',
  'rotationType',
  'threatLevel',
  'stormCentroidLat',
  'stormCentroidLon',
  'stormAreaDesc',
  'stormVectorDir',
  'stormVectorSpeedMph',
  'polygonShiftDir',
  'polygonShiftSpeedMph',
  'predictedTornadoConfidence',
  'hasTDS',
  'hasObservedTornado',
  'hasVelocityCouplet',
  'hasHookEcho',
  'hasSupercellHailUpdraft',
  'hasConvectiveIntensification',
  'isPDSOrEmergency',
  'asosStationId',
  'asosStationName',
  'temperatureF',
  'dewPointF',
  'barometricPressureInHg',
  'pressureDelta6PollInHg',
  'pressureTrend',
  'windSpeedMph',
  'windGustMph',
  'windDirectionDeg',
  'precipProbPct',
  'currentCapeJkg',
  'max6HrCapeJkg',
  'capeTrend',
  'stormBypassChance',
  'environmentStatus',
  'correlatedMcdNumber',
  'mcdWatchProbabilityPct',
  'mcdConcerning',
  'mcdAreasAffected',
  'mcdCentroidLat',
  'mcdCentroidLon',
  'mcdWatchBox',
  'mcdPolygonCoordinates',
  'mcdPeakTornadoMph',
  'mcdPeakWindMph',
  'mcdPeakHailIn',
  'mcdTargetedWFOs',
  'isRotationInsideMcdCorridor',
];

export const ADMIN_OWNER_EMAIL = 'cerberus@c0dejunky.com';

export function isAuthorizedOwner(user: User | null | undefined): boolean {
  return Boolean(user?.email && user.email.trim().toLowerCase() === ADMIN_OWNER_EMAIL.toLowerCase());
}

export const initGoogleSheetsAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
  onAdminSessionRestored?: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (!isAuthorizedOwner(user)) {
        cachedAccessToken = null;
        await auth.signOut().catch(() => {});
        if (onAdminSessionRestored) onAdminSessionRestored(null);
        if (onAuthFailure) onAuthFailure();
        return;
      }
      if (onAdminSessionRestored) onAdminSessionRestored(user);
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAdminSessionRestored) onAdminSessionRestored(null);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

const SYNCED_RECORD_IDS_KEY = 'daisy-synced-record-ids';

function getSyncedRecordIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SYNCED_RECORD_IDS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function markRecordIdSynced(recordId: string) {
  try {
    const set = getSyncedRecordIds();
    set.add(recordId);
    const arr = Array.from(set).slice(-300);
    localStorage.setItem(SYNCED_RECORD_IDS_KEY, JSON.stringify(arr));
  } catch {}
}

export interface SignInSheetsResult {
  user: User;
  accessToken: string;
  spreadsheetUrl?: string;
  syncedCount?: number;
  apiError?: string;
  enableApiUrl?: string;
}

export const signInForGoogleSheets = async (): Promise<SignInSheetsResult | null> => {
  try {
    isSigningIn = true;
    provider.setCustomParameters({ prompt: 'consent', login_hint: ADMIN_OWNER_EMAIL });
    const result = await signInWithPopup(auth, provider);

    if (!isAuthorizedOwner(result.user)) {
      cachedAccessToken = null;
      await auth.signOut().catch(() => {});
      throw new Error('Access Denied: Login is restricted exclusively to the authorized administrator.');
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Sheets access token from Google sign-in.');
    }

    cachedAccessToken = credential.accessToken;
    const sheetInfo = await ensureDaisySpreadsheet(cachedAccessToken);

    if (sheetInfo?.error) {
      return {
        user: result.user,
        accessToken: cachedAccessToken,
        apiError: sheetInfo.error,
        enableApiUrl: sheetInfo.enableApiUrl,
      };
    }

    // Batch-flush all locally queued correlation records in a single request
    let syncedCount = 0;
    const existingRecords = getSavedCorrelationRecords();
    const syncedIds = getSyncedRecordIds();
    if (sheetInfo && sheetInfo.spreadsheetId && existingRecords.length > 0) {
      const unsynced = existingRecords.filter((r) => !syncedIds.has(r.recordId)).reverse();
      if (unsynced.length > 0) {
        const ok = await appendRecordsBatchToGoogleSheet(
          unsynced,
          cachedAccessToken,
          sheetInfo.spreadsheetId,
          sheetInfo.tabName
        );
        if (ok) {
          unsynced.forEach((rec) => markRecordIdSynced(rec.recordId));
          syncedCount = unsynced.length;
        }
      }
    }

    return {
      user: result.user,
      accessToken: cachedAccessToken,
      spreadsheetUrl: sheetInfo?.spreadsheetUrl,
      syncedCount,
    };
  } catch (error) {
    console.warn('Google Sheets sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const signOutGoogleSheets = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export const getSavedSpreadsheetUrl = (): string | null => {
  return localStorage.getItem(SPREADSHEET_URL_KEY);
};

/**
 * Ensures a dedicated Google Sheet exists on the user's Google Sheets account.
 * If none exists yet (or the previous one is unreachable), automatically creates a new
 * spreadsheet with formatted column headers and stores its ID & URL.
 */
export async function ensureDaisySpreadsheet(
  accessToken: string
): Promise<{
  spreadsheetId: string;
  tabName: string;
  spreadsheetUrl: string;
  error?: string;
  enableApiUrl?: string;
} | null> {
  if (!accessToken) return null;
  if (spreadsheetCreationPromise) return spreadsheetCreationPromise;

  spreadsheetCreationPromise = (async () => {
    try {
      const existingId = localStorage.getItem(SPREADSHEET_ID_KEY);
      if (existingId) {
        const checkRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${existingId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (checkRes.ok) {
          const meta = await checkRes.json();
          const firstTab = meta.sheets?.[0]?.properties?.title || localStorage.getItem(SPREADSHEET_TAB_KEY) || 'StormCorrelationTelemetry';
          const url = meta.spreadsheetUrl || localStorage.getItem(SPREADSHEET_URL_KEY) || `https://docs.google.com/spreadsheets/d/${existingId}`;
          localStorage.setItem(SPREADSHEET_TAB_KEY, firstTab);
          localStorage.setItem(SPREADSHEET_URL_KEY, url);
          return { spreadsheetId: existingId, tabName: firstTab, spreadsheetUrl: url };
        }
      }

      // Create a brand new Google Sheet automatically
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            title: `DAISY Storm Rotation & Mesoscale Correlation Log (${new Date().toISOString().slice(0, 10)})`,
          },
          sheets: [
            {
              properties: {
                title: 'StormCorrelationTelemetry',
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          ],
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.warn('Failed to create Google Sheet:', errText);
        let errMsg = `Google Sheets API Error (${createRes.status})`;
        let enableUrl: string | undefined = undefined;
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.error?.message) {
            errMsg = errJson.error.message;
            const urlMatch = errMsg.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/sheets\.googleapis\.com\/overview\?project=\d+/);
            if (urlMatch) {
              enableUrl = urlMatch[0];
            }
          }
        } catch {}
        return {
          spreadsheetId: '',
          tabName: '',
          spreadsheetUrl: '',
          error: errMsg,
          enableApiUrl: enableUrl,
        };
      }

      const created = await createRes.json();
      const spreadsheetId: string = created.spreadsheetId;
      const tabName: string = created.sheets?.[0]?.properties?.title || 'StormCorrelationTelemetry';
      const spreadsheetUrl: string =
        created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      localStorage.setItem(SPREADSHEET_ID_KEY, spreadsheetId);
      localStorage.setItem(SPREADSHEET_TAB_KEY, tabName);
      localStorage.setItem(SPREADSHEET_URL_KEY, spreadsheetUrl);

      // Write the header row to the newly created sheet
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [CORRELATION_HEADERS],
          }),
        }
      );

      return { spreadsheetId, tabName, spreadsheetUrl };
    } catch (err: any) {
      console.warn('Error ensuring Google Sheet:', err);
      return {
        spreadsheetId: '',
        tabName: '',
        spreadsheetUrl: '',
        error: err?.message || 'Network error contacting Google Sheets API',
      };
    } finally {
      spreadsheetCreationPromise = null;
    }
  })();

  return spreadsheetCreationPromise;
}

async function appendRecordsBatchToGoogleSheet(
  records: CorrelationMetricRecord[],
  accessToken: string,
  spreadsheetId: string,
  tabName: string
): Promise<boolean> {
  try {
    const rows = records.map((record) =>
      CORRELATION_HEADERS.map((key) => {
        const val = record[key];
        return val === null || val === undefined ? '' : val;
      })
    );

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: rows,
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function appendRecordToGoogleSheet(
  record: CorrelationMetricRecord,
  accessToken: string,
  spreadsheetId: string,
  tabName: string
): Promise<boolean> {
  return appendRecordsBatchToGoogleSheet([record], accessToken, spreadsheetId, tabName);
}

export function getSavedCorrelationRecords(): CorrelationMetricRecord[] {
  try {
    const raw = localStorage.getItem(CORRELATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function exportCorrelationRecordsCsv(): boolean {
  const records = getSavedCorrelationRecords();
  if (records.length === 0) return false;

  const escapeCsvCell = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = CORRELATION_HEADERS.join(',');
  const dataLines = [...records]
    .reverse()
    .map((rec) => CORRELATION_HEADERS.map((k) => escapeCsvCell(rec[k])).join(','));

  const csvContent = [headerLine, ...dataLines].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DAISY_Storm_Rotation_Log_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

function saveCorrelationRecordLocally(record: CorrelationMetricRecord): CorrelationMetricRecord[] {
  try {
    const existing = getSavedCorrelationRecords();
    const updated = [record, ...existing].slice(0, MAX_LOCAL_RECORDS);
    localStorage.setItem(CORRELATION_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

/**
 * Assembles a 100% anonymous, zero-PII meteorological & radar correlation snapshot
 * (excluding any user GPS coordinates or personal location names) and silently appends
 * it directly to the user's Google Sheet (creating one automatically if needed).
 */
export async function syncAnonymousStormTelemetry(params: {
  triggerType: 'ROTATION_DETECTED' | 'MESOSCALE_CORRELATION_SAMPLE' | 'TORNADO_WARNING_ACTIVE';
  pin?: RotationPin | null;
  alert?: NWSAlert | null;
  discussions: MesoscaleDiscussion[];
  targetMcd?: MesoscaleDiscussion | null;
  telemetry: TelemetryConditions | null;
  windyTelemetry?: {
    temp?: string;
    dewpoint?: string;
    wind?: string;
    gust?: string;
    pressure?: string;
    cape?: number;
    precip?: string;
    modelUsed: string;
  } | null;
  forecastTrend: {
    status: string;
    bypassChance: string;
    deltaPressure: number;
    pressureDirection: string;
    currentCapeVal: number;
    maxCapeVal: number;
    capeDirection: string;
  };
}): Promise<{ record: CorrelationMetricRecord; syncedRemote: boolean }> {
  const {
    triggerType,
    pin,
    alert,
    discussions,
    targetMcd,
    telemetry,
    windyTelemetry,
    forecastTrend,
  } = params;

  const stormLat = pin?.lat ?? null;
  const stormLon = pin?.lon ?? null;

  let matchedMcd: MesoscaleDiscussion | null = targetMcd || null;
  let insideMcd = false;

  if (stormLat !== null && stormLon !== null && discussions.length > 0) {
    for (const md of discussions) {
      if (md.coordinates && md.coordinates.length >= 3) {
        if (isPointInParsedPolygon(stormLat, stormLon, md.coordinates)) {
          matchedMcd = md;
          insideMcd = true;
          break;
        }
      }
    }
    if (!matchedMcd) {
      let closestDist = Infinity;
      for (const md of discussions) {
        if (md.centroid) {
          const d = getDistance(stormLat, stormLon, md.centroid.lat, md.centroid.lon);
          if (d < closestDist) {
            closestDist = d;
            matchedMcd = md;
          }
        }
      }
    }
  } else if (!matchedMcd && discussions.length > 0) {
    matchedMcd = discussions[0];
  }

  const watchBoxStr = matchedMcd?.watchBox
    ? `LAT [${matchedMcd.watchBox.minLat.toFixed(2)} to ${matchedMcd.watchBox.maxLat.toFixed(2)}] LON [${matchedMcd.watchBox.minLon.toFixed(2)} to ${matchedMcd.watchBox.maxLon.toFixed(2)}]`
    : null;

  const polyCoordsStr =
    matchedMcd?.coordinates && matchedMcd.coordinates.length > 0
      ? matchedMcd.coordinates.map((c) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`).join(' | ')
      : null;

  const vectorDir = alert?.keywords?.vector ? alert.keywords.vector[0] : null;
  const vectorSpeed = alert?.keywords?.vector ? parseInt(alert.keywords.vector[1], 10) || null : null;

  const record: CorrelationMetricRecord = {
    recordId: `corr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    capturedAt: new Date().toISOString(),
    triggerType,
    alertId: alert?.id || pin?.alertId || (matchedMcd ? `mcd-${matchedMcd.number}` : 'env-sample'),
    event: alert?.event || pin?.eventName || (matchedMcd ? `SPC MCD #${matchedMcd.number}` : 'Atmospheric Sample'),
    rotationType: pin?.pinType || (alert?.keywords?.rotation ? 'mesocyclone' : 'none'),
    threatLevel: alert?.threatLevel || pin?.threatLevel || 'Normal',
    stormCentroidLat: stormLat !== null ? Number(stormLat.toFixed(4)) : null,
    stormCentroidLon: stormLon !== null ? Number(stormLon.toFixed(4)) : null,
    stormAreaDesc: alert?.areaDesc || pin?.areaDesc || matchedMcd?.areasAffected || 'N/A',
    stormVectorDir: vectorDir,
    stormVectorSpeedMph: vectorSpeed,
    polygonShiftDir: alert?.polygonCentroidShiftVector?.dir || null,
    polygonShiftSpeedMph: alert?.polygonCentroidShiftVector?.speed ?? null,
    predictedTornadoConfidence:
      alert?.predictedTornadoConfidence ?? (pin?.pinType === 'vortex' ? 95 : pin?.pinType === 'radar_indicated' ? 70 : 0),
    hasTDS: Boolean(alert?.tornadoDebrisSignatureTDS || pin?.pinType === 'vortex'),
    hasObservedTornado: Boolean(alert?.keywords?.observed || pin?.isObserved),
    hasVelocityCouplet: Boolean(alert?.velocityCoupletPersistentShear || alert?.keywords?.rotation),
    hasHookEcho: Boolean(alert?.hookEchoEvolutionDetected),
    hasSupercellHailUpdraft: Boolean(alert?.strongSupercellUpdraft),
    hasConvectiveIntensification: Boolean(alert?.convectiveIntensificationDetected),
    isPDSOrEmergency: Boolean(alert?.keywords?.emergency),
    asosStationId: telemetry?.stationId || 'N/A',
    asosStationName: telemetry?.stationName || 'N/A',
    temperatureF: telemetry?.temperature || windyTelemetry?.temp || 'N/A',
    dewPointF: telemetry?.dewPoint || windyTelemetry?.dewpoint || 'N/A',
    barometricPressureInHg: telemetry?.pressure || windyTelemetry?.pressure || 'N/A',
    pressureDelta6PollInHg: Number(forecastTrend.deltaPressure.toFixed(3)),
    pressureTrend: forecastTrend.pressureDirection,
    windSpeedMph: telemetry?.windSpeed || windyTelemetry?.wind || 'N/A',
    windGustMph: telemetry?.windGust || windyTelemetry?.gust || 'N/A',
    windDirectionDeg: telemetry?.windDirection || 'N/A',
    precipProbPct: telemetry?.probPrecip || '0%',
    currentCapeJkg: forecastTrend.currentCapeVal,
    max6HrCapeJkg: forecastTrend.maxCapeVal,
    capeTrend: forecastTrend.capeDirection,
    stormBypassChance: forecastTrend.bypassChance,
    environmentStatus: forecastTrend.status,
    correlatedMcdNumber: matchedMcd?.number || null,
    mcdWatchProbabilityPct: matchedMcd?.probability ?? null,
    mcdConcerning: matchedMcd?.concerning || null,
    mcdAreasAffected: matchedMcd?.areasAffected || null,
    mcdCentroidLat: matchedMcd?.centroid?.lat ?? null,
    mcdCentroidLon: matchedMcd?.centroid?.lon ?? null,
    mcdWatchBox: watchBoxStr,
    mcdPolygonCoordinates: polyCoordsStr,
    mcdPeakTornadoMph: matchedMcd?.peakTornadoIntensity || null,
    mcdPeakWindMph: matchedMcd?.peakWindGust || null,
    mcdPeakHailIn: matchedMcd?.peakHailSize || null,
    mcdTargetedWFOs: matchedMcd?.wfoList ? matchedMcd.wfoList.join(', ') : null,
    isRotationInsideMcdCorridor: insideMcd,
  };

  saveCorrelationRecordLocally(record);

  let syncedRemote = false;

  // 1. Direct Google Sheets API v4 (creates a new Google Sheet automatically if none exists)
  if (cachedAccessToken) {
    const sheetInfo = await ensureDaisySpreadsheet(cachedAccessToken);
    if (sheetInfo) {
      syncedRemote = await appendRecordToGoogleSheet(
        record,
        cachedAccessToken,
        sheetInfo.spreadsheetId,
        sheetInfo.tabName
      );
      if (syncedRemote) {
        markRecordIdSynced(record.recordId);
      }
    }
  }

  // 2. Optional Apps Script Webhook fallback if configured in environment
  const envUrl = (import.meta as any).env?.VITE_APPS_SCRIPT_URL;
  const webhookUrl = typeof envUrl === 'string' ? envUrl.trim() : '';
  if (!syncedRemote && webhookUrl && webhookUrl.startsWith('https://')) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(record),
      });
      syncedRemote = true;
    } catch {}
  }

  return { record, syncedRemote };
}
