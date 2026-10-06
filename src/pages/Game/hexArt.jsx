import React, { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GEOMETRY, PIPS, RESOURCE_LABELS, TERRAINS } from './catanBoard';
import { CITY_PATH, PIECES, SETTLEMENT_PATH } from './pieces.jsx';
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

const hexPoints = (hex, inset = 0) =>
  hex.vertices
    .map((vertexId) => {
      const v = GEOMETRY.vertices[vertexId];
      const x = hex.x + (v.x - hex.x) * (1 - inset);
      const y = hex.y + (v.y - hex.y) * (1 - inset);
      return `${px(x)},${px(y)}`;
    })
    .join(' ');

// Island outline for the sand rim: every coastal path, pushed slightly out.
const coastPoints = (() => {
  const points = [];
  GEOMETRY.coast.forEach(({ edge }) => {
    GEOMETRY.edges[edge].vertices.forEach((vertexId) => {
      if (!points.includes(vertexId)) points.push(vertexId);
    });
  });
  return points
    .map((id) => GEOMETRY.vertices[id])
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
    .map((v) => `${px(v.x * 1.07)},${px(v.y * 1.07)}`)
    .join(' ');
})();

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

function NumberToken({ number, x, y, hot, blocked = false }) {
  const pips = PIPS[number] || 0;
  return (
    <g className={`number-token ${hot ? 'number-token--hot' : ''} ${blocked ? 'number-token--blocked' : ''}`} transform={`translate(${x} ${y})`}>
      <circle r="19.5" cy="2" className="number-token-shadow" />
      <circle r="19.5" className="number-token-face" />
      <text y="-1" textAnchor="middle" dominantBaseline="middle">
        {number}
      </text>
      {Array.from({ length: pips }, (_, i) => (
        <circle key={i} className="number-token-pip" cx={(i - (pips - 1) / 2) * 4.4} cy="12" r="1.6" />
      ))}
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
const robberSpot = (hexId) => {
  const hex = GEOMETRY.hexes[hexId];
  // Over the tile's symbol, clear of the number token below it.
  return { x: px(hex.x) + 2, y: px(hex.y) - 10 };
};

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Dragon({ hexId }) {
  const ref = useRef(null);
  const last = useRef(hexId);
  const [flying, setFlying] = useState(false);
  const { x, y } = robberSpot(hexId);

  useLayoutEffect(() => {
    const from = last.current;
    last.current = hexId;
    const node = ref.current;
    if (from === hexId || from === null || from === undefined || !node?.animate || reducedMotion()) return undefined;
    const a = robberSpot(from);
    const lift = Math.min(90, 40 + Math.hypot(x - a.x, y - a.y) * 0.25);
    const midX = (a.x + x) / 2;
    const midY = Math.min(a.y, y) - lift;
    setFlying(true);
    const flight = node.animate(
      [
        { transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
        { transform: `translate(${a.x}px, ${a.y - 18}px) scale(1.12)`, offset: 0.15 },
        { transform: `translate(${midX}px, ${midY}px) scale(1.22)`, offset: 0.55 },
        { transform: `translate(${x}px, ${y - 10}px) scale(1.08)`, offset: 0.88 },
        { transform: `translate(${x}px, ${y}px) scale(1)` },
      ],
      { duration: 1050, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' },
    );
    flight.onfinish = () => setFlying(false);
    return () => {
      flight.onfinish = null;
      flight.cancel();
      setFlying(false);
    };
  }, [hexId, x, y]);

  return (
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
  const width = px(5.55);
  const height = px(4.85);

  return (
    <svg
      className={`hex-board ${compact ? 'hex-board--compact' : ''} ${highlight.browse ? 'hex-board--browse' : ''} ${selected ? 'hex-board--picking' : ''} ${className}`.trim()}
      viewBox={`${-width} ${-height} ${width * 2} ${height * 2}`}
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
            return `${px(Math.cos(angle) * 5.5)},${px(Math.sin(angle) * 5.5)}`;
          })
          .join(' ')}
        fill={`url(#sea-${uid})`}
      />
      <polygon className="hex-board-sand" points={coastPoints} />

      {/* Harbours */}
      {board.harbors.map((harbor) => {
        const [a, b] = harbor.vertices.map((id) => GEOMETRY.vertices[id]);
        return (
          <g key={harbor.edge} className={`harbor harbor--${harbor.type}`}>
            <title>{harbor.type === 'any' ? 'Harbour: any 3 identical resources for 1' : `Harbour: 2 ${RESOURCE_LABELS[harbor.type].toLowerCase()} for 1`}</title>
            <path className="harbor-pier" d={`M${px(a.x)} ${px(a.y)}L${px(harbor.x)} ${px(harbor.y)}L${px(b.x)} ${px(b.y)}`} />
            <circle cx={px(harbor.x)} cy={px(harbor.y)} r="16" />
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
        const hex = GEOMETRY.hexes[tile.id];
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
            <polygon points={hexPoints(hex, 0.03)} className="hex-tile-face" style={{ fill: `var(--terrain-${tile.terrain})` }} />
            <polygon points={hexPoints(hex, 0.03)} fill={`url(#shade-${uid})`} className="hex-tile-shade" />
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
              />
            )}
          </g>
        );
      })}

      {/* Roads */}
      {Object.entries(roads).map(([edgeId, owner]) => {
        const [a, b] = GEOMETRY.edges[edgeId].vertices.map((id) => GEOMETRY.vertices[id]);
        const colour = colourOf(owner);
        const shrink = 0.18;
        const x1 = a.x + (b.x - a.x) * shrink;
        const y1 = a.y + (b.y - a.y) * shrink;
        const x2 = b.x + (a.x - b.x) * shrink;
        const y2 = b.y + (a.y - b.y) * shrink;
        return (
          <g key={`road-${edgeId}`} className={`road ${isNew(`r${edgeId}`) ? 'road--new' : ''}`}>
            <line x1={px(x1)} y1={px(y1)} x2={px(x2)} y2={px(y2)} stroke={colour.edge} strokeWidth="11" strokeLinecap="round" pathLength="1" />
            <line x1={px(x1)} y1={px(y1)} x2={px(x2)} y2={px(y2)} stroke={colour.fill} strokeWidth="7.5" strokeLinecap="round" pathLength="1" />
          </g>
        );
      })}

      {/* Open paths for a road */}
      {[...edgeSet].map((edgeId) => {
        const [a, b] = GEOMETRY.edges[edgeId].vertices.map((id) => GEOMETRY.vertices[id]);
        const picked = isPicked('road', edgeId);
        return (
          <React.Fragment key={`edge-${edgeId}`}>
            {picked && (
              <g className="ghost ghost--road" aria-hidden="true">
                <line x1={px(a.x + (b.x - a.x) * 0.18)} y1={px(a.y + (b.y - a.y) * 0.18)} x2={px(b.x + (a.x - b.x) * 0.18)} y2={px(b.y + (a.y - b.y) * 0.18)} stroke={mine.edge} strokeWidth="11" strokeLinecap="round" />
                <line x1={px(a.x + (b.x - a.x) * 0.18)} y1={px(a.y + (b.y - a.y) * 0.18)} x2={px(b.x + (a.x - b.x) * 0.18)} y2={px(b.y + (a.y - b.y) * 0.18)} stroke={mine.fill} strokeWidth="7.5" strokeLinecap="round" />
              </g>
            )}
          <line
            className={`spot spot--edge ${picked ? 'spot--picked' : ''}`}
            x1={px(a.x + (b.x - a.x) * 0.2)}
            y1={px(a.y + (b.y - a.y) * 0.2)}
            x2={px(b.x + (a.x - b.x) * 0.2)}
            y2={px(b.y + (a.y - b.y) * 0.2)}
            onClick={onEdge ? () => onEdge(edgeId) : undefined}
            role="button"
            tabIndex={0}
            aria-label={`${picked ? 'Confirm the road' : 'Build a road'} by ${placeOf(board, GEOMETRY.edges[edgeId].hexes)}`}
            aria-pressed={picked}
            onKeyDown={onPress(() => onEdge?.(edgeId))}
          />
          </React.Fragment>
        );
      })}

      {/* Robber */}
      {board.robber !== null && board.robber !== undefined && <Dragon hexId={board.robber} />}

      {/* Settlements and cities */}
      {Object.entries(buildings).map(([vertexId, building]) => {
        const v = GEOMETRY.vertices[vertexId];
        const colour = colourOf(building.owner);
        const city = building.type === 'city';
        const upgradable = citySet.has(Number(vertexId));
        const picked = upgradable && isPicked('city', Number(vertexId));
        const arriving = isNew(`b${vertexId}:${building.type}`);
        return (
          <g
            key={`b-${vertexId}`}
            className={`building building--${building.type} ${upgradable ? 'building--upgradable' : ''} ${picked ? 'building--picked' : ''} ${arriving ? `building--new-${building.type}` : ''}`}
            transform={`translate(${px(v.x) - (city ? 14 : 12)} ${px(v.y) - (city ? 15 : 13)}) scale(${city ? 1.15 : 1})`}
            onClick={upgradable && onVertex ? () => onVertex(Number(vertexId)) : undefined}
            role={upgradable ? 'button' : undefined}
            tabIndex={upgradable ? 0 : undefined}
            aria-label={upgradable ? `Upgrade to a city by ${placeOf(board, v.hexes)}` : undefined}
            onKeyDown={upgradable && onVertex ? onPress(() => onVertex(Number(vertexId))) : undefined}
          >
            {arriving && <ellipse className="building-dust" cx="12" cy="22" rx="10" ry="3" />}
            <g className="building-body">
              <path d={city ? CITY_PATH : SETTLEMENT_PATH} className="building-shadow" transform="translate(1 2)" />
              <path d={picked ? CITY_PATH : city ? CITY_PATH : SETTLEMENT_PATH} fill={colour.fill} stroke={colour.edge} strokeWidth="1.6" strokeLinejoin="round" />
              {arriving && city && <path d={CITY_PATH} className="building-shine" />}
            </g>
          </g>
        );
      })}

      {/* Open intersections for a settlement */}
      {[...vertexSet].map((vertexId) => {
        const v = GEOMETRY.vertices[vertexId];
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
              <path d={SETTLEMENT_PATH} fill={mine.fill} stroke={mine.edge} strokeWidth="1.6" strokeLinejoin="round" />
            </g>
          );
        }
        return (
          <circle
            key={`v-${vertexId}`}
            className="spot spot--vertex"
            cx={px(v.x)}
            cy={px(v.y)}
            r="9"
            onClick={onVertex ? () => onVertex(vertexId) : undefined}
            role="button"
            tabIndex={0}
            aria-label={`Build a settlement by ${placeOf(board, v.hexes)}`}
            onKeyDown={onPress(() => onVertex?.(vertexId))}
          />
        );
      })}

      {selected && <ConfirmChip selected={selected} board={board} />}
    </svg>
  );
}

// Where a first tap landed, and the words for the second.
const chipAt = (selected) => {
  const { kind, id } = selected;
  if (kind === 'road') {
    const [a, b] = GEOMETRY.edges[id]?.vertices.map((vertexId) => GEOMETRY.vertices[vertexId]) || [];
    return a && { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: 'Tap again to build the road' };
  }
  if (kind === 'settlement' || kind === 'city') {
    const v = GEOMETRY.vertices[id];
    return v && { x: v.x, y: v.y, text: `Tap again to build the ${kind}` };
  }
  if (kind === 'robber') {
    const hex = GEOMETRY.hexes[id];
    return hex && { x: hex.x, y: hex.y - 0.35, text: 'Tap again to send the robber' };
  }
  return null;
};

// The small label that asks for the confirming tap, kept inside the board.
function ConfirmChip({ selected }) {
  const at = chipAt(selected);
  if (!at) return null;
  const width = at.text.length * 6.1 + 22;
  const x = Math.max(-330 + width / 2, Math.min(330 - width / 2, px(at.x)));
  const above = px(at.y) - 34 > -280;
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
