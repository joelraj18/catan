// Catan rules as pure functions over the game state. Nothing here mutates
// its input; the engine applies the results. Rule references are to the
// 2020 Game Rules & Almanac.

import { PIPS, RESOURCES, TERRAINS, geometryOf } from './catanBoard';

export const WINNING_POINTS = 10;
export const BANK_SIZE = 19; // of each resource
export const BANK_SIZES = { standard: 19, large: 24 }; // the 5-6 player extension adds 5 of each
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;
export const HAND_LIMIT = 7; // more than this when a 7 is rolled means discarding half

export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 };

export const COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  dev: { ore: 1, wool: 1, grain: 1 },
};

export const DEV_DECK = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
};

// The 5-6 player extension adds 6 knights and one of each progress card.
export const DEV_DECKS = {
  standard: DEV_DECK,
  large: { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
};

export const DEV_CARDS = {
  knight: { label: 'Knight', kind: 'knight', text: 'Move the robber, then steal 1 resource from a player next to its new hex' },
  roadBuilding: { label: 'Road Building', kind: 'progress', text: 'Place 2 new roads for free' },
  yearOfPlenty: { label: 'Year of Plenty', kind: 'progress', text: 'Take any 2 resources from the bank' },
  monopoly: { label: 'Monopoly', kind: 'progress', text: 'Name a resource, every other player gives you all of theirs' },
  victoryPoint: { label: 'Victory Point', kind: 'victory', text: '1 victory point, kept hidden until it wins the game' },
};

export const emptyHand = () => ({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 });
export const fullBank = (size = BANK_SIZE) => ({ brick: size, lumber: size, ore: size, grain: size, wool: size });

export const handSize = (hand) => RESOURCES.reduce((sum, resource) => sum + (hand?.[resource] || 0), 0);

export const hasResources = (hand, cost) =>
  Object.entries(cost).every(([resource, count]) => (hand?.[resource] || 0) >= count);

export const addResources = (hand, delta, sign = 1) => {
  const next = { ...emptyHand(), ...hand };
  Object.entries(delta).forEach(([resource, count]) => {
    next[resource] = (next[resource] || 0) + sign * count;
  });
  return next;
};

// Cleans a {resource: count} bundle: known resources, whole positive counts
// no larger than the whole bank holds.
export const cleanBundle = (bundle) => {
  const clean = {};
  RESOURCES.forEach((resource) => {
    const count = Math.floor(Number(bundle?.[resource]) || 0);
    if (count > 0 && count <= BANK_SIZES.large) clean[resource] = count;
  });
  return clean;
};

export const bundleSize = (bundle) => Object.values(bundle || {}).reduce((sum, count) => sum + count, 0);

// ------------------------------------------------------------ pieces

export const piecesUsed = (state, playerId) => {
  const used = { road: 0, settlement: 0, city: 0 };
  Object.values(state.buildings).forEach((building) => {
    if (building.owner === playerId) used[building.type] += 1;
  });
  Object.values(state.roads).forEach((owner) => {
    if (owner === playerId) used.road += 1;
  });
  return used;
};

export const piecesLeft = (state, playerId) => {
  const used = piecesUsed(state, playerId);
  return {
    road: PIECE_LIMITS.road - used.road,
    settlement: PIECE_LIMITS.settlement - used.settlement,
    city: PIECE_LIMITS.city - used.city,
  };
};

// ---------------------------------------------------------- placement

// The geometry of the board a state (or a bare board) is played on.
export const geoOf = (stateOrBoard) => geometryOf(stateOrBoard?.board ?? stateOrBoard);
const vertexOf = (state, id) => geoOf(state).vertices[id];
const edgeOf = (state, id) => geoOf(state).edges[id];

export const isVertex = (id, state = null) => Number.isInteger(id) && id >= 0 && id < geoOf(state).vertices.length;
export const isEdge = (id, state = null) => Number.isInteger(id) && id >= 0 && id < geoOf(state).edges.length;
export const isHex = (id, state = null) => Number.isInteger(id) && id >= 0 && id < geoOf(state).hexes.length;

// Distance Rule: the intersection is free and none of its neighbours holds
// a settlement or city, anyone's.
export const distanceRuleOk = (state, vertexId) =>
  !state.buildings[vertexId] && vertexOf(state, vertexId).neighbours.every((other) => !state.buildings[other]);

const touchesOwnRoad = (state, playerId, vertexId) =>
  vertexOf(state, vertexId).edges.some((edge) => state.roads[edge] === playerId);

// A settlement needs the Distance Rule and, after set-up, one of the
// player's own roads leading to it.
export const canPlaceSettlement = (state, playerId, vertexId, { setup = false } = {}) => {
  if (!isVertex(vertexId, state) || !distanceRuleOk(state, vertexId)) return false;
  if (piecesLeft(state, playerId).settlement <= 0) return false;
  return setup || touchesOwnRoad(state, playerId, vertexId);
};

// A road continues one of the player's roads, settlements or cities. It may
// not continue a road through an intersection an opponent has built on.
export const canPlaceRoad = (state, playerId, edgeId, { fromVertex = null } = {}) => {
  if (!isEdge(edgeId, state) || state.roads[edgeId] !== undefined) return false;
  if (piecesLeft(state, playerId).road <= 0) return false;

  const ends = edgeOf(state, edgeId).vertices;

  // In set-up the road must touch the settlement just placed.
  if (fromVertex !== null) return ends.includes(fromVertex);

  return ends.some((vertexId) => {
    const building = state.buildings[vertexId];
    if (building) return building.owner === playerId;
    return vertexOf(state, vertexId).edges.some((edge) => edge !== edgeId && state.roads[edge] === playerId);
  });
};

export const canBuildCity = (state, playerId, vertexId) => {
  const building = state.buildings[vertexId];
  return Boolean(
    building && building.owner === playerId && building.type === 'settlement' && piecesLeft(state, playerId).city > 0,
  );
};

export const legalSettlementSpots = (state, playerId, options) =>
  geoOf(state).vertices.filter((vertex) => canPlaceSettlement(state, playerId, vertex.id, options)).map((v) => v.id);

export const legalRoadSpots = (state, playerId, options) =>
  geoOf(state).edges.filter((edge) => canPlaceRoad(state, playerId, edge.id, options)).map((e) => e.id);

export const legalCitySpots = (state, playerId) =>
  Object.keys(state.buildings)
    .map(Number)
    .filter((vertexId) => canBuildCity(state, playerId, vertexId));

// -------------------------------------------------------- production

// Resources each hex next to this intersection produces (the desert gives
// nothing). Used for starting resources and for scoring spots.
export const vertexResources = (board, vertexId) =>
  vertexOf(board, vertexId)
    .hexes.map((hexId) => TERRAINS[board.hexes[hexId].terrain].resource)
    .filter(Boolean);

// What each player would collect for a roll, before the bank is checked.
export const productionFor = (state, roll) => {
  const owed = {};
  state.board.hexes.forEach((hex) => {
    if (hex.number !== roll || hex.id === state.board.robber) return;
    const resource = TERRAINS[hex.terrain].resource;
    if (!resource) return;

    geoOf(state).hexes[hex.id].vertices.forEach((vertexId) => {
      const building = state.buildings[vertexId];
      if (!building) return;
      owed[building.owner] = owed[building.owner] || emptyHand();
      owed[building.owner][resource] += building.type === 'city' ? 2 : 1;
    });
  });
  return owed;
};

// Applies the bank-shortage rule (Almanac, Resource Production): when the
// bank cannot pay everyone a resource, nobody gets it, unless only one
// player is owed it; that player takes what is left.
export const settleProduction = (owed, bank) => {
  const paid = {};
  const shortages = [];

  RESOURCES.forEach((resource) => {
    const claims = Object.entries(owed).filter(([, hand]) => hand[resource] > 0);
    const total = claims.reduce((sum, [, hand]) => sum + hand[resource], 0);
    if (!total) return;

    if (total <= bank[resource]) {
      claims.forEach(([id, hand]) => {
        paid[id] = paid[id] || emptyHand();
        paid[id][resource] += hand[resource];
      });
    } else if (claims.length === 1) {
      const [id] = claims[0];
      paid[id] = paid[id] || emptyHand();
      paid[id][resource] += bank[resource];
      if (bank[resource] < total) shortages.push(resource);
    } else {
      shortages.push(resource);
    }
  });

  return { paid, shortages };
};

export const discardCount = (hand, limit = HAND_LIMIT) => {
  const size = handSize(hand);
  return size > limit ? Math.floor(size / 2) : 0;
};

// Players with a settlement or city on the hex who have cards to steal.
export const robberVictims = (state, hexId, thiefId) => {
  const owners = new Set();
  geoOf(state).hexes[hexId].vertices.forEach((vertexId) => {
    const building = state.buildings[vertexId];
    if (building && building.owner !== thiefId) owners.add(building.owner);
  });
  return [...owners].filter((id) => handSize(state.hands[id]) > 0);
};

// --------------------------------------------------------------- trade

// Maritime rates for each resource: 4:1 always, 3:1 with a generic harbour,
// 2:1 with that resource's special harbour.
export const maritimeRates = (state, playerId) => {
  const rates = { brick: 4, lumber: 4, ore: 4, grain: 4, wool: 4 };
  state.board.harbors.forEach((harbor) => {
    const owned = harbor.vertices.some((vertexId) => state.buildings[vertexId]?.owner === playerId);
    if (!owned) return;
    if (harbor.type === 'any') {
      RESOURCES.forEach((resource) => {
        rates[resource] = Math.min(rates[resource], 3);
      });
    } else {
      rates[harbor.type] = 2;
    }
  });
  return rates;
};

// Domestic trades: both sides give something (no gifts) and nobody trades
// a resource for the same resource.
export const tradeShapeProblem = (give, get) => {
  if (!bundleSize(give) || !bundleSize(get)) return 'Both sides must offer at least one card';
  if (Object.keys(give).some((resource) => get[resource])) return 'You cannot trade a resource for the same resource';
  return null;
};

// ------------------------------------------------------- longest road

// Longest continuous road of a player, without counting forks. An
// opponent's settlement or city on an intersection breaks the road there.
export const longestRoadLength = (state, playerId) => {
  const own = Object.entries(state.roads)
    .filter(([, owner]) => owner === playerId)
    .map(([edge]) => Number(edge));
  if (!own.length) return 0;

  const ownSet = new Set(own);
  const blocked = (vertexId) => {
    const building = state.buildings[vertexId];
    return Boolean(building && building.owner !== playerId);
  };

  let best = 0;
  const walk = (vertexId, used, length) => {
    best = Math.max(best, length);
    if (blocked(vertexId)) return;
    vertexOf(state, vertexId).edges.forEach((edgeId) => {
      if (!ownSet.has(edgeId) || used.has(edgeId)) return;
      used.add(edgeId);
      const [a, b] = edgeOf(state, edgeId).vertices;
      walk(a === vertexId ? b : a, used, length + 1);
      used.delete(edgeId);
    });
  };

  own.forEach((edgeId) => {
    const [a, b] = edgeOf(state, edgeId).vertices;
    const used = new Set([edgeId]);
    walk(a, used, 1);
    walk(b, used, 1);
  });

  return best;
};

// Who holds the Longest Road card after the board changed (Almanac p. 9):
// - the holder keeps it unless someone is now strictly longer;
// - a holder whose road was broken but who still ties for longest keeps it;
// - otherwise a single longest road of 5+ takes it, and a tie (or nobody at
//   5+) sets the card aside.
export const longestRoadHolder = (lengths, holder) => {
  const entries = Object.entries(lengths);
  const best = Math.max(0, ...entries.map(([, length]) => length));

  if (best < LONGEST_ROAD_MIN) return null;

  const leaders = entries.filter(([, length]) => length === best).map(([id]) => id);
  if (holder && leaders.includes(holder)) return holder;
  return leaders.length === 1 ? leaders[0] : null;
};

// Largest Army: the first to 3 knights, taken by anyone who then has more.
export const largestArmyHolder = (knights, holder) => {
  let next = holder;
  Object.entries(knights).forEach(([id, count]) => {
    if (count < LARGEST_ARMY_MIN || id === next) return;
    if (!next || count > (knights[next] || 0)) next = id;
  });
  return next;
};

// -------------------------------------------------------------- points

export const hiddenPoints = (state, playerId) =>
  (state.devCards?.[playerId] || []).filter((card) => card.type === 'victoryPoint').length;

// Points everyone can see: buildings plus the two special cards.
export const publicPoints = (state, playerId) => {
  let points = 0;
  Object.values(state.buildings).forEach((building) => {
    if (building.owner === playerId) points += building.type === 'city' ? 2 : 1;
  });
  if (state.longestRoad?.holder === playerId) points += 2;
  if (state.largestArmy === playerId) points += 2;
  return points;
};

export const totalPoints = (state, playerId) => publicPoints(state, playerId) + hiddenPoints(state, playerId);

// --------------------------------------------------------------- scoring

// How good an intersection is to settle: expected production (pips), with a
// bonus for variety and a small one for a harbour.
export const vertexScore = (state, vertexId, weights = {}) => {
  const seen = new Set();
  let score = 0;
  vertexOf(state, vertexId).hexes.forEach((hexId) => {
    const hex = state.board.hexes[hexId];
    const resource = TERRAINS[hex.terrain].resource;
    if (!resource || !hex.number) return;
    const pips = PIPS[hex.number] * (hex.id === state.board.robber ? 0.4 : 1);
    score += pips * (weights[resource] ?? 1);
    if (!seen.has(resource)) {
      seen.add(resource);
      score += 1.2;
    }
  });
  if (state.board.harbors.some((harbor) => harbor.vertices.includes(vertexId))) score += 1.5;
  return score;
};

// --------------------------------------------------------------- privacy

// The seat list with every Player ID but the viewer's hidden. The same list
// object comes back while the seats are unchanged, so the board does not
// redraw for nothing.
const seatViews = new WeakMap();
const seatsFor = (players, viewerId) => {
  if (!Array.isArray(players)) return players;
  if (!seatViews.has(players)) seatViews.set(players, new Map());
  const views = seatViews.get(players);
  if (!views.has(viewerId)) {
    views.set(viewerId, players.map((player) => (player.id === viewerId || !player.code ? player : { ...player, code: null })));
  }
  return views.get(viewerId);
};

// The event feed one seat may see: a stolen card shows only to the thief and
// the victim, and a discard shows only its size to everyone else.
const eventsFor = (state, viewerId) => {
  if (!Array.isArray(state.events) || state.gameOver) return state.events;
  return state.events.map((event) => {
    if (event.type === 'steal' && event.actor !== viewerId && event.victim !== viewerId) return { ...event, resource: null };
    if (event.type === 'discard' && event.actor !== viewerId) return { ...event, bundle: null };
    return event;
  });
};

// What one seat may see: their own hand and development cards, and only the
// counts of everyone else's. The deck shows only how many cards are left.
export const redactFor = (state, viewerId) => {
  if (!state) return state;

  const hands = {};
  const devCards = {};
  Object.keys(state.hands || {}).forEach((id) => {
    if (id === viewerId || state.gameOver) {
      hands[id] = state.hands[id];
      devCards[id] = state.devCards[id];
    } else {
      hands[id] = { hidden: handSize(state.hands[id]) };
      devCards[id] = (state.devCards[id] || []).map(() => ({ hidden: true }));
    }
  });

  const steal = state.lastSteal;
  const lastSteal =
    steal && !state.gameOver && steal.thief !== viewerId && steal.victim !== viewerId ? { ...steal, resource: null } : steal;

  return {
    ...state,
    // A Player ID reopens its seat, so each viewer sees only their own.
    players: seatsFor(state.players, viewerId),
    hands,
    devCards,
    lastSteal,
    events: eventsFor(state, viewerId),
    devDeck: Array.isArray(state.devDeck) ? state.devDeck.length : state.devDeck,
    redacted: true,
  };
};

// Count of cards in a hand that may be redacted.
export const visibleHandSize = (hand) => (hand && typeof hand.hidden === 'number' ? hand.hidden : handSize(hand));
