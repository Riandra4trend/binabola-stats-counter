"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveSession, loadSession, clearSession } from "@/lib/session";

const MAX_PLAYERS = 25;

export default function SetupPage() {
  const router = useRouter();

  const [step, setStep] = useState("teams"); // "teams" | "jerseys"
  const [homeTeam, setHomeTeam] = useState("HOME");
  const [awayTeam, setAwayTeam] = useState("AWAY");
  const [activeTab, setActiveTab] = useState("home"); // for jersey step

  // jerseys: { home: [{ number, name }], away: [...] }
  const [homeJerseys, setHomeJerseys] = useState([{ number: "", name: "" }]);
  const [awayJerseys, setAwayJerseys] = useState([{ number: "", name: "" }]);

  const [existingSession, setExistingSession] = useState(() => {
    if (typeof window !== "undefined") {
      const s = loadSession();
      return s || null;
    }
    return null;
  });

  const addPlayer = (team) => {
    if (team === "home") {
      if (homeJerseys.length >= MAX_PLAYERS) return;
      setHomeJerseys(prev => [...prev, { number: "", name: "" }]);
    } else {
      if (awayJerseys.length >= MAX_PLAYERS) return;
      setAwayJerseys(prev => [...prev, { number: "", name: "" }]);
    }
  };

  const removePlayer = (team, idx) => {
    if (team === "home") {
      setHomeJerseys(prev => prev.filter((_, i) => i !== idx));
    } else {
      setAwayJerseys(prev => prev.filter((_, i) => i !== idx));
    }
  };

  const updatePlayer = (team, idx, field, value) => {
    if (team === "home") {
      setHomeJerseys(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    } else {
      setAwayJerseys(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    }
  };

  const handleContinueToJerseys = () => {
    if (!homeTeam.trim() || !awayTeam.trim()) return;
    setStep("jerseys");
  };

  const handleStartMatch = () => {
    const validHome = homeJerseys.filter(p => p.number.trim() !== "");
    const validAway = awayJerseys.filter(p => p.number.trim() !== "");

    const sessionData = {
      homeTeam: homeTeam.trim().toUpperCase(),
      awayTeam: awayTeam.trim().toUpperCase(),
      homeJerseys: validHome.map(p => ({ number: p.number.trim(), name: p.name.trim() })),
      awayJerseys: validAway.map(p => ({ number: p.number.trim(), name: p.name.trim() })),
      events: [],
      timerSec: 0,
      selectedTeam: "home",
      selectedJersey: null,
    };

    saveSession(sessionData);
    router.push("/tracker");
  };

  const handleResume = () => {
    router.push("/tracker");
  };

  const handleNewSession = () => {
    clearSession();
    setExistingSession(null);
  };

  // ─── Existing session banner ───
  if (existingSession) {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.badge}>SESSION FOUND</div>
          <h1 style={styles.title}>Match in Progress</h1>
          <p style={styles.subtitle}>
            {existingSession.homeTeam} vs {existingSession.awayTeam}
          </p>
          <p style={{ color: "#555", fontSize: 12, marginBottom: 32, letterSpacing: 1 }}>
            {existingSession.events?.length || 0} events logged
          </p>
          <div style={{ display: "flex", gap: 12, flexDirection: "column" }}>
            <button onClick={handleResume} style={styles.btnPrimary}>
              ▶ RESUME MATCH
            </button>
            <button onClick={handleNewSession} style={styles.btnGhost}>
              + NEW MATCH SESSION
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 1: Team Names ───
  if (step === "teams") {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.badge}>STEP 1 OF 2</div>
          <h1 style={styles.title}>Match Setup</h1>
          <p style={styles.subtitle}>Name your teams before kick-off</p>

          <div style={{ display: "flex", gap: 16, marginTop: 32, flexDirection: "column" }}>
            <div style={styles.fieldGroup}>
              <label style={{ ...styles.label, color: "#3b82f6" }}>🏠 HOME TEAM</label>
              <input
                style={{ ...styles.input, borderColor: "#3b82f6" }}
                value={homeTeam}
                onChange={e => setHomeTeam(e.target.value.toUpperCase())}
                placeholder="HOME"
                maxLength={20}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={{ ...styles.label, color: "#ef4444" }}>✈️ AWAY TEAM</label>
              <input
                style={{ ...styles.input, borderColor: "#ef4444" }}
                value={awayTeam}
                onChange={e => setAwayTeam(e.target.value.toUpperCase())}
                placeholder="AWAY"
                maxLength={20}
              />
            </div>
          </div>

          <button
            onClick={handleContinueToJerseys}
            disabled={!homeTeam.trim() || !awayTeam.trim()}
            style={{
              ...styles.btnPrimary,
              marginTop: 32,
              opacity: (!homeTeam.trim() || !awayTeam.trim()) ? 0.4 : 1,
            }}
          >
            CONTINUE → JERSEY SETUP
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 2: Jersey Numbers ───
  const jerseys = activeTab === "home" ? homeJerseys : awayJerseys;
  const teamColor = activeTab === "home" ? "#3b82f6" : "#ef4444";
  const teamLabel = activeTab === "home" ? homeTeam : awayTeam;

  return (
    <div style={styles.root}>
      <div style={{ ...styles.card, maxWidth: 560, width: "100%" }}>
        <button onClick={() => setStep("teams")} style={styles.backBtn}>← BACK</button>
        <div style={styles.badge}>STEP 2 OF 2</div>
        <h1 style={styles.title}>Jersey Numbers</h1>
        <p style={styles.subtitle}>Add players for each team (optional)</p>

        {/* Tab switcher */}
        <div style={{ display: "flex", marginTop: 24, gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #2a2a3a" }}>
          {["home", "away"].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              flex: 1, padding: "12px 0",
              background: activeTab === t ? (t === "home" ? "#1d4ed8" : "#b91c1c") : "#111",
              color: activeTab === t ? "#fff" : (t === "home" ? "#3b82f6" : "#ef4444"),
              border: "none", fontFamily: "inherit", fontWeight: 900,
              fontSize: 13, cursor: "pointer", letterSpacing: 2,
            }}>
              {t === "home" ? homeTeam : awayTeam}
            </button>
          ))}
        </div>

        {/* Player list */}
        <div style={{ marginTop: 16, maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {jerseys.map((player, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                style={{ ...styles.input, width: 72, textAlign: "center", borderColor: teamColor, fontSize: 18, fontWeight: 900 }}
                value={player.number}
                onChange={e => updatePlayer(activeTab, idx, "number", e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="#"
                maxLength={3}
              />
              <input
                style={{ ...styles.input, flex: 1, borderColor: "#2a2a3a" }}
                value={player.name}
                onChange={e => updatePlayer(activeTab, idx, "name", e.target.value.toUpperCase())}
                placeholder="PLAYER NAME (optional)"
                maxLength={30}
              />
              {jerseys.length > 1 && (
                <button onClick={() => removePlayer(activeTab, idx)} style={{
                  background: "none", border: "none", color: "#555",
                  cursor: "pointer", fontSize: 18, padding: "0 4px",
                }}>×</button>
              )}
            </div>
          ))}
        </div>

        <button onClick={() => addPlayer(activeTab)} style={{ ...styles.btnGhost, marginTop: 10, fontSize: 12 }}>
          + ADD PLAYER
        </button>

        <button onClick={handleStartMatch} style={{ ...styles.btnPrimary, marginTop: 20 }}>
          ⚽ START MATCH
        </button>
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: "100vh",
    background: "#0a0a0f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
    padding: 20,
  },
  card: {
    background: "#0d0d14",
    border: "1px solid #1e1e2e",
    borderRadius: 16,
    padding: "40px 36px",
    maxWidth: 420,
    width: "100%",
    position: "relative",
  },
  badge: {
    fontSize: 10,
    letterSpacing: 3,
    color: "#444",
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 900,
    color: "#f0f0f0",
    margin: 0,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 12,
    color: "#555",
    marginTop: 8,
    letterSpacing: 1,
  },
  label: {
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: 700,
    marginBottom: 6,
    display: "block",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
  },
  input: {
    background: "#111",
    border: "1.5px solid #2a2a3a",
    borderRadius: 8,
    color: "#f0f0f0",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    fontWeight: 700,
    padding: "12px 14px",
    outline: "none",
    letterSpacing: 1,
    width: "100%",
    boxSizing: "border-box",
  },
  btnPrimary: {
    width: "100%",
    padding: "14px 0",
    background: "#15803d",
    border: "none",
    borderRadius: 8,
    color: "#fff",
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 900,
    fontSize: 14,
    letterSpacing: 2,
    cursor: "pointer",
  },
  btnGhost: {
    width: "100%",
    padding: "12px 0",
    background: "transparent",
    border: "1px solid #2a2a3a",
    borderRadius: 8,
    color: "#555",
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: 1,
    cursor: "pointer",
  },
  backBtn: {
    position: "absolute",
    top: 20,
    left: 20,
    background: "none",
    border: "none",
    color: "#555",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    cursor: "pointer",
    letterSpacing: 1,
  },
};