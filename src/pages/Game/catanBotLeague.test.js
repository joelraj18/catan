// A league between the two computer skill levels: four-player games with
// two strong and two casual seats, the seats rotating game to game, every
// state checked against the rules. Off by default; run with
// LEAGUE_GAMES=200 npm test -- catanBotLeague.
import { totalPoints } from './catanRules';
import { play } from './simHarness';

const N = Number(process.env.LEAGUE_GAMES || 0);
const league = N > 0 ? test : test.skip;

// Where the two strong seats sit, so every seat and every place in the turn
// order plays strong equally often.
const LINEUPS = [
  ['strong', 'casual', 'strong', 'casual'],
  ['casual', 'strong', 'casual', 'strong'],
  ['strong', 'strong', 'casual', 'casual'],
  ['casual', 'casual', 'strong', 'strong'],
  ['strong', 'casual', 'casual', 'strong'],
  ['casual', 'strong', 'strong', 'casual'],
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

league('strong computer seats beat casual ones', async () => {
  const jobs = [];
  for (let g = 0; g < N; g += 1) {
    jobs.push({
      kinds: ['bot', 'bot', 'bot', 'bot'],
      skills: LINEUPS[g % LINEUPS.length],
      board: g % 4 === 3 ? 'beginner' : 'random',
      seed: 5000 + g * 13,
    });
  }

  const stats = {
    games: 0,
    victories: 0,
    wins: { strong: 0, casual: 0 },
    turns: [],
    road: { strong: 0, casual: 0, none: 0 },
    army: { strong: 0, casual: 0, none: 0 },
    winnerVP: [],
    problems: [],
  };
  const skillAt = (job, id) => (id ? job.skills[Number(id.slice(1)) - 1] : 'none');
  const t0 = Date.now();
  for (let i = 0; i < jobs.length; i += 8) {
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(jobs.slice(i, i + 8).map(play));
    results.forEach(({ state, problems }, j) => {
      const job = jobs[i + j];
      stats.games += 1;
      if (problems.length) stats.problems.push({ job: JSON.stringify(job), problems });
      if (!state.gameOver) return;
      if (state.gameOver.reason === 'victory') stats.victories += 1;
      const winner = state.gameOver.winners[0];
      stats.wins[skillAt(job, winner)] += 1;
      stats.turns.push(state.turnCount);
      stats.winnerVP.push(totalPoints(state, winner));
      stats.road[skillAt(job, state.longestRoad.holder)] += 1;
      stats.army[skillAt(job, state.largestArmy)] += 1;
    });
  }

  const share = (count) => Math.round((1000 * count) / Math.max(1, stats.games)) / 10;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ms: Date.now() - t0,
        games: stats.games,
        victories: stats.victories,
        winPercent: { strong: share(stats.wins.strong), casual: share(stats.wins.casual) },
        medianTurns: median(stats.turns),
        longestRoadPercent: { strong: share(stats.road.strong), casual: share(stats.road.casual), none: share(stats.road.none) },
        largestArmyPercent: { strong: share(stats.army.strong), casual: share(stats.army.casual), none: share(stats.army.none) },
        winnerVP: [Math.min(...stats.winnerVP), Math.max(...stats.winnerVP)],
        problems: stats.problems.slice(0, 10),
      },
      null,
      1,
    ),
  );

  expect(stats.problems).toEqual([]);
  expect(stats.victories).toBe(N);
  expect(stats.wins.strong / N).toBeGreaterThanOrEqual(0.7);
  expect(median(stats.turns)).toBeLessThan(80);
}, 3600000);
