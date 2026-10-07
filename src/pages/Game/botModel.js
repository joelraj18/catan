// Numbers the computer opponents plan with: what a seat produces, how many
// turns a build is away, what each opponent probably holds, and the seat's
// personality. Everything here is a pure function of the state.
//
// The card tracker reads public information only, as a person at the table
// could: production, builds, trades with the bank and with players, Year of
// Plenty and Monopoly, and the card count of every hand. A stolen card's
// kind and the cards a player discards are hidden from the table, so they
// count as unknown.

import { PIPS, RESOURCES, TERRAINS } from './catanBoard';
import { geoOf, handSize, maritimeRates } from './catanRules';

export const zeroHand = () => ({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 });
const BANK_RATES = { brick: 4, lumber: 4, ore: 4, grain: 4, wool: 4 };

// ------------------------------------------------------------ production

// Expected cards per roll of each resource: a hex gives pips/36 per
// settlement and twice that per city. The hex under the robber counts at
// `robberFactor` (nothing, by default).
export const production = (state, playerId, { robberFactor = 0 } = {}) => {
  const prod = zeroHand();
  const geo = geoOf(state);
  Object.entries(state.buildings).forEach(([vertexId, building]) => {
    if (building.owner !== playerId) return;
    geo.vertices[vertexId].hexes.forEach((hexId) => {
      const hex = state.board.hexes[hexId];
      const resource = TERRAINS[hex.terrain].resource;
      if (!resource || !hex.number) return;
      const blocked = hexId === state.board.robber ? robberFactor : 1;
      prod[resource] += (PIPS[hex.number] / 36) * (building.type === 'city' ? 2 : 1) * blocked;
    });
  });
  return prod;
};

// Pips by resource around one intersection (what a settlement there makes).
export const vertexPips = (state, vertexId) => {
  const pips = zeroHand();
  geoOf(state).vertices[vertexId].hexes.forEach((hexId) => {
    const hex = state.board.hexes[hexId];
    const resource = TERRAINS[hex.terrain].resource;
    if (resource && hex.number) pips[resource] += PIPS[hex.number];
  });
  return pips;
};

export const scale = (bundle, factor) => {
  const out = zeroHand();
  RESOURCES.forEach((r) => {
    out[r] = (bundle[r] || 0) * factor;
  });
  return out;
};

// ------------------------------------------------------------ affording

// Whether the hand pays for the cost now, trading surplus with the bank at
// these rates where it falls short.
export const affordableWithTrades = (hand, cost, rates = BANK_RATES) => {
  let deficit = 0;
  let trades = 0;
  RESOURCES.forEach((r) => {
    const have = hand[r] || 0;
    const need = cost[r] || 0;
    if (have < need) deficit += need - have;
    else trades += Math.floor((have - need) / (rates[r] || 4));
  });
  return deficit <= trades;
};

// Turns until a hand affords a cost, given the cards it gains per turn and
// the bank or harbour rates it may trade surplus at. A smooth estimate (it
// treats production as steady), 0 when it can pay now, `limit` when never.
export const turnsToAfford = (hand, cost, prod, rates = BANK_RATES, limit = 30) => {
  if (affordableWithTrades(hand, cost, rates)) return 0;
  const margin = (t) => {
    let deficit = 0;
    let spare = 0;
    RESOURCES.forEach((r) => {
      const have = (hand[r] || 0) + (prod[r] || 0) * t;
      const need = cost[r] || 0;
      if (have < need) deficit += need - have;
      else spare += (have - need) / (rates[r] || 4);
    });
    return spare - deficit;
  };
  if (margin(limit) < 0) return limit;
  let lo = 0;
  let hi = limit;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (margin(mid) >= 0) hi = mid;
    else lo = mid;
  }
  // A real build waits for whole cards, so a sliver of a turn rounds up a little.
  return Math.max(0.25, hi);
};

// Each seat's bank and harbour rates.
export const portRates = (state, playerId) => maritimeRates(state, playerId);

// The rates a seat would have with one more settlement at this intersection.
export const ratesWith = (state, playerId, vertexId) => {
  const rates = { ...maritimeRates(state, playerId) };
  state.board.harbors.forEach((harbor) => {
    if (!harbor.vertices.includes(vertexId)) return;
    if (harbor.type === 'any') RESOURCES.forEach((r) => (rates[r] = Math.min(rates[r], 3)));
    else rates[harbor.type] = 2;
  });
  return rates;
};

export const harbourAt = (state, vertexId) => state.board.harbors.find((harbor) => harbor.vertices.includes(vertexId)) || null;

// --------------------------------------------------------------- tracker

const round2 = (value) => Math.round(value * 100) / 100;
const total = (hand) => RESOURCES.reduce((sum, r) => sum + (hand[r] || 0), 0);

// Takes `count` cards out of an estimated hand, spread like the hand is.
const removeSpread = (hand, count) => {
  const size = total(hand);
  if (size <= 0 || count <= 0) return { hand, taken: zeroHand() };
  const share = Math.min(1, count / size);
  const next = zeroHand();
  const taken = zeroHand();
  RESOURCES.forEach((r) => {
    taken[r] = hand[r] * share;
    next[r] = hand[r] - taken[r];
  });
  return { hand: next, taken };
};

// Pays a known bundle. Where the estimate held too few of a resource, the
// missing cards were wrongly counted as something else, so they come out
// of the rest of the hand.
const payKnown = (hand, bundle) => {
  let next = { ...zeroHand(), ...hand };
  let short = 0;
  RESOURCES.forEach((r) => {
    const paid = bundle?.[r] || 0;
    if (!paid) return;
    if (next[r] >= paid) next[r] -= paid;
    else {
      short += paid - next[r];
      next[r] = 0;
    }
  });
  if (short > 0) {
    const others = { ...next };
    RESOURCES.forEach((r) => {
      if (bundle?.[r]) others[r] = 0;
    });
    const { taken } = removeSpread(others, short);
    RESOURCES.forEach((r) => {
      next[r] -= taken[r];
    });
  }
  return next;
};

const gain = (hand, bundle, factor = 1) => {
  const next = { ...zeroHand(), ...hand };
  RESOURCES.forEach((r) => {
    next[r] += (bundle?.[r] || 0) * factor;
  });
  return next;
};

// What a seat's unknown cards probably are: shaped like what it produces,
// evened out a little so no resource is ruled out.
const priorOf = (state, playerId) => {
  const prod = production(state, playerId, { robberFactor: 1 });
  const sum = total(prod);
  const prior = zeroHand();
  RESOURCES.forEach((r) => {
    prior[r] = sum > 0 ? 0.75 * (prod[r] / sum) + 0.05 : 0.2;
  });
  return prior;
};

// Matches an estimate to the card count everyone can see.
const reconcile = (state, playerId, hand) => {
  const real = handSize(state.hands?.[playerId]);
  const est = { ...zeroHand(), ...hand };
  const size = total(est);
  if (Math.abs(size - real) < 0.01) return est;
  if (size > real) {
    if (size <= 0) return zeroHand();
    return scale(est, real / size);
  }
  const prior = priorOf(state, playerId);
  return gain(est, prior, real - size);
};

// The tracker after one more public event. `state` is the game after the
// event, used only for public card counts and the board.
export const trackEvent = (tracker, event, state) => {
  const next = { ...(tracker || {}) };
  const of = (id) => ({ ...zeroHand(), ...(next[id] || {}) });
  const players = (state?.players || []).map((player) => player.id);

  switch (event?.type) {
    case 'produce':
      Object.entries(event.gains || {}).forEach(([id, bundle]) => {
        next[id] = gain(of(id), bundle);
      });
      break;
    case 'build':
    case 'buyDev':
      if (event.paid) next[event.actor] = payKnown(of(event.actor), event.paid);
      break;
    case 'yop':
      next[event.actor] = gain(of(event.actor), event.bundle);
      break;
    case 'monopoly':
      // Afterwards nobody else holds any of that resource.
      players.forEach((id) => {
        if (id === event.actor) return;
        const paid = event.from?.[id] || 0;
        next[id] = { ...payKnown(of(id), { [event.resource]: paid }), [event.resource]: 0 };
      });
      next[event.actor] = gain(of(event.actor), { [event.resource]: event.total || 0 });
      break;
    case 'trade':
      next[event.actor] = gain(payKnown(of(event.actor), event.give), event.get);
      next[event.partner] = gain(payKnown(of(event.partner), event.get), event.give);
      break;
    case 'maritime':
      next[event.actor] = gain(payKnown(of(event.actor), event.give), event.get);
      break;
    case 'steal': {
      // The table sees a card change hands, not which.
      const { hand, taken } = removeSpread(of(event.victim), 1);
      next[event.victim] = hand;
      next[event.actor] = gain(of(event.actor), taken);
      break;
    }
    case 'discard':
      next[event.actor] = removeSpread(of(event.actor), event.count || 0).hand;
      break;
    default:
      return tracker || next;
  }

  players.forEach((id) => {
    const hand = reconcile(state, id, of(id));
    const rounded = zeroHand();
    RESOURCES.forEach((r) => {
      rounded[r] = Math.max(0, round2(hand[r]));
    });
    next[id] = rounded;
  });
  return next;
};

// What a seat probably holds, by resource, as an opponent sees it.
export const estimatedHand = (state, playerId) => reconcile(state, playerId, state.tracker?.[playerId] || zeroHand());

// -------------------------------------------------------------- persona

// A small, stable hash of a string (FNV-1a), for choices that must not
// touch the game's own random numbers.
export const hashOf = (text) => {
  let hash = 2166136261;
  const str = String(text);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// A number in [0, 1) fixed by the seat, the turn and what is being chosen.
export const seededUnit = (...parts) => hashOf(parts.join('|')) / 4294967296;

export const STYLES = ['expander', 'citybuilder', 'merchant'];

// Each style leans 25% toward its favourite resources and plans.
const STYLE_WEIGHTS = {
  expander: {
    resources: { brick: 1.25, lumber: 1.25, ore: 0.75, grain: 1, wool: 1 },
    goals: { settlement: 1.25, road: 1.25, longestRoad: 1.25, city: 0.75, dev: 0.75, army: 0.75 },
    harbour: 1,
    trade: 1,
  },
  citybuilder: {
    resources: { brick: 0.75, lumber: 0.75, ore: 1.25, grain: 1.25, wool: 1 },
    goals: { settlement: 1, road: 0.75, longestRoad: 0.75, city: 1.25, dev: 1.25, army: 1.25 },
    harbour: 1,
    trade: 1,
  },
  merchant: {
    resources: { brick: 1, lumber: 1, ore: 1, grain: 1, wool: 1 },
    goals: { settlement: 1, road: 1, longestRoad: 1, city: 1, dev: 1, army: 1 },
    harbour: 1.25,
    trade: 1.25,
  },
};

export const styleOf = (playerId) => STYLES[hashOf(`style:${playerId}`) % STYLES.length];

export const personalityOf = (playerId) => {
  const style = styleOf(playerId);
  return { style, ...STYLE_WEIGHTS[style] };
};

// The best of some options. Options within `closeness` of the best are a
// tie, broken by a hash of the seat, the turn and the option, so a seat
// is not predictable game to game but never draws on the game's dice.
export const pickBest = (items, scoreOf, { seed = '', keyOf = (item) => item, closeness = 0.02 } = {}) => {
  let top = -Infinity;
  const scored = items.map((item) => {
    const score = scoreOf(item);
    if (score > top) top = score;
    return { item, score };
  });
  if (!scored.length || top === -Infinity) return null;
  const band = Math.abs(top) * closeness + 1e-9;
  let pick = null;
  let pickHash = Infinity;
  scored.forEach(({ item, score }) => {
    if (score < top - band) return;
    const h = hashOf(`${seed}|${keyOf(item)}`);
    if (h < pickHash) {
      pick = item;
      pickHash = h;
    }
  });
  return pick;
};

export const resourceCount = total;
