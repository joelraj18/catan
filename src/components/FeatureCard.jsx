// A white tile with a sage icon well, used in the overview grid.
export default function FeatureCard({ title, description, icon, delay = 0 }) {
  return (
    <article className="feature-card reveal" style={{ '--reveal-delay': `${delay}s` }}>
      <span className="feature-icon" aria-hidden="true">
        {icon}
      </span>

      <h3>{title}</h3>

      <p>{description}</p>
    </article>
  );
}
