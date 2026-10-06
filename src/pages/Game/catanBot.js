// Computer opponents. Every function looks at the state and returns a
// decision; the engine checks and applies it exactly like a person's move.
// Bots never peek at hidden cards except their own (opponents count only by
// hand size and public points).

import { GEOMETRY, PIPS, RESOURCES, TERRAINS } from './catanBoard';
import { handLimitOf, victoryPointsOf } from './gameSettings';
import {
  COSTS,
  canBuildCity,
  canPlaceRoad,
  canPlaceSettlement,
  discardCount,
  handSize,
  hasResources,
  legalCitySpots,
  legalRoadSpots,
  legalSettlementSpots,
  maritimeRates,
  piecesLeft,
  publicPoints,
  robberVictims,
  vertexScore,
} from './catanRules';

const EARLY_WEIGHTS = { brick: 1.25, lumber: 1.25, ore: 0.9, grain: 1, wool: 0.9 };
const LATE_WEIGHTS = { brick: 0.9, lumber: 0.9, ore: 1.25, grain: 1.2, wool: 0.9 };

const handOf = (state, id) => state.hands[id];

// What the player already produces, as pips per resource.
export const productionProfile = (state, playerId) => {
  const profile = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
  Object.entries(state.buildings).forEach(([vertexId, building]) => {
    if (building.owner !== playerId) return;
    GEOMETRY.vertices[vertexId].hexes.forEach((hexId) => {
      const hex = state.board.hexes[hexId];
      const resource = TERRAINS[hex.terrain].resource;
      if (resource && hex.number) profile[resource] += PIPS[hex.number] * (building.type === 'city' ? 2 : 1);
    });
  });
  return profile;
};

// Settling score that favours resources the player does not make yet.
const settleScore = (state, playerId, vertexId) => {
  const profile = productionProfile(state, playerId);
  const builtCount = Object.values(state.buildings).filter((b) => b.owner === playerId).length;
  const base = builtCount < 4 ? EARLY_WEIGHTS : LATE_WEIGHTS;
  const weights = {};
  RESOURCES.forEach((resource) => {
    weights[resource] = base[resource] * (profile[resource] === 0 ? 1.35 : 1);
  });
  return vertexScore(state, vertexId, weights);
};

const best = (items, score) => {
  let top = null;
  let topScore = -Infinity;
  items.forEach((item) => {
    const value = score(item);
    if (value > topScore) {
      top = item;
      topScore = value;
    }
  });
  return top;
};

// ---------------------------------------------------------------- set-up

export const rankSetupSettlements = (state, playerId) =>
  legalSettlementSpots(state, playerId, { setup: true })
    .map((vertexId) => ({ vertexId, score: settleScore(state, playerId, vertexId) }))
    .sort((a, b) => b.score - a.score);

export const chooseSetupSettlement = (state, playerId) => rankSetupSettlements(state, playerId)[0]?.vertexId ?? null;

// The set-up road points at the best open intersection two steps away.
export const chooseSetupRoad = (state, playerId, fromVertex) => {
  const options = legalRoadSpots(state, playerId, { fromVertex });
  return best(options, (edgeId) => {
    const [a, b] = GEOMETRY.edges[edgeId].vertices;
    const far = a === fromVertex ? b : a;
    const next = GEOMETRY.vertices[far].neighbours.filter((v) => v !== fromVertex);
    const reach = next.map((v) => (canPlaceSettlement(state, playerId, v, { setup: true }) ? vertexScore(state, v) : 0));
    return Math.max(0, ...reach) + GEOMETRY.vertices[far].hexes.length * 0.3;
  });
};

// -------------------------------------------------------------- robber

const leaderFactor = (state, id) => 1 + publicPoints(state, id) / 4;

export const rankRobberHexes = (state, playerId) =>
  state.board.hexes
    .filter((hex) => hex.id !== state.board.robber)
    .map((hex) => {
      let score = 0;
      let mine = false;
      GEOMETRY.hexes[hex.id].vertices.forEach((vertexId) => {
        const building = state.buildings[vertexId];
        if (!building) return;
        if (building.owner === playerId) {
          mine = true;
          return;
        }
        const weight = building.type === 'city' ? 2 : 1;
        score += weight * (PIPS[hex.number] || 0) * leaderFactor(state, building.owner);
      });
      if (robberVictims(state, hex.id, playerId).length) score += 2;
      if (mine) score -= 40;
      return { hexId: hex.id, score };
    })
    .sort((a, b) => b.score - a.score);

export const chooseRobberHex = (state, playerId) => rankRobberHexes(state, playerId)[0].hexId;

export const chooseVictim = (state, playerId, victims) =>
  best(victims, (id) => publicPoints(state, id) * 3 + handSize(handOf(state, id)));

// ----------------------------------------------------------------- goals

// The next thing worth building, with where to build it.
export const chooseGoal = (state, playerId) => {
  const left = piecesLeft(state, playerId);
  const cities = left.city > 0 ? legalCitySpots(state, playerId) : [];
  if (cities.length) {
    const vertexId = best(cities, (v) => vertexScore(state, v));
    return { type: 'city', cost: COSTS.city, vertexId };
  }

  const spots = left.settlement > 0 ? legalSettlementSpots(state, playerId) : [];
  if (spots.length) {
    const vertexId = best(spots, (v) => settleScore(state, playerId, v));
    return { type: 'settlement', cost: COSTS.settlement, vertexId };
  }

  const roadEdge = left.road > 0 && left.settlement > 0 ? roadTowardSite(state, playerId) : null;
  if (roadEdge !== null) return { type: 'road', cost: COSTS.road, edgeId: roadEdge };

  if ((typeof state.devDeck === 'number' ? state.devDeck : state.devDeck?.length) > 0) {
    return { type: 'dev', cost: COSTS.dev };
  }

  if (left.road > 0) {
    const edges = legalRoadSpots(state, playerId);
    if (edges.length) return { type: 'road', cost: COSTS.road, edgeId: edges[0] };
  }

  return null;
};

// First road of the shortest path (up to 3 roads) to the best open site.
export const roadTowardSite = (state, playerId) => {
  const starts = legalRoadSpots(state, playerId);
  if (!starts.length) return null;

  let bestEdge = null;
  let bestValue = -Infinity;

  starts.forEach((edgeId) => {
    // Pretend the road is built and look for sites within two more roads.
    const queue = [{ roads: { ...state.roads, [edgeId]: playerId }, depth: 1, edgeId }];
    const seen = new Set();

    while (queue.length) {
      const { roads, depth } = queue.shift();
      const trial = { ...state, roads };
      const sites = legalSettlementSpots(trial, playerId);

      for (const vertexId of sites) {
        const value = settleScore(state, playerId, vertexId) - depth * 1.5;
        if (value > bestValue) {
          bestValue = value;
          bestEdge = edgeId;
        }
      }

      if (depth >= 3 || sites.length) continue;
      legalRoadSpots(trial, playerId).forEach((next) => {
        const key = `${depth}:${next}`;
        if (seen.has(key)) return;
        seen.add(key);
        queue.push({ roads: { ...roads, [next]: playerId }, depth: depth + 1 });
      });
    }
  });

  return bestEdge;
};

export const missingFor = (hand, cost) => {
  const missing = {};
  Object.entries(cost).forEach(([resource, count]) => {
    const short = count - (hand[resource] || 0);
    if (short > 0) missing[resource] = short;
  });
  return missing;
};

// ----------------------------------------------------------- the turn

// The next move a bot makes in its trade/build phase, or null to end the
// turn. Called repeatedly until it returns null.
export const nextAction = (state, playerId, memory = {}) => {
  const hand = handOf(state, playerId);
  const playable = (state.devCards[playerId] || []).filter(
    (card) => card.type !== 'victoryPoint' && card.boughtTurn !== state.turnCount,
  );

  // Development cards first, one per turn.
  if (!state.devPlayedThisTurn && playable.length) {
    const knight = playable.find((card) => card.type === 'knight');
    const holder = state.largestArmy;
    const mineKnights = state.knights[playerId] || 0;
    const wantsArmy = mineKnights + 1 >= 3 && (!holder || (holder !== playerId && mineKnights + 1 > (state.knights[holder] || 0)));
    if (knight && (wantsArmy || robberOnMe(state, playerId))) return { type: 'play-dev', card: 'knight' };

    const goal = chooseGoal(state, playerId);
    if (playable.some((c) => c.type === 'roadBuilding') && piecesLeft(state, playerId).road >= 1 && roadTowardSite(state, playerId) !== null) {
      return { type: 'play-dev', card: 'roadBuilding' };
    }
    if (playable.some((c) => c.type === 'yearOfPlenty') && goal) {
      const missing = missingFor(hand, goal.cost);
      const picks = [];
      Object.entries(missing).forEach(([resource, count]) => {
        for (let i = 0; i < count && picks.length < 2; i += 1) picks.push(resource);
      });
      if (picks.length && picks.every((r) => state.bank[r] > 0)) {
        while (picks.length < 2) picks.push(picks[0]);
        if (state.bank[picks[0]] >= picks.filter((r) => r === picks[0]).length) {
          return { type: 'play-dev', card: 'yearOfPlenty', resources: picks };
        }
      }
    }
    if (playable.some((c) => c.type === 'monopoly') && goal) {
      const missing = Object.keys(missingFor(hand, goal.cost));
      if (missing.length) return { type: 'play-dev', card: 'monopoly', resource: missing[0] };
    }
  }

  const goal = chooseGoal(state, playerId);

  if (goal && hasResources(hand, goal.cost)) {
    if (goal.type === 'city' && canBuildCity(state, playerId, goal.vertexId)) return { type: 'build-city', vertexId: goal.vertexId };
    if (goal.type === 'settlement' && canPlaceSettlement(state, playerId, goal.vertexId)) {
      return { type: 'place-settlement', vertexId: goal.vertexId };
    }
    if (goal.type === 'road' && canPlaceRoad(state, playerId, goal.edgeId)) return { type: 'place-road', edgeId: goal.edgeId };
    if (goal.type === 'dev') return { type: 'buy-dev' };
  }

  // A maritime trade that gets closer to the goal without spending its parts.
  if (goal && (memory.maritime || 0) < 3) {
    const trade = maritimeToward(state, playerId, goal);
    if (trade) return trade;
  }

  // One friendly offer to the table each turn: a spare card for a needed one.
  if (goal && !memory.offered) {
    const missing = missingFor(hand, goal.cost);
    const want = Object.keys(missing)[0];
    const spare = RESOURCES.filter((resource) => resource !== want && hand[resource] - (goal.cost[resource] || 0) >= 1).sort(
      (a, b) => hand[b] - hand[a],
    )[0];
    if (want && spare) return { type: 'trade-propose', give: { [spare]: 1 }, get: { [want]: 1 }, to: null };
  }

  // Spend a big hand rather than lose half of it to a 7.
  if (handSize(hand) > 7) {
    if (hasResources(hand, COSTS.dev) && (typeof state.devDeck === 'number' ? state.devDeck : state.devDeck.length) > 0) {
      return { type: 'buy-dev' };
    }
    const edges = piecesLeft(state, playerId).road > 0 ? legalRoadSpots(state, playerId) : [];
    if (edges.length && hasResources(hand, COSTS.road)) return { type: 'place-road', edgeId: roadTowardSite(state, playerId) ?? edges[0] };
  }

  return null;
};

// A bank trade that brings the goal closer without spending its own parts.
export const maritimeToward = (state, playerId, goal = chooseGoal(state, playerId)) => {
  if (!goal) return null;
  const hand = handOf(state, playerId);
  const missing = missingFor(hand, goal.cost);
  const want = Object.keys(missing).find((resource) => state.bank[resource] > 0);
  if (!want) return null;
  const rates = maritimeRates(state, playerId);
  const give = RESOURCES.filter((resource) => resource !== want)
    .map((resource) => ({ resource, spare: hand[resource] - (goal.cost[resource] || 0) - rates[resource] }))
    .filter((entry) => entry.spare >= 0)
    .sort((a, b) => b.spare - a.spare)[0];
  return give ? { type: 'maritime', give: give.resource, get: want } : null;
};

export const bestSettlementSpot = (state, playerId) =>
  best(legalSettlementSpots(state, playerId), (v) => settleScore(state, playerId, v));

export const bestCitySpot = (state, playerId) => best(legalCitySpots(state, playerId), (v) => vertexScore(state, v));

export const robberOnMe = (state, playerId) =>
  GEOMETRY.hexes[state.board.robber].vertices.some((vertexId) => state.buildings[vertexId]?.owner === playerId);

// Plays a knight before rolling when the robber sits on one of its hexes.
export const wantsKnightBeforeRoll = (state, playerId) =>
  !state.devPlayedThisTurn &&
  robberOnMe(state, playerId) &&
  (state.devCards[playerId] || []).some((card) => card.type === 'knight' && card.boughtTurn !== state.turnCount);

// Keeps the cards the next build needs, throws away surplus first.
export const chooseDiscard = (state, playerId) => {
  const count = state.pendingDiscards?.[playerId] ?? discardCount(handOf(state, playerId), handLimitOf(state));
  const hand = { ...handOf(state, playerId) };
  const goal = chooseGoal(state, playerId);
  const keep = goal ? goal.cost : {};
  const discard = {};

  for (let i = 0; i < count; i += 1) {
    const resource = RESOURCES.filter((r) => hand[r] > 0).sort(
      (a, b) => hand[b] - (keep[b] || 0) - (hand[a] - (keep[a] || 0)),
    )[0];
    hand[resource] -= 1;
    discard[resource] = (discard[resource] || 0) + 1;
  }
  return discard;
};

// How much an offer is worth to this seat: what it would gain minus what it
// would give up, valued against its next build. `blocked` when it cannot pay
// or the partner shows 8 or more points (bots only count visible points).
export const tradeValue = (state, playerId, trade) => {
  const receiving = trade.from === playerId ? trade.get : trade.give; // what the bot would get
  const paying = trade.from === playerId ? trade.give : trade.get;
  const partner = trade.from === playerId ? trade.to : trade.from;
  const hand = handOf(state, playerId);

  if (!hasResources(hand, paying)) return { blocked: true, margin: -Infinity };
  if (partner && publicPoints(state, partner) >= victoryPointsOf(state) - 2) return { blocked: true, margin: -Infinity };

  const goal = chooseGoal(state, playerId);
  const need = goal ? missingFor(hand, goal.cost) : {};
  const value = (resource, giving) => {
    if (giving) return (goal?.cost[resource] || 0) >= hand[resource] ? 2 : hand[resource] > 2 ? 0.6 : 1;
    return need[resource] ? 2 : 0.8;
  };

  const gain = Object.entries(receiving).reduce((sum, [r, n]) => sum + value(r, false) * n, 0);
  const loss = Object.entries(paying).reduce((sum, [r, n]) => sum + value(r, true) * n, 0);
  return { blocked: false, margin: gain - loss };
};

// Answers an offer from the player whose turn it is.
export const acceptsTrade = (state, playerId, trade) => tradeValue(state, playerId, trade).margin > 0;

export const chooseYearOfPlenty = (state, playerId) => {
  const goal = chooseGoal(state, playerId);
  const missing = goal ? missingFor(handOf(state, playerId), goal.cost) : {};
  const picks = [];
  Object.entries(missing).forEach(([resource, count]) => {
    for (let i = 0; i < count && picks.length < 2; i += 1) if (state.bank[resource] > i) picks.push(resource);
  });
  const fallback = RESOURCES.filter((r) => state.bank[r] > 0).sort((a, b) => state.bank[b] - state.bank[a]);
  while (picks.length < 2 && fallback.length) picks.push(fallback[picks.length % fallback.length]);
  return picks;
};

export const chooseMonopoly = (state, playerId) => {
  const goal = chooseGoal(state, playerId);
  const missing = goal ? Object.keys(missingFor(handOf(state, playerId), goal.cost)) : [];
  return missing[0] || 'ore';
};

