/**
 * Tab-scoped memory of "I'm in session X for project Y." Survives
 * refresh, dies on tab close (which is exactly when the RTDB
 * connection dies and the session participation should reset).
 *
 * Used by both:
 *   - the SessionJoinPrompt (invitee path) — silent rejoin if
 *     the user already accepted in this tab
 *   - Studio.tsx mount (host path) — refresh after starting a
 *     session re-attaches RTDB listeners without re-prompting
 *     because the URL on a host start doesn't carry ?session=.
 *
 * Keyed by projectId so a refresh that lands on a DIFFERENT
 * project doesn't accidentally try to rejoin the wrong session.
 */

const STORAGE_KEY = "beats:activeSessions";

interface ActiveSessions {
  [projectId: string]: string; // projectId -> sessionId
}

function readMap(): ActiveSessions {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ActiveSessions;
  } catch {
    return {};
  }
}

function writeMap(map: ActiveSessions): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private-browsing errors
  }
}

export function rememberActiveSession(
  projectId: string,
  sessionId: string,
): void {
  const map = readMap();
  map[projectId] = sessionId;
  writeMap(map);
}

export function getRememberedSession(projectId: string): string | null {
  const map = readMap();
  return map[projectId] ?? null;
}

export function forgetActiveSession(projectId: string): void {
  const map = readMap();
  if (!(projectId in map)) return;
  delete map[projectId];
  writeMap(map);
}

export function forgetAllActiveSessions(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
