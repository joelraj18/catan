import React from 'react';

// Player colours. Each seat plays one colour; the colour tints every piece
// through `currentColor`. `colour` is the readable accent used for names
// and rings, `fill` is the paint on the wooden pieces drawn on the board.
// A colour moved toward white (amount > 0) or black (amount < 0).
export const shade = (hex, amount) => {
  const value = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const mix = (channel) => Math.round(channel + (target - channel) * Math.abs(amount));
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

// The painted wood: `fill` on the faces in light, `light` on the roofs and
// tops that catch it, `side` on the walls turned away, `edge` for outlines.
const paint = (entry) => ({ ...entry, light: shade(entry.fill, 0.28), side: shade(entry.fill, -0.22) });

export const PIECES = {
  red: paint({ label: 'Red', name: 'Red', colour: '#c8372d', fill: '#d23b30', edge: '#7a1d17' }),
  blue: paint({ label: 'Blue', name: 'Blue', colour: '#2f5bea', fill: '#2f62e6', edge: '#1a3487' }),
  white: { ...paint({ label: 'White', name: 'White', colour: '#8f8a7d', fill: '#f6f3ea', edge: '#55503f' }), side: '#d6d0bf' },
  orange: paint({ label: 'Orange', name: 'Orange', colour: '#e07a1f', fill: '#ef8a26', edge: '#8a4710' }),
  // The 5-6 player extension's colours.
  green: paint({ label: 'Green', name: 'Green', colour: '#178a55', fill: '#22a066', edge: '#0d5434' }),
  purple: paint({ label: 'Purple', name: 'Purple', colour: '#7a4cc8', fill: '#8457d6', edge: '#4a2a86' }),
};

export const PIECE_ORDER = ['red', 'blue', 'white', 'orange', 'green', 'purple'];

// A settlement (house) silhouette and a city (house with a tower).
export const SETTLEMENT_PATH = 'M12 3 20 10v11H4V10z';
export const CITY_PATH = 'M3 21V11l5-5 5 5v2h8v8z';

// The same two pieces drawn a little in the round, in a 24 unit box with
// the light from the top left: a lit front, a shaded side wall and a roof
// that catches the light, standing on a soft shadow.
export function Settlement3D({ colour, shadow = true }) {
  return (
    <g className="piece3d piece3d--settlement" strokeLinejoin="round" strokeWidth="1" stroke={colour.edge}>
      {shadow && <ellipse className="piece3d-shadow" cx="13" cy="21.6" rx="10.5" ry="2.6" />}
      <path d="M16 11.5 21 9v9.6L16 21z" fill={colour.side} />
      <path d="M3 11.5 9.5 5 16 11.5V21H3z" fill={colour.fill} />
      <path d="M9.5 5 14.5 2.5 21 9l-5 2.5z" fill={colour.light} />
      <path d="M8 21v-5h3v5" fill={colour.side} strokeWidth="0.8" />
      <path d="M3.6 11.2 9.5 5.3" stroke={colour.light} strokeWidth="0.9" fill="none" opacity="0.8" />
    </g>
  );
}

export function City3D({ colour, shadow = true }) {
  return (
    <g className="piece3d piece3d--city" strokeLinejoin="round" strokeWidth="1" stroke={colour.edge}>
      {shadow && <ellipse className="piece3d-shadow" cx="13.5" cy="21.6" rx="12" ry="2.8" />}
      <path d="M20 13 23.5 11.2v8L20 21z" fill={colour.side} />
      <path d="M11 13h9v8h-9z" fill={colour.fill} />
      <path d="M11 13 14.5 11.2h9L20 13z" fill={colour.light} />
      <path d="M11 8.5 14 7v12.4L11 21z" fill={colour.side} />
      <path d="M2.5 8.5 6.8 4.2 11 8.5V21H2.5z" fill={colour.fill} />
      <path d="M6.8 4.2 9.8 2.7 14 7l-3 1.5z" fill={colour.light} />
      <rect x="5.4" y="10.5" width="2.8" height="3.4" rx="0.6" fill={colour.side} strokeWidth="0.7" />
      <path d="M13.5 21v-4h3v4" fill={colour.side} strokeWidth="0.8" />
      <path d="M3.1 8.2 6.8 4.5" stroke={colour.light} strokeWidth="0.9" fill="none" opacity="0.8" />
    </g>
  );
}

/**
 * Seats for one match: the host's chosen colour takes seat 1, the remaining
 * colours fill seats 2…n in PIECE_ORDER.
 * @param {string} hostPiece key from PIECES (e.g., 'red')
 * @param {number} playerCount number of players (2-6)
 * @returns {string[]} array of colour keys for each seat index (0-based)
 */
export const seatPieces = (hostPiece = 'red', playerCount = 3) => {
  const safeHost = PIECES[hostPiece] ? hostPiece : 'red';
  const remaining = PIECE_ORDER.filter((p) => p !== safeHost);
  const seats = [safeHost];
  for (let i = 1; i < playerCount; i += 1) {
    seats.push(remaining[(i - 1) % remaining.length]);
  }
  return seats;
};

/**
 * Renders a player's colour as a small settlement.
 * @param {{ piece: string, variant?: 'token'|'stamp'|'chip', title?: string, className?: string }} props
 */
export function PieceMark({ piece, variant = 'token', title, className = '' }) {
  const config = PIECES[piece] || PIECES.red;
  const size = variant === 'stamp' ? 36 : variant === 'chip' ? 16 : 28;
  const outline = variant !== 'token';

  return (
    <svg
      className={`piece-mark piece-mark--${piece} piece-mark--${variant} ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-label={title || config.label}
      role="img"
    >
      <path
        d={SETTLEMENT_PATH}
        fill={outline ? 'none' : config.fill}
        stroke={outline ? 'currentColor' : config.edge}
        strokeWidth={outline ? 1.8 : 1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
