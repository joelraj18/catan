import { GEOMETRY, HARBORS } from './catanBoard';
import { createInitialState } from './catanEngine';
import {
  COSTS,
  cleanBundle,
  DEV_DECK,
  canBuildCity,
  canPlaceRoad,
  canPlaceSettlement,
  discardCount,
  hiddenPoints,
  largestArmyHolder,
  legalSettlementSpots,
  longestRoadHolder,
  longestRoadLength,
  maritimeRates,
  piecesLeft,
  productionFor,
  publicPoints,
  redactFor,
  robberVictims,
  settleProduction,
  totalPoints,
  tradeShapeProblem,
} from './catanRules';

const players = ['red', 'blue', 'white'].map((pieceKey, index) => ({
  id: `p${index + 1}`,
  name: `Player ${index + 1}`,
  pieceKey,
  kind: 'human',
}));

const fresh = (patch = {}) => ({ ...createInitialState(players, { board: 'beginner', pickIndex: () => 0 }), ...patch });

const edgeBetween = (a, b) => GEOMETRY.edges.find((edge) => edge.vertices.includes(a) && edge.vertices.includes(b)).id;

// A simple path of `length` roads starting at an inland intersection,
// never revisiting an intersection. Returns the edges and the vertices.
const pathFrom = (start, length) => {
  const vertices = [start];
  const edges = [];
  while (edges.length < length) {
    const here = vertices[vertices.length - 1];
    const next = GEOMETRY.vertices[here].neighbours
      .filter((v) => !vertices.includes(v))
      .sort((a, b) => GEOMETRY.vertices[b].hexes.length - GEOMETRY.vertices[a].hexes.length || a - b)[0];
    edges.push(edgeBetween(here, next));
    vertices.push(next);
  }
  return { edges, vertices };
};

const inland = GEOMETRY.vertices.find((vertex) => vertex.hexes.length === 3 && vertex.hexes.includes(9)).id;
const roadsOf = (edges, owner) => Object.fromEntries(edges.map((edge) => [edge, owner]));

describe('placement rules', () => {
  test('Distance Rule: no settlement next to any other settlement or city', () => {
    const state = fresh({ buildings: { [inland]: { owner: 'p2', type: 'settlement' } } });
    GEOMETRY.vertices[inland].neighbours.forEach((neighbour) => {
      expect(canPlaceSettlement(state, 'p1', neighbour, { setup: true })).toBe(false);
    });
    expect(canPlaceSettlement(state, 'p1', inland, { setup: true })).toBe(false);
    const legal = legalSettlementSpots(state, 'p1', { setup: true });
    expect(legal).toHaveLength(54 - 1 - GEOMETRY.vertices[inland].neighbours.length);
  });

  test('after set-up a settlement needs one of your own roads', () => {
    const { edges, vertices } = pathFrom(inland, 2);
    const state = fresh({
      buildings: { [inland]: { owner: 'p1', type: 'settlement' } },
      roads: roadsOf(edges, 'p1'),
    });
    expect(canPlaceSettlement(state, 'p1', vertices[2])).toBe(true);
    expect(canPlaceSettlement(state, 'p2', vertices[2])).toBe(false);
    // Two steps away but not on a road of p1.
    const offRoad = GEOMETRY.vertices.find(
      (vertex) =>
        !vertices.includes(vertex.id) &&
        !vertex.neighbours.includes(inland) &&
        vertex.id !== inland &&
        !vertex.edges.some((edge) => state.roads[edge]),
    ).id;
    expect(canPlaceSettlement(state, 'p1', offRoad)).toBe(false);
  });

  test('a road continues your own network and never runs through an opponent', () => {
    const { edges, vertices } = pathFrom(inland, 3);
    const state = fresh({
      buildings: { [inland]: { owner: 'p1', type: 'settlement' }, [vertices[2]]: { owner: 'p2', type: 'settlement' } },
      roads: roadsOf(edges.slice(0, 2), 'p1'),
    });
    // The third path starts at the opponent's settlement, so it is blocked.
    expect(canPlaceRoad(state, 'p1', edges[2])).toBe(false);
    // A path from the settlement is fine, an occupied path is not.
    const free = GEOMETRY.vertices[inland].edges.find((edge) => !state.roads[edge]);
    expect(canPlaceRoad(state, 'p1', free)).toBe(true);
    expect(canPlaceRoad(state, 'p1', edges[0])).toBe(false);
    // Somebody else cannot build there without a connection.
    expect(canPlaceRoad(state, 'p3', free)).toBe(false);
  });

  test('the set-up road must touch the settlement just placed', () => {
    const state = fresh({ buildings: { [inland]: { owner: 'p1', type: 'settlement' } } });
    const touching = GEOMETRY.vertices[inland].edges[0];
    const elsewhere = GEOMETRY.edges.find((edge) => !edge.vertices.includes(inland)).id;
    expect(canPlaceRoad(state, 'p1', touching, { fromVertex: inland })).toBe(true);
    expect(canPlaceRoad(state, 'p1', elsewhere, { fromVertex: inland })).toBe(false);
  });

  test('cities only replace your own settlements', () => {
    const state = fresh({
      buildings: { [inland]: { owner: 'p1', type: 'settlement' }, 0: { owner: 'p2', type: 'settlement' } },
    });
    expect(canBuildCity(state, 'p1', inland)).toBe(true);
    expect(canBuildCity(state, 'p1', 0)).toBe(false);
    expect(canBuildCity(state, 'p1', 5)).toBe(false);
    const upgraded = fresh({ buildings: { [inland]: { owner: 'p1', type: 'city' } } });
    expect(canBuildCity(upgraded, 'p1', inland)).toBe(false);
  });

  test('pieces are limited to 15 roads, 5 settlements and 4 cities', () => {
    const spots = [0, 2, 4, 6, 8];
    const many = fresh({
      buildings: Object.fromEntries(spots.map((v) => [v, { owner: 'p1', type: 'settlement' }])),
    });
    expect(piecesLeft(many, 'p1').settlement).toBe(0);
    expect(canPlaceSettlement(many, 'p1', 40, { setup: true })).toBe(false);
    expect(piecesLeft(fresh(), 'p1')).toEqual({ road: 15, settlement: 5, city: 4 });
  });

  test('building costs match the building costs card', () => {
    expect(COSTS).toEqual({
      road: { brick: 1, lumber: 1 },
      settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
      city: { ore: 3, grain: 2 },
      dev: { ore: 1, wool: 1, grain: 1 },
    });
    expect(Object.values(DEV_DECK).reduce((a, b) => a + b, 0)).toBe(25);
    expect(DEV_DECK).toEqual({ knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 });
  });
});

describe('production', () => {
  // Hex 4 is the hills 6 on the beginners' map.
  const hills6 = 4;
  const [a, , c] = GEOMETRY.hexes[hills6].vertices;

  test('settlements collect 1 card and cities 2', () => {
    const state = fresh({
      buildings: { [a]: { owner: 'p1', type: 'settlement' }, [c]: { owner: 'p2', type: 'city' } },
    });
    const owed = productionFor(state, 6);
    expect(owed.p1.brick).toBe(1);
    expect(owed.p2.brick).toBe(2);
  });

  test('the robber blocks its hex', () => {
    const state = fresh({ buildings: { [a]: { owner: 'p1', type: 'settlement' } } });
    state.board = { ...state.board, robber: hills6 };
    expect(productionFor(state, 6).p1?.brick || 0).toBe(0);
  });

  test('a short bank pays nobody, unless only one player is owed', () => {
    const owed = { p1: { brick: 1, lumber: 0, ore: 0, grain: 0, wool: 0 }, p2: { brick: 2, lumber: 0, ore: 0, grain: 0, wool: 0 } };
    const bank = { brick: 2, lumber: 19, ore: 19, grain: 19, wool: 19 };
    expect(settleProduction(owed, bank).paid).toEqual({});

    const single = { p1: { brick: 2, lumber: 1, ore: 0, grain: 0, wool: 0 } };
    const { paid } = settleProduction(single, { ...bank, brick: 1 });
    expect(paid.p1.brick).toBe(1);
    // Other resources are not affected.
    expect(paid.p1.lumber).toBe(1);
  });

  test('a 7 means discarding half, rounded down, only above 7 cards', () => {
    const hand = (n) => ({ brick: n, lumber: 0, ore: 0, grain: 0, wool: 0 });
    expect(discardCount(hand(7))).toBe(0);
    expect(discardCount(hand(8))).toBe(4);
    expect(discardCount(hand(9))).toBe(4);
    expect(discardCount(hand(13))).toBe(6);
  });

  test('the robber steals only from other players next to the hex who hold cards', () => {
    const state = fresh({
      buildings: {
        [a]: { owner: 'p1', type: 'settlement' },
        [c]: { owner: 'p2', type: 'settlement' },
        [GEOMETRY.hexes[hills6].vertices[4]]: { owner: 'p3', type: 'settlement' },
      },
    });
    state.hands = { ...state.hands, p2: { ...state.hands.p2, ore: 1 } };
    expect(robberVictims(state, hills6, 'p1')).toEqual(['p2']);
  });
});

describe('trade', () => {
  test('maritime trade is 4:1, 3:1 at a generic harbour and 2:1 at a special one', () => {
    const state = fresh();
    expect(maritimeRates(state, 'p1')).toEqual({ brick: 4, lumber: 4, ore: 4, grain: 4, wool: 4 });

    const generic = state.board.harbors.find((harbor) => harbor.type === 'any');
    const withGeneric = { ...state, buildings: { [generic.vertices[0]]: { owner: 'p1', type: 'settlement' } } };
    expect(maritimeRates(withGeneric, 'p1')).toEqual({ brick: 3, lumber: 3, ore: 3, grain: 3, wool: 3 });

    const ore = state.board.harbors.find((harbor) => harbor.type === 'ore');
    const withOre = { ...state, buildings: { [ore.vertices[1]]: { owner: 'p1', type: 'city' } } };
    expect(maritimeRates(withOre, 'p1')).toEqual({ brick: 4, lumber: 4, ore: 2, grain: 4, wool: 4 });
    expect(HARBORS).toHaveLength(9);
  });

  test('no gifts and no trading a resource for itself', () => {
    expect(tradeShapeProblem({ brick: 1 }, {})).toMatch(/both sides/i);
    expect(tradeShapeProblem({}, { ore: 2 })).toMatch(/both sides/i);
    expect(tradeShapeProblem({ wool: 2 }, { wool: 1 })).toMatch(/same resource/i);
    expect(tradeShapeProblem({ wool: 2, ore: 1 }, { brick: 1 })).toBeNull();
  });
});

describe('Longest Road and Largest Army', () => {
  test('counts the longest single branch, not forks', () => {
    const { edges, vertices } = pathFrom(inland, 5);
    const fork = GEOMETRY.vertices[vertices[2]].edges.find((edge) => !edges.includes(edge));
    const state = fresh({ roads: roadsOf([...edges, fork], 'p1') });
    expect(longestRoadLength(state, 'p1')).toBe(5);
    expect(longestRoadLength(state, 'p2')).toBe(0);
  });

  test("an opponent's settlement breaks the road", () => {
    const { edges, vertices } = pathFrom(inland, 6);
    const whole = fresh({ roads: roadsOf(edges, 'p1') });
    expect(longestRoadLength(whole, 'p1')).toBe(6);
    const broken = { ...whole, buildings: { [vertices[2]]: { owner: 'p2', type: 'settlement' } } };
    expect(longestRoadLength(broken, 'p1')).toBe(4);
    // The player's own settlement does not break it.
    const own = { ...whole, buildings: { [vertices[2]]: { owner: 'p1', type: 'settlement' } } };
    expect(longestRoadLength(own, 'p1')).toBe(6);
  });

  test('the Longest Road card follows the Almanac', () => {
    expect(longestRoadHolder({ p1: 4, p2: 3 }, null)).toBeNull(); // nobody at 5
    expect(longestRoadHolder({ p1: 5, p2: 3 }, null)).toBe('p1');
    expect(longestRoadHolder({ p1: 5, p2: 5 }, 'p1')).toBe('p1'); // a tie does not take it
    expect(longestRoadHolder({ p1: 5, p2: 6 }, 'p1')).toBe('p2'); // strictly longer does
    expect(longestRoadHolder({ p1: 6, p2: 6, p3: 2 }, 'p3')).toBeNull(); // broken holder, tie: set aside
    expect(longestRoadHolder({ p1: 7, p2: 6, p3: 2 }, 'p3')).toBe('p1');
    expect(longestRoadHolder({ p1: 4, p2: 4 }, 'p1')).toBeNull(); // below 5 it is set aside
  });

  test('Largest Army needs 3 knights and strictly more to take it', () => {
    expect(largestArmyHolder({ p1: 2, p2: 0 }, null)).toBeNull();
    expect(largestArmyHolder({ p1: 3, p2: 0 }, null)).toBe('p1');
    expect(largestArmyHolder({ p1: 3, p2: 3 }, 'p1')).toBe('p1');
    expect(largestArmyHolder({ p1: 3, p2: 4 }, 'p1')).toBe('p2');
  });
});

describe('victory points and privacy', () => {
  test('settlement 1, city 2, special cards 2, VP cards hidden from others', () => {
    const state = fresh({
      buildings: { 0: { owner: 'p1', type: 'settlement' }, 10: { owner: 'p1', type: 'city' } },
      longestRoad: { holder: 'p1', lengths: { p1: 5, p2: 0, p3: 0 } },
      largestArmy: 'p1',
    });
    state.devCards = { ...state.devCards, p1: [{ id: 1, type: 'victoryPoint', boughtTurn: 1 }] };
    expect(publicPoints(state, 'p1')).toBe(7);
    expect(hiddenPoints(state, 'p1')).toBe(1);
    expect(totalPoints(state, 'p1')).toBe(8);
  });

  test('each seat only sees its own hand, development cards and steals', () => {
    const state = fresh();
    state.hands = { ...state.hands, p1: { brick: 2, lumber: 0, ore: 1, grain: 0, wool: 0 }, p2: { brick: 0, lumber: 3, ore: 0, grain: 0, wool: 0 } };
    state.devCards = { ...state.devCards, p2: [{ id: 4, type: 'knight', boughtTurn: 1 }] };
    state.lastSteal = { id: 1, thief: 'p2', victim: 'p3', resource: 'ore' };

    const view = redactFor(state, 'p1');
    expect(view.hands.p1).toEqual(state.hands.p1);
    expect(view.hands.p2).toEqual({ hidden: 3 });
    expect(view.devCards.p2).toEqual([{ hidden: true }]);
    expect(view.devDeck).toBe(25);
    expect(view.lastSteal.resource).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/"type":"(knight|victoryPoint)"/);

    expect(redactFor(state, 'p3').lastSteal.resource).toBe('ore');
  });

  test('each seat sees only its own Player ID, and the same seat list each time', () => {
    const state = fresh();
    state.players = state.players.map((player, index) => ({ ...player, code: `CODE${index}` }));
    const view = redactFor(state, 'p2');
    expect(view.players.map((player) => player.code)).toEqual([null, 'CODE1', null]);
    expect(redactFor({ ...state, turnCount: 9 }, 'p2').players).toBe(view.players);
  });

  test('trade bundles refuse counts no bank could hold', () => {
    expect(cleanBundle({ ore: Infinity, wool: '1e309', grain: 2, brick: -1, gold: 3 })).toEqual({ grain: 2 });
  });
});
