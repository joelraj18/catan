// A private room: lobby seats, chat and the game channel.
//
// The host's browser is the source of truth. Guests send `hello`, `chat` and
// `intent` messages; the host answers with `lobby`, `chat`, `start` and `game`
// snapshots. Nothing secret ever travels through a room: the premium AI key
// stays inside services/premiumAi.js on the host's device.

import { openGuestTransport, openHostTransport } from './roomTransport';
import { PIECE_ORDER } from '../pages/Game/pieces.jsx';
import { DEFAULT_SETTINGS, cleanSettings } from '../pages/Game/gameSettings';

const CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CHAT = 120;
const MAX_TEXT = 240;
const PROTOCOL = 2;
const SEAT_KEY = 'catan-seat';
const HOST_GAME_KEY = 'catan-host-game';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6; // 5 and 6 play on the extension island
const RECONNECT_EVERY = 3000;
const RECONNECT_FOR = 120000;
// During a match both sides say they are alive every BEAT_EVERY. A link that
// stays quiet for BEAT_SILENT is treated as dropped even when the network
// never reported it, which happens when a phone locks or loses signal.
const BEAT_EVERY = 10000;
const BEAT_SILENT = 40000;

// Small, non secret notes kept on this device so a dropped player can find
// their way back: the room code and their Player ID, and for the host a
// snapshot of the match between rolls. Never the premium AI key.
const readStore = (key) => {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

const writeStore = (key, value) => {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Private windows may block storage; rejoining then needs the ID typed in.
  }
};

export const savedSeat = () => readStore(SEAT_KEY);
export const savedHostGame = () => readStore(HOST_GAME_KEY);

export const cleanCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export const createRoomCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => CODE_CHARACTERS[byte % CODE_CHARACTERS.length],
  ).join('');

export const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 18);

const cleanText = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

let chatCounter = 0;
const chatId = () => {
  chatCounter += 1;
  return `${Date.now().toString(36)}${chatCounter}`;
};

export default class RoomSession {
  constructor(role) {
    this.role = role;
    this.code = '';
    this.status = 'connecting'; // 'online' | 'offline' | 'connecting' | 'closed'
    this.transport = null;
    this.myClientId = role === 'host' ? 'host' : null;
    this.lobby = { tableSize: 3, seats: [], board: 'beginner', settings: { ...DEFAULT_SETTINGS } };
    this.chat = [];
    this.started = false;
    this.players = null;
    this.myPlayerId = null;
    this.listeners = new Map();
    this.botCounter = { bot: 0, ai: 0 };
    this.gameId = null;
    this.lastGameState = null;
    this.myCode = null;
    this.connection = 'online'; // 'online' | 'reconnecting'
    this.routes = { direct: 'trying', relay: 'trying' };
    this.heardFrom = new Map(); // host: peerId -> last message time
    this.hostHeardAt = 0; // guest: last message from the host
    this.beatTimer = null;
    this.route = null; // the route a guest joined by: 'direct' | 'relay' | 'local'
  }

  // --------------------------------------------------------------- events

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    // The latest start is kept, so a view that mounts after a rejoin or a
    // host resume still knows which match it belongs to.
    if (event === 'start') {
      this.startConfig = payload;
    }

    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  get isHost() {
    return this.role === 'host';
  }

  // ------------------------------------------------------------- creation

  openHost(code) {
    this.code = code;
    this.transport = openHostTransport(code, {
      onPeerOpen: () => {},
      onMessage: (peerId, message) => this.handleGuestMessage(peerId, message),
      onPeerClose: (peerId) => this.handleGuestLeft(peerId),
      onError: () => {},
      onRoutes: (routes) => {
        this.routes = routes;
        this.emit('routes', routes);
      },
    });
    return this.transport.ready;
  }

  static async host({ name, pieceKey }) {
    const session = new RoomSession('host');
    session.lobby.seats = [
      { seatId: 'host', name: cleanName(name), pieceKey, kind: 'human', clientId: 'host' },
    ];

    // A clashing code is astronomically rare, but retry just in case.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await session.openHost(createRoomCode());
        session.status = 'online';
        break;
      } catch (error) {
        session.transport?.close();
        session.transport = null;

        if (error.message !== 'code-taken') {
          session.status = 'offline';
          break;
        }
      }
    }

    if (!session.transport) {
      session.status = 'offline';
    }

    session.postSystem(`${cleanName(name)} opened the room`);
    return session;
  }

  // `rejoin` is a Player ID: the host then hands back that seat in a match
  // already under way instead of adding a new one.
  static async join({ code, name, pieceKey, rejoin = null, mode = 'auto', onStage = null }) {
    const session = new RoomSession('guest');
    session.code = cleanCode(code);
    session.myCode = rejoin ? cleanCode(rejoin) : null;
    session.mode = mode;
    session.onStage = onStage;

    // A rejoin is only complete once the host has said which match it is.
    const started = rejoin
      ? new Promise((resolve, reject) => {
          const off = session.on('start', () => {
            clearTimeout(timer);
            off();
            resolve();
          });
          const timer = setTimeout(() => {
            off();
            reject(new Error('not-found'));
          }, 10000);
        })
      : null;
    started?.catch(() => {});

    try {
      await session.connect({ name: cleanName(name), pieceKey, rejoin: session.myCode });
      await started;
    } catch (error) {
      session.transport?.close();
      throw error;
    }

    session.status = 'online';
    session.onStage = null;
    return session;
  }

  async connect(hello) {
    const transport = openGuestTransport(
      this.code,
      {
        onMessage: (_, message) => {
          if (this.transport === transport) this.handleHostMessage(message);
        },
        onClose: () => {
          if (this.transport === transport) this.handleHostLost();
        },
        onStage: (stage) => this.onStage?.(stage),
      },
      { mode: this.mode || 'auto' },
    );
    this.transport = transport;

    try {
      await transport.ready;
    } catch (error) {
      transport.close();
      const known = ['not-found', 'blocked', 'unsupported'];
      throw new Error(error.message === 'timeout' ? 'not-found' : known.includes(error.message) ? error.message : 'network');
    }

    this.route = transport.route;
    this.onStage?.(`joined-${transport.route}`);

    const welcome = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('not-found')), 8000);
      this.pendingWelcome = { resolve, reject, timer };
    });

    transport.send({ t: 'hello', v: PROTOCOL, ...hello });

    try {
      await welcome;
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  // The link to the host dropped. Before a match that ends the room; during
  // one, keep trying to rejoin with this seat's Player ID for two minutes, so
  // a host who reloads or a wobbly connection does not end the game.
  async handleHostLost() {
    if (this.status === 'closed') {
      return;
    }

    if (!this.started || !this.myCode) {
      this.handleClosed('The host closed the room');
      return;
    }

    if (this.connection === 'reconnecting') {
      return;
    }

    this.connection = 'reconnecting';
    this.emit('connection', 'reconnecting');
    const giveUpAt = Date.now() + RECONNECT_FOR;

    while (this.status !== 'closed' && Date.now() < giveUpAt) {
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_EVERY));

      if (this.status === 'closed') {
        return;
      }

      try {
        this.transport?.close();
        await this.connect({ rejoin: this.myCode });
        this.connection = 'online';
        this.emit('connection', 'online');
        return;
      } catch (error) {
        if (error.message === 'unknown-player') {
          break;
        }
      }
    }

    this.handleClosed('Lost the connection to the host');
  }

  // ----------------------------------------------------------- host side

  broadcast(message) {
    this.transport?.broadcast(message);
  }

  publishLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    this.emit('lobby', this.lobby);
    // Who can be invited to voice follows the seats.
    this.publishVoice();
  }

  freePiece(preferred) {
    const taken = new Set(this.lobby.seats.map((seat) => seat.pieceKey));
    return taken.has(preferred) || !PIECE_ORDER.includes(preferred)
      ? PIECE_ORDER.find((piece) => !taken.has(piece))
      : preferred;
  }

  handleGuestMessage(peerId, message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    const seat = this.lobby.seats.find((entry) => entry.clientId === peerId);
    this.heardFrom.set(peerId, Date.now());

    switch (message.t) {
      case 'beat':
        break;

      case 'hello': {
        if (seat) {
          return;
        }

        const reject = (reason) => {
          this.transport.send(peerId, { t: 'reject', reason });
          setTimeout(() => this.transport?.kick(peerId), 300);
        };

        if (message.rejoin) {
          this.rejoinSeat(peerId, cleanCode(message.rejoin), reject);
          return;
        }

        if (this.started) {
          reject('started');
          return;
        }

        if (this.lobby.seats.length >= MAX_PLAYERS) {
          reject('full');
          return;
        }

        const name = cleanName(message.name) || 'Guest';
        this.lobby.seats.push({
          seatId: peerId,
          name,
          pieceKey: this.freePiece(message.pieceKey),
          kind: 'human',
          clientId: peerId,
          route: this.transport.routeOf?.(peerId) || 'direct',
        });
        this.lobby.tableSize = Math.max(this.lobby.tableSize, this.lobby.seats.length);

        this.transport.send(peerId, { t: 'welcome', clientId: peerId, code: this.code });
        this.transport.send(peerId, { t: 'chat-log', chat: this.chat });
        this.transport.send(peerId, { t: 'voice-roster', roster: this.voiceRoster() });
        this.publishLobby();
        this.postSystem(`${name} joined the table`);
        break;
      }

      case 'chat':
        if (seat) {
          this.appendChat({ name: seat.name, pieceKey: seat.pieceKey, text: message.text });
        }
        break;

      case 'intent':
        if (seat && this.started) {
          this.emit('intent', { clientId: peerId, action: message.action || {} });
        }
        break;

      case 'voice-join':
      case 'voice-leave':
      case 'voice-create':
      case 'voice-signal':
      case 'voice-clip':
        if (seat) this.handleVoice(peerId, message);
        break;

      default:
        break;
    }
  }

  // A Player ID came back: hand that person their seat, then the latest
  // snapshot so they resume exactly where the match is.
  rejoinSeat(peerId, playerCode, reject) {
    // A host still reopening its room is not ready yet; the guest retries.
    if (this.started && !this.gameId) {
      reject('not-ready');
      return;
    }

    const player = this.started && this.players?.find((entry) => entry.code === playerCode);

    if (!player || player.kind !== 'human' || player.id === this.myPlayerId) {
      reject('unknown-player');
      return;
    }

    const previous = player.clientId;

    if (previous && previous !== peerId) {
      this.transport?.kick(previous);
    }

    this.players = this.players.map((entry) => (entry.id === player.id ? { ...entry, clientId: peerId } : entry));
    const seat = this.lobby.seats[this.players.findIndex((entry) => entry.id === player.id)];

    if (seat) {
      seat.clientId = peerId;
      seat.route = this.transport.routeOf?.(peerId) || seat.route;
    }

    this.transport.send(peerId, { t: 'welcome', clientId: peerId, code: this.code });
    this.transport.send(peerId, { t: 'chat-log', chat: this.chat });
    this.transport.send(peerId, { t: 'voice-roster', roster: this.voiceRoster() });
    this.transport.send(peerId, { t: 'start', players: this.playersFor(player.id), gameId: this.gameId, rejoin: true });

    if (this.lastGameState) {
      this.transport.send(peerId, { t: 'game', state: this.gameFor(player.id), sentAt: Date.now(), gameId: this.gameId });
    }

    this.emit('peer-rejoined', { clientId: peerId, playerId: player.id });
  }

  handleGuestLeft(peerId) {
    this.leaveVoice(peerId);
    const seat = this.lobby.seats.find((entry) => entry.clientId === peerId);

    if (!seat) {
      return;
    }

    if (this.started) {
      // The seat stays theirs: the computer plays it until they rejoin.
      seat.clientId = null;
      this.players = this.players?.map((entry) => (entry.clientId === peerId ? { ...entry, clientId: null } : entry));
      this.emit('peer-left', peerId);
    } else {
      this.lobby.seats = this.lobby.seats.filter((entry) => entry !== seat);
      this.publishLobby();
      this.postSystem(`${seat.name} left the table`);
    }
  }

  setTableSize(size) {
    if (!this.isHost || this.started) {
      return;
    }

    this.lobby.tableSize = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, size, this.lobby.seats.length));
    this.publishLobby();
  }

  // The beginners' map from the rulebook, or a variable (random) island.
  setBoard(board) {
    if (!this.isHost || this.started) {
      return;
    }

    this.lobby.board = board === 'random' ? 'random' : 'beginner';
    this.lobby.settings = cleanSettings({ ...this.lobby.settings, board: this.lobby.board });
    this.publishLobby();
  }

  // The host's table rules: turn timer, discard limit, points to win and
  // how the number tokens may sit.
  setSettings(patch) {
    if (!this.isHost || this.started) {
      return;
    }

    this.lobby.settings = cleanSettings({ ...this.lobby.settings, ...patch, board: this.lobby.board });
    this.publishLobby();
  }

  addOpponent(kind) {
    if (!this.isHost || this.started || this.lobby.seats.length >= this.lobby.tableSize) {
      return;
    }

    this.botCounter[kind] += 1;
    const number = this.botCounter[kind];
    this.lobby.seats.push({
      seatId: `${kind}-${number}`,
      name: kind === 'ai' ? `AI Opponent ${number}` : `Computer ${number}`,
      pieceKey: this.freePiece(),
      kind,
      clientId: null,
    });
    this.publishLobby();
  }

  removeSeat(seatId) {
    if (!this.isHost || this.started || seatId === 'host') {
      return;
    }

    const seat = this.lobby.seats.find((entry) => entry.seatId === seatId);

    if (!seat) {
      return;
    }

    this.lobby.seats = this.lobby.seats.filter((entry) => entry !== seat);

    if (seat.clientId) {
      this.transport?.send(seat.clientId, { t: 'reject', reason: 'removed' });
      setTimeout(() => this.transport?.kick(seat.clientId), 300);
      this.postSystem(`${seat.name} was removed from the table`);
    }

    this.publishLobby();
  }

  // Seats become players in seat order; the host is always p1.
  startGame() {
    if (!this.isHost || this.lobby.seats.length < MIN_PLAYERS) {
      return;
    }

    this.started = true;
    const codes = new Set();
    const uniqueCode = () => {
      let code;
      do {
        code = createRoomCode();
      } while (codes.has(code));
      codes.add(code);
      return code;
    };

    this.players = this.lobby.seats.map((seat, index) => ({
      id: `p${index + 1}`,
      name: seat.name,
      pieceKey: seat.pieceKey,
      kind: seat.kind,
      clientId: seat.clientId === 'host' ? null : seat.clientId,
      code: uniqueCode(),
    }));
    this.myPlayerId = 'p1';
    this.announceStart();
  }

  announceStart(resume = null) {
    this.gameId = Date.now().toString(36);
    this.lastGameState = resume;
    writeStore(SEAT_KEY, { code: this.code, playerCode: this.players[0].code, name: this.players[0].name });
    this.players.forEach((player) => {
      if (player.clientId) {
        this.transport?.send(player.clientId, { t: 'start', players: this.playersFor(player.id), gameId: this.gameId });
      }
    });
    this.emit('start', {
      players: this.players,
      myPlayerId: 'p1',
      gameId: this.gameId,
      resume,
      options: cleanSettings({ ...this.lobby.settings, board: this.lobby.board || 'beginner' }),
    });
    this.startBeat();
  }

  // Keeps every link honest during a match. The host drops a guest that went
  // quiet, so the computer plays their seat and they rejoin when they can; a
  // guest whose host went quiet starts its reconnect loop.
  startBeat() {
    clearInterval(this.beatTimer);
    const startedAt = Date.now();

    this.beatTimer = setInterval(() => {
      if (this.status === 'closed') {
        clearInterval(this.beatTimer);
        return;
      }

      const cutoff = Date.now() - BEAT_SILENT;

      if (this.isHost) {
        this.broadcast({ t: 'beat' });
        this.lobby.seats.forEach((seat) => {
          const id = seat.clientId;
          if (!id || id === 'host' || seat.kind !== 'human') return;
          if (Math.max(this.heardFrom.get(id) || 0, startedAt) < cutoff) {
            this.transport?.kick(id);
            this.handleGuestLeft(id);
          }
        });
      } else if (this.connection === 'online') {
        this.transport?.send({ t: 'beat' });
        if (Math.max(this.hostHeardAt, startedAt) < cutoff) {
          this.handleHostLost();
        }
      }
    }, BEAT_EVERY);
  }

  // The host reloaded or lost their tab: reopen the same room from the
  // snapshot saved on this device. Friends reconnect by themselves, and
  // their seats are played by the computer until they do.
  static async resumeHost(saved) {
    const session = new RoomSession('host');
    session.lobby = saved.lobby;
    session.chat = Array.isArray(saved.chat) ? saved.chat : [];
    session.started = true;
    session.myPlayerId = 'p1';
    session.players = saved.players.map((player) => ({ ...player, clientId: null }));
    session.lobby.seats = session.lobby.seats.map((seat) =>
      seat.clientId === 'host' ? seat : { ...seat, clientId: null },
    );

    // The old room name can take a few seconds to free up after a reload.
    let lastError = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await session.openHost(saved.code);
        lastError = null;
        break;
      } catch (error) {
        session.transport?.close();
        session.transport = null;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (lastError) {
      throw lastError;
    }

    session.status = 'online';
    const state = {
      ...saved.state,
      players: saved.state.players.map((player) =>
        player.kind === 'human' && player.id !== 'p1' ? { ...player, clientId: null, away: true } : player,
      ),
    };
    session.postSystem('The host is back, the match continues');
    session.announceStart(state);
    return session;
  }

  // Called by the board between rolls, so a reload loses at most one roll.
  saveHostGame(state) {
    if (!this.isHost || !this.started) {
      return;
    }

    if (state.gameOver) {
      writeStore(HOST_GAME_KEY, null);
      return;
    }

    writeStore(HOST_GAME_KEY, {
      code: this.code,
      players: this.players,
      lobby: this.lobby,
      chat: this.chat.slice(-40),
      state,
      savedAt: Date.now(),
    });
  }

  // A rematch keeps everyone who is still connected.
  restartGame() {
    if (!this.isHost || !this.players) {
      return;
    }

    const connected = new Set(
      this.lobby.seats.filter((seat) => seat.clientId).map((seat) => seat.clientId),
    );
    this.players = this.players.map((player) =>
      player.kind === 'human' && player.id !== 'p1' && !(player.clientId && connected.has(player.clientId))
        ? { ...player, kind: 'bot', clientId: null }
        : player,
    );

    this.announceStart();
  }

  // Each friend gets the board as their own seat sees it: `viewFor` hides
  // other players' cards. Without it everyone gets the same snapshot.
  broadcastGame(state, viewFor = null) {
    if (!this.isHost) {
      return;
    }

    this.lastGameState = state;
    this.viewFor = viewFor;

    if (!viewFor) {
      this.broadcast({ t: 'game', state, sentAt: Date.now(), gameId: this.gameId });
      return;
    }

    const sentAt = Date.now();
    (state.players || []).forEach((player) => {
      if (player.clientId) {
        this.transport?.send(player.clientId, { t: 'game', state: viewFor(state, player.id), sentAt, gameId: this.gameId });
      }
    });
  }

  // The seat list as one guest may see it: a Player ID reopens its seat, so
  // each guest only ever learns their own.
  playersFor(playerId) {
    return (this.players || []).map((player) => (player.id === playerId ? player : { ...player, code: null }));
  }

  gameFor(playerId) {
    return this.viewFor ? this.viewFor(this.lastGameState, playerId) : this.lastGameState;
  }

  postSystem(text) {
    if (this.isHost) {
      this.appendChat({ name: 'Catan', pieceKey: null, text, system: true });
    }
  }

  // Chat from a player seat (AI opponents included), hosted locally.
  postAs(playerName, pieceKey, text) {
    if (this.isHost) {
      this.appendChat({ name: playerName, pieceKey, text });
    }
  }

  appendChat({ name, pieceKey, text, system = false }) {
    const clean = cleanText(text);

    if (!clean) {
      return;
    }

    const message = { id: chatId(), name, pieceKey, text: clean, system, ts: Date.now() };
    this.chat = [...this.chat, message].slice(-MAX_CHAT);
    this.broadcast({ t: 'chat', message });
    this.emit('chat', this.chat);
  }

  // ---------------------------------------------------------- guest side

  handleHostMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    this.hostHeardAt = Date.now();

    switch (message.t) {
      case 'beat':
        break;

      case 'welcome':
        this.myClientId = message.clientId;

        if (this.pendingWelcome) {
          clearTimeout(this.pendingWelcome.timer);
          this.pendingWelcome.resolve();
          this.pendingWelcome = null;
        }
        break;

      case 'reject':
        if (this.pendingWelcome) {
          clearTimeout(this.pendingWelcome.timer);
          this.pendingWelcome.reject(new Error(message.reason || 'rejected'));
          this.pendingWelcome = null;
        } else {
          this.handleClosed(
            message.reason === 'removed' ? 'The host removed you from the table' : 'The room is no longer available',
          );
        }
        break;

      case 'lobby':
        this.lobby = message.lobby;
        this.emit('lobby', this.lobby);
        break;

      case 'chat-log':
        this.chat = Array.isArray(message.chat) ? message.chat.slice(-MAX_CHAT) : [];
        this.emit('chat', this.chat);
        break;

      case 'chat':
        this.chat = [...this.chat, message.message].slice(-MAX_CHAT);
        this.emit('chat', this.chat);
        break;

      case 'start': {
        this.started = true;
        this.lastGame = null;
        this.players = message.players;
        const me = message.players.find((player) => player.clientId === this.myClientId);
        this.myPlayerId = me ? me.id : null;
        this.myCode = me?.code || null;
        this.gameId = message.gameId;

        if (me?.code) {
          writeStore(SEAT_KEY, { code: this.code, playerCode: me.code, name: me.name });
        }

        // A reconnect inside the same match keeps the board as it is.
        if (message.rejoin && this.connection === 'reconnecting') {
          break;
        }

        this.emit('start', { players: message.players, myPlayerId: this.myPlayerId, gameId: message.gameId });
        if (!this.beatTimer) this.startBeat();
        break;
      }

      case 'game':
        // Cached so a board that mounts a moment later still starts in sync.
        this.lastGame = message;
        this.emit('game', message);
        break;

      case 'closed':
        this.handleClosed('The host closed the room');
        break;

      case 'voice-roster':
        this.voiceRosterCache = message.roster;
        this.emit('voice-roster', message.roster);
        break;

      case 'voice-signal':
      case 'voice-clip':
      case 'voice-invite':
        this.emit(message.t, message);
        break;

      default:
        break;
    }
  }

  sendIntent(action) {
    if (!this.isHost) {
      this.transport?.send({ t: 'intent', action });
    }
  }

  // ------------------------------------------------------------- voice

  // Voice channels live on the host, who only ever passes a voice message
  // between two people in the same channel. Everyone starts with the table
  // channel; anyone can open a private channel and invite people, and only
  // the people invited can join it. Members are client ids ('host' for the
  // host); audio itself flows between the members' browsers.
  voiceChannels() {
    if (!this.voice) {
      this.voice = { channels: [{ id: 'table', name: 'Table', owner: null, invited: null, members: [] }], keys: {}, counter: 0 };
    }
    return this.voice;
  }

  voicePerson(clientId) {
    const seat = this.lobby.seats.find((entry) => entry.clientId === clientId);
    return seat ? { name: seat.name, pieceKey: seat.pieceKey } : null;
  }

  voiceRoster() {
    const voice = this.voiceChannels();
    const people = {};
    this.lobby.seats
      .filter((seat) => seat.kind === 'human' && seat.clientId)
      .forEach((seat) => {
        people[seat.clientId] = { name: seat.name, pieceKey: seat.pieceKey, key: voice.keys[seat.clientId] || null };
      });
    return { channels: voice.channels.map((channel) => ({ ...channel, members: [...channel.members] })), people };
  }

  publishVoice() {
    const roster = this.voiceRoster();
    this.voiceRosterCache = roster;
    this.broadcast({ t: 'voice-roster', roster });
    this.emit('voice-roster', roster);
  }

  leaveVoice(clientId, { publish = true } = {}) {
    const voice = this.voiceChannels();
    let changed = false;
    voice.channels.forEach((channel) => {
      if (channel.members.includes(clientId)) {
        channel.members = channel.members.filter((id) => id !== clientId);
        changed = true;
      }
    });
    // A private channel closes when its last member leaves.
    const before = voice.channels.length;
    voice.channels = voice.channels.filter((channel) => channel.id === 'table' || channel.members.length);
    if ((changed || before !== voice.channels.length) && publish) this.publishVoice();
  }

  sameVoiceChannel(a, b) {
    return this.voiceChannels().channels.some((channel) => channel.members.includes(a) && channel.members.includes(b));
  }

  deliverVoice(to, message) {
    if (to === this.myClientId) this.emit(message.t, message);
    else this.transport?.send(to, message);
  }

  handleVoice(from, message) {
    const voice = this.voiceChannels();
    switch (message.t) {
      case 'voice-join': {
        const channel = voice.channels.find((entry) => entry.id === message.channel);
        if (!channel || (channel.invited && !channel.invited.includes(from))) return;
        if (typeof message.key === 'string' && /^[0-9a-f]{64}$/.test(message.key)) voice.keys[from] = message.key;
        this.leaveVoice(from, { publish: false });
        // leaveVoice may have closed an empty channel; this one is still wanted.
        if (!voice.channels.includes(channel)) voice.channels.push(channel);
        channel.members.push(from);
        this.publishVoice();
        break;
      }
      case 'voice-leave':
        this.leaveVoice(from);
        break;
      case 'voice-create': {
        const humans = this.lobby.seats.filter((seat) => seat.kind === 'human' && seat.clientId).map((seat) => seat.clientId);
        const invite = (Array.isArray(message.invite) ? message.invite : []).filter((id) => id !== from && humans.includes(id));
        if (!invite.length) return;
        voice.counter += 1;
        const owner = this.voicePerson(from);
        const channel = {
          id: `private-${voice.counter}`,
          name: cleanText(message.name).slice(0, 24) || `${owner?.name || 'Private'}'s channel`,
          owner: from,
          invited: [from, ...invite],
          members: [],
        };
        voice.channels.push(channel);
        this.handleVoice(from, { t: 'voice-join', channel: channel.id, key: message.key });
        invite.forEach((id) => this.deliverVoice(id, { t: 'voice-invite', channel: channel.id, name: channel.name, from }));
        break;
      }
      case 'voice-signal':
      case 'voice-clip':
        if (typeof message.to === 'string' && message.to !== from && this.sameVoiceChannel(from, message.to)) {
          this.deliverVoice(message.to, { ...message, from });
        }
        break;
      default:
        break;
    }
  }

  // Sends a voice message: the host handles its own directly.
  sendVoice(message) {
    if (this.isHost) this.handleVoice(this.myClientId, message);
    else this.transport?.send(message);
  }

  // ------------------------------------------------------------- shared

  sendChat(text) {
    const clean = cleanText(text);

    if (!clean) {
      return;
    }

    if (this.isHost) {
      const me = this.lobby.seats.find((seat) => seat.clientId === 'host');
      this.appendChat({ name: me?.name || 'Host', pieceKey: me?.pieceKey, text: clean });
    } else {
      this.transport?.send({ t: 'chat', text: clean });
    }
  }

  handleClosed(reason) {
    if (this.status === 'closed') {
      return;
    }

    this.status = 'closed';
    clearInterval(this.beatTimer);
    this.transport?.close();
    this.emit('closed', reason);
  }

  close() {
    if (this.status === 'closed') {
      return;
    }

    if (this.isHost) {
      this.broadcast({ t: 'closed' });
      writeStore(HOST_GAME_KEY, null);
    }

    this.status = 'closed';
    clearInterval(this.beatTimer);
    // Give the goodbye a moment to leave before tearing the channel down.
    const transport = this.transport;
    setTimeout(() => transport?.close(), 150);
    // Voice hangs up with the room: microphone off, links closed.
    this.emit('voice-close');
    this.listeners.clear();
  }
}
