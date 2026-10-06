// Long simulation: many whole games between computer seats (some played as
// away people) with every reported state checked against the rules. Off by
// default; run with SIM_GAMES=120 npm test -- catanSimulation.
import { GEOMETRY, RESOURCES } from './catanBoard';
import GameEngine, { computeStandings } from './catanEngine';
import {
  BANK_SIZE, PIECE_LIMITS, longestRoadLength, totalPoints, publicPoints, redactFor, distanceRuleOk, handSize,
} from './catanRules';

const N = Number(process.env.SIM_GAMES || 0);
const simulate = N > 0 ? test : test.skip;
const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const FAST = { roll: 0, botDelay: 0, botStep: 0, setupTurn: 5, discard: 5, robber: 5, turn: 5, tradeWait: 0, advisor: 5 };
const PHASES = new Set(['setup', 'pre-roll', 'discard', 'robber', 'steal', 'actions', 'road-building']);

const check = (state, prev, problems) => {
  const p = (msg) => problems.length < 20 && problems.push(`t${state.turnCount} ${state.turnPhase}: ${msg}`);
  if (!PHASES.has(state.turnPhase)) p(`bad phase ${state.turnPhase}`);
  RESOURCES.forEach((r) => {
    const total = state.bank[r] + Object.values(state.hands).reduce((s, h) => s + h[r], 0);
    if (total !== BANK_SIZE) p(`${r} total ${total}`);
    if (state.bank[r] < 0) p(`bank ${r} negative`);
  });
  Object.entries(state.hands).forEach(([id, h]) => RESOURCES.forEach((r) => (h[r] < 0 || !Number.isInteger(h[r])) && p(`${id} ${r}=${h[r]}`)));
  const held = Object.values(state.devCards).reduce((s, c) => s + c.length, 0);
  const played = Object.values(state.devCards).flat();
  if (state.devDeck.length + held > 25) p('dev cards from nowhere');
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
        return GEOMETRY.vertices[from].edges.some((next) => {
          if (seen.has(next) || state.roads[next] !== owner) return false;
          seen.add(next);
          return GEOMETRY.edges[next].vertices.some((w) => w !== from && reach(w, seen));
        });
      };
      const seen = new Set([Number(e)]);
      if (!GEOMETRY.edges[e].vertices.some((v) => reach(v, seen))) p(`road ${e} not connected to a building`);
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

const play = ({ kinds, board, seed, away = [] }) =>
  new Promise((resolve) => {
    const random = seeded(seed);
    const problems = [];
    let prev = null;
    let changes = 0;
    const engine = new GameEngine({
      players: kinds.map((kind, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, pieceKey: ['red', 'blue', 'white', 'orange'][i], kind })),
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
    away.forEach((id) => engine.setAway(id, true));
    engine.start();
  });

simulate('long simulation', async () => {
  const stats = { games: 0, turns: [], seatWins: {}, problems: [], reasons: {}, winnerVP: [], lr: 0, la: 0 };
  const jobs = [];
  for (let g = 0; g < N; g += 1) {
    const size = g % 2 ? 4 : 3;
    const board = g % 3 ? 'random' : 'beginner';
    let kinds = Array(size).fill('bot');
    
    jobs.push({ kinds, board, seed: 1000 + g * 7, away: g % 7 === 3 ? ['p2'] : g % 5 === 1 ? ['p1'] : [] });
    if (g % 5 === 1) jobs[jobs.length - 1].kinds[0] = 'human';
    if (g % 7 === 3) jobs[jobs.length - 1].kinds[1] = 'human';
  }
  const t0 = Date.now();
  for (let i = 0; i < jobs.length; i += 8) {
    const results = await Promise.all(jobs.slice(i, i + 8).map(play));
    results.forEach(({ state, problems }, j) => {
      const job = jobs[i + j];
      stats.games += 1;
      if (problems.length) stats.problems.push({ job: JSON.stringify(job), problems });
      if (!state.gameOver) return;
      stats.reasons[state.gameOver.reason] = (stats.reasons[state.gameOver.reason] || 0) + 1;
      stats.turns.push(state.turnCount);
      const w = state.gameOver.winners[0];
      stats.seatWins[`${job.kinds.length}:${w}`] = (stats.seatWins[`${job.kinds.length}:${w}`] || 0) + 1;
      stats.winnerVP.push(totalPoints(state, w));
      if (state.longestRoad.holder) stats.lr += 1;
      if (state.largestArmy) stats.la += 1;
      if (state.players[state.activeIndex].id !== w) stats.problems.push({ job: JSON.stringify(job), problems: ['winner not active'] });
      if (computeStandings(state)[0].id !== w) stats.problems.push({ job: JSON.stringify(job), problems: ['standings mismatch'] });
      if (publicPoints(state, w) > totalPoints(state, w)) stats.problems.push({ job: 'x', problems: ['points'] });
    });
  }
  const sorted = [...stats.turns].sort((a, b) => a - b);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ms: Date.now() - t0, games: stats.games, reasons: stats.reasons,
    turns: { min: sorted[0], median: sorted[sorted.length >> 1], max: sorted[sorted.length - 1] },
    seatWins: stats.seatWins, winnerVP: [Math.min(...stats.winnerVP), Math.max(...stats.winnerVP)], lr: stats.lr, la: stats.la,
    problems: stats.problems.slice(0, 15),
  }, null, 1));
  expect(stats.problems).toEqual([]);
}, 3600000);
