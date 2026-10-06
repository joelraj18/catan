import { GEOMETRIES, NUMBER_BAGS, beginnerBoard, boardFingerprint, geometryOf, numbersOk, randomBoard } from './catanBoard';

const seeded = (seed) => (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * n);
};

describe('the 5-6 player island', () => {
  const large = GEOMETRIES.large;

  test('30 hexes in rows of 3-4-5-6-5-4-3, every intersection on 1 to 3 hexes', () => {
    expect(large.hexes).toHaveLength(30);
    const rows = [0, 1, 2, 3, 4, 5, 6].map((row) => large.hexes.filter((hex) => hex.row === row).length);
    expect(rows).toEqual([3, 4, 5, 6, 5, 4, 3]);
    expect(large.vertices.every((vertex) => vertex.hexes.length >= 1 && vertex.hexes.length <= 3)).toBe(true);
    expect(large.edges.every((edge) => edge.vertices.length === 2 && edge.hexes.length >= 1 && edge.hexes.length <= 2)).toBe(true);
    // Euler for a disc of hexagons: V - E + F = 1 (faces are the hexes).
    expect(large.vertices.length - large.edges.length + large.hexes.length).toBe(1);
    // Centred: as far left as right.
    expect(Math.abs(Math.min(...large.hexes.map((h) => h.x)) + Math.max(...large.hexes.map((h) => h.x)))).toBeLessThan(0.01);
  });

  test('a random large island: 2 deserts, 28 tokens, 11 harbours never sharing a corner', () => {
    const board = randomBoard(seeded(5), {}, 'large');
    expect(board.layout).toBe('large');
    expect(geometryOf(board)).toBe(large);
    expect(board.hexes.filter((hex) => hex.terrain === 'desert')).toHaveLength(2);
    expect(board.hexes.filter((hex) => hex.number).map((hex) => hex.number).sort((a, b) => a - b)).toEqual(
      [...NUMBER_BAGS.large].sort((a, b) => a - b),
    );
    expect(board.harbors).toHaveLength(11);
    const corners = board.harbors.flatMap((harbor) => harbor.vertices);
    expect(new Set(corners).size).toBe(corners.length);
    expect(numbersOk(board.hexes)).toBe(true);
  });

  test("the beginners' large island is always the same", () => {
    expect(boardFingerprint(beginnerBoard('large'))).toBe(boardFingerprint(beginnerBoard('large')));
    expect(geometryOf(beginnerBoard())).toBe(GEOMETRIES.standard);
  });
});
