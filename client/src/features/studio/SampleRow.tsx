import { useEffect, useMemo } from "react";
import type { SampleRef, TrackKind } from "@beats/shared";
import { useBeatsStore } from "@/store/useBeatsStore";

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
  const previewTrack = useBeatsStore((s) => s.previewTrack);
  const ensureEngineStarted = useBeatsStore((s) => s.ensureEngineStarted);

  useEffect(() => {
    void fetchSamples(kind);
  }, [fetchSamples, kind]);

  const groups = useMemo(
    () => groupByCategory(kindState.samples),
    [kindState.samples],
  );

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

  return (
    <div className="flex items-center gap-2">
      <label className="text-[9px] uppercase tracking-[0.2em] text-ink-muted w-14 shrink-0">
        sample
      </label>
      <select
        value={currentSampleId ?? ""}
        onChange={(e) => void onChange(e)}
        aria-label={`${kind} sample`}
        className="flex-1 min-w-0 h-8 px-2 pr-6 bg-bg-panel-2 border border-grid rounded text-ink-dim font-mono text-xs hover:border-ink-muted focus-visible:border-neon-violet transition-colors duration-200 ease-in motion-reduce:transition-none appearance-none cursor-pointer"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='%23b8a3e8' stroke-width='1.2' fill='none'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        <option value="" disabled>
          — choose a sample —
        </option>
        {groups.map(({ category, samples }) => (
          <SampleGroup
            key={category ?? "_flat"}
            category={category}
            samples={samples}
          />
        ))}
      </select>
      <button
        type="button"
        onClick={() => previewTrack(trackId)}
        disabled={!currentSampleId}
        aria-label="preview current sample"
        title="preview"
        className="h-8 w-8 shrink-0 rounded border border-grid text-ink-muted hover:border-ink-dim hover:text-ink transition-colors duration-200 ease-in motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ▸
      </button>
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
            {sample.name}
          </option>
        ))}
      </>
    );
  }
  return (
    <optgroup label={category}>
      {samples.map((sample) => (
        <option key={sample.id} value={sample.id}>
          {stripCategoryPrefix(sample.name, category)}
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
