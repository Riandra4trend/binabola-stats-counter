const SESSION_KEY = "binabola_session";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function saveSession(data) {
  if (typeof window === "undefined") return;
  const payload = {
    data,
    savedAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

export function loadSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (Date.now() > payload.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return payload.data;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function getSessionAge() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return {
      savedAt: payload.savedAt,
      expiresAt: payload.expiresAt,
      remainingMs: payload.expiresAt - Date.now(),
    };
  } catch {
    return null;
  }
}