import {
  BEGINNER_HEXES,
  BEGINNER_HARBOR_TYPES,
  BEGINNER_SETTLEMENTS,
  EDGE_COUNT,
  GEOMETRY,
  HARBORS,
  HEX_COUNT,
  NUMBER_BAG,
  VERTEX_COUNT,
  beginnerBoard,
  randomBoard,
  redNumbersApart,
} from './catanBoard';
import { vertexResources } from './catanRules';

// A small seeded generator, so random boards are repeatable in tests.
const seeded = (seed) => (range) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * range);
};

const count = (list, key) => list.reduce((map, item) => ({ ...map, [item[key]]: (map[item[key]] || 0) + 1 }), {});

describe('island geometry', () => {
  test('19 hexes, 54 intersections and 72 paths', () => {
    expect(HEX_COUNT).toBe(19);
    expect(VERTEX_COUNT).toBe(54);
    expect(EDGE_COUNT).toBe(72);
  });

  test('rows of 3, 4, 5, 4 and 3 hexes', () => {
    const rows = count(GEOMETRY.hexes, 'row');
    expect(Object.values(rows)).toEqual([3, 4, 5, 4, 3]);
  });

  test('every hex has 6 corners and 6 sides, and intersections touch 1 to 3 hexes', () => {
    GEOMETRY.hexes.forEach((hex) => {
      expect(new Set(hex.vertices).size).toBe(6);
      expect(new Set(hex.edges).size).toBe(6);
    });
    GEOMETRY.vertices.forEach((vertex) => {
      expect(vertex.hexes.length).toBeGreaterThanOrEqual(1);
      expect(vertex.hexes.length).toBeLessThanOrEqual(3);
      expect(vertex.neighbours.length).toBeGreaterThanOrEqual(2);
      expect(vertex.neighbours.length).toBeLessThanOrEqual(3);
      expect(vertex.edges.length).toBe(vertex.neighbours.length);
    });
  });

  test('the centre hex has 6 neighbours and corner hexes have 3', () => {
    expect(GEOMETRY.hexes[9].neighbours).toHaveLength(6);
    [0, 2, 7, 11, 16, 18].forEach((id) => expect(GEOMETRY.hexes[id].neighbours).toHaveLength(3));
  });

  test('30 coastal paths and 9 harbours on 18 different intersections', () => {
    expect(GEOMETRY.coast).toHaveLength(30);
    expect(HARBORS).toHaveLength(9);
    const vertices = HARBORS.flatMap((harbor) => harbor.vertices);
    expect(new Set(vertices).size).toBe(18);
    HARBORS.forEach((harbor) => expect(GEOMETRY.edges[harbor.edge].hexes).toHaveLength(1));
  });
});

describe("beginners' map (rulebook illustration A)", () => {
  test('terrain and numbers row by row', () => {
    expect(BEGINNER_HEXES.map((hex) => `${hex.terrain}${hex.number ?? ''}`)).toEqual([
      'mountains10', 'pasture2', 'forest9',
      'fields12', 'hills6', 'pasture4', 'hills10',
      'fields9', 'forest11', 'desert', 'forest3', 'mountains8',
      'forest8', 'mountains3', 'fields4', 'pasture5',
      'hills5', 'fields6', 'pasture11',
    ]);
  });

  test('has the right number of each terrain and every number token', () => {
    expect(count(BEGINNER_HEXES, 'terrain')).toEqual({ forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 });
    const numbers = BEGINNER_HEXES.map((hex) => hex.number).filter(Boolean).sort((a, b) => a - b);
    expect(numbers).toEqual([...NUMBER_BAG].sort((a, b) => a - b));
  });

  test('the robber starts in the desert and harbours are 4 generic plus one per resource', () => {
    const board = beginnerBoard();
    expect(board.hexes[board.robber].terrain).toBe('desert');
    expect(count(BEGINNER_HARBOR_TYPES.map((type) => ({ type })), 'type')).toEqual({
      any: 4, brick: 1, lumber: 1, ore: 1, grain: 1, wool: 1,
    });
  });

  test('blue starts with brick, lumber and ore from its starred settlement', () => {
    const resources = vertexResources(beginnerBoard(), BEGINNER_SETTLEMENTS.blue.star).sort();
    expect(resources).toEqual(['brick', 'lumber', 'ore']);
    // Blue's other settlement sits between two pastures and a field.
    expect(vertexResources(beginnerBoard(), BEGINNER_SETTLEMENTS.blue.first).sort()).toEqual(['grain', 'wool', 'wool']);
  });

  test('all eight starting settlements are legal under the Distance Rule', () => {
    const spots = Object.values(BEGINNER_SETTLEMENTS).flatMap((entry) => [entry.first, entry.star]);
    expect(spots.every((id) => Number.isInteger(id))).toBe(true);
    expect(new Set(spots).size).toBe(8);
    const touching = spots.flatMap((a) => spots.filter((b) => GEOMETRY.vertices[a].neighbours.includes(b)));
    expect(touching).toEqual([]);
  });
});

describe('random map', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i follows the variable set-up rules', (seed) => {
    const board = randomBoard(seeded(seed));
    expect(count(board.hexes, 'terrain')).toEqual({ forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 });
    const desert = board.hexes.find((hex) => hex.terrain === 'desert');
    expect(desert.number).toBeNull();
    expect(board.robber).toBe(desert.id);
    const numbers = board.hexes.map((hex) => hex.number).filter(Boolean).sort((a, b) => a - b);
    expect(numbers).toEqual([...NUMBER_BAG].sort((a, b) => a - b));
    expect(redNumbersApart(board.hexes)).toBe(true);
    expect(count(board.harbors, 'type')).toEqual({ any: 4, brick: 1, lumber: 1, ore: 1, grain: 1, wool: 1 });
  });

  test('different seeds give different islands', () => {
    const a = randomBoard(seeded(1)).hexes.map((hex) => hex.terrain).join();
    const b = randomBoard(seeded(99)).hexes.map((hex) => hex.terrain).join();
    expect(a).not.toBe(b);
  });
});
