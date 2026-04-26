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
  const surfaceTop = rect?.top ?? 0;
  const surfaceLeft = rect?.left ?? 0;
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  const px = cursor.x * width;
  const py = cursor.y * height;

  // The overlay div is `absolute inset-0` over the surface so we can
  // position cursors in the surface's local space — translate3d here
  // is just (px, py) within the overlay, not page coords. Subtracting
  // the surface's own top/left isn't needed.
  void surfaceTop;
  void surfaceLeft;

  return (
    <div
      className="absolute top-0 left-0 will-change-transform"
      style={{
        transform: `translate3d(${px}px, ${py}px, 0)`,
        transition: "transform 100ms linear",
      }}
    >
      <CursorArrow color={cursor.color} />
      <div
        className="ml-3 mt-[-2px] inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-widest text-bg-void whitespace-nowrap"
        style={{
          backgroundColor: cursor.color,
          boxShadow: `0 0 8px ${cursor.color}`,
        }}
      >
        {cursor.name}
      </div>
    </div>
  );
}

/**
 * 14×16 SVG arrow. Filled triangle with a subtle inner outline so it
 * stays readable on both light + dark backgrounds. The shape mirrors
 * macOS / Figma cursor proportions more than the chunkier Windows one.
 */
function CursorArrow({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
    >
      <path
        d="M0 0 L0 13 L4 9.5 L6.5 15 L9 14 L6.5 8.5 L11 8 Z"
        fill={color}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
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
