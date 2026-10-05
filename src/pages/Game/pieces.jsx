import React from 'react';

// Player colours. Each seat plays one colour; the colour tints every piece
// through `currentColor`. `colour` is the readable accent used for names
// and rings, `fill` is the paint on the wooden pieces drawn on the board.
export const PIECES = {
  red: { label: 'Red', name: 'Red', colour: '#c8372d', fill: '#c8372d', edge: '#7a1d17' },
  blue: { label: 'Blue', name: 'Blue', colour: '#2f5bea', fill: '#2f5bea', edge: '#1a3487' },
  white: { label: 'White', name: 'White', colour: '#8f8a7d', fill: '#f4f1e8', edge: '#6f6a5e' },
  orange: { label: 'Orange', name: 'Orange', colour: '#e07a1f', fill: '#ec8a2c', edge: '#8a4710' },
};

export const PIECE_ORDER = ['red', 'blue', 'white', 'orange'];

// A settlement (house) silhouette and a city (house with a tower).
export const SETTLEMENT_PATH = 'M12 3 20 10v11H4V10z';
export const CITY_PATH = 'M3 21V11l5-5 5 5v2h8v8z';

/**
 * Seats for one match: the host's chosen colour takes seat 1, the remaining
 * colours fill seats 2…n in PIECE_ORDER.
 * @param {string} hostPiece key from PIECES (e.g., 'red')
 * @param {number} playerCount number of players (3-4)
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
