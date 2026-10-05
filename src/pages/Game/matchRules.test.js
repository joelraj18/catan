import {
  TOTAL_MATCH_TURNS,
  START_REWARD,
  createMatchClock,
  activeSeatForTurn,
  turnsPerSeat,
  awardStartReward,
  calculateWinner,
} from './matchRules';

// Plays a whole match seat-by-seat and reports what each seat actually got.
const playMatch = (playerCount) => {
  const clock = createMatchClock();
  const turnsTaken = Array(playerCount).fill(0);
  const seatOrder = [];
  let endedOnTurn = null;

  while (!clock.isOver) {
    const seat = activeSeatForTurn(clock.count, playerCount);
    seatOrder.push(seat);
    turnsTaken[seat] += 1;

    const matchEnded = clock.commitTurn();
    if (matchEnded && endedOnTurn === null) {
      endedOnTurn = clock.count;
    }
  }

  return { total: clock.count, turnsTaken, seatOrder, endedOnTurn };
};

describe('match length', () => {
  test('a two-player match reaches exactly 248 total turns', () => {
    const { total, turnsTaken } = playMatch(2);

    expect(total).toBe(TOTAL_MATCH_TURNS);
    expect(turnsTaken).toEqual([124, 124]);
    expect(turnsPerSeat(2)).toEqual([124, 124]);
  });

  test('a four-player match reaches exactly 248 total turns', () => {
    const { total, turnsTaken } = playMatch(4);

    expect(total).toBe(TOTAL_MATCH_TURNS);
    expect(turnsTaken).toEqual([62, 62, 62, 62]);
    expect(turnsPerSeat(4)).toEqual([62, 62, 62, 62]);
  });

  test('a three-player match still ends at 248, distributed by turn order', () => {
    const { total, turnsTaken } = playMatch(3);

    expect(total).toBe(TOTAL_MATCH_TURNS);
    expect(turnsTaken.reduce((sum, n) => sum + n, 0)).toBe(TOTAL_MATCH_TURNS);
    // 248 / 3 is not whole: earlier seats take the remainder.
    expect(turnsTaken).toEqual([83, 83, 82]);
  });

  test('the 248th turn resolves before the match is over', () => {
    const clock = createMatchClock();

    for (let turn = 1; turn < TOTAL_MATCH_TURNS; turn += 1) {
      expect(clock.commitTurn()).toBe(false);
      expect(clock.isOver).toBe(false);
    }

    // Turn 248 itself is played, and only then is the match over.
    expect(clock.count).toBe(TOTAL_MATCH_TURNS - 1);
    expect(clock.commitTurn()).toBe(true);
    expect(clock.count).toBe(TOTAL_MATCH_TURNS);
    expect(clock.isOver).toBe(true);
  });

  test('turns cannot be committed past 248', () => {
    const clock = createMatchClock();
    for (let turn = 0; turn < TOTAL_MATCH_TURNS; turn += 1) {
      clock.commitTurn();
    }

    clock.commitTurn();
    clock.commitTurn();

    expect(clock.count).toBe(TOTAL_MATCH_TURNS);
  });
});

describe('Go reward', () => {
  test('awards ₹2,00,000 once per crossing and never advances the clock', () => {
    const clock = createMatchClock();
    let balance = 1500000;

    // A turn that crosses Go: reward is paid, one turn is counted.
    balance = awardStartReward(balance, true);
    clock.commitTurn();

    expect(balance).toBe(1500000 + START_REWARD);
    expect(clock.count).toBe(1);
  });

  test('a turn that does not cross start pays nothing but still counts once', () => {
    const clock = createMatchClock();
    const balance = awardStartReward(1500000, false);
    clock.commitTurn();

    expect(balance).toBe(1500000);
    expect(clock.count).toBe(1);
  });

  test('the reward does not increment the counter a second time', () => {
    const clock = createMatchClock();

    // Three turns, every one of them crossing start.
    let balance = 1500000;
    for (let turn = 0; turn < 3; turn += 1) {
      balance = awardStartReward(balance, true);
      clock.commitTurn();
    }

    expect(balance).toBe(1500000 + START_REWARD * 3);
    expect(clock.count).toBe(3); // 3, not 6
  });
});

describe('winner by net worth', () => {
  const players = [
    { id: 'host', name: 'You' },
    { id: 'rival', name: 'Arjun' },
  ];

  test('the highest balance wins when no deeds are owned', () => {
    const result = calculateWinner({ host: 1900000, rival: 1400000 }, players);

    expect(result.isTie).toBe(false);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].name).toBe('You');
    expect(result.winningBalance).toBe(1900000);
  });

  test('the highest balance wins regardless of seat order', () => {
    const result = calculateWinner({ host: 1200000, rival: 2100000 }, players);

    expect(result.isTie).toBe(false);
    expect(result.winners[0].name).toBe('Arjun');
    expect(result.winningBalance).toBe(2100000);
  });

  test('equal top balances report a tie', () => {
    const result = calculateWinner({ host: 1700000, rival: 1700000 }, players);

    expect(result.isTie).toBe(true);
    expect(result.winners.map((p) => p.name)).toEqual(['You', 'Arjun']);
    expect(result.winningBalance).toBe(1700000);
  });

  test('a tie at the top ignores lower balances', () => {
    const fourPlayers = [
      ...players,
      { id: 'third', name: 'Meera' },
      { id: 'fourth', name: 'Ravi' },
    ];

    const result = calculateWinner(
      { host: 1800000, rival: 1800000, third: 900000, fourth: 400000 },
      fourPlayers,
    );

    expect(result.isTie).toBe(true);
    expect(result.winners.map((p) => p.name)).toEqual(['You', 'Arjun']);
  });

  test('winner decided by net worth when deeds and buildings are present', () => {
    // Arjun has less cash (1,000,000) but owns space 39 (Brihadeeswara Blvd, price 400,000)
    // You have cash (1,300,000) with no property.
    // Arjun net worth: 1,000,000 + 400,000 = 1,400,000 > 1,300,000
    const deeds = {
      39: { owner: 'rival', houses: 0, hotel: false, mortgaged: false },
    };
    const result = calculateWinner({ host: 1300000, rival: 1000000 }, players, deeds);
    expect(result.winners[0].name).toBe('Arjun');
    expect(result.winningBalance).toBe(1400000);
  });
});
