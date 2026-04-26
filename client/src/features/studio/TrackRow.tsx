import { useState } from "react";
import clsx from "clsx";
import { TRACK_KINDS } from "@beats/shared";
import type { SampleRef, Track, TrackKind, TrackStep } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { Tooltip } from "@/components/ui/Tooltip";
import { Knob } from "@/components/ui/Knob";
import { polishSampleName } from "@/lib/sampleNames";
import { useStep } from "./useStep";
import { SampleRow } from "./SampleRow";

// Color palette is keyed by instrument kind (drums/bass/guitar/vocals)
// now that track ids are per-cell and kinds are chosen per slot. Two drum
// rows in the same cell will both use the magenta accent — that's fine.
const kindAccent: Record<TrackKind, string> = {
  drums: "text-neon-magenta",
  bass: "text-neon-sun",
  guitar: "text-neon-cyan",
  vocals: "text-neon-violet",
  fx: "text-neon-green",
  // Coral hex used inline because the design tokens file is locked
  // for this PR — promote to `--neon-coral` once tokens.css is open.
  custom: "text-[#ff8c69]",
};

const kindActiveBg: Record<TrackKind, string> = {
  drums: "bg-neon-magenta/80 border-neon-magenta",
  bass: "bg-neon-sun/80 border-neon-sun",
  guitar: "bg-neon-cyan/80 border-neon-cyan",
  vocals: "bg-neon-violet/80 border-neon-violet",
  fx: "bg-neon-green/80 border-neon-green",
  custom: "bg-[#ff8c69]/80 border-[#ff8c69]",
};

interface Props {
  track: Track;
  /** Position of this track within its parent cell. Drives drag reorder. */
  index: number;
}

/**
 * Layout:
 *   ┌─ controls ──────────────┬─ step grid (8 cells, capped 56px wide each) ─┐
 *   │ kind  M S  [gain]       │ ■ ■ ■ ■ ■ ■ ■ ■                              │
 *   ├─────────────────────────┴──────────────────────────────────────────────┤
 *   │ samples: [kick] [snare] [clap] [hihat]                                 │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * The two top columns stack vertically below md. Cells have fixed h-10 and a
 * max-w so they stay compact on wide viewports instead of ballooning via
 * aspect-square, which was causing row-height drift.
 */
export function TrackRow({ track, index }: Props) {
  const toggleStep = useBeatsStore((s) => s.toggleStep);
  const toggleMute = useBeatsStore((s) => s.toggleMute);
  const toggleSolo = useBeatsStore((s) => s.toggleSolo);
  const setTrackGain = useBeatsStore((s) => s.setTrackGain);
  const setAllStepsOnTrack = useBeatsStore((s) => s.setAllStepsOnTrack);
  const resetTrackMixer = useBeatsStore((s) => s.resetTrackMixer);
  const clearTrackSample = useBeatsStore((s) => s.clearTrackSample);
  const previewTrack = useBeatsStore((s) => s.previewTrack);
  const removeTrack = useBeatsStore((s) => s.removeTrack);
  const setTrackName = useBeatsStore((s) => s.setTrackName);
  const trackCount = useBeatsStore((s) => s.pattern.tracks.length);
  const selectedCellId = useBeatsStore((s) => s.selectedCellId);
  const activeCellId = useBeatsStore((s) => s.activeCellId);
  const setTrackKind = useBeatsStore((s) => s.setTrackKind);
  const reorderTracks = useBeatsStore((s) => s.reorderTracks);
  const syncPatternIntoMatrix = useBeatsStore((s) => s.syncPatternIntoMatrix);
  const loadCellIntoPattern = useBeatsStore((s) => s.loadCellIntoPattern);
  const findSampleById = useBeatsStore((s) => s.findSampleById);
  const setStepSample = useBeatsStore((s) => s.setStepSample);
  const armedSampleId = useBeatsStore((s) => s.ui.armedSampleId);
  // Resolve the armed SampleRef once per row instead of on every cell
  // render. Cells only need id + version to call setStepSample, but
  // having the kind lets us gate cross-kind stamping (a vocals stamp
  // shouldn't write into a drums row).
  const armedSample = armedSampleId ? findSampleById(armedSampleId) : null;
  const armedHere = armedSample !== null && armedSample.kind === track.kind;
  const currentStep = useStep();
  const isPlaying = useBeatsStore((s) => s.transport.isPlaying);
  // Running-step ring only appears when the cell this TrackRow belongs
  // to is actually the one being played — otherwise a user editing cell
  // 2 while cell 5 is live would see a phantom playhead on their
  // editable grid, which is misleading.
  const isLiveCell = isPlaying && selectedCellId === activeCellId;
  // Resolve sample name for the row badge. Prefer the pinned snapshot
  // on the track (paints before samplesSlice hydrates and survives
  // sample renames), fall back to a live id lookup for legacy projects
  // written before track.sampleName existed, then to the raw id, then to
  // "no sample".
  const currentSample = track.sampleId ? findSampleById(track.sampleId) : null;
  const rawSampleName = track.sampleName ?? currentSample?.name ?? null;
  const polishedSampleName = rawSampleName
    ? polishSampleName(rawSampleName)
    : null;
  const sampleLabel = polishedSampleName ?? track.sampleId ?? "no sample";
  // Short 1-3 char glyph shown inside active step cells so the user can
  // tell at a glance which sample is on each row without reading the
  // dropdown below. "Kick 808" → "K8", "Juno Bass 70" → "JB7".
  const sampleGlyph = polishedSampleName
    ? makeSampleGlyph(polishedSampleName)
    : "";
  const [dragOver, setDragOver] = useState(false);

  const labelColor = kindAccent[track.kind];
  const activeBg = kindActiveBg[track.kind];

  const onKindChange = (next: TrackKind) => {
    // Kind is a matrix-level attribute of the slot, not the flat pattern.
    // Sync pattern → matrix so the other slot edits aren't lost, then
    // change the kind, then reload pattern from the updated cell.
    syncPatternIntoMatrix();
    setTrackKind(selectedCellId, track.id, next);
    loadCellIntoPattern(selectedCellId);
  };

  return (
    <div
      className={clsx(
        "py-3 border-b border-grid/40 last:border-0 space-y-2",
        dragOver && "bg-neon-sun/5",
      )}
      onDragOver={(e) => {
        // Only react to TrackRow drags — step-grid cells don't set the
        // track-row mime type. Prevents rogue drag events from outside.
        if (!e.dataTransfer.types.includes("application/x-track-row")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("application/x-track-row")) return;
        e.preventDefault();
        setDragOver(false);
        const fromIdx = Number(
          e.dataTransfer.getData("application/x-track-row"),
        );
        if (Number.isNaN(fromIdx) || fromIdx === index) return;
        // Flush current pattern edits before reordering — same rationale
        // as kind change.
        syncPatternIntoMatrix();
        reorderTracks(selectedCellId, fromIdx, index);
        loadCellIntoPattern(selectedCellId);
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] gap-3 items-center">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Tooltip label="drag to reorder">
            <span
              role="button"
              tabIndex={0}
              draggable
              aria-label={`reorder ${track.kind} row`}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(
                  "application/x-track-row",
                  String(index),
                );
              }}
              onKeyDown={(e) => {
                if (!e.altKey) return;
                if (e.key === "ArrowUp" && index > 0) {
                  e.preventDefault();
                  syncPatternIntoMatrix();
                  reorderTracks(selectedCellId, index, index - 1);
                  loadCellIntoPattern(selectedCellId);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  syncPatternIntoMatrix();
                  reorderTracks(selectedCellId, index, index + 1);
                  loadCellIntoPattern(selectedCellId);
                }
              }}
              className={clsx(
                "cursor-grab active:cursor-grabbing select-none",
                "text-ink-muted hover:text-ink text-sm font-mono leading-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-violet rounded px-1",
              )}
            >
              ⋮⋮
            </span>
          </Tooltip>
          <Tooltip label="rename this row — leave empty to reset to the kind">
            <input
              type="text"
              defaultValue={track.name ?? ""}
              placeholder={track.kind}
              maxLength={40}
              onBlur={(e) => {
                if ((e.target.value.trim() || null) !== (track.name ?? null)) {
                  setTrackName(track.id, e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.currentTarget.value = track.name ?? "";
                  e.currentTarget.blur();
                }
              }}
              aria-label={`${track.name ?? track.kind} row name`}
              className={clsx(
                "h-7 w-[88px] px-1 bg-bg-panel-2 border border-grid rounded text-[10px] uppercase tracking-widest font-mono",
                "focus-visible:outline-none focus-visible:border-neon-violet",
                "placeholder:text-ink-muted/60",
                labelColor,
              )}
            />
          </Tooltip>
          <Tooltip label="instrument kind — changing wipes the row">
            <select
              value={track.kind}
              onChange={(e) => onKindChange(e.target.value as TrackKind)}
              aria-label={`${track.kind} row instrument`}
              className={clsx(
                "h-7 px-1 bg-bg-panel-2 border border-grid rounded text-[9px] uppercase tracking-widest font-mono text-ink-muted",
                "focus-visible:outline-none focus-visible:border-neon-violet",
                "cursor-pointer",
              )}
            >
              {TRACK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </Tooltip>
          <Tooltip label={track.muted ? "unmute" : "mute this track"}>
            <button
              type="button"
              onClick={() => toggleMute(track.id)}
              aria-pressed={track.muted}
              className={clsx(
                "h-8 w-8 rounded border text-[10px] font-mono uppercase shrink-0",
                "transition-colors duration-200 ease-in motion-reduce:transition-none",
                track.muted
                  ? "border-neon-red text-neon-red bg-neon-red/10"
                  : "border-grid text-ink-muted hover:border-ink-dim hover:text-ink-dim",
              )}
            >
              m
            </button>
          </Tooltip>
          <Tooltip label={track.soloed ? "un-solo" : "solo this track"}>
            <button
              type="button"
              onClick={() => toggleSolo(track.id)}
              aria-pressed={track.soloed}
              className={clsx(
                "h-8 w-8 rounded border text-[10px] font-mono uppercase shrink-0",
                "transition-colors duration-200 ease-in motion-reduce:transition-none",
                track.soloed
                  ? "border-neon-sun text-neon-sun bg-neon-sun/10"
                  : "border-grid text-ink-muted hover:border-ink-dim hover:text-ink-dim",
              )}
            >
              s
            </button>
          </Tooltip>
          <Tooltip
            label={`gain — drag vertically or arrow keys (double-click resets)`}
          >
            <div className="shrink-0 w-9">
              <Knob
                label="gain"
                ariaLabel={`${track.name ?? track.kind} gain`}
                value={track.gain}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.8}
                onChange={(v) => setTrackGain(track.id, v)}
                valueDisplay={(v) => `${Math.round(v * 100)}%`}
                size={36}
              />
            </div>
          </Tooltip>
        </div>

        <div className="grid grid-cols-[repeat(8,minmax(32px,1fr))] sm:grid-cols-[repeat(8,minmax(40px,1fr))] gap-1 sm:gap-1.5 lg:gap-2 min-w-0">
          {track.steps.map((step, i) => {
            const isCurrent = isLiveCell && currentStep === i;
            const velocityScale = 0.4 + step.velocity * 0.6;
            const hasSample = track.sampleId !== null;
            return (
              <PerStepCell
                key={i}
                step={step}
                stepIndex={i}
                track={track}
                isCurrent={isCurrent}
                hasSample={hasSample}
                velocityScale={velocityScale}
                activeBg={activeBg}
                fallbackGlyph={sampleGlyph}
                fallbackLabel={sampleLabel}
                onToggle={() => toggleStep(track.id, i)}
                findSampleById={findSampleById}
                armedHere={armedHere}
                onStamp={() => {
                  if (!armedSample) return;
                  setStepSample(
                    track.id,
                    i,
                    armedSample.id,
                    armedSample.version,
                  );
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="md:pl-[332px] space-y-1.5">
        <SampleRow trackId={track.id} kind={track.kind} />
        <div className="flex items-center gap-1 flex-wrap">
          <Tooltip label="preview current sample">
            <button
              type="button"
              onClick={() => previewTrack(track.id)}
              disabled={!track.sampleId}
              aria-label="preview current sample"
              className="h-8 w-8 rounded border border-grid text-[10px] font-mono text-ink-muted hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-grid disabled:hover:text-ink-muted"
            >
              ▸
            </button>
          </Tooltip>
          <Tooltip
            label={
              track.sampleId
                ? "fill all steps on this row"
                : "pick a sample first"
            }
          >
            <button
              type="button"
              onClick={() => setAllStepsOnTrack(track.id, true)}
              aria-label={`fill all ${track.kind} steps`}
              disabled={!track.sampleId}
              className="h-8 w-8 rounded border border-grid text-[10px] font-mono uppercase text-ink-muted hover:border-neon-violet hover:text-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-grid disabled:hover:text-ink-muted"
            >
              fl
            </button>
          </Tooltip>
          <Tooltip label="clear all steps on this row">
            <button
              type="button"
              onClick={() => setAllStepsOnTrack(track.id, false)}
              aria-label={`clear all ${track.kind} steps`}
              className="h-8 w-8 rounded border border-grid text-[10px] font-mono uppercase text-ink-muted hover:border-neon-violet hover:text-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none"
            >
              cl
            </button>
          </Tooltip>
          <Tooltip label="reset mute/solo/gain to defaults">
            <button
              type="button"
              onClick={() => resetTrackMixer(track.id)}
              aria-label={`reset ${track.kind} mixer`}
              className="h-8 w-8 rounded border border-grid text-[10px] font-mono text-ink-muted hover:border-neon-violet hover:text-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none"
            >
              ↺
            </button>
          </Tooltip>
          <Tooltip label="remove sample from this row — clears all active steps">
            <button
              type="button"
              onClick={() => clearTrackSample(track.id)}
              aria-label={`clear ${track.kind} sample`}
              disabled={!track.sampleId}
              className="h-8 w-8 rounded border border-grid text-[10px] font-mono text-ink-muted hover:border-neon-violet hover:text-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-grid disabled:hover:text-ink-muted"
            >
              ×
            </button>
          </Tooltip>
          <Tooltip
            label={
              trackCount <= 1
                ? "can't remove the last row"
                : "delete this row — destructive"
            }
          >
            <button
              type="button"
              onClick={() => {
                syncPatternIntoMatrix();
                removeTrack(selectedCellId, track.id);
                loadCellIntoPattern(selectedCellId);
              }}
              aria-label={`remove ${track.kind} row`}
              disabled={trackCount <= 1}
              className="h-8 px-2 rounded border border-neon-red/40 text-neon-red/80 text-[10px] font-mono uppercase tracking-widest hover:border-neon-red hover:text-neon-red hover:bg-neon-red/10 transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-neon-red/40 disabled:hover:text-neon-red/80 disabled:hover:bg-transparent"
            >
              del row
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact abbreviation of a sample's display name suitable for rendering
 * inside a ~40x44px step cell. Rules:
 *   - Split on whitespace / hyphens / underscores
 *   - Take first letter of each word (initialism)
 *   - Append trailing digits from the last word if present ("kick 808" → "K8")
 *   - Cap at 3 characters
 */
function makeSampleGlyph(name: string): string {
  const cleaned = name.trim().toLowerCase();
  const words = cleaned.split(/[\s\-_]+/).filter(Boolean);
  if (words.length === 0) return "";
  const initials = words.map((w) => w[0] ?? "").join("");
  // Pull trailing digits off the last word so "808" is preserved.
  const lastWord = words[words.length - 1]!;
  const digitMatch = lastWord.match(/(\d+)$/);
  const digits = digitMatch ? digitMatch[1] : "";
  const glyph = (initials + digits).toUpperCase();
  return glyph.slice(0, 3);
}

/**
 * Per-step cell button. Resolves its own sample label + glyph from the
 * step's pinned sampleId first, falling back to the track's current
 * sample only when the step has no pin (i.e. was never activated, or
 * was toggled off and on before a sample was chosen). This is what
 * makes a sample swap on the row leave already-placed steps visually
 * and audibly tied to their original sample.
 */
function PerStepCell({
  step,
  stepIndex,
  track,
  isCurrent,
  hasSample,
  velocityScale,
  activeBg,
  fallbackGlyph,
  fallbackLabel,
  onToggle,
  findSampleById,
  armedHere,
  onStamp,
}: {
  step: TrackStep;
  stepIndex: number;
  track: Track;
  isCurrent: boolean;
  hasSample: boolean;
  velocityScale: number;
  activeBg: string;
  fallbackGlyph: string;
  fallbackLabel: string;
  onToggle: () => void;
  findSampleById: (id: string) => SampleRef | undefined;
  /** True when a sample of this row's kind is armed for stamping. */
  armedHere: boolean;
  /** Apply the armed sample to this step (replace + activate). */
  onStamp: () => void;
}) {
  // Step-pinned snapshot > live id lookup > track-level fallback.
  // Prefer the per-step `sampleName` snapshot so labels paint before
  // samplesSlice hydrates and don't change retroactively on rename.
  // The id-lookup branch covers legacy steps that pre-date the snapshot
  // field; rendering eventually self-heals as users edit.
  const pinnedRawName = step.active
    ? (step.sampleName ??
      (step.sampleId ? findSampleById(step.sampleId)?.name : null) ??
      null)
    : null;
  const pinnedName = pinnedRawName ? polishSampleName(pinnedRawName) : null;
  const stepGlyph = pinnedName ? makeSampleGlyph(pinnedName) : fallbackGlyph;
  const stepLabel = pinnedName ?? fallbackLabel;
  return (
    <Tooltip
      label={
        armedHere
          ? `stamp onto step ${stepIndex + 1}`
          : hasSample
            ? `step ${stepIndex + 1}${step.active ? ` · on · ${stepLabel}` : ""}`
            : `pick a ${track.kind} sample first`
      }
    >
      <button
        type="button"
        disabled={!hasSample && !armedHere}
        onClick={() => {
          if (armedHere) {
            // Armed-mode click → replace this step's sample with the
            // armed one (and activate it). Sibling steps are untouched.
            onStamp();
            return;
          }
          if (!hasSample) return;
          onToggle();
        }}
        aria-pressed={step.active}
        aria-label={`${track.kind} step ${stepIndex + 1}`}
        style={{ opacity: step.active ? velocityScale : 1 }}
        className={clsx(
          "h-11 lg:h-12 w-full rounded-sm border transition-colors duration-150 ease-in",
          "motion-reduce:transition-none",
          "flex items-center justify-center",
          "font-mono text-[10px] tracking-tight leading-none uppercase",
          step.active
            ? activeBg
            : hasSample || armedHere
              ? "bg-bg-panel-2 border-grid hover:border-ink-muted cursor-pointer"
              : "bg-bg-panel-2/70 border-dashed border-grid cursor-not-allowed",
          // Armed-mode visual: violet outline on every targetable step
          // so the user can SEE the stamping affordance — kills the
          // "I forgot I was in armed mode" surprise the architect
          // flagged. Outline is offset so it doesn't fight the active
          // background highlight.
          armedHere &&
            "outline-dashed outline-1 outline-offset-[-2px] outline-neon-violet/60 cursor-copy",
          isCurrent &&
            "ring-2 ring-neon-cyan ring-offset-2 ring-offset-bg-panel",
        )}
      >
        {step.active && stepGlyph && (
          <span
            aria-hidden
            className="text-ink/90 drop-shadow-[0_0_2px_rgba(0,0,0,0.6)]"
          >
            {stepGlyph}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
