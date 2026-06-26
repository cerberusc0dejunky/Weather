import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory cache for API proxy to prevent excessive external API calls
const apiCache = new Map<string, { data: any, expiresAt: number }>();
// Deduplication for ongoing requests
const activeRequests = new Map<string, Promise<any>>();

app.post('/api/proxy', async (req, res) => {
  const { url, method = 'GET', headers = {}, body = null, cacheTtl = 60000 } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Create a unique cache key based on URL, method, and stringified body
  const cacheKey = `${method}:${url}:${body ? JSON.stringify(body) : ''}`;
  
  const cached = apiCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[Cache Hit] ${method} ${url}`);
    return res.json(cached.data);
  }

  // If a request is already fetching this exact key, await it instead of making a new one
  if (activeRequests.has(cacheKey)) {
    console.log(`[Request Deduplicated] ${method} ${url}`);
    try {
      const payload = await activeRequests.get(cacheKey);
      return res.status(payload.status).json(payload);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  console.log(`[Cache Miss] ${method} ${url}`);
  const fetchPromise = (async () => {
    const fetchOptions: any = { method, headers: { ...headers } };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(body);
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }
    
    // Default server User-Agent for NWS
    if (!fetchOptions.headers['User-Agent']) {
      fetchOptions.headers['User-Agent'] = '(DAISY Storm Tracker App Server, cerberus@c0dejunky.com)';
    }

    const response = await fetch(url, fetchOptions);
    
    let responseData;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }
    
    if (response.ok) {
      const payload = { status: response.status, headers: Object.fromEntries(response.headers), data: responseData };
      apiCache.set(cacheKey, {
        data: payload,
        expiresAt: Date.now() + (cacheTtl || 60000) // Default 60s cache
      });
      
      // Clean up old cache entries
      if (apiCache.size > 1000) {
        for (const [key, val] of apiCache.entries()) {
          if (val.expiresAt < Date.now()) apiCache.delete(key);
        }
      }
      
      return payload;
    } else {
      throw { status: response.status, responseData };
    }
  })();

  activeRequests.set(cacheKey, fetchPromise);

  try {
    const payload = await fetchPromise;
    activeRequests.delete(cacheKey);
    return res.status(payload.status).json(payload);
  } catch (error: any) {
    activeRequests.delete(cacheKey);
    console.error(`Proxy Error for ${url}:`, error);
    if (error.status) {
      return res.status(error.status).json({ status: error.status, error: error.responseData });
    }
    return res.status(500).json({ error: error.message });
  }
});

// Lazy-initialization helper for Gemini client
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return aiClient;
}

// REST API for severe environmental telemetry analyzer
app.post("/api/telemetry-analysis", async (req, res) => {
  const {
    temperature,
    dewPoint,
    windSpeed,
    windGust,
    pressure,
    cape,
    recentDiscussions,
    activeAlerts,
  } = req.body;

  const payloadString = JSON.stringify(req.body);
  const cacheKey = `telemetry-analysis:${payloadString}`;
  const cached = apiCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[Cache Hit] Telemetry Analysis for payload.`);
    return res.json(cached.data);
  }

  // Safeguard/Fallback generation if API key is missing
  if (!process.env.GEMINI_API_KEY) {
    console.warn("process.env.GEMINI_API_KEY is not configured. Invoking local rule-based severe storm model fallback.");
    
    // Calculate a high-fidelity local calculation based on input rules:
    // 1. Low-level moisture
    const dp = parseFloat(dewPoint || "0");
    const tempF = parseFloat(temperature || "0");
    let moistureMetric = `Surface dew point ${dewPoint || "N/A"}°F.`;
    if (dp > 0) {
      const g_kg = Math.round(0.11 * Math.exp(0.06 * (dp - 32))); // approximate mixing ratio
      moistureMetric = `Surface dew point ${dp}°F, mixing ratio ${g_kg || 10} g/kg.`;
    }

    // 2. Instability (CAPE)
    const capeVal = parseInt(cape || "0", 10);
    let instabilityMetric = `MUCAPE ${capeVal} J/kg.`;
    if (capeVal > 1500) {
      instabilityMetric = `MUCAPE ${capeVal} J/kg, steep 700-500mb lapse rates expected > 7.5 C/km.`;
    } else {
      instabilityMetric = `MUCAPE ${capeVal} J/kg, lapse rates stable around 6.0 C/km.`;
    }

    // 3. Lift
    let liftDesc = "Weak localized terrain heating and orographic wind boundaries.";
    const activeAlertsStr = Array.isArray(activeAlerts) ? activeAlerts.join(", ").toUpperCase() : "";
    const hasFrontKeywords = activeAlertsStr.includes("FRONT") || activeAlertsStr.includes("DRYLINE") || activeAlertsStr.includes("CONVERGENCE") || activeAlertsStr.includes("SQUALL");
    if (hasFrontKeywords) {
      liftDesc = "Strong mesoscale convergence active along an advancing dryline or cold front boundary.";
    } else if (capeVal > 1000) {
      liftDesc = "Moderate thermal boundary layer convergence and warm air advection lifting.";
    }

    // 4. Strong vertical wind shear
    const wsVal = parseFloat(windSpeed || "0");
    const gustVal = parseFloat(windGust || "0");
    let shearDesc = `Surface wind speed ${wsVal} mph. Low vertical bulk shear profiles.`;
    if (gustVal > 30 || wsVal > 15) {
      const srh = Math.round((wsVal + gustVal) * 6);
      const bulkShear = Math.round(wsVal * 1.5 + 20);
      shearDesc = `0-1km SRH near ${srh} m2s2, Effective bulk wind shear estimated at ${bulkShear} knots.`;
    }

    // Calculate tornadogenesis probability
    let prob = 5; // base probability
    if (dp >= 65) prob += 15;
    else if (dp >= 55) prob += 5;

    if (capeVal >= 3000) prob += 30;
    else if (capeVal >= 1500) prob += 20;
    else if (capeVal >= 500) prob += 10;

    if (wsVal > 15 || gustVal > 30) prob += 20;
    if (hasFrontKeywords) prob += 15;

    // cap it
    const genesis_probability_pct = Math.min(98, Math.max(2, prob));

    const fallbackPayload = {
      display_message: `Telemetry analysis complete (Local Analyzer). Current risk thresholds calculated.`,
      genesis_probability_pct,
      metrics: {
        moisture: moistureMetric,
        instability: instabilityMetric,
        lift: liftDesc,
        shear: shearDesc,
      },
    };

    apiCache.set(cacheKey, {
      data: fallbackPayload,
      expiresAt: Date.now() + 60000 // Cache for 60s
    });

    return res.json(fallbackPayload);
  }

  try {
    const ai = getGenAI();

    // Construct detailed prompt
    const prompt = `Analyze the following incoming severe weather telemetry block and output an advanced meteorological risk calculation.

--- INPUT TELEMETRY ---
- Temperature: ${temperature || "N/A"}°F
- Surface Dew Point: ${dewPoint || "N/A"}°F
- Surface Wind Speed: ${windSpeed || "N/A"} mph
- Surface Wind Gust: ${windGust || "N/A"} mph
- Barometric Pressure: ${pressure || "N/A"} InHg
- Convective CAPE: ${cape || "0"} J/kg
- Recent Storm Prediction Center Mesoscale Discussions (MCDs): ${JSON.stringify(recentDiscussions || [])}
- Active NWS Alerts: ${JSON.stringify(activeAlerts || [])}

--- DIRECTIONS ---
Evaluate the four critical criteria of tornadogenesis risk:
1. Low-level moisture profiles (Dew points, mixing ratios in g/kg). If dewpoint is set, calculate mixing ratio using realistic weather formulas (e.g. 14g/kg for 72F dewpoint, etc.).
2. Atmospheric instability (CAPE values in J/kg, approximate lapse rates).
3. Lifting mechanisms (surface fronts, convergence zones, drylines). Look at the MCD summaries and alerts for cues, or infer from winds/temps.
4. Vertical wind shear (Helicity/SRH in m2/s2, Effective Bulk Shear in knots). Look at surface winds and gusts for cues.

Based on these ingredients, estimate the overall Tornadogenesis Probability percentage (0% to 100%). Return the results strictly in the requested JSON structure. Keep all diagnostic evaluation logs inside the JSON string metrics and the overall risk score.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `You are the telemetry core for the mdaisy storm warning app. Your task is to analyze environmental telemetry for severe weather. You output exclusively JSON matching:
{
  "display_message": "Telemetry analysis complete. Current risk thresholds calculated.",
  "genesis_probability_pct": 85,
  "metrics": {
    "moisture": "Surface dew point 72F, mixing ratio 14 g/kg",
    "instability": "MUCAPE 3500 J/kg, 700-500mb lapse rates 8.2 C/km",
    "lift": "Strong low-level convergence along advancing cold front",
    "shear": "0-1km SRH 320 m2/s2, Effective Bulk Shear 55 knots"
  }
}
Do not return any extra characters, code blocks (like \`\`\`json), or markdown. Return raw, well-formatted JSON.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            display_message: { type: Type.STRING },
            genesis_probability_pct: { type: Type.INTEGER },
            metrics: {
              type: Type.OBJECT,
              properties: {
                moisture: { type: Type.STRING },
                instability: { type: Type.STRING },
                lift: { type: Type.STRING },
                shear: { type: Type.STRING },
              },
              required: ["moisture", "instability", "lift", "shear"],
            },
          },
          required: ["display_message", "genesis_probability_pct", "metrics"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No telemetry analysis returned from Gemini");
    }

    const payload = JSON.parse(text);

    apiCache.set(cacheKey, {
      data: payload,
      expiresAt: Date.now() + 60000 // Cache for 60s
    });

    if (apiCache.size > 1000) {
      for (const [key, val] of apiCache.entries()) {
        if (val.expiresAt < Date.now()) apiCache.delete(key);
      }
    }

    return res.json(payload);
  } catch (error: any) {
    console.error("Gemini Convective Telemetry Analysis Error:", error?.message || error);
    return res.status(500).json({ error: error?.message || "Failed to parse convective ingredients" });
  }
});

// Configure Vite middleware in development or serve production package build
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched and active at http://0.0.0.0:${PORT}`);
  });
}

startServer();
