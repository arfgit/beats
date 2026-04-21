import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { track } from "./analytics";

/** Fires `route_view` on each pathname change. */
export function useRouteTracker(): void {
  const location = useLocation();
  useEffect(() => {
    track("route_view", { path: location.pathname });
  }, [location.pathname]);
}
