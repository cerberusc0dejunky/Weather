import {
  ConvectiveSoundingMetrics,
  CompositeThreatEvaluation,
  MesoscaleDiscussion,
  TelemetryConditions,
} from '../types';

/**
 * Step 1 Helper: Parse SPC Mesoscale Discussion Valid Time Window (e.g., "051400Z - 051600Z")
 * into strict UTC start and expiration millisecond timestamps.
 */
export function parseSPCValidTimeWindow(
  validTimeStr: string,
  issuanceTimeIso: string
): { validStartMs: number | null; validEndMs: number | null } {
  const issuedDate = issuanceTimeIso ? new Date(issuanceTimeIso) : new Date();
  const baseMs = isNaN(issuedDate.getTime()) ? Date.now() : issuedDate.getTime();
  const baseYear = new Date(baseMs).getUTCFullYear();
  const baseMonth = new Date(baseMs).getUTCMonth();
  const baseDay = new Date(baseMs).getUTCDate();

  // Standard SPC format: "051400Z - 051600Z" (DDHHMMZ - DDHHMMZ)
  const match = validTimeStr.match(/(\d{2})(\d{2})(\d{2})Z\s*-\s*(\d{2})(\d{2})(\d{2})Z/i);
  if (!match) {
    return {
      validStartMs: baseMs,
      validEndMs: baseMs + 3 * 3600 * 1000,
    };
  }

  const startDay = parseInt(match[1], 10);
  const startHour = parseInt(match[2], 10);
  const startMin = parseInt(match[3], 10);

  const endDay = parseInt(match[4], 10);
  const endHour = parseInt(match[5], 10);
  const endMin = parseInt(match[6], 10);

  // Handle month boundaries cleanly
  let startMonth = baseMonth;
  let startYear = baseYear;
  if (baseDay - startDay > 15) {
    startMonth += 1;
    if (startMonth > 11) {
      startMonth = 0;
      startYear += 1;
    }
  } else if (startDay - baseDay > 15) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  let endMonth = startMonth;
  let endYear = startYear;
  if (endDay < startDay) {
    endMonth += 1;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
  }

  const validStartMs = Date.UTC(startYear, startMonth, startDay, startHour, startMin, 0);
  const validEndMs = Date.UTC(endYear, endMonth, endDay, endHour, endMin, 0);

  return { validStartMs, validEndMs };
}

/**
 * Step 1 Helper: NLP & Regular Expression Extraction of Threat Categories and Qualitative Urgency
 * from raw SPC Mesoscale Discussion text.
 */
export function extractMDThreatTokens(
  text: string,
  concerning: string,
  peakTornadoIntensity?: string
): {
  threatTypes: { tornado: boolean; wind: boolean; hail: boolean };
  qualitativeSeverity: 'PDS' | 'STRONG_TORNADO' | 'CONDITIONAL' | 'STANDARD';
} {
  const combined = `${concerning} ${text}`;

  const hasTornado =
    Boolean(peakTornadoIntensity) ||
    /tornado(?:es|ic)?|funnel|landspout|supercell\s+rotation|mesocyclone|low-level\s+shear|srh|stp/i.test(combined);
  const hasWind =
    /damaging\s+wind|wind\s+gust|severe\s+wind|derecho|bow\s+echo|downburst|\b\d{2,3}\s*mph\b/i.test(combined);
  const hasHail =
    /large\s+hail|hail\s+size|severe\s+hail|very\s+large\s+hail|hailstones|\b\d+(?:\.\d+)?\s*in(?:ch)?\s+hail/i.test(
      combined
    );

  let qualitativeSeverity: 'PDS' | 'STRONG_TORNADO' | 'CONDITIONAL' | 'STANDARD' = 'STANDARD';
  if (/particularly\s+dangerous\s+situation|\bPDS\b|intense\s+to\s+violent\s+tornado/i.test(combined)) {
    qualitativeSeverity = 'PDS';
  } else if (
    /strong\s+tornado(?:es)?\s+possible|significant\s+tornado|ef2\+|ef3\+|intense\s+tornado|120\+?\s*mph/i.test(
      combined
    )
  ) {
    qualitativeSeverity = 'STRONG_TORNADO';
  } else if (
    /conditional\s+threat|conditional\s+risk|if\s+storms?\s+can\s+initiate|capping\s+inversion|strong\s+cap/i.test(
      combined
    )
  ) {
    qualitativeSeverity = 'CONDITIONAL';
  }

  return {
    threatTypes: {
      tornado: hasTornado,
      wind: hasWind,
      hail: hasHail,
    },
    qualitativeSeverity,
  };
}

/**
 * Step 2 Helper: Check whether an SPC Mesoscale Discussion is currently within its valid UTC window.
 * Allows a 15-minute grace window prior to start time and purges discussions past their validEndMs.
 */
export function isMesoscaleDiscussionTemporallyValid(md: MesoscaleDiscussion, nowMs: number = Date.now()): boolean {
  if (!md.validStartMs || !md.validEndMs) return true;
  const graceBeforeMs = 15 * 60 * 1000;
  return nowMs >= md.validStartMs - graceBeforeMs && nowMs <= md.validEndMs;
}

/**
 * Step 3: Fetch and Compute Local Meteorological Sounding Metrics (HRRR/GFS Open-Meteo + Surface ASOS + Windy Point)
 * Extracts or derives:
 * - SBCAPE / MLCAPE (J/kg)
 * - Convective Inhibition (CIN magnitude in J/kg)
 * - Lifted Condensation Level (LCL height in meters AGL from T - Td spread)
 * - 0-1 km Storm-Relative Helicity (SRH in m^2/s^2 via Bunkers right-moving storm motion vector)
 * - 0-6 km Bulk Wind Shear (mph)
 * - Significant Tornado Parameter (STP composite index)
 */
export async function fetchLocalSoundingMetrics(
  lat: number,
  lon: number,
  surfaceTelemetry?: TelemetryConditions | null,
  windyTelemetry?: {
    temp?: string;
    dewpoint?: string;
    wind?: string;
    gust?: string;
    pressure?: string;
    cape?: number;
  } | null
): Promise<ConvectiveSoundingMetrics> {
  // Default baseline values
  let sbcape = windyTelemetry?.cape ?? 0;
  let cin = 0;
  let tempC = 20;
  let dewC = 14;

  // Parse live ASOS or Windy surface temperature & dewpoint if available
  const rawTempF = parseFloat(surfaceTelemetry?.temperature || windyTelemetry?.temp || '');
  const rawDewF = parseFloat(surfaceTelemetry?.dewPoint || windyTelemetry?.dewpoint || '');
  if (!isNaN(rawTempF)) {
    tempC = ((rawTempF - 32) * 5) / 9;
  }
  if (!isNaN(rawDewF)) {
    dewC = ((rawDewF - 32) * 5) / 9;
  }

  let wind10mSpdMs = 4;
  let wind10mDirDeg = 180;
  let wind80mSpdMs = 8;
  let wind80mDirDeg = 200;
  let wind850SpdMs = 12;
  let wind850DirDeg = 225;
  let wind500SpdMs = 20;
  let wind500DirDeg = 255;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&current=cape,convective_inhibition,temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m` +
      `&hourly=cape,convective_inhibition,wind_speed_10m,wind_direction_10m,wind_speed_80m,wind_direction_80m,wind_speed_850hPa,wind_direction_850hPa,wind_speed_500hPa,wind_direction_500hPa` +
      `&wind_speed_unit=ms&forecast_days=1`;

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const current = data.current || {};
      const hourly = data.hourly || {};

      if (typeof current.cape === 'number') {
        sbcape = Math.max(sbcape, Math.round(current.cape));
      }
      if (typeof current.convective_inhibition === 'number') {
        cin = Math.abs(Math.round(current.convective_inhibition));
      }
      if (isNaN(rawTempF) && typeof current.temperature_2m === 'number') {
        tempC = current.temperature_2m;
      }
      if (isNaN(rawDewF) && typeof current.dew_point_2m === 'number') {
        dewC = current.dew_point_2m;
      }
      if (typeof current.wind_speed_10m === 'number') {
        wind10mSpdMs = current.wind_speed_10m;
      }
      if (typeof current.wind_direction_10m === 'number') {
        wind10mDirDeg = current.wind_direction_10m;
      }

      // Find closest hourly sounding index
      if (Array.isArray(hourly.time) && hourly.time.length > 0) {
        const nowMs = Date.now();
        let bestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < hourly.time.length; i++) {
          const tMs = new Date(hourly.time[i] + 'Z').getTime();
          const diff = Math.abs(tMs - nowMs);
          if (diff < minDiff) {
            minDiff = diff;
            bestIdx = i;
          }
        }

        if (typeof hourly.cape?.[bestIdx] === 'number') {
          sbcape = Math.max(sbcape, Math.round(hourly.cape[bestIdx]));
        }
        if (typeof hourly.convective_inhibition?.[bestIdx] === 'number') {
          cin = Math.max(cin, Math.abs(Math.round(hourly.convective_inhibition[bestIdx])));
        }
        if (typeof hourly.wind_speed_80m?.[bestIdx] === 'number') {
          wind80mSpdMs = hourly.wind_speed_80m[bestIdx];
        }
        if (typeof hourly.wind_direction_80m?.[bestIdx] === 'number') {
          wind80mDirDeg = hourly.wind_direction_80m[bestIdx];
        }
        if (typeof hourly.wind_speed_850hPa?.[bestIdx] === 'number') {
          wind850SpdMs = hourly.wind_speed_850hPa[bestIdx];
        }
        if (typeof hourly.wind_direction_850hPa?.[bestIdx] === 'number') {
          wind850DirDeg = hourly.wind_direction_850hPa[bestIdx];
        }
        if (typeof hourly.wind_speed_500hPa?.[bestIdx] === 'number') {
          wind500SpdMs = hourly.wind_speed_500hPa[bestIdx];
        }
        if (typeof hourly.wind_direction_500hPa?.[bestIdx] === 'number') {
          wind500DirDeg = hourly.wind_direction_500hPa[bestIdx];
        }
      }
    }
  } catch {
    // Graceful fallback to surface/Windy observations if Open-Meteo is unreachable
  }

  // 1. Lifted Condensation Level (LCL) in meters AGL via Espy's equation: LCL = 125 * (T - Td)
  const spreadC = Math.max(0.5, tempC - dewC);
  const lclMeters = Math.round(125 * spreadC);

  // 2. Convert meteorological wind (speed m/s, direction FROM degrees) into (u, v) components
  const toUV = (spdMs: number, dirFromDeg: number): [number, number] => {
    const rad = ((270 - dirFromDeg) * Math.PI) / 180;
    return [spdMs * Math.cos(rad), spdMs * Math.sin(rad)];
  };

  const [u10, v10] = toUV(wind10mSpdMs, wind10mDirDeg);
  const [u80, v80] = toUV(wind80mSpdMs, wind80mDirDeg);
  const [u850, v850] = toUV(wind850SpdMs, wind850DirDeg);
  const [u500, v500] = toUV(wind500SpdMs, wind500DirDeg);

  // 3. 0-6 km Bulk Wind Shear (difference between 500hPa ~5.5km and 10m surface)
  const shearU = u500 - u10;
  const shearV = v500 - v10;
  const bulkShear06kmMps = Math.hypot(shearU, shearV);
  const bulkShear06kmMph = Math.round(bulkShear06kmMps * 2.23694);

  // 4. Bunkers Right-Moving Supercell Motion Vector (V_RM) & 0-1 km Storm-Relative Helicity (SRH)
  const meanU = (u10 + u80 + u850 + u500) / 4;
  const meanV = (v10 + v80 + v850 + v500) / 4;
  const shearMag = Math.max(0.1, bulkShear06kmMps);
  const devMs = 7.5; // Standard Bunkers 7.5 m/s orthogonal right-mover deviation
  const rmU = meanU + (shearV / shearMag) * devMs;
  const rmV = meanV - (shearU / shearMag) * devMs;

  // Integrate streamwise vorticity across 10m -> 80m -> 850hPa (~1 km layer)
  const srhLayer1 = (u80 - rmU) * (v10 - rmV) - (u10 - rmU) * (v80 - rmV);
  const srhLayer2 = (u850 - rmU) * (v80 - rmV) - (u80 - rmU) * (v850 - rmV);
  const srh01km = Math.max(0, Math.round(srhLayer1 + srhLayer2));

  // 5. Significant Tornado Parameter (STP) - Fixed-Layer SPC Formulation
  const capeTerm = sbcape / 1500;
  const lclTerm = lclMeters < 1000 ? 1.0 : lclMeters > 2000 ? 0.0 : (2000 - lclMeters) / 1000;
  const srhTerm = Math.max(0, srh01km) / 150;
  const shearTerm =
    bulkShear06kmMps < 12.5 ? 0.0 : bulkShear06kmMps > 30 ? 1.5 : bulkShear06kmMps / 20;
  const cinTerm = cin < 50 ? 1.0 : cin > 200 ? 0.0 : (200 - cin) / 150;

  const rawStp = capeTerm * lclTerm * srhTerm * shearTerm * cinTerm;
  const stp = Number(Math.max(0, rawStp).toFixed(2));

  return {
    sbcape,
    cin,
    lclMeters,
    srh01km,
    bulkShear06kmMph,
    stp,
    updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * Step 4: Rule-Based Heuristic Scoring Engine
 * Combines qualitative human assessment from active, temporally-valid SPC Mesoscale Discussions
 * with quantitative local sounding metrics (STP, 0-1 km SRH, LCL, CAPE/CIN):
 *
 * Threat Score = (W1 * MD Watch Probability) + (W2 * STP Score) + (W3 * Low-Level SRH Score)
 */
export function evaluateCompositeTornadoThreat(
  discussions: MesoscaleDiscussion[],
  sounding: ConvectiveSoundingMetrics | null,
  monitorRadiusMiles: number = 25
): CompositeThreatEvaluation {
  const nowMs = Date.now();

  // Filter for temporally valid MDs that intersect or are within monitoring proximity
  const temporallyValidMDs = discussions.filter((md) => isMesoscaleDiscussionTemporallyValid(md, nowMs));
  const relevantMDs = temporallyValidMDs.filter(
    (md) => md.isIntersecting || md.minDist <= monitorRadiusMiles
  );

  // Pick the highest-priority intersecting/nearby MD
  const activeMd =
    relevantMDs.find((md) => md.isIntersecting && md.threatTypes?.tornado) ||
    relevantMDs.find((md) => md.isIntersecting) ||
    relevantMDs[0] ||
    null;

  const sbcape = sounding?.sbcape ?? 0;
  const cin = sounding?.cin ?? 0;
  const lclMeters = sounding?.lclMeters ?? 1400;
  const srh01km = sounding?.srh01km ?? 0;
  const stp = sounding?.stp ?? 0;

  // Component scores normalized to [0, 100]
  let mdProbScore = activeMd ? activeMd.probability : 0;
  if (activeMd?.qualitativeSeverity === 'PDS') {
    mdProbScore = Math.min(100, mdProbScore + 20);
  } else if (activeMd?.qualitativeSeverity === 'STRONG_TORNADO') {
    mdProbScore = Math.min(100, mdProbScore + 10);
  }

  const stpScore = Math.min(100, Math.round((stp / 4.0) * 100));
  const srhScore = Math.min(100, Math.round((srh01km / 300) * 100));

  // Weighted composite heuristic formula: W1 = 0.35, W2 = 0.40, W3 = 0.25
  const W1 = 0.35;
  const W2 = 0.4;
  const W3 = 0.25;
  const threatScore = Math.min(100, Math.round(W1 * mdProbScore + W2 * stpScore + W3 * srhScore));

  // Evaluate operational scenario gates
  const mdMentionsTornado = Boolean(activeMd?.threatTypes?.tornado);
  const mdWatchProb = activeMd?.probability ?? 0;
  const insideMdPolygon = Boolean(activeMd?.isIntersecting);

  // 1. High Confidence Tornadic Scenario:
  // Active MD mentions tornado with >= 80% watch probability (or >= 60% with PDS/Strong Tornado),
  // AND local sounding reports STP > 2.0 and 0-1km SRH > 200 m^2/s^2 (or extreme local STP >= 3.0 & SRH >= 250).
  const isHighConfidenceMdTornado =
    Boolean(activeMd) &&
    mdMentionsTornado &&
    (mdWatchProb >= 80 ||
      (mdWatchProb >= 60 &&
        (activeMd?.qualitativeSeverity === 'PDS' || activeMd?.qualitativeSeverity === 'STRONG_TORNADO'))) &&
    stp >= 2.0 &&
    srh01km >= 200;

  const isExtremeSoundingTornado = stp >= 3.0 && srh01km >= 250 && lclMeters < 1000 && cin < 75;

  if (isHighConfidenceMdTornado || isExtremeSoundingTornado) {
    return {
      threatScore: Math.max(threatScore, 85),
      scenario: 'HIGH_CONFIDENCE_TORNADO',
      scenarioLabel: 'High Confidence Tornadic Environment',
      scenarioReasoning: activeMd
        ? `Active SPC MCD #${activeMd.number} (${mdWatchProb}% Watch Prob, Tornadic) aligns with STP ${stp.toFixed(1)}, 0-1km SRH ${srh01km} m²/s², and LCL ${lclMeters}m.`
        : `Extreme local tornadic sounding parameters verified (STP ${stp.toFixed(1)}, 0-1km SRH ${srh01km} m²/s², LCL ${lclMeters}m).`,
      activeMdNumber: activeMd?.number || null,
      activeMdWatchProb: mdWatchProb,
      activeMdTemporallyValid: Boolean(activeMd),
      activeMdInsidePolygon: insideMdPolygon,
      stpScore,
      srhScore,
      suppressTornadoWarning: false,
      elevateTornadoAlert: true,
    };
  }

  // 2. Null Tornadic (Wind/Hail Dominated) Scenario:
  // Location is inside an active MD polygon (or near severe storms), but local metrics fail to meet
  // minimum tornadic thresholds (STP < 0.8 and SRH < 120 or LCL > 1600m, or MD only specifies wind/hail).
  if (
    activeMd &&
    ((!mdMentionsTornado && (activeMd.threatTypes?.wind || activeMd.threatTypes?.hail)) ||
      (stp < 0.8 && srh01km < 120 && lclMeters > 1500))
  ) {
    return {
      threatScore,
      scenario: 'WIND_HAIL_DOMINATED',
      scenarioLabel: 'Wind / Hail Dominated Regime (Tornado Suppressed)',
      scenarioReasoning: `Inside SPC MCD #${activeMd.number} corridor, but local sounding fails tornadic thresholds (STP ${stp.toFixed(1)}, 0-1km SRH ${srh01km} m²/s², LCL ${lclMeters}m). Linear wind or hail threat dominates.`,
      activeMdNumber: activeMd.number,
      activeMdWatchProb: mdWatchProb,
      activeMdTemporallyValid: true,
      activeMdInsidePolygon: insideMdPolygon,
      stpScore,
      srhScore,
      suppressTornadoWarning: true,
      elevateTornadoAlert: false,
    };
  }

  // 3. Conditional / Low Confidence Scenario:
  // Active MD for severe weather (or elevated CAPE/STP), but local soundings show strong CIN (capped)
  // or weak low-level helicity (SRH < 100 m^2/s^2).
  if (
    activeMd ||
    sbcape >= 1000 ||
    stp >= 1.0 ||
    srh01km >= 150
  ) {
    const isCapped = cin >= 100;
    const isWeakShear = srh01km < 100;
    const reasonParts: string[] = [];
    if (activeMd) {
      reasonParts.push(`SPC MCD #${activeMd.number} active (${mdWatchProb}% PWI)`);
    }
    if (isCapped) {
      reasonParts.push(`strong capping inversion (CIN -${cin} J/kg)`);
    }
    if (isWeakShear) {
      reasonParts.push(`weak low-level helicity (0-1km SRH ${srh01km} m²/s²)`);
    }
    if (!isCapped && !isWeakShear) {
      reasonParts.push(`moderate kinematic support (STP ${stp.toFixed(1)}, LCL ${lclMeters}m)`);
    }

    return {
      threatScore,
      scenario: 'CONDITIONAL_CAPPED',
      scenarioLabel: isCapped || isWeakShear ? 'Conditional / Capped Elevated Risk' : 'Elevated Supercell Environment',
      scenarioReasoning: `${reasonParts.join(' • ')}. Conditional threat requiring storm initiation and boundary interaction.`,
      activeMdNumber: activeMd?.number || null,
      activeMdWatchProb: mdWatchProb,
      activeMdTemporallyValid: Boolean(activeMd),
      activeMdInsidePolygon: insideMdPolygon,
      stpScore,
      srhScore,
      suppressTornadoWarning: false,
      elevateTornadoAlert: stp >= 1.5 && srh01km >= 150,
    };
  }

  // 4. Sub-Severe Baseline Scenario
  return {
    threatScore,
    scenario: 'SUB_SEVERE',
    scenarioLabel: 'Sub-Severe / Non-Tornadic Profile',
    scenarioReasoning: `No active SPC Mesoscale Discussion corridor overhead and local sounding remains below tornadic thresholds (STP ${stp.toFixed(1)}, 0-1km SRH ${srh01km} m²/s², LCL ${lclMeters}m).`,
    activeMdNumber: null,
    activeMdWatchProb: 0,
    activeMdTemporallyValid: false,
    activeMdInsidePolygon: false,
    stpScore,
    srhScore,
    suppressTornadoWarning: true,
    elevateTornadoAlert: false,
  };
}
