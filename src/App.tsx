import React, { useEffect, useState } from "react";

interface TelemetryData {
  display_message: string;
  genesis_probability_pct: number;
  metrics: {
    moisture: string;
    instability: string;
    lift: string;
    shear: string;
  };
}

export default function App() {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch("/api/telemetry-analysis")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Network response premium telemetry failure.");
        }
        return res.json();
      })
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Data acquisition fault, routing to fallback application:", err);
        setHasError(true);
        setLoading(false);
      });
  }, []);

  // Graceful degradation layout framework if rendering or fetching fails
  if (hasError) {
    return (
      <div style={{
        backgroundColor: "#ffffff",
        color: "#00008b",
        fontFamily: "sans-serif",
        textShadow: "0 0 5px rgba(0, 0, 139, 0.3)",
        minHeight: "100vh",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div className="brand-border" style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: "800px",
          padding: "20px",
          backgroundColor: "#ffffff",
          border: "3px solid",
          borderImage: "linear-gradient(to right, pink, aqua) 1",
          boxShadow: "0 2px 5px rgba(255, 105, 180, 0.5), 0 8px 15px rgba(255, 105, 180, 0.3), 0 12px 25px rgba(0, 255, 255, 0.4)"
        }}>
          <h2 style={{
            color: "#ffffff",
            textShadow: "0 0 8px rgba(255, 105, 180, 0.8), 0 0 14px rgba(0, 255, 255, 0.8)",
            margin: "0 0 10px 0",
            textAlign: "center",
            fontSize: "1.5rem"
          }}>
            Telemetry Offline - Deploying Secondary Station
          </h2>

          <p style={{ fontSize: "0.85rem", margin: "0 0 15px 0", textAlign: "center", fontWeight: "bold" }}>
            Advanced analytical core unreachable. Streaming live fallback utility layer instead.
          </p>

          {/* Secure isolated sandbox viewport targeting the baseline deployment */}
          <iframe
            src="https://cc0dejunky.github.io/weather/"
            title="Daisy Core Weather Fallback Viewport"
            style={{
              width: "100%",
              height: "600px",
              border: "1px solid #00008b",
              borderRadius: "4px",
              backgroundColor: "#ffffff"
            }}
            sandbox="allow-scripts allow-same-origin"
          />

          <button
            onClick={() => { window.location.reload(); }}
            style={{
              marginTop: "15px",
              padding: "10px 20px",
              backgroundColor: "#ffffff",
              color: "#00008b",
              border: "2px solid #00008b",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 0 5px rgba(0, 0, 139, 0.2)"
            }}
          >
            Retry Core Telemetry Connection
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        backgroundColor: "#ffffff",
        color: "#00008b",
        fontFamily: "sans-serif",
        textShadow: "0 0 5px rgba(0, 0, 139, 0.3)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        Initializing Core Matrix...
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: "#ffffff",
      color: "#00008b",
      fontFamily: "sans-serif",
      textShadow: "0 0 5px rgba(0, 0, 139, 0.3)",
      minHeight: "100vh",
      padding: "40px 20px",
      display: "flex",
      justifyContent: "center"
    }}>
      <div className="brand-border" style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        maxWidth: "480px",
        padding: "30px",
        backgroundColor: "#ffffff",
        border: "3px solid",
        borderImage: "linear-gradient(to right, pink, aqua) 1",
        boxShadow: "0 2px 5px rgba(255, 105, 180, 0.5), 0 8px 15px rgba(255, 105, 180, 0.3), 0 12px 25px rgba(0, 255, 255, 0.4)"
      }}>

        <h2 style={{
          color: "#ffffff",
          textShadow: "0 0 8px rgba(255, 105, 180, 0.8), 0 0 14px rgba(0, 255, 255, 0.8)",
          margin: "0 0 10px 0",
          textAlign: "center",
          fontSize: "1.75rem"
        }}>
          Convective Tornadogenesis Model
        </h2>

        <p style={{ fontSize: "0.85rem", margin: "0 0 25px 0", textAlign: "center", fontWeight: "bold" }}>
          {data?.display_message}
        </p>

        <div style={{
          width: "160px",
          height: "160px",
          borderRadius: "50%",
          border: "4px solid #00008b",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "30px",
          boxShadow: "inset 0 0 15px rgba(0, 0, 139, 0.2)"
        }}>
          <span style={{ fontSize: "2.5rem", fontWeight: "bold" }}>
            {data?.genesis_probability_pct}%
          </span>
          <span style={{ fontSize: "0.75rem", letterSpacing: "1px", textTransform: "uppercase" }}>
            Probability
          </span>
        </div>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <h3 style={{ color: "#ffffff", textShadow: "0 0 6px #4b0082", margin: "0 0 5px 0", fontSize: "1.1rem" }}>
              1. Thermodynamic Buoyancy
            </h3>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: "1.4" }}>{data?.metrics.instability}</p>
          </div>

          <div>
            <h3 style={{ color: "#ffffff", textShadow: "0 0 6px #4b0082", margin: "0 0 5px 0", fontSize: "1.1rem" }}>
              2. Low-Level Moisture
            </h3>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: "1.4" }}>{data?.metrics.moisture}</p>
          </div>

          <div>
            <h3 style={{ color: "#ffffff", textShadow: "0 0 6px #4b0082", margin: "0 0 5px 0", fontSize: "1.1rem" }}>
              3. Vertical Wind Kinematics
            </h3>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: "1.4" }}>{data?.metrics.shear}</p>
          </div>

          <div>
            <h3 style={{ color: "#ffffff", textShadow: "0 0 6px #4b0082", margin: "0 0 5px 0", fontSize: "1.1rem" }}>
              4. Forced Atmospheric Lift
            </h3>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: "1.4" }}>{data?.metrics.lift}</p>
          </div>
        </div>

        {/* Manual Fallback Toggle Switch Button */}
        <button
          onClick={() => setHasError(true)}
          style={{
            marginTop: "30px",
            fontSize: "0.75rem",
            background: "transparent",
            color: "#00008b",
            border: "1px dashed #00008b",
            padding: "5px 10px",
            cursor: "pointer",
            opacity: 0.6
          }}
        >
          Switch to Basic Station Map View
        </button>

      </div>
    </div>
  );
}