import { BEGINNER_SETTLEMENTS, GEOMETRY, RESOURCES } from './catanBoard';
import { tradeValue } from './catanBot';
import GameEngine, { AI_CALL_BUDGET, beginnerPositions, computeStandings } from './catanEngine';
import {
  BANK_SIZE,
  PIECE_LIMITS,
  redactFor,
  distanceRuleOk,
  handSize,
  legalRoadSpots,
  legalSettlementSpots,
  longestRoadLength,
  maritimeRates,
  totalPoints,
  vertexResources,
} from './catanRules';

// Timings for scenario tests: dice land at once, nobody is hurried.
const CALM = { roll: 0, botDelay: 1e9, botStep: 1e9, setupTurn: 1e9, discard: 1e9, robber: 1e9, turn: 1e9, tradeWait: 1e9, advisor: 1e9 };
// Timings for whole computer games.
const FAST = { roll: 0, botDelay: 0, botStep: 0, setupTurn: 50, discard: 50, robber: 50, turn: 50, tradeWait: 0, advisor: 50 };

const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const seats = (kinds, colours = ['red', 'blue', 'white', 'orange']) =>
  kinds.map((kind, index) => ({ id: `p${index + 1}`, name: `P${index + 1}`, pieceKey: colours[index], kind }));

// An engine whose dice follow a script, then a seeded sequence.
const engineWith = ({ kinds = ['human', 'human', 'human'], board = 'beginner', rolls = [], seed = 7, colours } = {}) => {
  const random = seeded(seed);
  const queue = [...rolls];
  const engine = new GameEngine({
    players: seats(kinds, colours),
    timing: CALM,
    options: { board },
    rollDie: () => (queue.length ? queue.shift() : 1 + Math.floor(random() * 6)),
    pickIndex: (n) => Math.floor(random() * n),
    random,
  });
  return engine;
};

const hand = (patch = {}) => ({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0, ...patch });

// Gives a player cards from the bank, keeping the bank honest.
const give = (engine, id, patch) => {
  const bank = { ...engine.state.bank };
  Object.entries(patch).forEach(([r, n]) => {
    bank[r] -= n;
  });
  engine.state = {
    ...engine.state,
    bank,
    hands: { ...engine.state.hands, [id]: { ...engine.state.hands[id], ...Object.fromEntries(Object.entries(patch).map(([r, n]) => [r, engine.state.hands[id][r] + n])) } },
  };
};

const conserved = (state) =>
  RESOURCES.every((r) => state.bank[r] + Object.values(state.hands).reduce((sum, h) => sum + h[r], 0) === BANK_SIZE);

const active = (engine) => engine.activePlayer.id;

// Rolls for the active player and lands in the trade and build phase.
const rollTo = async (engine, dice) => {
  engine.state = { ...engine.state };
  const queue = [...dice];
  const original = engine.rollDie;
  engine.rollDie = () => (queue.length ? queue.shift() : original());
  await engine.roll(active(engine));
  engine.rollDie = original;
};

let engines = [];
const track = (engine) => {
  engines.push(engine);
  return engine;
};

afterEach(() => {
  engines.forEach((engine) => engine.destroy());
  engines = [];
});

describe('opening the game', () => {
  test("beginners' board: 2 settlements and 2 roads each, starting resources from the starred settlement", () => {
    const engine = track(engineWith({ kinds: ['human', 'human', 'human', 'human'] }));
    const { state } = engine;
    expect(state.turnPhase).toBe('pre-roll');
    expect(state.turnCount).toBe(1);
    state.players.forEach((player) => {
      const built = Object.values(state.buildings).filter((b) => b.owner === player.id);
      expect(built).toHaveLength(2);
      expect(Object.values(state.roads).filter((owner) => owner === player.id)).toHaveLength(2);
      const star = BEGINNER_SETTLEMENTS[player.pieceKey].star;
      expect(handSize(state.hands[player.id])).toBe(vertexResources(state.board, star).length);
      expect(totalPoints(state, player.id)).toBe(2);
    });
    expect(conserved(state)).toBe(true);
    expect(state.devDeck).toHaveLength(25);
  });

  test('with 3 players nobody plays the red position', () => {
    const positions = beginnerPositions(seats(['human', 'human', 'human'], ['red', 'blue', 'white']));
    expect(Object.values(positions).sort()).toEqual(['blue', 'orange', 'white']);
    expect(positions.p2).toBe('blue');
    expect(positions.p1).toBe('orange');
  });

  test('random board: snake order set-up, resources for the second settlement only', () => {
    const engine = track(engineWith({ board: 'random' }));
    const order = engine.state.setup.order.map((index) => engine.state.players[index].id);
    const first = order[0];
    expect(order).toHaveLength(6);
    expect(order.slice(3)).toEqual([...order.slice(0, 3)].reverse());

    const placed = [];
    for (let step = 0; step < 6; step += 1) {
      const id = engine.setupPlayerId();
      placed.push(id);
      // Placing out of turn, or a road first, is refused.
      const other = engine.state.players.find((p) => p.id !== id).id;
      expect(engine.placeSettlement(other, legalSettlementSpots(engine.state, other, { setup: true })[0])).toBe(false);

      const spot = legalSettlementSpots(engine.state, id, { setup: true })[step * 3];
      const before = handSize(engine.state.hands[id]);
      expect(engine.placeSettlement(id, spot)).toBe(true);
      const gained = handSize(engine.state.hands[id]) - before;
      expect(gained).toBe(step >= 3 ? vertexResources(engine.state.board, spot).length : 0);
      // The road must touch the new settlement.
      const far = GEOMETRY.edges.find((edge) => !edge.vertices.includes(spot)).id;
      expect(engine.placeRoad(id, far)).toBe(false);
      expect(engine.placeRoad(id, legalRoadSpots(engine.state, id, { fromVertex: spot })[0])).toBe(true);
    }

    expect(placed).toEqual(order);
    expect(engine.state.turnPhase).toBe('pre-roll');
    expect(active(engine)).toBe(first);
    expect(conserved(engine.state)).toBe(true);
  });
});

describe('a turn', () => {
  test('only the active player rolls, and production follows the dice', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    const other = engine.state.players.find((p) => p.id !== me).id;
    expect(await engine.roll(other)).toBe(false);

    const before = JSON.parse(JSON.stringify(engine.state.hands));
    await rollTo(engine, [3, 3]);
    expect(engine.state.turnPhase).toBe('actions');
    expect(engine.state.dice).toEqual([3, 3]);
    // Everyone gets exactly what their buildings next to a 6 produce.
    engine.state.players.forEach((player) => {
      let expected = 0;
      Object.entries(engine.state.buildings).forEach(([v, b]) => {
        if (b.owner !== player.id) return;
        GEOMETRY.vertices[v].hexes.forEach((h) => {
          const hex = engine.state.board.hexes[h];
          if (hex.number === 6 && hex.id !== engine.state.board.robber) expected += b.type === 'city' ? 2 : 1;
        });
      });
      expect(handSize(engine.state.hands[player.id]) - handSize(before[player.id])).toBe(expected);
    });
    expect(conserved(engine.state)).toBe(true);

    // Rolling twice is not allowed.
    expect(await engine.roll(me)).toBe(false);
  });

  test('a 7: discard half, move the robber somewhere new, steal a card', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    const [victim, rich] = engine.state.players.filter((p) => p.id !== me).map((p) => p.id);
    give(engine, rich, { ore: 5, wool: 4 }); // 9 + starting cards
    const richCards = handSize(engine.state.hands[rich]);
    give(engine, victim, { grain: 1 });
    await rollTo(engine, [3, 4]);

    expect(engine.state.turnPhase).toBe('discard');
    const owed = engine.state.pendingDiscards[rich];
    expect(owed).toBe(Math.floor(richCards / 2));
    expect(engine.state.pendingDiscards[me]).toBeUndefined();
    expect(engine.discard(rich, { ore: owed - 1 })).toBe(false);
    expect(engine.discard(rich, { ore: 5, wool: owed - 5 })).toBe(true);
    expect(handSize(engine.state.hands[rich])).toBe(richCards - owed);

    expect(engine.state.turnPhase).toBe('robber');
    expect(engine.moveRobber(me, engine.state.board.robber)).toBe(false);
    expect(engine.moveRobber(victim, 0)).toBe(false);

    // Move to a hex touching only the victim.
    const target = engine.state.board.hexes.find((hex) => {
      const owners = new Set(GEOMETRY.hexes[hex.id].vertices.map((v) => engine.state.buildings[v]?.owner).filter(Boolean));
      return owners.size === 1 && owners.has(victim) && hex.id !== engine.state.board.robber;
    });
    const victimBefore = handSize(engine.state.hands[victim]);
    const meBefore = handSize(engine.state.hands[me]);
    expect(engine.moveRobber(me, target.id)).toBe(true);
    expect(engine.state.board.robber).toBe(target.id);
    expect(handSize(engine.state.hands[victim])).toBe(victimBefore - 1);
    expect(handSize(engine.state.hands[me])).toBe(meBefore + 1);
    expect(engine.state.turnPhase).toBe('actions');
    expect(conserved(engine.state)).toBe(true);

    // Only the thief and the victim learn which card it was.
    expect(redactFor(engine.state, me).lastSteal.resource).toBeTruthy();
    expect(redactFor(engine.state, rich).lastSteal.resource).toBeNull();
  });

  test('building pays the bank and follows the placement rules', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    await rollTo(engine, [1, 1]);
    const road = legalRoadSpots(engine.state, me)[0];
    expect(engine.placeRoad(me, road)).toBe(false); // no cards yet

    give(engine, me, { brick: 3, lumber: 3, wool: 1, grain: 3, ore: 3 });
    const bankBrick = engine.state.bank.brick;
    expect(engine.placeRoad(me, road)).toBe(true);
    expect(engine.state.bank.brick).toBe(bankBrick + 1);
    expect(engine.placeRoad(me, road)).toBe(false); // already built

    // Extend until a settlement spot opens up, then build there.
    let spots = legalSettlementSpots(engine.state, me);
    while (!spots.length) {
      expect(engine.placeRoad(me, legalRoadSpots(engine.state, me)[0])).toBe(true);
      spots = legalSettlementSpots(engine.state, me);
    }
    expect(engine.placeSettlement(me, spots[0])).toBe(true);
    expect(engine.state.buildings[spots[0]]).toEqual({ owner: me, type: 'settlement' });
    expect(engine.buildCity(me, spots[0])).toBe(true);
    expect(engine.state.buildings[spots[0]].type).toBe('city');
    expect(totalPoints(engine.state, me)).toBe(4);
    expect(conserved(engine.state)).toBe(true);
    Object.keys(engine.state.buildings).forEach((v) => {
      const others = { ...engine.state.buildings };
      delete others[v];
      expect(distanceRuleOk({ ...engine.state, buildings: others }, Number(v))).toBe(true);
    });
  });

  test('the turn passes clockwise and nothing happens out of turn', async () => {
    const engine = track(engineWith());
    const order = engine.state.players.map((p) => p.id);
    const me = active(engine);
    expect(engine.endTurn(me)).toBe(false); // must roll first
    await rollTo(engine, [2, 2]);
    expect(engine.endTurn(me)).toBe(true);
    expect(active(engine)).toBe(order[(order.indexOf(me) + 1) % 3]);
    expect(engine.state.turnPhase).toBe('pre-roll');
  });
});

describe('development cards', () => {
  const stackDeck = (engine, cards) => {
    engine.state = { ...engine.state, devDeck: [...cards, ...engine.state.devDeck.slice(cards.length)] };
  };

  test('bought cards wait a turn, and only one card is played per turn', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    stackDeck(engine, ['knight', 'knight']);
    await rollTo(engine, [1, 1]);
    give(engine, me, { ore: 2, wool: 2, grain: 2 });
    expect(engine.buyDev(me)).toBe(true);
    expect(engine.buyDev(me)).toBe(true);
    expect(engine.state.devDeck).toHaveLength(23);
    expect(engine.playDev(me, 'knight')).toBe(false); // bought this turn

    // Next time round.
    for (let i = 0; i < 3; i += 1) {
      if (engine.state.turnPhase === 'pre-roll') await rollTo(engine, [1, 1]);
      engine.endTurn(active(engine));
    }
    expect(active(engine)).toBe(me);
    expect(engine.playDev(me, 'knight')).toBe(true); // before rolling
    expect(engine.state.turnPhase).toBe('robber');
    const target = engine.state.board.hexes.find((hex) =>
      GEOMETRY.hexes[hex.id].vertices.every((v) => !engine.state.buildings[v]) && hex.id !== engine.state.board.robber,
    );
    expect(engine.moveRobber(me, target.id)).toBe(true);
    expect(engine.state.turnPhase).toBe('pre-roll'); // a knight before the roll returns to the roll
    await rollTo(engine, [1, 1]);
    expect(engine.playDev(me, 'knight')).toBe(false); // one per turn
    expect(engine.state.knights[me]).toBe(1);
  });

  test('three knights take the Largest Army, more knights take it away', () => {
    const engine = track(engineWith());
    const [a, b] = engine.state.players.map((p) => p.id);
    const old = (type, n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, type, boughtTurn: -1 }));
    engine.state = { ...engine.state, knights: { ...engine.state.knights, [a]: 2, [b]: 3 }, largestArmy: b, devCards: { ...engine.state.devCards, [a]: old('knight', 2) } };
    engine.state = { ...engine.state, activeIndex: 0, turnPhase: 'actions' };
    expect(engine.playDev(a, 'knight')).toBe(true);
    expect(engine.state.largestArmy).toBe(b); // 3 vs 3 is not more
    engine.state = { ...engine.state, devPlayedThisTurn: false, turnPhase: 'actions' };
    expect(engine.playDev(a, 'knight')).toBe(true);
    expect(engine.state.largestArmy).toBe(a);
    expect(totalPoints(engine.state, a)).toBe(4);
  });

  test('Year of Plenty, Monopoly and Road Building', () => {
    const engine = track(engineWith());
    const [me, x, y] = engine.state.players.map((p) => p.id);
    const old = ['yearOfPlenty', 'monopoly', 'roadBuilding'].map((type, i) => ({ id: 200 + i, type, boughtTurn: -1 }));
    engine.state = { ...engine.state, activeIndex: 0, turnPhase: 'actions', devCards: { ...engine.state.devCards, [me]: old } };

    const before = engine.state.hands[me].ore;
    expect(engine.playDev(me, 'yearOfPlenty', { resources: ['ore'] })).toBe(false);
    expect(engine.playDev(me, 'yearOfPlenty', { resources: ['ore', 'ore'] })).toBe(true);
    expect(engine.state.hands[me].ore).toBe(before + 2);

    engine.state = { ...engine.state, devPlayedThisTurn: false };
    give(engine, x, { wool: 3 });
    give(engine, y, { wool: 2 });
    const mine = engine.state.hands[me].wool;
    const total = engine.state.hands[x].wool + engine.state.hands[y].wool;
    expect(engine.playDev(me, 'monopoly', { resource: 'wool' })).toBe(true);
    expect(engine.state.hands[me].wool).toBe(mine + total);
    expect(engine.state.hands[x].wool + engine.state.hands[y].wool).toBe(0);

    engine.state = { ...engine.state, devPlayedThisTurn: false };
    const roads = Object.keys(engine.state.roads).length;
    expect(engine.playDev(me, 'roadBuilding')).toBe(true);
    expect(engine.state.turnPhase).toBe('road-building');
    expect(engine.placeRoad(me, legalRoadSpots(engine.state, me)[0])).toBe(true);
    expect(engine.placeRoad(me, legalRoadSpots(engine.state, me)[0])).toBe(true);
    expect(Object.keys(engine.state.roads)).toHaveLength(roads + 2);
    expect(engine.state.turnPhase).toBe('actions');
    expect(conserved(engine.state)).toBe(true);
  });

  test('a victory point card that reaches 10 wins at once', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    // Two cities (4), Longest Road (2) and Largest Army (2) make 8.
    engine.state = {
      ...engine.state,
      longestRoad: { ...engine.state.longestRoad, holder: me },
      largestArmy: me,
      buildings: Object.fromEntries(
        Object.entries(engine.state.buildings).map(([v, b]) => [v, b.owner === me ? { ...b, type: 'city' } : b]),
      ),
    };
    expect(totalPoints(engine.state, me)).toBe(8);
    stackDeck(engine, ['victoryPoint', 'victoryPoint']);
    await rollTo(engine, [1, 1]);
    give(engine, me, { ore: 2, wool: 2, grain: 2 });
    expect(engine.buyDev(me)).toBe(true);
    expect(engine.state.gameOver).toBeNull();
    expect(engine.buyDev(me)).toBe(true);
    expect(engine.state.gameOver).toMatchObject({ reason: 'victory', winners: [me] });
    expect(engine.state.gameOver.standings[0]).toMatchObject({ id: me, points: 10, victoryCards: 2 });
  });

  test('10 points on someone else\'s turn only win on your own turn', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    const next = engine.state.players[(engine.state.activeIndex + 1) % 3].id;
    engine.state = {
      ...engine.state,
      longestRoad: { ...engine.state.longestRoad, holder: next },
      largestArmy: next,
      devCards: { ...engine.state.devCards, [next]: [1, 2].map((id) => ({ id, type: 'victoryPoint', boughtTurn: 0 })) },
      buildings: Object.fromEntries(
        Object.entries(engine.state.buildings).map(([v, b]) => [v, b.owner === next ? { ...b, type: 'city' } : b]),
      ),
    };
    expect(totalPoints(engine.state, next)).toBe(10);
    await rollTo(engine, [1, 1]);
    expect(engine.state.gameOver).toBeNull();
    expect(engine.endTurn(me)).toBe(true);
    expect(engine.state.gameOver).toMatchObject({ reason: 'victory', winners: [next] });
  });
});

describe('trading', () => {
  test('domestic trades: with the active player only, no gifts, no like for like', async () => {
    const engine = track(engineWith());
    const [me, x, y] = [0, 1, 2].map((i) => engine.state.players[(engine.state.activeIndex + i) % 3].id);
    give(engine, me, { brick: 2 });
    give(engine, x, { ore: 2 });
    give(engine, y, { wool: 2 });
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 }, to: x })).toBe(false); // before rolling
    await rollTo(engine, [1, 1]);

    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: {}, to: x })).toBe(false);
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { brick: 1 }, to: x })).toBe(false);
    expect(engine.proposeTrade(me, { give: { brick: 9 }, get: { ore: 1 }, to: x })).toBe(false);

    const meBrick = engine.state.hands[me].brick;
    const xOre = engine.state.hands[x].ore;
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 }, to: x })).toBe(true);
    const offer = engine.state.trades[0];
    expect(engine.respondTrade(y, offer.id, true)).toBe(false); // not addressed to y
    expect(engine.respondTrade(x, offer.id, true)).toBe(true);
    expect(engine.state.hands[me].brick).toBe(meBrick - 1);
    expect(engine.state.hands[x].ore).toBe(xOre - 1);
    expect(engine.state.hands[x].brick).toBeGreaterThan(0);

    // A player who is not active can only make an offer to the active player.
    expect(engine.proposeTrade(y, { give: { wool: 1 }, get: { ore: 1 }, to: x })).toBe(true);
    const counter = engine.state.trades[0];
    expect(counter.to).toBe(me);

    // An open offer to everyone: the offering player picks among acceptors.
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { wool: 1 } })).toBe(true);
    const open = engine.state.trades.find((t) => t.from === me);
    expect(engine.completeTrade(me, open.id, y)).toBe(false); // y has not accepted
    expect(engine.respondTrade(y, open.id, true)).toBe(true);
    expect(engine.completeTrade(me, open.id, y)).toBe(true);
    expect(conserved(engine.state)).toBe(true);

    // Offers end with the turn.
    expect(engine.endTurn(me)).toBe(true);
    expect(engine.state.trades).toHaveLength(0);
  });

  test('maritime trade at the player\'s best rate', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    await rollTo(engine, [1, 1]);
    give(engine, me, { grain: 4 });
    const rate = maritimeRates(engine.state, me).grain;
    const grain = engine.state.hands[me].grain;
    const ore = engine.state.hands[me].ore;
    expect(engine.maritime(me, 'grain', 'grain')).toBe(false);
    expect(engine.maritime(me, 'grain', 'ore')).toBe(true);
    expect(engine.state.hands[me].grain).toBe(grain - rate);
    expect(engine.state.hands[me].ore).toBe(ore + 1);
    engine.state = { ...engine.state, hands: { ...engine.state.hands, [me]: hand({ wool: 3 }) }, bank: { ...engine.state.bank, wool: engine.state.bank.wool + engine.state.hands[me].wool - 3 } };
    // Three wool buys nothing at 4:1, and does at a 3:1 or wool harbour.
    expect(engine.maritime(me, 'wool', 'ore')).toBe(maritimeRates(engine.state, me).wool <= 3);
  });
});

describe('audit regressions', () => {
  test('every change within one move reaches the table as a single update', async () => {
    const seen = [];
    const engine = track(engineWith());
    engine.onChange = (state) => seen.push(state);
    const me = active(engine);
    await rollTo(engine, [1, 1]);
    await Promise.resolve();
    seen.length = 0;
    give(engine, me, { brick: 1, lumber: 1 });
    expect(engine.placeRoad(me, legalRoadSpots(engine.state, me)[0])).toBe(true);
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(engine.state);
  });

  test('a malformed card choice is refused without throwing', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    engine.state = { ...engine.state, devCards: { ...engine.state.devCards, [me]: [{ id: 1, type: 'yearOfPlenty', boughtTurn: -1 }, { id: 2, type: 'monopoly', boughtTurn: -1 }] } };
    expect(engine.playDev(me, 'yearOfPlenty', { resources: 'ab' })).toBe(false);
    expect(engine.playDev(me, 'yearOfPlenty', { resources: {} })).toBe(false);
    expect(engine.playDev(me, 'monopoly', null)).toBe(false);
    expect(engine.state.devPlayedThisTurn).toBe(false);
  });

  test('a forced move held back by a computer move is dropped once the phase moves on', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    await rollTo(engine, [1, 1]);
    const key = engine.phaseKey();
    const moved = [];
    engine.autoMove = async (id) => moved.push(id);
    engine.stepping = true;
    engine.forceMoves([me], key);
    engine.stepping = false;
    expect(engine.endTurn(me)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(moved).toEqual([]);
  });

  test('an offer is withdrawn as soon as its maker can no longer pay', async () => {
    const engine = track(engineWith());
    const [me, x] = [0, 1].map((i) => engine.state.players[(engine.state.activeIndex + i) % 3].id);
    await rollTo(engine, [1, 1]);
    engine.state = { ...engine.state, hands: { ...engine.state.hands, [me]: hand({ brick: 1, lumber: 1, ore: 3 }) }, bank: { ...engine.state.bank } };
    engine.state.bank = Object.fromEntries(RESOURCES.map((r) => [r, BANK_SIZE - Object.values(engine.state.hands).reduce((sum, h) => sum + h[r], 0)]));
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 }, to: x })).toBe(true);
    // Spending the brick on a road withdraws the offer.
    expect(engine.placeRoad(me, legalRoadSpots(engine.state, me)[0])).toBe(true);
    expect(engine.state.trades).toHaveLength(0);
  });

  test('the trade and build clock is not restarted by a knight', async () => {
    const random = seeded(9);
    const engine = track(
      new GameEngine({
        players: seats(['human', 'human', 'human']),
        timing: { ...CALM, turn: 60000, robber: 60000 },
        options: { board: 'beginner' },
        rollDie: () => 1,
        pickIndex: (n) => Math.floor(random() * n),
        random,
      }),
    );
    engine.start();
    const me = active(engine);
    await engine.roll(me);
    const first = engine.state.phaseEndsAt;
    expect(first).toBeGreaterThan(Date.now());
    engine.state = { ...engine.state, devCards: { ...engine.state.devCards, [me]: [{ id: 9, type: 'knight', boughtTurn: -1 }] } };
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.playDev(me, 'knight')).toBe(true);
    const empty = engine.state.board.hexes.find(
      (hex) => hex.id !== engine.state.board.robber && GEOMETRY.hexes[hex.id].vertices.every((v) => !engine.state.buildings[v]),
    );
    expect(engine.moveRobber(me, empty.id)).toBe(true);
    expect(engine.state.turnPhase).toBe('actions');
    expect(engine.state.phaseEndsAt).toBe(first);
  });

  test('a game saved while people discard resumes in the discard phase', async () => {
    const engine = track(engineWith());
    const rich = engine.state.players.find((p) => p.id !== active(engine)).id;
    give(engine, rich, { ore: 6, wool: 3 });
    await rollTo(engine, [3, 4]);
    expect(engine.state.turnPhase).toBe('discard');
    const saved = JSON.parse(JSON.stringify(engine.state));
    const resumed = track(new GameEngine({ players: saved.players, timing: CALM, initialState: saved }));
    expect(resumed.state.turnPhase).toBe('discard');
    const owed = resumed.state.pendingDiscards[rich];
    expect(resumed.discard(rich, { ore: Math.min(6, owed), wool: Math.max(0, owed - 6) })).toBe(true);
    expect(resumed.state.turnPhase).toBe('robber');
  });

  test('computer opponents judge trades by visible points only', () => {
    const engine = track(engineWith({ kinds: ['human', 'bot', 'bot'] }));
    const [me, bot] = engine.state.players.map((p) => p.id);
    // Hidden victory point cards must not change the bot's answer.
    const trade = { id: 1, from: me, to: bot, give: { ore: 1 }, get: { wool: 1 }, responses: {} };
    const before = tradeValue(engine.state, bot, trade);
    engine.state = {
      ...engine.state,
      devCards: { ...engine.state.devCards, [me]: Array.from({ length: 5 }, (_, i) => ({ id: i, type: 'victoryPoint', boughtTurn: 0 })) },
    };
    const after = tradeValue(engine.state, bot, trade);
    expect(after).toEqual(before);
  });
});

describe('seats and endings', () => {
  test('ending by agreement goes to the most points', () => {
    const engine = track(engineWith({ kinds: ['human', 'bot', 'bot'] }));
    expect(engine.proposeEnd('p1')).toBe(true);
    expect(engine.state.gameOver.reason).toBe('agreed');
    expect(engine.state.gameOver.winners.length).toBeGreaterThan(0);
  });

  test('a saved game resumes where it was', async () => {
    const engine = track(engineWith());
    await rollTo(engine, [2, 3]);
    const saved = JSON.parse(JSON.stringify(engine.state));
    const resumed = track(new GameEngine({ players: saved.players, timing: CALM, initialState: saved }));
    expect(resumed.state.turnPhase).toBe('actions');
    expect(resumed.state.hands).toEqual(saved.hands);
    expect(resumed.endTurn(resumed.activePlayer.id)).toBe(true);
  });

  test('a person who drops out is played by the computer', async () => {
    const random = seeded(3);
    const engine = track(
      new GameEngine({
        players: seats(['human', 'human', 'human']),
        timing: { ...FAST },
        options: { board: 'beginner' },
        rollDie: () => 1 + Math.floor(random() * 6),
        pickIndex: (n) => Math.floor(random() * n),
        random,
      }),
    );
    engine.start();
    const id = engine.activePlayer.id;
    engine.setAway(id, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(engine.state.turnCount).toBeGreaterThan(1);
  });
});

// Whole games between computer opponents, with every state checked.
const playOut = (kinds, board, seed) =>
  new Promise((resolve, reject) => {
    const random = seeded(seed);
    const problems = [];
    let engine = null;
    const check = (state) => {
      if (!conserved(state)) problems.push(`resources not conserved on turn ${state.turnCount}`);
      Object.entries(state.hands).forEach(([id, h]) => RESOURCES.forEach((r) => h[r] < 0 && problems.push(`${id} has ${h[r]} ${r}`)));
      const held = Object.values(state.devCards).reduce((sum, cards) => sum + cards.length, 0);
      const knights = Object.values(state.knights).reduce((a, b) => a + b, 0);
      if (state.devDeck.length + held + knights > 25) problems.push('development cards appeared from nowhere');
      state.players.forEach((p) => {
        const left = PIECE_LIMITS;
        const built = Object.values(state.buildings).filter((b) => b.owner === p.id);
        if (built.filter((b) => b.type === 'settlement').length > left.settlement) problems.push('too many settlements');
        if (built.filter((b) => b.type === 'city').length > left.city) problems.push('too many cities');
        if (Object.values(state.roads).filter((o) => o === p.id).length > left.road) problems.push('too many roads');
        if (state.longestRoad.lengths[p.id] !== longestRoadLength(state, p.id)) problems.push('stale road length');
      });
    };
    engine = new GameEngine({
      players: seats(kinds),
      timing: FAST,
      options: { board },
      rollDie: () => 1 + Math.floor(random() * 6),
      pickIndex: (n) => Math.floor(random() * n),
      random,
      onChange: (state) => {
        check(state);
        if (state.gameOver) {
          clearTimeout(guard);
          engine.destroy();
          resolve({ state, problems });
        }
      },
    });
    const guard = setTimeout(() => {
      engine.destroy();
      reject(new Error(`no winner by turn ${engine.state.turnCount}`));
    }, 30000);
    engine.start();
  });

describe('rules audit: full computer games', () => {
  const cases = [];
  ['beginner', 'random'].forEach((board) =>
    [3, 4].forEach((size) => [11, 23, 37].forEach((seed) => cases.push([board, size, seed]))),
  );

  test.each(cases)('%s board, %i players, seed %i', async (board, size, seed) => {
    const { state, problems } = await playOut(Array(size).fill('bot'), board, seed);
    expect(problems).toEqual([]);
    const [winner] = state.gameOver.winners;
    expect(state.gameOver.reason).toBe('victory');
    expect(totalPoints(state, winner)).toBeGreaterThanOrEqual(10);
    // The winner won on their own turn.
    expect(state.players[state.activeIndex].id).toBe(winner);
    expect(computeStandings(state)[0].id).toBe(winner);
  }, 40000);
});

describe('premium AI seats', () => {
  // A stand-in for Claude that records every question and follows the plan
  // it is given: every option in order, ending the turn last.
  const fakeClaude = (log) => async ({ kind, playerId, state, options }) => {
    log.push({ kind, playerId, turn: state.turnCount, options });
    const plan = options.map((_, index) => index);
    return { plan, choice: 0, comment: '', usage: { calls: log.length, input: 100, output: 10, cached: 600 } };
  };

  const aiGame = (log, { board = 'random', seed = 5 } = {}) =>
    new Promise((resolve, reject) => {
      const random = seeded(seed);
      let engine = null;
      const advisor = fakeClaude(log);
      engine = new GameEngine({
        players: seats(['ai', 'bot', 'bot']),
        timing: FAST,
        options: { board },
        advisor,
        rollDie: () => 1 + Math.floor(random() * 6),
        pickIndex: (n) => Math.floor(random() * n),
        random,
        onChange: (state) => {
          if (state.gameOver) {
            clearTimeout(guard);
            engine.destroy();
            resolve(state);
          }
        },
      });
      const guard = setTimeout(() => {
        engine.destroy();
        reject(new Error('no winner'));
      }, 30000);
      engine.start();
    });

  test('asks Claude at most once per turn, plus set-up and close calls, within budget', async () => {
    const log = [];
    const state = await aiGame(log);
    const turnCalls = log.filter((entry) => entry.kind === 'turn');
    const perTurn = {};
    turnCalls.forEach((entry) => {
      perTurn[entry.turn] = (perTurn[entry.turn] || 0) + 1;
    });
    expect(Math.max(0, ...Object.values(perTurn))).toBeLessThanOrEqual(1);
    expect(log.filter((entry) => entry.kind === 'setup')).toHaveLength(2);
    expect(log.every((entry) => entry.playerId === 'p1')).toBe(true);
    expect(log.length).toBeLessThanOrEqual(AI_CALL_BUDGET);
    // Every turn plan offers a way to end the turn, and only real choices are asked.
    turnCalls.forEach((entry) => {
      expect(entry.options[entry.options.length - 1]).toBe('End the turn');
      expect(entry.options.length).toBeGreaterThanOrEqual(3);
    });
    expect(state.aiUsage.p1.calls).toBe(log.length);
    expect(state.gameOver.reason).toBe('victory');
  }, 40000);

  test('after the budget the computer strategy plays the seat', async () => {
    const log = [];
    const engine = track(engineWith({ kinds: ['ai', 'human', 'human'] }));
    engine.advisor = fakeClaude(log);
    engine.state = { ...engine.state, aiUsage: { p1: { calls: AI_CALL_BUDGET, tokens: 0 } } };
    const plan = await engine.consult('p1', 'turn', [{ label: 'a' }, { label: 'b' }]);
    expect(plan).toBeNull();
    expect(log).toHaveLength(0);
  });

  test('a failing Claude falls back without stalling', async () => {
    const engine = track(engineWith({ kinds: ['ai', 'human', 'human'] }));
    engine.advisor = async () => {
      throw new Error('offline');
    };
    expect(await engine.choose('p1', 'setup', [{ label: 'a' }, { label: 'b' }])).toBe(0);
    expect(engine.state.thinking).toBeNull();
  });
});

describe('round 2 rules', () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Active player first, then the others in seat order.
  const table = (engine) => [0, 1, 2].map((i) => engine.state.players[(engine.state.activeIndex + i) % 3].id);

  test('only a Knight may be played before the roll', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    const old = ['yearOfPlenty', 'monopoly', 'roadBuilding', 'knight'].map((type, i) => ({ id: 300 + i, type, boughtTurn: -1 }));
    engine.state = { ...engine.state, devCards: { ...engine.state.devCards, [me]: old } };
    expect(engine.state.turnPhase).toBe('pre-roll');
    expect(engine.playDev(me, 'yearOfPlenty', { resources: ['ore', 'ore'] })).toBe(false);
    expect(engine.playDev(me, 'monopoly', { resource: 'wool' })).toBe(false);
    expect(engine.playDev(me, 'roadBuilding')).toBe(false);
    expect(engine.state.devPlayedThisTurn).toBe(false);
    expect(engine.playDev(me, 'knight')).toBe(true);
  });

  test('a single yes to an open offer trades without asking the offering player again', async () => {
    const engine = track(engineWith());
    engine.timing = { ...engine.timing, acceptWindow: 30 };
    const [me, x] = table(engine);
    await rollTo(engine, [1, 1]);
    give(engine, me, { brick: 1 });
    give(engine, x, { ore: 1 });
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 } })).toBe(true);
    const offer = engine.state.trades[0];
    expect(engine.respondTrade(x, offer.id, true)).toBe(true);
    expect(engine.state.trades[0].closesAt).toBeGreaterThan(0);
    await wait(60);
    expect(engine.state.trades).toHaveLength(0);
    expect(engine.state.events.at(-1)).toMatchObject({ type: 'trade', actor: me, partner: x });
    expect(conserved(engine.state)).toBe(true);
  });

  test('once everyone has answered, a single yes trades at once', async () => {
    const engine = track(engineWith());
    const [me, x, y] = table(engine);
    await rollTo(engine, [1, 1]);
    give(engine, me, { brick: 1 });
    give(engine, x, { ore: 1 });
    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 } })).toBe(true);
    const offer = engine.state.trades[0];
    expect(engine.respondTrade(y, offer.id, false)).toBe(true);
    expect(engine.respondTrade(x, offer.id, true)).toBe(true);
    expect(engine.state.trades).toHaveLength(0);
  });

  test('several yeses: the offering player picks, or the first taker gets it in time', async () => {
    const engine = track(engineWith());
    engine.timing = { ...engine.timing, tradeWait: 40 };
    const [me, x, y] = table(engine);
    await rollTo(engine, [1, 1]);
    give(engine, me, { brick: 2 });
    give(engine, x, { ore: 2 });
    give(engine, y, { ore: 2 });

    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 } })).toBe(true);
    let offer = engine.state.trades[0];
    engine.respondTrade(x, offer.id, true);
    engine.respondTrade(y, offer.id, true);
    expect(engine.state.trades[0]).toMatchObject({ choosing: true, accepted: [x, y] });
    const yOre = engine.state.hands[y].ore;
    expect(engine.completeTrade(me, offer.id, y)).toBe(true);
    expect(engine.state.hands[y].ore).toBe(yOre - 1);

    expect(engine.proposeTrade(me, { give: { brick: 1 }, get: { ore: 1 } })).toBe(true);
    offer = engine.state.trades[0];
    engine.respondTrade(y, offer.id, true);
    engine.respondTrade(x, offer.id, true);
    const xOre = engine.state.hands[x].ore;
    const yOreNow = engine.state.hands[y].ore;
    await wait(80);
    expect(engine.state.trades).toHaveLength(0);
    // y said yes first.
    expect(engine.state.hands[y].ore).toBe(yOreNow - 1);
    expect(engine.state.hands[x].ore).toBe(xOre);
  });

  test('Monopoly records who gave how much, steals show only to the two players', async () => {
    const engine = track(engineWith());
    const [me, x, y] = table(engine);
    await rollTo(engine, [1, 1]);
    engine.state = { ...engine.state, devCards: { ...engine.state.devCards, [me]: [{ id: 400, type: 'monopoly', boughtTurn: -1 }] } };
    give(engine, x, { wool: 3 });
    const yWool = engine.state.hands[y].wool;
    const xWool = engine.state.hands[x].wool;
    expect(engine.playDev(me, 'monopoly', { resource: 'wool' })).toBe(true);
    const event = engine.state.events.at(-1);
    expect(event).toMatchObject({ type: 'monopoly', actor: me, resource: 'wool', total: xWool + yWool });
    expect(event.from[x]).toBe(xWool);
    expect(engine.state.log.at(-1).text).toContain(`${xWool} from`);

    const steal = { id: 999, type: 'steal', turn: 1, actor: me, victim: x, resource: 'ore' };
    const state = { ...engine.state, events: [...engine.state.events, steal] };
    expect(redactFor(state, me).events.at(-1).resource).toBe('ore');
    expect(redactFor(state, x).events.at(-1).resource).toBe('ore');
    expect(redactFor(state, y).events.at(-1).resource).toBeNull();
  });

  test('every move leaves an event, numbered in order', async () => {
    const engine = track(engineWith());
    const me = active(engine);
    await rollTo(engine, [3, 3]);
    give(engine, me, { brick: 1, lumber: 1 });
    engine.placeRoad(me, legalRoadSpots(engine.state, me)[0]);
    const types = engine.state.events.map((event) => event.type);
    expect(types).toContain('roll');
    expect(types.at(-1)).toBe('build');
    const ids = engine.state.events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe('table settings in play', () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const timed = (options, timing = {}) => {
    const random = seeded(5);
    return track(
      new GameEngine({
        players: seats(['human', 'human', 'human']),
        timing: { ...CALM, ...timing },
        options: { board: 'beginner', ...options },
        rollDie: () => 1 + Math.floor(random() * 6),
        pickIndex: (n) => Math.floor(random() * n),
        random,
      }),
    );
  };

  test('with the turn timer, the dice roll themselves and an idle turn passes on', async () => {
    // 15 seconds scaled down to 45 ms.
    const engine = timed({ turnSeconds: 15 }, { clockScale: 0.003 });
    engine.rollDie = () => 2; // a 4, never the robber
    const first = active(engine);
    engine.start();
    expect(engine.state.phaseLength).toBe(45);
    await wait(80);
    expect(engine.state.dice).not.toBeNull();
    const turn = engine.state.turnCount;
    await wait(120);
    expect(engine.state.turnCount).toBeGreaterThan(turn);
    expect(engine.state.log.some((entry) => entry.text === `${first.toUpperCase()}'s time ran out, the turn passes on`)).toBe(true);
  });

  test('every move starts the move clock again', async () => {
    const engine = timed({ turnSeconds: 15 }, { clockScale: 0.004 }); // 60 ms per move
    const me = active(engine);
    await rollTo(engine, [3, 3]);
    if (engine.state.turnPhase !== 'actions') return;
    await wait(40);
    give(engine, me, { brick: 1, lumber: 1 });
    expect(engine.placeRoad(me, legalRoadSpots(engine.state, me)[0])).toBe(true);
    await wait(40); // 80 ms into the turn, 40 ms after the move
    expect(active(engine)).toBe(me);
    await wait(120);
    expect(active(engine)).not.toBe(me);
  });

  test('without a timer, people roll when they like', async () => {
    const engine = timed({});
    engine.start();
    await wait(20);
    expect(engine.state.phaseEndsAt).toBeNull();
    expect(engine.state.dice).toBeNull();
  });

  test('the discard limit and the points to win follow the table', async () => {
    const engine = timed({ handLimit: 9, victoryPoints: 8 });
    const [me, x] = [0, 1].map((i) => engine.state.players[(engine.state.activeIndex + i) % 3].id);
    give(engine, x, { ore: 9 - handSize(engine.state.hands[x]) });
    expect(handSize(engine.state.hands[x])).toBe(9);
    await rollTo(engine, [3, 4]);
    expect(engine.state.pendingDiscards[x]).toBeUndefined();

    const other = timed({ victoryPoints: 8 });
    const who = active(other);
    other.state = {
      ...other.state,
      longestRoad: { ...other.state.longestRoad, holder: who },
      largestArmy: who,
      buildings: Object.fromEntries(Object.entries(other.state.buildings).map(([v, b]) => [v, b.owner === who ? { ...b, type: 'city' } : b])),
    };
    expect(totalPoints(other.state, who)).toBe(8);
    await rollTo(other, [1, 1]);
    expect(other.state.gameOver).toMatchObject({ reason: 'victory', winners: [who] });
    expect(me).toBeDefined();
  });

  test('a fresh game carries its island fingerprint and its rules', () => {
    const engine = timed({ board: 'random', turnSeconds: 30, redsMayTouch: true });
    expect(engine.state.boardId).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(engine.state.options).toMatchObject({ board: 'random', turnSeconds: 30, redsMayTouch: true, handLimit: 7 });
  });
});
