import { GEOMETRY, boardFingerprint, beginnerBoard, numbersApart, numbersOk, randomBoard } from './catanBoard';
import { secureIndex, secureRollDie } from './catanEngine';
import { DEFAULT_SETTINGS, cleanSettings, settingsOf } from './gameSettings';

const seeded = (seed) => (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * n);
};

const neighbouring = (hexes, a, b) =>
  hexes.some((hex) => hex.number === a && GEOMETRY.hexes[hex.id].neighbours.some((other) => hexes[other].number === b));

describe('table settings', () => {
  test('only the offered choices pass, anything else falls back to the default', () => {
    expect(cleanSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ turnSeconds: 45, handLimit: 9, victoryPoints: 12, board: 'random' })).toMatchObject({
      turnSeconds: 45,
      handLimit: 9,
      victoryPoints: 12,
      board: 'random',
    });
    expect(cleanSettings({ turnSeconds: 1, handLimit: 2, victoryPoints: 99, board: 'weird', redsMayTouch: 'yes' })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(cleanSettings({ turnSeconds: '30' }).turnSeconds).toBe(30);
  });

  test('a game saved before settings existed plays the classic rules with no timer', () => {
    expect(settingsOf({ options: { board: 'random' } })).toMatchObject({ board: 'random', turnSeconds: 0, handLimit: 7, victoryPoints: 10 });
  });
});

describe('number placement rules', () => {
  const combos = [
    { redsMayTouch: false, extremesMayTouch: true },
    { redsMayTouch: false, extremesMayTouch: false },
    { redsMayTouch: true, extremesMayTouch: false },
    { redsMayTouch: true, extremesMayTouch: true },
  ];

  test.each(combos)('every random island follows %o', (rules) => {
    const pick = seeded(11);
    const boards = Array.from({ length: 150 }, () => randomBoard(pick, rules).hexes);
    const redsApart = boards.filter((hexes) => numbersApart(hexes, [6, 8])).length;
    const extremesApart = boards.filter((hexes) => !neighbouring(hexes, 2, 12) && !neighbouring(hexes, 12, 2)).length;

    expect(boards.every((hexes) => numbersOk(hexes, rules))).toBe(true);
    // Kept apart means always apart; allowed to touch means they really do.
    expect(redsApart === boards.length).toBe(!rules.redsMayTouch);
    expect(extremesApart === boards.length || rules.extremesMayTouch).toBe(true);
  });
});

describe('a fresh island every game', () => {
  test('10,000 islands from the secure generator are all different', () => {
    const seen = new Set();
    for (let i = 0; i < 10000; i += 1) seen.add(boardFingerprint(randomBoard(secureIndex)));
    expect(seen.size).toBe(10000);
  });

  test('the fingerprint names the layout: same island, same code', () => {
    expect(boardFingerprint(beginnerBoard())).toBe(boardFingerprint(beginnerBoard()));
    expect(boardFingerprint(beginnerBoard())).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    const a = randomBoard(seeded(3));
    expect(boardFingerprint(a)).toBe(boardFingerprint({ ...a, robber: 0 }));
    expect(boardFingerprint(a)).not.toBe(boardFingerprint(randomBoard(seeded(4))));
  });

  test('every hex is equally likely to be the desert (chi-square, p > 0.001)', () => {
    const runs = 9500;
    const counts = Array(19).fill(0);
    for (let i = 0; i < runs; i += 1) {
      counts[randomBoard(secureIndex).hexes.findIndex((hex) => hex.terrain === 'desert')] += 1;
    }
    const expected = runs / 19;
    const chi = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(42.3); // 18 degrees of freedom
  });

  test('the dice are fair (chi-square, p > 0.001)', () => {
    const rolls = 60000;
    const counts = Array(6).fill(0);
    for (let i = 0; i < rolls; i += 1) counts[secureRollDie() - 1] += 1;
    const expected = rolls / 6;
    const chi = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(20.5); // 5 degrees of freedom
  });
});
