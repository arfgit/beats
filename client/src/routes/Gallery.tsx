import { GalleryGrid } from "@/features/gallery/GalleryGrid";

export default function GalleryRoute() {
  return (
    <div className="py-8 space-y-6">
      <header>
        <h1
          className="text-neon-magenta text-2xl tracking-[0.4em] uppercase"
          style={{ textShadow: "var(--glow-magenta)" }}
        >
          gallery
        </h1>
        <p className="text-ink-muted text-xs uppercase tracking-widest mt-1">
          public beats from the community · fork to remix
        </p>
      </header>
      <GalleryGrid />
    </div>
  );
}
