import GameEngine, { computeStandings, AUCTION_MIN_BID, tradeProblem } from './gameEngine';
import { TOTAL_MATCH_TURNS } from './matchRules';
import { BOARD_SPACES } from './boardData';
import * as Estate from './estate';

const FAST = {
  roll: 0, step: 0, afterRoll: 0, card: 0, turnGap: 0, botDelay: 0,
  notice: 0, actionWindow: 0, debt: 0, auction: 30, auctionExtend: 10, botBidGap: 5, remoteDecision: 50, advisor: 20,
};

const seats = (kinds) =>
  kinds.map((kind, index) => ({
    id: `p${index + 1}`,
    name: `Seat ${index + 1}`,
    pieceKey: ['lamp', 'temple', 'elephant', 'bell'][index],
    kind,
  }));

// Seeded dice so matches are reproducible.
const seeded = (seed) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const runToEnd = (engine) =>
  new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('match did not finish')), 20000);
    const original = engine.onChange;
    engine.onChange = (state) => {
      original(state);
      if (state.gameOver) {
        clearTimeout(guard);
        resolve(state);
      }
    };
    engine.start();
  });

describe('game engine', () => {
  test.each([2, 3, 4])('a %i seat computer match ends with net worth standings', async (count) => {
    const random = seeded(count * 97);
    const engine = new GameEngine({
      players: seats(Array(count).fill('bot')),
      timing: FAST,
      random,
      rollDie: () => Math.floor(random() * 6) + 1,
      pickIndex: (range) => Math.floor(random() * range),
    });

    const state = await runToEnd(engine);
    engine.destroy();

    const alive = state.players.filter((p) => !state.bankrupt[p.id]);
    expect(alive.length === 1 || state.turnCount === TOTAL_MATCH_TURNS).toBe(true);
    expect(state.gameOver.reason).toBe(alive.length === 1 ? 'bankruptcy' : 'turns');

    // No negative cash and no deeds held by bankrupt players.
    Object.values(state.balances).forEach((balance) => expect(balance).toBeGreaterThanOrEqual(0));
    Object.values(state.deeds).forEach((deed) => expect(state.bankrupt[deed.owner]).toBe(false));

    // Standings are sorted by net worth and include property value.
    const { standings, winners } = state.gameOver;
    expect(standings).toHaveLength(count);
    standings.forEach((entry, index) => {
      expect(entry.netWorth).toBe(entry.bankrupt ? 0 : entry.cash + entry.propertyValue);
      if (index > 0) expect(standings[index - 1].netWorth).toBeGreaterThanOrEqual(entry.netWorth);
    });
    expect(winners[0]).toBe(standings[0].id);
  }, 30000);

  test('a declined purchase goes to auction and the highest bid wins', async () => {
    const dice = [1, 2]; // 3 steps lands on Abids (space 3)
    const engine = new GameEngine({
      players: seats(['human', 'human']),
      timing: { ...FAST, auction: 80 },
      rollDie: () => dice.shift() ?? 1,
    });
    engine.start();

    const turn = engine.playTurn('p1');
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.state.purchaseOffer).toEqual({ playerId: 'p1', spaceId: 3 });

    expect(engine.resolvePurchase('p2', true)).toBe(false); // not their offer
    engine.resolvePurchase('p1', false);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.state.auction.spaceId).toBe(3);

    expect(engine.placeBid('p2', AUCTION_MIN_BID - 1)).toBe(false);
    expect(engine.placeBid('p2', 20000)).toBe(true);
    expect(engine.placeBid('p1', 25000)).toBe(false); // below the increment
    expect(engine.placeBid('p1', 30000)).toBe(true);
    expect(engine.placeBid('p2', 99999999)).toBe(false); // more than their cash

    await turn;
    expect(engine.state.deeds[3].owner).toBe('p1');
    expect(engine.state.balances.p1).toBe(1500000 - 30000);
    expect(engine.state.activeIndex).toBe(1);
    engine.destroy();
  });

  test('a player who cannot pay rent sells and mortgages, then goes bankrupt', () => {
    const engine = new GameEngine({ players: seats(['bot', 'bot']), timing: FAST });
    engine.state.deeds = {
      1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      39: { owner: 'p2', houses: 0, hotel: true, mortgaged: false },
    };
    engine.state.balances = { p1: 10000, p2: 100000 };
    const lines = [];

    const paid = engine.charge('p1', 2000000, 'p2', (line) => lines.push(line));

    // Mortgaging Pallava Path raised its mortgage value, all cash went to p2.
    expect(paid).toBe(10000 + 30000);
    expect(engine.state.bankrupt.p1).toBe(true);
    expect(engine.state.balances.p1).toBe(0);
    expect(engine.state.balances.p2).toBe(140000);
    expect(engine.state.deeds[1].owner).toBe('p2');
    expect(lines.some((line) => line.includes('bankrupt'))).toBe(true);
  });

  test('standings count property value in net worth', () => {
    const engine = new GameEngine({ players: seats(['bot', 'bot']), timing: FAST });
    engine.state.balances = { p1: 1000000, p2: 1300000 };
    engine.state.deeds = { 39: { owner: 'p1', houses: 0, hotel: false, mortgaged: false } };

    const [first, second] = computeStandings(engine.state);
    expect(first.id).toBe('p1');
    expect(first.netWorth).toBe(1000000 + BOARD_SPACES[39].price);
    expect(first.propertyValue).toBe(BOARD_SPACES[39].price);
    expect(second.netWorth).toBe(1300000);
  });

  test('a remote player who leaves is replaced by a computer opponent', () => {
    const players = seats(['human', 'human']);
    players[1].clientId = 'guest-1';
    const engine = new GameEngine({ players, timing: FAST });
    engine.replaceWithBot('p2');
    expect(engine.state.players[1]).toMatchObject({ kind: 'bot', clientId: null });
    engine.destroy();
  });
});

describe('rules audit', () => {
  const engineWith = (dice, kinds = ['human', 'human'], extra = {}) => {
    const queue = [...dice];
    return new GameEngine({
      players: seats(kinds),
      timing: FAST,
      rollDie: () => queue.shift() ?? 1,
      pickIndex: () => 0,
      ...extra,
    });
  };

  // Decline every purchase and let auctions lapse so turns stay simple.
  const autoDecline = (engine) => {
    const original = engine.onChange;
    engine.onChange = (state) => {
      original(state);
      if (state.purchaseOffer) setTimeout(() => engine.resolvePurchase(state.purchaseOffer.playerId, false), 0);
    };
  };

  test('doubles earn another roll in the same turn, which a person rolls themselves', async () => {
    // 2+2 lands on Income Tax, then 1+3 lands on Alwal (8)
    const engine = engineWith([2, 2, 1, 3]);
    autoDecline(engine);
    await engine.playTurn('p1');
    expect(engine.state.positions.p1).toBe(4);
    expect(engine.state.activeIndex).toBe(0);
    expect(engine.state.turnPhase).toBe('pre-roll');
    expect(engine.state.doubles.p1).toBe(1);
    await engine.playTurn('p1');
    expect(engine.state.positions.p1).toBe(8);
    expect(engine.state.balances.p1).toBe(1500000 - 200000);
    expect(engine.state.turnCount).toBe(1);
    expect(engine.state.activeIndex).toBe(1);
    engine.destroy();
  });

  test('three doubles in one turn send the player to Jail', async () => {
    const engine = engineWith([1, 1, 2, 2, 3, 3]);
    autoDecline(engine);
    await engine.playTurn('p1');
    await engine.playTurn('p1');
    await engine.playTurn('p1');
    expect(engine.state.positions.p1).toBe(10);
    expect(engine.state.detained.p1).toBe(0);
    expect(engine.state.activeIndex).toBe(1);
    engine.destroy();
  });

  test('a detained player can pay the fine, use a pardon, or must pay after three misses', async () => {
    const engine = engineWith([1, 2, 1, 2, 1, 2, 1, 3]);
    autoDecline(engine);
    engine.state.detained = { p1: 0, p2: null };
    engine.state.positions = { p1: 10, p2: 0 };

    // Miss one: stays put
    await engine.playTurn('p1');
    expect(engine.state.positions.p1).toBe(10);
    expect(engine.state.detained.p1).toBe(1);

    engine.state.activeIndex = 0;
    await engine.playTurn('p1'); // miss two
    expect(engine.state.detained.p1).toBe(2);

    engine.state.activeIndex = 0;
    const before = engine.state.balances.p1;
    await engine.playTurn('p1'); // third miss pays the fine and moves 3 to space 13
    expect(engine.state.detained.p1).toBe(null);
    expect(engine.state.positions.p1).toBe(13);
    expect(engine.state.balances.p1).toBe(before - 50000);
    engine.destroy();
  });

  test('a pardon frees a detained player without paying', async () => {
    const engine = engineWith([1, 2]);
    autoDecline(engine);
    engine.state.detained = { p1: 1, p2: null };
    engine.state.positions = { p1: 10, p2: 0 };
    engine.state.pardons = { p1: 1, p2: 0 };
    await engine.playTurn('p1', { release: 'pardon' });
    expect(engine.state.pardons.p1).toBe(0);
    expect(engine.state.detained.p1).toBe(null);
    expect(engine.state.positions.p1).toBe(13);
    expect(engine.state.balances.p1).toBe(1500000);
    engine.destroy();
  });

  test('landing on Go to Jail detains the player', async () => {
    const engine = engineWith([4, 6]);
    autoDecline(engine);
    engine.state.positions = { p1: 20, p2: 0 };
    await engine.playTurn('p1');
    expect(engine.state.positions.p1).toBe(10);
    expect(engine.state.detained.p1).toBe(0);
    engine.destroy();
  });

  test('both tax spaces charge the player', async () => {
    const engine = engineWith([1, 3, 2, 1]);
    autoDecline(engine);
    await engine.playTurn('p1'); // lands on 4, Income Tax
    expect(engine.state.balances.p1).toBe(1500000 - 200000);
    engine.state.positions.p2 = 35;
    await engine.playTurn('p2'); // lands on 38, Luxury Tax
    expect(engine.state.balances.p2).toBe(1500000 - 100000);
    engine.destroy();
  });

  test('houses and a hotel follow the even building rule and raise rent', () => {
    const engine = engineWith([]);
    const own = (id) => ({ owner: 'p1', houses: 0, hotel: false, mortgaged: false });
    engine.state.deeds = { 1: own(1), 3: own(3) };

    // Monopoly doubles base rent before any building
    expect(Estate.rentFor(engine.state.deeds, 1, 7, BOARD_SPACES)).toBe(4000);

    expect(engine.manageProperty('p1', 1, 'build')).toBe(true);
    expect(engine.manageProperty('p1', 1, 'build')).toBe(false); // must build evenly
    expect(engine.manageProperty('p1', 3, 'build')).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      expect(engine.manageProperty('p1', 1, 'build')).toBe(true);
      expect(engine.manageProperty('p1', 3, 'build')).toBe(true);
    }
    expect(engine.state.deeds[1].houses).toBe(4);
    expect(Estate.rentFor(engine.state.deeds, 1, 7, BOARD_SPACES)).toBe(160000);

    expect(engine.manageProperty('p1', 1, 'build')).toBe(true); // fifth build is a hotel
    expect(engine.state.deeds[1]).toMatchObject({ hotel: true, houses: 0 });
    expect(Estate.rentFor(engine.state.deeds, 1, 7, BOARD_SPACES)).toBe(250000);
    expect(engine.state.balances.p1).toBe(1500000 - 9 * 50000);

    // Cannot mortgage while buildings stand, selling a hotel returns four houses
    expect(engine.manageProperty('p1', 3, 'mortgage')).toBe(false);
    expect(engine.manageProperty('p1', 1, 'sell')).toBe(true);
    expect(engine.state.deeds[1]).toMatchObject({ hotel: false, houses: 4 });
    expect(engine.state.balances.p1).toBe(1500000 - 9 * 50000 + 25000);

    // Someone else cannot build on your street
    expect(engine.manageProperty('p2', 1, 'build')).toBe(false);
    engine.destroy();
  });

  test('a detained bot pays its way out when it can afford to', () => {
    const engine = engineWith([], ['bot', 'bot']);
    engine.state.detained = { p1: 0, p2: null };
    expect(engine.botRelease('p1')).toBe('pay');
    engine.state.pardons = { p1: 1, p2: 0 };
    expect(engine.botRelease('p1')).toBe('pardon');
    expect(engine.botRelease('p2')).toBe(undefined);
  });

  test('computer opponents build houses during a full match', async () => {
    const random = seeded(4242);
    let maxBuilds = 0;
    const engine = new GameEngine({
      players: seats(['bot', 'bot', 'bot', 'bot']),
      timing: FAST,
      random,
      rollDie: () => Math.floor(random() * 6) + 1,
      pickIndex: (range) => Math.floor(random() * range),
      onChange: (state) => {
        const builds = Object.values(state.deeds).reduce((sum, deed) => sum + (deed.hotel ? 5 : deed.houses), 0);
        maxBuilds = Math.max(maxBuilds, builds);
      },
    });
    await runToEnd(engine);
    engine.destroy();
    expect(maxBuilds).toBeGreaterThan(0);
  }, 30000);
});

describe('ending the game by agreement', () => {
  test('a lone human against computers ends the game straight away', () => {
    const engine = new GameEngine({ players: seats(['human', 'bot']), timing: FAST });
    engine.state.deeds = { 39: { owner: 'p2', houses: 0, hotel: false, mortgaged: false } };
    expect(engine.proposeEnd('p2')).toBe(false); // computers cannot propose
    expect(engine.proposeEnd('p1')).toBe(true);
    expect(engine.state.gameOver.reason).toBe('agreed');
    expect(engine.state.gameOver.winners).toEqual(['p2']); // net worth includes the boulevard
    engine.destroy();
  });

  test('every human must agree, and one no keeps the game going', () => {
    const engine = new GameEngine({ players: seats(['human', 'human', 'human']), timing: FAST });
    engine.proposeEnd('p1');
    engine.voteEnd('p2', true);
    expect(engine.state.gameOver).toBe(null);
    engine.voteEnd('p3', false);
    expect(engine.state.endVote).toBe(null);

    engine.proposeEnd('p2');
    engine.voteEnd('p1', true);
    engine.voteEnd('p3', true);
    expect(engine.state.gameOver.reason).toBe('agreed');
    expect(engine.voteEnd('p1', true)).toBe(false);
    engine.destroy();
  });

  test('a vote that passes mid turn ends the game when the turn finishes', async () => {
    const queue = [2, 2, 1, 3];
    const engine = new GameEngine({ players: seats(['human', 'human']), timing: FAST, rollDie: () => queue.shift() ?? 1 });
    const turn = engine.playTurn('p1');
    engine.proposeEnd('p1');
    engine.voteEnd('p2', true);
    expect(engine.state.gameOver).toBe(null);
    expect(engine.state.endVote.passed).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    if (engine.state.purchaseOffer) engine.resolvePurchase('p1', false);
    await turn;
    expect(engine.state.gameOver.reason).toBe('agreed');
    expect(engine.state.positions.p1).toBe(4); // the doubles reroll was skipped
    engine.destroy();
  });

  test('a player leaving removes them from the vote', () => {
    const players = seats(['human', 'human']);
    players[1].clientId = 'guest';
    const engine = new GameEngine({ players, timing: FAST });
    engine.proposeEnd('p1');
    expect(engine.state.gameOver).toBe(null);
    engine.replaceWithBot('p2');
    expect(engine.state.gameOver.reason).toBe('agreed');
    engine.destroy();
  });
});

describe('turn rhythm', () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const humans = (dice, timing = {}) => {
    const queue = [...dice];
    return new GameEngine({
      players: seats(['human', 'human']),
      timing: { ...FAST, ...timing },
      rollDie: () => queue.shift() ?? 1,
      pickIndex: () => 0,
    });
  };

  test('tax only leaves the balance once its pop up closes', async () => {
    const engine = humans([1, 3], { notice: 80 }); // lands on Income Tax
    const turn = engine.playTurn('p1');
    await wait(40);
    expect(engine.state.notice).toMatchObject({ kind: 'tax', amount: -200000 });
    expect(engine.state.balances.p1).toBe(1500000);
    await turn;
    expect(engine.state.notice).toBe(null);
    expect(engine.state.balances.p1).toBe(1300000);
    engine.destroy();
  });

  test('the active player can close a pop up early', async () => {
    const engine = humans([1, 3], { notice: 5000 });
    const turn = engine.playTurn('p1');
    await wait(20);
    expect(engine.dismiss('p2')).toBe(false);
    expect(engine.dismiss('p1')).toBe(true);
    await turn;
    expect(engine.state.balances.p1).toBe(1300000);
    engine.destroy();
  });

  test('rent moves to the owner only after the rent pop up', async () => {
    const engine = humans([2, 4], { notice: 60 }); // 6 lands on Uppal
    engine.state.deeds = { 6: { owner: 'p2', houses: 0, hotel: false, mortgaged: false } };
    const turn = engine.playTurn('p1');
    await wait(30);
    expect(engine.state.notice).toMatchObject({ kind: 'rent', ownerId: 'p2' });
    expect(engine.state.balances.p2).toBe(1500000);
    await turn;
    expect(engine.state.balances.p2).toBe(1506000);
    expect(engine.state.balances.p1).toBe(1494000);
    engine.destroy();
  });

  test('after the move a person has a building window that times out or ends early', async () => {
    const engine = humans([1, 2, 1, 2], { actionWindow: 60 });
    engine.state.deeds = {
      1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      3: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
    };
    const first = engine.playTurn('p1'); // 3 lands on Abids, already owned
    await wait(20);
    expect(engine.state.turnPhase).toBe('actions');
    expect(engine.state.actionEndsAt).toBeGreaterThan(Date.now());
    expect(engine.manageProperty('p1', 1, 'build')).toBe(true);
    await first;
    expect(engine.state.activeIndex).toBe(1);
    expect(engine.state.deeds[1].houses).toBe(1);

    // Building is closed while it is not your turn
    expect(engine.manageProperty('p1', 3, 'build')).toBe(false);

    const second = engine.playTurn('p2');
    await wait(20);
    expect(engine.endTurnEarly('p1')).toBe(false);
    expect(engine.endTurnEarly('p2')).toBe(true);
    await second;
    expect(engine.state.activeIndex).toBe(0);
    engine.destroy();
  });

  test('building waits until the dice have stopped moving', async () => {
    const engine = humans([1, 2], { step: 30 });
    engine.state.deeds = {
      1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      3: { owner: 'p2', houses: 0, hotel: false, mortgaged: false },
    };
    const turn = engine.playTurn('p1');
    await wait(15);
    expect(engine.state.turnPhase).toBe('moving');
    expect(engine.manageProperty('p1', 1, 'mortgage')).toBe(true); // raising cash is always open
    expect(engine.manageProperty('p1', 1, 'unmortgage')).toBe(false);
    await turn;
    engine.destroy();
  });

  test('every move lands in the activity log', async () => {
    const engine = humans([1, 3]);
    await engine.playTurn('p1');
    const texts = engine.state.log.map((entry) => entry.text);
    expect(texts).toContain('Seat 1 rolled 1 + 3 = 4');
    expect(texts.some((text) => text.includes('Income Tax'))).toBe(true);
    expect(texts.some((text) => text.includes('rolls the dice'))).toBe(false);
    engine.destroy();
  });

  test('a person who is away is played by the computer and takes the seat back on return', async () => {
    const players = seats(['human', 'human']);
    players[1].clientId = 'guest';
    players[1].code = 'ABC234';
    const engine = new GameEngine({ players, timing: FAST, rollDie: () => 1, pickIndex: () => 0 });
    engine.start();
    await engine.playTurn('p1'); // 1 + 1, doubles: p1 waits to roll again
    engine.state.doubles = { p1: 0, p2: 0 };
    engine.endTurn();
    expect(engine.state.activeIndex).toBe(1);

    engine.setAway('p2', true);
    expect(engine.state.players[1]).toMatchObject({ away: true, clientId: null, kind: 'human' });
    engine.schedule();
    await wait(40);
    expect(engine.state.positions.p2).not.toBe(0); // the computer rolled for them

    engine.setAway('p2', false, 'guest-again');
    expect(engine.state.players[1]).toMatchObject({ away: false, clientId: 'guest-again', code: 'ABC234' });
    engine.destroy();
  });

  test('a saved game resumes before the roll of the interrupted turn', () => {
    const engine = humans([]);
    engine.state = {
      ...engine.state,
      balances: { p1: 900000, p2: 1700000 },
      deeds: { 39: { owner: 'p2', houses: 0, hotel: false, mortgaged: false } },
      activeIndex: 1,
      turnCount: 17,
      busy: true,
      turnPhase: 'actions',
      notice: { kind: 'rent' },
    };
    const restored = new GameEngine({ players: seats(['human', 'human']), timing: FAST, initialState: engine.state });
    expect(restored.state).toMatchObject({
      balances: { p1: 900000, p2: 1700000 },
      activeIndex: 1,
      turnCount: 17,
      busy: false,
      turnPhase: 'pre-roll',
      notice: null,
    });
    expect(restored.state.deeds[39].owner).toBe('p2');
    engine.destroy();
    restored.destroy();
  });
});

describe('trading', () => {
  const free = (owner, extra = {}) => ({ owner, houses: 0, hotel: false, mortgaged: false, ...extra });
  const table = (kinds = ['human', 'human']) => {
    const engine = new GameEngine({ players: seats(kinds), timing: FAST, rollDie: () => 1, pickIndex: () => 0 });
    engine.state.deeds = { 1: free('p1'), 11: free('p2'), 13: free('p2'), 6: free('p1') };
    return engine;
  };
  const offer = (to, give, get, extra = {}) => ({
    to,
    give: { cash: 0, deeds: [], pardons: 0, ...give },
    get: { cash: 0, deeds: [], pardons: 0, ...get },
    ...extra,
  });

  test('cash and a deed for a deed swaps both ways when accepted', () => {
    const engine = table();
    expect(engine.proposeTrade('p1', offer('p2', { cash: 50000, deeds: [1] }, { deeds: [11] }))).toBe(true);
    const [trade] = engine.state.trades;
    expect(engine.respondTrade('p1', trade.id, true)).toBe(false); // only the recipient answers
    expect(engine.respondTrade('p2', trade.id, true)).toBe(true);
    expect(engine.state.deeds[1].owner).toBe('p2');
    expect(engine.state.deeds[11].owner).toBe('p1');
    expect(engine.state.balances).toEqual({ p1: 1450000, p2: 1550000 });
    expect(engine.state.trades).toHaveLength(0);
    expect(engine.state.log.at(-1).text).toContain('traded Koti and ₹50,000');
    engine.destroy();
  });

  test('gifts, loans and cash for cash are refused', () => {
    const engine = table();
    expect(engine.proposeTrade('p1', offer('p2', { cash: 100000 }, {}))).toBe(false);
    expect(engine.proposeTrade('p1', offer('p2', { deeds: [1] }, {}))).toBe(false);
    expect(engine.proposeTrade('p1', offer('p2', { cash: 100000 }, { cash: 50000 }))).toBe(false);
    expect(engine.proposeTrade('p1', offer('p2', { cash: 9000000 }, { deeds: [11] }))).toBe(false);
    expect(engine.proposeTrade('p1', offer('p2', { deeds: [11] }, { cash: 10000 }))).toBe(false); // not theirs
    expect(engine.proposeTrade('p1', offer('p1', { deeds: [1] }, { cash: 10000 }))).toBe(false);
    engine.destroy();
  });

  test('a property in a family with buildings cannot be traded', () => {
    const engine = table();
    engine.state.deeds = { ...engine.state.deeds, 1: free('p1', { houses: 1 }), 3: free('p1') };
    expect(tradeProblem(engine.state, { from: 'p1', to: 'p2', give: { cash: 0, deeds: [3], pardons: 0 }, get: { cash: 10000, deeds: [], pardons: 0 } }))
      .toContain('Sell the buildings');
    engine.state.deeds = { ...engine.state.deeds, 1: free('p1') };
    expect(engine.proposeTrade('p1', offer('p2', { deeds: [3] }, { cash: 10000 }))).toBe(true);
    engine.destroy();
  });

  test('a mortgaged deed costs the new owner 10% now and only the mortgage value later', () => {
    const engine = table();
    engine.state.deeds = { ...engine.state.deeds, 11: free('p2', { mortgaged: true }) };
    engine.proposeTrade('p1', offer('p2', { cash: 50000 }, { deeds: [11] }, { mortgageChoice: { 11: 'interest' } }));
    engine.respondTrade('p2', engine.state.trades[0].id, true);
    // Guntur mortgages for 70,000: 10% is 7,000
    expect(engine.state.balances.p1).toBe(1500000 - 50000 - 7000);
    expect(engine.state.deeds[11]).toMatchObject({ owner: 'p1', mortgaged: true, interestPaid: true });
    engine.state.turnPhase = 'pre-roll';
    expect(engine.manageProperty('p1', 11, 'unmortgage')).toBe(true);
    expect(engine.state.balances.p1).toBe(1500000 - 50000 - 7000 - 70000);
    expect(engine.state.deeds[11].mortgaged).toBe(false);
    engine.destroy();
  });

  test('lifting a mortgage on the trade pays the full payoff at once', () => {
    const engine = table();
    engine.state.deeds = { ...engine.state.deeds, 1: free('p1', { mortgaged: true }) };
    engine.proposeTrade('p1', offer('p2', { deeds: [1] }, { cash: 20000 }));
    engine.respondTrade('p2', engine.state.trades[0].id, true, { 1: 'lift' });
    // Koti mortgages for 30,000: payoff is 33,000
    expect(engine.state.balances.p2).toBe(1500000 - 20000 - 33000);
    expect(engine.state.deeds[1]).toMatchObject({ owner: 'p2', mortgaged: false });
    engine.destroy();
  });

  test('Get Out of Jail Free cards change hands', () => {
    const engine = table();
    engine.state.pardons = { p1: 1, p2: 0 };
    engine.proposeTrade('p1', offer('p2', { pardons: 1 }, { cash: 40000 }));
    engine.respondTrade('p2', engine.state.trades[0].id, true);
    expect(engine.state.pardons).toEqual({ p1: 0, p2: 1 });
    expect(engine.state.balances.p1).toBe(1540000);
    engine.destroy();
  });

  test('an offer that no longer works fails on accept, and only the proposer can cancel', () => {
    const engine = table();
    engine.proposeTrade('p1', offer('p2', { deeds: [1] }, { deeds: [11] }));
    const id = engine.state.trades[0].id;
    engine.state.deeds = { ...engine.state.deeds, 11: free('p1') };
    expect(engine.respondTrade('p2', id, true)).toBe(false);
    expect(engine.state.trades).toHaveLength(0);

    engine.state.deeds = { ...engine.state.deeds, 11: free('p2') };
    engine.proposeTrade('p1', offer('p2', { deeds: [1] }, { deeds: [11] }));
    const next = engine.state.trades[0].id;
    expect(engine.cancelTrade('p2', next)).toBe(false);
    expect(engine.cancelTrade('p1', next)).toBe(true);
    expect(engine.state.trades).toHaveLength(0);
    engine.destroy();
  });

  test('a computer accepts a generous offer and declines a poor one', async () => {
    const engine = table(['human', 'bot']);
    engine.proposeTrade('p1', offer('p2', { cash: 300000 }, { deeds: [11] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.state.deeds[11].owner).toBe('p1');

    engine.proposeTrade('p1', offer('p2', { cash: 10000 }, { deeds: [13] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.state.deeds[13].owner).toBe('p2');
    expect(engine.state.trades).toHaveLength(0);
    engine.destroy();
  });

  test('offers to a player who drops out are withdrawn', () => {
    const players = seats(['human', 'human']);
    players[1].clientId = 'guest';
    const engine = new GameEngine({ players, timing: FAST });
    engine.state.deeds = { 1: free('p1'), 11: free('p2') };
    engine.proposeTrade('p1', offer('p2', { deeds: [1] }, { deeds: [11] }));
    engine.setAway('p2', true);
    expect(engine.state.trades).toHaveLength(0);
    engine.destroy();
  });

  test('trades work in the middle of a turn and while in Jail', async () => {
    const engine = new GameEngine({ players: seats(['human', 'human']), timing: { ...FAST, actionWindow: 80 }, pickIndex: () => 0 });
    engine.state.deeds = { 1: free('p1'), 3: free('p1'), 11: free('p2') }; // the roll lands on p1's own Abids
    engine.state.detained = { p1: null, p2: 0 };
    engine.state.positions = { p1: 0, p2: 10 };
    const queue = [1, 2];
    engine.rollDie = () => queue.shift() ?? 1;
    const turn = engine.playTurn('p1');
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.state.turnPhase).toBe('actions');
    // p2 is in Jail and it is p1's turn, yet p2 can still trade
    expect(engine.proposeTrade('p2', offer('p1', { deeds: [11] }, { deeds: [1] }))).toBe(true);
    expect(engine.respondTrade('p1', engine.state.trades[0].id, true)).toBe(true);
    expect(engine.state.deeds[1].owner).toBe('p2');
    engine.endTurnEarly('p1');
    await turn;
    engine.destroy();
  });

  test('a house going up withdraws offers on that family', () => {
    const engine = table();
    engine.state.deeds = { ...engine.state.deeds, 3: free('p1') };
    engine.proposeTrade('p1', offer('p2', { deeds: [3] }, { cash: 10000 }));
    engine.state.turnPhase = 'pre-roll';
    expect(engine.manageProperty('p1', 1, 'build')).toBe(true);
    expect(engine.state.trades).toHaveLength(0);
    engine.destroy();
  });
});

describe('raising cash for a debt', () => {
  // Seat 1 owns Koti and Abids with a house on each, plus Uppal, and has
  // little cash; Seat 2 is owed.
  const setup = (kinds = ['human', 'human'], debt = 300) => {
    const engine = new GameEngine({ players: seats(kinds), timing: { ...FAST, debt } });
    const koti = BOARD_SPACES.find((space) => space.name === 'Koti').id;
    const abids = BOARD_SPACES.find((space) => space.name === 'Abids').id;
    const uppal = BOARD_SPACES.find((space) => space.name === 'Uppal').id;
    engine.set({
      deeds: {
        [koti]: { owner: 'p1', houses: 1, hotel: false, mortgaged: false },
        [abids]: { owner: 'p1', houses: 1, hotel: false, mortgaged: false },
        [uppal]: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      },
      balances: { p1: 10000, p2: 100000 },
    });
    return { engine, koti, abids, uppal, say: () => {} };
  };

  test('a person short of cash chooses to sell a house and the debt is paid', async () => {
    const { engine, koti, say } = setup();
    const paying = engine.collect('p1', 30000, 'p2', say, 'rent at Kadapa');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(engine.state.debt).toMatchObject({ playerId: 'p1', amount: 30000, creditorId: 'p2', reason: 'rent at Kadapa' });
    // Building is closed while in debt, selling is open.
    expect(engine.manageProperty('p1', koti, 'build')).toBe(false);
    expect(engine.manageProperty('p1', koti, 'sell')).toBe(true);

    expect(await paying).toBe(30000);
    expect(engine.state.debt).toBe(null);
    expect(engine.state.balances.p2).toBe(130000);
    expect(engine.state.deeds[koti].houses).toBe(0);
    engine.destroy();
  });

  test('the person may mortgage a property first and keep their buildings', async () => {
    const { engine, koti, abids, uppal, say } = setup();
    const paying = engine.collect('p1', 40000, 'p2', say, 'tax');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(engine.manageProperty('p1', uppal, 'mortgage')).toBe(true);
    await paying;

    expect(engine.state.deeds[uppal].mortgaged).toBe(true);
    expect(engine.state.deeds[koti].houses).toBe(1);
    expect(engine.state.deeds[abids].houses).toBe(1);
    expect(engine.state.balances.p2).toBe(140000);
    engine.destroy();
  });

  test('when the clock runs out the rest is raised automatically', async () => {
    const { engine, say } = setup(['human', 'human'], 60);
    const paid = await engine.collect('p1', 30000, 'p2', say, 'rent');

    expect(paid).toBe(30000);
    expect(engine.state.debt).toBe(null);
    expect(engine.state.bankrupt.p1).toBe(false);
    engine.destroy();
  });

  test('declaring bankruptcy hands everything to the creditor', async () => {
    const { engine, koti, say } = setup();
    const paying = engine.collect('p1', 30000, 'p2', say, 'rent');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(engine.giveUpDebt('p2')).toBe(false);
    expect(engine.giveUpDebt('p1')).toBe(true);
    expect(await paying).toBe(0);
    expect(engine.state.bankrupt.p1).toBe(true);
    expect(engine.state.deeds[koti]?.owner).toBe('p2');
    engine.destroy();
  });

  test('computers and away players are settled at once without a prompt', async () => {
    const { engine, say } = setup(['bot', 'human']);
    expect(await engine.collect('p1', 30000, 'p2', say, 'rent')).toBe(30000);
    expect(engine.state.debt).toBe(null);
    engine.destroy();

    const away = setup();
    away.engine.setAway('p1', true);
    expect(await away.engine.collect('p1', 30000, 'p2', away.say, 'rent')).toBe(30000);
    expect(away.engine.state.debt).toBe(null);
    away.engine.destroy();
  });

  test('a debt nothing could cover goes straight to bankruptcy', async () => {
    const { engine, say } = setup();
    const paid = await engine.collect('p1', 5000000, 'p2', say, 'rent');

    expect(engine.state.debt).toBe(null);
    expect(paid).toBeLessThan(5000000);
    expect(engine.state.bankrupt.p1).toBe(true);
    engine.destroy();
  });

  test('going away while choosing settles the debt automatically', async () => {
    const { engine, say } = setup();
    const paying = engine.collect('p1', 30000, 'p2', say, 'rent');
    await new Promise((resolve) => setTimeout(resolve, 10));
    engine.setAway('p1', true);

    expect(await paying).toBe(30000);
    expect(engine.state.debt).toBe(null);
    engine.destroy();
  });
});
