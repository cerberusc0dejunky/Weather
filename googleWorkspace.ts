import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App without duplicating
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Add required Google Drive and Sheets scopes
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // If we don't have token cached yet, we might need a re-auth or we can try to retrieve it if possible.
        // For simplicity, we fallback to requesting explicit sign-in if cachedAccessToken is not populated.
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Initiate Google Sign-In popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google OAuth access token from authentication result');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Sign-In OAuth failure:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Return cached access token
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

// Handle logout
export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// Google Sheets & Drive API operations
interface ExportData {
  alerts: any[];
  rotationPins: any[];
  telemetry: any;
  capeHistory: any[];
  geminiReport: string | null;
}

export const syncToGoogleSheets = async (
  token: string,
  data: ExportData
): Promise<{ spreadsheetId: string; url: string; isNew: boolean }> => {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Search for an existing "DAISY Severe Weather Log" spreadsheet
  let spreadsheetId = '';
  let isNew = false;
  try {
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='DAISY Severe Weather Log' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const searchRes = await fetch(searchUrl, { headers });
    if (!searchRes.ok) {
      throw new Error(`Drive search returned status ${searchRes.status}`);
    }
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      spreadsheetId = searchData.files[0].id;
    }
  } catch (err) {
    console.warn('Error checking existing sheet, will attempt to create a new one:', err);
  }

  // Step 2: Create a new sheet if one was not found
  if (!spreadsheetId) {
    isNew = true;
    const createUrl = 'https://sheets.googleapis.com/v1/spreadsheets';
    const createBody = {
      properties: {
        title: 'DAISY Severe Weather Log',
      },
      sheets: [
        { properties: { title: 'Alerts Log', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Radar Rotation Pins', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Gemini Reports', gridProperties: { frozenRowCount: 1 } } },
      ],
    };

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create Google Spreadsheet (status: ${createRes.status})`);
    }

    const createdSheet = await createRes.json();
    spreadsheetId = createdSheet.spreadsheetId;

    // Initialize headers for each sheet
    await appendValuesToSheet(token, spreadsheetId, 'Alerts Log!A1', [
      ['Timestamp', 'Event ID', 'Event Name', 'Area Affected', 'Threat Level', 'Is Direct Hit', 'Headed Towards', 'Snippet']
    ]);

    await appendValuesToSheet(token, spreadsheetId, 'Radar Rotation Pins!A1', [
      ['Timestamp', 'Pin ID', 'Event Name', 'Latitude', 'Longitude', 'Area', 'Vortex Type', 'Threat Level', 'Observed']
    ]);

    await appendValuesToSheet(token, spreadsheetId, 'Gemini Reports!A1', [
      ['Timestamp', 'Temperature (°F)', 'Dew Point (°F)', 'SBCAPE (J/kg)', 'Wind (Speed/Gust)', 'Active Alerts Count', 'Active Pins Count', 'Report Markdown Summary']
    ]);
  }

  const timestamp = new Date().toLocaleString();

  // Step 3: Append raw severe alerts
  if (data.alerts && data.alerts.length > 0) {
    const alertRows = data.alerts.map((a) => [
      timestamp,
      a.id || 'N/A',
      a.event || 'N/A',
      a.areaDesc || 'N/A',
      a.threatLevel || 'Normal',
      a.isDirectHit ? 'YES' : 'NO',
      a.headedTowards ? 'YES' : 'NO',
      a.snippet || ''
    ]);
    await appendValuesToSheet(token, spreadsheetId, 'Alerts Log!A2', alertRows);
  }

  // Step 4: Append active rotation pins
  if (data.rotationPins && data.rotationPins.length > 0) {
    const pinRows = data.rotationPins.map((p) => [
      timestamp,
      p.id || 'N/A',
      p.eventName || 'N/A',
      p.lat,
      p.lon,
      p.areaDesc || 'N/A',
      p.pinType || 'vortex',
      p.threatLevel || 'Normal',
      p.isObserved ? 'YES' : 'NO'
    ]);
    await appendValuesToSheet(token, spreadsheetId, 'Radar Rotation Pins!A2', pinRows);
  }

  // Step 5: Append Gemini Report if exists
  if (data.geminiReport) {
    const temp = data.telemetry?.temperature || '72';
    const dp = data.telemetry?.dewPoint || '68';
    const sbcape = data.telemetry?.cape || '1850';
    const wind = `${data.telemetry?.windSpeed || '15'} mph - ${data.telemetry?.windGust || '25'} mph`;
    const alertsCount = data.alerts ? data.alerts.length : 0;
    const pinsCount = data.rotationPins ? data.rotationPins.length : 0;

    const reportRow = [
      timestamp,
      temp,
      dp,
      sbcape,
      wind,
      alertsCount,
      pinsCount,
      data.geminiReport.substring(0, 32000) // Keep safe cell size limit
    ];
    await appendValuesToSheet(token, spreadsheetId, 'Gemini Reports!A2', [reportRow]);
  }

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    isNew
  };
};

// Append helper function
async function appendValuesToSheet(
  token: string,
  spreadsheetId: string,
  range: string,
  values: any[][]
) {
  const url = `https://sheets.googleapis.com/v1/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      range,
      majorDimension: 'ROWS',
      values,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Failed to append spreadsheet data:', errorData);
    throw new Error(`Failed appending data to range ${range} in spreadsheet.`);
  }
}
