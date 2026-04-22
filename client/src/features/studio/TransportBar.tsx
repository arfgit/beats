import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoIcon } from "@/components/ui/InfoIcon";
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
  const tooltipsEnabled = useBeatsStore((s) => s.ui.tooltipsEnabled);
  const setTooltipsEnabled = useBeatsStore((s) => s.setTooltipsEnabled);

  return (
    <div className="flex items-center flex-wrap gap-4 border-b border-grid pb-4">
      <Tooltip label={isPlaying ? "stop (space)" : "play (space)"}>
        <Button
          onClick={() => void togglePlay()}
          variant="primary"
          aria-pressed={isPlaying}
          aria-label={isPlaying ? "stop playback" : "play pattern"}
        >
          {isPlaying ? "■ stop" : "▶ play"}
        </Button>
      </Tooltip>

      <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted">
        <span className="inline-flex items-center gap-1">
          bpm
          <InfoIcon label="beats per minute — shared across every cell in the matrix. 60-200." />
        </span>
        <Tooltip label="beats per minute (60-200)">
          <input
            type="number"
            min={BPM_MIN}
            max={BPM_MAX}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-16 h-9 px-2 bg-bg-panel border border-grid rounded text-neon-cyan font-mono text-sm text-center focus-visible:outline-none"
          />
        </Tooltip>
      </label>

      <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted">
        <span className="inline-flex items-center gap-1">
          master
          <InfoIcon label="project output volume. double-click the slider to reset." />
        </span>
        <Tooltip label={`master gain ${Math.round(masterGain * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterGain}
            onChange={(e) => setMasterGain(Number(e.target.value))}
            onDoubleClick={() => setMasterGain(0.8)}
            aria-label="master gain"
            title="double-click to reset"
            className="w-24 sm:w-40"
          />
        </Tooltip>
      </label>

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
        <Tooltip
          label={tooltipsEnabled ? "hide tooltips" : "show tooltips"}
          force
        >
          <Button
            variant="icon"
            onClick={() => setTooltipsEnabled(!tooltipsEnabled)}
            aria-pressed={tooltipsEnabled}
            aria-label={tooltipsEnabled ? "hide tooltips" : "show tooltips"}
          >
            {tooltipsEnabled ? "?" : "?̸"}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
