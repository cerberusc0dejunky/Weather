import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 5500;

app.use(express.json());

// In-memory cache for API proxy to prevent excessive external API calls
const apiCache = new Map<string, { data: any, expiresAt: number }>();
const activeRequests = new Map<string, Promise<any>>();

app.post('/api/proxy', async (req, res) => {
  const { url, method = 'GET', headers = {}, body = null, cacheTtl = 60000 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const cacheKey = `${method}:${url}:${body ? JSON.stringify(body) : ''}`;
  const cached = apiCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[Cache Hit] ${method} ${url}`);
    return res.json(cached.data);
  }

  if (activeRequests.has(cacheKey)) {
    try {
      const payload = await activeRequests.get(cacheKey);
      return res.status(payload.status).json(payload);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  const fetchPromise = (async () => {
    const fetchOptions: any = { method, headers: { ...headers } };
    
    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(body);
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

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
      const payload = {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        data: responseData
      };
      
      apiCache.set(cacheKey, { 
        data: payload, 
        expiresAt: Date.now() + (cacheTtl || 60000) 
      });

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

// REST API for deterministic rule-based telemetry analyzer
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
    return res.json(cached.data);
  }

  try {
    // Standardize input variables
    const t = parseFloat(temperature) || 0;
    const dp = parseFloat(dewPoint) || 0;
    const c = parseFloat(cape) || 0;
    const wspd = parseFloat(windSpeed) || 0;
    const wgust = parseFloat(windGust) || 0;

    const alertsArr = Array.isArray(activeAlerts) ? activeAlerts : [];
    const alertsStr = alertsArr.map((a: any) => JSON.stringify(a)).join(" ").toUpperCase();

    // Base probability starts at 0
    let prob = 0;

    // 1. Instability Contribution (Max +35)
    if (c > 500) prob += 10;
    if (c > 1500) prob += 15;
    if (c > 2500) prob += 10;

    // 2. Moisture Contribution (Max +20)
    if (dp > 60) prob += 10;
    if (dp > 70) prob += 10;

    // 3. Shear / Kinematics (Max +20)
    const differential = Math.max(0, wgust - wspd);
    if (differential > 15) prob += 10;
    if (differential > 30) prob += 10;

    // 4. Lift / Triggers (Max +25)
    if (alertsStr.includes('WARNING') || alertsStr.includes('WATCH')) prob += 10;
    if (alertsStr.includes('TORNADO')) prob += 15;

    // Cap the probability bounds
    prob = Math.min(100, Math.max(0, prob));

    const result = {
      display_message: "Local Rule-Based Telemetry Analysis Complete.",
      genesis_probability_pct: prob,
      metrics: {
        moisture: `Surface Dew Point: ${dp}°F. ${dp >= 65 ? "Highly favorable boundary layer moisture." : "Marginal low-level moisture."}`,
        instability: `SBCAPE: ${c} J/kg. ${c >= 1500 ? "Moderate/High buoyancy supports organized updrafts." : "Stable/Marginal buoyancy."}`,
        lift: alertsStr.includes('WARNING') ? "Strong localized forcing indicated by active severe warnings." : "Ambient frontal lifting/convergence.",
        shear: `Wind differential: ${differential} mph. ${differential > 20 ? "Significant kinematic shear/gust fronts present." : "Weak low-level shear."}`
      }
    };

    apiCache.set(cacheKey, { data: result, expiresAt: Date.now() + 60000 });
    return res.json(result);

  } catch (error: any) {
    console.error("Rule-Based Telemetry Analysis Error:", error);
    return res.status(500).json({ error: "Failed to parse convective ingredients" });
  }
});

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
