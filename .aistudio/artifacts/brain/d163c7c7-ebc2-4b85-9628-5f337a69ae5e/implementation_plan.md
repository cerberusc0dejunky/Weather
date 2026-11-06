# DAISY UI Simplification & Background Mesoscale-Meteorological Tornado Scoring Engine

Streamlines the DAISY interface by removing all Google Sheets OAuth, administrator sign-in/export controls, the Telemetry Debug toggle, and the visible Mesoscale Discussion card deck—while upgrading the background SPC Mesoscale Discussion engine into a 4-step spatial, temporal, and sounding-based heuristic scoring system that evaluates real-time tornado presence and confidence.

## User Review & Critical Decisions

> [!IMPORTANT]
> Please review the confirmed architectural decisions below and click **Proceed** to apply these changes across the application.

- **Confirmed Decision 1 (Streamlined Zero-Auth Interface)**: Completely remove Google Sheets OAuth, Firebase sign-in popups, the `Admin` login button, `Open Auto-Sync Google Sheet`, `Sync Google Sheet Now`, `Download Log (.CSV)`, `Sign Out`, and the `Telemetry Debug` checkbox so the interface is 100% focused on live storm tracking.
- **Confirmed Decision 2 (Background-Only Mesoscale Discussions)**: Hide the `Mesoscale Discussions` filter toggle button and the collapsible Mesoscale Discussion cards section from the main dashboard, while keeping the background 60-second SPC ingestion active and rendering active watch corridors on the radar map.
- **Confirmed Decision 3 (4-Step Composite Tornado Scoring Engine)**: Combine parsed SPC Mesoscale Discussion categorical threats, Probability of Watch Issuance (PWI), and valid UTC temporal windows with local sounding metrics—**Significant Tornado Parameter (STP)**, **0–1 km Storm-Relative Helicity (SRH)**, **Lifted Condensation Level (LCL)**, and **CAPE / Convective Inhibition (CIN)**—to classify environments into **High Confidence Tornadic**, **Conditional / Capped**, or **Wind/Hail Dominated (Tornado Suppressed)**.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Removes Admin & Telemetry Export Clutter**: Eliminates all login buttons, OAuth modals, spreadsheet sync banners, CSV export buttons, and debug checkboxes from the top bar and settings strip.
  2. **Hides Mesoscale Discussion UI Cards**: Removes the Mesoscale Discussion card grid and toggle button from the Active Proximity Alerts toolbar while maintaining full background SPC ingestion.
  3. **Executes the 4-Step Tornadic Verification Pipeline**:
     - **Step 1 (NLP & Feed Ingestion)**: Extracts categorical threat tokens (`tornado`, `damaging winds`, `hail`), Probability of Watch Issuance (`PWI %`), valid UTC start/expiration timestamps (`Valid DDHHMMZ - DDHHMMZ`), and qualitative urgency (`strong tornado possible`, `PDS`, `conditional threat`) from live SPC Mesoscale Discussions.
     - **Step 2 (Spatial & Temporal Indexing)**: Evaluates point-in-polygon containment and proximity distance against the active GPS probe and pinned Safe Houses, and enforces strict UTC temporal windowing so expired discussions are automatically purged or down-weighted.
     - **Step 3 (Local Sounding & Kinematic Metrics)**: Queries local grid telemetry (Open-Meteo HRRR/GFS convective & wind-shear profile + Windy Point + NWS ASOS surface observations) to compute **LCL height (m)**, **0–1 km SRH ($\text{m}^2/\text{s}^2$)**, **0–6 km bulk wind shear**, **CAPE / CIN ($\text{J/kg}$)**, and the composite **Significant Tornado Parameter (STP)**.
     - **Step 4 (Rule-Based Heuristic Scoring)**: Computes the weighted composite score:
       $$\text{Threat Score} = (W_1 \times \text{MD Watch Probability}) + (W_2 \times \text{STP Score}) + (W_3 \times \text{Low-Level SRH Score})$$
       and applies the three operational gates (**High Confidence Tornadic**, **Conditional / Capped**, and **Null Tornadic / Wind-Hail Only**) to calibrate tornado confidence and atmospheric threat readouts.
- **Target Audience / Persona**: Storm spotters, emergency monitoring users, and everyday residents who want an immediate, zero-login severe weather console backed by meteorological sounding verification.
- **Key Value**: Eliminates false-positive tornado anxiety during routine wind/hail storms while surfacing high-confidence tornadic environments earlier when an active SPC Mesoscale Discussion aligns with low LCLs, high 0–1 km helicity, and elevated STP.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Clean Header & Settings Bar**: The top action bar displays only core operational actions (`Test Siren System`, `Share Gateway`, `Dark/Light Mode`, `App Install Instructions`), and the settings strip contains only alert behavior controls (`Audio Siren`, `Haptic Pulse`, `Strobe Flash`, `High Contrast`, `Browser Alerts`, and `Monitor Radius`).
  2. **Focused Proximity Alerts Filter**: The Active Proximity Alerts filter bar presents a clean two-option segmented control (`All Alerts` and `Headed Towards Me`) without the Mesoscale Discussion card toggle.
  3. **Composite Sounding & Tornado Confidence Readout**: The Atmospheric Telemetry & Instability section displays the live sounding parameters (**STP**, **0–1 km SRH**, **LCL Cloud Base**, **CAPE / CIN**) alongside the active heuristic regime classification (**High Confidence Tornadic**, **Conditional / Capped**, or **Wind/Hail Dominated**) and feeds directly into active warning tornado confidence scores.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-precision meteorological telemetry console with dual light/dark mode support.
  - *Color Palette & Mood*: Deep obsidian slate (`#07090E` / `#0F172A`) in dark mode and crisp lab slate (`#F8FAFC` / `#FFFFFF`) in light mode, paired with semantic telemetry accents—cyan (`#06B6D4`) for active probes, amber (`#F59E0B`) for conditional/mesoscale watch corridors, and crimson (`#F43F5E`) for high-confidence tornadic warnings.
  - *Typography & Hierarchy*: Geometric sans-serif interface labels paired with tabular monospace numerals (`font-mono tabular-nums`) for all kinematic and thermodynamic readouts (`STP`, `SRH`, `LCL`, `CAPE`, `CIN`, and `Threat Score`).
  - *Component Styling & Layout*: Crisp 1px hairline borders, unboxed inline metadata with typographic separators, and zero decorative or unwired controls.
- **Interactive Feedback & Motion**: Right-clicking anywhere on the radar map to relocate the GPS probe immediately recalculates spatial MD polygon containment, fetches local sounding kinematics for that coordinate, and updates the composite Threat Score and tornado confidence in real time.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Complete Removal of OAuth & Spreadsheet Sync Controls**
  - *Chosen Approach*: Remove Firebase Auth initialization, Google Sheets API calls, and all admin login/export buttons from the UI.
  - *Why*: Eliminates external authentication dependencies, domain-whitelisting errors, and GitHub secret-scanning warnings while keeping the UI clean for all users.
  - *Alternatives Considered*: Keeping hidden admin login buttons—rejected because the user requested removing the Google Sheets connection, OAuth login, and export buttons completely.
- **Decision 2: Background SPC Mesoscale Discussion Engine with Strict Temporal Windowing**
  - *Chosen Approach*: Keep the 60-second SPC Mesoscale Discussion parser running silently in the background, parse `Valid DDHHMMZ - DDHHMMZ` UTC timestamps to filter out expired discussions, and feed active discussions into both the radar map overlays and the Step 4 heuristic scoring engine.
  - *Why*: Preserves the early-warning value of SPC human forecaster analysis without cluttering the page with raw text cards.
- **Decision 3: Multi-Parameter Sounding Evaluation (STP + SRH + LCL + CAPE/CIN)**
  - *Chosen Approach*: Derive LCL height from surface temperature-dewpoint spread, query Open-Meteo HRRR/GFS hourly convective inhibition (`convective_inhibition`), CAPE, and multi-level wind vectors (surface/10m vs. 850hPa/500hPa) to calculate low-level helicity ($\text{SRH}_{0\text{-}1\text{km}}$), bulk shear, and the Significant Tornado Parameter ($\text{STP}$).
  - *Why*: Directly implements the 4-step meteorological verification model using free, zero-key public NOAA/Open-Meteo model endpoints combined with live NWS ASOS station data.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DAISY BACKGROUND INGESTION LAYER                      │
├───────────────────────────┬──────────────────────────┬───────────────────────┤
│ Step 1: SPC MD Engine     │ Step 2: Spatial/Temporal │ Step 3: Local Sounding│
│ • NWS SWO (ACUS11) + RSS  │ • Point-in-Polygon Check │ • NWS ASOS (Temp/Dew) │
│ • Threat Tokens (Tornado, │   (GPS Probe & Anchors)  │ • LCL Height (<1000m) │
│   Wind, Hail, PDS)        │ • UTC Valid Time Window  │ • HRRR/GFS CAPE & CIN │
│ • Watch Prob (PWI %)      │   (Purge Expired MDs)    │ • 0-1km SRH & Shear   │
│                           │                          │ • Composite STP Index │
└─────────────┬─────────────┴────────────┬─────────────┴───────────┬───────────┘
              │                          │                         │
              ▼                          ▼                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                 STEP 4: RULE-BASED HEURISTIC SCORING ENGINE                  │
│   Threat Score = (W1 × MD Watch Prob) + (W2 × STP Score) + (W3 × SRH Score)  │
│                                                                              │
│  ┌────────────────────────┐ ┌────────────────────────┐ ┌───────────────────┐ │
│  │ High Confidence        │ │ Conditional / Capped   │ │ Null Tornadic     │ │
│  │ • Active Tornado MD    │ │ • Active Severe MD     │ │ • Inside MD or    │ │
│  │   (PWI >= 80% or PDS)  │ │ • Strong Cap (CIN) or  │ │   Warning Polygon │ │
│  │ • STP > 2.0 & SRH >200 │ │   Weak Shear (SRH<100) │ │ • Low STP / High  │ │
│  │ → Trigger High-Priority│ │ → Flag Conditional     │ │   LCL (>1800m)    │ │
│  │   Tornado Alert        │ │   Initiation Risk      │ │ → Flag Wind/Hail  │ │
│  └────────────────────────┘ └────────────────────────┘ └───────────────────┘ │
└─────────────────────────────┬────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        SIMPLIFIED USER INTERFACE LAYER                       │
├───────────────────────────┬──────────────────────────┬───────────────────────┤
│ Clean Header & Settings   │ Spatial Radar Viewport   │ Proximity Threat Deck │
│ • Siren Test, Share,      │ • Right-Click GPS Probe  │ • All Alerts vs.      │
│   Theme, Install Guide    │ • Warning Polygons +     │   Headed Towards Me   │
│ • No Admin/Sheets/Debug   │   Rotation Pins + MDs    │ • Sounding-Calibrated │
│   Buttons or Checkboxes   │ • Impact ETA Vectors     │   Tornado Confidence  │
└───────────────────────────┴──────────────────────────┴───────────────────────┘
```

### Data Model & State

- **Enhanced `MesoscaleDiscussion` Model**:
  - `threatTypes`: `{ tornado: boolean; wind: boolean; hail: boolean }` extracted via NLP regex from the MD text.
  - `qualitativeSeverity`: `'PDS' | 'STRONG_TORNADO' | 'CONDITIONAL' | 'STANDARD'` parsed from phrases such as `particularly dangerous situation`, `strong tornado possible`, or `conditional threat`.
  - `validStartMs` & `validEndMs`: Parsed UTC timestamps from `Valid DDHHMMZ - DDHHMMZ` to verify active temporal validity (`nowMs >= validStartMs && nowMs <= validEndMs`).
- **Sounding & Composite Scoring State (`ConvectiveSoundingMetrics`)**:
  - `sbcape`: Surface-based / mixed-layer CAPE ($\text{J/kg}$).
  - `cin`: Convective inhibition ($\text{J/kg}$).
  - `lclMeters`: Lifted Condensation Level height ($\text{m}$ AGL), computed from surface temperature and dewpoint depression.
  - `srh01km`: $0\text{–}1\text{ km}$ Storm-Relative Helicity ($\text{m}^2/\text{s}^2$).
  - `bulkShear06kmMph`: $0\text{–}6\text{ km}$ bulk wind shear ($\text{mph}$ / $\text{kts}$).
  - `stp`: Significant Tornado Parameter ($\ge 0.0$, with $> 1.0$ favorable and $> 4.0$ significant).
  - `compositeThreatScore`: Weighted $0\text{–}100$ score combining $W_1 \times \text{MD PWI} + W_2 \times \text{STP Score} + W_3 \times \text{SRH Score}$.
  - `scenario`: `'HIGH_CONFIDENCE_TORNADO' | 'CONDITIONAL_CAPPED' | 'WIND_HAIL_DOMINATED' | 'SUB_SEVERE'`.

### Interactive Component & State Mapping

- **Header & Settings Controls**:
  - Removing `isAdminUser`, `sheetsConnected`, `unauthorizedDomainModal`, and `telemetryDebug` cleans up all OAuth/Sheets handlers and removes unused Firebase imports.
- **Right-Click GPS Probe & Anchor Relocation**:
  - Relocating the GPS probe immediately re-runs Step 2 (spatial point-in-polygon against active temporally valid MDs), Step 3 (fetches local Open-Meteo sounding + NWS ASOS surface temperature/dewpoint for the new coordinate), and Step 4 (recomputes `compositeThreatScore`, `scenario`, and per-alert `predictedTornadoConfidence`).
- **Active Proximity Alerts & Tornado Confidence**:
  - Each active warning card's tornado confidence and threat classification incorporates the Step 4 scenario—boosting confidence when inside a temporally valid Tornadic MD with $\text{STP} > 2.0$ and $\text{SRH} > 200$, or flagging wind/hail dominance when tornadic sounding thresholds are not met.
