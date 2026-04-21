import { Link } from "react-router-dom";

export default function NotFoundRoute() {
  return (
    <div className="py-24 text-center">
      <p className="text-neon-magenta text-5xl tracking-[0.3em] mb-4">404</p>
      <p className="text-ink-dim text-sm mb-6">no such route.</p>
      <Link
        to="/"
        className="text-neon-cyan text-xs uppercase tracking-widest border-b border-neon-cyan pb-0.5"
      >
        back to studio
      </Link>
    </div>
  );
}
