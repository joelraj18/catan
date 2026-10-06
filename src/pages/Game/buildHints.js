import { COSTS, hasResources, legalCitySpots, legalRoadSpots, legalSettlementSpots, piecesLeft } from './catanRules';

export const BUILD_LABELS = { road: 'Road', settlement: 'Settlement', city: 'City', dev: 'Development card' };

// What a hand can pay for right now: the resources, a piece left to place
// and, for a piece, somewhere on the board it may go. A development card
// needs a card left in the deck.
export const affordableBuilds = (state, playerId) => {
  const hand = state?.hands?.[playerId];
  if (!hand || typeof hand.hidden === 'number') return [];
  const pieces = piecesLeft(state, playerId);
  const deckLeft = typeof state.devDeck === 'number' ? state.devDeck : state.devDeck?.length || 0;
  const can = [];
  if (hasResources(hand, COSTS.road) && pieces.road > 0 && legalRoadSpots(state, playerId).length) can.push('road');
  if (hasResources(hand, COSTS.settlement) && pieces.settlement > 0 && legalSettlementSpots(state, playerId).length) can.push('settlement');
  if (hasResources(hand, COSTS.city) && pieces.city > 0 && legalCitySpots(state, playerId).length) can.push('city');
  if (hasResources(hand, COSTS.dev) && deckLeft > 0) can.push('dev');
  return can;
};

// "a Road and a Settlement", "a City", "a Road, a City and a Development card"
export const listBuilds = (kinds) => {
  const names = kinds.map((kind) => `a ${BUILD_LABELS[kind]}`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

// The first resource a cost still needs from this hand, or null.
export const firstMissing = (hand, cost) => {
  const missing = Object.entries(cost).find(([resource, count]) => (hand?.[resource] || 0) < count);
  return missing ? missing[0] : null;
};
