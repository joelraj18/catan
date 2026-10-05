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

const SYSTEM_PROMPT = `You are a shrewd but good natured opponent in Catan, the island settling board game.
Players collect brick, lumber, ore, grain and wool when the dice roll the numbers of hexes next to their settlements (1 card) and cities (2 cards).
They build roads, settlements and cities and buy development cards. The first player to ${WINNING_POINTS} victory points on their own turn wins.
Numbers 6 and 8 roll most often, then 5 and 9, and 2 and 12 rarely. Variety of resources, good numbers and harbours matter.
Put the robber where it hurts the leader most and never on your own hexes. Do not feed a player who is close to winning.
You choose one of the numbered options you are given. Reply only with the requested JSON.
The comment is short friendly table talk of at most 12 words, with no full stops, dashes or underscores.`;

const CHOICE_SCHEMA = {
  type: 'object',
  properties: {
    choice: { type: 'integer' },
    comment: { type: 'string' },
  },
  required: ['choice', 'comment'],
  additionalProperties: false,
};

const INSTRUCTIONS = {
  setup: 'Choose where to place your starting settlement.',
  robber: 'You move the robber. Choose the hex to block.',
  turn: 'It is your trade and build phase. Choose what to do next.',
  trade: 'Another player offers you a trade. Choose whether to accept.',
};

// A compact, factual view of the table for one decision. Only this seat's
// own cards are included; opponents show counts and public points.
const describeTable = (playerId, state) => {
  const view = redactFor(state, playerId);
  const hexLabel = (hexId) => {
    const hex = view.board.hexes[hexId];
    return `${hex.terrain}${hex.number ? ` ${hex.number}` : ''}`;
  };
  const buildingsOf = (id) =>
    Object.entries(view.buildings)
      .filter(([, building]) => building.owner === id)
      .map(([vertexId, building]) => `${building.type} on ${GEOMETRY.vertices[vertexId].hexes.map(hexLabel).join(' + ')}`);

  return {
    turn: view.turnCount,
    pointsToWin: WINNING_POINTS,
    robberOn: hexLabel(view.board.robber),
    you: {
      points: publicPoints(view, playerId) + (view.devCards[playerId] || []).filter((card) => card.type === 'victoryPoint').length,
      hand: view.hands[playerId],
      developmentCards: (view.devCards[playerId] || []).map((card) => card.type),
      knightsPlayed: view.knights[playerId] || 0,
      buildings: buildingsOf(playerId),
      longestRoad: view.longestRoad.lengths[playerId] || 0,
    },
    opponents: view.players
      .filter((player) => player.id !== playerId)
      .map((player) => ({
        name: player.name,
        visiblePoints: publicPoints(view, player.id),
        cards: visibleHandSize(view.hands[player.id]),
        developmentCards: (view.devCards[player.id] || []).length,
        knightsPlayed: view.knights[player.id] || 0,
        buildings: buildingsOf(player.id),
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

// The advisor the game engine calls for AI opponents. The engine passes a
// short list of legal options, best first by its own strategy; the answer
// is the index of one of them. Returns null to let the engine fall back to
// the built in strategy.
export const premiumAdvisor = async ({ kind, playerId, state, options }) => {
  if (!apiKey || !Array.isArray(options) || options.length < 2) {
    return null;
  }

  const context = {
    ...describeTable(playerId, state),
    options: options.map((label, index) => ({ choice: index, option: label })),
  };
  const answer = await ask(CHOICE_SCHEMA, INSTRUCTIONS[kind] || 'Choose one of the options.', context);

  if (!answer) {
    return null;
  }

  const choice = Number(answer.choice);
  return {
    choice: Number.isInteger(choice) && choice >= 0 && choice < options.length ? choice : 0,
    comment: tidyComment(answer.comment),
  };
};
