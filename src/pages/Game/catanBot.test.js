import { GEOMETRY, PIPS } from './catanBoard';
import * as Bot from './catanBot';
import * as Casual from './catanBotCasual';
import GameEngine from './catanEngine';
import { emptyHand, legalSettlementSpots, publicPoints } from './catanRules';

const CALM = { roll: 0, botDelay: 1e9, botStep: 1e9, setupTurn: 1e9, discard: 1e9, robber: 1e9, turn: 1e9, tradeWait: 1e9, advisor: 1e9 };
const hand = (patch = {}) => ({ ...emptyHand(), ...patch });

const engines = [];
afterEach(() => {
  engines.splice(0).forEach((engine) => engine.destroy());
});

// A beginners' table: a person (p1) and two computer seats.
const table = (options = {}) => {
  let seed = 9;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const engine = new GameEngine({
    players: ['human', 'bot', 'bot'].map((kind, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, pieceKey: ['red', 'blue', 'white'][i], kind })),
    timing: CALM,
    options: { board: 'beginner', ...options },
    rollDie: () => 1 + Math.floor(random() * 6),
    pickIndex: (n) => Math.floor(random() * n),
    random,
  });
  engines.push(engine);
  return engine;
};

const patch = (engine, changes) => {
  engine.state = { ...engine.state, ...changes };
  return engine.state;
};

// Raises p1's visible points: both settlements become cities (4), plus the
// Largest Army (6), plus the Longest Road or one more settlement.
const pointsFor = (engine, points) => {
  const buildings = { ...engine.state.buildings };
  Object.entries(buildings).forEach(([v, b]) => {
    if (b.owner === 'p1') buildings[v] = { ...b, type: 'city' };
  });
  const changes = { buildings, largestArmy: 'p1', knights: { ...engine.state.knights, p1: 3 } };
  if (points >= 7) {
    const spot = legalSettlementSpots(engine.state, 'p1', { setup: true })[0];
    buildings[spot] = { owner: 'p1', type: 'settlement' };
  }
  if (points >= 8) changes.longestRoad = { ...engine.state.longestRoad, holder: 'p1' };
  patch(engine, changes);
  expect(publicPoints(engine.state, 'p1')).toBe(points >= 8 ? 9 : points);
};

describe('strong trading', () => {
  // p2 needs 2 ore for a city; p1 offers exactly that for a spare wool.
  const offer = { id: 1, from: 'p1', to: 'p2', give: { ore: 2 }, get: { wool: 1 }, responses: {} };
  const setHands = (engine, p1Hand) =>
    patch(engine, {
      hands: { ...engine.state.hands, p1: p1Hand, p2: hand({ wool: 3, ore: 1, grain: 2 }) },
      tracker: { p1: p1Hand },
    });

  test('a good offer from a player far from winning is taken', () => {
    const engine = table();
    setHands(engine, hand({ ore: 2 }));
    const { blocked, margin } = Bot.tradeValue(engine.state, 'p2', offer);
    expect(blocked).toBe(false);
    expect(margin).toBeGreaterThan(0);
    expect(Bot.acceptsTrade(engine.state, 'p2', offer)).toBe(true);
  });

  test('never trades with a leader who is near a win', () => {
    const engine = table();
    setHands(engine, hand({ ore: 2 }));
    pointsFor(engine, 8);
    expect(Bot.tradeValue(engine.state, 'p2', offer).blocked).toBe(true);
    expect(Bot.acceptsTrade(engine.state, 'p2', offer)).toBe(false);
  });

  test('refuses a trade that completes a build for a player within three points of winning', () => {
    const engine = table();
    pointsFor(engine, 7);
    // Everyone saw p1 collect brick, lumber and grain: the wool makes a settlement.
    setHands(engine, hand({ brick: 1, lumber: 1, grain: 1, ore: 2 }));
    expect(Bot.tradeValue(engine.state, 'p2', offer).blocked).toBe(true);

    // The same trade is fine when it completes nothing for them.
    setHands(engine, hand({ lumber: 3, ore: 2 }));
    expect(Bot.tradeValue(engine.state, 'p2', offer).blocked).toBe(false);
  });

  test('hidden victory point cards never change the answer', () => {
    const engine = table();
    setHands(engine, hand({ ore: 2 }));
    const before = Bot.tradeValue(engine.state, 'p2', offer);
    patch(engine, { devCards: { ...engine.state.devCards, p1: Array.from({ length: 4 }, (_, i) => ({ id: i, type: 'victoryPoint', boughtTurn: 0 })) } });
    expect(Bot.tradeValue(engine.state, 'p2', offer)).toEqual(before);
  });
});

describe('skill levels', () => {
  test('the table rule picks the strategy, a seat may carry its own', () => {
    const strong = table();
    expect(strong.state.options.botSkill).toBe('strong');
    expect(Bot.skillOf(strong.state, 'p2')).toBe('strong');

    const casual = table({ botSkill: 'casual' });
    expect(Bot.skillOf(casual.state, 'p2')).toBe('casual');
    expect(Bot.rankSetupSettlements(casual.state, 'p2')).toEqual(Casual.rankSetupSettlements(casual.state, 'p2'));
    patch(casual, { players: casual.state.players.map((p) => (p.id === 'p3' ? { ...p, skill: 'strong' } : p)) });
    expect(Bot.skillOf(casual.state, 'p3')).toBe('strong');
  });
});

describe('strong turns', () => {
  // p2's trade and build phase.
  const myTurn = (engine, cards, extra = {}) =>
    patch(engine, {
      activeIndex: 1,
      turnPhase: 'actions',
      turnCount: 5,
      hands: { ...engine.state.hands, p2: cards },
      ...extra,
    });

  const runTurn = (engine) => {
    const memory = { steps: 0 };
    const done = [];
    for (let i = 0; i < 20; i += 1) {
      const action = Bot.nextAction(engine.state, 'p2', memory);
      if (!action) break;
      expect(engine.perform('p2', action, memory)).toBe(true);
      done.push(action.type === 'play-dev' ? `${action.type}:${action.card}` : action.type);
    }
    return done;
  };

  test('builds everything worth building in one turn', () => {
    const engine = table();
    myTurn(engine, hand({ ore: 6, grain: 4 }));
    const done = runTurn(engine);
    expect(done.filter((type) => type === 'build-city')).toHaveLength(2);
  });

  test('plays Monopoly only for a big enough haul', () => {
    const monopoly = { devCards: { p1: [], p2: [{ id: 1, type: 'monopoly', boughtTurn: 0 }], p3: [] } };
    const engine = table();
    myTurn(engine, hand({ ore: 1, grain: 2 }), { ...monopoly, hands: { p1: hand({ ore: 1 }), p2: hand({ ore: 1, grain: 2 }), p3: hand({ ore: 1 }) }, tracker: { p1: hand({ ore: 1 }), p3: hand({ ore: 1 }) } });
    expect(Bot.nextAction(engine.state, 'p2', {})).toBeNull();

    myTurn(engine, hand({ ore: 1, grain: 2 }), { ...monopoly, hands: { p1: hand({ ore: 3 }), p2: hand({ ore: 1, grain: 2 }), p3: hand({ ore: 2 }) }, tracker: { p1: hand({ ore: 3 }), p3: hand({ ore: 2 }) } });
    expect(Bot.nextAction(engine.state, 'p2', {})).toEqual({ type: 'play-dev', card: 'monopoly', resource: 'ore' });
  });

  test('plays a knight before rolling when the robber blocks a good hex', () => {
    const engine = table();
    const knight = { devCards: { p1: [], p2: [{ id: 1, type: 'knight', boughtTurn: 0 }], p3: [] } };
    patch(engine, { activeIndex: 1, turnPhase: 'pre-roll', turnCount: 5, ...knight });
    expect(Bot.wantsKnightBeforeRoll(engine.state, 'p2')).toBe(false);

    // The richest hex next to one of p2's settlements.
    const mine = Object.entries(engine.state.buildings).filter(([, b]) => b.owner === 'p2').map(([v]) => Number(v));
    const hexes = mine.flatMap((v) => GEOMETRY.vertices[v].hexes).map((id) => engine.state.board.hexes[id]);
    const rich = hexes.filter((hex) => hex.number).sort((a, b) => PIPS[b.number] - PIPS[a.number])[0];
    patch(engine, { board: { ...engine.state.board, robber: rich.id } });
    expect(Bot.wantsKnightBeforeRoll(engine.state, 'p2')).toBe(true);
  });

  test('discards what the goal needs least', () => {
    const engine = table();
    patch(engine, { turnPhase: 'discard', hands: { ...engine.state.hands, p2: hand({ ore: 3, grain: 2, wool: 3, brick: 1 }) }, pendingDiscards: { p2: 4 } });
    const discard = Bot.chooseDiscard(engine.state, 'p2');
    expect(Object.values(discard).reduce((a, b) => a + b, 0)).toBe(4);
    expect(discard.ore || 0).toBe(0);
    expect(discard.grain || 0).toBe(0);
  });

  test('robs the leader before anyone else', () => {
    const engine = table();
    pointsFor(engine, 7);
    const [top] = Bot.rankRobberHexes(engine.state, 'p2');
    const owners = GEOMETRY.hexes[top.hexId].vertices.map((v) => engine.state.buildings[v]?.owner).filter(Boolean);
    expect(owners).toContain('p1');
    expect(owners).not.toContain('p2');
  });
});
