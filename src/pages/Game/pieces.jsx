import React from 'react';

// The MANAPALLY pieces, drawn as single path silhouettes so one path can
// serve as the panel token, the board token, and the ownership stamp, each
// tinted by its piece through `currentColor`. Every piece has its own colour,
// spread around the colour wheel so no two seats look alike. Pieces drawn
// with cut outs (eyes, windows) use the evenodd fill rule.
export const PIECES = {
  lamp: {
    label: 'Deepam (Lamp)',
    name: 'Lamp',
    colour: '#1e9e5a', // Emerald
    d: 'M12 2c0 2-2 4-2 6 0 1.5 1 2.5 2 2.5s2-1 2-2.5c0-2-2-4-2-6zm-7 10c0 3.5 3 6 7 6s7-2.5 7-6H5zm3 6v4h8v-4',
  },
  temple: {
    label: 'Gopuram (Temple)',
    name: 'Temple',
    colour: '#d63031', // Ruby
    d: 'M12 2l1 2h2.5l-1 3h2l-1 3h2.5v2H5v-2h2.5l-1-3h2l-1-3H11l1-2zm-4 10v8m4-8v8m4-8v8M4 20h16v2H4z',
  },
  elephant: {
    label: 'Gaja (Elephant)',
    name: 'Elephant',
    colour: '#f0700c', // Saffron
    d: 'M19 19v-5c0-3.5-2.5-5.5-6-5.5h-3c-2 0-3.5 1.5-3.5 3.5v1c-1.5 0-2.5 1-2.5 2.5 0 1.5 1 2.5 2.5 2.5h.5v4h2.5v-3h3.5v3H15v-3h4zm-9-8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  },
  bell: {
    label: 'Ghanta (Temple Bell)',
    name: 'Temple Bell',
    colour: '#2f5bea', // Royal blue
    d: 'M12 2a2 2 0 0 0-2 2v2a6 6 0 0 0-5 6v3l-2 2v1h18v-1l-2-2v-3a6 6 0 0 0-5-6V4a2 2 0 0 0-2-2zm-2 16a2 2 0 0 0 4 0',
  },
  tiger: {
    label: 'Puli (Tiger)',
    name: 'Tiger',
    colour: '#f2b705', // Gold
    rule: 'evenodd',
    d: 'M3.6 3l4.6 3.6h7.6L20.4 3l.9 7c.6 2.4.1 4.9-1.7 6.9-1.9 2.2-4.7 3.6-7.6 3.6s-5.7-1.4-7.6-3.6C2.6 14.9 2.1 12.4 2.7 10zM7.6 11h3.1l-1.5 1.9zm5.7 0h3.1l-1.6 1.9zm-2.8 3.6h3L12 16.4zM11.2 7.4h1.6v2.4h-1.6zM6.4 8.6l2.4 1-.5 1-2.4-1zm11.2 0l-2.4 1 .5 1 2.4-1zM9.3 7.4l1.1 1.7-.8.5-1.1-1.7zm5.4 0l-1.1 1.7.8.5 1.1-1.7zM3.9 12.8l2.8.3-.1 1-2.8-.3zm16.2 0l-2.8.3.1 1 2.8-.3zM4.6 15.1l2.6-.4.2 1-2.5.5zm14.8 0l-2.6-.4-.2 1 2.5.5z',
  },
  coconut: {
    label: 'Kobbari (Coconut)',
    name: 'Coconut',
    colour: '#8b5a2b', // Brown
    rule: 'evenodd',
    d: 'M12 4.5a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM9 10a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0zm3.8 0a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0zm-1.9 3.1a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0zM12 4.5C11.4 2.9 10 2 8.4 2c.8 1.4 2 2.3 3.6 2.5zm0 0c.6-1.6 2-2.5 3.6-2.5-.8 1.4-2 2.3-3.6 2.5z',
  },
  gun: {
    label: 'Tupaki (Gun)',
    name: 'Gun',
    colour: '#1c1c1e', // Black
    rule: 'evenodd',
    d: 'M3 7h18v4H3zm.2-1.6h2.2V7H3.2zm15.4.2h1.6V7h-1.6zM4.8 11h4.6l-1.5 7.5H3.4zm5.1 0h3.8v.5c0 1.9-1.2 3.1-3 3.1h-.8zm.8.6v2.4c1.2 0 1.9-.7 2.1-2.4z',
  },
  dumbbell: {
    label: 'Dumbbell',
    name: 'Dumbbell',
    colour: '#7f8c99', // Steel
    rule: 'evenodd',
    d: 'M1.5 10H4V8h2.4v8H4v-2H1.5zm5.1-3.5h2.6v11H6.6zm2.8 4.4h5.2v2.2H9.4zm5.4-4.4h2.6v11h-2.6zm2.8 1.5H20v2h2.5v4H20v2h-2.4z',
  },
  bat: {
    label: 'Cricket Bat',
    name: 'Cricket Bat',
    colour: '#0aa5c2', // Cyan
    rule: 'evenodd',
    d: 'M10.9 1.5h2.2v7h-2.2zM8.6 8.7h6.8v11.8a1.5 1.5 0 0 1-1.5 1.5H10.1a1.5 1.5 0 0 1-1.5-1.5zm3 1.8h.8v8.6h-.8zM17 18.6a2 2 0 1 0 4 0 2 2 0 1 0-4 0z',
  },
  auto: {
    label: 'Auto Rickshaw',
    name: 'Auto',
    colour: '#8cc152', // Lime
    rule: 'evenodd',
    d: 'M3 15.9V10.6C3 7.5 5.6 5 8.7 5H15c2.5 0 4 1.6 4.7 3.6l1.6 4.6v2.7zM6.2 10.6c0-1.7 1.3-3 3-3h3.4v3zm8.6-3h.4c1.1 0 1.9.6 2.4 1.7l.6 1.3h-3.4zM4.6 18.1a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0zm11.2 0a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0z',
  },
  clapper: {
    label: 'Clapperboard (Tollywood)',
    name: 'Clapper',
    colour: '#d6338a', // Magenta
    rule: 'evenodd',
    d: 'M3 10.4h18v9.1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5zm3 1.6h2.4l-1.6 2H4.4zm5 0h2.4l-1.6 2H9.4zm5 0h2.4l-1.6 2h-2.4zM2.6 8.4l16.8-4.5.7 2.4L3.3 10.2z',
  },
  crown: {
    label: 'Kireetam (Crown)',
    name: 'Crown',
    colour: '#7b4dff', // Violet
    rule: 'evenodd',
    d: 'M2.5 7.5l4.8 3.8L12 3.5l4.7 7.8 4.8-3.8-1.9 10.5H4.4zM11 13.6a1 1 0 1 0 2 0 1 1 0 1 0-2 0zM4.4 19h15.2v2H4.4z',
  },
};

export const PIECE_ORDER = ['lamp', 'temple', 'elephant', 'bell', 'tiger', 'coconut', 'gun', 'dumbbell', 'bat', 'auto', 'clapper', 'crown'];

/**
 * Seats for one match: the host's chosen piece takes seat 1, the remaining
 * pieces fill seats 2…n in PIECE_ORDER.
 * @param {string} hostPiece key from PIECES (e.g., 'lamp')
 * @param {number} playerCount number of players (2-4)
 * @returns {string[]} array of piece keys for each seat index (0-based)
 */
export const seatPieces = (hostPiece = 'lamp', playerCount = 2) => {
  const safeHost = PIECES[hostPiece] ? hostPiece : 'lamp';
  const remaining = PIECE_ORDER.filter((p) => p !== safeHost);
  const seats = [safeHost];
  for (let i = 1; i < playerCount; i++) {
    seats.push(remaining[(i - 1) % remaining.length]);
  }
  return seats;
};

/**
 * Renders a piece as an inline SVG.
 * @param {{ piece: string, variant?: 'token'|'stamp'|'chip', title?: string, className?: string }} props
 */
export function PieceMark({ piece, variant = 'token', title, className = '' }) {
  const config = PIECES[piece] || PIECES.lamp;

  let variantClass = 'piece-mark--token';
  let size = 28;
  let strokeWidth = 0;
  let fill = 'currentColor';

  if (variant === 'stamp') {
    variantClass = 'piece-mark--stamp';
    size = 36;
    strokeWidth = 1.8;
    fill = 'none';
  } else if (variant === 'chip') {
    variantClass = 'piece-mark--chip';
    size = 16;
    strokeWidth = 1.8;
    fill = 'none';
  }

  const combinedClass = `piece-mark piece-mark--${piece} ${variantClass} ${className}`.trim();

  return (
    <svg
      className={combinedClass}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-label={title || config.label}
      role="img"
    >
      <path
        d={config.d}
        fill={fill}
        fillRule={config.rule}
        clipRule={config.rule}
        stroke={strokeWidth > 0 ? 'currentColor' : 'none'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Renders Roman tally / 5-bar gate marks for property improvements:
 * 1-4 houses: 1 to 4 vertical strokes
 * hotel: 4 vertical strokes + 1 diagonal slash
 * @param {{ houses?: number, hotel?: boolean, className?: string }} props
 */
export function PropertyTally({ houses = 0, hotel = false, className = '' }) {
  if (!hotel && houses <= 0) return null;

  const count = hotel ? 4 : Math.min(houses, 4);
  const strokeWidth = 1.8;

  return (
    <svg
      className={`property-tally ${hotel ? 'property-tally--hotel' : ''} ${className}`.trim()}
      viewBox="0 0 20 14"
      width="20"
      height="14"
      role="img"
      aria-label={hotel ? 'Hotel (5 builds)' : `${houses} House${houses > 1 ? 's' : ''}`}
    >
      {/* 1-4 vertical tally lines */}
      {count >= 1 && <line x1="4" y1="2" x2="4" y2="12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />}
      {count >= 2 && <line x1="8" y1="2" x2="8" y2="12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />}
      {count >= 3 && <line x1="12" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />}
      {count >= 4 && <line x1="16" y1="2" x2="16" y2="12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />}
      {/* Diagonal slash for hotel */}
      {hotel && <line x1="2" y1="12" x2="18" y2="2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />}
    </svg>
  );
}
