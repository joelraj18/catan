// The MANAPALLY game engine.
//
// One engine runs per match, on the host's device. It owns the complete game
// state as a plain serialisable object, applies every rule, drives computer
// and AI opponents, and reports each change through `onChange` so the board
// can render it and the room can broadcast it to the other players. Remote
// players never run rules themselves; they send intents (roll, buy, bid) that
// the host feeds into the public methods below.

import * as Estate from './estate';
import {
  BOARD_SPACES,
  DETENTION_SPACE,
  RAJAS_ORDER_DECK,
  ROUTE_SPACES,
  START_SPACE,
  STARTING_BALANCE,
  TEMPLE_HUNDI_DECK,
  UTILITY_SPACES,
} from './boardData';
import { START_REWARD, TOTAL_MATCH_TURNS } from './matchRules';

export const DEFAULT_TIMING = {
  roll: 620, // dice tumble before the result shows
  step: 600, // per space while a token walks, slow enough to follow tile by tile
  afterRoll: 500, // pause between showing the dice and moving
  card: 8500, // a drawn card stays face up this long
  notice: 6500, // a rent, tax or Go pop up stays up this long before the money moves
  actionWindow: 10000, // after the move, time left to build before the turn ends
  debt: 60000, // a player short of cash chooses what to sell or mortgage within this
  turnGap: 600, // breath between turns
  botDelay: 900, // before a computer opponent rolls
  auction: 12000, // auction length
  auctionExtend: 4000, // a late bid keeps the auction open at least this long
  botBidGap: 900, // average pause between computer bids
  remoteDecision: 40000, // a remote player who does not answer a purchase declines after this
  advisor: 15000, // premium AI must answer within this
};

// How many recent moves the activity log keeps.
const LOG_LIMIT = 40;

export const AUCTION_MIN_BID = 10000;
export const DETENTION_FINE = 50000;
export const DETENTION_MAX_ATTEMPTS = 3;
// Income Tax and Luxury Tax, on the same thousand rupee
// scale as every other amount on the board.
export const TAXES = { 4: 200000, 38: 100000 };
const BUILD_RESERVE = 200000;
export const AUCTION_INCREMENT = 10000;
const BOT_RESERVE = 120000;

const CANCELLED = Symbol('cancelled');

// ------------------------------------------------------------------ trading

export const TRADE_PARDON_VALUE = 50000;
const MAX_TRADES = 6;
const MORTGAGE_FEE = 0.1;

const cleanSide = (side = {}) => ({
  cash: Math.max(0, Math.floor(Number(side.cash) || 0)),
  deeds: [...new Set((Array.isArray(side.deeds) ? side.deeds : []).map(Number))].filter((id) => BOARD_SPACES[id]),
  pardons: Math.max(0, Math.floor(Number(side.pardons) || 0)),
});

// What it costs the new owner to take on a mortgaged deed now: 10% of the
// mortgage value to keep it mortgaged, or the full payoff to lift it.
export const mortgageFee = (spaceId, choice) =>
  choice === 'lift'
    ? Estate.unmortgageCost(spaceId, BOARD_SPACES)
    : Math.ceil(Estate.mortgageValue(spaceId, BOARD_SPACES) * MORTGAGE_FEE);

// Lifting a mortgage later: a deed whose 10% fee was paid on a trade only
// owes the mortgage value itself.
export const liftCost = (deed, spaceId) =>
  deed?.interestPaid ? Estate.mortgageValue(spaceId, BOARD_SPACES) : Estate.unmortgageCost(spaceId, BOARD_SPACES);

export const familyHasBuildings = (deeds, spaceId) => {
  const space = BOARD_SPACES[spaceId];

  if (space.type !== 'property') {
    return false;
  }

  return Estate.getGroupSpaceIds(spaceId, BOARD_SPACES).some((id) => deeds[id] && (deeds[id].houses > 0 || deeds[id].hotel));
};

// Fees each side owes the bank for mortgaged deeds they receive.
export const tradeFees = (state, trade, mortgageChoice = {}) => {
  const fee = (ids) =>
    ids.reduce(
      (sum, id) => sum + (state.deeds[id]?.mortgaged ? mortgageFee(id, mortgageChoice[id] || 'interest') : 0),
      0,
    );

  return { from: fee(trade.get.deeds), to: fee(trade.give.deeds) };
};

// Every reason a trade cannot go ahead, shared by the engine and the trade
// sheets so both always agree. Returns null when the trade is fine.
export const tradeProblem = (state, trade, mortgageChoice = {}) => {
  const from = state.players.find((player) => player.id === trade.from);
  const to = state.players.find((player) => player.id === trade.to);

  if (state.gameOver) return 'The match is over';
  if (!from || !to || from.id === to.id) return 'Choose another player to trade with';
  if (state.bankrupt[from.id] || state.bankrupt[to.id]) return 'Bankrupt players cannot trade';

  const { give, get } = trade;
  const hasAsset = (side) => side.deeds.length > 0 || side.pardons > 0;
  const isEmpty = (side) => !hasAsset(side) && side.cash <= 0;

  if (isEmpty(give) || isEmpty(get)) return 'Both players must give something, gifts and loans are not allowed';
  if (!hasAsset(give) && !hasAsset(get)) return 'A trade must include a property or a Get Out of Jail Free card';

  const checkSide = (side, owner) => {
    for (const id of side.deeds) {
      const deed = state.deeds[id];
      if (!deed || deed.owner !== owner.id) return `${owner.name} no longer owns ${BOARD_SPACES[id].name}`;
      if (familyHasBuildings(state.deeds, id)) return `Sell the buildings in the ${BOARD_SPACES[id].name} family first`;
      if (state.auction?.spaceId === id) return `${BOARD_SPACES[id].name} is being auctioned`;
    }

    if (side.cash > (state.balances[owner.id] || 0)) return `${owner.name} does not have that much cash`;
    if (side.pardons > (state.pardons[owner.id] || 0)) return `${owner.name} does not hold that Get Out of Jail Free card`;
    return null;
  };

  const problem = checkSide(give, from) || checkSide(get, to);

  if (problem) return problem;

  // Mortgage fees are paid out of the cash each side holds after the swap.
  const fees = tradeFees(state, trade, mortgageChoice);
  const fromCash = state.balances[from.id] - give.cash + get.cash;
  const toCash = state.balances[to.id] - get.cash + give.cash;

  if (fromCash < fees.from) return `${from.name} cannot cover the mortgage fees`;
  if (toCash < fees.to) return `${to.name} cannot cover the mortgage fees`;
  return null;
};

export const formatRupees = (amount) =>
  `₹${Math.round(amount).toLocaleString('en-IN')}`;

// Cryptographically secure die roll with rejection sampling, so every face is
// exactly as likely as any other.
export const secureRollDie = () => {
  const buf = new Uint8Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= 252);
  return (buf[0] % 6) + 1;
};

// Secure index in [0, range) using the same rejection sampling.
export const secureIndex = (range) => {
  const buf = new Uint8Array(1);
  const limit = 256 - (256 % range);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % range;
};

const byId = (players) => (key) =>
  Object.fromEntries(players.map((player) => [player.id, key(player)]));

export const createInitialState = (players) => {
  const each = byId(players);

  return {
    version: 0,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      pieceKey: player.pieceKey,
      kind: player.kind, // 'human' | 'bot' | 'ai'
      clientId: player.clientId || null, // set for remote humans
      code: player.code || null, // the Player ID used to rejoin
      away: false, // a disconnected person, played by the computer until they rejoin
    })),
    positions: each(() => START_SPACE),
    balances: each(() => STARTING_BALANCE),
    pardons: each(() => 0),
    doubles: each(() => 0),
    detained: each(() => null), // turns already served in Jail, or null when free
    bankrupt: each(() => false),
    deeds: {},
    turnCount: 0,
    activeIndex: 0,
    turnPhase: 'pre-roll', // 'pre-roll' | 'moving' | 'actions'
    actionEndsAt: null, // when the post roll building window closes
    notice: null, // a rent, tax or Go pop up waiting to settle
    debt: null, // a payment a player is raising cash for, choosing what to sell or mortgage
    log: [],
    dice: null,
    rolling: false,
    busy: false,
    activity: `${players[0].name} begins at Go\nRoll the dice to begin`,
    logCounter: 0,
    drawnCard: null,
    purchaseOffer: null,
    auction: null,
    endVote: null, // { proposerId, agreed: [ids], passed }
    trades: [], // pending offers between players
    tradeCounter: 0,
    gameOver: null,
    sfx: null,
  };
};

// Final standings by total net worth: cash plus the value of every district,
// route, utility and building a player still holds.
export const computeStandings = (state) =>
  state.players
    .map((player) => {
      const cash = state.balances[player.id] || 0;
      const netWorth = state.bankrupt[player.id]
        ? 0
        : Estate.netWorth(player.id, state.balances, state.deeds, BOARD_SPACES);

      return {
        id: player.id,
        name: player.name,
        pieceKey: player.pieceKey,
        bankrupt: Boolean(state.bankrupt[player.id]),
        cash,
        propertyValue: Math.max(0, netWorth - cash),
        netWorth,
        deeds: Object.values(state.deeds).filter((deed) => deed.owner === player.id).length,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth || Number(a.bankrupt) - Number(b.bankrupt));

export default class GameEngine {
  constructor({
    players,
    timing = {},
    advisor = null,
    rollDie = secureRollDie,
    pickIndex = secureIndex,
    random = Math.random,
    onChange = () => {},
    onChat = () => {},
    initialState = null,
  }) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.advisor = advisor;
    this.rollDie = rollDie;
    this.pickIndex = pickIndex;
    this.random = random;
    this.onChange = onChange;
    this.onChat = onChat;
    this.state = initialState ? GameEngine.resumable(initialState) : createInitialState(players);
    this.timers = new Set();
    this.pendingPurchase = null;
    this.pendingAction = null; // the post roll building window
    this.pendingHold = null; // a card or notice the active player may close early
    this.destroyed = false;
    this.sfxCounter = 0;
    this.advisorFailed = false;
  }

  // ---------------------------------------------------------------- basics

  start() {
    this.emit();
    this.schedule();

    // Offers waiting on a computer seat, for example after a host resume.
    (this.state.trades || [])
      .filter((trade) => this.isAuto(trade.to))
      .forEach((trade) => this.later(() => this.botAnswerTrade(trade.id), this.timing.botDelay));
  }

  // A saved snapshot taken between rolls, made safe to continue from: any
  // pop up, auction or half finished move is dropped and the active player
  // is back before their roll.
  static resumable(saved) {
    return {
      ...createInitialState(saved.players),
      ...saved,
      busy: false,
      rolling: false,
      turnPhase: 'pre-roll',
      actionEndsAt: null,
      notice: null,
      debt: null,
      drawnCard: null,
      purchaseOffer: null,
      auction: null,
      sfx: null,
      log: Array.isArray(saved.log) ? saved.log : [],
      logCounter: saved.logCounter || 0,
    };
  }

  destroy() {
    this.destroyed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();

    if (this.pendingPurchase) {
      this.pendingPurchase.resolve(false);
      this.pendingPurchase = null;
    }

    this.pendingAction?.finish();
    this.pendingHold?.cancel();
  }

  emit() {
    if (!this.destroyed) {
      this.onChange(this.state);
    }
  }

  set(patch) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    this.emit();
  }

  later(fn, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  clearLater(timer) {
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(timer);
    }
  }

  sleep(ms) {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(CANCELLED);
        return;
      }

      this.later(() => (this.destroyed ? reject(CANCELLED) : resolve()), ms);
    });
  }

  player(id) {
    return this.state.players.find((player) => player.id === id);
  }

  nameOf(id) {
    return this.player(id)?.name || 'The bank';
  }

  isAlive(id) {
    return !this.state.bankrupt[id];
  }

  // Computer and AI opponents, and people who are away, play automatically.
  isAuto(id) {
    const player = this.player(id);
    return Boolean(player && (player.kind === 'bot' || player.kind === 'ai' || player.away));
  }

  // Adds a line to the shared activity log, newest last.
  record(text, playerId = null) {
    const logCounter = (this.state.logCounter || 0) + 1;
    const log = [...(this.state.log || []), { id: logCounter, text, playerId }].slice(-LOG_LIMIT);
    return { log, logCounter };
  }

  // Shows a card or a pop up for `ms`. The player whose turn it is may close
  // it sooner with `dismiss`.
  hold(ms) {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(CANCELLED);
        return;
      }

      let timer = null;
      const done = () => {
        this.clearLater(timer);
        this.pendingHold = null;
        resolve();
      };

      this.pendingHold = { done, cancel: () => reject(CANCELLED) };
      timer = this.later(done, ms);
    });
  }

  dismiss(playerId) {
    if (this.pendingHold && this.activePlayer.id === playerId) {
      this.pendingHold.done();
      return true;
    }

    return false;
  }

  // A money pop up: shown first, and only once it closes does `apply` move
  // the money, so everyone sees what is about to happen.
  async settle(notice, apply) {
    this.noticeCounter = (this.noticeCounter || 0) + 1;
    this.set({
      notice: { ...notice, id: this.noticeCounter, endsAt: Date.now() + this.timing.notice, length: this.timing.notice },
    });

    try {
      await this.hold(this.timing.notice);
    } finally {
      if (!this.destroyed) {
        this.set({ notice: null });
      }
    }

    return apply();
  }

  alivePlayers() {
    return this.state.players.filter((player) => this.isAlive(player.id));
  }

  get activePlayer() {
    return this.state.players[this.state.activeIndex];
  }

  sound(key) {
    this.sfxCounter += 1;
    this.set({ sfx: { key, id: this.sfxCounter } });
  }

  chat(text, playerId = null) {
    this.onChat({ playerId, text });
  }

  setBalance(id, value) {
    this.set({ balances: { ...this.state.balances, [id]: value } });
  }

  adjust(id, delta) {
    this.setBalance(id, this.state.balances[id] + delta);
  }

  setPosition(id, position) {
    this.set({ positions: { ...this.state.positions, [id]: position } });
  }

  setDeed(spaceId, deed) {
    const deeds = { ...this.state.deeds };

    if (deed) {
      deeds[spaceId] = deed;
    } else {
      delete deeds[spaceId];
    }

    this.set({ deeds });
  }

  // ----------------------------------------------------------- scheduling

  // Starts the next computer turn, or arms the idle timer for a remote human.
  schedule() {
    this.clearLater(this.turnTimer);
    this.turnTimer = null;

    if (this.destroyed || this.state.gameOver || this.state.busy) {
      return;
    }

    if (this.state.endVote?.passed) {
      this.finish('agreed');
      return;
    }

    // People take as long as they like before rolling; only computer seats,
    // and the seats of people who are away, roll by themselves.
    const active = this.activePlayer;

    if (this.isAuto(active.id)) {
      this.turnTimer = this.later(
        () => this.playTurn(active.id, { release: this.botRelease(active.id) }),
        this.timing.botDelay,
      );
    }
  }

  // ---------------------------------------------------------------- turns

  // Plays one roll of a turn. Returns false when it is not that player's
  // turn to roll. A player held in Jail may pass `release: 'pay'` to pay the
  // fine or `release: 'pardon'` to spend a pardon before rolling; otherwise
  // they roll for doubles.
  //
  // People roll each time themselves: after doubles the turn goes back to
  // 'pre-roll' and waits, with no time limit, for the next roll. After the
  // last roll a 10 second window lets them build before the turn ends.
  // Computer seats roll again and finish their turn automatically.
  async playTurn(playerId, { release } = {}) {
    const { state } = this;

    if (
      this.destroyed ||
      state.gameOver ||
      state.busy ||
      state.turnPhase !== 'pre-roll' ||
      this.activePlayer.id !== playerId ||
      !this.isAlive(playerId)
    ) {
      return false;
    }

    this.clearLater(this.turnTimer);
    this.turnTimer = null;
    this.set({ busy: true, turnPhase: 'moving' });

    const name = this.nameOf(playerId);
    const lines = [];
    const say = (text, { transient = false } = {}) => {
      lines.push(text);
      this.set({ activity: lines.join('\n'), ...(transient ? {} : this.record(text, playerId)) });
    };

    try {
      let detained = this.isDetained(playerId);

      if (detained && release === 'pardon' && this.state.pardons[playerId] > 0) {
        this.set({ pardons: { ...this.state.pardons, [playerId]: this.state.pardons[playerId] - 1 } });
        this.release(playerId);
        say(`${name} used a Get Out of Jail Free pardon`);
        detained = false;
      } else if (detained && release === 'pay') {
        await this.payFine(playerId, say);

        if (!this.isAlive(playerId)) {
          this.endTurn();
          return true;
        }

        this.release(playerId);
        say(`${name} paid the ${formatRupees(DETENTION_FINE)} fine and leaves Jail`);
        detained = false;
      }

      // Doubles earn another roll; a third double in one turn means Jail.
      let doubles = this.state.doubles[playerId] || 0;

      for (;;) {
        this.set({ rolling: true, dice: null });
        say(`${name} rolls the dice`, { transient: true });
        await this.sleep(this.timing.roll);

        const d1 = this.rollDie();
        const d2 = this.rollDie();
        const total = d1 + d2;
        const isDouble = d1 === d2;
        lines.pop();
        this.set({ rolling: false, dice: [d1, d2] });

        if (detained) {
          const attempt = this.state.detained[playerId] + 1;

          if (isDouble) {
            say(`${name} rolled doubles ${d1} + ${d2} and walks free`);
            this.release(playerId);
          } else if (attempt >= DETENTION_MAX_ATTEMPTS) {
            say(`${name} rolled ${d1} + ${d2}, a third miss, and must pay the fine`);
            await this.payFine(playerId, say);

            if (!this.isAlive(playerId)) {
              break;
            }

            this.release(playerId);
          } else {
            say(`${name} rolled ${d1} + ${d2} and stays in Jail, attempt ${attempt} of ${DETENTION_MAX_ATTEMPTS}`);
            this.set({ detained: { ...this.state.detained, [playerId]: attempt } });
            await this.sleep(this.timing.turnGap);
            break;
          }

          // Leaving Jail moves the token, but never earns a second roll.
          await this.sleep(this.timing.afterRoll);
          const passed = await this.walk(playerId, total);
          await this.awardStart(playerId, passed, say);
          await this.resolveLanding(playerId, total, say, { depth: 0 });
          break;
        }

        doubles = isDouble ? doubles + 1 : 0;
        this.set({ doubles: { ...this.state.doubles, [playerId]: doubles } });

        if (doubles === 3) {
          say(`${name} rolled doubles three times in a row`);
          this.sendToDetention(playerId, say);
          await this.sleep(this.timing.turnGap);
          break;
        }

        say(`${name} rolled ${isDouble ? 'doubles ' : ''}${d1} + ${d2} = ${total}`);
        await this.sleep(this.timing.afterRoll);

        const passedStart = await this.walk(playerId, total);
        await this.awardStart(playerId, passedStart, say);
        await this.resolveLanding(playerId, total, say, { depth: 0 });

        if (
          !isDouble ||
          this.isDetained(playerId) ||
          !this.isAlive(playerId) ||
          this.state.gameOver ||
          this.state.endVote?.passed
        ) {
          break;
        }

        // A person rolls again themselves, in their own time.
        if (!this.isAuto(playerId)) {
          say(`Doubles, ${name} rolls again`);
          return true;
        }

        say(`Doubles, ${name} rolls again`);
        await this.sleep(this.timing.turnGap);
      }

      if (this.isAlive(playerId) && !this.state.gameOver) {
        if (this.isAuto(playerId)) {
          // Computer and AI opponents develop their estate before passing on.
          this.botDevelop(playerId, say);
          await this.sleep(this.timing.turnGap);
        } else if (!this.state.endVote?.passed) {
          await this.actionWindow(playerId);
        }
      }

      this.set({ doubles: { ...this.state.doubles, [playerId]: 0 } });
      this.endTurn();
      return true;
    } catch (error) {
      if (error !== CANCELLED) {
        throw error;
      }

      return false;
    } finally {
      if (!this.destroyed) {
        this.set({ busy: false, rolling: false, turnPhase: 'pre-roll', actionEndsAt: null });

        // Waiting to roll again keeps the doubles count; a seat that went
        // away meanwhile is picked up by the computer here.
        this.schedule();
      }
    }
  }

  // The 10 seconds after a person's last roll, for building, selling or
  // mortgaging before the turn passes on. `endTurnEarly` closes it sooner.
  actionWindow(playerId) {
    if (this.timing.actionWindow <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        this.clearLater(timer);
        this.pendingAction = null;
        resolve();
      };

      this.pendingAction = { playerId, finish };
      this.set({
        turnPhase: 'actions',
        actionEndsAt: Date.now() + this.timing.actionWindow,
        actionLength: this.timing.actionWindow,
      });
      timer = this.later(finish, this.timing.actionWindow);
    });
  }

  endTurnEarly(playerId) {
    if (this.pendingAction && this.pendingAction.playerId === playerId) {
      this.pendingAction.finish();
      return true;
    }

    return false;
  }

  async payFine(playerId, say) {
    await this.settle(
      {
        kind: 'fine',
        playerId,
        title: 'Jail fine',
        text: `${this.nameOf(playerId)} pays the fine to leave Jail`,
        amount: -DETENTION_FINE,
      },
      () => this.collect(playerId, DETENTION_FINE, null, say, 'the Jail fine'),
    );
  }

  isDetained(playerId) {
    const served = this.state.detained?.[playerId];
    return served !== null && served !== undefined;
  }

  release(playerId) {
    this.set({ detained: { ...this.state.detained, [playerId]: null } });
  }

  // Straight to Jail: no walking, no Go reward, and the
  // turn ends even after doubles.
  sendToDetention(playerId, say) {
    this.set({
      positions: { ...this.state.positions, [playerId]: DETENTION_SPACE },
      detained: { ...this.state.detained, [playerId]: 0 },
    });
    say(`${this.nameOf(playerId)} is sent to Jail`);
  }

  // How a computer leaves detention: a pardon if held, the fine if cash is
  // comfortable, otherwise roll for doubles.
  botRelease(playerId) {
    if (!this.isDetained(playerId)) {
      return undefined;
    }

    if (this.state.pardons[playerId] > 0) {
      return 'pardon';
    }

    return this.state.balances[playerId] >= DETENTION_FINE + 400000 ? 'pay' : undefined;
  }

  // Computer and AI opponents lift mortgages and build houses and hotels on
  // complete colour families, always keeping a cash reserve.
  botDevelop(playerId, say) {
    const name = this.nameOf(playerId);

    Object.keys(this.state.deeds)
      .filter((id) => this.state.deeds[id].owner === playerId && this.state.deeds[id].mortgaged)
      .forEach((id) => {
        const cost = liftCost(this.state.deeds[id], id);

        if (this.state.balances[playerId] - cost >= BUILD_RESERVE * 2 && this.manageProperty(playerId, id, 'unmortgage')) {
          say(`${name} lifted the mortgage on ${BOARD_SPACES[id].name}`);
        }
      });

    let built = 0;
    let hotels = 0;

    for (let guard = 0; guard < 40; guard += 1) {
      const deeds = this.state.deeds;
      const balance = this.state.balances[playerId];
      const target = Object.keys(deeds).find((id) => {
        const details = Estate.propertyDetails[id];
        return (
          deeds[id].owner === playerId &&
          details &&
          balance - details.houseCost >= BUILD_RESERVE &&
          Estate.canBuild(deeds, id, BOARD_SPACES)
        );
      });

      if (!target || !this.manageProperty(playerId, target, 'build')) {
        break;
      }

      if (this.state.deeds[target].hotel) {
        hotels += 1;
      } else {
        built += 1;
      }
    }

    if (built || hotels) {
      const parts = [];
      if (built) parts.push(`${built} house${built > 1 ? 's' : ''}`);
      if (hotels) parts.push(`${hotels} hotel${hotels > 1 ? 's' : ''}`);
      say(`${name} built ${parts.join(' and ')}`);
    }
  }

  endTurn() {
    const turnCount = this.state.turnCount + 1;
    const alive = this.alivePlayers();

    if (this.state.endVote?.passed) {
      this.set({ turnCount });
      this.finish('agreed');
      return;
    }

    if (alive.length <= 1) {
      this.set({ turnCount });
      this.finish('bankruptcy');
      return;
    }

    if (turnCount >= TOTAL_MATCH_TURNS) {
      this.set({ turnCount });
      this.finish('turns');
      return;
    }

    const count = this.state.players.length;
    let next = this.state.activeIndex;

    do {
      next = (next + 1) % count;
    } while (!this.isAlive(this.state.players[next].id));

    this.set({ turnCount, activeIndex: next, dice: null });
  }

  finish(reason) {
    if (this.state.gameOver) {
      return;
    }

    const standings = computeStandings(this.state);
    const top = standings[0]?.netWorth ?? 0;
    const winners = standings
      .filter((entry) => !entry.bankrupt && entry.netWorth === top)
      .map((entry) => entry.id);

    this.set({
      gameOver: { reason, standings, winners, turns: this.state.turnCount },
      endVote: null,
      trades: [],
      purchaseOffer: null,
      auction: null,
      drawnCard: null,
    });

    const winnerNames = winners.map((id) => this.nameOf(id)).join(' and ');
    this.set({
      activity:
        reason === 'bankruptcy'
          ? `${winnerNames} is the last player standing`
          : reason === 'agreed'
            ? `The table agreed to end the game after ${this.state.turnCount} turns\n${winnerNames} ${winners.length > 1 ? 'share' : 'takes'} the crown`
            : `Match complete after ${TOTAL_MATCH_TURNS} turns\n${winnerNames} ${winners.length > 1 ? 'share' : 'takes'} the crown`,
    });
    this.chat(`Match over, ${winnerNames} ${winners.length > 1 ? 'share the win' : 'wins'} with ${formatRupees(top)} net worth`);
    this.sound('winner');
  }

  // -------------------------------------------------------------- movement

  async walk(playerId, steps, { backwards = false } = {}) {
    let passedStart = false;

    for (let step = 1; step <= steps; step += 1) {
      const from = this.state.positions[playerId];
      const next = (from + (backwards ? -1 : 1) + BOARD_SPACES.length) % BOARD_SPACES.length;

      if (next === START_SPACE && !backwards) {
        passedStart = true;
      }

      this.setPosition(playerId, next);
      await this.sleep(this.timing.step);
    }

    return passedStart;
  }

  walkTo(playerId, target) {
    const from = this.state.positions[playerId];
    const steps = (target - from + BOARD_SPACES.length) % BOARD_SPACES.length;

    return steps === 0 ? Promise.resolve(false) : this.walk(playerId, steps);
  }

  nextSpaceAhead(playerId, candidates) {
    const from = this.state.positions[playerId];
    const distance = (space) => {
      const gap = (space - from + BOARD_SPACES.length) % BOARD_SPACES.length;
      return gap === 0 ? BOARD_SPACES.length : gap;
    };

    return candidates.reduce((best, candidate) =>
      distance(candidate) < distance(best) ? candidate : best,
    );
  }

  async awardStart(playerId, passed, say) {
    if (!passed) {
      return;
    }

    const name = this.nameOf(playerId);

    await this.settle(
      { kind: 'go', playerId, title: 'Passed Go', text: `${name} collects the Go reward`, amount: START_REWARD },
      () => this.adjust(playerId, START_REWARD),
    );
    this.sound('coronation');
    say(`${name} collected ${formatRupees(START_REWARD)} for passing Go`);
  }

  // --------------------------------------------------------------- landing

  async resolveLanding(playerId, diceTotal, say, options) {
    const space = BOARD_SPACES[this.state.positions[playerId]];
    const name = this.nameOf(playerId);

    switch (space.type) {
      case 'route':
        this.sound(space.line === 'farakka' ? 'farakkaExpress' : 'pallavanExpress');
        await this.resolveOwnable(playerId, space, diceTotal, say, options);
        break;

      case 'utility':
        this.sound('utility');
        await this.resolveOwnable(playerId, space, diceTotal, say, options);
        break;

      case 'property':
        await this.resolveOwnable(playerId, space, diceTotal, say, options);
        break;

      case 'chance':
      case 'community':
        if (options.depth < 2) {
          await this.resolveCard(playerId, space.name, space.type === 'chance' ? RAJAS_ORDER_DECK : TEMPLE_HUNDI_DECK, diceTotal, say, options.depth + 1);
        }
        break;

      case 'go-to-detention':
        this.sendToDetention(playerId, say);
        break;

      case 'tax': {
        const amount = TAXES[space.id] || 0;

        if (amount > 0) {
          const paid = await this.settle(
            { kind: 'tax', playerId, title: space.name, text: `${name} pays ${space.name} to the bank`, amount: -amount },
            () => this.collect(playerId, amount, null, say, space.name),
          );
          say(`${name} paid ${formatRupees(paid)} ${space.name}`);
        }
        break;
      }

      default:
        break;
    }
  }

  async resolveOwnable(playerId, space, diceTotal, say, { doubleRent = false, utilityTen = false } = {}) {
    const deed = this.state.deeds[space.id];
    const name = this.nameOf(playerId);

    if (deed && deed.owner === playerId) {
      say(`${name} is home at ${space.name}`);
      return;
    }

    if (deed) {
      if (deed.mortgaged || !this.isAlive(deed.owner)) {
        say(`${space.name} is mortgaged, no rent is due`);
        return;
      }

      let rent;

      if (utilityTen && space.type === 'utility') {
        const throwTotal = this.rollDie() + this.rollDie();
        rent = 10 * throwTotal * 1000;
        say(`${name} threw ${throwTotal} for the utility card`);
      } else {
        rent = Estate.rentFor(this.state.deeds, space.id, diceTotal, BOARD_SPACES);
      }

      if (doubleRent) {
        rent *= 2;
      }

      if (rent > 0) {
        const owner = this.nameOf(deed.owner);
        const paid = await this.settle(
          {
            kind: 'rent',
            playerId,
            ownerId: deed.owner,
            spaceId: space.id,
            title: `Rent at ${space.name}`,
            text: `${name} pays rent to ${owner}`,
            amount: -rent,
          },
          () => this.collect(playerId, rent, deed.owner, say, `rent at ${space.name}`),
        );
        say(`${name} paid ${formatRupees(paid)} rent to ${owner}`);
      }

      return;
    }

    await this.offerProperty(playerId, space, say);
  }

  async offerProperty(playerId, space, say) {
    const name = this.nameOf(playerId);
    const canAfford = this.state.balances[playerId] >= space.price;
    const wantsIt = canAfford ? await this.decidePurchase(playerId, space) : false;

    if (wantsIt && this.state.balances[playerId] >= space.price) {
      this.adjust(playerId, -space.price);
      this.setDeed(space.id, { owner: playerId, houses: 0, hotel: false, mortgaged: false });
      this.sound('propertyBought');
      say(`${name} bought ${space.name} for ${formatRupees(space.price)}`);
      return;
    }

    say(`${name} passed on ${space.name}, it goes to auction`);
    await this.runAuction(space, say);
  }

  decidePurchase(playerId, space) {
    const player = this.player(playerId);

    if (player.kind === 'bot' || player.away) {
      return Promise.resolve(this.botWantsToBuy(playerId, space));
    }

    if (player.kind === 'ai') {
      return this.askAdvisor('purchase', playerId, space).then((answer) =>
        answer ? Boolean(answer.buy) : this.botWantsToBuy(playerId, space),
      );
    }

    // A human decides through the purchase sheet.
    return new Promise((resolve) => {
      let timer = null;

      const finish = (accept) => {
        this.clearLater(timer);
        this.pendingPurchase = null;
        this.set({ purchaseOffer: null });
        resolve(accept);
      };

      this.pendingPurchase = { playerId, spaceId: space.id, resolve: finish };
      this.set({ purchaseOffer: { playerId, spaceId: space.id } });

      if (player.clientId) {
        timer = this.later(() => finish(false), this.timing.remoteDecision);
      }
    });
  }

  // Called from the purchase sheet, locally or through a remote intent.
  resolvePurchase(playerId, accept) {
    if (this.pendingPurchase && this.pendingPurchase.playerId === playerId) {
      this.pendingPurchase.resolve(Boolean(accept));
      return true;
    }

    return false;
  }

  ownsInGroup(playerId, space) {
    if (space.type !== 'property') {
      const group = space.type === 'route' ? ROUTE_SPACES : UTILITY_SPACES;
      return group.filter((id) => this.state.deeds[id]?.owner === playerId).length;
    }

    return Estate.getGroupSpaceIds(space.id, BOARD_SPACES).filter(
      (id) => this.state.deeds[id]?.owner === playerId,
    ).length;
  }

  botWantsToBuy(playerId, space) {
    const cash = this.state.balances[playerId];
    const reserve = this.ownsInGroup(playerId, space) > 0 ? BOT_RESERVE / 2 : BOT_RESERVE;

    return cash - space.price >= reserve;
  }

  botMaxBid(playerId, space) {
    const cash = this.state.balances[playerId];
    const appetite = this.ownsInGroup(playerId, space) > 0 ? 1.15 : 0.85;
    const value = space.price * appetite * (0.9 + this.random() * 0.2);
    const cap = cash - BOT_RESERVE / 2;

    return Math.max(0, Math.floor(Math.min(value, cap) / AUCTION_INCREMENT) * AUCTION_INCREMENT);
  }

  // Ask the premium AI for a decision, falling back to the built in strategy
  // when no advisor is configured, it is slow or it fails.
  async askAdvisor(kind, playerId, space) {
    if (!this.advisor) {
      return null;
    }

    try {
      const answer = await Promise.race([
        this.advisor({ kind, playerId, space, state: this.state }),
        new Promise((resolve) => this.later(() => resolve(null), this.timing.advisor)),
      ]);

      if (answer?.comment) {
        this.chat(answer.comment, playerId);
      }

      return answer;
    } catch (error) {
      if (!this.advisorFailed) {
        this.advisorFailed = true;
        this.chat('The premium AI could not be reached, AI opponents now use the built in strategy');
      }

      return null;
    }
  }

  // ---------------------------------------------------------------- auction

  async runAuction(space, say) {
    const bidders = this.alivePlayers().filter(
      (player) => this.state.balances[player.id] >= AUCTION_MIN_BID,
    );

    if (bidders.length === 0) {
      say(`Nobody can bid, ${space.name} stays with the bank`);
      return;
    }

    // Computer limits are fixed up front; premium AI limits arrive when the
    // advisor answers.
    const limits = {};

    bidders.forEach((player) => {
      if (player.kind === 'bot' || player.kind === 'ai') {
        limits[player.id] = this.botMaxBid(player.id, space);
      }

      if (player.kind === 'ai') {
        this.askAdvisor('bid', player.id, space).then((answer) => {
          if (answer && Number.isFinite(answer.maxBid)) {
            const cash = this.state.balances[player.id];
            limits[player.id] = Math.max(0, Math.min(Math.floor(answer.maxBid), cash));
          }
        });
      }
    });

    this.set({
      auction: {
        spaceId: space.id,
        highBid: 0,
        highBidder: null,
        endsAt: Date.now() + this.timing.auction,
        bids: [],
      },
    });
    this.chat(`Auction open for ${space.name}, listed at ${formatRupees(space.price)}`);

    let nextBotBid = Date.now() + this.timing.botBidGap * (0.6 + this.random() * 0.8);

    while (this.state.auction && Date.now() < this.state.auction.endsAt) {
      await this.sleep(Math.min(200, Math.max(10, this.state.auction.endsAt - Date.now())));

      // People who are away bid like the computer until they come back.
      bidders.forEach((player) => {
        const current = this.player(player.id);

        if (current.kind === 'human') {
          if (current.away && !(player.id in limits)) {
            limits[player.id] = this.botMaxBid(player.id, space);
          } else if (!current.away) {
            delete limits[player.id];
          }
        }
      });

      if (Date.now() >= nextBotBid) {
        this.botAuctionMove(limits);
        nextBotBid = Date.now() + this.timing.botBidGap * (0.6 + this.random() * 0.8);
      }
    }

    const { highBid, highBidder } = this.state.auction;
    this.set({ auction: null });

    if (highBidder && this.state.balances[highBidder] >= highBid) {
      this.adjust(highBidder, -highBid);
      this.setDeed(space.id, { owner: highBidder, houses: 0, hotel: false, mortgaged: false });
      this.sound('propertyBought');
      const message = `${this.nameOf(highBidder)} won ${space.name} at auction for ${formatRupees(highBid)}`;
      say(message);
      this.chat(message);
    } else {
      say(`No bids, ${space.name} stays with the bank`);
      this.chat(`No bids for ${space.name}, it stays with the bank`);
    }
  }

  botAuctionMove(limits) {
    const auction = this.state.auction;

    if (!auction) {
      return;
    }

    const nextBid = auction.highBid === 0 ? AUCTION_MIN_BID : auction.highBid + AUCTION_INCREMENT;
    const candidates = Object.keys(limits).filter(
      (id) =>
        id !== auction.highBidder &&
        this.isAlive(id) &&
        limits[id] >= nextBid &&
        this.state.balances[id] >= nextBid,
    );

    if (candidates.length === 0) {
      return;
    }

    const bidder = candidates[Math.floor(this.random() * candidates.length)];
    const jump = this.random() < 0.3 ? AUCTION_INCREMENT * 2 : 0;
    const amount = Math.min(limits[bidder], nextBid + jump);

    this.placeBid(bidder, amount);
  }

  // Validates and records a bid. Returns true when it was accepted.
  placeBid(playerId, amount) {
    const auction = this.state.auction;
    const value = Math.floor(Number(amount));

    if (!auction || Date.now() >= auction.endsAt || !this.isAlive(playerId)) {
      return false;
    }

    const minimum = auction.highBid === 0 ? AUCTION_MIN_BID : auction.highBid + AUCTION_INCREMENT;

    if (!Number.isFinite(value) || value < minimum || value > this.state.balances[playerId]) {
      return false;
    }

    const endsAt = Math.max(auction.endsAt, Date.now() + this.timing.auctionExtend);

    this.set({
      auction: {
        ...auction,
        highBid: value,
        highBidder: playerId,
        endsAt,
        bids: [...auction.bids, { playerId, amount: value }].slice(-6),
      },
    });

    return true;
  }

  // ------------------------------------------------------------------ cards

  async resolveCard(playerId, deckName, deck, diceTotal, say, depth) {
    const card = deck[this.pickIndex(deck.length)];
    const name = this.nameOf(playerId);

    this.set({
      drawnCard: {
        deckName,
        text: card.text,
        playerId,
        playerName: name,
        endsAt: Date.now() + this.timing.card,
        length: this.timing.card,
      },
    });

    try {
      await this.hold(this.timing.card);
    } finally {
      if (!this.destroyed) {
        this.set({ drawnCard: null });
      }
    }

    say(`${name} drew ${deckName}, ${card.text}`);

    const { effect } = card;

    switch (effect.kind) {
      case 'advance': {
        const passed = await this.walkTo(playerId, effect.target);
        say(`${name} advanced to ${BOARD_SPACES[effect.target].name}`);
        this.awardStart(playerId, passed, say);
        await this.resolveLanding(playerId, diceTotal, say, { depth });
        break;
      }

      case 'nearest-route':
      case 'nearest-utility': {
        const isRoute = effect.kind === 'nearest-route';
        const target = this.nextSpaceAhead(playerId, isRoute ? ROUTE_SPACES : UTILITY_SPACES);
        const passed = await this.walkTo(playerId, target);
        say(`${name} advanced to ${BOARD_SPACES[target].name}`);
        this.awardStart(playerId, passed, say);
        await this.resolveLanding(playerId, diceTotal, say, {
          depth,
          doubleRent: isRoute,
          utilityTen: !isRoute,
        });
        break;
      }

      case 'back': {
        await this.walk(playerId, effect.steps, { backwards: true });
        say(`${name} stepped back ${effect.steps} spaces`);
        await this.resolveLanding(playerId, diceTotal, say, { depth });
        break;
      }

      case 'detention':
        this.sendToDetention(playerId, say);
        break;

      case 'collect':
        this.adjust(playerId, effect.amount);
        say(`${name} collected ${formatRupees(effect.amount)}`);
        break;

      case 'pay': {
        const paid = await this.collect(playerId, effect.amount, null, say, deckName);
        say(`${name} paid ${formatRupees(paid)}`);
        break;
      }

      case 'pay-each':
        for (const other of this.alivePlayers().filter((entry) => entry.id !== playerId)) {
          if (this.isAlive(playerId)) {
            // eslint-disable-next-line no-await-in-loop
            await this.collect(playerId, effect.amount, other.id, say, deckName);
          }
        }
        say(`${name} paid ${formatRupees(effect.amount)} to each player`);
        break;

      case 'collect-each':
        for (const other of this.alivePlayers().filter((entry) => entry.id !== playerId)) {
          // eslint-disable-next-line no-await-in-loop
          await this.collect(other.id, effect.amount, playerId, say, deckName);
        }
        say(`${name} collected ${formatRupees(effect.amount)} from each player`);
        break;

      case 'pardon':
        this.set({ pardons: { ...this.state.pardons, [playerId]: this.state.pardons[playerId] + 1 } });
        say(`${name} keeps a Get Out of Jail Free pardon`);
        break;

      case 'repairs': {
        let houses = 0;
        let hotels = 0;

        Object.values(this.state.deeds).forEach((deed) => {
          if (deed.owner === playerId) {
            houses += deed.hotel ? 0 : deed.houses || 0;
            hotels += deed.hotel ? 1 : 0;
          }
        });

        const bill = houses * effect.perHouse + hotels * effect.perHotel;

        if (bill > 0) {
          const paid = await this.collect(playerId, bill, null, say, 'repairs');
          say(`${name} paid ${formatRupees(paid)} for repairs`);
        } else {
          say(`${name} owns no buildings, nothing to repair`);
        }
        break;
      }

      default:
        break;
    }
  }

  // ------------------------------------------------------- debts and estate

  // Cash a player could raise by selling every building and mortgaging every
  // property they could, in the order the rules allow.
  raisableFor(playerId) {
    const nextBuilding = (current) =>
      Object.keys(current).find(
        (id) => current[id].owner === playerId && Estate.canSellBuilding(current, id, BOARD_SPACES),
      );
    const nextMortgage = (current) =>
      Object.keys(current).find(
        (id) => current[id].owner === playerId && Estate.canMortgage(current, id, BOARD_SPACES),
      );
    let deeds = { ...this.state.deeds };
    let total = 0;

    for (;;) {
      const building = nextBuilding(deeds);

      if (building) {
        const result = Estate.sellOneBuilding(deeds, building, BOARD_SPACES);
        deeds = result.updatedDeeds;
        total += result.cash;
      } else {
        const mortgage = nextMortgage(deeds);

        if (!mortgage) {
          return total;
        }

        deeds = { ...deeds, [mortgage]: { ...deeds[mortgage], mortgaged: true } };
        total += Estate.mortgageValue(mortgage, BOARD_SPACES);
      }
    }
  }

  // Takes `amount` from a player. A person short of cash first gets to choose
  // what to sell or mortgage, with a clock; computers, away players and anyone
  // who could not cover it even with everything are settled at once.
  async collect(playerId, amount, creditorId, say, reason = 'a payment') {
    const balance = this.state.balances[playerId];
    const short = amount - balance;

    if (
      amount <= 0 ||
      !this.isAlive(playerId) ||
      short <= 0 ||
      this.isAuto(playerId) ||
      this.timing.debt <= 0 ||
      this.raisableFor(playerId) < short
    ) {
      return this.charge(playerId, amount, creditorId, say);
    }

    say(`${this.nameOf(playerId)} is raising cash for ${reason}`);

    await new Promise((resolve) => {
      let timer = null;
      const done = () => {
        this.clearLater(timer);
        this.pendingDebt = null;
        resolve();
      };

      this.pendingDebt = { playerId, amount, done };
      this.set({
        debt: {
          playerId,
          amount,
          creditorId,
          reason,
          endsAt: Date.now() + this.timing.debt,
          length: this.timing.debt,
        },
      });
      timer = this.later(done, this.timing.debt);
    });

    if (!this.destroyed) {
      this.set({ debt: null });
    }

    if (this.declaredBankrupt === playerId) {
      this.declaredBankrupt = null;
      this.declareBankrupt(playerId, creditorId, say);
      return 0;
    }

    return this.charge(playerId, amount, creditorId, say);
  }

  // The player in debt gives up: everything goes to whoever they owe.
  giveUpDebt(playerId) {
    if (this.pendingDebt?.playerId !== playerId) {
      return false;
    }

    this.declaredBankrupt = playerId;
    this.pendingDebt.done();
    return true;
  }

  // Once a sale or mortgage covers the debt, the payment goes ahead at once.
  checkDebt(playerId) {
    const pending = this.pendingDebt;

    if (pending && pending.playerId === playerId && this.state.balances[playerId] >= pending.amount) {
      pending.done();
    }
  }

  // Takes `amount` from a player, raising cash from their estate if needed.
  // Anything they still cannot cover bankrupts them. Returns what was paid.
  charge(playerId, amount, creditorId, say) {
    if (amount <= 0 || !this.isAlive(playerId)) {
      return 0;
    }

    if (this.state.balances[playerId] < amount) {
      const raised = this.liquidate(playerId, amount - this.state.balances[playerId]);

      if (raised > 0) {
        say(`${this.nameOf(playerId)} raised ${formatRupees(raised)} by selling buildings and mortgaging districts`);
      }
    }

    const balance = this.state.balances[playerId];
    const paid = Math.max(0, Math.min(balance, amount));
    const balances = { ...this.state.balances, [playerId]: balance - paid };

    if (creditorId && this.isAlive(creditorId)) {
      balances[creditorId] += paid;
    }

    this.set({ balances });

    if (paid < amount) {
      this.declareBankrupt(playerId, creditorId, say);
    }

    return paid;
  }

  liquidate(playerId, needed) {
    let deeds = { ...this.state.deeds };
    let raised = 0;

    // Sell buildings first (evenly, as the rules require), then mortgage.
    const nextBuilding = (current) =>
      Object.keys(current).find(
        (id) => current[id].owner === playerId && Estate.canSellBuilding(current, id, BOARD_SPACES),
      );
    const nextMortgage = (current) =>
      Object.keys(current).find(
        (id) => current[id].owner === playerId && Estate.canMortgage(current, id, BOARD_SPACES),
      );

    while (raised < needed) {
      const building = nextBuilding(deeds);

      if (building) {
        const result = Estate.sellOneBuilding(deeds, building, BOARD_SPACES);
        deeds = result.updatedDeeds;
        raised += result.cash;
        continue;
      }

      const mortgage = nextMortgage(deeds);

      if (!mortgage) {
        break;
      }

      deeds = { ...deeds, [mortgage]: { ...deeds[mortgage], mortgaged: true } };
      raised += Estate.mortgageValue(mortgage, BOARD_SPACES);
    }

    if (raised > 0) {
      this.set({
        deeds,
        balances: { ...this.state.balances, [playerId]: this.state.balances[playerId] + raised },
      });
    }

    return raised;
  }

  declareBankrupt(playerId, creditorId, say) {
    const deeds = { ...this.state.deeds };
    const heir = creditorId && this.isAlive(creditorId) ? creditorId : null;

    Object.keys(deeds).forEach((id) => {
      if (deeds[id].owner === playerId) {
        if (heir) {
          deeds[id] = { ...deeds[id], owner: heir, houses: 0, hotel: false };
        } else {
          delete deeds[id];
        }
      }
    });

    this.set({
      deeds,
      balances: { ...this.state.balances, [playerId]: 0 },
      bankrupt: { ...this.state.bankrupt, [playerId]: true },
      detained: { ...this.state.detained, [playerId]: null },
    });

    const message = heir
      ? `${this.nameOf(playerId)} is bankrupt, their estate passes to ${this.nameOf(heir)}`
      : `${this.nameOf(playerId)} is bankrupt, their estate returns to the bank`;
    say(message);
    this.chat(message);

    if (this.pendingPurchase?.playerId === playerId) {
      this.pendingPurchase.resolve(false);
    }

    this.pruneTrades();
    this.checkEndVote();
  }

  canDevelop(playerId) {
    const { state } = this;

    if (this.activePlayer.id !== playerId) {
      return false;
    }

    if (this.isAuto(playerId)) {
      return true; // a computer builds as its turn wraps up
    }

    return (state.turnPhase === 'pre-roll' && !state.busy) || state.turnPhase === 'actions';
  }

  // Owner actions from the property sheet. Each returns true when applied.
  manageProperty(playerId, spaceId, action) {
    // While raising cash for a debt, only selling and mortgaging are open.
    if (this.state.debt?.playerId === playerId && action !== 'sell' && action !== 'mortgage') {
      return false;
    }

    const applied = this.applyManage(playerId, Number(spaceId), action);

    // A new house can make a pending offer impossible.
    if (applied && action === 'build') {
      this.pruneTrades();
    }

    if (applied) {
      this.checkDebt(playerId);
    }

    return applied;
  }

  applyManage(playerId, spaceId, action) {
    const { state } = this;
    const deed = state.deeds[spaceId];

    if (!deed || deed.owner !== playerId || state.gameOver || state.auction || !this.isAlive(playerId)) {
      return false;
    }

    // Building and lifting mortgages are for your own turn, before you roll
    // or in the 10 seconds after your move. Selling and mortgaging to raise
    // cash are open at any time.
    if ((action === 'build' || action === 'unmortgage') && !this.canDevelop(playerId)) {
      return false;
    }

    const details = Estate.propertyDetails[spaceId];
    const balance = state.balances[playerId];

    switch (action) {
      case 'build': {
        if (!details || !Estate.canBuild(state.deeds, spaceId, BOARD_SPACES) || balance < details.houseCost) {
          return false;
        }

        const next = deed.houses === 4 ? { ...deed, houses: 0, hotel: true } : { ...deed, houses: deed.houses + 1 };
        this.set({
          deeds: { ...state.deeds, [spaceId]: next },
          balances: { ...state.balances, [playerId]: balance - details.houseCost },
        });
        return true;
      }

      case 'sell': {
        const result = Estate.sellOneBuilding(state.deeds, spaceId, BOARD_SPACES);

        if (!result) {
          return false;
        }

        this.set({
          deeds: result.updatedDeeds,
          balances: { ...state.balances, [playerId]: balance + result.cash },
        });
        return true;
      }

      case 'mortgage': {
        if (!Estate.canMortgage(state.deeds, spaceId, BOARD_SPACES)) {
          return false;
        }

        this.set({
          deeds: { ...state.deeds, [spaceId]: { ...deed, mortgaged: true } },
          balances: { ...state.balances, [playerId]: balance + Estate.mortgageValue(spaceId, BOARD_SPACES) },
        });
        return true;
      }

      case 'unmortgage': {
        const cost = liftCost(deed, spaceId);

        if (!deed.mortgaged || balance < cost) {
          return false;
        }

        this.set({
          deeds: { ...state.deeds, [spaceId]: { ...deed, mortgaged: false, interestPaid: undefined } },
          balances: { ...state.balances, [playerId]: balance - cost },
        });
        return true;
      }

      default:
        return false;
    }
  }

  // -------------------------------------------------------------- trading

  // Offer a deal to another player, at any time, on any turn, even in Jail.
  proposeTrade(fromId, offer = {}) {
    const from = this.player(fromId);

    if (!from || from.kind !== 'human' || from.away || this.state.debt?.playerId === fromId) {
      return false;
    }

    const trade = {
      id: (this.state.tradeCounter || 0) + 1,
      from: fromId,
      to: offer.to,
      give: cleanSide(offer.give),
      get: cleanSide(offer.get),
      mortgageChoice: offer.mortgageChoice && typeof offer.mortgageChoice === 'object' ? { ...offer.mortgageChoice } : {},
      createdAt: Date.now(),
    };
    const trades = (this.state.trades || []).filter((entry) => !(entry.from === fromId && entry.to === trade.to));

    if (tradeProblem(this.state, trade, trade.mortgageChoice) || trades.length >= MAX_TRADES) {
      return false;
    }

    const to = this.player(trade.to);
    this.set({
      trades: [...trades, trade],
      tradeCounter: trade.id,
      ...this.record(`${from.name} offered ${to.name} a trade`, fromId),
    });
    this.chat(`${from.name} offered ${to.name} a trade`);

    if (this.isAuto(to.id)) {
      this.later(() => this.botAnswerTrade(trade.id), this.timing.botDelay);
    }

    return true;
  }

  cancelTrade(playerId, tradeId) {
    const trade = this.findTrade(tradeId);

    if (!trade || trade.from !== playerId) {
      return false;
    }

    this.dropTrade(tradeId);
    this.chat(`${this.nameOf(playerId)} withdrew a trade offer to ${this.nameOf(trade.to)}`);
    return true;
  }

  findTrade(tradeId) {
    return (this.state.trades || []).find((trade) => trade.id === Number(tradeId));
  }

  dropTrade(tradeId) {
    this.set({ trades: (this.state.trades || []).filter((trade) => trade.id !== Number(tradeId)) });
  }

  // The player the offer was made to accepts or declines. `mortgageChoice`
  // says, for each mortgaged deed they receive, whether to pay the 10% fee
  // now ('interest') or lift the mortgage straight away ('lift').
  respondTrade(playerId, tradeId, accept, mortgageChoice = {}) {
    const trade = this.findTrade(tradeId);

    if (!trade || trade.to !== playerId) {
      return false;
    }

    if (!accept) {
      this.dropTrade(trade.id);
      this.chat(`${this.nameOf(playerId)} declined the trade from ${this.nameOf(trade.from)}`);
      return true;
    }

    const choices = { ...trade.mortgageChoice };
    trade.give.deeds.forEach((id) => {
      choices[id] = mortgageChoice?.[id] === 'lift' ? 'lift' : 'interest';
    });

    const problem = tradeProblem(this.state, trade, choices);

    if (problem) {
      this.dropTrade(trade.id);
      this.chat(`The trade between ${this.nameOf(trade.from)} and ${this.nameOf(playerId)} fell through, ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
      return false;
    }

    this.executeTrade(trade, choices);
    return true;
  }

  // Swaps everything in one step, then settles mortgage fees with the bank.
  executeTrade(trade, choices) {
    const { from, to, give, get } = trade;
    const balances = { ...this.state.balances };
    const pardons = { ...this.state.pardons };
    const deeds = { ...this.state.deeds };
    const fees = tradeFees(this.state, trade, choices);

    balances[from] += get.cash - give.cash - fees.from;
    balances[to] += give.cash - get.cash - fees.to;
    pardons[from] += get.pardons - give.pardons;
    pardons[to] += give.pardons - get.pardons;

    const move = (ids, owner) =>
      ids.forEach((id) => {
        const deed = deeds[id];
        const lift = deed.mortgaged && choices[id] === 'lift';
        deeds[id] = {
          ...deed,
          owner,
          mortgaged: deed.mortgaged && !lift,
          interestPaid: deed.mortgaged && !lift ? true : undefined,
        };
      });

    move(give.deeds, to);
    move(get.deeds, from);

    const describe = (side) =>
      [
        ...side.deeds.map((id) => BOARD_SPACES[id].name),
        side.cash ? formatRupees(side.cash) : null,
        side.pardons ? `${side.pardons} Get Out of Jail Free card${side.pardons > 1 ? 's' : ''}` : null,
      ]
        .filter(Boolean)
        .join(' and ');

    const text = `${this.nameOf(from)} traded ${describe(give)} to ${this.nameOf(to)} for ${describe(get)}`;
    this.set({
      balances,
      pardons,
      deeds,
      trades: (this.state.trades || []).filter((entry) => entry.id !== trade.id),
      ...this.record(text, from),
    });
    this.chat(text);
    this.sound('propertyBought');
    this.pruneTrades();
  }

  // Offers that can no longer happen (a deed changed hands, buildings went
  // up, someone went bankrupt) are dropped with a note.
  pruneTrades() {
    const trades = this.state.trades || [];

    if (trades.length === 0) {
      return;
    }

    const keep = trades.filter((trade) => !tradeProblem(this.state, trade, trade.mortgageChoice));

    if (keep.length !== trades.length) {
      this.set({ trades: keep });
      trades
        .filter((trade) => !keep.includes(trade))
        .forEach((trade) => this.chat(`The trade offer from ${this.nameOf(trade.from)} to ${this.nameOf(trade.to)} no longer works and was withdrawn`));
    }
  }

  // How a computer weighs an offer: what it gets against what it gives,
  // with a premium on completing a colour family and on keeping one whole.
  botEvaluateTrade(trade) {
    const me = trade.to;
    const cash = this.state.balances[me];
    const valueOf = (id, gaining) => {
      const space = BOARD_SPACES[id];
      const deed = this.state.deeds[id];
      let value = space.price;

      if (deed?.mortgaged) {
        value -= Estate.mortgageValue(id, BOARD_SPACES) + (gaining ? mortgageFee(id, 'interest') : 0);
      }

      if (space.type === 'property') {
        const family = Estate.getGroupSpaceIds(id, BOARD_SPACES);
        const others = family.filter((other) => other !== id);
        const ownsRest = others.every((other) => this.state.deeds[other]?.owner === me || trade.give.deeds.includes(other));

        if (ownsRest) {
          value *= 1.4;
        }
      }

      return value;
    };

    const gain =
      trade.give.cash +
      trade.give.pardons * TRADE_PARDON_VALUE +
      trade.give.deeds.reduce((sum, id) => sum + valueOf(id, true), 0);
    const loss =
      trade.get.cash +
      trade.get.pardons * TRADE_PARDON_VALUE +
      trade.get.deeds.reduce((sum, id) => sum + valueOf(id, false), 0);
    const comfortable = cash - trade.get.cash + trade.give.cash;
    const choices = {};

    trade.give.deeds.forEach((id) => {
      if (this.state.deeds[id]?.mortgaged) {
        choices[id] = comfortable - Estate.unmortgageCost(id, BOARD_SPACES) >= BOT_RESERVE * 3 ? 'lift' : 'interest';
      }
    });

    const fees = tradeFees(this.state, trade, choices).to;
    const accept = gain >= loss * 1.1 && comfortable - fees >= BOT_RESERVE;
    return { accept, choices };
  }

  botAnswerTrade(tradeId) {
    const trade = this.findTrade(tradeId);

    if (!trade || this.destroyed) {
      return;
    }

    const recipient = this.player(trade.to);

    // Nobody's estate is traded while they are away.
    if (recipient.away) {
      this.respondTrade(trade.to, trade.id, false);
      return;
    }

    const { accept, choices } = this.botEvaluateTrade(trade);
    this.respondTrade(trade.to, trade.id, accept, choices);
  }

  // ------------------------------------------------------------ end vote

  // Everyone still playing who is a person gets a vote; computer and AI
  // opponents always go along with the table.
  voters() {
    return this.alivePlayers().filter((player) => player.kind === 'human' && !player.away);
  }

  proposeEnd(playerId) {
    const player = this.player(playerId);

    if (!player || player.kind !== 'human' || !this.isAlive(playerId) || this.state.gameOver || this.state.endVote) {
      return false;
    }

    this.set({ endVote: { proposerId: playerId, agreed: [playerId], passed: false } });

    if (this.voters().length > 1) {
      this.chat(`${player.name} proposed ending the game, everyone must agree`);
    }

    this.checkEndVote();
    return true;
  }

  voteEnd(playerId, agree) {
    const vote = this.state.endVote;

    if (!vote || vote.passed || !this.voters().some((player) => player.id === playerId)) {
      return false;
    }

    if (!agree) {
      this.set({ endVote: null });
      this.chat(`${this.nameOf(playerId)} wants to keep playing, the game goes on`);
      return true;
    }

    if (!vote.agreed.includes(playerId)) {
      this.set({ endVote: { ...vote, agreed: [...vote.agreed, playerId] } });
    }

    this.checkEndVote();
    return true;
  }

  checkEndVote() {
    const vote = this.state.endVote;

    if (!vote || vote.passed || this.state.gameOver) {
      return;
    }

    const voters = this.voters();

    if (!voters.every((player) => vote.agreed.includes(player.id))) {
      return;
    }

    this.set({ endVote: { ...vote, passed: true } });

    if (this.state.busy) {
      this.chat('Everyone agreed, the game ends when this turn is over');
      this.pendingAction?.finish();
    } else {
      this.finish('agreed');
    }
  }

  // A person dropped out (away) or came back. While away the computer plays
  // their seat with their own cash and deeds; coming back hands it straight
  // back, from the next decision on.
  setAway(playerId, away, clientId = null) {
    const player = this.player(playerId);

    if (!player || player.kind !== 'human' || player.away === away) {
      if (player && !away && clientId) {
        this.set({
          players: this.state.players.map((entry) => (entry.id === playerId ? { ...entry, clientId } : entry)),
        });
      }
      return false;
    }

    this.set({
      players: this.state.players.map((entry) =>
        entry.id === playerId ? { ...entry, away, clientId: away ? null : clientId || entry.clientId } : entry,
      ),
    });

    if (away) {
      this.chat(`${player.name} disconnected, the computer plays their seat until they rejoin`);

      if (this.pendingPurchase?.playerId === playerId) {
        this.pendingPurchase.resolve(this.botWantsToBuy(playerId, BOARD_SPACES[this.pendingPurchase.spaceId]));
      }

      if (this.pendingAction?.playerId === playerId) {
        this.pendingAction.finish();
      }

      // A debt they were choosing for is settled automatically.
      if (this.pendingDebt?.playerId === playerId) {
        this.pendingDebt.done();
      }

      // Offers to or from someone who dropped out are withdrawn.
      (this.state.trades || [])
        .filter((trade) => trade.to === playerId || trade.from === playerId)
        .forEach((trade) => this.dropTrade(trade.id));
      this.checkEndVote();
    } else {
      this.chat(`${player.name} is back at the table`);
    }

    if (!this.state.busy && !this.state.gameOver) {
      this.schedule();
    }

    return true;
  }

  // A remote player left mid match: a computer opponent takes the seat.
  replaceWithBot(playerId) {
    const player = this.player(playerId);

    if (!player || player.kind !== 'human') {
      return;
    }

    this.set({
      players: this.state.players.map((entry) =>
        entry.id === playerId ? { ...entry, kind: 'bot', clientId: null } : entry,
      ),
    });
    this.chat(`${player.name} left the table, a computer opponent takes over the seat`);

    if (this.pendingPurchase?.playerId === playerId) {
      this.pendingPurchase.resolve(false);
    }

    this.checkEndVote();

    if (!this.state.busy && !this.state.gameOver) {
      this.schedule();
    }
  }
}
