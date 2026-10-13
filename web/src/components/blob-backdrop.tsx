/**
 * A quiet backdrop for the signed-in pages: two very light, blurred green blobs
 * fixed behind the content, one high on the right and one low on the left. Still,
 * and faint enough that cards and text read as if on plain paper. The page's
 * content sits above it (`relative z-10`).
 */
export function BlobBackdrop() {
  const blob = (strength: number) =>
    `radial-gradient(closest-side, color-mix(in oklab, var(--signal) ${strength}%, transparent), color-mix(in oklab, var(--signal) ${Math.round(strength / 3)}%, transparent) 55%, transparent)`;
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="absolute -right-[12vw] -top-[18vh] h-[75vh] w-[60vw] rounded-full blur-3xl" style={{ background: blob(22) }} />
      <div className="absolute -bottom-[22vh] -left-[14vw] h-[70vh] w-[55vw] rounded-full blur-3xl" style={{ background: blob(16) }} />
    </div>
  );
}
