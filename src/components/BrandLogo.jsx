import { useId } from 'react';

// The Catan mark: a sage squircle finished like the back of a green
// iPhone, carrying a hex tile with a settlement on it. Gradient ids are
// scoped with useId so the mark can appear several times on one page.
export function BrandMark({ size = 28, className = '' }) {
  const id = useId().replace(/:/g, '');
  const bg = `brand-bg-${id}`;
  const ink = `brand-ink-${id}`;

  return (
    <svg
      className={`brand-logo-mark ${className}`.trim()}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={bg} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d6dcc0" />
          <stop offset="0.55" stopColor="#bcc59f" />
          <stop offset="1" stopColor="#9ea984" />
        </linearGradient>
        <linearGradient id={ink} x1="32" y1="10" x2="32" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5a6a42" />
          <stop offset="1" stopColor="#3f4b2e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      <path
        d="M32 9 51.9 20.5v23L32 55 12.1 43.5v-23z"
        fill="none"
        stroke={`url(#${ink})`}
        strokeWidth="4.6"
        strokeLinejoin="round"
      />
      <path d="M32 22.5 41.5 30.5v12.5h-19V30.5z" fill={`url(#${ink})`} />
    </svg>
  );
}

// Mark plus wordmark, used as the home link in every top bar and the footer.
export default function BrandLogo({ size = 26, showWordmark = true, className = '' }) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <BrandMark size={size} />
      {showWordmark && <span className="brand-logo-word">Catan</span>}
    </span>
  );
}
