import { useId } from 'react';

// The Manapally mark: a sage squircle finished like the back of a green
// iPhone, carrying an M beneath a Deepam lamp flame. Gradient ids are scoped
// with useId so the mark can appear several times on one page.
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
        d="M32 9.5c2.6 3 4.4 5.6 4.4 8 0 2.5-2 4.4-4.4 4.4s-4.4-1.9-4.4-4.4c0-2.4 1.8-5 4.4-8z"
        fill={`url(#${ink})`}
      />
      <path
        d="M17 47V27.2c0-1.4 1.7-2.1 2.7-1.1L32 38.4l12.3-12.3c1-1 2.7-.3 2.7 1.1V47"
        fill="none"
        stroke={`url(#${ink})`}
        strokeWidth="5.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Mark plus wordmark, used as the home link in every top bar and the footer.
export default function BrandLogo({ size = 26, showWordmark = true, className = '' }) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <BrandMark size={size} />
      {showWordmark && <span className="brand-logo-word">Manapally</span>}
    </span>
  );
}
