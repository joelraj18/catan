// The Catan game engine.
//
// One engine runs per match, on the host's device. It owns the complete game
// state as a plain serialisable object, applies every rule, drives computer
// and AI opponents, and reports each change through `onChange` so the board
// can render it and the room can broadcast it. Remote players never run
// rules themselves; they send intents (roll, build, trade) that the host
// feeds into the public methods below, each of which checks that the move
// is legal for that player right now and returns false when it is not.

import {
  BEGINNER_COLOURS,
  BEGINNER_SETTLEMENTS,
  GEOMETRY,
  RESOURCES,
  RESOURCE_LABELS,
  beginnerBoard,
  boardFingerprint,
  randomBoard,
  shuffle,
} from './catanBoard';
import { cleanSettings, handLimitOf, settingsOf, victoryPointsOf } from './gameSettings';
import {
  COSTS,
  DEV_CARDS,
  DEV_DECK,
  addResources,
  canBuildCity,
  canPlaceRoad,
  canPlaceSettlement,
  cleanBundle,
  bundleSize,
  discardCount,
  emptyHand,
  fullBank,
  handSize,
  hasResources,
  hiddenPoints,
  largestArmyHolder,
  legalRoadSpots,
  longestRoadHolder,
  longestRoadLength,
  maritimeRates,
  piecesLeft,
  publicPoints,
  productionFor,
  robberVictims,
  settleProduction,
  totalPoints,
  tradeShapeProblem,
  vertexResources,
} from './catanRules';
import * as Bot from './catanBot';

export const DEFAULT_TIMING = {
  roll: 650, // dice tumble before the result shows
  botDelay: 900, // before a computer opponent makes its first move of a phase
  botStep: 700, // between a computer opponent's moves
  setupTurn: 120000, // a person places a set-up settlement and road within this
  discard: 60000, // people discard half their hand within this after a 7
  robber: 60000, // to move the robber and pick who to rob
  turn: 240000, // the trade and build phase of a person's turn
  tradeWait: 9000, // a computer's offer to the table stays open this long
  acceptWindow: 2500, // after a first yes to an open offer, others may still say yes this long
  advisor: 15000, // premium AI must answer within this
};

const LOG_LIMIT = 50;
const EVENT_LIMIT = 30;
const MAX_TRADES = 6;
const BOT_TURN_STEPS = 24;
// Most Claude calls one premium AI seat makes in a game; after that the
// computer strategy plays the seat.
export const AI_CALL_BUDGET = 40;
const END_TURN = 'end-turn';
const CANCELLED = Symbol('cancelled');

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

const byId = (players, make) => Object.fromEntries(players.map((player) => [player.id, make(player)]));

export const listResources = (bundle) =>
  Object.entries(bundle)
    .filter(([, count]) => count > 0)
    .map(([resource, count]) => `${count} ${RESOURCE_LABELS[resource].toLowerCase()}`)
    .join(', ');

const newDeck = (pickIndex) => {
  const cards = [];
  Object.entries(DEV_DECK).forEach(([type, count]) => {
    for (let i = 0; i < count; i += 1) cards.push(type);
  });
  return shuffle(cards, pickIndex);
};

// Which beginner position each player takes. With 3 players nobody plays
// red; a player who chose red takes the free position instead.
export const beginnerPositions = (players) => {
  const positions = players.length === 3 ? BEGINNER_COLOURS.filter((colour) => colour !== 'red') : BEGINNER_COLOURS;
  const assigned = {};
  const free = [...positions];
  players.forEach((player) => {
    if (free.includes(player.pieceKey)) {
      assigned[player.id] = player.pieceKey;
      free.splice(free.indexOf(player.pieceKey), 1);
    }
  });
  players.forEach((player) => {
    if (!assigned[player.id]) assigned[player.id] = free.shift();
  });
  return assigned;
};

// A road for a beginner settlement, pointing inland and not crossing
// another start.
const beginnerRoad = (roads, vertexId) => {
  const vertex = GEOMETRY.vertices[vertexId];
  const options = vertex.edges
    .filter((edgeId) => roads[edgeId] === undefined)
    .map((edgeId) => {
      const [a, b] = GEOMETRY.edges[edgeId].vertices;
      const other = a === vertexId ? b : a;
      return { edgeId, inland: GEOMETRY.vertices[other].hexes.length, other };
    })
    .sort((a, b) => b.inland - a.inland || a.other - b.other);
  return options[0].edgeId;
};

// The beginners' starting pieces for these players: two settlements and two
// roads each, and the resources around each starred settlement.
export const beginnerPieces = (players, board, hands = byId(players, emptyHand), bank = fullBank()) => {
  const positions = beginnerPositions(players);
  const buildings = {};
  const roads = {};
  let nextHands = { ...hands };
  let nextBank = { ...bank };

  players.forEach((player) => {
    const spots = BEGINNER_SETTLEMENTS[positions[player.id]];
    [spots.first, spots.star].forEach((vertexId) => {
      buildings[vertexId] = { owner: player.id, type: 'settlement' };
    });
  });

  players.forEach((player) => {
    const spots = BEGINNER_SETTLEMENTS[positions[player.id]];
    [spots.first, spots.star].forEach((vertexId) => {
      roads[beginnerRoad(roads, vertexId)] = player.id;
    });

    const start = {};
    vertexResources(board, spots.star).forEach((resource) => {
      start[resource] = (start[resource] || 0) + 1;
    });
    nextHands = { ...nextHands, [player.id]: addResources(nextHands[player.id], start) };
    nextBank = addResources(nextBank, start, -1);
  });

  return { buildings, roads, hands: nextHands, bank: nextBank };
};

// The host's table rules. Without a turn timer named, a game has none, as
// games did before the timer existed.
export const tableRules = (options = {}) => cleanSettings({ ...options, turnSeconds: options.turnSeconds ?? 0 });

export const createInitialState = (players, { options = {}, board, pickIndex = secureIndex } = {}) => {
  const settings = tableRules({ ...options, board: board ?? options.board });
  const mode = settings.board;
  const island = mode === 'random' ? randomBoard(pickIndex, settings) : beginnerBoard();
  return {
    version: 0,
    options: settings,
    boardId: boardFingerprint(island),
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      pieceKey: player.pieceKey,
      kind: player.kind, // 'human' | 'bot' | 'ai'
      clientId: player.clientId || null, // set for remote humans
      code: player.code || null, // the Player ID used to rejoin
      away: false, // a disconnected person, played by the computer until they rejoin
    })),
    board: island,
    buildings: {}, // vertexId -> { owner, type: 'settlement' | 'city' }
    roads: {}, // edgeId -> owner
    hands: byId(players, emptyHand),
    bank: fullBank(),
    devDeck: newDeck(pickIndex),
    devCards: byId(players, () => []), // { id, type, boughtTurn }
    devCounter: 0,
    knights: byId(players, () => 0),
    longestRoad: { holder: null, lengths: byId(players, () => 0) },
    largestArmy: null,
    turnCount: 0,
    activeIndex: 0,
    // 'setup' | 'pre-roll' | 'discard' | 'robber' | 'steal' | 'actions' | 'road-building'
    turnPhase: mode === 'random' ? 'setup' : 'pre-roll',
    // { order: [seat index], step, expect: 'settlement' | 'road', vertexId } during set-up
    setup: mode === 'random' ? { order: players.map((_, index) => index), step: 0, expect: 'settlement', vertexId: null } : null,
    pendingDiscards: {}, // playerId -> cards still to discard
    stealFrom: [], // who the robber may steal from
    robberReturn: 'actions',
    roadBuilding: null, // { remaining, returnPhase }
    devPlayedThisTurn: false,
    phaseEndsAt: null,
    phaseLength: null,
    dice: null,
    rolling: false,
    busy: false,
    thinking: null, // id of a premium AI seat waiting on Claude
    aiUsage: {}, // premium AI seat -> { calls, tokens }
    activity: 'Setting up the island',
    log: [],
    logCounter: 0,
    lastSteal: null, // { id, thief, victim, resource } — only the two of them see the resource
    // What just happened, as data the board can animate and announce:
    // { id, type, turn, actor, ... } newest last; see event() for the types.
    events: [],
    eventCounter: 0,
    trades: [], // open offers in this turn's trade phase
    tradeCounter: 0,
    endVote: null, // { proposerId, agreed: [ids], passed }
    gameOver: null,
    sfx: null,
  };
};

// Final standings: every point counts, hidden victory point cards included.
export const computeStandings = (state) =>
  state.players
    .map((player) => {
      const built = Object.values(state.buildings).filter((b) => b.owner === player.id);
      return {
        id: player.id,
        name: player.name,
        pieceKey: player.pieceKey,
        points: totalPoints(state, player.id),
        victoryCards: hiddenPoints(state, player.id),
        settlements: built.filter((b) => b.type === 'settlement').length,
        cities: built.filter((b) => b.type === 'city').length,
        longestRoad: state.longestRoad.holder === player.id,
        largestArmy: state.largestArmy === player.id,
        roadLength: state.longestRoad.lengths[player.id] || 0,
        knights: state.knights[player.id] || 0,
      };
    })
    .sort((a, b) => b.points - a.points);

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
    options = {},
  }) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.advisor = advisor;
    this.rollDie = rollDie;
    this.pickIndex = pickIndex;
    this.random = random;
    this.onChange = onChange;
    this.onChat = onChat;
    this.timers = new Set();
    this.destroyed = false;
    this.sfxCounter = 0;
    this.advisorFailed = false;
    this.stepping = false;
    this.emitQueued = false;
    this.botMemory = {};
    this.deadlineKey = null;

    if (initialState) {
      this.state = GameEngine.resumable(initialState);
    } else {
      this.state = createInitialState(players, { options, pickIndex });
      this.openGame();
    }
  }

  // ---------------------------------------------------------------- basics

  start() {
    this.emit();
    this.schedule();
  }

  // A saved snapshot, made safe to continue from: no dice in the air, no
  // open offers, and every countdown starts afresh.
  static resumable(saved) {
    return {
      ...saved,
      busy: false,
      rolling: false,
      thinking: null,
      trades: [],
      phaseEndsAt: null,
      phaseLength: null,
      sfx: null,
      log: Array.isArray(saved.log) ? saved.log : [],
      logCounter: saved.logCounter || 0,
      events: Array.isArray(saved.events) ? saved.events : [],
      eventCounter: saved.eventCounter || 0,
    };
  }

  destroy() {
    this.destroyed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  // Every change within one move lands in a single report: the board, the
  // guests and the saved game only ever see whole moves, never a half-done
  // one (a discard phase with nobody left to discard, a tenth point a moment
  // before the win), and a move costs one render and one broadcast.
  emit() {
    if (this.destroyed || this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      if (!this.destroyed) this.onChange(this.state);
    });
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

  get activePlayer() {
    return this.state.players[this.state.activeIndex];
  }

  isActive(id) {
    return this.activePlayer?.id === id;
  }

  // Computer and AI opponents, and people who are away, play automatically.
  isAuto(id) {
    const player = this.player(id);
    return Boolean(player && (player.kind === 'bot' || player.kind === 'ai' || player.away));
  }

  canAct() {
    return !this.destroyed && !this.state.gameOver && !this.state.busy;
  }

  // Adds a line to the shared activity log, newest last.
  record(text, playerId = null) {
    const logCounter = (this.state.logCounter || 0) + 1;
    const log = [...(this.state.log || []), { id: logCounter, text, playerId }].slice(-LOG_LIMIT);
    return { log, logCounter };
  }

  note(text, playerId = null, patch = {}) {
    this.set({ ...patch, ...this.record(text, playerId) });
  }

  // Records one thing that happened, for animations and the side notes:
  // roll, produce, build, buyDev, playDev, yop, monopoly, steal, discard,
  // robber, trade, maritime, win. Who may see what is settled in redactFor.
  event(type, fields = {}) {
    const eventCounter = (this.state.eventCounter || 0) + 1;
    const entry = { id: eventCounter, type, turn: this.state.turnCount, ...fields };
    this.set({ events: [...(this.state.events || []), entry].slice(-EVENT_LIMIT), eventCounter });
  }

  // Sounds for the board to play. Several within one move travel together
  // (a robber landing, then a steal) and play one after the other.
  sound(key) {
    const sfx = this.state.sfx;
    if (this.emitQueued && sfx?.id === this.sfxCounter) {
      this.set({ sfx: { ...sfx, keys: [...(sfx.keys || [sfx.key]), key] } });
      return;
    }
    this.sfxCounter += 1;
    this.set({ sfx: { key, keys: [key], id: this.sfxCounter } });
  }

  chat(text, playerId = null) {
    this.onChat({ playerId, text });
  }

  pay(playerId, cost) {
    this.set({
      hands: { ...this.state.hands, [playerId]: addResources(this.state.hands[playerId], cost, -1) },
      bank: addResources(this.state.bank, cost),
    });
  }

  give(playerId, bundle) {
    this.set({
      hands: { ...this.state.hands, [playerId]: addResources(this.state.hands[playerId], bundle) },
      bank: addResources(this.state.bank, bundle, -1),
    });
  }

  move(from, to, bundle) {
    const hands = { ...this.state.hands };
    hands[from] = addResources(hands[from], bundle, -1);
    hands[to] = addResources(hands[to], bundle);
    this.set({ hands });
  }

  // ------------------------------------------------------------- opening

  // Decides who starts (everyone rolls, highest begins) and sets up the
  // board: the beginners' map comes with pieces already placed and starting
  // resources dealt; the variable map starts the two placement rounds.
  openGame() {
    const { players } = this.state;
    let contenders = players.map((_, index) => index);
    const lines = [];

    for (let round = 0; round < 10 && contenders.length > 1; round += 1) {
      const rolls = contenders.map((index) => ({ index, total: this.rollDie() + this.rollDie() }));
      lines.push(rolls.map(({ index, total }) => `${players[index].name} ${total}`).join(', '));
      const top = Math.max(...rolls.map((roll) => roll.total));
      contenders = rolls.filter((roll) => roll.total === top).map((roll) => roll.index);
    }

    const first = contenders[0];
    const starter = players[first];
    let patch = { activeIndex: first, ...this.record(`Opening rolls: ${lines.join(' · ')}`) };
    this.state = { ...this.state, ...patch };
    patch = this.record(`${starter.name} rolled highest and goes first`, starter.id);
    this.state = { ...this.state, ...patch };

    if (this.state.options.board === 'beginner') {
      this.placeBeginnerPieces();
      this.state = {
        ...this.state,
        turnPhase: 'pre-roll',
        turnCount: 1,
        activity: `${starter.name} rolls first`,
      };
    } else {
      const order = [];
      for (let i = 0; i < players.length; i += 1) order.push((first + i) % players.length);
      const snake = [...order, ...[...order].reverse()];
      this.state = {
        ...this.state,
        setup: { order: snake, step: 0, expect: 'settlement', vertexId: null },
        activity: `${starter.name} places the first settlement`,
      };
    }
  }

  placeBeginnerPieces() {
    const placed = beginnerPieces(this.state.players, this.state.board, this.state.hands, this.state.bank);
    this.state = { ...this.state, ...placed };
    this.refreshLongestRoad();
    this.state = { ...this.state, ...this.record('Beginners\u2019 island: starting settlements and roads are placed') };
  }

  // -------------------------------------------------------- scheduling

  // Who must decide something right now.
  waitingOn() {
    const { state } = this;
    if (state.gameOver || state.busy) return [];
    if (state.turnPhase === 'setup') return [state.players[state.setup.order[state.setup.step]].id];
    if (state.turnPhase === 'discard') return Object.keys(state.pendingDiscards);
    return [this.activePlayer.id];
  }

  // Arms the next computer move, the answers computer seats owe to open
  // offers, and the countdown for people.
  schedule() {
    this.clearLater(this.botTimer);
    this.botTimer = null;

    if (this.destroyed || this.state.gameOver) return;

    if (this.state.endVote?.passed && !this.state.busy) {
      this.finish('agreed');
      return;
    }

    if (this.state.busy) return;

    this.armDeadline();

    // Offers waiting on a computer seat's answer.
    const unanswered = (this.state.trades || []).find((trade) =>
      this.tradeParties(trade).some((id) => id !== trade.from && this.isAuto(id) && trade.responses[id] === undefined),
    );

    const auto = this.waitingOn().filter((id) => this.isAuto(id));

    if (auto.length || unanswered) {
      const fresh = this.lastAutoKey !== this.phaseKey();
      this.lastAutoKey = this.phaseKey();
      this.botTimer = this.later(() => this.autoStep(), fresh ? this.timing.botDelay : this.timing.botStep);
    }
  }

  phaseKey() {
    const { state } = this;
    return `${state.turnCount}:${state.turnPhase}:${state.setup?.step ?? ''}:${state.setup?.expect ?? ''}:${state.activeIndex}`;
  }

  // How long a person has for this phase, or null for no limit. With the
  // host's turn timer the roll and every move get the chosen seconds (a
  // little more where others must answer first); without it people roll
  // when they like and the classic, generous clocks apply.
  phaseLimit(phase) {
    const seconds = settingsOf(this.state).turnSeconds;
    const t = this.timing;
    if (!seconds) {
      if (phase === 'pre-roll') return null;
      if (phase === 'setup') return t.setupTurn;
      if (phase === 'discard') return t.discard;
      if (phase === 'robber' || phase === 'steal') return t.robber;
      return t.turn;
    }
    const scale = t.clockScale ?? 1;
    const move = seconds * 1000;
    if (phase === 'setup') return Math.max(2 * move, 30000) * scale;
    if (phase === 'discard' || phase === 'robber' || phase === 'steal') return Math.max(move, 20000) * scale;
    // An offer on the table gets time for answers.
    const offering = (this.state.trades || []).some((trade) => trade.from === this.activePlayer.id);
    if (phase === 'actions' && offering) return Math.max(move, 12000) * scale;
    return move * scale;
  }

  // The clock restarts with each phase, and with the turn timer also after
  // every move of the player whose turn it is.
  deadlineKeyNow() {
    const timed = settingsOf(this.state).turnSeconds > 0;
    const phase = this.state.turnPhase;
    const perMove = timed && (phase === 'actions' || phase === 'road-building');
    return `${this.phaseKey()}${perMove ? `:${this.clockTicks || 0}` : ''}`;
  }

  // A countdown for the people this phase waits on; when it runs out the
  // computer makes their move so the table never stalls: it rolls for them,
  // ends their turn, or finishes their set-up, discard or robber move.
  armDeadline() {
    const key = this.deadlineKeyNow();
    if (this.deadlineKey === key) return;
    this.deadlineKey = key;
    this.clearLater(this.deadlineTimer);
    this.deadlineTimer = null;

    const humans = this.waitingOn().filter((id) => !this.isAuto(id));
    const phase = this.state.turnPhase;
    const length = humans.length ? this.phaseLimit(phase) : null;
    if (!length) {
      if (this.state.phaseEndsAt) this.set({ phaseEndsAt: null, phaseLength: null });
      return;
    }

    // The classic trade and build clock runs for the whole turn: playing a
    // knight or Road Building part way through does not start it again.
    let endsAt = Date.now() + length;
    const timed = settingsOf(this.state).turnSeconds > 0;
    if (!timed && (phase === 'actions' || phase === 'road-building')) {
      if (this.turnClock?.turn === this.state.turnCount) endsAt = this.turnClock.endsAt;
      else this.turnClock = { turn: this.state.turnCount, endsAt };
    }

    this.set({ phaseEndsAt: endsAt, phaseLength: length });
    this.deadlineTimer = this.later(() => {
      if (this.deadlineKeyNow() !== key || this.state.gameOver) return;
      const late = this.waitingOn().filter((id) => !this.isAuto(id));
      late.forEach((id) => {
        if (phase === 'pre-roll') this.note(`${this.nameOf(id)}'s dice were rolled for them`, id);
        else if (phase === 'actions') this.note(`${this.nameOf(id)}'s time ran out, the turn passes on`, id);
        else this.chat(`${this.nameOf(id)} ran out of time, the computer moves for them`);
      });
      this.forceMoves(late, this.phaseKey());
    }, Math.max(0, endsAt - Date.now()));
  }

  // Moves for the people a timed-out phase waits on. If a computer move is
  // still running it waits, and drops out if the phase has moved on by then.
  async forceMoves(ids, key) {
    if (this.phaseKey() !== key || this.state.gameOver) return;
    if (this.stepping) {
      this.later(() => this.forceMoves(ids, key), 300);
      return;
    }

    this.stepping = true;
    try {
      for (const id of ids) {
        const step = this.state.setup?.step;
        // A set-up turn (settlement and road) and Road Building finish whole.
        for (let guard = 0; guard < 3; guard += 1) {
          // eslint-disable-next-line no-await-in-loop
          await this.autoMove(id, { forced: true });
          const phase = this.state.turnPhase;
          const unfinished =
            (phase === 'setup' && this.state.setup?.step === step) || (phase === 'road-building' && this.isActive(id));
          if (!unfinished || this.state.gameOver) break;
        }
      }
    } catch (error) {
      if (error !== CANCELLED) {
        // eslint-disable-next-line no-console
        console.error(error);
      }
    } finally {
      this.stepping = false;
    }
    this.schedule();
  }

  async autoStep() {
    if (this.stepping || !this.canAct()) return;
    this.stepping = true;

    try {
      // Answer offers first, then make the move the phase waits on.
      const trade = (this.state.trades || []).find((entry) =>
        this.tradeParties(entry).some((id) => id !== entry.from && this.isAuto(id) && entry.responses[id] === undefined),
      );
      if (trade) {
        const responder = this.tradeParties(trade).find(
          (id) => id !== trade.from && this.isAuto(id) && trade.responses[id] === undefined,
        );
        const accept = await this.decideTrade(responder, trade);
        this.respondTrade(responder, trade.id, accept, { quiet: true });
      } else {
        const waiting = this.waitingOn().filter((id) => this.isAuto(id));
        if (this.state.turnPhase === 'discard') {
          waiting.forEach((id) => this.discard(id, Bot.chooseDiscard(this.state, id)));
        } else if (waiting.length) {
          await this.autoMove(waiting[0]);
        }
      }
    } catch (error) {
      if (error !== CANCELLED) {
        // eslint-disable-next-line no-console
        console.error(error);
      }
    } finally {
      this.stepping = false;
    }

    this.schedule();
  }

  // One computer move for a seat in the current phase.
  async autoMove(id, { forced = false } = {}) {
    const { state } = this;
    if (state.gameOver) return;
    const phase = state.turnPhase;

    if (phase === 'setup') {
      if (state.setup.expect === 'settlement') {
        const vertexId = await this.decideSetup(id);
        this.placeSettlement(id, vertexId);
      } else {
        this.placeRoad(id, Bot.chooseSetupRoad(state, id, state.setup.vertexId));
      }
      return;
    }

    if (phase === 'discard') {
      this.discard(id, Bot.chooseDiscard(state, id));
      return;
    }

    if (phase === 'robber') {
      this.moveRobber(id, await this.decideRobber(id));
      return;
    }

    if (phase === 'steal') {
      this.steal(id, Bot.chooseVictim(state, id, state.stealFrom));
      return;
    }

    if (phase === 'road-building') {
      const edge = Bot.roadTowardSite(state, id) ?? legalRoadSpots(state, id)[0];
      if (edge === undefined || edge === null) this.finishRoadBuilding();
      else this.placeRoad(id, edge);
      return;
    }

    if (phase === 'pre-roll') {
      if (!forced && Bot.wantsKnightBeforeRoll(state, id)) {
        this.playDev(id, 'knight');
        return;
      }
      await this.roll(id);
      return;
    }

    if (phase === 'actions') {
      if (forced) {
        this.endTurn(id);
        return;
      }
      await this.botTurnStep(id);
    }
  }

  async botTurnStep(id) {
    const memory = this.botMemory[this.state.turnCount] || { steps: 0, maritime: 0, offered: false };
    this.botMemory = { [this.state.turnCount]: memory };
    memory.steps += 1;

    // Wait for answers to our own open offer, then close it.
    const open = this.state.trades.find((trade) => trade.from === id);
    if (open) {
      const taker = Object.entries(open.responses).find(([, answer]) => answer === true)?.[0];
      const parties = this.tradeParties(open);
      const allAnswered = parties.every((party) => party === id || open.responses[party] !== undefined);
      if (taker) this.completeTrade(id, open.id, taker);
      else if (allAnswered || Date.now() - open.createdAt >= this.timing.tradeWait) this.cancelTrade(id, open.id);
      else await this.sleep(Math.min(1500, this.timing.tradeWait));
      return;
    }

    if (memory.steps > BOT_TURN_STEPS) {
      this.endTurn(id);
      return;
    }

    // A premium AI seat plans its whole trade and build phase in one call.
    if (this.player(id)?.kind === 'ai' && !memory.planned) {
      memory.planned = true;
      memory.plan = await this.planTurn(id);
      if (this.destroyed || this.state.turnPhase !== 'actions' || !this.isActive(id)) return;
    }

    if (memory.plan?.length) {
      const next = memory.plan.shift();
      if (next === END_TURN) {
        this.endTurn(id);
        return;
      }
      if (!this.perform(id, next, memory)) memory.steps += 1;
      return;
    }

    const action = Bot.nextAction(this.state, id, memory);

    if (!action) {
      this.endTurn(id);
      return;
    }

    if (!this.perform(id, action, memory)) memory.steps += 6;
  }

  // Carries out one move chosen by a computer or AI seat.
  perform(id, action, memory = {}) {
    switch (action.type) {
      case 'build-city':
        return this.buildCity(id, action.vertexId);
      case 'place-settlement':
        return this.placeSettlement(id, action.vertexId);
      case 'place-road':
        return this.placeRoad(id, action.edgeId);
      case 'buy-dev':
        return this.buyDev(id);
      case 'play-dev':
        return this.playDev(id, action.card, action);
      case 'maritime':
        memory.maritime = (memory.maritime || 0) + 1;
        return this.maritime(id, action.give, action.get);
      case 'trade-propose':
        memory.offered = true;
        return this.proposeTrade(id, action);
      default:
        return false;
    }
  }

  // ---------------------------------------------------- premium advisor

  // Asks a premium AI seat about ranked options and returns its plan as a
  // list of option indexes, or null to use the computer's choice. Any
  // failure, refusal, timeout or spent budget falls back.
  async consult(playerId, kind, options) {
    const player = this.player(playerId);
    if (!this.advisor || !player || player.kind !== 'ai' || player.away || options.length < 2) return null;

    const used = this.state.aiUsage?.[playerId]?.calls || 0;
    if (used >= AI_CALL_BUDGET) {
      if (used === AI_CALL_BUDGET) {
        this.chat(`${player.name} has used its Claude budget for this game, the computer strategy plays on`);
        this.set({ aiUsage: { ...this.state.aiUsage, [playerId]: { ...this.state.aiUsage[playerId], calls: used + 1 } } });
      }
      return null;
    }

    this.set({ thinking: playerId });
    try {
      // A late answer or failure after the time limit is simply dropped.
      const asked = Promise.resolve(
        this.advisor({ kind, playerId, state: this.state, options: options.map((option) => option.label) }),
      );
      asked.catch(() => {});
      let timeout = null;
      const answer = await Promise.race([
        asked,
        new Promise((resolve) => {
          timeout = this.later(() => resolve(null), this.timing.advisor);
        }),
      ]).finally(() => this.clearLater(timeout));
      if (this.destroyed) throw CANCELLED;
      const calls = (this.state.aiUsage?.[playerId]?.calls || 0) + 1;
      const tokens = answer?.usage ? answer.usage.input + answer.usage.output + answer.usage.cached : this.state.aiUsage?.[playerId]?.tokens || 0;
      this.set({ aiUsage: { ...this.state.aiUsage, [playerId]: { calls, tokens } } });
      if (!answer) return null;
      if (answer.comment) this.chat(answer.comment, playerId);
      const plan = (Array.isArray(answer.plan) ? answer.plan : [answer.choice])
        .map(Number)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length);
      return plan.length ? plan : null;
    } catch (error) {
      if (error === CANCELLED || this.destroyed) throw CANCELLED;
      if (!this.advisorFailed) {
        this.advisorFailed = true;
        this.chat('The premium AI could not be reached, the computer plays its moves for now');
      }
      return null;
    } finally {
      if (!this.destroyed) this.set({ thinking: null });
    }
  }

  async choose(playerId, kind, options) {
    const plan = await this.consult(playerId, kind, options);
    return plan ? plan[0] : 0;
  }

  async decideSetup(id) {
    const ranked = Bot.rankSetupSettlements(this.state, id).slice(0, 6);
    const options = ranked.map(({ vertexId }) => ({
      vertexId,
      label: `Intersection ${vertexId}: ${GEOMETRY.vertices[vertexId].hexes
        .map((hexId) => {
          const hex = this.state.board.hexes[hexId];
          return `${hex.terrain}${hex.number ? ` ${hex.number}` : ''}`;
        })
        .join(' + ')}${this.state.board.harbors.find((h) => h.vertices.includes(vertexId)) ? ' (harbour)' : ''}`,
    }));
    const choice = await this.choose(id, 'setup', options);
    return options[choice]?.vertexId ?? ranked[0]?.vertexId;
  }

  async decideRobber(id) {
    const ranked = Bot.rankRobberHexes(this.state, id).slice(0, 5);
    const options = ranked.map(({ hexId }) => {
      const hex = this.state.board.hexes[hexId];
      const owners = new Set(
        GEOMETRY.hexes[hexId].vertices.map((v) => this.state.buildings[v]?.owner).filter(Boolean),
      );
      return {
        hexId,
        label: `${hex.terrain}${hex.number ? ` ${hex.number}` : ''} touching ${[...owners].map((o) => this.nameOf(o)).join(', ') || 'nobody'}`,
      };
    });
    // Only a close call is worth asking about.
    const close = ranked.length > 1 && ranked[0].score > 0 && ranked[1].score >= ranked[0].score * 0.8;
    const choice = close ? await this.choose(id, 'robber', options) : 0;
    return options[choice]?.hexId ?? ranked[0].hexId;
  }

  // Every sensible move this turn, as options for one plan.
  turnOptions(id) {
    const { state } = this;
    const hand = state.hands[id];
    const left = piecesLeft(state, id);
    const options = [];
    const add = (action) => options.push({ action, label: describeAction(action, state) });

    if (hasResources(hand, COSTS.city) && left.city > 0) {
      const vertexId = Bot.bestCitySpot(state, id);
      if (vertexId !== null) add({ type: 'build-city', vertexId });
    }
    if (hasResources(hand, COSTS.settlement) && left.settlement > 0) {
      const vertexId = Bot.bestSettlementSpot(state, id);
      if (vertexId !== null) add({ type: 'place-settlement', vertexId });
    }
    if (hasResources(hand, COSTS.road) && left.road > 0) {
      const edgeId = Bot.roadTowardSite(state, id) ?? legalRoadSpots(state, id)[0];
      if (edgeId !== undefined && edgeId !== null) add({ type: 'place-road', edgeId });
    }
    if (hasResources(hand, COSTS.dev) && state.devDeck.length) add({ type: 'buy-dev' });

    if (!state.devPlayedThisTurn) {
      const ready = new Set(
        (state.devCards[id] || []).filter((card) => card.boughtTurn !== state.turnCount).map((card) => card.type),
      );
      if (ready.has('knight')) add({ type: 'play-dev', card: 'knight' });
      if (ready.has('roadBuilding') && legalRoadSpots(state, id).length) add({ type: 'play-dev', card: 'roadBuilding' });
      if (ready.has('yearOfPlenty')) add({ type: 'play-dev', card: 'yearOfPlenty', resources: Bot.chooseYearOfPlenty(state, id) });
      if (ready.has('monopoly')) add({ type: 'play-dev', card: 'monopoly', resource: Bot.chooseMonopoly(state, id) });
    }

    const trade = Bot.maritimeToward(state, id);
    if (trade) add(trade);
    return options;
  }

  // One Claude call per turn: the AI orders the moves it wants. With fewer
  // than two real choices the computer just plays them, free.
  async planTurn(id) {
    const options = this.turnOptions(id);
    if (options.length < 2) return null;
    const end = { action: END_TURN, label: 'End the turn' };
    const plan = await this.consult(id, 'turn', [...options, end]);
    if (!plan) return null;
    const steps = [];
    for (const index of plan) {
      const entry = index === options.length ? END_TURN : options[index].action;
      steps.push(entry);
      if (entry === END_TURN) break;
    }
    return steps;
  }

  async decideTrade(id, trade) {
    const { blocked, margin } = Bot.tradeValue(this.state, id, trade);
    const accept = !blocked && margin > 0;
    if (this.player(id)?.kind !== 'ai' || blocked) return accept;
    // Ask only about offers worth thinking over: a person's offer the
    // computer cannot call clearly, or any offer from someone close to winning.
    const proposer = trade.from === id ? trade.to : trade.from;
    const nearWin = publicPoints(this.state, proposer) >= victoryPointsOf(this.state) - 3;
    const unclearFromPerson = this.player(proposer)?.kind === 'human' && Math.abs(margin) < 0.8;
    if (!nearWin && !unclearFromPerson) return accept;
    const summary = describeTrade(this.state, trade, id);
    const options = accept
      ? [{ label: `Accept: ${summary}` }, { label: 'Decline' }]
      : [{ label: 'Decline' }, { label: `Accept: ${summary}` }];
    const choice = await this.choose(id, 'trade', options);
    return choice === 0 ? accept : !accept;
  }

  // ---------------------------------------------------------- set-up phase

  setupPlayerId() {
    const { setup, players } = this.state;
    return setup ? players[setup.order[setup.step]].id : null;
  }

  setupPlaceSettlement(playerId, vertexId) {
    const { setup } = this.state;
    if (setup.expect !== 'settlement' || this.setupPlayerId() !== playerId) return false;
    if (!canPlaceSettlement(this.state, playerId, vertexId, { setup: true })) return false;

    const second = setup.step >= this.state.players.length;
    this.setBoard(
      {
        buildings: { ...this.state.buildings, [vertexId]: { owner: playerId, type: 'settlement' } },
        setup: { ...setup, expect: 'road', vertexId },
        activity: `${this.nameOf(playerId)} places a road next to their settlement`,
      },
      `${this.nameOf(playerId)} founded a settlement`,
      playerId,
    );
    this.event('build', { actor: playerId, piece: 'settlement', at: vertexId, free: true });

    if (second) {
      const start = {};
      vertexResources(this.state.board, vertexId).forEach((resource) => {
        start[resource] = (start[resource] || 0) + 1;
      });
      if (bundleSize(start)) {
        this.give(playerId, start);
        this.note(`${this.nameOf(playerId)} collected ${listResources(start)}`, playerId);
        this.event('produce', { gains: { [playerId]: start }, hexes: GEOMETRY.vertices[vertexId].hexes });
      }
    }

    this.sound('settlement');
    this.afterAction(playerId);
    return true;
  }

  setupPlaceRoad(playerId, edgeId) {
    const { setup } = this.state;
    if (setup.expect !== 'road' || this.setupPlayerId() !== playerId) return false;
    if (!canPlaceRoad(this.state, playerId, edgeId, { fromVertex: setup.vertexId })) return false;

    this.setBoard({ roads: { ...this.state.roads, [edgeId]: playerId } });
    this.event('build', { actor: playerId, piece: 'road', at: edgeId, free: true });

    const step = setup.step + 1;
    if (step >= setup.order.length) {
      const first = setup.order[setup.order.length - 1];
      this.set({
        setup: null,
        turnPhase: 'pre-roll',
        activeIndex: first,
        turnCount: 1,
        activity: `${this.state.players[first].name} rolls first`,
        ...this.record('Set-up complete, the game begins'),
      });
    } else {
      const next = this.state.players[setup.order[step]];
      this.set({
        setup: { ...setup, step, expect: 'settlement', vertexId: null },
        activeIndex: setup.order[step],
        activity: `${next.name} places a settlement`,
      });
    }

    this.sound('road');
    this.afterAction(playerId);
    return true;
  }

  // ------------------------------------------------------------ building

  placeSettlement(playerId, vertexId) {
    if (!this.canAct()) return false;
    if (this.state.turnPhase === 'setup') return this.setupPlaceSettlement(playerId, vertexId);
    if (this.state.turnPhase !== 'actions' || !this.isActive(playerId)) return false;
    if (!hasResources(this.state.hands[playerId], COSTS.settlement)) return false;
    if (!canPlaceSettlement(this.state, playerId, vertexId)) return false;

    this.pay(playerId, COSTS.settlement);
    // A new settlement can cut an opponent's road.
    this.setBoard(
      { buildings: { ...this.state.buildings, [vertexId]: { owner: playerId, type: 'settlement' } } },
      `${this.nameOf(playerId)} built a settlement`,
      playerId,
    );
    this.event('build', { actor: playerId, piece: 'settlement', at: vertexId, paid: COSTS.settlement });
    this.sound('settlement');
    this.afterAction(playerId);
    return true;
  }

  placeRoad(playerId, edgeId) {
    if (!this.canAct()) return false;
    const phase = this.state.turnPhase;
    if (phase === 'setup') return this.setupPlaceRoad(playerId, edgeId);
    if (!this.isActive(playerId)) return false;

    if (phase === 'road-building') {
      if (!canPlaceRoad(this.state, playerId, edgeId)) return false;
      const remaining = this.state.roadBuilding.remaining - 1;
      this.setBoard(
        { roads: { ...this.state.roads, [edgeId]: playerId }, roadBuilding: { ...this.state.roadBuilding, remaining } },
        `${this.nameOf(playerId)} placed a free road`,
        playerId,
      );
      this.event('build', { actor: playerId, piece: 'road', at: edgeId, free: true });
      this.sound('road');
      if (remaining <= 0 || !legalRoadSpots(this.state, playerId).length) this.finishRoadBuilding();
      this.afterAction(playerId);
      return true;
    }

    if (phase !== 'actions') return false;
    if (!hasResources(this.state.hands[playerId], COSTS.road)) return false;
    if (!canPlaceRoad(this.state, playerId, edgeId)) return false;

    this.pay(playerId, COSTS.road);
    this.setBoard({ roads: { ...this.state.roads, [edgeId]: playerId } }, `${this.nameOf(playerId)} built a road`, playerId);
    this.event('build', { actor: playerId, piece: 'road', at: edgeId, paid: COSTS.road });
    this.sound('road');
    this.afterAction(playerId);
    return true;
  }

  finishRoadBuilding() {
    const back = this.state.roadBuilding?.returnPhase || 'actions';
    this.set({ roadBuilding: null, turnPhase: back });
  }

  buildCity(playerId, vertexId) {
    if (!this.canAct() || this.state.turnPhase !== 'actions' || !this.isActive(playerId)) return false;
    if (!hasResources(this.state.hands[playerId], COSTS.city)) return false;
    if (!canBuildCity(this.state, playerId, vertexId)) return false;

    this.pay(playerId, COSTS.city);
    this.set({ buildings: { ...this.state.buildings, [vertexId]: { owner: playerId, type: 'city' } } });
    this.note(`${this.nameOf(playerId)} upgraded a settlement to a city`, playerId);
    this.event('build', { actor: playerId, piece: 'city', at: vertexId, paid: COSTS.city });
    this.sound('city');
    this.afterAction(playerId);
    return true;
  }

  buyDev(playerId) {
    if (!this.canAct() || this.state.turnPhase !== 'actions' || !this.isActive(playerId)) return false;
    if (!hasResources(this.state.hands[playerId], COSTS.dev) || !this.state.devDeck.length) return false;

    const [type, ...devDeck] = this.state.devDeck;
    const devCounter = this.state.devCounter + 1;
    this.pay(playerId, COSTS.dev);
    this.set({
      devDeck,
      devCounter,
      devCards: {
        ...this.state.devCards,
        [playerId]: [...this.state.devCards[playerId], { id: devCounter, type, boughtTurn: this.state.turnCount }],
      },
    });
    this.note(`${this.nameOf(playerId)} bought a development card`, playerId);
    this.event('buyDev', { actor: playerId, paid: COSTS.dev });
    this.sound('card');
    this.afterAction(playerId);
    return true;
  }

  // Longest Road for a board, checked after every road and settlement.
  longestRoadFor(state) {
    const lengths = {};
    state.players.forEach((player) => {
      lengths[player.id] = longestRoadLength(state, player.id);
    });
    return { holder: longestRoadHolder(lengths, state.longestRoad.holder), lengths };
  }

  refreshLongestRoad() {
    this.state = { ...this.state, longestRoad: this.longestRoadFor(this.state) };
  }

  // Changes roads or buildings and the Longest Road in one step, so no
  // snapshot ever shows a stale road length.
  setBoard(patch, text = null, playerId = null) {
    const before = this.state.longestRoad.holder;
    const longestRoad = this.longestRoadFor({ ...this.state, ...patch });
    this.set({ ...patch, longestRoad, ...(text ? this.record(text, playerId) : {}) });

    if (longestRoad.holder !== before) {
      const announce = longestRoad.holder
        ? `${this.nameOf(longestRoad.holder)} takes the Longest Road (${longestRoad.lengths[longestRoad.holder]} roads)`
        : 'The Longest Road card is set aside';
      this.note(announce, longestRoad.holder);
      this.chat(announce);
    }
  }

  // ---------------------------------------------------------- rolling

  async roll(playerId) {
    if (!this.canAct() || this.state.turnPhase !== 'pre-roll' || !this.isActive(playerId)) return false;

    const dice = [this.rollDie(), this.rollDie()];
    const total = dice[0] + dice[1];
    this.set({ busy: true, rolling: true, dice, activity: `${this.nameOf(playerId)} is rolling` });
    this.sound('dice');

    try {
      await this.sleep(this.timing.roll);
    } catch (error) {
      if (error === CANCELLED) return false;
      throw error;
    }

    this.set({ rolling: false, busy: false, trades: [], ...this.record(`${this.nameOf(playerId)} rolled ${total}`, playerId) });
    this.event('roll', { actor: playerId, dice });

    if (total === 7) {
      const pendingDiscards = {};
      this.state.players.forEach((player) => {
        const count = discardCount(this.state.hands[player.id], handLimitOf(this.state));
        if (count) pendingDiscards[player.id] = count;
      });
      const discarders = Object.keys(pendingDiscards);
      this.set({
        pendingDiscards,
        robberReturn: 'actions',
        turnPhase: discarders.length ? 'discard' : 'robber',
        activity: discarders.length
          ? `A 7! ${discarders.map((id) => this.nameOf(id)).join(', ')} must discard half`
          : `A 7! ${this.nameOf(playerId)} moves the robber`,
      });
      this.sound('robber');
    } else {
      this.produce(total);
      this.set({ turnPhase: 'actions', activity: `${this.nameOf(playerId)} rolled ${total}, trade and build` });
    }

    this.afterAction(playerId);
    return true;
  }

  produce(total) {
    const owed = productionFor(this.state, total);
    const { paid, shortages } = settleProduction(owed, this.state.bank);
    const hands = { ...this.state.hands };
    let bank = { ...this.state.bank };

    Object.entries(paid).forEach(([id, bundle]) => {
      hands[id] = addResources(hands[id], bundle);
      bank = addResources(bank, bundle, -1);
    });
    this.set({ hands, bank });

    const gains = Object.fromEntries(Object.entries(paid).filter(([, bundle]) => handSize(bundle) > 0));
    if (Object.keys(gains).length) {
      const hexes = this.state.board.hexes
        .filter((hex) => hex.number === total && hex.id !== this.state.board.robber)
        .map((hex) => hex.id);
      this.event('produce', { gains, hexes, total });
    }

    const lines = Object.entries(paid)
      .filter(([, bundle]) => handSize(bundle) > 0)
      .map(([id, bundle]) => `${this.nameOf(id)} +${listResources(bundle)}`);
    if (lines.length) this.note(lines.join(' · '));
    else if (this.state.board.hexes.some((hex) => hex.number === total && hex.id === this.state.board.robber)) {
      this.note('The robber blocks that hex, nothing is produced');
    } else this.note('Nobody collects anything');
    if (shortages.length) {
      this.note(`The bank ran short of ${shortages.map((r) => RESOURCE_LABELS[r].toLowerCase()).join(', ')}`);
    }
  }

  // -------------------------------------------------------- the robber

  discard(playerId, bundle) {
    if (!this.canAct() || this.state.turnPhase !== 'discard') return false;
    const owed = this.state.pendingDiscards[playerId];
    const clean = cleanBundle(bundle);
    if (!owed || bundleSize(clean) !== owed || !hasResources(this.state.hands[playerId], clean)) return false;

    this.pay(playerId, clean);
    const pendingDiscards = { ...this.state.pendingDiscards };
    delete pendingDiscards[playerId];
    this.set({ pendingDiscards });
    this.note(`${this.nameOf(playerId)} discarded ${owed} cards`, playerId);
    this.event('discard', { actor: playerId, bundle: clean, count: owed });

    if (!Object.keys(pendingDiscards).length) {
      this.set({ turnPhase: 'robber', activity: `${this.activePlayer.name} moves the robber` });
    }

    this.afterAction(playerId);
    return true;
  }

  moveRobber(playerId, hexId) {
    if (!this.canAct() || this.state.turnPhase !== 'robber' || !this.isActive(playerId)) return false;
    if (!Number.isInteger(hexId) || !this.state.board.hexes[hexId] || hexId === this.state.board.robber) return false;

    const hex = this.state.board.hexes[hexId];
    const from = this.state.board.robber;
    this.set({ board: { ...this.state.board, robber: hexId } });
    this.event('robber', { actor: playerId, from, to: hexId });
    this.note(`${this.nameOf(playerId)} moved the robber to the ${hex.terrain}${hex.number ? ` ${hex.number}` : ''}`, playerId);
    this.sound('dragon');

    const victims = robberVictims(this.state, hexId, playerId);
    if (victims.length === 1) {
      this.set({ turnPhase: 'steal', stealFrom: victims });
      this.steal(playerId, victims[0]);
      return true;
    }
    if (victims.length > 1) {
      this.set({ turnPhase: 'steal', stealFrom: victims, activity: `${this.nameOf(playerId)} chooses who to rob` });
    } else {
      this.set({ turnPhase: this.state.robberReturn, stealFrom: [], activity: this.phaseActivity(this.state.robberReturn) });
    }
    this.afterAction(playerId);
    return true;
  }

  steal(playerId, victimId) {
    if (!this.canAct() || this.state.turnPhase !== 'steal' || !this.isActive(playerId)) return false;
    if (!this.state.stealFrom.includes(victimId)) return false;

    const hand = this.state.hands[victimId];
    const cards = [];
    RESOURCES.forEach((resource) => {
      for (let i = 0; i < hand[resource]; i += 1) cards.push(resource);
    });

    const back = this.state.robberReturn;
    if (cards.length) {
      const resource = cards[this.pickIndex(cards.length)];
      this.move(victimId, playerId, { [resource]: 1 });
      this.set({ lastSteal: { id: this.state.logCounter + 1, turn: this.state.turnCount, thief: playerId, victim: victimId, resource } });
      this.note(`${this.nameOf(playerId)} stole a card from ${this.nameOf(victimId)}`, playerId);
      this.event('steal', { actor: playerId, victim: victimId, resource });
      this.sound('steal');
    }

    this.set({ turnPhase: back, stealFrom: [], activity: this.phaseActivity(back) });
    this.afterAction(playerId);
    return true;
  }

  phaseActivity(phase) {
    const name = this.activePlayer.name;
    return phase === 'pre-roll' ? `${name} rolls the dice` : `${name} trades and builds`;
  }

  // ------------------------------------------------- development cards

  playDev(playerId, type, details = {}) {
    if (!this.canAct() || !this.isActive(playerId) || this.state.devPlayedThisTurn) return false;
    const phase = this.state.turnPhase;
    if (phase !== 'pre-roll' && phase !== 'actions') return false;
    if (!DEV_CARDS[type] || type === 'victoryPoint') return false;
    // Only a Knight may be played before the dice; progress cards wait for the roll.
    if (phase === 'pre-roll' && type !== 'knight') return false;

    const cards = this.state.devCards[playerId];
    const card = cards.find((entry) => entry.type === type && entry.boughtTurn !== this.state.turnCount);
    if (!card) return false;

    // Check the card's own requirements before spending it.
    if (type === 'yearOfPlenty') {
      const picks = Array.isArray(details?.resources) ? details.resources.slice(0, 2) : [];
      if (picks.length !== 2 || !picks.every((r) => RESOURCES.includes(r))) return false;
      const want = {};
      picks.forEach((r) => {
        want[r] = (want[r] || 0) + 1;
      });
      if (!hasResources(this.state.bank, want)) return false;
    }
    if (type === 'monopoly' && !RESOURCES.includes(details?.resource)) return false;
    if (type === 'roadBuilding' && (piecesLeft(this.state, playerId).road <= 0 || !legalRoadSpots(this.state, playerId).length)) {
      return false;
    }

    this.set({
      devPlayedThisTurn: true,
      devCards: { ...this.state.devCards, [playerId]: cards.filter((entry) => entry.id !== card.id) },
    });
    this.sound('card');
    this.event('playDev', { actor: playerId, card: type });
    const name = this.nameOf(playerId);

    if (type === 'knight') {
      const knights = { ...this.state.knights, [playerId]: (this.state.knights[playerId] || 0) + 1 };
      const before = this.state.largestArmy;
      const largestArmy = largestArmyHolder(knights, before);
      this.set({
        knights,
        largestArmy,
        robberReturn: phase,
        turnPhase: 'robber',
        activity: `${name} played a Knight and moves the robber`,
        ...this.record(`${name} played a Knight`, playerId),
      });
      if (largestArmy !== before) {
        this.note(`${name} takes the Largest Army (${knights[playerId]} knights)`, playerId);
        this.chat(`${name} takes the Largest Army`);
      }
    } else if (type === 'roadBuilding') {
      this.set({
        turnPhase: 'road-building',
        roadBuilding: { remaining: Math.min(2, piecesLeft(this.state, playerId).road), returnPhase: phase },
        activity: `${name} places 2 free roads`,
        ...this.record(`${name} played Road Building`, playerId),
      });
    } else if (type === 'yearOfPlenty') {
      const want = {};
      details.resources.slice(0, 2).forEach((r) => {
        want[r] = (want[r] || 0) + 1;
      });
      this.give(playerId, want);
      this.note(`${name} played Year of Plenty and took ${listResources(want)}`, playerId);
      this.event('yop', { actor: playerId, bundle: want });
    } else if (type === 'monopoly') {
      const resource = details.resource;
      const hands = { ...this.state.hands };
      let taken = 0;
      const from = {};
      this.state.players.forEach((player) => {
        if (player.id === playerId) return;
        const count = hands[player.id][resource];
        if (count) {
          taken += count;
          from[player.id] = count;
          hands[player.id] = { ...hands[player.id], [resource]: 0 };
        }
      });
      hands[playerId] = { ...hands[playerId], [resource]: hands[playerId][resource] + taken };
      this.set({ hands });
      const each = Object.entries(from).map(([id, count]) => `${count} from ${this.nameOf(id)}`);
      this.note(
        `${name} played Monopoly on ${RESOURCE_LABELS[resource].toLowerCase()} and took ${taken}${each.length ? ` (${each.join(', ')})` : ''}`,
        playerId,
      );
      this.event('monopoly', { actor: playerId, resource, from, total: taken });
    }

    this.afterAction(playerId);
    return true;
  }

  // -------------------------------------------------------------- trade

  // Who an offer is addressed to. An open offer from the player whose turn
  // it is goes to everyone else; any other offer goes to that player only.
  tradeParties(trade) {
    if (trade.to) return [trade.from, trade.to];
    return this.state.players.map((player) => player.id);
  }

  proposeTrade(playerId, { give, get, to = null } = {}) {
    if (!this.canAct() || this.state.turnPhase !== 'actions') return false;
    const active = this.activePlayer.id;
    const cleanGive = cleanBundle(give);
    const cleanGet = cleanBundle(get);
    if (tradeShapeProblem(cleanGive, cleanGet)) return false;
    if (!hasResources(this.state.hands[playerId], cleanGive)) return false;

    // Only the player whose turn it is trades; others may make offers to them.
    let target = to;
    if (playerId !== active) target = active;
    if (target && (target === playerId || !this.player(target))) return false;
    if (this.state.trades.length >= MAX_TRADES) return false;
    if (this.state.trades.some((trade) => trade.from === playerId && trade.to === target)) return false;

    const tradeCounter = this.state.tradeCounter + 1;
    const trade = {
      id: tradeCounter,
      from: playerId,
      to: target,
      give: cleanGive,
      get: cleanGet,
      responses: {},
      accepted: [],
      closesAt: null,
      choosing: false,
      createdAt: Date.now(),
    };
    this.set({ tradeCounter, trades: [...this.state.trades, trade] });
    this.note(
      `${this.nameOf(playerId)} offers ${listResources(cleanGive)} for ${listResources(cleanGet)}${target ? ` to ${this.nameOf(target)}` : ''}`,
      playerId,
    );
    this.sound('trade');
    this.afterAction(playerId);
    return true;
  }

  respondTrade(playerId, tradeId, accept, { quiet = false } = {}) {
    if (!this.canAct() || this.state.turnPhase !== 'actions') return false;
    const trade = this.state.trades.find((entry) => entry.id === tradeId);
    if (!trade || trade.from === playerId || !this.tradeParties(trade).includes(playerId)) return false;

    // Accepting needs the cards the offer asks for.
    if (accept && !hasResources(this.state.hands[playerId], trade.get)) {
      if (this.isAuto(playerId)) accept = false;
      else return false;
    }

    if (accept && trade.to === playerId) {
      return this.executeTrade(trade, playerId);
    }

    // Who said yes, in the order they said it: the first one gets the deal
    // when the offering player does not choose.
    const accepted = (trade.accepted || []).filter((id) => id !== playerId);
    if (accept) accepted.push(playerId);
    this.set({
      trades: this.state.trades.map((entry) =>
        entry.id === tradeId
          ? { ...entry, accepted, responses: { ...entry.responses, [playerId]: Boolean(accept) } }
          : entry,
      ),
    });
    if (!quiet || accept) {
      this.note(`${this.nameOf(playerId)} ${accept ? 'accepts' : 'declines'} ${this.nameOf(trade.from)}'s offer`, playerId);
    }

    // A direct offer that was turned down is closed.
    if (!accept && trade.to === playerId) {
      this.set({ trades: this.state.trades.filter((entry) => entry.id !== tradeId) });
    }

    this.watchOpenTrade(tradeId);
    this.afterAction(playerId);
    return true;
  }

  // An open offer needs no second confirmation. Once someone says yes, the
  // others have a moment to say yes too: a single taker gets the deal
  // straight away, and only when several said yes does the offering player
  // pick one (or the first taker gets it when they do not pick in time).
  watchOpenTrade(tradeId) {
    const trade = this.state.trades.find((entry) => entry.id === tradeId);
    if (!trade || trade.to || trade.choosing || !(trade.accepted || []).length) return;

    const others = this.tradeParties(trade).filter((id) => id !== trade.from);
    if (others.every((id) => trade.responses[id] !== undefined)) {
      this.settleTrade(tradeId, 'window');
      return;
    }
    if (trade.closesAt) return;

    const closesAt = Date.now() + this.timing.acceptWindow;
    this.set({ trades: this.state.trades.map((entry) => (entry.id === tradeId ? { ...entry, closesAt } : entry)) });
    this.later(() => this.settleTrade(tradeId, 'window'), this.timing.acceptWindow);
  }

  settleTrade(tradeId, stage) {
    if (this.destroyed || this.state.gameOver || this.state.turnPhase !== 'actions') return;
    const trade = this.state.trades.find((entry) => entry.id === tradeId);
    if (!trade || trade.to) return;
    if (stage === 'window' && trade.choosing) return;
    if (stage === 'choice' && !trade.choosing) return;

    const takers = (trade.accepted || []).filter(
      (id) => trade.responses[id] === true && hasResources(this.state.hands[id], trade.get),
    );
    if (!takers.length) return;

    if (takers.length === 1 || stage === 'choice' || this.isAuto(trade.from)) {
      this.executeTrade(trade, takers[0]);
      return;
    }

    const choiceEndsAt = Date.now() + this.timing.tradeWait;
    this.set({
      trades: this.state.trades.map((entry) => (entry.id === tradeId ? { ...entry, choosing: true, choiceEndsAt } : entry)),
    });
    this.later(() => this.settleTrade(tradeId, 'choice'), this.timing.tradeWait);
    this.afterAction();
  }

  // The offering player picks one of the players who accepted an open offer.
  completeTrade(playerId, tradeId, partnerId) {
    if (!this.canAct() || this.state.turnPhase !== 'actions') return false;
    const trade = this.state.trades.find((entry) => entry.id === tradeId);
    if (!trade || trade.from !== playerId || trade.responses[partnerId] !== true) return false;
    return this.executeTrade(trade, partnerId);
  }

  executeTrade(trade, partnerId) {
    const { from } = trade;
    if (!this.isActive(from) && !this.isActive(partnerId)) return false;
    if (!hasResources(this.state.hands[from], trade.give) || !hasResources(this.state.hands[partnerId], trade.get)) {
      this.set({ trades: this.state.trades.filter((entry) => entry.id !== trade.id) });
      this.note('That trade fell through, someone no longer has the cards');
      this.afterAction();
      return false;
    }

    const hands = { ...this.state.hands };
    hands[from] = addResources(addResources(hands[from], trade.give, -1), trade.get);
    hands[partnerId] = addResources(addResources(hands[partnerId], trade.get, -1), trade.give);
    this.set({ hands, trades: this.state.trades.filter((entry) => entry.id !== trade.id) });
    this.note(
      `${this.nameOf(from)} traded ${listResources(trade.give)} to ${this.nameOf(partnerId)} for ${listResources(trade.get)}`,
      from,
    );
    this.event('trade', { actor: from, partner: partnerId, give: trade.give, get: trade.get });
    this.sound('trade');
    this.afterAction(this.activePlayer.id);
    return true;
  }

  cancelTrade(playerId, tradeId) {
    const trade = this.state.trades.find((entry) => entry.id === tradeId);
    if (!trade || trade.from !== playerId) return false;
    this.set({ trades: this.state.trades.filter((entry) => entry.id !== tradeId) });
    this.afterAction(playerId);
    return true;
  }

  // Trade with the bank at the player's best rate for that resource.
  maritime(playerId, give, get) {
    if (!this.canAct() || this.state.turnPhase !== 'actions' || !this.isActive(playerId)) return false;
    if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) return false;
    const rate = maritimeRates(this.state, playerId)[give];
    if (this.state.hands[playerId][give] < rate || this.state.bank[get] < 1) return false;

    const hands = { ...this.state.hands };
    hands[playerId] = addResources(addResources(hands[playerId], { [give]: rate }, -1), { [get]: 1 });
    const bank = addResources(addResources(this.state.bank, { [give]: rate }), { [get]: 1 }, -1);
    this.set({ hands, bank });
    this.event('maritime', { actor: playerId, give: { [give]: rate }, get: { [get]: 1 } });
    this.note(`${this.nameOf(playerId)} traded ${rate} ${RESOURCE_LABELS[give].toLowerCase()} with the bank for 1 ${RESOURCE_LABELS[get].toLowerCase()}`, playerId);
    this.sound('trade');
    this.afterAction(playerId);
    return true;
  }

  // ----------------------------------------------------------- the turn

  endTurn(playerId) {
    if (!this.canAct() || this.state.turnPhase !== 'actions' || !this.isActive(playerId)) return false;

    const count = this.state.players.length;
    const activeIndex = (this.state.activeIndex + 1) % count;
    const next = this.state.players[activeIndex];
    this.set({
      activeIndex,
      turnCount: this.state.turnCount + 1,
      turnPhase: 'pre-roll',
      devPlayedThisTurn: false,
      trades: [],
      dice: null,
      activity: `${next.name} rolls the dice`,
    });
    this.sound('turn');
    this.afterAction(playerId);
    return true;
  }

  // Every successful move ends here: a win is checked for the player whose
  // turn it is, then the next decision is armed. A move by the player whose
  // turn it is starts their move clock again.
  afterAction(actorId = null) {
    if (actorId && actorId === this.activePlayer?.id) this.clockTicks = (this.clockTicks || 0) + 1;
    this.pruneTrades();
    this.checkWin();
    if (!this.stepping) this.schedule();
  }

  // An offer whose maker no longer holds the cards is withdrawn at once,
  // so nobody accepts a deal that cannot happen.
  pruneTrades() {
    const trades = this.state.trades || [];
    const live = trades.filter((trade) => hasResources(this.state.hands[trade.from], trade.give));
    if (live.length !== trades.length) this.set({ trades: live });
  }

  checkWin() {
    const { state } = this;
    if (state.gameOver || state.turnPhase === 'setup') return;
    const active = this.activePlayer;
    if (totalPoints(state, active.id) >= victoryPointsOf(state)) this.finish('victory', active.id);
  }

  finish(reason, winnerId = null) {
    if (this.state.gameOver) return;

    const standings = computeStandings(this.state);
    const top = standings[0]?.points ?? 0;
    const winners = winnerId ? [winnerId] : standings.filter((entry) => entry.points === top).map((entry) => entry.id);
    const names = winners.map((id) => this.nameOf(id)).join(' and ');

    this.clearLater(this.deadlineTimer);
    this.clearLater(this.botTimer);
    this.set({
      gameOver: { reason, standings, winners, turns: this.state.turnCount },
      endVote: null,
      trades: [],
      phaseEndsAt: null,
      phaseLength: null,
      activity:
        reason === 'victory'
          ? `${names} reaches ${totalPoints(this.state, winners[0])} victory points and wins`
          : `The table agreed to end the game\n${names} ${winners.length > 1 ? 'share' : 'takes'} the win`,
    });
    this.chat(
      reason === 'victory'
        ? `${names} wins with ${totalPoints(this.state, winners[0])} victory points`
        : `Game over, ${names} ${winners.length > 1 ? 'share the win' : 'wins'} with ${top} points`,
    );
    this.event('win', { winners, reason });
    this.sound('win');
  }

  // ------------------------------------------------------------ end vote

  // Every person still at the table gets a vote; computer and AI opponents
  // always go along with the table.
  voters() {
    return this.state.players.filter((player) => player.kind === 'human' && !player.away);
  }

  proposeEnd(playerId) {
    const player = this.player(playerId);
    if (!player || player.kind !== 'human' || this.state.gameOver || this.state.endVote) return false;

    this.set({ endVote: { proposerId: playerId, agreed: [playerId], passed: false } });
    if (this.voters().length > 1) this.chat(`${player.name} proposed ending the game, everyone must agree`);
    this.checkEndVote();
    return true;
  }

  voteEnd(playerId, agree) {
    const vote = this.state.endVote;
    if (!vote || vote.passed || !this.voters().some((player) => player.id === playerId)) return false;

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
    if (!vote || vote.passed || this.state.gameOver) return;
    if (!this.voters().every((player) => vote.agreed.includes(player.id))) return;

    this.set({ endVote: { ...vote, passed: true } });
    if (this.state.busy) this.chat('Everyone agreed, the game ends after this roll');
    else this.finish('agreed');
  }

  // ------------------------------------------------------- seats

  // A person dropped out (away) or came back. While away the computer plays
  // their seat with their own cards; coming back hands it straight back.
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
      this.set({ trades: this.state.trades.filter((trade) => trade.from !== playerId) });
      this.checkEndVote();
    } else {
      this.chat(`${player.name} is back at the table`);
    }

    this.deadlineKey = null;
    this.schedule();
    return true;
  }

  // A remote player left mid match: a computer opponent takes the seat.
  replaceWithBot(playerId) {
    const player = this.player(playerId);
    if (!player || player.kind !== 'human') return;

    this.set({
      players: this.state.players.map((entry) =>
        entry.id === playerId ? { ...entry, kind: 'bot', clientId: null } : entry,
      ),
    });
    this.chat(`${player.name} left the table, a computer opponent takes over the seat`);
    this.checkEndVote();
    this.deadlineKey = null;
    this.schedule();
  }
}

// Short descriptions used for the premium AI's options.
// Short descriptions used for the premium AI's options. With the state they
// name the hexes a spot touches, so Claude can judge it without the map.
const spotLabel = (state, vertexId) =>
  state
    ? `V${vertexId} (${GEOMETRY.vertices[vertexId].hexes
        .map((hexId) => {
          const hex = state.board.hexes[hexId];
          return `${hex.terrain}${hex.number ? ` ${hex.number}` : ''}`;
        })
        .join(' + ')})`
    : `V${vertexId}`;

export const describeAction = (action, state = null) => {
  if (!action) return 'End the turn';
  switch (action.type) {
    case 'build-city':
      return `Upgrade your settlement at ${spotLabel(state, action.vertexId)} to a city`;
    case 'place-settlement':
      return `Build a settlement at ${spotLabel(state, action.vertexId)}`;
    case 'place-road': {
      const [a, b] = GEOMETRY.edges[action.edgeId].vertices;
      return `Build a road from V${a} to V${b}`;
    }
    case 'buy-dev':
      return 'Buy a development card';
    case 'play-dev':
      if (action.card === 'yearOfPlenty') return `Play Year of Plenty for ${(action.resources || []).join(' and ')}`;
      if (action.card === 'monopoly') return `Play Monopoly on ${action.resource}`;
      return `Play ${DEV_CARDS[action.card]?.label || action.card}`;
    case 'maritime':
      return `Trade with the bank: ${action.give} for 1 ${action.get}`;
    default:
      return action.type;
  }
};

export const describeTrade = (state, trade, viewerId) => {
  const name = (id) => state.players.find((player) => player.id === id)?.name || 'someone';
  const gets = trade.from === viewerId ? trade.get : trade.give;
  const pays = trade.from === viewerId ? trade.give : trade.get;
  return `you give ${listResources(pays)} and get ${listResources(gets)} (with ${name(trade.from === viewerId ? trade.to : trade.from)}, who has ${publicPoints(state, trade.from === viewerId ? trade.to : trade.from)} points showing)`;
};
