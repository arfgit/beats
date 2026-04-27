export type EngineEvent = "step" | "rec";

export interface RecState {
  active: boolean;
  elapsedMs: number;
}

export interface EventPayloadMap {
  step: number;
  rec: RecState;
}

type Listener<E extends EngineEvent> = (payload: EventPayloadMap[E]) => void;

export class EngineSubscribers {
  private readonly step = new Set<Listener<"step">>();
  private readonly rec = new Set<Listener<"rec">>();

  subscribe<E extends EngineEvent>(event: E, cb: Listener<E>): () => void {
    const set = this.bucket(event);
    set.add(cb as Listener<EngineEvent>);
    return () => set.delete(cb as Listener<EngineEvent>);
  }

  emit<E extends EngineEvent>(event: E, payload: EventPayloadMap[E]): void {
    const set = this.bucket(event);
    for (const cb of set) {
      try {
        (cb as Listener<E>)(payload);
      } catch (err) {
         
        console.error(`[audio] subscriber for ${event} threw`, err);
      }
    }
  }

  clear(): void {
    this.step.clear();
    this.rec.clear();
  }

  private bucket<E extends EngineEvent>(event: E): Set<Listener<EngineEvent>> {
    return (event === "step" ? this.step : this.rec) as Set<
      Listener<EngineEvent>
    >;
  }
}
