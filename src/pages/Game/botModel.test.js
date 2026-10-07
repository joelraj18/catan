import { beginnerBoard, vertexBetween } from './catanBoard';
import {
  STYLES,
  affordableWithTrades,
  estimatedHand,
  pickBest,
  production,
  styleOf,
  trackEvent,
  turnsToAfford,
} from './botModel';
import { emptyHand } from './catanRules';

const hand = (patch = {}) => ({ ...emptyHand(), ...patch });
const near = (value, expected) => expect(value).toBeCloseTo(expected, 5);

// The red starting spot on the beginners' island touches fields 9 (hex 7),
// forest 11 (hex 8) and forest 8 (hex 12).
const SPOT = vertexBetween(7, 8, 12);

const stateWith = (buildings, extra = {}) => ({
  board: beginnerBoard(),
  buildings,
  roads: {},
  players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  hands: { a: emptyHand(), b: emptyHand(), c: emptyHand() },
  ...extra,
});

describe('production', () => {
  test('pips over 36 for each resource, doubled for a city', () => {
    const settled = production(stateWith({ [SPOT]: { owner: 'a', type: 'settlement' } }), 'a');
    near(settled.grain, 4 / 36);
    near(settled.lumber, (2 + 5) / 36);
    near(settled.ore + settled.brick + settled.wool, 0);

    const city = production(stateWith({ [SPOT]: { owner: 'a', type: 'city' } }), 'a');
    near(city.grain, 8 / 36);
    near(city.lumber, 14 / 36);
    expect(production(stateWith({ [SPOT]: { owner: 'a', type: 'city' } }), 'b')).toEqual(emptyHand());
  });

  test('the hex under the robber produces nothing', () => {
    const state = stateWith({ [SPOT]: { owner: 'a', type: 'settlement' } });
    const robbed = { ...state, board: { ...state.board, robber: 12 } };
    near(production(robbed, 'a').lumber, 2 / 36);
    near(production(robbed, 'a', { robberFactor: 1 }).lumber, 7 / 36);
  });
});

describe('turnsToAfford', () => {
  const rates = { brick: 4, lumber: 4, ore: 4, grain: 4, wool: 4 };

  test('nothing to wait for when the hand pays, with or without the bank', () => {
    expect(turnsToAfford(hand({ ore: 3, grain: 2 }), { ore: 3, grain: 2 }, hand(), rates)).toBe(0);
    expect(turnsToAfford(hand({ ore: 3, grain: 1, wool: 4 }), { ore: 3, grain: 2 }, hand(), rates)).toBe(0);
    expect(affordableWithTrades(hand({ ore: 3, grain: 1, wool: 3 }), { ore: 3, grain: 2 }, rates)).toBe(false);
    expect(affordableWithTrades(hand({ ore: 3, grain: 1, wool: 3 }), { ore: 3, grain: 2 }, { ...rates, wool: 3 })).toBe(true);
  });

  test('steady production fills the gap', () => {
    expect(turnsToAfford(hand(), { ore: 1 }, hand({ ore: 0.5 }), rates)).toBeCloseTo(2, 2);
    expect(turnsToAfford(hand({ ore: 2 }), { ore: 3, grain: 2 }, hand({ ore: 0.25, grain: 0.5 }), rates)).toBeCloseTo(4, 2);
    // Surplus traded at a harbour shortens the wait.
    const slow = turnsToAfford(hand(), { ore: 1 }, hand({ ore: 0.1, wool: 1 }), rates);
    const harbour = turnsToAfford(hand(), { ore: 1 }, hand({ ore: 0.1, wool: 1 }), { ...rates, wool: 2 });
    expect(harbour).toBeLessThan(slow);
  });

  test('a cost it can never pay waits the limit', () => {
    expect(turnsToAfford(hand(), { ore: 1 }, hand(), rates, 30)).toBe(30);
  });
});

describe('public card tracker', () => {
  const play = (events, hands) => {
    let tracker;
    events.forEach((event) => {
      tracker = trackEvent(tracker, event, { ...stateWith({}), hands: hands(event) });
    });
    return tracker;
  };

  test('follows production, builds, trades, the bank and monopolies', () => {
    const steps = [
      { type: 'produce', gains: { a: { ore: 2, grain: 1 }, b: { brick: 1, lumber: 1 } }, hands: { a: hand({ ore: 2, grain: 1 }), b: hand({ brick: 1, lumber: 1 }) } },
      { type: 'build', actor: 'b', piece: 'road', paid: { brick: 1, lumber: 1 }, hands: { a: hand({ ore: 2, grain: 1 }), b: hand() } },
      { type: 'trade', actor: 'a', partner: 'c', give: { ore: 1 }, get: { wool: 1 }, hands: { a: hand({ ore: 1, grain: 1, wool: 1 }), b: hand(), c: hand({ ore: 1 }) } },
      { type: 'maritime', actor: 'c', give: { ore: 1 }, get: { brick: 1 }, hands: { a: hand({ ore: 1, grain: 1, wool: 1 }), b: hand(), c: hand({ brick: 1 }) } },
      { type: 'yop', actor: 'b', bundle: { grain: 2 }, hands: { a: hand({ ore: 1, grain: 1, wool: 1 }), b: hand({ grain: 2 }), c: hand({ brick: 1 }) } },
      { type: 'monopoly', actor: 'b', resource: 'grain', from: { a: 1 }, total: 1, hands: { a: hand({ ore: 1, wool: 1 }), b: hand({ grain: 3 }), c: hand({ brick: 1 }) } },
    ];
    // c held nothing before it traded: the ore it got from a is all it had.
    const tracker = play(steps, (event) => ({ a: hand(), b: hand(), c: hand(), ...steps.find((step) => step === event).hands }));
    expect(tracker.a).toEqual(hand({ ore: 1, wool: 1 }));
    expect(tracker.b).toEqual(hand({ grain: 3 }));
    expect(tracker.c).toEqual(hand({ brick: 1 }));
  });

  test('a steal and a discard count as unknown, whatever the host knows', () => {
    const before = { type: 'produce', gains: { a: { ore: 2, wool: 2 } } };
    const hands1 = { a: hand({ ore: 2, wool: 2 }), b: hand(), c: hand() };
    const hands2 = { a: hand({ ore: 1, wool: 2 }), b: hand({ ore: 1 }), c: hand() };
    const hands3 = { a: hand({ wool: 1 }), b: hand({ ore: 1 }), c: hand() };
    const run = (steal, discard) => {
      let tracker = trackEvent(undefined, before, { ...stateWith({}), hands: hands1 });
      tracker = trackEvent(tracker, steal, { ...stateWith({}), hands: hands2 });
      return trackEvent(tracker, discard, { ...stateWith({}), hands: hands3 });
    };
    const host = run(
      { type: 'steal', actor: 'b', victim: 'a', resource: 'ore' },
      { type: 'discard', actor: 'a', bundle: { ore: 1, wool: 1 }, count: 2 },
    );
    const table = run({ type: 'steal', actor: 'b', victim: 'a', resource: null }, { type: 'discard', actor: 'a', bundle: null, count: 2 });
    expect(host).toEqual(table);
    // The stolen card is half ore, half wool as far as anyone else knows.
    expect(table.b.ore).toBeCloseTo(0.5, 2);
    expect(table.b.wool).toBeCloseTo(0.5, 2);
    // Estimates always add up to the card count everyone sees.
    expect(table.a.ore + table.a.wool).toBeCloseTo(1, 2);
  });

  test('estimates match the visible card count, even without any events', () => {
    const state = stateWith({ [SPOT]: { owner: 'a', type: 'settlement' } }, { hands: { a: hand({ grain: 2, lumber: 2 }), b: hand(), c: hand() } });
    const est = estimatedHand(state, 'a');
    expect(Object.values(est).reduce((sum, n) => sum + n, 0)).toBeCloseTo(4, 5);
    // Unknown cards lean toward what the seat produces.
    expect(est.lumber).toBeGreaterThan(est.ore);
  });
});

describe('personalities', () => {
  test('seats spread over the three styles', () => {
    const counts = Object.fromEntries(STYLES.map((style) => [style, 0]));
    for (let i = 0; i < 600; i += 1) counts[styleOf(`bot-${i}`)] += 1;
    STYLES.forEach((style) => {
      expect(counts[style]).toBeGreaterThan(150);
      expect(counts[style]).toBeLessThan(250);
    });
    // The first three computer seats of a room each get a different style.
    expect(new Set(['bot-1', 'bot-2', 'bot-3'].map(styleOf)).size).toBe(3);
    expect(styleOf('bot-1')).toBe(styleOf('bot-1'));
  });

  test('near ties break by seat and turn, never by chance', () => {
    const options = ['a', 'b', 'c', 'd'];
    const score = (option) => (option === 'd' ? 1 : 10);
    const picks = new Set();
    for (let turn = 0; turn < 40; turn += 1) {
      const pick = pickBest(options, score, { seed: `p1|${turn}` });
      expect(pick).not.toBe('d');
      expect(pickBest(options, score, { seed: `p1|${turn}` })).toBe(pick);
      picks.add(pick);
    }
    expect(picks.size).toBeGreaterThan(1);
    expect(pickBest(options, (option) => (option === 'b' ? 10 : 5), { seed: 'x' })).toBe('b');
  });
});
