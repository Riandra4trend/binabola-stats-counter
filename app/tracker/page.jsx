"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveSession, loadSession, clearSession } from "@/lib/session";

const EVENTS = {
  HIGH: [
    { key: "PASS_SUCCESS", label: "PASS ✓", shortcut: "Q" },
    { key: "PASS_FAIL", label: "PASS ✗", shortcut: "W" },
    { key: "INTERCEPTION", label: "INTERCEPT", shortcut: "E" },
    { key: "TACKLE_SUCCESS", label: "TACKLE ✓", shortcut: "R" },
  ],
  MEDIUM: [
    { key: "DRIVE", label: "DRIVE", shortcut: null },
    { key: "DRIBBLE_SUCCESS", label: "DRIBBLE ✓", shortcut: null },
    { key: "CLEARANCE", label: "CLEARANCE", shortcut: null },
    { key: "BLOCK_SHOT", label: "BLOCK SHOT", shortcut: null },
  ],
  ATTACK: [
    { key: "SHOT_ON_TARGET", label: "SHOT ON 🎯", shortcut: "T" },
    { key: "SHOT_OFF_TARGET", label: "SHOT OFF", shortcut: "Y" },
    { key: "GOAL", label: "⚽ GOAL!", shortcut: "G" },
  ],
  CROSS: [
    { key: "CROSS_SUCCESS", label: "CROSS ✓", shortcut: null },
    { key: "CROSS_FAIL", label: "CROSS ✗", shortcut: null },
    { key: "HIGH_PASS_SUCCESS", label: "HIGH PASS ✓", shortcut: null },
    { key: "HIGH_PASS_FAIL", label: "HIGH PASS ✗", shortcut: null },
  ],
  SET: [
    { key: "FREE_KICK", label: "FREE KICK", shortcut: null },
    { key: "CORNER", label: "CORNER", shortcut: null },
    { key: "THROW_IN", label: "THROW IN", shortcut: null },
    { key: "GOAL_KICK", label: "GOAL KICK", shortcut: null },
    { key: "PENALTY_KICK", label: "PENALTY", shortcut: null },
    { key: "KICK_OFF", label: "KICK OFF", shortcut: null },
  ],
};

const ALL_EVENTS_FLAT = Object.values(EVENTS).flat();

function formatTimeMs(ms) {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  const mm = m < 100 ? String(m).padStart(2, "0") : String(m);
  return `${mm}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

/** Parses MM:SS, MM:SS.m, MM:SS.mm, MM:SS.mmm */
function parseTimeMs(str) {
  const trimmed = str.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+):(\d{1,2})(?:\.(\d{0,3}))?$/);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const sec = parseInt(m[2], 10);
  if (sec > 59) return null;
  let fracMs = 0;
  if (m[3] != null && m[3] !== "") {
    fracMs = parseInt(m[3].padEnd(3, "0").slice(0, 3), 10);
  }
  return min * 60 * 1000 + sec * 1000 + fracMs;
}

function downloadJSON(events) {
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "match_events.json";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(events) {
  const header = "timestamp,team,jersey,player,event\n";
  const rows = events.map(e =>
    `${e.timestamp},${e.team},${e.jersey || ""},${e.playerName || ""},${e.event}`
  ).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "match_events.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function TrackerPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Core state (loaded from session)
  const [selectedTeam, setSelectedTeam] = useState("home");
  const [selectedJersey, setSelectedJersey] = useState(null); // { number, name } | null
  const [events, setEvents] = useState([]);
  const [timerMs, setTimerMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(null);
  const [timerEdit, setTimerEdit] = useState(null);

  const timerMsRef = useRef(0);
  // Stack of { event, timerMsBefore } for proper undo
  const historyRef = useRef([]);

  useEffect(() => {
    timerMsRef.current = timerMs;
  }, [timerMs]);

  // Load session on mount
  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.push("/setup");
      return;
    }
    setSession(s);
    setSelectedTeam(s.selectedTeam || "home");
    setSelectedJersey(s.selectedJersey || null);
    setEvents(s.events || []);
    const t = typeof s.timerMs === "number"
      ? s.timerMs
      : typeof s.timerSec === "number"
        ? s.timerSec * 1000
        : 0;
    setTimerMs(t);
    timerMsRef.current = t;
    setLoaded(true);
  }, []);

  // Persist session on state change
  useEffect(() => {
    if (!loaded || !session) return;
    const updated = {
      ...session,
      selectedTeam,
      selectedJersey,
      events,
      timerMs,
    };
    saveSession(updated);
  }, [selectedTeam, selectedJersey, events, timerMs, loaded]);

  // Timer — 10ms ticks, elapsed from wall clock so display stays aligned to ms
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const baseMs = timerMsRef.current;
    const id = setInterval(() => {
      const next = baseMs + (Date.now() - startedAt);
      setTimerMs(next);
      timerMsRef.current = next;
    }, 10);
    return () => clearInterval(id);
  }, [running]);

  const logEvent = useCallback((eventKey) => {
    const currentTimer = timerMsRef.current;
    const timestamp = formatTimeMs(currentTimer);
    const j = selectedJersey;
    const newEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp,
      timerMs: currentTimer,
      timerSec: Math.floor(currentTimer / 1000),
      team: selectedTeam,
      jersey: j ? j.number : "",
      playerName: j ? (j.name || "") : "",
      event: eventKey,
    };
    historyRef.current.push({ event: newEvent, timerMsBefore: currentTimer });
    setEvents(prev => [newEvent, ...prev]);
    setSelectedJersey(null);
    setFlash({ type: "event", team: selectedTeam, event: eventKey });
    setTimeout(() => setFlash(null), 300);
  }, [selectedTeam, selectedJersey]);

  const removeEventById = useCallback((eventId) => {
    setEvents(prev => prev.filter(e => e.id !== eventId));
    historyRef.current = historyRef.current.filter(h => h.event.id !== eventId);
  }, []);

  const resetMatch = useCallback(() => {
    setRunning(false);
    setTimerMs(0);
    timerMsRef.current = 0;
    setTimerEdit(null);
    setEvents([]);
    historyRef.current = [];
    setSelectedJersey(null);
    setSelectedTeam("home");
    setFlash(null);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const last = historyRef.current.pop();
    setEvents(prev => prev.filter(e => e.id !== last.event.id));
    const prev = last.timerMsBefore ?? (typeof last.timerSecBefore === "number" ? last.timerSecBefore * 1000 : 0);
    setTimerMs(prev);
    timerMsRef.current = prev;
    setRunning(false); // pause after undo
  }, []);

  const commitTimerEdit = useCallback(() => {
    if (timerEdit === null) return;
    const parsed = parseTimeMs(timerEdit);
    setTimerEdit(null);
    if (parsed !== null && parsed >= 0) {
      setTimerMs(parsed);
      timerMsRef.current = parsed;
    }
  }, [timerEdit]);

  const beginTimerEdit = useCallback(() => {
    setRunning(false);
    setTimerEdit(formatTimeMs(timerMsRef.current));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT") return;
      const key = e.key.toUpperCase();

      if ((e.ctrlKey || e.metaKey) && key === "Z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      if (key === "Z") { setSelectedTeam("home"); return; }
      if (key === "X") { setSelectedTeam("away"); return; }

      const match = ALL_EVENTS_FLAT.find(ev => ev.shortcut === key);
      if (match) { e.preventDefault(); logEvent(match.key); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [logEvent, undo]);

  if (!loaded || !session) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a0f", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: "monospace", color: "#555",
      }}>
        Loading session...
      </div>
    );
  }

  // Stats
  const statsHome = {};
  const statsAway = {};
  let scoreHome = 0, scoreAway = 0;
  events.forEach(e => {
    const target = e.team === "home" ? statsHome : statsAway;
    target[e.event] = (target[e.event] || 0) + 1;
    if (e.event === "GOAL") {
      if (e.team === "home") scoreHome++;
      else scoreAway++;
    }
  });

  const teamColor = (team) => team === "home" ? "#3b82f6" : "#ef4444";
  const teamName = (team) => team === "home" ? session.homeTeam : session.awayTeam;
  const currentJerseys = selectedTeam === "home" ? session.homeJerseys : session.awayJerseys;

  const isGoalFlash = flash?.type === "event" && flash?.event === "GOAL";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#f0f0f0",
      fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Goal flash overlay */}
      {isGoalFlash && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: `${teamColor(flash.team)}22`,
          border: `4px solid ${teamColor(flash.team)}`,
          pointerEvents: "none",
          animation: "goalFlash 0.3s ease",
        }} />
      )}

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", borderBottom: "1px solid #222",
        background: "#0d0d14", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: "#3b82f6", letterSpacing: 2 }}>
            {session.homeTeam}
          </span>
        </div>

        {/* Scoreboard */}
        <div style={{
          display: "flex", alignItems: "center",
          background: "#111", border: "1px solid #2a2a3a",
          borderRadius: 8, overflow: "hidden",
        }}>
          <div style={{
            fontSize: 36, fontWeight: 900, padding: "6px 20px",
            color: "#3b82f6", borderRight: "1px solid #2a2a3a",
            minWidth: 60, textAlign: "center",
          }}>{scoreHome}</div>
          <div style={{ fontSize: 13, padding: "0 12px", color: "#555", letterSpacing: 1 }}>VS</div>
          <div style={{
            fontSize: 36, fontWeight: 900, padding: "6px 20px",
            color: "#ef4444", borderLeft: "1px solid #2a2a3a",
            minWidth: 60, textAlign: "center",
          }}>{scoreAway}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: "#ef4444", letterSpacing: 2 }}>
            {session.awayTeam}
          </span>
        </div>
      </div>

      {/* Timer + Controls */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 16, padding: "10px 20px", borderBottom: "1px solid #1a1a2a",
        background: "#0c0c14",
      }}>
        {timerEdit !== null ? (
          <input
            type="text"
            value={timerEdit}
            onChange={(e) => setTimerEdit(e.target.value)}
            onBlur={commitTimerEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTimerEdit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setTimerEdit(null);
              }
            }}
            spellCheck={false}
            aria-label="Edit match time"
            style={{
              fontSize: 42, fontWeight: 900, letterSpacing: 2,
              color: "#e5e5e5",
              fontVariantNumeric: "tabular-nums",
              minWidth: 280, width: 280, textAlign: "center",
              background: "#111", border: "2px solid #3b82f6", borderRadius: 8,
              padding: "4px 8px", fontFamily: "inherit", outline: "none",
            }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            title="Click to edit (MM:SS.mmm)"
            onClick={beginTimerEdit}
            style={{
              fontSize: 42, fontWeight: 900, letterSpacing: 2,
              color: running ? "#22c55e" : "#555",
              fontVariantNumeric: "tabular-nums",
              minWidth: 280, textAlign: "center",
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: "inherit", padding: "4px 8px",
            }}
          >
            {formatTimeMs(timerMs)}
          </button>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setRunning(r => !r)} style={{
            padding: "10px 22px", borderRadius: 6, border: "none",
            background: running ? "#166534" : "#15803d",
            color: "#fff", fontFamily: "inherit", fontWeight: 700,
            fontSize: 13, cursor: "pointer", letterSpacing: 1,
          }}>{running ? "⏸ PAUSE" : "▶ START"}</button>
          <button onClick={resetMatch} style={{
            padding: "10px 16px", borderRadius: 6, border: "1px solid #333",
            background: "#1a1a2a", color: "#888", fontFamily: "inherit",
            fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>↺ RESET</button>
          <button onClick={undo} style={{
            padding: "10px 16px", borderRadius: 6, border: "1px solid #333",
            background: "#1a1a2a", color: "#f59e0b", fontFamily: "inherit",
            fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>⎌ UNDO</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
          <button onClick={() => downloadJSON(events)} style={{
            padding: "8px 14px", borderRadius: 6, border: "1px solid #2a2a3a",
            background: "transparent", color: "#666", fontFamily: "inherit",
            fontSize: 11, cursor: "pointer", letterSpacing: 1,
          }}>↓ JSON</button>
          <button onClick={() => downloadCSV(events)} style={{
            padding: "8px 14px", borderRadius: 6, border: "1px solid #2a2a3a",
            background: "transparent", color: "#666", fontFamily: "inherit",
            fontSize: 11, cursor: "pointer", letterSpacing: 1,
          }}>↓ CSV</button>
          <button onClick={() => { clearSession(); router.push("/setup"); }} style={{
            padding: "8px 14px", borderRadius: 6, border: "1px solid #3a1a1a",
            background: "transparent", color: "#7f1d1d", fontFamily: "inherit",
            fontSize: 11, cursor: "pointer", letterSpacing: 1,
          }}>✕ END</button>
        </div>
      </div>

      {/* Team Selector */}
      <div style={{
        display: "flex", gap: 0, padding: "12px 20px",
        borderBottom: "1px solid #1a1a2a", background: "#0e0e18",
      }}>
        <button onClick={() => { setSelectedTeam("home"); setSelectedJersey(null); }} style={{
          flex: 1, padding: "14px 0", border: "none", borderRadius: "8px 0 0 8px",
          background: selectedTeam === "home" ? "#1d4ed8" : "#111",
          color: selectedTeam === "home" ? "#fff" : "#3b82f6",
          fontFamily: "inherit", fontWeight: 900, fontSize: 16,
          cursor: "pointer", letterSpacing: 2,
          borderRight: "2px solid #0a0a0f",
          transition: "all 0.1s",
          boxShadow: selectedTeam === "home" ? "0 0 20px #3b82f688" : "none",
        }}>
          [Z] ◀ {session.homeTeam}
        </button>
        <button onClick={() => { setSelectedTeam("away"); setSelectedJersey(null); }} style={{
          flex: 1, padding: "14px 0", border: "none", borderRadius: "0 8px 8px 0",
          background: selectedTeam === "away" ? "#b91c1c" : "#111",
          color: selectedTeam === "away" ? "#fff" : "#ef4444",
          fontFamily: "inherit", fontWeight: 900, fontSize: 16,
          cursor: "pointer", letterSpacing: 2,
          borderLeft: "2px solid #0a0a0f",
          transition: "all 0.1s",
          boxShadow: selectedTeam === "away" ? "0 0 20px #ef444488" : "none",
        }}>
          {session.awayTeam} ▶ [X]
        </button>
      </div>

      {/* Main layout */}
      <div style={{ display: "flex", height: "calc(100vh - 240px)", minHeight: 400 }}>
        {/* Event Buttons */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", borderRight: "1px solid #1a1a2a" }}>
          {/* Event sections */}
          <SectionLabel label="HIGH FREQUENCY" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {EVENTS.HIGH.map(ev => (
              <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="large" />
            ))}
          </div>

          <SectionLabel label="MEDIUM" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 }}>
            {EVENTS.MEDIUM.map(ev => (
              <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="medium" />
            ))}
          </div>

          <SectionLabel label="ATTACKING" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: 14 }}>
            {EVENTS.ATTACK.map(ev => (
              <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)}
                size={ev.key === "GOAL" ? "goal" : "medium"} />
            ))}
          </div>

          <SectionLabel label="CROSS & PASSING" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 }}>
            {EVENTS.CROSS.map(ev => (
              <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="medium" />
            ))}
          </div>

          <SectionLabel label="SET PIECES" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 14 }}>
            {EVENTS.SET.map(ev => (
              <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="small" />
            ))}
          </div>
        </div>

        {/* Right panel: Stats + Log */}
        <div style={{ width: 300, display: "flex", flexDirection: "column", background: "#0c0c14" }}>
          {/* Mini stats */}
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid #1a1a2a",
            display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 4,
            fontSize: 10, color: "#666", letterSpacing: 1,
          }}>
            {["PASSES", "SHOTS", "INTERCEPTIONS", "TACKLES"].map(stat => {
              const lKey = stat === "PASSES" ? ["PASS_SUCCESS", "PASS_FAIL"] :
                stat === "SHOTS" ? ["SHOT_ON_TARGET", "SHOT_OFF_TARGET", "GOAL"] :
                stat === "INTERCEPTIONS" ? ["INTERCEPTION"] : ["TACKLE_SUCCESS"];
              const lVal = lKey.reduce((a, k) => a + (statsHome[k] || 0), 0);
              const rVal = lKey.reduce((a, k) => a + (statsAway[k] || 0), 0);
              return [
                <div key={`l${stat}`} style={{ color: "#3b82f6", fontWeight: 700, fontSize: 13, textAlign: "right" }}>{lVal}</div>,
                <div key={`m${stat}`} style={{ textAlign: "center", color: "#444" }}>{stat}</div>,
                <div key={`r${stat}`} style={{ color: "#ef4444", fontWeight: 700, fontSize: 13 }}>{rVal}</div>,
              ];
            })}
          </div>

          <div style={{
            padding: "10px 14px 0",
            borderBottom: "1px solid #1a1a2a",
            flexShrink: 0,
          }}>
            <JerseySelector
              jerseys={currentJerseys}
              selected={selectedJersey}
              onSelect={setSelectedJersey}
              teamColor={teamColor(selectedTeam)}
              teamName={teamName(selectedTeam)}
            />
          </div>

          {/* Event log */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", minHeight: 0 }}>
            <div style={{ padding: "4px 14px 8px", fontSize: 10, color: "#444", letterSpacing: 2 }}>
              EVENT LOG ({events.length})
            </div>
            {events.length === 0 && (
              <div style={{ padding: "20px 14px", color: "#333", fontSize: 12, textAlign: "center" }}>
                No events yet.<br />Pick a side, optionally a jersey, then tap an event.
              </div>
            )}
            {events.map((ev, i) => (
              <div key={ev.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px 5px 14px",
                background: i === 0 ? `${teamColor(ev.team)}15` : "transparent",
                borderLeft: i === 0 ? `3px solid ${teamColor(ev.team)}` : "3px solid transparent",
              }}>
                <span style={{ color: "#555", fontSize: 11, minWidth: 86, fontVariantNumeric: "tabular-nums" }}>{ev.timestamp}</span>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: teamColor(ev.team), flexShrink: 0,
                }} />
                {ev.jersey ? (
                  <span style={{
                    fontSize: 10, color: teamColor(ev.team), fontWeight: 700,
                    minWidth: 24, textAlign: "center",
                    background: `${teamColor(ev.team)}22`,
                    borderRadius: 4, padding: "1px 5px",
                  }}>#{ev.jersey}</span>
                ) : (
                  <span style={{
                    fontSize: 9, color: "#444", fontWeight: 600,
                    minWidth: 24, textAlign: "center",
                    letterSpacing: 0.5,
                  }}>—</span>
                )}
                <span style={{ fontSize: 11, color: "#ccc", letterSpacing: 0.5, flex: 1, minWidth: 0 }}>{ev.event}</span>
                <button
                  type="button"
                  title="Remove this log"
                  onClick={() => removeEventById(ev.id)}
                  style={{
                    flexShrink: 0,
                    padding: "2px 6px",
                    border: "1px solid #2a2a3a",
                    borderRadius: 4,
                    background: "#151520",
                    color: "#555",
                    fontFamily: "inherit",
                    fontSize: 11,
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700;900&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0f; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 2px; }
        @keyframes goalFlash { 0%,100% { opacity:0; } 50% { opacity:1; } }
        @keyframes btnPop { 0% { transform: scale(1); } 50% { transform: scale(0.94); } 100% { transform: scale(1); } }
        @keyframes shake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-6px); } 40%,80% { transform: translateX(6px); } }
      `}</style>
    </div>
  );
}

// ─── Jersey Selector Component ───
function JerseySelector({ jerseys, selected, onSelect, teamColor, teamName }) {
  if (!jerseys || jerseys.length === 0) {
    return (
      <div style={{
        marginBottom: 0, padding: "10px 12px",
        background: "#111", border: "1px solid #2a2a3a", borderRadius: 8,
        fontSize: 11, color: "#444", letterSpacing: 1, textAlign: "center",
      }}>
        No jerseys set for {teamName}. Events will be logged without player #.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: "#444", marginBottom: 7, paddingLeft: 2 }}>
        PLAYER — {teamName}{" "}
        {selected
          ? `(#${selected.number}${selected.name ? " · " + selected.name : ""})`
          : "(NONE = team only)"}
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6,
        maxHeight: 120, overflowY: "auto",
        padding: "8px 10px",
        background: "#0d0d14",
        border: `1px solid ${selected ? teamColor : "#2a2a3a"}`,
        borderRadius: 8,
      }}>
        {/* "No player" chip */}
        <button
          onClick={() => onSelect(null)}
          style={{
            padding: "5px 10px",
            border: `1.5px solid ${!selected ? "#f59e0b" : "#333"}`,
            borderRadius: 6,
            background: !selected ? "#78350f" : "#111",
            color: !selected ? "#fbbf24" : "#555",
            fontFamily: "inherit",
            fontWeight: 700,
            fontSize: 10,
            cursor: "pointer",
            letterSpacing: 1,
          }}
        >
          NONE
        </button>
        {jerseys.map((p, i) => {
          const isSelected = selected?.number === p.number;
          return (
            <button
              key={i}
              onClick={() => onSelect(p)}
              title={p.name || `#${p.number}`}
              style={{
                padding: "5px 10px",
                border: `1.5px solid ${isSelected ? teamColor : "#2a2a3a"}`,
                borderRadius: 6,
                background: isSelected ? `${teamColor}33` : "#111",
                color: isSelected ? teamColor : "#888",
                fontFamily: "inherit",
                fontWeight: 900,
                fontSize: 13,
                cursor: "pointer",
                minWidth: 40,
                textAlign: "center",
                transition: "all 0.1s",
                boxShadow: isSelected ? `0 0 8px ${teamColor}55` : "none",
              }}
            >
              #{p.number}
              {p.name && (
                <span style={{ fontSize: 8, display: "block", color: isSelected ? teamColor : "#555", fontWeight: 400, letterSpacing: 0.5 }}>
                  {p.name.length > 8 ? p.name.slice(0, 7) + "…" : p.name}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionLabel({ label }) {
  return (
    <div style={{ fontSize: 9, letterSpacing: 3, color: "#444", marginBottom: 7, paddingLeft: 2 }}>
      {label}
    </div>
  );
}

function EventBtn({ ev, team, flash, onClick, size }) {
  const isFlashing = flash?.type === "event" && flash?.event === ev.key && flash?.team === team;
  const color = team === "home" ? "#3b82f6" : "#ef4444";
  const activeColor = team === "home" ? "#1d4ed8" : "#b91c1c";
  const isGoal = ev.key === "GOAL";

  const heights = { large: 54, medium: 44, small: 36, goal: 54 };
  const fontSizes = { large: 13, medium: 12, small: 10, goal: 15 };

  return (
    <button
      onClick={onClick}
      style={{
        height: heights[size] || 44,
        border: `1.5px solid ${isFlashing ? color : "#2a2a3a"}`,
        borderRadius: 6,
        background: isFlashing ? activeColor : isGoal ? `${color}22` : "#111",
        color: isGoal ? color : isFlashing ? "#fff" : "#bbb",
        fontFamily: "inherit",
        fontWeight: isGoal ? 900 : 700,
        fontSize: fontSizes[size] || 12,
        letterSpacing: 0.5,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        padding: "4px 6px",
        transition: "background 0.08s, border-color 0.08s, color 0.08s",
        animation: isFlashing ? "btnPop 0.15s ease" : "none",
        boxShadow: isGoal ? `0 0 12px ${color}44` : "none",
      }}
    >
      <span>{ev.label}</span>
      {ev.shortcut && (
        <span style={{ fontSize: 8, color: isFlashing ? "#ffffff88" : "#555", letterSpacing: 1 }}>
          [{ev.shortcut}]
        </span>
      )}
    </button>
  );
}