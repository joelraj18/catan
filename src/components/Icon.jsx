// Line icons drawn on a 24 unit grid with rounded caps, in the spirit of SF
// Symbols. They inherit colour from the surrounding text.
const PATHS = {
  crown: 'M4 17h16M5 17 3.5 8l5 3.5L12 5l3.5 6.5 5-3.5L19 17M6 20h12',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z',
  dice:
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3zM8.8 12.2l2.2 2.2 4.4-4.6',
  coins:
    'M9 10c3.3 0 6-1.1 6-2.5S12.3 5 9 5 3 6.1 3 7.5 5.7 10 9 10zM3 7.5v4C3 12.9 5.7 14 9 14s6-1.1 6-2.5v-4M3 11.5v4C3 16.9 5.7 18 9 18c1 0 2-.1 2.8-.3M15 13c3.3 0 6 1.1 6 2.5S18.3 18 15 18s-6-1.1-6-2.5M21 15.5v3c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5v-3',
  hex: 'M12 2.5 20.2 7.25v9.5L12 21.5l-8.2-4.75v-9.5z',
  brick: 'M3 6h8v4H3zM13 6h8v4h-8zM3 14h4v4H3zM9 14h8v4H9zM19 14h2v4h-2z',
  lumber: 'M12 3 6 12h3l-4 6h14l-4-6h3zM12 18v3',
  ore: 'M3 19 8.5 8l3.5 4 3-5 6 12zM8.5 8l2 6',
  grain: 'M12 21V9m0 0-3-3m3 3 3-3m-3 7-3-3m3 3 3-3m-3 7-3-3m3 3 3-3M12 9V3',
  wool: 'M6 15a3 3 0 0 1 0-6 4 4 0 0 1 7-2 3.5 3.5 0 0 1 5 3 3 3 0 0 1 0 6zM8 16v4M16 16v4',
  desert: 'M3 17c3-2 6-2 9 0s6 2 9 0M5 11c2.5-1.5 5-1.5 7.5 0s5 1.5 7.5 0M17 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  robber: 'M8 21c0-6 1.5-9 3-10a3.5 3.5 0 1 1 2 0c1.5 1 3 4 3 10z',
  anchor: 'M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 6v15M8 10h8M4 13c0 4.5 3.5 8 8 8s8-3.5 8-8',
  road: 'M5 21 9.5 3M19 21 14.5 3M12 5v2.5M12 11v2.5M12 17v2.5',
  settlement: 'M12 4 20 11v9H4v-9z',
  city: 'M3 20V11l5-5 5 5v2h8v7zM8 20v-4',
  card: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h3',
  trade: 'M4 8h14l-4-4M20 16H6l4 4',
};

export default function Icon({ name, size = 24, strokeWidth = 1.7, className = '' }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
