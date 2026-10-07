// Computer opponents. Every function looks at the state and returns a
// decision; the engine checks and applies it exactly like a person's move.
// Bots never peek at hidden cards except their own: opponents are judged by
// public points, card counts and the public card tracker (botModel.js).
//
// The host picks how well they play (`botSkill`): 'casual' is the original
// simple strategy (catanBotCasual.js); 'strong' plans ahead. A strong seat
// keeps a goal across turns, builds everything worth building, trades with
// purpose, aims the robber at whoever is winning and plays its development
// cards at the right moment. Each seat has a personality from its id:
// Expander, Citybuilder or Merchant.

import { PIPS, RESOURCES, TERRAINS } from './catanBoard';
import * as Casual from './catanBotCasual';
import {
  affordableWithTrades,
  estimatedHand,
  harbourAt,
  personalityOf,
  pickBest,
  production,
  resourceCount,
  scale,
  seededUnit,
  turnsToAfford,
  vertexPips,
  zeroHand,
} from './botModel';
import { handLimitOf, settingsOf, victoryPointsOf } from './gameSettings';
import {
  COSTS,
  addResources,
  canBuildCity,
  canPlaceRoad,
  canPlaceSettlement,
  discardCount,
  distanceRuleOk,
  geoOf,
  handSize,
  hasResources,
  legalCitySpots,
  legalRoadSpots,
  legalSettlementSpots,
  longestRoadLength,
  maritimeRates,
  piecesLeft,
  publicPoints,
  robberVictims,
  totalPoints,
} from './catanRules';

// -------------------------------------------------------------- skill

// How well a seat plays: a seat may carry its own level (used by tests and
// leagues), otherwise the host's table rule decides. A premium AI seat
// always falls back on the strong strategy.
export const skillOf = (state, playerId) => {
  const seat = state.players?.find((player) => player.id === playerId);
  if (seat?.skill === 'casual' || seat?.skill === 'strong') return seat.skill;
  if (seat?.kind === 'ai') return 'strong';
  return settingsOf(state).botSkill;
};

const isCasual = (state, playerId) => skillOf(state, playerId) === 'casual';

// ------------------------------------------------------------- tuning

const HYSTERESIS = 1.2; // a new goal must beat the current one by 20%
const WIN_BONUS = 40; // a goal that wins the game now
const MAX_SEA_TRADES = 6; // bank trades per turn
const BASE_WEIGHTS = { brick: 1, lumber: 1, ore: 1, grain: 1.05, wool: 0.85 };
const DEV_VALUE = 0.8; // a development card, in victory points: 5/25 points, knights, progress

const deckSize = (state) => (typeof state.devDeck === 'number' ? state.devDeck : state.devDeck?.length || 0);
const without = (hand, bundle, times = 1) => addResources(hand, bundle, -times);
const sumCosts = (...bundles) => bundles.reduce((acc, bundle) => addResources(acc, bundle), zeroHand());
const pipsOf = (hex) => PIPS[hex.number] || 0;
const resourceOf = (hex) => TERRAINS[hex.terrain].resource;

// How scarce each resource is on this island: rarer ones weigh more.
const scarcityCache = new WeakMap();
const scarcityOf = (board) => {
  if (scarcityCache.has(board)) return scarcityCache.get(board);
  const pips = zeroHand();
  board.hexes.forEach((hex) => {
    const resource = resourceOf(hex);
    if (resource && hex.number) pips[resource] += pipsOf(hex);
  });
  const mean = RESOURCES.reduce((sum, r) => sum + pips[r], 0) / RESOURCES.length;
  const weights = {};
  RESOURCES.forEach((r) => {
    weights[r] = Math.min(1.35, Math.max(0.8, Math.sqrt(mean / Math.max(1, pips[r]))));
  });
  scarcityCache.set(board, weights);
  return weights;
};

// ----------------------------------------------------------- reaching

// How many new roads each intersection is from a seat's network, with the
// road that leads there, without crossing anyone's road or building.
const reachOf = (state, playerId, limit = 6) => {
  const geo = geoOf(state);
  const count = geo.vertices.length;
  const dist = new Array(count).fill(Infinity);
  const via = new Array(count).fill(-1);
  const prev = new Array(count).fill(-1);
  const blocked = (v) => Boolean(state.buildings[v] && state.buildings[v].owner !== playerId);
  const queue = [];
  const start = (v) => {
    if (dist[v] === 0 || blocked(v)) return;
    dist[v] = 0;
    queue.push(v);
  };
  Object.entries(state.buildings).forEach(([v, building]) => building.owner === playerId && start(Number(v)));
  Object.entries(state.roads).forEach(([e, owner]) => owner === playerId && geo.edges[e].vertices.forEach(start));
  for (let i = 0; i < queue.length; i += 1) {
    const v = queue[i];
    if (dist[v] >= limit) continue;
    geo.vertices[v].edges.forEach((e) => {
      if (state.roads[e] !== undefined) return;
      const [a, b] = geo.edges[e].vertices;
      const w = a === v ? b : a;
      if (blocked(w) || dist[w] <= dist[v] + 1) return;
      dist[w] = dist[v] + 1;
      via[w] = e;
      prev[w] = v;
      queue.push(w);
    });
  }
  const pathTo = (v) => {
    const path = [];
    let at = v;
    while (at >= 0 && dist[at] > 0) {
      path.unshift(via[at]);
      at = prev[at];
    }
    return path;
  };
  return { dist, pathTo };
};

// ------------------------------------------------------------ context

// Everything a seat's decisions share, worked out once per state.
const contexts = new WeakMap();
const ctxOf = (state, playerId) => {
  let byId = contexts.get(state);
  if (!byId) {
    byId = new Map();
    contexts.set(state, byId);
  }
  if (!byId.has(playerId)) byId.set(playerId, buildCtx(state, playerId));
  return byId.get(playerId);
};

const buildCtx = (state, id) => {
  const persona = personalityOf(id);
  const players = state.players.map((player) => player.id);
  const others = players.filter((other) => other !== id);
  const target = victoryPointsOf(state);
  const hand = { ...zeroHand(), ...state.hands[id] };
  const prodRoll = production(state, id);
  const prodTurn = scale(prodRoll, Math.max(2, players.length));
  const rates = maritimeRates(state, id);
  const myVP = totalPoints(state, id);
  const vp = Object.fromEntries(others.map((other) => [other, publicPoints(state, other)]));
  const topOther = Math.max(0, ...Object.values(vp));
  const leader = others.length ? others.reduce((a, b) => (vp[b] > vp[a] ? b : a)) : null;
  // Turns the game probably has left, and what a pip of production is worth.
  const remaining = Math.min(14, Math.max(1.5, 2.4 * (target - Math.max(myVP, topOther))));
  const pipWorth = 0.03 * remaining;

  const scarcity = scarcityOf(state.board);
  const early = myVP < 5;
  const weights = {};
  RESOURCES.forEach((r) => {
    let w = BASE_WEIGHTS[r] * scarcity[r] * persona.resources[r];
    if (prodRoll[r] < 0.04) w *= 1.25; // something it cannot make yet
    if (early && (r === 'brick' || r === 'lumber')) w *= 1.1;
    if (!early && (r === 'ore' || r === 'grain')) w *= 1.1;
    weights[r] = w;
  });

  return {
    id,
    state,
    persona,
    players,
    others,
    target,
    hand,
    prodRoll,
    prodTurn,
    rates,
    myVP,
    vp,
    leader,
    topOther,
    pipWorth,
    weights,
    left: piecesLeft(state, id),
    seed: `${id}|${state.turnCount}`,
    cache: {},
  };
};

const lazy = (ctx, key, make) => {
  if (!(key in ctx.cache)) ctx.cache[key] = make();
  return ctx.cache[key];
};

const myReach = (ctx) => lazy(ctx, 'reach', () => reachOf(ctx.state, ctx.id));

// The fewest new roads any opponent needs to reach each intersection.
const rivalDist = (ctx) =>
  lazy(ctx, 'rivals', () => {
    const geo = geoOf(ctx.state);
    const best = new Array(geo.vertices.length).fill(Infinity);
    ctx.others.forEach((other) => {
      const { dist } = reachOf(ctx.state, other, 4);
      dist.forEach((d, v) => {
        if (d < best[v]) best[v] = d;
      });
    });
    return best;
  });

// How dangerous an opponent is: close to winning, or the leader.
const threatOf = (ctx, other) => {
  const share = (ctx.vp[other] || 0) / ctx.target;
  return 0.6 + 2.4 * share * share + (other === ctx.leader && ctx.vp[other] > ctx.myVP ? 0.5 : 0);
};

const turnsFor = (ctx, cost, hand = ctx.hand) => turnsToAfford(hand, cost, ctx.prodTurn, ctx.rates);

// ------------------------------------------------------------- values

// Weighted pips a settlement at this intersection would add.
const spotPips = (ctx, vertexId) => {
  const pips = vertexPips(ctx.state, vertexId);
  return RESOURCES.reduce((sum, r) => sum + pips[r] * ctx.weights[r], 0);
};

// What a harbour at this intersection is worth to this seat: a 2:1
// harbour only for something it makes plenty of, a 3:1 for a big output.
const harbourValue = (ctx, vertexId, extraPips = vertexPips(ctx.state, vertexId)) => {
  const harbour = harbourAt(ctx.state, vertexId);
  if (!harbour) return 0;
  const own = scale(ctx.prodRoll, 36);
  if (harbour.type === 'any') {
    if (RESOURCES.every((r) => ctx.rates[r] <= 3)) return 0;
    const output = RESOURCES.reduce((sum, r) => sum + own[r] + extraPips[r], 0);
    return 0.035 * output * ctx.persona.harbour * (ctx.pipWorth / 0.3);
  }
  if (ctx.rates[harbour.type] <= 2) return 0;
  const made = own[harbour.type] + extraPips[harbour.type];
  return Math.max(0, made - 4) * 0.12 * ctx.persona.harbour * (ctx.pipWorth / 0.3);
};

const winBonus = (ctx, gain) => (ctx.myVP + gain >= ctx.target ? WIN_BONUS : 0);

// ---------------------------------------------------------- longest road

const roadsWith = (state, playerId, edges) => {
  const roads = { ...state.roads };
  edges.forEach((edge) => {
    roads[edge] = playerId;
  });
  return { ...state, roads };
};

// One or two roads that would take the Longest Road, if that is in reach.
const longestRoadPlan = (ctx) =>
  lazy(ctx, 'lr', () => {
    const { state, id, left } = ctx;
    const lengths = state.longestRoad?.lengths || {};
    if (state.longestRoad?.holder === id || left.road <= 0) return null;
    const mine = lengths[id] || 0;
    const rival = Math.max(0, ...ctx.others.map((other) => lengths[other] || 0));
    const need = Math.max(5, rival + 1);
    const gap = need - mine;
    if (gap > 2 || gap > left.road) return null;

    let best = null;
    const firsts = legalRoadSpots(state, id);
    for (const first of firsts) {
      const trial = roadsWith(state, id, [first]);
      const length = longestRoadLength(trial, id);
      if (length >= need) return { edges: [first], need };
      if (gap === 2 && left.road >= 2 && length > mine && !best) {
        const second = legalRoadSpots(trial, id).find((edge) => longestRoadLength(roadsWith(trial, id, [edge]), id) >= need);
        if (second !== undefined) best = { edges: [first, second], need };
      }
    }
    return best;
  });

// ------------------------------------------------------------- goals

// Every goal worth considering now, each scored by value / (1 + turns).
const goalsOf = (ctx) =>
  lazy(ctx, 'goals', () => {
    const { state, id, persona, left, hand } = ctx;
    const goals = [];
    const add = (goal) => {
      const turns = turnsFor(ctx, goal.cost);
      goals.push({ ...goal, turns, score: goal.value / (1 + turns) });
    };

    // A city on each settlement.
    if (left.city > 0) {
      legalCitySpots(state, id).forEach((vertexId) => {
        const value = persona.goals.city * (1 + ctx.pipWorth * spotPips(ctx, vertexId)) + winBonus(ctx, 1);
        add({ key: `city:${vertexId}`, type: 'city', vertexId, cost: COSTS.city, step: COSTS.city, value, path: [] });
      });
    }

    // A settlement on each open site in reach, with the roads to it.
    if (left.settlement > 0) {
      const { dist, pathTo } = myReach(ctx);
      const rivals = rivalDist(ctx);
      dist.forEach((d, vertexId) => {
        if (d === Infinity || d > left.road || state.buildings[vertexId] || !distanceRuleOk(state, vertexId)) return;
        // Somebody nearer will probably settle there first.
        const rival = rivals[vertexId];
        const odds = d === 0 ? 1 : rival < d ? 0.35 : rival === d ? 0.65 : rival === d + 1 ? 0.9 : 1;
        const fresh = RESOURCES.filter((r) => vertexPips(state, vertexId)[r] > 0 && ctx.prodRoll[r] < 0.04).length;
        const worth = 1 + ctx.pipWorth * spotPips(ctx, vertexId) + harbourValue(ctx, vertexId) + 0.25 * fresh;
        const value = (persona.goals.settlement * worth * odds) * 0.93 ** d + winBonus(ctx, d === 0 ? 1 : 0);
        const path = pathTo(vertexId);
        const cost = sumCosts(COSTS.settlement, ...path.map(() => COSTS.road));
        add({ key: `settle:${vertexId}`, type: 'settlement', vertexId, cost, step: path.length ? COSTS.road : COSTS.settlement, value, path });
      });
    }

    // A development card: hidden points, knights and progress cards.
    if (deckSize(state) > 0) {
      let value = DEV_VALUE * persona.goals.dev;
      const holder = state.largestArmy;
      const knights = (state.knights[id] || 0) + (state.devCards[id] || []).filter((card) => card.type === 'knight').length;
      const theirs = holder && holder !== id ? state.knights[holder] || 0 : Math.max(2, ...ctx.others.map((o) => state.knights[o] || 0));
      if (holder !== id && knights + 2 >= theirs + 1) value += 0.9 * persona.goals.army; // the army race is close
      if (holder === id && ctx.others.some((o) => (state.knights[o] || 0) + 1 >= (state.knights[id] || 0))) value += 0.3;
      // Late in the game a card may be the last hidden point.
      if (ctx.target - ctx.myVP <= 2) value += 0.25;
      add({ key: 'dev', type: 'dev', cost: COSTS.dev, step: COSTS.dev, value, path: [] });
    }

    // Two more roads or fewer take the Longest Road.
    const lr = longestRoadPlan(ctx);
    if (lr) {
      const holder = state.longestRoad?.holder;
      const swing = holder && holder === ctx.leader ? 0.6 : 0;
      const value = persona.goals.longestRoad * (2 + swing) + winBonus(ctx, 2);
      const cost = sumCosts(...lr.edges.map(() => COSTS.road));
      add({ key: 'lr', type: 'lr', cost, step: COSTS.road, value, path: lr.edges });
    }

    // With nothing else to do, roads toward the farthest open land.
    if (!goals.length && left.road > 0 && hasResources(hand, COSTS.road)) {
      const edge = legalRoadSpots(state, id)[0];
      if (edge !== undefined) add({ key: 'road', type: 'road', cost: COSTS.road, step: COSTS.road, value: 0.1, path: [edge] });
    }
    return goals;
  });

// The goal for this turn, kept from earlier turns unless another is clearly
// better. `memory.goal` carries the choice between turns.
const planOf = (state, playerId, memory = {}) => {
  const ctx = ctxOf(state, playerId);
  const goals = goalsOf(ctx);
  if (!goals.length) {
    memory.goal = null;
    return { ctx, goal: null, goals };
  }
  const top = pickBest(goals, (goal) => goal.score, { seed: ctx.seed, keyOf: (goal) => goal.key });
  const kept = memory.goal && goals.find((goal) => goal.key === memory.goal.key);
  const goal = kept && kept.score * HYSTERESIS >= top.score ? kept : top;
  memory.goal = { key: goal.key };
  return { ctx, goal, goals };
};

// The move that advances a goal now, if the hand pays for it.
const stepFor = (ctx, goal) => {
  const { state, id, hand } = ctx;
  if (!goal || !hasResources(hand, goal.step)) return null;
  switch (goal.type) {
    case 'city':
      return canBuildCity(state, id, goal.vertexId) ? { type: 'build-city', vertexId: goal.vertexId } : null;
    case 'settlement':
      if (goal.path.length) return canPlaceRoad(state, id, goal.path[0]) ? { type: 'place-road', edgeId: goal.path[0] } : null;
      return canPlaceSettlement(state, id, goal.vertexId) ? { type: 'place-settlement', vertexId: goal.vertexId } : null;
    case 'dev':
      return deckSize(state) > 0 ? { type: 'buy-dev' } : null;
    case 'lr':
    case 'road':
      return canPlaceRoad(state, id, goal.path[0]) ? { type: 'place-road', edgeId: goal.path[0] } : null;
    default:
      return null;
  }
};

// Something else the hand affords that hardly slows the goal down.
const sideBuild = (ctx, goal, goals) => {
  const base = goal ? goal.turns : 0;
  const options = goals
    .filter((other) => other !== goal && hasResources(ctx.hand, other.step))
    .map((other) => {
      const finishes = other.type === 'city' || other.type === 'dev' || (other.type === 'settlement' && !other.path.length);
      const delay = goal ? turnsFor(ctx, goal.cost, without(ctx.hand, other.step)) - base : 0;
      const loss = goal ? (goal.value * Math.max(0, delay)) / (1 + base) : 0;
      // A road toward a second site is only part of its value.
      const worth = finishes ? other.value : (other.value * 0.35) / Math.max(1, other.path.length);
      return { other, net: worth - loss * 1.2 };
    })
    .filter(({ net }) => net > 0.05);
  const pick = pickBest(options, ({ net }) => net, { seed: ctx.seed, keyOf: ({ other }) => other.key });
  return pick ? stepFor(ctx, pick.other) : null;
};

// ------------------------------------------------------------ trading

const missingOf = (hand, cost) => RESOURCES.filter((r) => (hand[r] || 0) < (cost[r] || 0));

// A bank trade toward the goal: when it completes the goal (or its next
// step) this turn, for a cheap 2:1 harbour trade of true surplus, or to
// shrink a hand that a 7 would cut in half.
const seaTrade = (ctx, goal, memory) => {
  if (!goal || (memory.maritime || 0) >= MAX_SEA_TRADES) return null;
  const { state, hand, rates } = ctx;
  const got = memory.seaGot || [];
  const aim = [goal.cost, goal.step].find((cost) => !hasResources(hand, cost) && affordableWithTrades(hand, cost, rates));
  const cost = aim || goal.cost;
  const wants = missingOf(hand, cost).filter((r) => state.bank[r] > 0);
  if (!wants.length) return null;
  const crowded = handSize(hand) > handLimitOf(state);
  // Only cards the whole goal can spare go, and a card bought this turn goes
  // back only to finish the goal, never in circles.
  const spare = (r) => (hand[r] || 0) - Math.max(cost[r] || 0, goal.cost[r] || 0);
  const gives = RESOURCES.filter(
    (r) => !wants.includes(r) && (aim || !got.includes(r)) && spare(r) >= rates[r],
  ).filter((r) => aim || crowded || rates[r] <= 2);
  if (!gives.length) return null;
  const give = gives.reduce((a, b) => {
    const spareA = spare(a) / rates[a];
    const spareB = spare(b) / rates[b];
    return spareB > spareA || (spareB === spareA && ctx.weights[b] < ctx.weights[a]) ? b : a;
  });
  const get = wants.reduce((a, b) => ((cost[b] || 0) - hand[b] > (cost[a] || 0) - hand[a] ? b : a));
  memory.seaGot = [...got, get];
  return { type: 'maritime', give, get };
};

// Whether a trade would let a player build something they could not before,
// judged on their estimated hand.
const completesFor = (state, playerId, gets, pays) => {
  const before = estimatedHand(state, playerId);
  const after = addResources(addResources(before, gets), pays, -1);
  const can = (hand, cost) => RESOURCES.every((r) => (hand[r] || 0) + 0.35 >= (cost[r] || 0));
  return ['settlement', 'city'].some((piece) => can(after, COSTS[piece]) && !can(before, COSTS[piece]));
};

const partnerGain = (ctx, partner, gets, pays) => {
  if (!partner) return 0;
  const threat = threatOf(ctx, partner);
  return completesFor(ctx.state, partner, gets, pays) ? 0.5 * threat : 0.08 * threat * resourceCount(gets);
};

// An offer to one opponent: a spare card (or two) for a card the goal
// lacks, when that saves real time and beats the bank. Never to a player
// near a win, never the same offer twice in a turn.
const offerTrade = (ctx, goal, memory) => {
  if (!goal || hasResources(ctx.hand, goal.cost) || goal.turns > 5) return null;
  const { state, hand, rates } = ctx;
  const offers = memory.offers || [];
  if (offers.length >= Math.round(3 * ctx.persona.trade)) return null;

  const wants = missingOf(hand, goal.cost);
  for (const want of wants) {
    for (const count of [1, 2]) {
      const options = RESOURCES.filter((r) => r !== want && (hand[r] || 0) - (goal.cost[r] || 0) >= count && count < rates[r])
        .map((give) => {
          const after = addResources(addResources(hand, { [give]: count }, -1), { [want]: 1 });
          return { give, saved: goal.turns - turnsFor(ctx, goal.cost, after) };
        })
        .filter(({ saved }) => saved >= (count === 1 ? 0.3 : 1));
      const option = pickBest(options, ({ saved }) => saved, { seed: ctx.seed, keyOf: ({ give }) => give });
      if (!option) continue;
      const partners = ctx.others
        .filter((other) => handSize(state.hands[other]) > 0 && ctx.vp[other] < ctx.target - 2)
        .map((other) => ({ other, holds: estimatedHand(state, other)[want] }))
        .filter(({ other, holds }) => holds >= 0.9 && !(ctx.vp[other] >= ctx.target - 3 && completesFor(state, other, { [option.give]: count }, { [want]: 1 })))
        .sort((a, b) => b.holds - a.holds || ctx.vp[a.other] - ctx.vp[b.other]);
      for (const { other } of partners) {
        const key = `${other}:${count}${option.give}:${want}`;
        if (offers.includes(key)) continue;
        memory.offers = [...offers, key];
        return { type: 'trade-propose', give: { [option.give]: count }, get: { [want]: 1 }, to: other };
      }
    }
  }
  return null;
};

// How much an offer is worth to this seat: turns it saves toward its goals,
// less what the partner gains. `blocked` when it cannot pay, the partner is
// near a win, or the trade would complete a build for a player within
// three points of winning (bots only count visible points).
export const tradeValue = (state, playerId, trade) => {
  if (isCasual(state, playerId)) return Casual.tradeValue(state, playerId, trade);
  const receiving = trade.from === playerId ? trade.get : trade.give;
  const paying = trade.from === playerId ? trade.give : trade.get;
  const partner = trade.from === playerId ? trade.to : trade.from;
  const hand = state.hands[playerId];
  if (!hasResources(hand, paying)) return { blocked: true, margin: -Infinity };

  const target = victoryPointsOf(state);
  if (partner) {
    const points = publicPoints(state, partner);
    if (points >= target - 2) return { blocked: true, margin: -Infinity };
    if (points >= target - 3 && completesFor(state, partner, paying, receiving)) return { blocked: true, margin: -Infinity };
  }

  const { ctx, goal, goals } = planOf(state, playerId, {});
  const after = addResources(addResources(ctx.hand, paying, -1), receiving);
  const saved = (g) => (g ? g.turns - turnsFor(ctx, g.cost, after) : 0);
  const second = goals.filter((g) => g !== goal).sort((a, b) => b.score - a.score)[0];
  const sizeDelta = resourceCount(receiving) - resourceCount(paying);
  const margin =
    saved(goal) + 0.3 * saved(second) + 0.05 * sizeDelta - partnerGain(ctx, partner, paying, receiving) - 0.1 / ctx.persona.trade;
  return { blocked: false, margin };
};

// Answers an offer from the player whose turn it is.
export const acceptsTrade = (state, playerId, trade) => {
  const { blocked, margin } = tradeValue(state, playerId, trade);
  return !blocked && margin > 0;
};

// ---------------------------------------------------- development cards

const playableOf = (state, playerId) =>
  state.devPlayedThisTurn
    ? []
    : (state.devCards[playerId] || []).filter((card) => card.type !== 'victoryPoint' && card.boughtTurn !== state.turnCount);

const takesArmy = (state, playerId) => {
  const mine = (state.knights[playerId] || 0) + 1;
  const holder = state.largestArmy;
  if (holder === playerId || mine < 3) return false;
  return !holder || mine > (state.knights[holder] || 0);
};

// What the robber costs this seat where it stands, in weighted pips.
const robberCost = (ctx) => {
  const { state, id } = ctx;
  const hex = state.board.hexes[state.board.robber];
  const resource = resourceOf(hex);
  if (!resource || !hex.number) return 0;
  return geoOf(state).hexes[hex.id].vertices.reduce((sum, v) => {
    const building = state.buildings[v];
    if (building?.owner !== id) return sum;
    return sum + pipsOf(hex) * (building.type === 'city' ? 2 : 1) * ctx.weights[resource];
  }, 0);
};

// The two Year of Plenty cards that bring the goal closest.
const plentyPicks = (ctx, goal) => {
  const { state, hand } = ctx;
  const cost = goal ? goal.cost : COSTS.city;
  let best = null;
  RESOURCES.forEach((a, i) =>
    RESOURCES.slice(i).forEach((b) => {
      const want = addResources(zeroHand(), a === b ? { [a]: 2 } : { [a]: 1, [b]: 1 });
      if (!hasResources(state.bank, want)) return;
      const after = addResources(hand, want);
      const turns = turnsFor(ctx, cost, after);
      const tiebreak = ctx.weights[a] + ctx.weights[b];
      if (!best || turns < best.turns - 1e-6 || (Math.abs(turns - best.turns) < 1e-6 && tiebreak > best.tiebreak)) {
        best = { picks: [a, b], turns, tiebreak };
      }
    }),
  );
  return best;
};

// The resource a Monopoly should name, and how many cards it should bring.
const monopolyPick = (ctx, goal) => {
  const { state } = ctx;
  const taken = zeroHand();
  ctx.others.forEach((other) => {
    const est = estimatedHand(state, other);
    RESOURCES.forEach((r) => {
      taken[r] += est[r];
    });
  });
  const need = goal ? goal.cost : {};
  const scoreOf = (r) => {
    const short = Math.max(0, (need[r] || 0) - (ctx.hand[r] || 0));
    const useful = Math.min(short, taken[r]) + (taken[r] - Math.min(short, taken[r])) / ctx.rates[r];
    return useful * ctx.weights[r];
  };
  const resource = pickBest(RESOURCES, scoreOf, { seed: ctx.seed });
  return { resource, take: taken[resource], score: scoreOf(resource) };
};

// The development card worth playing now, if any (one per turn).
const devPlay = (ctx, goal) => {
  const { state, id } = ctx;
  const playable = playableOf(state, id);
  if (!playable.length) return null;
  const has = (type) => playable.some((card) => card.type === type);
  const options = [];

  if (has('knight')) {
    let value = 0.45 + robberCost(ctx) * 0.06;
    if (takesArmy(state, id)) value += 2 * ctx.persona.goals.army + winBonus(ctx, 2);
    options.push({ value, action: { type: 'play-dev', card: 'knight' } });
  }
  if (has('monopoly')) {
    const pick = monopolyPick(ctx, goal);
    const after = addResources(ctx.hand, { [pick.resource]: Math.floor(pick.take) });
    const wins = goal && goal.value >= WIN_BONUS && affordableWithTrades(after, goal.cost, ctx.rates);
    if (pick.take >= 4 || wins) options.push({ value: wins ? WIN_BONUS : 0.3 * pick.score, action: { type: 'play-dev', card: 'monopoly', resource: pick.resource } });
  }
  if (has('yearOfPlenty') && goal) {
    const pick = plentyPicks(ctx, goal);
    if (pick && (pick.turns === 0 || goal.turns - pick.turns >= 1)) {
      const value = (goal.value / (1 + pick.turns) - goal.score) + (pick.turns === 0 ? 0.3 : 0);
      options.push({ value: Math.max(0.3, value), action: { type: 'play-dev', card: 'yearOfPlenty', resources: pick.picks } });
    }
  }
  if (has('roadBuilding') && ctx.left.road > 0 && legalRoadSpots(state, id).length) {
    const road = goal && (goal.type === 'settlement' || goal.type === 'lr') && goal.path.length ? goal : null;
    if (road) options.push({ value: road.type === 'lr' ? road.value : 0.8 + 0.2 * Math.min(2, road.path.length), action: { type: 'play-dev', card: 'roadBuilding' } });
  }
  const pick = pickBest(options, (option) => option.value, { seed: ctx.seed, keyOf: (option) => option.action.card });
  return pick && pick.value >= 0.4 ? pick.action : null;
};

// ------------------------------------------------------- seven safety

// With more cards than the hand limit at the end of the turn, spend some:
// anything useful to build, else a bank trade toward the goal.
const sevenSafety = (ctx, goal, goals, memory) => {
  const { state, hand, rates } = ctx;
  const limit = handLimitOf(state);
  if (handSize(hand) <= limit || (memory.safety || 0) >= 5) return null;
  // One card over with the goal all but certain next turn: keep them.
  if (goal && goal.turns <= 0.35 && handSize(hand) <= limit + 1) return null;
  memory.safety = (memory.safety || 0) + 1;

  const affordable = goals.filter((other) => hasResources(hand, other.step)).sort((a, b) => b.value - a.value);
  for (const other of affordable) {
    const step = stepFor(ctx, other);
    if (step) return step;
  }
  if ((memory.maritime || 0) >= MAX_SEA_TRADES) return null;
  const want = (goal ? missingOf(hand, goal.cost) : []).find((r) => state.bank[r] > 0) ||
    RESOURCES.filter((r) => state.bank[r] > 0).sort((a, b) => hand[a] - hand[b] || ctx.weights[b] - ctx.weights[a])[0];
  const give = RESOURCES.filter((r) => r !== want && hand[r] >= rates[r] && !(memory.seaGot || []).includes(r)).sort(
    (a, b) => hand[b] - (goal?.cost[b] || 0) - (hand[a] - (goal?.cost[a] || 0)),
  )[0];
  if (!want || !give) return null;
  memory.seaGot = [...(memory.seaGot || []), want];
  return { type: 'maritime', give, get: want };
};

// ----------------------------------------------------------- the turn

// The next move a bot makes in its trade/build phase, or null to end the
// turn. Called repeatedly until it returns null. `memory` lives for the
// turn, except `memory.goal`, which the engine carries between turns.
export const nextAction = (state, playerId, memory = {}) => {
  if (isCasual(state, playerId)) return Casual.nextAction(state, playerId, memory);
  const { ctx, goal, goals } = planOf(state, playerId, memory);
  return (
    devPlay(ctx, goal) ||
    stepFor(ctx, goal) ||
    sideBuild(ctx, goal, goals) ||
    seaTrade(ctx, goal, memory) ||
    offerTrade(ctx, goal, memory) ||
    sevenSafety(ctx, goal, goals, memory) ||
    null
  );
};

// A bank trade that brings the goal closer.
export const maritimeToward = (state, playerId, goal) => {
  if (isCasual(state, playerId)) return Casual.maritimeToward(state, playerId, goal);
  const plan = planOf(state, playerId, {});
  return seaTrade(plan.ctx, plan.goal, {});
};

export const chooseGoal = (state, playerId) => (isCasual(state, playerId) ? Casual.chooseGoal(state, playerId) : planOf(state, playerId, {}).goal);

// The next road toward the goal: a site or the Longest Road.
export const roadTowardSite = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.roadTowardSite(state, playerId);
  const { ctx, goal, goals } = planOf(state, playerId, {});
  const roads = [goal, ...goals.filter((g) => g !== goal).sort((a, b) => b.score - a.score)].filter(
    (g) => g && g.path.length && canPlaceRoad(state, playerId, g.path[0]),
  );
  if (roads.length) return roads[0].path[0];
  const edges = ctx.left.road > 0 ? legalRoadSpots(state, playerId) : [];
  if (!edges.length) return null;
  // Otherwise the road that stretches the longest road furthest.
  return pickBest(edges, (edge) => longestRoadLength(roadsWith(state, playerId, [edge]), playerId), { seed: ctx.seed });
};

export const bestSettlementSpot = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.bestSettlementSpot(state, playerId);
  const ctx = ctxOf(state, playerId);
  const spots = legalSettlementSpots(state, playerId);
  return pickBest(spots, (v) => spotPips(ctx, v) + harbourValue(ctx, v) / Math.max(0.01, ctx.pipWorth), { seed: ctx.seed }) ?? null;
};

export const bestCitySpot = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.bestCitySpot(state, playerId);
  const ctx = ctxOf(state, playerId);
  return pickBest(legalCitySpots(state, playerId), (v) => spotPips(ctx, v), { seed: ctx.seed }) ?? null;
};

export const chooseYearOfPlenty = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.chooseYearOfPlenty(state, playerId);
  const { ctx, goal } = planOf(state, playerId, {});
  return plentyPicks(ctx, goal)?.picks || Casual.chooseYearOfPlenty(state, playerId);
};

export const chooseMonopoly = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.chooseMonopoly(state, playerId);
  const { ctx, goal } = planOf(state, playerId, {});
  return monopolyPick(ctx, goal).resource;
};

// Plays a Knight before rolling when the robber sits on a hex that matters
// to this seat, or when the knight takes the Largest Army for the win.
export const wantsKnightBeforeRoll = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.wantsKnightBeforeRoll(state, playerId);
  if (!playableOf(state, playerId).some((card) => card.type === 'knight')) return false;
  const ctx = ctxOf(state, playerId);
  if (takesArmy(state, playerId) && winBonus(ctx, 2)) return true;
  return robberCost(ctx) >= 3;
};

export const robberOnMe = Casual.robberOnMe;

// ------------------------------------------------------------- discard

// The card whose loss slows the goals least.
const leastNeeded = (ctx, hand, goal, second) => {
  let pick = null;
  RESOURCES.filter((r) => hand[r] > 0).forEach((r) => {
    const after = { ...hand, [r]: hand[r] - 1 };
    const cost = (g) => (g ? turnsFor(ctx, g.cost, after) : 0);
    const penalty = cost(goal) + 0.3 * cost(second) + 0.02 * ctx.weights[r] - 0.01 * hand[r];
    if (!pick || penalty < pick.penalty) pick = { r, penalty };
  });
  return pick.r;
};

// Keeps what the goal needs and throws away what slows it least.
export const chooseDiscard = (state, playerId, committed = null) => {
  if (isCasual(state, playerId)) return Casual.chooseDiscard(state, playerId);
  const count = state.pendingDiscards?.[playerId] ?? discardCount(state.hands[playerId], handLimitOf(state));
  const { ctx, goal, goals } = planOf(state, playerId, { goal: committed });
  const second = goals.filter((g) => g !== goal).sort((a, b) => b.score - a.score)[0];
  let hand = { ...ctx.hand };
  const discard = {};
  for (let i = 0; i < count; i += 1) {
    const resource = leastNeeded(ctx, hand, goal, second);
    hand = { ...hand, [resource]: hand[resource] - 1 };
    discard[resource] = (discard[resource] || 0) + 1;
  }
  return discard;
};

// -------------------------------------------------------------- robber

// Where the robber hurts the table most: lost production of each opponent,
// weighted by how close they are to winning and how much they need it,
// less this seat's own loss, plus the value of the steal.
export const rankRobberHexes = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.rankRobberHexes(state, playerId);
  const ctx = ctxOf(state, playerId);
  const geo = geoOf(state);
  const prodOf = {};
  const prodFor = (other) => {
    if (!prodOf[other]) prodOf[other] = production(state, other, { robberFactor: 1 });
    return prodOf[other];
  };
  return state.board.hexes
    .filter((hex) => hex.id !== state.board.robber)
    .map((hex) => {
      const resource = resourceOf(hex);
      const pips = resource ? pipsOf(hex) : 0;
      let score = 0;
      geo.hexes[hex.id].vertices.forEach((v) => {
        const building = state.buildings[v];
        if (!building) return;
        const weight = building.type === 'city' ? 2 : 1;
        if (building.owner === playerId) {
          score -= 2.5 * pips * weight;
          return;
        }
        // Blocking the only source of a resource hurts more, and so does
        // blocking what the leader is visibly short of.
        const theirs = prodFor(building.owner)[resource] || 0;
        const sole = resource && theirs <= ((pips * weight) / 36) * 1.01 ? 1.35 : 1;
        const short = building.owner === ctx.leader && resource && estimatedHand(state, ctx.leader)[resource] < 1 ? 1.2 : 1;
        score += pips * weight * threatOf(ctx, building.owner) * sole * short;
      });
      const victims = robberVictims(state, hex.id, playerId);
      if (victims.length) score += 1.5 + Math.max(...victims.map((victim) => stealValue(ctx, victim)));
      return { hexId: hex.id, score: score * (1 + (seededUnit(ctx.seed, hex.id) - 0.5) * 0.01) };
    })
    .sort((a, b) => b.score - a.score);
};

export const chooseRobberHex = (state, playerId) => rankRobberHexes(state, playerId)[0].hexId;

// How likely a steal from this player brings something this seat needs.
const stealValue = (ctx, victim) => {
  const { state } = ctx;
  const size = handSize(state.hands[victim]);
  if (!size) return 0;
  const est = estimatedHand(state, victim);
  const { goal } = planOf(state, ctx.id, {});
  const need = goal ? goal.cost : COSTS.city;
  const useful = RESOURCES.reduce((sum, r) => {
    const short = (need[r] || 0) > (ctx.hand[r] || 0) ? 1 : 0.3;
    return sum + (est[r] / size) * short * ctx.weights[r];
  }, 0);
  return 2 * useful + 0.5 * threatOf(ctx, victim) + 0.02 * Math.min(size, 10);
};

// Steals from whoever most likely holds what this seat needs; between
// equals, from the leader.
export const chooseVictim = (state, playerId, victims) => {
  if (isCasual(state, playerId)) return Casual.chooseVictim(state, playerId, victims);
  const ctx = ctxOf(state, playerId);
  return pickBest(victims, (victim) => stealValue(ctx, victim), { seed: ctx.seed, closeness: 0.01 });
};

// ------------------------------------------------------------- set-up

// What a set-up intersection is worth to this seat: expected production
// times variety, numbers it does not have yet, resources the first
// settlement lacks, a harbour that suits its production, a little for
// denying the spot to others and for room to grow.
const setupScore = (state, playerId, vertexId) => {
  const ctx = ctxOf(state, playerId);
  const geo = geoOf(state);
  const scarcity = scarcityOf(state.board);
  const mine = scale(production(state, playerId, { robberFactor: 1 }), 36);
  const myNumbers = new Set();
  Object.entries(state.buildings).forEach(([v, building]) => {
    if (building.owner !== playerId) return;
    geo.vertices[v].hexes.forEach((hexId) => state.board.hexes[hexId].number && myNumbers.add(state.board.hexes[hexId].number));
  });
  const placed = myNumbers.size > 0 || Object.values(state.buildings).some((b) => b.owner === playerId);
  const weight = (r) => BASE_WEIGHTS[r] * scarcity[r] * ctx.persona.resources[r];

  let ev = 0;
  let raw = 0;
  const here = new Set();
  const numbers = [];
  geo.vertices[vertexId].hexes.forEach((hexId) => {
    const hex = state.board.hexes[hexId];
    const resource = resourceOf(hex);
    if (!resource || !hex.number) return;
    ev += pipsOf(hex) * weight(resource);
    raw += pipsOf(hex);
    here.add(resource);
    numbers.push(hex.number);
  });

  let score = ev * (1 + 0.08 * here.size);
  // Number spread: the same number twice rises and falls together.
  numbers.forEach((n) => {
    if (myNumbers.has(n)) score -= 0.3 * PIPS[n];
  });
  if (new Set(numbers).size < numbers.length) score -= 0.5;

  if (placed) {
    RESOURCES.forEach((r) => {
      if (here.has(r) && mine[r] === 0) score += 1.3 * weight(r);
    });
    const after = new Set([...RESOURCES.filter((r) => mine[r] > 0), ...here]);
    if (after.has('brick') && after.has('lumber')) score += 1;
    if (after.has('ore') && after.has('grain')) score += 1;
    // Starting cards: a road on the first turn is worth something.
    if (here.has('brick') && here.has('lumber')) score += 0.4;
  }

  const harbour = harbourAt(state, vertexId);
  if (harbour) {
    const made = addResources(mine, vertexPips(state, vertexId));
    if (harbour.type === 'any') score += 0.05 * RESOURCES.reduce((sum, r) => sum + made[r], 0) * ctx.persona.harbour;
    else score += Math.max(0, made[harbour.type] - 4) * 0.3 * ctx.persona.harbour;
  }

  score += (placed ? 0.04 : 0.1) * raw;

  // Room to grow: the best open intersection two roads away.
  let room = 0;
  const near = new Set(geo.vertices[vertexId].neighbours);
  geo.vertices[vertexId].neighbours.forEach((n1) =>
    geo.vertices[n1].neighbours.forEach((n2) => {
      if (n2 === vertexId || near.has(n2) || state.buildings[n2] || !distanceRuleOk(state, n2)) return;
      const pips = vertexPips(state, n2);
      room = Math.max(room, RESOURCES.reduce((sum, r) => sum + pips[r] * weight(r), 0));
    }),
  );
  return score + 0.12 * room;
};

export const rankSetupSettlements = (state, playerId) => {
  if (isCasual(state, playerId)) return Casual.rankSetupSettlements(state, playerId);
  const seed = `${playerId}|setup|${state.setup?.step ?? 0}`;
  return legalSettlementSpots(state, playerId, { setup: true })
    .map((vertexId) => ({
      vertexId,
      score: setupScore(state, playerId, vertexId) * (1 + (seededUnit(seed, vertexId) - 0.5) * 0.01),
    }))
    .sort((a, b) => b.score - a.score);
};

export const chooseSetupSettlement = (state, playerId) => rankSetupSettlements(state, playerId)[0]?.vertexId ?? null;

// The set-up road points at the best site it can reach that nobody else is
// likely to take first.
export const chooseSetupRoad = (state, playerId, fromVertex) => {
  if (isCasual(state, playerId)) return Casual.chooseSetupRoad(state, playerId, fromVertex);
  const ctx = ctxOf(state, playerId);
  const geo = geoOf(state);
  const rivals = rivalDist(ctx);
  const placementsLeft = state.setup ? state.setup.order.length - state.setup.step - 1 : 0;
  const siteValue = (v, far) => {
    if (state.buildings[v] || !distanceRuleOk(state, v) || geo.vertices[fromVertex].neighbours.includes(v)) return 0;
    let value = setupScore(state, playerId, v) * far;
    if (rivals[v] <= 1) value *= 0.5;
    // A rich site is likely taken by the set-up placements still to come.
    if (placementsLeft > 0) value *= 1 - Math.min(0.4, 0.04 * placementsLeft);
    return value;
  };
  const options = legalRoadSpots(state, playerId, { fromVertex });
  return pickBest(
    options,
    (edgeId) => {
      const [a, b] = geo.edges[edgeId].vertices;
      const end = a === fromVertex ? b : a;
      let reach = 0;
      geo.vertices[end].neighbours.forEach((w) => {
        if (w === fromVertex) return;
        reach = Math.max(reach, siteValue(w, 1));
        geo.vertices[w].neighbours.forEach((x) => x !== end && (reach = Math.max(reach, siteValue(x, 0.7))));
      });
      return reach + geo.vertices[end].hexes.length * 0.3;
    },
    { seed: `${playerId}|road|${fromVertex}` },
  );
};
