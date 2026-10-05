// Match-length rules for a MANAPALLY match.
//
// A match is a fixed 248 completed player turns, regardless of how many players
// sit at the table. One "turn" is a single player's completed dice roll,
// movement, pass-start resolution, and destination resolution. Nothing else —
// including passing or landing on Go — advances the counter.

import { netWorth } from './estate';

export const TOTAL_MATCH_TURNS = 248;
export const START_REWARD = 200000; // ₹2,00,000

// Tracks the single global completed-turn count for a match.
export const createMatchClock = () => {
  let count = 0;

  return {
    get count() {
      return count;
    },

    get isOver() {
      return count >= TOTAL_MATCH_TURNS;
    },

    // Call exactly once per fully resolved player turn.
    // Returns true when that turn was the one that ended the match.
    commitTurn() {
      if (count >= TOTAL_MATCH_TURNS) {
        return true;
      }

      count += 1;
      return count >= TOTAL_MATCH_TURNS;
    },
  };
};

// Whose turn it is after `turnsTaken` completed turns, in seat order.
export const activeSeatForTurn = (turnsTaken, playerCount) =>
  turnsTaken % playerCount;

// Turns each seat receives across a full match. With 4 players every seat gets
// 62; with 2 players every seat gets 124; with 3 the remainder is distributed
// by turn order, and the global 248 count remains the source of truth.
export const turnsPerSeat = (playerCount) =>
  Array.from({ length: playerCount }, (_, seat) =>
    Math.floor(TOTAL_MATCH_TURNS / playerCount) +
    (seat < TOTAL_MATCH_TURNS % playerCount ? 1 : 0),
  );

// Go reward. Awards ₹2,00,000 once per valid crossing/landing and
// never touches the match clock.
export const awardStartReward = (balance, crossedStart) =>
  crossedStart ? balance + START_REWARD : balance;

// Winner by highest total net worth: cash plus the value of everything owned.
// Net worth: cash + unmortgaged property + 50% improvement resale + (mortgaged property − mortgage principal).
export const calculateWinner = (balances, players, deeds = {}, spaces) => {
  const standings = players
    .map((player) => {
      const worth = netWorth(player.id, balances, deeds || {}, spaces);
      return { player, worth, balance: balances[player.id] || 0 };
    })
    .sort((a, b) => b.worth - a.worth);

  const topWorth = standings[0] ? standings[0].worth : 0;
  const winners = standings.filter((entry) => entry.worth === topWorth);

  return {
    winners: winners.map((entry) => entry.player),
    winningBalance: topWorth,
    standings,
    isTie: winners.length > 1,
  };
};
