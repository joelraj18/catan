import React, { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PIPS, RESOURCE_LABELS, TERRAINS, geometryOf } from './catanBoard';
import { CITY_PATH, City3D, PIECES, SETTLEMENT_PATH, Settlement3D } from './pieces.jsx';
import { scaled } from '../../services/motion';
import './hex-board.css';

// The island drawn as one SVG: sea, terrain hexes with their number tokens,
// harbours, roads, settlements, cities and the robber. Legal spots for the
// current move are highlighted and clickable.

export const UNIT = 60; // pixels per hex radius in the SVG's own units

// Enter or Space on a board target; Space would otherwise scroll the page.
const onPress = (fn) => (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  fn();
};

// Where a spot is, for screen readers: the land hexes it touches.
const placeOf = (board, hexIds) =>
  hexIds
    .map((id) => board.hexes[id])
    .filter(Boolean)
    .map((tile) => `${TERRAINS[tile.terrain].label.toLowerCase()}${tile.number ? ` ${tile.number}` : ''}`)
    .join(', ') || 'the coast';

const px = (value) => Math.round(value * UNIT * 10) / 10;

const hexPoints = (geo, hex, inset = 0) =>
  hex.vertices
    .map((vertexId) => {
      const v = geo.vertices[vertexId];
      const x = hex.x + (v.x - hex.x) * (1 - inset);
      const y = hex.y + (v.y - hex.y) * (1 - inset);
      return `${px(x)},${px(y)}`;
    })
    .join(' ');

// The gap between two tiles, in hex radii. Every tile is drawn this much
// smaller, and the island's ground shows through: the same width between
// two tiles as between a tile and the sea.
export const GAP = 0.07;
const HARBOR_R = 16;
const TILE_INSET = GAP / Math.sqrt(3); // from the centre toward each corner

// Terrain motifs, drawn around (0,0) inside a hex of radius UNIT.
function TerrainMotif({ terrain }) {
  switch (terrain) {
    case 'forest':
      return (
        <g className="motif motif--forest">
          {[[-24, -6], [0, -22], [22, -4], [-10, 18], [16, 20]].map(([x, y]) => (
            <path key={`${x}${y}`} d={`M${x} ${y - 13}l9 15h-5l7 10h-22l7-10h-5z`} />
          ))}
        </g>
      );
    case 'hills':
      return (
        <g className="motif motif--hills">
          <path d="M-44 16c10-16 22-22 32-14 8-14 22-16 30-4 6-6 14-6 20 2" />
          <path d="M-30 -10c8-10 18-12 26-4 8-8 18-8 26 2" />
          {[[-16, 26], [4, 26], [-6, 34]].map(([x, y]) => (
            <rect key={`${x}${y}`} x={x} y={y} width="16" height="7" rx="1.5" />
          ))}
        </g>
      );
    case 'mountains':
      return (
        <g className="motif motif--mountains">
          <path d="M-46 24 -18 -20 2 10 14 -8 44 24z" />
          <path className="motif-snow" d="M-18 -20 -11 -9-16-8-22-12zM14-8 20 1 15 0 10 -2z" />
        </g>
      );
    case 'fields':
      return (
        <g className="motif motif--fields">
          {[-26, -13, 0, 13, 26].map((x) => (
            <g key={x}>
              <path d={`M${x} 30v-38`} />
              <path d={`M${x} -8l-5-7m5 7 5-7m-5 15-5-7m5 7 5-7m-5 15-5-7m5 7 5-7`} />
            </g>
          ))}
        </g>
      );
    case 'pasture':
      return (
        <g className="motif motif--pasture">
          {[[-20, 10], [16, -12], [12, 22]].map(([x, y]) => (
            <g key={`${x}${y}`} transform={`translate(${x} ${y})`}>
              <ellipse rx="10" ry="7" className="sheep" />
              <circle cx="10" cy="-3" r="3.5" className="sheep-head" />
            </g>
          ))}
          <path d="M-36-16l3-6 3 6m22 30 3-6 3 6m30-34 3-6 3 6" />
        </g>
      );
    case 'desert':
      return (
        <g className="motif motif--desert">
          <path d="M-40 18c14-10 30-10 44 0s28 10 36 2" />
          <path d="M-30 -4c10-7 22-7 32 0s20 7 28 1" />
        </g>
      );
    default:
      return null;
  }
}

// One symbol per resource, used on tiles, cards, harbours and notes: a brick
// wall, two cut logs, a pile of ore, a sheaf of wheat and a sheep. Drawn in
// currentColor, with lighter parts as translucent white so they read on any
// background.
const RESOURCE_ART = {
  brick: (
    <>
      <path d="M2.5 5.5h8.6v4.2H2.5zM12.9 5.5h8.6v4.2h-8.6zM2.5 11.4h3.7v4.2H2.5zM8 11.4h8.6v4.2H8zM18.4 11.4h3.1v4.2h-3.1zM2.5 17.3h8.6v4.2H2.5zM12.9 17.3h8.6v4.2h-8.6z" />
    </>
  ),
  lumber: (
    <>
      {[
        [7, 16.4],
        [17, 16.4],
        [12, 7.6],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <circle cx={x} cy={y} r="5" />
          <circle cx={x} cy={y} r="3.4" className="resource-icon-cut" />
          <circle cx={x} cy={y} r="1.5" className="resource-icon-ring" />
        </g>
      ))}
    </>
  ),
  ore: (
    <>
      <path d="M2 20.5 5.6 11 10.6 7.5 15.2 11.2 17.4 20.5z" />
      <path d="M13.2 20.5 15.6 13.4 19.6 11.8 22.2 20.5z" opacity="0.72" />
      <path d="M5.6 11 9 14.6 10.6 7.5M9 14.6 8.4 20.5M9 14.6l6.2-3.4" className="resource-icon-line" />
    </>
  ),
  grain: (
    <>
      <path d="M12 22V8.5M12 22c-.8-4.6-2.6-8.6-5.6-11.6M12 22c.8-4.6 2.6-8.6 5.6-11.6" className="resource-icon-stem" />
      <ellipse cx="12" cy="5.6" rx="2.3" ry="4.2" />
      <ellipse cx="6" cy="8.2" rx="2.1" ry="3.8" transform="rotate(-32 6 8.2)" />
      <ellipse cx="18" cy="8.2" rx="2.1" ry="3.8" transform="rotate(32 18 8.2)" />
      <rect x="9" y="15.4" width="6" height="2.4" rx="1.2" />
    </>
  ),
  wool: (
    <>
      <path
        d="M8.5 17.6a3.4 3.4 0 0 1-2-6.2 3.5 3.5 0 0 1 5.2-3.6 3.6 3.6 0 0 1 6.2.9 3.3 3.3 0 0 1 2.6 5.4 3 3 0 0 1-3 3.5z"
        className="resource-icon-fleece"
      />
      <ellipse cx="5.2" cy="11.6" rx="2.5" ry="3.1" transform="rotate(-18 5.2 11.6)" />
      <rect x="8.6" y="16.4" width="2" height="5" rx="1" />
      <rect x="14.6" y="16.4" width="2" height="5" rx="1" />
    </>
  ),
};

export function ResourceIcon({ resource, size = 18, className = '' }) {
  return (
    <svg
      className={`resource-icon resource-icon--${resource} ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-label={RESOURCE_LABELS[resource]}
      role="img"
      fill="currentColor"
    >
      {RESOURCE_ART[resource]}
    </svg>
  );
}

function NumberToken({ number, x, y, hot, blocked = false, pop = null, rolled = null }) {
  const pips = PIPS[number] || 0;
  const ways = 6 - Math.abs(7 - number);
  return (
    <g className={`number-token ${hot ? 'number-token--hot' : ''} ${blocked ? 'number-token--blocked' : ''}`} transform={`translate(${x} ${y})`}>
      <title>
        {`${number}: ${ways} in 36, ${((ways / 36) * 100).toFixed(1)}% a roll${rolled !== null ? ` \u00b7 rolled ${rolled} time${rolled === 1 ? '' : 's'} so far` : ''}${
          blocked ? ' \u00b7 blocked by the dragon' : ''
        }`}
      </title>
      <g key={pop ?? 'still'} className={pop ? 'number-token-pop' : undefined}>
      <circle r="19.5" cy="2" className="number-token-shadow" />
      <circle r="19.5" className="number-token-face" />
      <text y="-1" textAnchor="middle" dominantBaseline="middle">
        {number}
      </text>
      {Array.from({ length: pips }, (_, i) => (
        <circle key={i} className="number-token-pip" cx={(i - (pips - 1) / 2) * 4.4} cy="12" r="1.6" />
      ))}
      </g>
    </g>
  );
}

// What a tile shows: its resource as a large symbol, or dunes on the desert.
function TileArt({ terrain }) {
  const resource = TERRAINS[terrain]?.resource;
  if (!resource) return <TerrainMotif terrain={terrain} />;
  return (
    <g className="hex-tile-glyph" transform="translate(-17 -17)">
      <ResourceIcon resource={resource} size={34} />
    </g>
  );
}

// The robber is a small dragon. It sleeps curled up on the hex it blocks;
// when it is sent somewhere new it wakes, flies there in an arc with its
// wings beating, lands and settles back to sleep.
const robberSpot = (geo, hexId) => {
  const hex = geo.hexes[hexId];
  // Over the tile's symbol, clear of the number token below it.
  return { x: px(hex.x) + 2, y: px(hex.y) - 10 };
};

// Where the dragon last slept on each island, kept outside the component so
// a redraw of the board (a new layout, a rejoin) still flies it from there.
const lastLair = new Map();
const lairKey = (geo, board) => `${geo.hexes.length}:${(board?.hexes || []).map((hex) => hex.number || 0).join('')}`;

const DRAGON_MS = 2300;
const WAKE = 0.13; // share of the flight spent waking and stretching

// A path for the dragon from a to b: up off its tile, out in a wide curve
// (over the sea when the two tiles are close, so even a short hop is a real
// flight), banking along the way, then a glide in to land.
export const dragonPath = (a, b, steps = 26) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Bend to one side; short hops swing further out.
  const swing = Math.max(70, 150 - dist * 0.25);
  const nx = -dy / dist;
  const ny = dx / dist;
  const side = a.x + b.x > 0 ? -1 : 1; // swing toward the open sea
  const up = 60 + Math.min(70, dist * 0.15);
  const c1 = { x: a.x + dx * 0.2 + nx * swing * side, y: a.y + dy * 0.2 + ny * swing * side - up };
  const c2 = { x: a.x + dx * 0.8 + nx * swing * side * 0.6, y: a.y + dy * 0.8 + ny * swing * side * 0.6 - up * 0.8 };
  const point = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const frames = [
    { offset: 0, transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
    { offset: WAKE * 0.5, transform: `translate(${a.x}px, ${a.y - 4}px) scale(1.08, 0.94)` },
    { offset: WAKE, transform: `translate(${a.x}px, ${a.y - 10}px) scale(1.04)` },
  ];
  for (let i = 1; i <= steps; i += 1) {
    const t = ease(i / steps);
    const p = point(t);
    const ahead = point(Math.min(1, t + 0.04));
    // Face the way it flies (the head is drawn on the left), and bank.
    const heading = ahead.x - p.x;
    const flip = heading > 0.5 ? -1 : 1;
    const bank = Math.max(-22, Math.min(22, (ahead.y - p.y) * 2.2)) * -flip;
    const lift = Math.sin(Math.PI * (i / steps));
    const size = 1 + 0.38 * lift;
    frames.push({
      offset: WAKE + (1 - WAKE) * (i / steps),
      transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${(i === steps ? 0 : bank).toFixed(1)}deg) scale(${(
        flip * size
      ).toFixed(3)}, ${size.toFixed(3)})`,
    });
  }
  frames[frames.length - 1].transform = `translate(${b.x}px, ${b.y}px) scale(1)`;
  return frames;
};

function Dragon({ hexId, geo, board }) {
  const ref = useRef(null);
  const shadowRef = useRef(null);
  const key = lairKey(geo, board);
  const [flying, setFlying] = useState(false);
  const [landing, setLanding] = useState(0);
  const { x, y } = robberSpot(geo, hexId);

  useLayoutEffect(() => {
    const from = lastLair.get(key);
    lastLair.set(key, hexId);
    const node = ref.current;
    if (from === hexId || from === null || from === undefined || !geo.hexes[from] || !node?.animate) return undefined;
    const duration = scaled(DRAGON_MS);
    if (!duration) return undefined;
    const a = robberSpot(geo, from);
    setFlying(true);
    const flight = node.animate(dragonPath(a, { x, y }), { duration, easing: 'linear' });
    // Its shadow keeps to the ground, shrinking and fading as it climbs.
    const shadow = shadowRef.current?.animate?.(
      [
        { transform: `translate(${a.x}px, ${a.y + 4}px) scale(1)`, opacity: 0.5 },
        { transform: `translate(${(a.x + x) / 2}px, ${(a.y + y) / 2 + 4}px) scale(0.45)`, opacity: 0.18, offset: 0.55 },
        { transform: `translate(${x}px, ${y + 4}px) scale(1)`, opacity: 0.5 },
      ],
      { duration, easing: 'ease-in-out' },
    );
    flight.onfinish = () => {
      setFlying(false);
      setLanding((count) => count + 1);
    };
    return () => {
      flight.onfinish = null;
      flight.cancel();
      shadow?.cancel();
      setFlying(false);
    };
  }, [hexId, x, y, geo, key]);

  return (
    <>
    {flying && <ellipse ref={shadowRef} className="dragon-ground-shadow" cx="0" cy="0" rx="22" ry="5" />}
    {landing > 0 && !flying && <circle key={landing} className="dragon-dust" cx={x} cy={y + 4} r="14" />}
    <g
      ref={ref}
      className={`dragon ${flying ? 'dragon--flying' : 'dragon--asleep'}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      aria-label="The robber, a sleeping dragon"
      role="img"
    >
      <g transform="scale(1.3)">
      <ellipse className="dragon-shadow" cx="0" cy="3" rx="19" ry="4.5" />
      <g className="dragon-body">
        <path className="dragon-tail" d="M12 -4c9 1 14-4 11-10" />
        <path className="dragon-tail-tip" d="m21.5 -16 4.5 -2 -1 4.6z" />
        <path className="dragon-wing dragon-wing--back" d="M-1 -15 8 -33l3 9 6-6 1 10 5-3-4 10z" />
        <ellipse className="dragon-skin" cx="2" cy="-8" rx="15" ry="9.5" />
        <ellipse className="dragon-belly" cx="-1" cy="-5" rx="9.5" ry="5" />
        <path className="dragon-spikes" d="M-4 -17l2-4.5 2 4zM2 -17.5l2-4.5 2 4zM8 -16.5l2.2-4 1.6 4.2z" />
        <path className="dragon-wing dragon-wing--front" d="M3 -13 13 -29l2 9 6-4-1 9 5-1-6 7z" />
        <circle className="dragon-skin" cx="-13" cy="-12" r="7.4" />
        <ellipse className="dragon-skin" cx="-19.5" cy="-9.5" rx="5.4" ry="3.8" />
        <path className="dragon-horn" d="M-14 -18.5l-3.4-5 4.8 2.6zM-9 -18.2l.6-5.4 2.6 4.4z" />
        <circle className="dragon-nostril" cx="-23" cy="-10.5" r="0.9" />
        <path className="dragon-eye dragon-eye--shut" d="M-16 -13.4q2 1.8 4 0" />
        <circle className="dragon-eye dragon-eye--open" cx="-14" cy="-13.6" r="1.7" />
        <ellipse className="dragon-skin" cx="-6" cy="0" rx="3.2" ry="2" />
        <ellipse className="dragon-skin" cx="8" cy="0" rx="3.2" ry="2" />
      </g>
      <g className="dragon-zzz" aria-hidden="true">
        <text x="-6" y="-24">z</text>
        <text x="-1" y="-31">z</text>
        <text x="5" y="-38">z</text>
      </g>
      </g>
    </g>
    </>
  );
}

// Pieces placed since the board first drew, with the moment they appeared,
// so only new pieces play their arrival and a redraw never restarts it.
const ARRIVAL_MS = 900;

function useArrivals(roads, buildings) {
  const seen = useRef(null);
  const born = useRef(new Map());
  return useMemo(() => {
    const keys = [
      ...Object.keys(roads).map((id) => `r${id}`),
      ...Object.entries(buildings).map(([id, building]) => `b${id}:${building.type}`),
    ];
    const now = Date.now();
    if (seen.current) keys.forEach((key) => !seen.current.has(key) && born.current.set(key, now));
    seen.current = new Set(keys);
    born.current.forEach((at, key) => now - at > ARRIVAL_MS && born.current.delete(key));
    return (key) => {
      const at = born.current.get(key);
      return at !== undefined && Date.now() - at < ARRIVAL_MS;
    };
  }, [roads, buildings]);
}

// The open spot nearest a point on the board (in hex radii), for the piece
// that follows the cursor: corners for a settlement or city, paths for a
// road. Nothing beyond `reach` counts, so a piece far from any spot floats.
export const nearestSpot = (geo, point, { vertices = [], edges = [] }, reach = 0.55) => {
  let best = null;
  const consider = (kind, id, distance, at) => {
    if (distance <= reach && (!best || distance < best.distance)) best = { kind, id, distance, ...at };
  };
  vertices.forEach((id) => {
    const v = geo.vertices[id];
    if (v) consider('vertex', id, Math.hypot(point.x - v.x, point.y - v.y), { x: v.x, y: v.y, angle: 0 });
  });
  edges.forEach((id) => {
    const [a, b] = geo.edges[id].vertices.map((vertexId) => geo.vertices[vertexId]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    consider('edge', id, Math.hypot(point.x - x, point.y - y), {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  });
  return best;
};

// The piece in your hand, drawn where the cursor is: snapped onto the spot
// it would go, or floating with a red tint when there is nowhere near.
function PieceCursor({ kind, at, colour }) {
  if (!at) return null;
  const lifted = at.snap ? 0 : -6;
  return (
    <g
      className={`piece-cursor ${at.snap ? 'piece-cursor--snapped' : 'piece-cursor--loose'}`}
      transform={`translate(${at.x} ${at.y + lifted})`}
      aria-hidden="true"
    >
      <ellipse className="piece-cursor-shadow" cx="0" cy={6 - lifted} rx={kind === 'road' ? 26 : 13} ry="4" />
      {kind === 'road' ? (
        <g transform={`rotate(${at.angle || 0})`} strokeLinecap="round">
          <line x1="-24" y1="1.2" x2="24" y2="1.2" stroke={colour.edge} strokeWidth="10" />
          <line x1="-24" y1="0" x2="24" y2="0" stroke={colour.fill} strokeWidth="7.4" />
          <line x1="-23" y1="-1.4" x2="23" y2="-1.4" stroke={colour.light} strokeWidth="2" />
        </g>
      ) : (
        <g transform={kind === 'city' ? 'translate(-17 -17.8) scale(1.3)' : 'translate(-13.4 -14.6) scale(1.12)'}>
          {kind === 'city' ? <City3D colour={colour} /> : <Settlement3D colour={colour} />}
        </g>
      )}
    </g>
  );
}

function PieceCursorLayer({ svgRef, snapRef, geo, kind, spots, colour, dragging, onDrop }) {
  const [cursor, setCursor] = useState(null);
  const live = useRef({ spots, dragging, onDrop });
  live.current = { spots, dragging, onDrop };

  useEffect(() => {
    const locate = (event) => {
      const svg = svgRef.current;
      const matrix = svg?.getScreenCTM?.();
      if (!svg || !matrix) return null;
      const rect = svg.getBoundingClientRect();
      // A finger hides what is under it, so a dragged piece sits above it.
      const lift = event.pointerType === 'touch' && live.current.dragging ? 40 : 0;
      const clientY = event.clientY - lift;
      if (event.clientX < rect.left || event.clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = clientY;
      const at = point.matrixTransform(matrix.inverse());
      const snap = nearestSpot(geo, { x: at.x / UNIT, y: at.y / UNIT }, live.current.spots || {});
      return snap ? { x: px(snap.x), y: px(snap.y), angle: snap.angle, snap } : { x: at.x, y: at.y, angle: 0, snap: null };
    };
    const onMove = (event) => {
      const at = locate(event);
      snapRef.current = at?.snap || null;
      setCursor(at);
    };
    const onUp = (event) => {
      if (!live.current.dragging) return;
      const at = locate(event);
      live.current.onDrop(at?.snap || null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      snapRef.current = null;
    };
  }, [svgRef, snapRef, geo]);

  return <PieceCursor kind={kind} at={cursor} colour={colour} />;
}

/**
 * @param {{
 *   board: object, buildings?: object, roads?: object, players?: object[],
 *   highlight?: { vertices?: number[], edges?: number[], hexes?: number[], cities?: number[] },
 *   onVertex?: (id:number)=>void, onEdge?: (id:number)=>void, onHex?: (id:number)=>void,
 *   rolled?: number|null, compact?: boolean, className?: string, label?: string,
 * }} props
 */
function HexBoard({
  board,
  buildings = {},
  roads = {},
  players = [],
  highlight = {},
  onVertex,
  onEdge,
  onHex,
  selected = null,
  myPiece = null,
  rolled = null,
  harvest = null,
  rollCounts = null,
  victims = null,
  onVictim = null,
  placing = null,
  dragging = false,
  onDragEnd = null,
  compact = false,
  className = '',
  label = 'Catan board',
}) {
  const uid = useId().replace(/:/g, '');
  const colourOf = (ownerId) => PIECES[players.find((player) => player.id === ownerId)?.pieceKey] || PIECES.red;
  const vertexSet = new Set(highlight.vertices || []);
  const edgeSet = new Set(highlight.edges || []);
  const hexSet = new Set(highlight.hexes || []);
  const citySet = new Set(highlight.cities || []);
  const mine = PIECES[myPiece] || PIECES.red;
  const isPicked = (kind, id) => selected?.kind === kind && selected.id === id;
  const isNew = useArrivals(roads, buildings);
  const geo = geometryOf(board);

  // Placing a piece: the cursor becomes that piece and snaps to the nearest
  // open spot. A click there (or letting go after dragging it in from the
  // bar) is the first tap; a second click on it builds it. The cursor keeps
  // its own state, so moving the mouse never redraws the island.
  const svgRef = useRef(null);
  const snapRef = useRef(null);
  const placeSpots =
    placing === 'road'
      ? { edges: [...edgeSet] }
      : placing === 'settlement'
        ? { vertices: [...vertexSet] }
        : placing === 'city'
          ? { vertices: [...citySet] }
          : null;
  const place = (snap) => {
    if (!snap) return;
    if (snap.kind === 'edge') onEdge?.(snap.id);
    else onVertex?.(snap.id);
  };

  // While placing, a click anywhere on the island means "here": it goes to
  // the snapped spot, never to whatever element happens to be under it.
  const onPlaceClick = (event) => {
    if (!placing || dragging) return;
    event.stopPropagation();
    event.preventDefault();
    // A tap on a touch screen arrives without a move first: find the spot
    // from where it landed.
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const at = point.matrixTransform(matrix.inverse());
    place(nearestSpot(geo, { x: at.x / UNIT, y: at.y / UNIT }, placeSpots || {}) || snapRef.current);
  };

  // The sea is a flat-topped hexagon around the island, with room for the
  // harbours on every side.
  const seaX = geo.maxX + 1.2;
  const seaY = geo.maxY + 0.76;
  const width = px(seaX + 0.05);
  const height = px(seaY + 0.09);

  return (
    <svg
      ref={svgRef}
      className={`hex-board ${compact ? 'hex-board--compact' : ''} ${highlight.browse ? 'hex-board--browse' : ''} ${selected ? 'hex-board--picking' : ''} ${
        placing ? 'hex-board--placing' : ''
      } ${className}`.trim()}
      onClickCapture={placing ? onPlaceClick : undefined}
      viewBox={`${-width} ${-height} ${width * 2} ${height * 2}`}
      style={{ '--mine': mine.fill, '--mine-edge': mine.edge }}
      role="img"
      aria-label={label}
    >
      <defs>
        <radialGradient id={`sea-${uid}`} cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="var(--sea)" />
          <stop offset="100%" stopColor="var(--sea-deep)" />
        </radialGradient>
        {/* A soft light from above over every flat tile */}
        <linearGradient id={`shade-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      <polygon
        className="hex-board-sea"
        points={[0, 1, 2, 3, 4, 5]
          .map((i) => {
            const angle = (Math.PI / 180) * (60 * i);
            return `${px(Math.cos(angle) * seaX)},${px((Math.sin(angle) / Math.sin(Math.PI / 3)) * seaY)}`;
          })
          .join(' ')}
        fill={`url(#sea-${uid})`}
      />
      {/* The island's ground: every tile at full size, edged out by half a
          gap, so the coast sits one gap from the tiles all the way round.
          A lighter, wider pass underneath is the surf. */}
      <g className="hex-board-surf" style={{ strokeWidth: px(GAP) + 9 }}>
        {board.hexes.map((tile) => (
          <polygon key={tile.id} points={hexPoints(geo, geo.hexes[tile.id])} />
        ))}
      </g>
      <g className="hex-board-ground" style={{ strokeWidth: px(GAP) }}>
        {board.hexes.map((tile) => (
          <polygon key={tile.id} points={hexPoints(geo, geo.hexes[tile.id])} />
        ))}
      </g>

      {/* Harbours: a token out in the water, joined to the two corners of
          its stretch of coast by wooden piers */}
      {board.harbors.map((harbor) => {
        const [a, b] = harbor.vertices.map((id) => geo.vertices[id]);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const piers = [a, b].map((v) => {
          // From just inside the corner, on the coast, to the token's rim.
          const start = { x: v.x + (mid.x - v.x) * 0.22, y: v.y + (mid.y - v.y) * 0.22 };
          const dx = start.x - harbor.x;
          const dy = start.y - harbor.y;
          const length = Math.hypot(dx, dy) || 1;
          const rim = HARBOR_R / UNIT - 0.02;
          return { x1: px(start.x), y1: px(start.y), x2: px(harbor.x + (dx / length) * rim), y2: px(harbor.y + (dy / length) * rim) };
        });
        return (
          <g key={harbor.edge} className={`harbor harbor--${harbor.type}`}>
            <title>{harbor.type === 'any' ? 'Harbour: any 3 identical resources for 1' : `Harbour: 2 ${RESOURCE_LABELS[harbor.type].toLowerCase()} for 1`}</title>
            {piers.map((pier, index) => (
              <g key={index} className="harbor-pier">
                <line {...pier} className="harbor-pier-base" />
                <line {...pier} className="harbor-pier-deck" />
              </g>
            ))}
            <circle className="harbor-token" cx={px(harbor.x)} cy={px(harbor.y)} r={HARBOR_R} />
            {harbor.type === 'any' ? (
              <text x={px(harbor.x)} y={px(harbor.y) + 1} textAnchor="middle" dominantBaseline="middle" className="harbor-rate harbor-rate--any">
                3:1
              </text>
            ) : (
              <>
                <g transform={`translate(${px(harbor.x) - 7} ${px(harbor.y) - 13})`} className={`harbor-icon res-${harbor.type}`}>
                  <ResourceIcon resource={harbor.type} size={14} />
                </g>
                <text className="harbor-rate" x={px(harbor.x)} y={px(harbor.y) + 9} textAnchor="middle" dominantBaseline="middle">
                  2:1
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Terrain */}
      {board.hexes.map((tile) => {
        const hex = geo.hexes[tile.id];
        const producing = rolled && tile.number === rolled && board.robber !== tile.id;
        const target = hexSet.has(tile.id);
        const picked = target && isPicked('robber', tile.id);
        return (
          <g
            key={tile.id}
            className={`hex-tile hex-tile--${tile.terrain} ${producing ? 'hex-tile--producing' : ''} ${target ? 'hex-tile--target' : ''} ${picked ? 'hex-tile--picked' : ''}`}
            data-anchor={`hex-${tile.id}`}
            onClick={target && onHex ? () => onHex(tile.id) : undefined}
            role={target ? 'button' : undefined}
            tabIndex={target ? 0 : undefined}
            aria-label={target ? `Move the robber to ${TERRAINS[tile.terrain].label} ${tile.number || ''}` : undefined}
            onKeyDown={target && onHex ? onPress(() => onHex(tile.id)) : undefined}
          >
            <polygon points={hexPoints(geo, hex, TILE_INSET)} className="hex-tile-face" style={{ fill: `var(--terrain-${tile.terrain})` }} />
            <polygon points={hexPoints(geo, hex, TILE_INSET)} fill={`url(#shade-${uid})`} className="hex-tile-shade" />
            <polygon points={hexPoints(geo, hex, TILE_INSET + 0.035)} className="hex-tile-bevel" />
            <g transform={`translate(${px(hex.x)} ${px(hex.y) + (tile.number ? -25 : 0)})`}>
              <TileArt terrain={tile.terrain} />
            </g>
            {tile.number && (
              <NumberToken
                number={tile.number}
                x={px(hex.x)}
                y={px(hex.y) + 13}
                hot={tile.number === 6 || tile.number === 8}
                blocked={board.robber === tile.id}
                pop={harvest?.hexes.includes(tile.id) ? harvest.key : null}
                rolled={rollCounts ? rollCounts[tile.number] || 0 : null}
              />
            )}
          </g>
        );
      })}

      {/* The roll that just landed: paying tiles glow and send up sparks, a
          tile under the dragon greys out with a cross */}
      {harvest &&
        harvest.hexes.map((hexId) => {
          const hex = geo.hexes[hexId];
          if (!hex) return null;
          return (
            <g key={`harvest-${harvest.key}-${hexId}`} className="harvest" aria-hidden="true">
              <polygon points={hexPoints(geo, hex, TILE_INSET)} className="harvest-glow" />
              <polygon points={hexPoints(geo, hex, TILE_INSET)} className="harvest-ring" />
              {[-22, -6, 10, 24].map((dx, i) => (
                <circle key={dx} className="harvest-mote" cx={px(hex.x) + dx} cy={px(hex.y) + 10 - (i % 2) * 14} r={2.2 + (i % 2)} style={{ animationDelay: `${0.15 + i * 0.12}s` }} />
              ))}
            </g>
          );
        })}
      {harvest &&
        harvest.blocked.map((hexId) => {
          const hex = geo.hexes[hexId];
          if (!hex) return null;
          return (
            <g key={`blocked-${harvest.key}-${hexId}`} className="harvest-blocked" aria-hidden="true">
              <polygon points={hexPoints(geo, hex, TILE_INSET)} />
              <path d={`M${px(hex.x) - 12} ${px(hex.y) + 1}l24 24m0 -24l-24 24`} transform="translate(0 0)" />
            </g>
          );
        })}

      {/* Roads */}
      {Object.entries(roads).map(([edgeId, owner]) => {
        const [a, b] = geo.edges[edgeId].vertices.map((id) => geo.vertices[id]);
        const colour = colourOf(owner);
        const shrink = 0.18;
        const x1 = a.x + (b.x - a.x) * shrink;
        const y1 = a.y + (b.y - a.y) * shrink;
        const x2 = b.x + (a.x - b.x) * shrink;
        const y2 = b.y + (a.y - b.y) * shrink;
        return (
          <g key={`road-${edgeId}`} className={`road ${isNew(`r${edgeId}`) ? 'road--new' : ''}`}>
            {/* A wooden beam: its shadow and dark underside, the painted top, a
                line of light along the upper edge */}
            <line x1={px(x1)} y1={px(y1) + 2.5} x2={px(x2)} y2={px(y2) + 2.5} className="road-shadow" strokeWidth="10" strokeLinecap="round" pathLength="1" />
            <line x1={px(x1)} y1={px(y1) + 1.2} x2={px(x2)} y2={px(y2) + 1.2} stroke={colour.edge} strokeWidth="10" strokeLinecap="round" pathLength="1" />
            <line x1={px(x1)} y1={px(y1)} x2={px(x2)} y2={px(y2)} stroke={colour.fill} strokeWidth="7.4" strokeLinecap="round" pathLength="1" />
            <line x1={px(x1)} y1={px(y1) - 1.4} x2={px(x2)} y2={px(y2) - 1.4} stroke={colour.light} strokeWidth="2" strokeLinecap="round" pathLength="1" className="road-light" />
          </g>
        );
      })}

      {/* Open paths for a road */}
      {[...edgeSet].map((edgeId) => {
        const [a, b] = geo.edges[edgeId].vertices.map((id) => geo.vertices[id]);
        const picked = isPicked('road', edgeId);
        return (
          <React.Fragment key={`edge-${edgeId}`}>
            {picked && (
              <g className="ghost ghost--road" aria-hidden="true">
                <line x1={px(a.x + (b.x - a.x) * 0.18)} y1={px(a.y + (b.y - a.y) * 0.18) + 1.2} x2={px(b.x + (a.x - b.x) * 0.18)} y2={px(b.y + (a.y - b.y) * 0.18) + 1.2} stroke={mine.edge} strokeWidth="10" strokeLinecap="round" />
                <line x1={px(a.x + (b.x - a.x) * 0.18)} y1={px(a.y + (b.y - a.y) * 0.18)} x2={px(b.x + (a.x - b.x) * 0.18)} y2={px(b.y + (a.y - b.y) * 0.18)} stroke={mine.fill} strokeWidth="7.5" strokeLinecap="round" />
              </g>
            )}
          <line
            className="spot-edge-under"
            x1={px(a.x + (b.x - a.x) * 0.26)}
            y1={px(a.y + (b.y - a.y) * 0.26)}
            x2={px(b.x + (a.x - b.x) * 0.26)}
            y2={px(b.y + (a.y - b.y) * 0.26)}
            aria-hidden="true"
          />
          <line
            className={`spot spot--edge ${picked ? 'spot--picked' : ''}`}
            x1={px(a.x + (b.x - a.x) * 0.26)}
            y1={px(a.y + (b.y - a.y) * 0.26)}
            x2={px(b.x + (a.x - b.x) * 0.26)}
            y2={px(b.y + (a.y - b.y) * 0.26)}
            onClick={onEdge ? () => onEdge(edgeId) : undefined}
            role="button"
            tabIndex={0}
            aria-label={`${picked ? 'Confirm the road' : 'Build a road'} by ${placeOf(board, geo.edges[edgeId].hexes)}`}
            aria-pressed={picked}
            onKeyDown={onPress(() => onEdge?.(edgeId))}
          />
          </React.Fragment>
        );
      })}


      {/* Settlements and cities */}
      {Object.entries(buildings).map(([vertexId, building]) => {
        const v = geo.vertices[vertexId];
        const colour = colourOf(building.owner);
        const city = building.type === 'city';
        const upgradable = citySet.has(Number(vertexId));
        const picked = upgradable && isPicked('city', Number(vertexId));
        const arriving = isNew(`b${vertexId}:${building.type}`);
        return (
          <g
            key={`b-${vertexId}`}
            className={`building building--${building.type} ${upgradable ? 'building--upgradable' : ''} ${picked ? 'building--picked' : ''} ${arriving ? `building--new-${building.type}` : ''}`}
            transform={`translate(${px(v.x) - (city ? 17 : 13.4)} ${px(v.y) - (city ? 17.8 : 14.6)}) scale(${city ? 1.3 : 1.12})`}
            onClick={upgradable && onVertex ? () => onVertex(Number(vertexId)) : undefined}
            role={upgradable ? 'button' : undefined}
            tabIndex={upgradable ? 0 : undefined}
            aria-label={upgradable ? `Upgrade to a city by ${placeOf(board, v.hexes)}` : undefined}
            onKeyDown={upgradable && onVertex ? onPress(() => onVertex(Number(vertexId))) : undefined}
          >
            {arriving && <ellipse className="building-dust" cx="12" cy="22" rx="10" ry="3" />}
            <g className="building-body">
              {city || picked ? <City3D colour={colour} /> : <Settlement3D colour={colour} />}
              {upgradable && <path d={SETTLEMENT_PATH} className="building-upgrade-ring" />}
              {arriving && city && <path d={CITY_PATH} className="building-shine" />}
            </g>
          </g>
        );
      })}

      {/* Open intersections for a settlement */}
      {[...vertexSet].map((vertexId) => {
        const v = geo.vertices[vertexId];
        const picked = isPicked('settlement', vertexId);
        if (picked) {
          return (
            <g
              key={`v-${vertexId}`}
              className="spot spot--ghost"
              transform={`translate(${px(v.x) - 12} ${px(v.y) - 13})`}
              onClick={onVertex ? () => onVertex(vertexId) : undefined}
              role="button"
              tabIndex={0}
              aria-pressed="true"
              aria-label={`Confirm the settlement by ${placeOf(board, v.hexes)}`}
              onKeyDown={onPress(() => onVertex?.(vertexId))}
            >
              <circle cx="12" cy="13" r="19" className="spot-halo" />
              <Settlement3D colour={mine} />
            </g>
          );
        }
        return (
          <circle
            key={`v-${vertexId}`}
            className="spot spot--vertex"
            cx={px(v.x)}
            cy={px(v.y)}
            r="7"
            onClick={onVertex ? () => onVertex(vertexId) : undefined}
            role="button"
            tabIndex={0}
            aria-label={`Build a settlement by ${placeOf(board, v.hexes)}`}
            onKeyDown={onPress(() => onVertex?.(vertexId))}
          />
        );
      })}

      {/* Who can be robbed: a badge on each of their buildings by the dragon */}
      {(victims || []).map(({ vertexId, playerId, cards }) => {
        const v = geo.vertices[vertexId];
        const colour = colourOf(playerId);
        const name = players.find((player) => player.id === playerId)?.name || 'this player';
        return (
          <g
            key={`victim-${vertexId}`}
            className="victim-badge"
            transform={`translate(${px(v.x)} ${px(v.y) - 30})`}
            onClick={onVictim ? () => onVictim(playerId) : undefined}
            role="button"
            tabIndex={0}
            aria-label={`Rob ${name}, ${cards} cards`}
            onKeyDown={onPress(() => onVictim?.(playerId))}
          >
            <g className="victim-badge-pin">
              <circle r="15" fill={colour.fill} stroke="#ffffff" strokeWidth="2.5" />
              <text y="1" textAnchor="middle" dominantBaseline="middle">
                {cards}
              </text>
              <path d="M-5 13 0 20 5 13" fill="#ffffff" />
            </g>
          </g>
        );
      })}

      {/* The robber flies over everything, then sleeps on its tile */}
      {board.robber !== null && board.robber !== undefined && <Dragon hexId={board.robber} geo={geo} board={board} />}

      {selected && <ConfirmChip selected={selected} geo={geo} />}

      {placing && (
        <PieceCursorLayer
          svgRef={svgRef}
          snapRef={snapRef}
          geo={geo}
          kind={placing}
          spots={placeSpots}
          colour={mine}
          dragging={dragging}
          onDrop={(snap) => {
            place(snap);
            onDragEnd?.(Boolean(snap));
          }}
        />
      )}
    </svg>
  );
}

// Where a first tap landed, and the words for the second.
const chipAt = (selected, geo) => {
  const { kind, id } = selected;
  if (kind === 'road') {
    const [a, b] = geo.edges[id]?.vertices.map((vertexId) => geo.vertices[vertexId]) || [];
    return a && { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: 'Tap again to build the road' };
  }
  if (kind === 'settlement' || kind === 'city') {
    const v = geo.vertices[id];
    return v && { x: v.x, y: v.y, text: `Tap again to build the ${kind}` };
  }
  if (kind === 'robber') {
    const hex = geo.hexes[id];
    return hex && { x: hex.x, y: hex.y - 0.35, text: 'Tap again to send the robber' };
  }
  return null;
};

// The small label that asks for the confirming tap, kept inside the board.
function ConfirmChip({ selected, geo }) {
  const at = chipAt(selected, geo);
  if (!at) return null;
  const width = at.text.length * 6.1 + 22;
  const edge = px(geo.maxX + 1.15);
  const x = Math.max(-edge + width / 2, Math.min(edge - width / 2, px(at.x)));
  const above = px(at.y) - 34 > -px(geo.maxY + 0.6);
  const y = above ? px(at.y) - 30 : px(at.y) + 30;
  return (
    <g className="confirm-chip" transform={`translate(${x} ${y})`} aria-hidden="true">
      <rect x={-width / 2} y="-12" width={width} height="24" rx="12" />
      <text textAnchor="middle" dominantBaseline="central" y="0.5">
        {at.text}
      </text>
    </g>
  );
}

// Redrawn only when its own props change, not on every tick of the game screen.
export default memo(HexBoard);
