import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { SampleRef, TrackKind } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";
import { polishSampleName } from "@/lib/sampleNames";
import { Tooltip } from "@/components/ui/Tooltip";

interface Props {
  trackId: string;
  kind: TrackKind;
}

export function SampleRow({ trackId, kind }: Props) {
  const kindState = useBeatsStore((s) => s.samples[kind]);
  const fetchSamples = useBeatsStore((s) => s.fetchSamples);
  const currentSampleId = useBeatsStore(
    (s) => s.pattern.tracks.find((t) => t.id === trackId)?.sampleId ?? null,
  );
  const setTrackSample = useBeatsStore((s) => s.setTrackSample);
  const ensureEngineStarted = useBeatsStore((s) => s.ensureEngineStarted);
  const armedSampleId = useBeatsStore((s) => s.ui.armedSampleId);
  const armSample = useBeatsStore((s) => s.armSample);
  const [search, setSearch] = useState("");
  // The row is "armed" when its current sample matches the global
  // armed-sample id. Using one global slot rather than per-row state
  // matches the user's mental model ("one sample is the active stamp")
  // and prevents two rows from claiming the stamp at the same time.
  const isArmed = armedSampleId !== null && armedSampleId === currentSampleId;

  useEffect(() => {
    void fetchSamples(kind);
  }, [fetchSamples, kind]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return kindState.samples;
    return kindState.samples.filter((s) => {
      const polished = polishSampleName(s.name).toLowerCase();
      const category = (s.category ?? "").toLowerCase();
      return (
        polished.includes(needle) ||
        s.name.toLowerCase().includes(needle) ||
        category.includes(needle)
      );
    });
  }, [kindState.samples, search]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  if (kindState.status === "loading" || kindState.status === "idle") {
    return (
      <p className="text-ink-muted text-[10px] uppercase tracking-widest">
        loading {kind} samples…
      </p>
    );
  }

  if (kindState.status === "error") {
    return (
      <p
        role="alert"
        className="text-neon-red text-[10px] uppercase tracking-widest"
      >
        <span aria-hidden className="mr-1">
          !
        </span>
        error: {kindState.error ?? "samples failed to load"}
      </p>
    );
  }

  if (kindState.samples.length === 0) {
    return (
      <p className="text-ink-muted text-[10px] uppercase tracking-widest">
        no {kind} samples available
      </p>
    );
  }

  const onChange = async (evt: React.ChangeEvent<HTMLSelectElement>) => {
    const value = evt.target.value;
    if (!value) return;
    const sample = kindState.samples.find((s) => s.id === value);
    if (!sample) return;
    // Prime the AudioContext via this user gesture so later Transport
    // Play / ▸ preview clicks can produce sound (browsers require a
    // gesture before the context will resume).
    await ensureEngineStarted().catch(() => undefined);
    setTrackSample(trackId, sample.id, sample.version);
  };

  const hasSearch = search.trim().length > 0;
  const resultCount = filtered.length;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-[9px] uppercase tracking-[0.2em] text-ink-muted w-14 shrink-0">
        sample
      </label>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`search ${kind}…`}
        aria-label={`search ${kind} samples`}
        className="w-24 sm:w-28 h-8 px-2 bg-bg-panel-2 border border-grid rounded text-ink-dim font-mono text-xs placeholder:text-ink-muted/60 hover:border-ink-muted focus-visible:border-neon-violet focus-visible:outline-none transition-colors duration-200 ease-in motion-reduce:transition-none"
      />
      <select
        value={currentSampleId ?? ""}
        onChange={(e) => void onChange(e)}
        aria-label={`${kind} sample`}
        className={clsx(
          "flex-1 min-w-[160px] h-8 px-2 pr-6 bg-bg-panel-2 border rounded text-ink-dim font-mono text-xs hover:border-ink-muted focus-visible:border-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none appearance-none cursor-pointer",
          isArmed
            ? "border-neon-violet ring-2 ring-neon-violet/60"
            : "border-grid",
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='%23b8a3e8' stroke-width='1.2' fill='none'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        <option value="" disabled>
          {hasSearch && resultCount === 0
            ? `no matches for "${search.trim()}"`
            : "— choose a sample —"}
        </option>
        {groups.map(({ category, samples }) => (
          <SampleGroup
            key={category ?? "_flat"}
            category={category}
            samples={samples}
          />
        ))}
      </select>
      <Tooltip
        label={
          currentSampleId
            ? isArmed
              ? "stop stamping (Esc)"
              : "stamp this sample onto a step"
            : "pick a sample first"
        }
      >
        <button
          type="button"
          disabled={!currentSampleId}
          aria-pressed={isArmed}
          aria-label={
            isArmed
              ? `stop stamping ${kind} sample`
              : `stamp ${kind} sample onto a step`
          }
          onClick={() => {
            if (!currentSampleId) return;
            armSample(isArmed ? null : currentSampleId);
          }}
          className={clsx(
            "h-8 w-8 shrink-0 rounded border font-mono text-xs flex items-center justify-center transition-colors duration-150 motion-reduce:transition-none",
            !currentSampleId &&
              "opacity-40 border-grid bg-bg-panel-2/70 cursor-not-allowed",
            currentSampleId && isArmed
              ? "border-neon-violet bg-neon-violet/20 text-neon-violet"
              : currentSampleId
                ? "border-grid bg-bg-panel-2 text-ink-dim hover:border-neon-violet hover:text-neon-violet"
                : "",
          )}
        >
          <span aria-hidden>◈</span>
        </button>
      </Tooltip>
    </div>
  );
}

function SampleGroup({
  category,
  samples,
}: {
  category: string | undefined;
  samples: SampleRef[];
}) {
  if (!category) {
    return (
      <>
        {samples.map((sample) => (
          <option key={sample.id} value={sample.id}>
            {polishSampleName(sample.name)}
          </option>
        ))}
      </>
    );
  }
  return (
    <optgroup label={category}>
      {samples.map((sample) => (
        <option key={sample.id} value={sample.id}>
          {polishSampleName(stripCategoryPrefix(sample.name, category))}
        </option>
      ))}
    </optgroup>
  );
}

function groupByCategory(
  samples: SampleRef[],
): Array<{ category: string | undefined; samples: SampleRef[] }> {
  const map = new Map<string, SampleRef[]>();
  const flat: SampleRef[] = [];
  for (const sample of samples) {
    if (sample.category) {
      const list = map.get(sample.category) ?? [];
      list.push(sample);
      map.set(sample.category, list);
    } else {
      flat.push(sample);
    }
  }
  const categories = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({
      category: category as string | undefined,
      samples: list,
    }));
  if (flat.length > 0) categories.push({ category: undefined, samples: flat });
  return categories;
}

function stripCategoryPrefix(name: string, category: string): string {
  const lower = name.toLowerCase();
  const cat = category.toLowerCase();
  if (lower.startsWith(cat + " ")) return name.slice(cat.length + 1);
  return name;
}
