// Vector illustrations for the special board tiles. Each one is drawn on a
// 48 unit grid with a soft filled body and a crisp outline, using the tile's
// own colour (currentColor) and a lighter wash, so they sit inside the sage
// palette in light and dark themes alike.

const ART = {
  go: (
    <>
      <path className="tile-art-fill" d="M40 30H18v-8L6 34l12 12v-8h22z" />
      <path d="M40 30H18v-8L6 34l12 12v-8h22z" />
      <path className="tile-art-accent" d="M13 17 11 7l6 4 4-7 4 7 6-4-2 10z" />
      <path d="M13 17 11 7l6 4 4-7 4 7 6-4-2 10zM13 21h16" />
    </>
  ),
  chest: (
    <>
      <path className="tile-art-fill" d="M8 22h32v18H8z" />
      <path className="tile-art-accent" d="M8 22c0-7 7-12 16-12s16 5 16 12z" />
      <path d="M8 22c0-7 7-12 16-12s16 5 16 12M8 22h32v18H8zM8 28h32M20 25h8v7h-8zM16 11v11M32 11v11" />
      <circle cx="24" cy="29" r="1.4" />
    </>
  ),
  chance: (
    <>
      <path className="tile-art-fill" d="M12 8h22a4 4 0 0 1 4 4v28H16a4 4 0 0 1-4-4z" />
      <path d="M12 8h22a4 4 0 0 1 4 4v28H16a4 4 0 0 1-4-4zM12 36a4 4 0 0 1 4-4h22" />
      <path className="tile-art-accent-stroke" d="M20 17a5 5 0 1 1 7 4.6c-1.6.7-2.5 1.8-2.5 3.4v1" />
      <circle className="tile-art-dot" cx="24.5" cy="29" r="1.6" />
    </>
  ),
  jail: (
    <>
      <path className="tile-art-fill" d="M8 10h32v30H8z" />
      <path d="M8 10h32v30H8zM8 16h32M15 16v24M21 16v24M27 16v24M33 16v24" />
      <path className="tile-art-accent" d="M30 26h8v8h-8z" />
      <path d="M30 26h8v8h-8zM32 26v-2a2 2 0 0 1 4 0v2" />
    </>
  ),
  parking: (
    <>
      <path className="tile-art-fill" d="M6 30l4-9a4 4 0 0 1 3.7-2.5h20.6A4 4 0 0 1 38 21l4 9v8H6z" />
      <path d="M6 30l4-9a4 4 0 0 1 3.7-2.5h20.6A4 4 0 0 1 38 21l4 9v8H6zM6 30h36M11 30l3-7h20l3 7" />
      <circle className="tile-art-accent" cx="14" cy="38" r="4" />
      <circle className="tile-art-accent" cx="34" cy="38" r="4" />
      <circle cx="14" cy="38" r="4" />
      <circle cx="34" cy="38" r="4" />
      <path d="M21 8h4a3 3 0 0 1 0 6h-4V6v8" />
    </>
  ),
  goToJail: (
    <>
      <circle className="tile-art-fill" cx="18" cy="12" r="5" />
      <path className="tile-art-fill" d="M10 40V25a8 8 0 0 1 16 0v15z" />
      <path d="M10 40V25a8 8 0 0 1 16 0v15M12 7.5l12 0" />
      <circle cx="18" cy="12" r="5" />
      <path className="tile-art-accent-stroke" d="M24 26h16M34 20l6 6-6 6" />
    </>
  ),
  train: (
    <>
      <path className="tile-art-fill" d="M13 6h22a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5z" />
      <path d="M13 6h22a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5zM8 22h32M18 10h12" />
      <path className="tile-art-accent" d="M12 13h10v6H12zM26 13h10v6H26z" />
      <circle cx="15" cy="29" r="2" />
      <circle cx="33" cy="29" r="2" />
      <path d="M14 37l-4 6M34 37l4 6M12 41h24" />
    </>
  ),
  power: (
    <>
      <path className="tile-art-fill" d="M24 5a13 13 0 0 0-8 23.3V33h16v-4.7A13 13 0 0 0 24 5z" />
      <path d="M24 5a13 13 0 0 0-8 23.3V33h16v-4.7A13 13 0 0 0 24 5zM17 37h14M19 41h10" />
      <path className="tile-art-accent" d="M26 11l-7 10h5l-2 8 7-10h-5z" />
      <path d="M26 11l-7 10h5l-2 8 7-10h-5z" />
    </>
  ),
  water: (
    <>
      <path className="tile-art-fill" d="M6 12h18a6 6 0 0 1 6 6v4h-8v-2H6z" />
      <path d="M6 12h18a6 6 0 0 1 6 6v4h-8v-2H6zM6 9v14M14 12V7M10 7h8" />
      <path className="tile-art-accent" d="M26 28c3 4 5 7 5 9.5a5 5 0 0 1-10 0c0-2.5 2-5.5 5-9.5z" />
      <path d="M26 28c3 4 5 7 5 9.5a5 5 0 0 1-10 0c0-2.5 2-5.5 5-9.5z" />
    </>
  ),
  tax: (
    <>
      <ellipse className="tile-art-fill" cx="20" cy="34" rx="12" ry="4" />
      <path className="tile-art-fill" d="M8 28v6c0 2.2 5.4 4 12 4s12-1.8 12-4v-6" />
      <path d="M8 28v6c0 2.2 5.4 4 12 4s12-1.8 12-4v-6M8 22v6c0 2.2 5.4 4 12 4s12-1.8 12-4v-6" />
      <ellipse className="tile-art-accent" cx="20" cy="22" rx="12" ry="4" />
      <ellipse cx="20" cy="22" rx="12" ry="4" />
      <circle className="tile-art-fill" cx="34" cy="13" r="8" />
      <circle cx="34" cy="13" r="8" />
      <path d="M30.5 9.5h7M30.5 12.5h7M30.5 9.5c2.6 0 3.6 1 3.6 2.6S32.6 15 30.5 15l4.6 4" />
    </>
  ),
};

export const hasTileArt = (kind) => Boolean(ART[kind]);

export default function TileArt({ kind, className = '' }) {
  const art = ART[kind];

  if (!art) {
    return null;
  }

  return (
    <svg className={`tile-art tile-art--${kind} ${className}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {art}
    </svg>
  );
}
