// The island of Catan: hex geometry, the beginners' map from the rulebook
// and the variable (random) map, for the classic island and the larger one
// of the 5-6 player extension.
//
// The classic 19 land hexes sit in rows of 3-4-5-4-3, pointy side up; the
// extension's 30 sit in rows of 3-4-5-6-5-4-3. Everything a rule needs
// (which hexes touch an intersection, which intersections are neighbours,
// which paths meet at an intersection) is derived once from the hex
// centres, so every module shares the same ids for a board:
//   hexes     row by row, left to right
//   vertices  top to bottom, left to right (the intersections)
//   edges     the paths, each joining two vertices
// geometryOf(board) gives the geometry a board was laid out on.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const RESOURCES = ['brick', 'lumber', 'ore', 'grain', 'wool'];

export const TERRAINS = {
  hills: { label: 'Hills', resource: 'brick' },
  forest: { label: 'Forest', resource: 'lumber' },
  mountains: { label: 'Mountains', resource: 'ore' },
  fields: { label: 'Fields', resource: 'grain' },
  pasture: { label: 'Pasture', resource: 'wool' },
  desert: { label: 'Desert', resource: null },
};

export const RESOURCE_LABELS = {
  brick: 'Brick',
  lumber: 'Lumber',
  ore: 'Ore',
  grain: 'Grain',
  wool: 'Wool',
};

// Pips under each number token: how many of the 36 dice outcomes roll it.
export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

const SQRT3 = Math.sqrt(3);

export const LAYOUTS = {
  standard: [3, 4, 5, 4, 3],
  large: [3, 4, 5, 6, 5, 4, 3],
};

const round = (value) => Math.round(value * 1000) / 1000;

// Axial coordinates, row by row, every row centred under the same middle.
const axialFor = (rows) => {
  const middle = (rows.length - 1) / 2;
  const widest = Math.max(...rows);
  const centre = widest % 2 === 0 ? 0.5 : 0;
  const cells = [];
  rows.forEach((length, row) => {
    const r = row - middle;
    const start = Math.round(centre - (length - 1) / 2 - r / 2);
    for (let i = 0; i < length; i += 1) cells.push({ q: start + i, r, row });
  });
  return cells;
};

const buildGeometry = (rows) => {
  const cells = axialFor(rows);
  const raw = cells.map(({ q, r }) => SQRT3 * (q + r / 2));
  const shift = (Math.min(...raw) + Math.max(...raw)) / 2;
  const hexes = cells.map(({ q, r, row }, id) => ({
    id,
    q,
    r,
    row,
    x: round(SQRT3 * (q + r / 2) - shift),
    y: round(1.5 * r),
  }));

  // Corners of every hex, pointy top, clockwise from the top.
  const cornerList = [];
  hexes.forEach((hex) => {
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 180) * (60 * i - 90);
      cornerList.push({ hex: hex.id, i, x: round(hex.x + Math.cos(angle)), y: round(hex.y + Math.sin(angle)) });
    }
  });

  const keyOf = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const unique = new Map();
  cornerList.forEach(({ x, y }) => {
    const key = keyOf(x, y);
    if (!unique.has(key)) unique.set(key, { x, y });
  });

  const vertices = [...unique.entries()]
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
    .map(([key, point], id) => ({ id, key, x: point.x, y: point.y, hexes: [], neighbours: [], edges: [] }));
  const vertexByKey = new Map(vertices.map((vertex) => [vertex.key, vertex]));

  hexes.forEach((hex) => {
    hex.vertices = [];
  });
  cornerList.forEach(({ hex, x, y }) => {
    const vertex = vertexByKey.get(keyOf(x, y));
    hexes[hex].vertices.push(vertex.id);
    vertex.hexes.push(hex);
  });

  const edgeMap = new Map();
  hexes.forEach((hex) => {
    hex.edges = [];
    for (let i = 0; i < 6; i += 1) {
      const a = hex.vertices[i];
      const b = hex.vertices[(i + 1) % 6];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { key, vertices: [Math.min(a, b), Math.max(a, b)], hexes: [] });
      edgeMap.get(key).hexes.push(hex.id);
    }
  });

  const edges = [...edgeMap.values()]
    .sort((a, b) => a.vertices[0] - b.vertices[0] || a.vertices[1] - b.vertices[1])
    .map((edge, id) => ({ id, ...edge }));

  edges.forEach((edge) => {
    const [a, b] = edge.vertices;
    vertices[a].neighbours.push(b);
    vertices[b].neighbours.push(a);
    vertices[a].edges.push(edge.id);
    vertices[b].edges.push(edge.id);
  });

  hexes.forEach((hex) => {
    hex.edges = hex.vertices.map((a, i) => {
      const b = hex.vertices[(i + 1) % 6];
      return edges.find((edge) => edge.vertices.includes(a) && edge.vertices.includes(b)).id;
    });
    hex.neighbours = hexes
      .filter((other) => {
        const dq = other.q - hex.q;
        const dr = other.r - hex.r;
        return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]].some(([q, r]) => q === dq && r === dr);
      })
      .map((other) => other.id);
  });

  // Coast: paths that border only one land hex, ordered clockwise around the
  // island starting from the far left.
  const coast = edges
    .filter((edge) => edge.hexes.length === 1)
    .map((edge) => {
      const a = vertices[edge.vertices[0]];
      const b = vertices[edge.vertices[1]];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      return { edge: edge.id, angle: Math.atan2(my, mx), mx, my };
    })
    .sort((a, b) => a.angle - b.angle);

  const maxX = Math.max(...vertices.map((vertex) => Math.abs(vertex.x)));
  const maxY = Math.max(...vertices.map((vertex) => Math.abs(vertex.y)));
  return { hexes, vertices, edges, coast, maxX, maxY };
};

const STANDARD = { layout: 'standard', ...buildGeometry(LAYOUTS.standard) };
const LARGE = { layout: 'large', ...buildGeometry(LAYOUTS.large) };

// The classic island, which every board used before the extension.
export const GEOMETRY = STANDARD;
export const GEOMETRIES = { standard: STANDARD, large: LARGE };
export const HEX_COUNT = GEOMETRY.hexes.length;
export const VERTEX_COUNT = GEOMETRY.vertices.length;
export const EDGE_COUNT = GEOMETRY.edges.length;

// The geometry a board was laid out on.
export const geometryOf = (board) =>
  board?.layout === 'large' || board?.hexes?.length === LARGE.hexes.length ? LARGE : STANDARD;

// The board size for a number of players: the extension island from 5.
export const layoutFor = (playerCount) => (playerCount >= 5 ? 'large' : 'standard');

// Harbours spaced around the coast, never sharing an intersection: the
// rulebook's nine on the classic island (30 coastal paths) and eleven
// evenly spaced on the extension.
const HARBOR_SLOTS = {
  standard: [1, 4, 8, 11, 14, 18, 21, 24, 28],
  large: Array.from({ length: 11 }, (_, i) => Math.floor(((i + 0.25) * LARGE.coast.length) / 11)),
};

const harborsOf = (geometry) =>
  HARBOR_SLOTS[geometry.layout].map((slot) => {
    const coast = geometry.coast[slot];
    const edge = geometry.edges[coast.edge];
    const length = Math.hypot(coast.mx, coast.my) || 1;
    return {
      edge: edge.id,
      vertices: edge.vertices,
      // A spot out at sea for drawing the harbour marker.
      x: round(coast.mx + (coast.mx / length) * 0.62),
      y: round(coast.my + (coast.my / length) * 0.62),
    };
  });

export const HARBORS = harborsOf(STANDARD);
const HARBORS_LARGE = harborsOf(LARGE);

// ------------------------------------------------------------- beginners

// Illustration A of the rulebook, row by row.
export const BEGINNER_HEXES = [
  ['mountains', 10], ['pasture', 2], ['forest', 9],
  ['fields', 12], ['hills', 6], ['pasture', 4], ['hills', 10],
  ['fields', 9], ['forest', 11], ['desert', null], ['forest', 3], ['mountains', 8],
  ['forest', 8], ['mountains', 3], ['fields', 4], ['pasture', 5],
  ['hills', 5], ['fields', 6], ['pasture', 11],
].map(([terrain, number], id) => ({ id, terrain, number }));

// Harbour types clockwise from the left of the island: four generic 3:1
// harbours and one 2:1 harbour for each resource.
export const BEGINNER_HARBOR_TYPES = ['ore', 'any', 'grain', 'any', 'wool', 'any', 'brick', 'lumber', 'any'];

// The intersection touching exactly these three hexes.
export const vertexBetween = (...hexIds) =>
  GEOMETRY.vertices.find(
    (vertex) => vertex.hexes.length === hexIds.length && hexIds.every((id) => vertex.hexes.includes(id)),
  )?.id;

// Starting settlements for beginners, by colour. The `star` settlement is
// the one that pays out the starting resources.
export const BEGINNER_SETTLEMENTS = {
  red: { first: vertexBetween(0, 1, 4), star: vertexBetween(7, 8, 12) },
  blue: { first: vertexBetween(14, 15, 18), star: vertexBetween(12, 13, 16) },
  white: { first: vertexBetween(6, 10, 11), star: vertexBetween(3, 4, 8) },
  orange: { first: vertexBetween(2, 5, 6), star: vertexBetween(13, 14, 17) },
};

// Colours in the order the rulebook lists their positions. With 3 players
// nobody plays the red position.
export const BEGINNER_COLOURS = ['red', 'blue', 'white', 'orange'];

export const buildBoard = (hexes, harborTypes, layout = 'standard') => ({
  layout,
  hexes: hexes.map(({ id, terrain, number }) => ({ id, terrain, number })),
  harbors: (layout === 'large' ? HARBORS_LARGE : HARBORS).map((harbor, index) => ({ ...harbor, type: harborTypes[index] })),
  robber: hexes.find((hex) => hex.terrain === 'desert').id,
});

// ---------------------------------------------------------------- random

const bag = (counts) => Object.entries(counts).flatMap(([item, count]) => Array(count).fill(item));

const TERRAIN_BAGS = {
  standard: bag({ forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 }),
  // The 5-6 player extension: 28 resource hexes and two deserts.
  large: bag({ forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, desert: 2 }),
};
export const NUMBER_BAGS = {
  standard: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  large: [2, 2, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap((n) => [n, n, n]), 12, 12],
};
export const NUMBER_BAG = NUMBER_BAGS.standard;
const HARBOR_BAGS = {
  standard: ['any', 'any', 'any', 'any', 'brick', 'lumber', 'ore', 'grain', 'wool'],
  large: ['any', 'any', 'any', 'any', 'any', 'brick', 'lumber', 'ore', 'grain', 'wool', 'wool'],
};

export const shuffle = (items, pickIndex) => {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const RED = [6, 8];
const EXTREMES = [2, 12];

// True when no two numbers of the group sit on neighbouring hexes.
export const numbersApart = (hexes, group) => {
  const geometry = geometryOf({ hexes });
  return hexes.every(
    (hex) =>
      !group.includes(hex.number) ||
      geometry.hexes[hex.id].neighbours.every((other) => !group.includes(hexes[other].number)),
  );
};

// True when no two red numbers (6 and 8) sit on neighbouring hexes.
export const redNumbersApart = (hexes) => numbersApart(hexes, RED);

// Whether a layout follows the host's number rules: by default the red 6s
// and 8s never touch, and the host may also keep 2 and 12 apart.
export const numbersOk = (hexes, { redsMayTouch = false, extremesMayTouch = true } = {}) =>
  (redsMayTouch || numbersApart(hexes, RED)) && (extremesMayTouch || numbersApart(hexes, EXTREMES));

// The variable set-up: shuffled terrain, shuffled number tokens placed by
// the host's number rules, desert without a token, shuffled harbours.
export const randomBoard = (pickIndex, rules = {}, layout = 'standard') => {
  const terrains = shuffle(TERRAIN_BAGS[layout], pickIndex);

  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const numbers = shuffle(NUMBER_BAGS[layout], pickIndex);
    let next = 0;
    const hexes = terrains.map((terrain, id) => ({
      id,
      terrain,
      number: terrain === 'desert' ? null : numbers[next++],
    }));

    if (numbersOk(hexes, rules)) {
      return buildBoard(hexes, shuffle(HARBOR_BAGS[layout], pickIndex), layout);
    }
  }

  return beginnerBoard(layout);
};

// A fixed, balanced extension island for the beginners' choice with 5 or 6
// players: always the same layout, drawn once from a fixed seed.
const fixedPick = (seed) => (range) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * range);
};
let largeBeginner = null;

export function beginnerBoard(layout = 'standard') {
  if (layout === 'large') {
    largeBeginner = largeBeginner || randomBoard(fixedPick(2026), {}, 'large');
    return largeBeginner;
  }
  return buildBoard(BEGINNER_HEXES, BEGINNER_HARBOR_TYPES);
}

// A short, stable name for one island layout: the SHA-256 of its terrain,
// numbers and harbours. Two boards share it only if they are the same board.
export const boardFingerprint = (board) => {
  const text = [
    board.hexes.map((hex) => `${hex.terrain}${hex.number ?? 0}`).join(','),
    board.harbors.map((harbor) => harbor.type).join(','),
  ].join('|');
  const hex = bytesToHex(sha256(utf8ToBytes(text))).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
};
