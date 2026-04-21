/**
 * Lightweight analytics facade. Ships `POST /api/analytics/event` when
 * enabled; dry-logs to console otherwise. Swap in PostHog/Plausible by
 * replacing the `dispatch` implementation — all call sites use `track()`.
 */

type EventName =
  | "sign_in"
  | "sign_out"
  | "project_create"
  | "project_fork"
  | "project_save"
  | "project_publish"
  | "project_load"
  | "play"
  | "stop"
  | "record_start"
  | "record_stop"
  | "record_download"
  | "effect_toggle"
  | "invite_sent"
  | "route_view";

type EventProps = Record<string, string | number | boolean | null | undefined>;

const DEV = import.meta.env.DEV;
const ENABLED = import.meta.env.VITE_ANALYTICS_ENABLED === "true";

async function dispatch(name: EventName, props: EventProps): Promise<void> {
  if (DEV) {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", name, props);
  }
  if (!ENABLED) return;
  try {
    await fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, props, ts: Date.now() }),
      keepalive: true,
    });
  } catch {
    // swallow — analytics must never break the app
  }
}

export function track(name: EventName, props: EventProps = {}): void {
  void dispatch(name, props);
}
