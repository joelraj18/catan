// Premium AI opponents powered by the Claude API, using the player's own key.
//
// Key handling rules, enforced by keeping everything inside this module:
// - The key lives only in the `apiKey` variable below, in this tab's memory.
// - It is never written to localStorage, sessionStorage, IndexedDB, cookies,
//   the URL, React state, logs or any room message, so other players never
//   receive it and nothing survives a reload or closing the tab.
// - Requests go straight from this browser to api.anthropic.com.

import Anthropic from '@anthropic-ai/sdk';
import { GEOMETRY } from '../pages/Game/catanBoard';
import { WINNING_POINTS, publicPoints, redactFor, visibleHandSize } from '../pages/Game/catanRules';

export const PREMIUM_MODEL = 'claude-opus-5-5';
export const PREMIUM_PROVIDER = 'Anthropic Claude API';
export const PREMIUM_MODEL_LABEL = 'Claude Opus';

let apiKey = null;
let client = null;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(Boolean(apiKey)));

export const setPremiumKey = (key) => {
  const clean = String(key || '').trim();
  apiKey = clean || null;
  client = null;
  notify();
  return Boolean(apiKey);
};

export const clearPremiumKey = () => {
  apiKey = null;
  client = null;
  notify();
};

export const hasPremiumKey = () => Boolean(apiKey);

export const onPremiumKeyChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const getClient = () => {
  if (!apiKey) {
    throw new Error('No premium key');
  }

  if (!client) {
    client = new Anthropic({
      apiKey,
      // This is a static site with no server of its own, so the request has
      // to come from the browser. The key belongs to the person at this
      // keyboard and is only ever sent to Anthropic.
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: 20000,
    });
  }

  return client;
};

// Checks the key with Anthropic through the free models endpoint, so a typo
// shows up in the waiting room rather than mid match.
// Resolves to 'valid', 'invalid' or 'unreachable'.
export const verifyPremiumKey = async () => {
  try {
    await getClient().models.list({ limit: 1 });
    return 'valid';
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return 'invalid';
    }

    return 'unreachable';
  }
};

// How the premium AI plays, and why it is cheap to run:
// - The engine's own strategy ranks the legal moves first. Claude is only
//   asked when a choice really matters: where to found the two starting
//   settlements, where to put the robber when the top spots are close, one
//   plan per turn for what to build or buy (in order), and trade offers the
//   computer cannot call clearly. Everything else plays at once, free.
// - Each request is small: a fixed rules prompt and the board (both cached
//   for the whole game), then a few compact lines of what changed and a
//   numbered option list. Claude answers with a short JSON plan.
// - It only ever sees its own cards; opponents appear as card counts and
//   visible points, like at a real table.
// - Any error, refusal, timeout or spent budget falls back to the computer's
//   choice, so the game never waits on the network.

const SYSTEM_PROMPT = `You are a shrewd but good natured opponent in Catan, the island settling board game, playing one seat.

Rules in brief
- Hexes produce when their number is rolled: each adjacent settlement gets 1 card, each city 2. Hills give brick, forest lumber, mountains ore, fields grain, pasture wool, the desert nothing. The hex under the robber produces nothing.
- Costs: road = brick + lumber. Settlement = brick + lumber + wool + grain, needs your road and no building on a neighbouring intersection. City = 3 ore + 2 grain, upgrades your settlement. Development card = ore + wool + grain.
- Points: settlement 1, city 2, Longest Road (5+ connected roads) 2, Largest Army (3+ knights played) 2, victory point card 1. The first player to ${WINNING_POINTS} points on their own turn wins.
- A 7 makes everyone with more than 7 cards discard half, then the roller moves the robber and steals a card.
- Maritime trade is 4:1, 3:1 with a generic harbour, 2:1 with a matching special harbour.

How to judge
- Dice odds out of 36: 6 and 8 = 5, 5 and 9 = 4, 4 and 10 = 3, 3 and 11 = 2, 2 and 12 = 1. Value spots by total odds, resource variety and scarcity.
- Early game wants brick and lumber to expand; later ore and grain for cities and development cards. Cities are the most efficient points.
- Holding more than 7 cards risks losing half on a 7; spending is usually better than hoarding.
- Hurt the leader with the robber, never block your own hexes, and do not trade with a player close to winning.

Answering
- You get a short state summary and numbered options that are all legal right now, listed best first by a simple heuristic. Prefer your own judgment when it clearly beats the heuristic.
- Reply only with the JSON asked for: "plan" is a list of option numbers. For a single decision give one number. For a turn plan give the options to carry out in order and end with the number for ending the turn; leave out what you would not do.
- "comment" is short friendly table talk of at most 12 words, with no full stops, dashes or underscores, and never reveals your cards.`;

// One schema for every decision, so the cached prefix never changes.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'array', items: { type: 'integer' } },
    comment: { type: 'string' },
  },
  required: ['plan', 'comment'],
  additionalProperties: false,
};

const INSTRUCTIONS = {
  setup: 'Choose where to found your starting settlement. Give one option number.',
  robber: 'You move the robber. Choose the hex to block. Give one option number.',
  turn: 'Plan your trade and build phase. Give the option numbers to carry out in order, ending with the end turn option.',
  trade: 'The player whose turn it is offers you a trade. Give one option number.',
};

const RES_CODE = { brick: 'B', lumber: 'L', ore: 'O', grain: 'G', wool: 'W' };
const hexName = (hex) => `${hex.terrain}${hex.number ? ` ${hex.number}` : ''}`;

// The island as it stays for the whole game: cached after the first call.
export const describeBoard = (board) => {
  const hexes = board.hexes.map((hex) => `H${hex.id} ${hexName(hex)}`).join(', ');
  const harbours = board.harbors
    .map((harbor) => `${harbor.type === 'any' ? '3:1' : `2:1 ${harbor.type}`} at intersections ${harbor.vertices.join('+')}`)
    .join('; ');
  return `Board, rows of 3-4-5-4-3 hexes from the top left: ${hexes}.\nHarbours: ${harbours}.`;
};

const handCode = (hand) =>
  Object.entries(RES_CODE)
    .map(([resource, code]) => `${code}${hand?.[resource] || 0}`)
    .join(' ');

// What changes from call to call, as a few compact lines. Only this seat's
// own cards are included; opponents show counts and visible points.
export const describeTable = (playerId, state) => {
  const view = redactFor(state, playerId);
  const buildingsOf = (id) =>
    Object.entries(view.buildings)
      .filter(([, building]) => building.owner === id)
      .map(([vertexId, building]) => `${building.type === 'city' ? 'C' : 'S'}${vertexId}(${GEOMETRY.vertices[vertexId].hexes.map((h) => `H${h}`).join('')})`)
      .join(' ');
  const own = view.devCards[playerId] || [];
  const me = [
    `You: ${publicPoints(view, playerId) + own.filter((card) => card.type === 'victoryPoint').length} points`,
    `hand ${handCode(view.hands[playerId])}`,
    `dev ${own.map((card) => card.type).join(',') || 'none'}`,
    `knights ${view.knights[playerId] || 0}`,
    `road ${view.longestRoad.lengths[playerId] || 0}`,
    `built ${buildingsOf(playerId) || 'nothing'}`,
  ].join(' | ');
  const others = view.players
    .filter((player) => player.id !== playerId)
    .map(
      (player) =>
        `${player.name}: ${publicPoints(view, player.id)} points | ${visibleHandSize(view.hands[player.id])} cards | ${(view.devCards[player.id] || []).length} dev | knights ${view.knights[player.id] || 0} | road ${view.longestRoad.lengths[player.id] || 0} | built ${buildingsOf(player.id) || 'nothing'}`,
    );
  const recent = (view.log || []).slice(-3).map((entry) => entry.text);
  return [
    `Robber on H${view.board.robber}. Bank ${handCode(view.bank)}. Development cards left ${typeof view.devDeck === 'number' ? view.devDeck : view.devDeck.length}.`,
    me,
    ...others,
    recent.length ? `Recently: ${recent.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

// Tokens spent per AI seat in this tab, for the usage line in the game.
const usageBySeat = new Map();

export const premiumUsage = (playerId) => usageBySeat.get(playerId) || { calls: 0, input: 0, output: 0, cached: 0 };

export const resetPremiumUsage = () => usageBySeat.clear();

const record = (playerId, usage) => {
  const current = premiumUsage(playerId);
  const next = {
    calls: current.calls + 1,
    input: current.input + (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0),
    output: current.output + (usage?.output_tokens || 0),
    cached: current.cached + (usage?.cache_read_input_tokens || 0),
  };
  usageBySeat.set(playerId, next);
  return next;
};

const ask = async (playerId, board, instruction, context) => {
  const response = await getClient().beta.messages.create({
    model: PREMIUM_MODEL,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      // The rules and this game's board form one stable prefix, so every
      // call after the first reads them from the cache at a tenth of the price.
      { type: 'text', text: describeBoard(board), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: `${instruction}\n\n${context}` }],
  });

  const usage = record(playerId, response.usage);

  if (response.stop_reason === 'refusal') {
    return null;
  }

  const text = response.content.find((block) => block.type === 'text')?.text;
  return text ? { ...JSON.parse(text), usage } : null;
};

const tidyComment = (comment) =>
  typeof comment === 'string' ? comment.replace(/[._\-–—]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) : '';

// Keeps valid, distinct option numbers in order.
export const cleanPlan = (plan, count) => {
  const seen = new Set();
  return (Array.isArray(plan) ? plan : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < count && !seen.has(n) && seen.add(n));
};

// The advisor the game engine calls for AI opponents. The engine passes the
// legal options, best first by its own strategy; the answer is an ordered
// plan of option numbers (one number for a single decision). Returns null
// to let the engine fall back to the built in strategy.
export const premiumAdvisor = async ({ kind, playerId, state, options }) => {
  if (!apiKey || !Array.isArray(options) || options.length < 2) {
    return null;
  }

  const context = `${describeTable(playerId, state)}\n\nOptions:\n${options.map((label, index) => `${index}. ${label}`).join('\n')}`;
  const answer = await ask(playerId, state.board, INSTRUCTIONS[kind] || 'Choose one option number.', context);

  if (!answer) {
    return null;
  }

  const plan = cleanPlan(answer.plan, options.length);
  return {
    plan,
    choice: plan.length ? plan[0] : 0,
    comment: tidyComment(answer.comment),
    usage: answer.usage,
  };
};
