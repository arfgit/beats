import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { BPM_MAX, BPM_MIN } from "@beats/shared";

export function TransportBar() {
  const isPlaying = useBeatsStore((s) => s.transport.isPlaying);
  const togglePlay = useBeatsStore((s) => s.togglePlay);
  const bpm = useBeatsStore((s) => s.pattern.bpm);
  const setBpm = useBeatsStore((s) => s.setBpm);
  const masterGain = useBeatsStore((s) => s.pattern.masterGain);
  const setMasterGain = useBeatsStore((s) => s.setMasterGain);
  const undo = useBeatsStore((s) => s.undo);
  const redo = useBeatsStore((s) => s.redo);
  const canUndo = useBeatsStore((s) => s.history.past.length > 0);
  const canRedo = useBeatsStore((s) => s.history.future.length > 0);

  return (
    <div className="flex items-center flex-wrap gap-4 border-b border-grid pb-4">
      <Tooltip label={isPlaying ? "stop (space)" : "play (space)"}>
        <Button onClick={() => void togglePlay()} variant="primary">
          {isPlaying ? "■ stop" : "▶ play"}
        </Button>
      </Tooltip>

      <Tooltip label="beats per minute (60–200)">
        <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted">
          bpm
          <input
            type="number"
            min={BPM_MIN}
            max={BPM_MAX}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-16 h-9 px-2 bg-bg-panel border border-grid rounded text-neon-cyan font-mono text-sm text-center focus-visible:outline-none"
          />
        </label>
      </Tooltip>

      <Tooltip label={`master gain ${Math.round(masterGain * 100)}%`}>
        <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted">
          master
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterGain}
            onChange={(e) => setMasterGain(Number(e.target.value))}
            aria-label="master gain"
            className="w-28 h-1 appearance-none bg-grid rounded accent-neon-magenta cursor-pointer"
          />
        </label>
      </Tooltip>

      <div className="flex items-center gap-1 ml-auto">
        <Tooltip label="undo (⌘Z)">
          <Button
            variant="icon"
            onClick={undo}
            disabled={!canUndo}
            aria-label="undo"
          >
            ↶
          </Button>
        </Tooltip>
        <Tooltip label="redo (⇧⌘Z)">
          <Button
            variant="icon"
            onClick={redo}
            disabled={!canRedo}
            aria-label="redo"
          >
            ↷
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
