// Shared harness for the long simulations (catanSimulation.test.js and
// catanBotLeague.test.js): plays whole games between computer seats on fast
// timers and checks every reported state against the rules. Not a test
// itself; only the test files import it.
import { RESOURCES, geometryOf } from './catanBoard';
import GameEngine from './catanEngine';
import {
  BANK_SIZES, DEV_DECKS, PIECE_LIMITS, longestRoadLength, totalPoints, redactFor, distanceRuleOk, handSize,
} from './catanRules';

export const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
export const FAST = { roll: 0, botDelay: 0, botStep: 0, setupTurn: 5, discard: 5, robber: 5, turn: 5, tradeWait: 0, advisor: 5 };
const PHASES = new Set(['setup', 'pre-roll', 'discard', 'robber', 'steal', 'actions', 'road-building']);

export const check = (state, prev, problems) => {
  const p = (msg) => problems.length < 20 && problems.push(`t${state.turnCount} ${state.turnPhase}: ${msg}`);
  if (!PHASES.has(state.turnPhase)) p(`bad phase ${state.turnPhase}`);
  RESOURCES.forEach((r) => {
    const total = state.bank[r] + Object.values(state.hands).reduce((s, h) => s + h[r], 0);
    if (total !== BANK_SIZES[geometryOf(state.board).layout]) p(`${r} total ${total}`);
    if (state.bank[r] < 0) p(`bank ${r} negative`);
  });
  Object.entries(state.hands).forEach(([id, h]) => RESOURCES.forEach((r) => (h[r] < 0 || !Number.isInteger(h[r])) && p(`${id} ${r}=${h[r]}`)));
  const held = Object.values(state.devCards).reduce((s, c) => s + c.length, 0);
  const played = Object.values(state.devCards).flat();
  const deckSize = Object.values(DEV_DECKS[geometryOf(state.board).layout]).reduce((sum, n) => sum + n, 0);
  if (state.devDeck.length + held > deckSize) p('dev cards from nowhere');
  if (new Set(played.map((c) => c.id)).size !== played.length) p('duplicate dev card ids');
  Object.entries(state.buildings).forEach(([v, b]) => {
    if (!distanceRuleOk({ ...state, buildings: { ...state.buildings, [v]: undefined } }, Number(v))) p(`distance rule broken at ${v}`);
    if (!['settlement', 'city'].includes(b.type)) p('bad building');
  });
  if (state.turnPhase !== 'setup') {
    // Roads are never removed, so every road reaches one of its owner's
    // buildings through its owner's roads, counting a cut by an opponent's
    // settlement (legal, the pieces stay) as passable.
    Object.entries(state.roads).forEach(([e, owner]) => {
      const reach = (from, seen) => {
        if (state.buildings[from]?.owner === owner) return true;
        return geometryOf(state.board).vertices[from].edges.some((next) => {
          if (seen.has(next) || state.roads[next] !== owner) return false;
          seen.add(next);
          return geometryOf(state.board).edges[next].vertices.some((w) => w !== from && reach(w, seen));
        });
      };
      const seen = new Set([Number(e)]);
      if (!geometryOf(state.board).edges[e].vertices.some((v) => reach(v, seen))) p(`road ${e} not connected to a building`);
    });
  }
  state.players.forEach(({ id }) => {
    const built = Object.values(state.buildings).filter((b) => b.owner === id);
    if (built.filter((b) => b.type === 'settlement').length > PIECE_LIMITS.settlement) p('too many settlements');
    if (built.filter((b) => b.type === 'city').length > PIECE_LIMITS.city) p('too many cities');
    if (Object.values(state.roads).filter((o) => o === id).length > PIECE_LIMITS.road) p('too many roads');
    if (state.longestRoad.lengths[id] !== longestRoadLength(state, id)) p('stale road length');
    // Redaction: no other player's hand or dev card types leak.
    const view = redactFor(state, id);
    state.players.forEach(({ id: other }) => {
      if (other === id || state.gameOver) return;
      if (typeof view.hands[other].hidden !== 'number' || view.hands[other].hidden !== handSize(state.hands[other])) p('hand leak/size');
      if (view.devCards[other].some((c) => c.type)) p('dev card leak');
    });
    if (!state.gameOver && totalPoints(state, id) >= 10 && state.players[state.activeIndex].id === id && state.turnPhase === 'actions' && !state.busy) p(`${id} has ${totalPoints(state, id)} VP on own turn without winning`);
  });
  const lr = state.longestRoad;
  if (lr.holder) {
    const len = lr.lengths[lr.holder];
    if (len < 5) p('longest road holder under 5');
    if (Object.values(lr.lengths).some((l) => l > len)) p('longest road not the longest');
  } else if (Object.values(lr.lengths).filter((l) => l >= 5).length && prev && !prev.longestRoad.holder) {
    const max = Math.max(...Object.values(lr.lengths));
    if (max >= 5 && Object.values(lr.lengths).filter((l) => l === max).length === 1) p('unique road >=5 with no holder');
  }
  if (state.largestArmy) {
    const k = state.knights[state.largestArmy];
    if (k < 3 || Object.values(state.knights).some((x) => x > k)) p('largest army wrong');
  }
  if (state.turnPhase === 'discard' && !Object.keys(state.pendingDiscards).length) p('discard with nobody to discard');
  if (prev && state.version < prev.version) p('version went backwards');
  const robber = state.board.robber ?? state.robber;
  if (robber === undefined) p('no robber');
};

export const play = ({ kinds, board, seed, away = [], skills = null }) =>
  new Promise((resolve) => {
    const random = seeded(seed);
    const problems = [];
    let prev = null;
    let changes = 0;
    const engine = new GameEngine({
      players: kinds.map((kind, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, pieceKey: ['red', 'blue', 'white', 'orange', 'green', 'purple'][i], kind })),
      timing: FAST,
      options: { board },
      rollDie: () => 1 + Math.floor(random() * 6),
      pickIndex: (n) => Math.floor(random() * n),
      random,
      onChange: (state) => {
        changes += 1;
        check(state, prev, problems);
        prev = state;
        if (state.gameOver) {
          clearTimeout(guard);
          engine.destroy();
          resolve({ state, problems, changes });
        }
      },
    });
    const guard = setTimeout(() => {
      engine.destroy();
      problems.push(`stalled at turn ${engine.state.turnCount} phase ${engine.state.turnPhase} active ${engine.state.activeIndex} busy ${engine.state.busy} trades ${engine.state.trades.length}`);
      resolve({ state: engine.state, problems, changes });
    }, 60000);
    // A seat may carry its own skill level, as a league between levels needs.
    if (skills) {
      engine.state = { ...engine.state, players: engine.state.players.map((p, i) => (skills[i] ? { ...p, skill: skills[i] } : p)) };
    }
    away.forEach((id) => engine.setAway(id, true));
    engine.start();
  });
