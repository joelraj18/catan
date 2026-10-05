// The island of Catan: hex geometry, the beginners' map from the rulebook
// and the variable (random) map.
//
// The 19 land hexes sit in rows of 3-4-5-4-3, pointy side up. Everything a
// rule needs (which hexes touch an intersection, which intersections are
// neighbours, which paths meet at an intersection) is derived once from the
// hex centres, so every module shares the same ids:
//   hexes     0..18, row by row, left to right
//   vertices  0..53, top to bottom, left to right (the intersections)
//   edges     0..71 (the paths), each joining two vertices

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

const ROW_LENGTHS = [3, 4, 5, 4, 3];
const SQRT3 = Math.sqrt(3);

// Axial coordinates, row by row (r = -2..2).
const AXIAL = [];
ROW_LENGTHS.forEach((length, index) => {
  const r = index - 2;
  const start = Math.max(-2, -2 - r);
  for (let i = 0; i < length; i += 1) {
    AXIAL.push({ q: start + i, r, row: index });
  }
});

const round = (value) => Math.round(value * 1000) / 1000;

const buildGeometry = () => {
  const hexes = AXIAL.map(({ q, r, row }, id) => ({
    id,
    q,
    r,
    row,
    x: round(SQRT3 * (q + r / 2)),
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

  return { hexes, vertices, edges, coast };
};

export const GEOMETRY = buildGeometry();
export const HEX_COUNT = GEOMETRY.hexes.length;
export const VERTEX_COUNT = GEOMETRY.vertices.length;
export const EDGE_COUNT = GEOMETRY.edges.length;

// Nine harbours spaced around the coast (30 coastal paths), never sharing an
// intersection.
const HARBOR_SLOTS = [1, 4, 8, 11, 14, 18, 21, 24, 28];

export const HARBORS = HARBOR_SLOTS.map((slot) => {
  const coast = GEOMETRY.coast[slot];
  const edge = GEOMETRY.edges[coast.edge];
  const length = Math.hypot(coast.mx, coast.my) || 1;
  return {
    edge: edge.id,
    vertices: edge.vertices,
    // A spot out at sea for drawing the harbour marker.
    x: round(coast.mx + (coast.mx / length) * 0.62),
    y: round(coast.my + (coast.my / length) * 0.62),
  };
});

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

export const buildBoard = (hexes, harborTypes) => ({
  hexes: hexes.map(({ id, terrain, number }) => ({ id, terrain, number })),
  harbors: HARBORS.map((harbor, index) => ({ ...harbor, type: harborTypes[index] })),
  robber: hexes.find((hex) => hex.terrain === 'desert').id,
});

export const beginnerBoard = () => buildBoard(BEGINNER_HEXES, BEGINNER_HARBOR_TYPES);

// ---------------------------------------------------------------- random

const TERRAIN_BAG = [
  ...Array(4).fill('forest'),
  ...Array(4).fill('pasture'),
  ...Array(4).fill('fields'),
  ...Array(3).fill('hills'),
  ...Array(3).fill('mountains'),
  'desert',
];
export const NUMBER_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const HARBOR_BAG = ['any', 'any', 'any', 'any', 'brick', 'lumber', 'ore', 'grain', 'wool'];

export const shuffle = (items, pickIndex) => {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const isHot = (number) => number === 6 || number === 8;

// True when no two red numbers (6 and 8) sit on neighbouring hexes.
export const redNumbersApart = (hexes) =>
  hexes.every(
    (hex) =>
      !isHot(hex.number) || GEOMETRY.hexes[hex.id].neighbours.every((other) => !isHot(hexes[other].number)),
  );

// The variable set-up: shuffled terrain, shuffled number tokens with no red
// numbers side by side, desert without a token, shuffled harbours.
export const randomBoard = (pickIndex) => {
  const terrains = shuffle(TERRAIN_BAG, pickIndex);

  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const numbers = shuffle(NUMBER_BAG, pickIndex);
    let next = 0;
    const hexes = terrains.map((terrain, id) => ({
      id,
      terrain,
      number: terrain === 'desert' ? null : numbers[next++],
    }));

    if (redNumbersApart(hexes)) {
      return buildBoard(hexes, shuffle(HARBOR_BAG, pickIndex));
    }
  }

  return beginnerBoard();
};
