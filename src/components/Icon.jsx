// Line icons drawn on a 24 unit grid with rounded caps, in the spirit of SF
// Symbols. They inherit colour from the surrounding text.
const PATHS = {
  crown: 'M4 17h16M5 17 3.5 8l5 3.5L12 5l3.5 6.5 5-3.5L19 17M6 20h12',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.5 3 5.2',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z',
  dice:
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3zM8.8 12.2l2.2 2.2 4.4-4.6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  train:
    'M7 3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM4 10h16M8.5 14h.01M15.5 14h.01M8 17l-2 4M16 17l2 4',
  bolt: 'M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8z',
  scroll:
    'M8 3h10a2 2 0 0 1 2 2v1.5h-4M8 3a2 2 0 0 0-2 2v12M8 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2h12M10 8h6M10 11.5h6',
  temple: 'M12 2.5 14 6h-4l2-3.5zM8 6h8l1.5 4h-11L8 6zM5 10h14v2H5zM6.5 12v7M10 12v7M14 12v7M17.5 12v7M3.5 21h17',
  fort: 'M4 21V9h3V6h2v3h2V6h2v3h2V6h2v3h3v12M4 21h16M10 21v-4a2 2 0 0 1 4 0v4',
  leaf: 'M5 19c0-8 5.5-13.5 15-14-.4 9.5-6 15-14 15M5 19l7.5-7.5',
  coins:
    'M9 10c3.3 0 6-1.1 6-2.5S12.3 5 9 5 3 6.1 3 7.5 5.7 10 9 10zM3 7.5v4C3 12.9 5.7 14 9 14s6-1.1 6-2.5v-4M3 11.5v4C3 16.9 5.7 18 9 18c1 0 2-.1 2.8-.3M15 13c3.3 0 6 1.1 6 2.5S18.3 18 15 18s-6-1.1-6-2.5M21 15.5v3c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5v-3',
  building: 'M4 21V8l8-5 8 5v13M4 21h16M9 21v-5h6v5M8.5 11h.01M15.5 11h.01',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  layers: 'm12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 16.5l9 5 9-5',
  rupee: 'M7 4h10M7 8.5h10M7 4c4.5 0 6 1.8 6 4.5S11.5 13 7 13l7.5 7',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  home: 'M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5',
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
