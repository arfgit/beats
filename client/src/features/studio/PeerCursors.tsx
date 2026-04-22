import { useBeatsStore } from "@/store/useBeatsStore";

/**
 * Renders remote collaborators currently viewing this project, with a dot
 * indicating which step (if any) they are focused on. Clicking a peer
 * scrolls the corresponding track row into view.
 */
export function PeerCursors() {
  const peers = useBeatsStore((s) => s.collab.peers);

  if (peers.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-ink-muted"
      aria-label="active collaborators"
    >
      <span>online:</span>
      <ul className="flex items-center gap-2">
        {peers.map((peer) => (
          <li key={peer.uid} className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: peer.color,
                boxShadow: `0 0 6px ${peer.color}`,
              }}
            />
            <span style={{ color: peer.color }}>{peer.displayName}</span>
            {peer.focusedCellId !== null && (
              <span className="text-ink-muted">
                · cell {peer.focusedCellId}
              </span>
            )}
            {peer.focusedTrackId !== null && peer.focusedStep !== null && (
              <span className="text-ink-muted">
                · {peer.focusedTrackId.replace("track-", "")} step{" "}
                {peer.focusedStep + 1}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
