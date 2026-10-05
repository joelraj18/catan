// Two soft sage light pools behind the hero, the only ambient decoration on
// an otherwise clean canvas.
export default function BackgroundEffects() {
  return (
    <div className="background-effects" aria-hidden="true">
      <div className="sage-glow sage-glow--one" />
      <div className="sage-glow sage-glow--two" />
    </div>
  );
}
