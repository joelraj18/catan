// Long simulation: many whole games between computer seats (some played as
// away people) with every reported state checked against the rules. Off by
// default; run with SIM_GAMES=120 npm test -- catanSimulation.
import { computeStandings } from './catanEngine';
import { totalPoints, publicPoints } from './catanRules';
import { play } from './simHarness';

const N = Number(process.env.SIM_GAMES || 0);
const simulate = N > 0 ? test : test.skip;

simulate('long simulation', async () => {
  const stats = { games: 0, turns: [], seatWins: {}, problems: [], reasons: {}, winnerVP: [], lr: 0, la: 0 };
  const jobs = [];
  for (let g = 0; g < N; g += 1) {
    // Every table size from 2 to 6, on both kinds of board.
    const size = 2 + (g % 5);
    const board = g % 3 ? 'random' : 'beginner';
    let kinds = Array(size).fill('bot');
    
    // People who are away are played by the computer; nobody idles at the table.
    const away = [...(g % 5 === 1 ? ['p1'] : []), ...(g % 7 === 3 ? ['p2'] : [])];
    jobs.push({ kinds, board, seed: 1000 + g * 7, away });
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
