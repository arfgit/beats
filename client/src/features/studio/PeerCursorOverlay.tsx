import { useMemo } from "react";
import type { PresenceState, SessionParticipant } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";

interface Props {
  /**
   * Element whose bounding rect peer-cursor coords should be projected
   * against. Normalized [0,1] coords on the wire turn back into pixels
   * here so different viewport sizes line up logically (Figma trick).
   */
  surface: React.RefObject<HTMLElement | null>;
}

const STALE_MS = 8_000; // hide a cursor whose last update is older than this

/**
 * Renders a Figma-style floating arrow + name tag for each remote peer
 * in the active session. The local user sees their own arrow only on
 * other peers' screens — never their own.
 *
 * Smooth motion comes from a CSS `transition: transform 100ms linear`
 * on the cursor element. Each presence update mutates the inline
 * `translate3d` transform; the browser interpolates between the old
 * and new value so the cursor glides instead of snapping at 10 Hz.
 */
export function PeerCursorOverlay({ surface }: Props) {
  const sessionActive = useBeatsStore((s) => s.collab.session.id !== null);
  const presence = useBeatsStore((s) => s.collab.session.presence);
  const participants = useBeatsStore((s) => s.collab.session.participants);
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);

  const cursors = useMemo(() => {
    if (!sessionActive) return [];
    const now = Date.now();
    const list: Array<{
      uid: string;
      x: number;
      y: number;
      color: string;
      name: string;
    }> = [];
    for (const [uid, p] of Object.entries(presence)) {
      if (uid === myUid) continue;
      if (!p?.cursor) continue;
      if (now - (p.lastSeen ?? 0) > STALE_MS) continue;
      const participant = participants[uid];
      list.push({
        uid,
        x: p.cursor.x,
        y: p.cursor.y,
        color: participant?.color ?? p.color ?? "#b84dff",
        name: participant?.displayName ?? p.displayName ?? "peer",
      });
    }
    return list;
  }, [presence, participants, myUid, sessionActive]);

  if (!sessionActive || cursors.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {cursors.map((cursor) => (
        <PeerCursor
          key={cursor.uid}
          cursor={cursor}
          surface={surface.current}
        />
      ))}
    </div>
  );
}

interface CursorState {
  uid: string;
  x: number;
  y: number;
  color: string;
  name: string;
}

function PeerCursor({
  cursor,
  surface,
}: {
  cursor: CursorState;
  surface: HTMLElement | null;
}) {
  // Compute pixel coords from normalized [0,1]. We deliberately re-read
  // the surface rect on every render rather than cache — the element's
  // size can change with sidebar toggles, viewport resize, and we want
  // peer cursors to track those changes immediately.
  const rect = surface?.getBoundingClientRect();
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  const px = cursor.x * width;
  const py = cursor.y * height;

  // White text on bright backgrounds is unreadable, dark text on dark
  // ones is too. Pick a contrasting label text color from the cursor
  // color's perceived luminance — same trick Figma uses on user chips.
  const labelTextColor = readableTextColor(cursor.color);

  return (
    <div
      className="absolute top-0 left-0 will-change-transform"
      style={{
        transform: `translate3d(${px}px, ${py}px, 0)`,
        // Faster than 100ms feels twitchy; slower glides too much when
        // the peer moves quickly. 80ms matches Figma's perceived feel
        // for their typical 30-50ms presence cadence — at our 100ms
        // throttle, slightly under the tick interval keeps the cursor
        // catching up rather than lagging.
        transition: "transform 80ms linear",
      }}
    >
      <CursorArrow color={cursor.color} />
      <span
        className="absolute left-3.5 top-3.5 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium tracking-tight whitespace-nowrap leading-tight"
        style={{
          backgroundColor: cursor.color,
          color: labelTextColor,
          boxShadow: "0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.15)",
        }}
      >
        {cursor.name}
      </span>
    </div>
  );
}

/**
 * Slim Figma-style arrow. The shape: a tall narrow triangle leaning
 * ~30° to the right, with a subtle white outline so it stays readable
 * over both dark and light backgrounds. Drop shadow gives it lift.
 *
 * The geometry below traces a "real" pointer: tip at (3, 2), heel
 * curving to the bottom, exit-tail to the lower-right. Mirrors the
 * proportions Figma + macOS use rather than the chunkier OS-default
 * Windows arrow.
 */
function CursorArrow({ color }: { color: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        filter:
          "drop-shadow(0 1px 2px rgba(0,0,0,0.4)) drop-shadow(0 0 0.5px rgba(0,0,0,0.6))",
      }}
      aria-hidden
    >
      <path
        d="M3 2 L3 16.5 L7.2 12.6 L9.6 18.2 L12 17.1 L9.5 11.5 L14.5 11 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Pick #fff or #000 for label text based on the background color's
 * perceived luminance. Uses the WCAG relative-luminance formula on the
 * sRGB channels — same metric Figma's user-chip pill uses.
 */
function readableTextColor(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#ffffff";
  const v = parseInt(m[1]!, 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  const lum = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return L > 0.55 ? "#0a0518" : "#ffffff";
}

/**
 * Compact participant list rendered in the studio header while a
 * session is active. Each chip shows a colored dot + display name +
 * a "you" marker on the local user, mirroring the same color the
 * peer cursors are rendered in.
 */
export function SessionParticipantRail() {
  const sessionActive = useBeatsStore((s) => s.collab.session.id !== null);
  const participants = useBeatsStore((s) => s.collab.session.participants);
  const presence = useBeatsStore((s) => s.collab.session.presence);
  const myUid = useBeatsStore((s) => s.auth.user?.id ?? null);

  if (!sessionActive) return null;

  const list = Object.values(participants);
  if (list.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-ink-muted"
      aria-label="session participants"
    >
      <span>session:</span>
      <ul className="flex items-center gap-2 flex-wrap">
        {list.map((p) => {
          const isOnline =
            !!presence[p.uid] &&
            Date.now() - (presence[p.uid]!.lastSeen ?? 0) < STALE_MS;
          return (
            <ParticipantChip
              key={p.uid}
              p={p}
              isOnline={isOnline}
              isMe={p.uid === myUid}
            />
          );
        })}
      </ul>
    </div>
  );
}

function ParticipantChip({
  p,
  isOnline,
  isMe,
}: {
  p: SessionParticipant;
  isOnline: boolean;
  isMe: boolean;
}) {
  return (
    <li className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{
          backgroundColor: p.color,
          boxShadow: isOnline ? `0 0 6px ${p.color}` : undefined,
          opacity: isOnline ? 1 : 0.4,
        }}
      />
      <span style={{ color: p.color, opacity: isOnline ? 1 : 0.5 }}>
        {p.displayName}
      </span>
      {isMe && <span className="text-ink-muted">(you)</span>}
      {p.role === "viewer" && <span className="text-ink-muted">view</span>}
    </li>
  );
}

// Keep PresenceState import live so future presence-driven badges
// (e.g. "currently editing cell 3") can read the typed shape.
void undefined as unknown as PresenceState;
