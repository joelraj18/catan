import React from 'react';

// Small illustrated icons for the table panel. Each is a few flat shapes in
// fixed colours with a darker outline, so they read on light and dark
// surfaces alike at 16 to 20 pixels.

const Svg = ({ size = 18, title, children, className = '' }) => (
  <svg
    className={`table-icon ${className}`.trim()}
    viewBox="0 0 24 24"
    width={size}
    height={size}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : 'true'}
  >
    {children}
  </svg>
);

// Resource cards: two fanned cards.
export const CardsIcon = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="11" height="15" rx="2" transform="rotate(-12 9 12.5)" fill="#f3c968" stroke="#9a6b12" strokeWidth="1.2" />
    <rect x="8.5" y="4" width="11" height="15" rx="2" fill="#fff4d6" stroke="#9a6b12" strokeWidth="1.2" />
    <path d="M11.5 9.5h5M11.5 12.5h5M11.5 15.5h3" stroke="#c99a2e" strokeWidth="1.3" strokeLinecap="round" />
  </Svg>
);

// Development cards: a scroll with a wax seal.
export const ScrollIcon = (props) => (
  <Svg {...props}>
    <path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5" fill="#efe3ff" stroke="#6a3fb5" strokeWidth="1.2" />
    <path d="M5 5a1.5 1.5 0 0 1 3 0v2H5z" fill="#d6c2fb" stroke="#6a3fb5" strokeWidth="1.2" />
    <path d="M10 9h6M10 12h6" stroke="#9b7bd8" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="14.5" cy="16.5" r="2.4" fill="#c0392b" stroke="#7d1f16" strokeWidth="1" />
  </Svg>
);

// Knights played: a helmet with a plume.
export const KnightIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3c3 0 6 1 6 1-1 1-2 1-3 1" fill="#e2574c" stroke="#8e2219" strokeWidth="1" strokeLinejoin="round" />
    <path d="M6 12a6 6 0 0 1 12 0v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18.5z" fill="#c7cdd6" stroke="#4d5560" strokeWidth="1.2" />
    <path d="M8 13h8v2.2H8z" fill="#4d5560" />
    <path d="M12 6v14" stroke="#9aa3ae" strokeWidth="1" />
  </Svg>
);

// Longest road length: a winding road.
export const RoadIcon = (props) => (
  <Svg {...props}>
    <path d="M4 20c3-4 10-3 11-7s-6-4-5-8" fill="none" stroke="#7a5230" strokeWidth="5" strokeLinecap="round" />
    <path d="M4 20c3-4 10-3 11-7s-6-4-5-8" fill="none" stroke="#c9a06a" strokeWidth="3" strokeLinecap="round" />
    <path d="M4 20c3-4 10-3 11-7s-6-4-5-8" fill="none" stroke="#fff3d8" strokeWidth="0.9" strokeDasharray="1.6 2" />
  </Svg>
);

// Longest Road card: road with a crown.
export const LongestRoadIcon = (props) => (
  <Svg {...props}>
    <path d="M3 21c3-3 9-2 10-5" fill="none" stroke="#7a5230" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M3 21c3-3 9-2 10-5" fill="none" stroke="#c9a06a" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M11 10 12.5 4l3 3.5L18 3l2.5 4.5L23 5l-1 5z" fill="#f2c94c" stroke="#8a6408" strokeWidth="1" strokeLinejoin="round" />
  </Svg>
);

// Largest Army card: crossed swords.
export const ArmyIcon = (props) => (
  <Svg {...props}>
    <path d="M5 4l10 10M19 4 9 14" stroke="#c7cdd6" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M5 4l10 10M19 4 9 14" stroke="#4d5560" strokeWidth="0.8" strokeLinecap="round" />
    <path d="M13 16l3-3M11 16l-3-3" stroke="#8a6408" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M17 18l2 2M7 18l-2 2" stroke="#7a5230" strokeWidth="2.4" strokeLinecap="round" />
  </Svg>
);

// Victory points: a sun medal.
export const SunIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="5" fill="#f6b73c" stroke="#a56a07" strokeWidth="1.2" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="#e39b16" strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
);

// Role marks.
export const ComputerIcon = (props) => (
  <Svg {...props}>
    <rect x="5" y="7" width="14" height="11" rx="3" fill="#dfe8f7" stroke="#3b5b8f" strokeWidth="1.2" />
    <circle cx="9.5" cy="12.5" r="1.4" fill="#3b5b8f" />
    <circle cx="14.5" cy="12.5" r="1.4" fill="#3b5b8f" />
    <path d="M12 4v3M3 12h2M19 12h2" stroke="#3b5b8f" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="12" cy="3.5" r="1.2" fill="#e2574c" />
  </Svg>
);

export const SparkIcon = (props) => (
  <Svg {...props}>
    <path d="M12 2.5c.6 4.7 2.6 6.9 7.3 7.5-4.7.6-6.7 2.8-7.3 7.5-.6-4.7-2.6-6.9-7.3-7.5 4.7-.6 6.7-2.8 7.3-7.5z" fill="#e8835a" stroke="#9c4320" strokeWidth="1" strokeLinejoin="round" />
    <path d="M18.5 15.5c.3 1.9 1 2.7 2.9 3-1.9.3-2.6 1.1-2.9 3-.3-1.9-1-2.7-2.9-3 1.9-.3 2.6-1.1 2.9-3z" fill="#f3c968" stroke="#9a6b12" strokeWidth="0.8" />
  </Svg>
);

export const PersonIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="8" r="3.6" fill="#cfe6cf" stroke="#3f6f45" strokeWidth="1.2" />
    <path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6z" fill="#cfe6cf" stroke="#3f6f45" strokeWidth="1.2" strokeLinejoin="round" />
  </Svg>
);

export const AwayIcon = (props) => (
  <Svg {...props}>
    <path d="M3 9a13 13 0 0 1 18 0M6.5 12.5a8 8 0 0 1 11 0M10 16a3 3 0 0 1 4 0" fill="none" stroke="#9aa3ae" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M4 4l16 16" stroke="#c0392b" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);

// Pieces left in supply.
export const PieceIcon = ({ kind, ...props }) => (
  <Svg {...props}>
    {kind === 'road' && <rect x="3" y="10" width="18" height="4.5" rx="1.5" fill="currentColor" />}
    {kind === 'settlement' && <path d="M12 4 20 11v9H4v-9z" fill="currentColor" />}
    {kind === 'city' && <path d="M3 20V11l5-5 5 5v2h8v7z" fill="currentColor" />}
  </Svg>
);
