import { GalleryGrid } from "@/features/gallery/GalleryGrid";

export default function GalleryRoute() {
  return (
    <div className="py-8 space-y-6">
      <header>
        <h1 className="text-ink text-lg tracking-[0.3em] uppercase font-normal">
          <span className="text-neon-magenta">/</span> gallery
        </h1>
        <p className="text-ink-muted text-[10px] uppercase tracking-widest mt-1">
          public beats from the community · fork to remix
        </p>
      </header>
      <GalleryGrid />
    </div>
  );
}
