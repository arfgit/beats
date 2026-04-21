import { useBeatsStore } from "@/store/useBeatsStore";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { BPM_MAX, BPM_MIN } from "@beats/shared";

export function TransportBar() {
  const isPlaying = useBeatsStore((s) => s.transport.isPlaying);
  const togglePlay = useBeatsStore((s) => s.togglePlay);
  const bpm = useBeatsStore((s) => s.pattern.bpm);
  const setBpm = useBeatsStore((s) => s.setBpm);

  return (
    <div className="flex items-center gap-4 border-b border-grid pb-4">
      <Tooltip label={isPlaying ? "stop (space)" : "play (space)"}>
        <Button onClick={() => void togglePlay()} variant="primary">
          {isPlaying ? "■ stop" : "▶ play"}
        </Button>
      </Tooltip>

      <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
