"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveSession, loadSession, clearSession } from "@/lib/session";
import { getYouTubeID } from "@/lib/youtube";

/** Plain key + optional Shift (same letter). First-letter conflicts use iconic/alternate letters — see comments. */
const EVENTS = {
  HIGH: [
    { key: "PASS_SUCCESS", label: "PASS SUCCESS", shortcutKey: "P", shortcutShift: false },
    { key: "PASS_FAIL", label: "PASS FAIL", shortcutKey: "P", shortcutShift: true },
    { key: "INTERCEPTION", label: "INTERCEPTION", shortcutKey: "I", shortcutShift: false },
    { key: "TACKLE_SUCCESS", label: "TACKLE SUCCESS", shortcutKey: "T", shortcutShift: false },
  ],
  MEDIUM: [
    { key: "DRIVE", label: "DRIVE", shortcutKey: "D", shortcutShift: false },
    { key: "DRIBBLE_SUCCESS", label: "DRIBBLE SUCCESS", shortcutKey: "D", shortcutShift: true },
    { key: "CLEARANCE", label: "CLEARANCE", shortcutKey: "C", shortcutShift: false },
    { key: "BLOCK_SHOT", label: "BLOCK SHOT", shortcutKey: "B", shortcutShift: false },
  ],
  ATTACK: [
    { key: "SHOT_ON_TARGET", label: "SHOT ON TARGET", shortcutKey: "S", shortcutShift: false },
    { key: "SHOT_OFF_TARGET", label: "SHOT OFF TARGET", shortcutKey: "S", shortcutShift: true },
    { key: "GOAL", label: "GOAL", shortcutKey: "G", shortcutShift: false },
  ],
  CROSS: [
    // "C" taken by CLEARANCE — X = cross
    { key: "CROSS_SUCCESS", label: "CROSS SUCCESS", shortcutKey: "X", shortcutShift: false },
    { key: "CROSS_FAIL", label: "CROSS FAIL", shortcutKey: "X", shortcutShift: true },
    { key: "HIGH_PASS_SUCCESS", label: "HIGH PASS SUCCESS", shortcutKey: "H", shortcutShift: false },
    { key: "HIGH_PASS_FAIL", label: "HIGH PASS FAIL", shortcutKey: "H", shortcutShift: true },
  ],
  SET: [
    { key: "FREE_KICK", label: "FREE KICK", shortcutKey: "F", shortcutShift: false },
    // "C" taken — R = corner
    { key: "CORNER", label: "CORNER", shortcutKey: "R", shortcutShift: false },
    { key: "THROW_IN", label: "THROW IN", shortcutKey: "W", shortcutShift: false },
    { key: "GOAL_KICK", label: "GOAL KICK", shortcutKey: "K", shortcutShift: false },
    { key: "PENALTY_KICK", label: "PENALTY KICK", shortcutKey: "N", shortcutShift: false },
    // "K" taken by GOAL_KICK — O = kickOff
    { key: "KICK_OFF", label: "KICK OFF", shortcutKey: "O", shortcutShift: false },
  ],
};

const ALL_EVENTS_FLAT = Object.values(EVENTS).flat();

function shortcutLabel(ev) {
  if (!ev.shortcutKey) return null;
  return ev.shortcutShift ? `⇧${ev.shortcutKey}` : ev.shortcutKey;
}

function formatTimeMs(ms) {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const mmm = String(milli).padStart(3, "0");
  
  return `${hh}:${mm}:${ss}.${mmm}`;
}

/** Parses MM:SS, MM:SS.m, MM:SS.mm, MM:SS.mmm */
function parseTimeMs(str) {
  const trimmed = str.trim();
  if (!trimmed) return null;
  // Matches HH:MM:SS.mmm or MM:SS.mmm
  const m = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{0,3}))?$/);
  if (!m) return null;
  
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  
  if (min > 59 || sec > 59) return null;
  
  let fracMs = 0;
  if (m[4] != null && m[4] !== "") {
    fracMs = parseInt(m[4].padEnd(3, "0").slice(0, 3), 10);
  }
  
  return (hours * 3600 + min * 60 + sec) * 1000 + fracMs;
}

function eventTimerMs(ev) {
  if (typeof ev.timerMs === "number") return ev.timerMs;
  if (typeof ev.timerSec === "number") return ev.timerSec * 1000;
  return 0;
}

function downloadJSON(events) {
  const exportData = [...events]
    .sort((a, b) => a.timerMs - b.timerMs)
    .map(e => {
      const item = {
        gameTime: formatTimeMs(e.timerMs),
        label: e.event,
        position: String(Math.floor(e.timerMs)),
        team: e.team, // already "left" or "right"
      };
      if (e.jersey) {
        item.playerNumber = parseInt(e.jersey, 10);
      }
      return item;
    });

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "match_events.json";
  a.click();
  URL.revokeObjectURL(url);
}


export default function TrackerPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Core state (loaded from session)
  const [selectedTeam, setSelectedTeam] = useState("left");
  const [selectedJersey, setSelectedJersey] = useState(null); // { number, name } | null
  const [events, setEvents] = useState([]);
  const [timerMs, setTimerMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(null);
  const [timerEdit, setTimerEdit] = useState(null);
  const [showStats, setShowStats] = useState(false);
  
  // YouTube State
  const [videoId, setVideoId] = useState(null);
  const [player, setPlayer] = useState(null);
  const [streamStartTime, setStreamStartTime] = useState(null); // When "START" is clicked
  const [isLive, setIsLive] = useState(false);
  
  const timerMsRef = useRef(0);
  const eventsRef = useRef([]);
  const runningRef = useRef(false);
  const playerRef = useRef(null);
  const streamStartTimeRef = useRef(null);
  // Stack: normal { event, timerMsBefore } or passCorrection { kind, ... }
  const historyRef = useRef([]);
  const logContainerRef = useRef(null);

  useEffect(() => {
    timerMsRef.current = timerMs;
  }, [timerMs]);

  useEffect(() => {
    streamStartTimeRef.current = streamStartTime;
  }, [streamStartTime]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    eventsRef.current = events;
    // Auto-scroll log to end on new event
    if (logContainerRef.current) {
      logContainerRef.current.scrollLeft = logContainerRef.current.scrollWidth;
    }
  }, [events]);

  // Load session on mount
  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.push("/setup");
      return;
    }
    setSession(s);
    setSelectedTeam(s.selectedTeam || "left");
    setSelectedJersey(s.selectedJersey || null);
    setEvents(s.events || []);
    const t = typeof s.timerMs === "number"
      ? s.timerMs
      : typeof s.timerSec === "number"
        ? s.timerSec * 1000
        : 0;
    setTimerMs(t);
    timerMsRef.current = t;
    
    if (s.youtubeUrl) {
      setVideoId(getYouTubeID(s.youtubeUrl));
    }
    if (typeof s.streamStartTime === "number") {
      setStreamStartTime(s.streamStartTime);
    }
    
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
      streamStartTime,
    };
    saveSession(updated);
  }, [selectedTeam, selectedJersey, events, timerMs, loaded, streamStartTime]);

  // ── YouTube Player Mounting ──
  useEffect(() => {
    if (!videoId || typeof window === "undefined") return;
    
    const mountPlayer = () => {
      if (!window.YT?.Player) return;
      if (playerRef.current) {
        playerRef.current.destroy();
      }
      playerRef.current = new window.YT.Player("youtube-player", {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: { rel: 0, modestbranding: 1, autoplay: 0 },
        events: {
          onReady: () => {
            setIsLive(true);
          },
          onStateChange: (event) => {
            // event.data: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (video cued)
            if (event.data === 1) setRunning(true);
            if (event.data === 2) setRunning(false);
          }
        },
      });
      setPlayer(playerRef.current);
    };

    if (window.YT?.Player) {
      mountPlayer();
    } else {
      window.onYouTubeIframeAPIReady = mountPlayer;
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(script);
      }
    }
    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId]);

  // Timer — 10ms ticks
  useEffect(() => {
    if (!running) return;
    
    // If YouTube is active, poll the player
    if (videoId) {
      const id = setInterval(() => {
        if (!playerRef.current?.getCurrentTime || typeof playerRef.current.getCurrentTime !== "function") return;
        try {
          const currentStreamTime = playerRef.current.getCurrentTime();
          // Always show the live timer (stream duration)
          const next = currentStreamTime * 1000;
          setTimerMs(next);
          timerMsRef.current = next;
        } catch (err) {
          // Fallback if poll fails
        }
      }, 100);
      return () => clearInterval(id);
    }

    // Default Fallback: Wall clock timer
    const startedAt = Date.now();
    const baseMs = timerMsRef.current;
    const id = setInterval(() => {
      const next = baseMs + (Date.now() - startedAt);
      setTimerMs(next);
      timerMsRef.current = next;
    }, 10);
    return () => clearInterval(id);
  }, [running, videoId, streamStartTime]);

  const logEvent = useCallback((eventKey) => {
    const currentTimer = timerMsRef.current;
    const timestamp = formatTimeMs(currentTimer);
    const j = selectedJersey;
    const mkId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const newest = eventsRef.current[0];
    /**
     * Latest row is PASS ✓ for one side; next action (nothing in between) is either:
     * - PASS ✓ or PASS ✗ for the other side, or
     * - INTERCEPTION for the other side
     * → prior PASS ✓ becomes PASS ✗, then log the new row.
     */
    const isOppositePassFollowUp =
      eventKey === "PASS_SUCCESS" || eventKey === "PASS_FAIL";
    const isOppositeInterceptionFollowUp = eventKey === "INTERCEPTION";
    const shouldCorrectPass =
      newest &&
      newest.event === "PASS_SUCCESS" &&
      newest.team !== selectedTeam &&
      (newest.team === "left" || newest.team === "right") &&
      (selectedTeam === "left" || selectedTeam === "right") &&
      (isOppositePassFollowUp || isOppositeInterceptionFollowUp);

    if (shouldCorrectPass) {
      const origMs = eventTimerMs(newest);
      const correctedFirst = {
        ...newest,
        event: "PASS_FAIL",
        timestamp: formatTimeMs(origMs),
        timerMs: origMs,
        timerSec: Math.floor(origMs / 1000),
      };
      const loggedEvent = {
        id: mkId(),
        timestamp,
        timerMs: currentTimer,
        timerSec: Math.floor(currentTimer / 1000),
        streamTime: playerRef.current?.getCurrentTime() || null,
        team: selectedTeam,
        jersey: j ? j.number : "",
        playerName: j ? (j.name || "") : "",
        event: eventKey,
      };
      historyRef.current.push({
        kind: "passCorrection",
        timerMsBefore: currentTimer,
        newEventIds: [loggedEvent.id],
        correctedEventId: newest.id,
        previousCorrectedEvent: newest,
      });
      setEvents((prev) => {
        const first = prev[0];
        if (!first || first.id !== newest.id) {
          historyRef.current.pop();
          const fallback = {
            id: mkId(),
            timestamp,
            timerMs: currentTimer,
            timerSec: Math.floor(currentTimer / 1000),
            streamTime: playerRef.current?.getCurrentTime() || null,
            team: selectedTeam,
            jersey: j ? j.number : "",
            playerName: j ? (j.name || "") : "",
            event: eventKey,
          };
          historyRef.current.push({ event: fallback, timerMsBefore: currentTimer });
          return [fallback, ...prev];
        }
        return [loggedEvent, correctedFirst, ...prev.slice(1)];
      });
      setSelectedJersey(null);
      if (videoId && playerRef.current) {
        playerRef.current.playVideo?.();
      }
      setRunning(true);
      setFlash({ type: "event", team: selectedTeam, event: eventKey });
      setTimeout(() => setFlash(null), 300);
      return;
    }

    const newEvent = {
      id: mkId(),
      timestamp,
      timerMs: currentTimer,
      timerSec: Math.floor(currentTimer / 1000),
      streamTime: playerRef.current?.getCurrentTime() || null, // Capture raw stream time
      team: selectedTeam,
      jersey: j ? j.number : "",
      playerName: j ? (j.name || "") : "",
      event: eventKey,
    };
    historyRef.current.push({ event: newEvent, timerMsBefore: currentTimer });
    setEvents(prev => [newEvent, ...prev]);
    setSelectedJersey(null);
    // Paused → start clock; already running → leave running (never pause on event)
    if (videoId && playerRef.current) {
      playerRef.current.playVideo?.();
    }
    setRunning(true);
    setFlash({ type: "event", team: selectedTeam, event: eventKey });
    setTimeout(() => setFlash(null), 300);
  }, [selectedTeam, selectedJersey]);

  const removeEventById = useCallback((eventId) => {
    setEvents(prev => prev.filter(e => e.id !== eventId));
    historyRef.current = historyRef.current.filter((h) => {
      if (h.kind === "passCorrection") {
        return !h.newEventIds.includes(eventId) && h.correctedEventId !== eventId;
      }
      return h.event?.id !== eventId;
    });
  }, []);

  const resetMatch = useCallback(() => {
    setRunning(false);
    setTimerMs(0);
    timerMsRef.current = 0;
    setTimerEdit(null);
    setEvents([]);
    historyRef.current = [];
    setSelectedJersey(null);
    setSelectedTeam("left");
    setFlash(null);
    setStreamStartTime(null);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const last = historyRef.current.pop();
    if (last.kind === "passCorrection") {
      setEvents((prev) => {
        const without = prev.filter(e => !last.newEventIds.includes(e.id));
        return without.map(e =>
          e.id === last.correctedEventId ? last.previousCorrectedEvent : e,
        );
      });
      const t = last.timerMsBefore ?? 0;
      setTimerMs(t);
      timerMsRef.current = t;
      
      if (videoId && playerRef.current) {
        playerRef.current.pauseVideo?.();
        playerRef.current.seekTo?.(t / 1000, true);
      }
      
      setRunning(false);
      return;
    }
    setEvents(prev => prev.filter(e => e.id !== last.event.id));
    const prev = last.timerMsBefore ?? (typeof last.timerSecBefore === "number" ? last.timerSecBefore * 1000 : 0);
    setTimerMs(prev);
    timerMsRef.current = prev;
    
    // Seek and pause video back on undo
    if (videoId && playerRef.current) {
      playerRef.current.pauseVideo?.();
      playerRef.current.seekTo?.(prev / 1000, true);
    }
    
    setRunning(false); // pause after undo
  }, [videoId]);

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
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedTeam("left");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedTeam("right");
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        const isRunning = runningRef.current;
        if (videoId && playerRef.current) {
          if (isRunning) playerRef.current.pauseVideo?.();
          else playerRef.current.playVideo?.();
        }
        setRunning(!isRunning);
        return;
      }

      const key = e.key.toUpperCase();

      if (e.key === "Backspace") {
        e.preventDefault();
        undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "Z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      if (e.key.length === 1) {
        const upper = e.key.toUpperCase();
        const matches = ALL_EVENTS_FLAT.filter(
          (ev) => ev.shortcutKey && ev.shortcutKey.toUpperCase() === upper,
        );
        const match = matches.find((ev) => !!ev.shortcutShift === e.shiftKey);
        if (match) {
          e.preventDefault();
          logEvent(match.key);
        }
      }
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
  const statsLeft = {};
  const statsRight = {};
  let scoreLeft = 0, scoreRight = 0;
  events.forEach(e => {
    const target = e.team === "left" ? statsLeft : statsRight;
    target[e.event] = (target[e.event] || 0) + 1;
    if (e.event === "GOAL") {
      if (e.team === "left") scoreLeft++;
      else scoreRight++;
    }
  });

  const teamColor = (team) => team === "left" ? "#3b82f6" : "#ef4444";
  const teamName = (team) => team === "left" ? session.leftTeam : session.rightTeam;
  const currentJerseys = selectedTeam === "left" ? session.leftJerseys : session.rightJerseys;

  // ── Stats Calculation ──
  const calcStats = () => {
    const s = {
      left: { goals: 0, actions: 0, onTarget: 0, offTarget: 0, blockedByOpp: 0, passOk: 0, passFail: 0, dribbleOk: 0, def: 0 },
      right: { goals: 0, actions: 0, onTarget: 0, offTarget: 0, blockedByOpp: 0, passOk: 0, passFail: 0, dribbleOk: 0, def: 0 }
    };

    events.forEach(e => {
      const t = e.team; // "left" or "right"
      const opp = t === "left" ? "right" : "left";
      s[t].actions++;

      if (e.event === "GOAL") s[t].goals++;
      if (e.event === "SHOT_ON_TARGET") s[t].onTarget++;
      if (e.event === "SHOT_OFF_TARGET") s[t].offTarget++;
      if (e.event === "BLOCK_SHOT") {
        s[t].def++;
        s[opp].blockedByOpp++;
      }
      if (e.event === "PASS_SUCCESS" || e.event === "HIGH_PASS_SUCCESS") s[t].passOk++;
      if (e.event === "PASS_FAIL" || e.event === "HIGH_PASS_FAIL") s[t].passFail++;
      if (e.event === "DRIBBLE_SUCCESS") s[t].dribbleOk++;
      if (e.event === "INTERCEPTION" || e.event === "TACKLE_SUCCESS" || e.event === "CLEARANCE") s[t].def++;
    });

    const totalActions = s.left.actions + s.right.actions || 1;
    const lShots = s.left.onTarget + s.left.offTarget + s.right.blockedByOpp;
    const rShots = s.right.onTarget + s.right.offTarget + s.left.blockedByOpp;
    const lPassAtt = s.left.passOk + s.left.passFail;
    const rPassAtt = s.right.passOk + s.right.passFail;

    const fmtPct = (num, den) => den === 0 ? "0%" : `${Math.round((num / den) * 100)}%`;
    
    // Ensure possession sums to 100%
    const lPoss = Math.round((s.left.actions / totalActions) * 100);
    const rPoss = 100 - lPoss;

    return [
      { label: "Goals", left: s.left.goals, right: s.right.goals },
      { label: "Possession", left: `${lPoss}%`, right: `${rPoss}%` },
      { label: "Total Shots", left: lShots, right: rShots },
      { label: "Shot Accuracy", left: fmtPct(s.left.onTarget, s.left.onTarget + s.left.offTarget), right: fmtPct(s.right.onTarget, s.right.onTarget + s.right.offTarget) },
      { label: "Pass Attempts", left: lPassAtt, right: rPassAtt },
      { label: "Pass Accuracy", left: fmtPct(s.left.passOk, lPassAtt), right: fmtPct(s.right.passOk, rPassAtt) },
      { label: "Successful Dribbles", left: s.left.dribbleOk, right: s.right.dribbleOk },
      { label: "Defensive Actions", left: s.left.def, right: s.right.def },
    ];
  };

  const isGoalFlash = flash?.type === "event" && flash?.event === "GOAL";

  return (
    <div style={{
        display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden"
      }}>
        {/* Header - Compact Score & Status */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 20px", borderBottom: "1px solid #222",
          background: "#0d0d14", gap: 12, height: 60, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 15, flex: 1 }}>
            <span style={{ fontSize: 24, fontWeight: 900, color: "#3b82f6", letterSpacing: 1 }}>
              {session.leftTeam}
            </span>
            <div style={{
              fontSize: 32, fontWeight: 900, width: 60, height: 50,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#111", border: "1px solid #2a2a3a", borderRadius: 8,
              color: "#3b82f6",
            }}>{scoreLeft}</div>
            
            {videoId && (
              <div style={{
                fontSize: 9, color: player ? "#22c55e" : "#555",
                display: "flex", alignItems: "center", gap: 4,
                fontWeight: 700, letterSpacing: 1, marginLeft: 10
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: player ? "#22c55e" : "#555",
                }} />
                {player ? "SYNCED" : "OFFLINE"}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button 
              onClick={() => setShowStats(true)}
              style={{
                fontSize: 10, color: "#3b82f6", background: "rgba(59, 130, 246, 0.1)",
                border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: 4,
                padding: "2px 8px", cursor: "pointer", fontWeight: 700, letterSpacing: 1,
                marginBottom: 4, transition: "all 0.2s"
              }}
              onMouseEnter={e => e.target.style.background = "rgba(59, 130, 246, 0.2)"}
              onMouseLeave={e => e.target.style.background = "rgba(59, 130, 246, 0.1)"}
            >
              📊 LIVE STATS
            </button>
            <div style={{ fontSize: 10, color: "#444", letterSpacing: 2 }}>MATCH TIME</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, justifyContent: "flex-end" }}>
            <div style={{
              fontSize: 24, fontWeight: 900, padding: "2px 12px",
              background: "#111", border: "1px solid #2a2a3a", borderRadius: 6,
              color: "#ef4444", minWidth: 40, textAlign: "center",
            }}>{scoreRight}</div>
            <span style={{ fontSize: 18, fontWeight: 900, color: "#ef4444", letterSpacing: 1 }}>
              {session.rightTeam}
            </span>
          </div>
        </div>

        {/* Main Work Area */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          
          {/* Left Column: Video + Primary Controls */}
          <div style={{ flex: 7, display: "flex", flexDirection: "column", borderRight: "1px solid #1a1a2a", minWidth: 0 }}>
            {/* Large Video Player */}
            <div style={{ flex: 1, background: "#000", position: "relative" }}>
              {videoId ? (
                <div id="youtube-player" style={{ width: "100%", height: "100%" }} />
              ) : (
                <div style={{
                  height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#333", fontSize: 14, fontStyle: "italic"
                }}>
                  No video provided in setup
                </div>
              )}
            </div>

            {/* Timer & Playback Controls Bar */}
            <div style={{
              padding: "16px 24px", background: "#0c0c14", borderTop: "1px solid #1a1a2a",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20
            }}>
              {timerEdit !== null ? (
                <input
                  type="text"
                  value={timerEdit}
                  onChange={(e) => setTimerEdit(e.target.value)}
                  onBlur={commitTimerEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitTimerEdit(); }
                    if (e.key === "Escape") { e.preventDefault(); setTimerEdit(null); }
                  }}
                  style={{
                    fontSize: 48, fontWeight: 900, letterSpacing: 2, color: "#e5e5e5",
                    fontVariantNumeric: "tabular-nums", width: 340, textAlign: "center",
                    background: "#111", border: "2px solid #3b82f6", borderRadius: 12,
                    padding: "4px 12px", fontFamily: "inherit", outline: "none",
                  }}
                  autoFocus
                />
              ) : (
                <button
                  onClick={beginTimerEdit}
                  style={{
                    fontSize: 48, fontWeight: 900, letterSpacing: 2,
                    color: running ? "#22c55e" : "#555",
                    fontVariantNumeric: "tabular-nums", minWidth: 340, textAlign: "center",
                    background: "transparent", border: "none", cursor: "pointer",
                    fontFamily: "inherit", padding: "4px 12px",
                  }}
                >
                  {formatTimeMs(timerMs)}
                </button>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => {
                  if (videoId && playerRef.current) {
                    if (running) playerRef.current.pauseVideo?.();
                    else playerRef.current.playVideo?.();
                  }
                  setRunning(r => !r);
                }} style={{
                  padding: "12px 24px", borderRadius: 8, border: "none",
                  background: running ? "#166534" : "#15803d",
                  color: "#fff", fontFamily: "inherit", fontWeight: 700,
                  fontSize: 14, cursor: "pointer", letterSpacing: 1, minWidth: 120,
                }}>{running ? "⏸ PAUSE" : "▶ START"}</button>
                
                <button onClick={() => {
                  if (playerRef.current?.seekTo) {
                    const next = Math.max(0, playerRef.current.getCurrentTime() - 5);
                    playerRef.current.seekTo(next, true);
                  }
                }} style={{
                  padding: "12px 18px", borderRadius: 8, border: "1px solid #3b82f6",
                  background: "#1e3a8a", color: "#fff", fontFamily: "inherit",
                  fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>-5s</button>
                
                <button onClick={() => {
                  if (playerRef.current?.seekTo) {
                    const next = playerRef.current.getCurrentTime() + 5;
                    playerRef.current.seekTo(next, true);
                  }
                }} style={{
                  padding: "12px 18px", borderRadius: 8, border: "1px solid #3b82f6",
                  background: "#1e3a8a", color: "#fff", fontFamily: "inherit",
                  fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>+5s</button>

                <button onClick={undo} style={{
                  padding: "12px 18px", borderRadius: 8, border: "1px solid #333",
                  background: "#1a1a2a", color: "#f59e0b", fontFamily: "inherit",
                  fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>⎌ UNDO</button>
              </div>
            </div>

            {/* Event Log (Horizontal Strip) - Chronological Order (Oldest to Newest) */}
            <div 
              ref={logContainerRef}
              style={{
                height: 110, overflowX: "auto", display: "flex", gap: 12,
                padding: "0 24px", background: "#0a0a0f", borderTop: "1px solid #1a1a2a",
                alignItems: "center", flexShrink: 0
              }}
            >
              {events.length === 0 ? (
                <div style={{ color: "#333", fontSize: 12, fontStyle: "italic" }}>No events logged yet</div>
              ) : [...events].sort((a, b) => a.timerMs - b.timerMs).map((ev, i) => (
                <div key={ev.id} style={{
                  flexShrink: 0, padding: "10px 14px", background: "#111",
                  border: "1.5px solid #222", borderRadius: 10,
                  display: "flex", flexDirection: "column", gap: 3, minWidth: 160, position: "relative",
                  transition: "all 0.2s"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "#666", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{ev.timestamp.split('.')[0]}</span>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: teamColor(ev.team), boxShadow: `0 0 8px ${teamColor(ev.team)}88` }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#ccc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {ev.jersey && <span style={{ color: teamColor(ev.team), marginRight: 6 }}>#{ev.jersey}</span>}
                    {ev.event.replace(/_/g, ' ')}
                  </div>
                  <button onClick={() => removeEventById(ev.id)} style={{
                    position: "absolute", top: -8, right: -8, width: 22, height: 22,
                    background: "#7f1d1d", color: "#fff", border: "2px solid #0a0a0f", borderRadius: "50%",
                    fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.5)"
                  }}>×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Team Selection + Event Buttons */}
          <div style={{ flex: 3, display: "flex", flexDirection: "column", background: "#0e0e18", minWidth: 0 }}>
            {/* Team Selection Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #1a1a2a" }}>
              <button onClick={() => { setSelectedTeam("left"); setSelectedJersey(null); }} style={{
                flex: 1, padding: "16px 0", border: "none",
                background: selectedTeam === "left" ? "#1d4ed8" : "transparent",
                color: "#fff", fontFamily: "inherit", fontWeight: 900, fontSize: 14, cursor: "pointer", letterSpacing: 1,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4
              }}>
                <span>{session.leftTeam}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>[← ARROW]</span>
              </button>
              <button onClick={() => { setSelectedTeam("right"); setSelectedJersey(null); }} style={{
                flex: 1, padding: "16px 0", border: "none",
                background: selectedTeam === "right" ? "#b91c1c" : "transparent",
                color: "#fff", fontFamily: "inherit", fontWeight: 900, fontSize: 14, cursor: "pointer", letterSpacing: 1,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4
              }}>
                <span>{session.rightTeam}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>[→ ARROW]</span>
              </button>
            </div>

            {/* Jersey Selector - Compact */}
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a2a" }}>
              <JerseySelector
                jerseys={currentJerseys}
                selected={selectedJersey}
                onSelect={setSelectedJersey}
                teamColor={teamColor(selectedTeam)}
                teamName={teamName(selectedTeam)}
              />
            </div>

            {/* Event Buttons Grid - Scrollable */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              <SectionLabel label="HIGH FREQUENCY" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                {EVENTS.HIGH.map(ev => (
                  <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="large" />
                ))}
              </div>

              <SectionLabel label="ATTACKING & GOALS" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                {EVENTS.ATTACK.map(ev => (
                  <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} 
                    size={ev.key === "GOAL" ? "goal" : "medium"} />
                ))}
              </div>

              <SectionLabel label="GENERAL PLAY" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
                {[...EVENTS.MEDIUM, ...EVENTS.CROSS].map(ev => (
                  <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="medium" />
                ))}
              </div>

              <SectionLabel label="SET PIECES" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {EVENTS.SET.map(ev => (
                  <EventBtn key={ev.key} ev={ev} team={selectedTeam} flash={flash} onClick={() => logEvent(ev.key)} size="small" />
                ))}
              </div>
            </div>

            {/* Export Actions Bar */}
            <div style={{
              padding: "12px 16px", background: "#0d0d14", borderTop: "1px solid #1a1a2a",
              display: "flex", justifyContent: "space-between", gap: 8
            }}>
              <button onClick={() => downloadJSON(events)} style={{ flex: 1, padding: "8px 0", borderRadius: 4, background: "#111", border: "1px solid #222", color: "#666", fontSize: 10, cursor: "pointer" }}>EXPORT JSON</button>
              <button onClick={() => {
                if (window.confirm("End match session? This will auto-export your JSON and clear all data.")) {
                  downloadJSON(events);
                  clearSession();
                  router.push("/setup");
                }
              }} style={{ flex: 1, padding: "8px 0", borderRadius: 4, background: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5", fontSize: 10, fontWeight: 900, cursor: "pointer" }}>END SESSION</button>
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
        @keyframes modalIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Stats Modal */}
      {showStats && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000,
          display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)"
        }} onClick={() => setShowStats(false)}>
          <div style={{
            background: "#0d0d14", border: "1px solid #2a2a3a", borderRadius: 16,
            width: "90%", maxWidth: 500, padding: 30, animation: "modalIn 0.3s ease-out"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>MATCH STATISTICS</h2>
              <button onClick={() => setShowStats(false)} style={{
                background: "none", border: "none", color: "#555", fontSize: 24, cursor: "pointer"
              }}>×</button>
            </div>
            
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1a1a2a" }}>
                  <th style={{ textAlign: "left", padding: "12px 8px", color: "#444", fontSize: 10 }}>STATISTIC</th>
                  <th style={{ textAlign: "center", padding: "12px 8px", color: "#3b82f6", fontSize: 12 }}>{session.leftTeam}</th>
                  <th style={{ textAlign: "center", padding: "12px 8px", color: "#ef4444", fontSize: 12 }}>{session.rightTeam}</th>
                </tr>
              </thead>
              <tbody>
                {calcStats().map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                    <td style={{ padding: "14px 8px", fontSize: 13, color: "#888", fontWeight: 700 }}>{row.label}</td>
                    <td style={{ textAlign: "center", padding: "14px 8px", fontSize: 16, fontWeight: 900, color: "#f0f0f0" }}>{row.left}</td>
                    <td style={{ textAlign: "center", padding: "14px 8px", fontSize: 16, fontWeight: 900, color: "#f0f0f0" }}>{row.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button 
              onClick={() => setShowStats(false)}
              style={{
                width: "100%", marginTop: 24, padding: "12px 0", borderRadius: 8,
                background: "#1e1e2e", border: "1px solid #2a2a3a", color: "#f0f0f0",
                fontWeight: 900, cursor: "pointer", letterSpacing: 1
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
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
  const color = team === "left" ? "#3b82f6" : "#ef4444";
  const activeColor = team === "left" ? "#1d4ed8" : "#b91c1c";
  const isGoal = ev.key === "GOAL";
  const sk = shortcutLabel(ev);

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
      <span style={{ fontWeight: 900 }}>{ev.label}</span>
      {sk && (
        <span style={{ 
          fontSize: 10, 
          color: isFlashing ? "#ffffffaa" : isGoal ? `${color}aa` : "#777", 
          letterSpacing: 1.5,
          background: isFlashing ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.2)",
          padding: "1px 6px",
          borderRadius: 4,
          marginTop: 2,
          fontWeight: 900,
          border: `1px solid ${isFlashing ? "#ffffff44" : "#222"}`
        }}>
          {sk}
        </span>
      )}
    </button>
  );
}