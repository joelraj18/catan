// Premium AI opponents powered by the Claude API, using the player's own key.
//
// Key handling rules, enforced by keeping everything inside this module:
// - The key lives only in the `apiKey` variable below, in this tab's memory.
// - It is never written to localStorage, sessionStorage, IndexedDB, cookies,
//   the URL, React state, logs or any room message, so other players never
//   receive it and nothing survives a reload or closing the tab.
// - Requests go straight from this browser to api.anthropic.com.

import Anthropic from '@anthropic-ai/sdk';
import * as Estate from '../pages/Game/estate';
import { BOARD_SPACES } from '../pages/Game/boardData';
import { TOTAL_MATCH_TURNS } from '../pages/Game/matchRules';

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

const SYSTEM_PROMPT = `You are a shrewd but good natured opponent in Manapally, a South Indian property strategy board game.
Players buy districts, express stations and utilities, collect rent, and build houses and a hotel once they own a full colour family.
The winner is the player with the highest total net worth (cash plus property value) when the turn limit is reached or when everyone else is bankrupt.
Keep enough cash to survive rent. Completing colour families and owning several express stations is valuable.
Reply only with the requested JSON. The comment is short friendly table talk of at most 12 words, with no full stops, dashes or underscores.`;

const PURCHASE_SCHEMA = {
  type: 'object',
  properties: {
    buy: { type: 'boolean' },
    comment: { type: 'string' },
  },
  required: ['buy', 'comment'],
  additionalProperties: false,
};

const BID_SCHEMA = {
  type: 'object',
  properties: {
    maxBid: { type: 'integer' },
    comment: { type: 'string' },
  },
  required: ['maxBid', 'comment'],
  additionalProperties: false,
};

// A compact, factual view of the table for one decision.
const describeTable = (playerId, space, state) => {
  const group =
    space.type === 'property'
      ? Estate.getGroupSpaceIds(space.id, BOARD_SPACES)
      : BOARD_SPACES.filter((entry) => entry.type === space.type).map((entry) => entry.id);

  return {
    turn: state.turnCount,
    turnLimit: TOTAL_MATCH_TURNS,
    space: {
      name: space.name,
      kind: space.type,
      colourFamily: space.colorGroup || null,
      price: space.price,
      familySize: group.length,
      familyOwnedByYou: group.filter((id) => state.deeds[id]?.owner === playerId).length,
      familyOwnedByOthers: group.filter((id) => state.deeds[id] && state.deeds[id].owner !== playerId).length,
    },
    you: {
      cash: state.balances[playerId],
      netWorth: Estate.netWorth(playerId, state.balances, state.deeds, BOARD_SPACES),
      holdings: Object.entries(state.deeds)
        .filter(([, deed]) => deed.owner === playerId)
        .map(([id]) => BOARD_SPACES[id].name),
    },
    opponents: state.players
      .filter((player) => player.id !== playerId && !state.bankrupt[player.id])
      .map((player) => ({
        name: player.name,
        cash: state.balances[player.id],
        netWorth: Estate.netWorth(player.id, state.balances, state.deeds, BOARD_SPACES),
      })),
  };
};

const ask = async (schema, instruction, context) => {
  const response = await getClient().beta.messages.create({
    model: PREMIUM_MODEL,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${instruction}\n\n${JSON.stringify(context)}` }],
  });

  if (response.stop_reason === 'refusal') {
    return null;
  }

  const text = response.content.find((block) => block.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
};

const tidyComment = (comment) =>
  typeof comment === 'string' ? comment.replace(/[._\-–—]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) : '';

// The advisor the game engine calls for AI opponents. Returns null to let the
// engine fall back to the built in strategy.
export const premiumAdvisor = async ({ kind, playerId, space, state }) => {
  if (!apiKey) {
    return null;
  }

  const context = describeTable(playerId, space, state);

  if (kind === 'purchase') {
    const answer = await ask(
      PURCHASE_SCHEMA,
      `You landed on ${space.name}. Decide whether to buy it at the listed price.`,
      context,
    );

    return answer ? { buy: Boolean(answer.buy), comment: tidyComment(answer.comment) } : null;
  }

  const answer = await ask(
    BID_SCHEMA,
    `${space.name} is up for auction. Give the most you would pay, 0 to stay out. Bids move in steps of 10000.`,
    context,
  );

  return answer
    ? { maxBid: Math.max(0, Number(answer.maxBid) || 0), comment: tidyComment(answer.comment) }
    : null;
};
