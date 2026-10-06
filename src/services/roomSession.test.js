import RoomSession, { MAX_PLAYERS, MIN_PLAYERS } from './roomSession';
import { redactFor } from '../pages/Game/catanRules';

const hand = (brick) => ({ brick, lumber: 0, ore: 0, grain: 0, wool: 0 });

const gameState = () => ({
  version: 3,
  players: [
    { id: 'p1', clientId: null, kind: 'human' },
    { id: 'p2', clientId: 'peer-a', kind: 'human' },
    { id: 'p3', clientId: null, kind: 'bot' },
  ],
  hands: { p1: hand(1), p2: hand(2), p3: hand(3) },
  devCards: { p1: [{ id: 1, type: 'victoryPoint' }], p2: [], p3: [{ id: 2, type: 'knight' }] },
  devDeck: ['knight', 'monopoly'],
  lastSteal: null,
  gameOver: null,
});

const hostSession = () => {
  const session = new RoomSession('host');
  session.transport = { send: jest.fn(), broadcast: jest.fn(), kick: jest.fn(), close: jest.fn() };
  session.started = true;
  session.gameId = 'g1';
  return session;
};

describe('room session', () => {
  test('Catan tables seat 3 to 4 players', () => {
    expect([MIN_PLAYERS, MAX_PLAYERS]).toEqual([3, 4]);
    const session = new RoomSession('host');
    session.started = false;
    session.publishLobby = jest.fn();
    session.setTableSize(2);
    expect(session.lobby.tableSize).toBe(3);
    session.setTableSize(6);
    expect(session.lobby.tableSize).toBe(4);
  });

  test('the host picks the board, which travels with the start', () => {
    const session = new RoomSession('host');
    session.publishLobby = jest.fn();
    session.transport = { send: jest.fn(), broadcast: jest.fn() };
    expect(session.lobby.board).toBe('beginner');
    session.setBoard('random');
    expect(session.lobby.board).toBe('random');
    session.setBoard('anything');
    expect(session.lobby.board).toBe('beginner');
  });

  test('the host sets the table rules, which are checked and travel with the start', () => {
    const session = new RoomSession('host');
    session.publishLobby = jest.fn();
    session.transport = { send: jest.fn(), broadcast: jest.fn() };
    session.setBoard('random');
    session.setSettings({ turnSeconds: 45, handLimit: 9, victoryPoints: 12, redsMayTouch: true, extremesMayTouch: false });
    session.setSettings({ turnSeconds: 3, handLimit: 'many' }); // not on offer: back to the defaults
    expect(session.lobby.settings).toMatchObject({ board: 'random', turnSeconds: 15, handLimit: 7, victoryPoints: 12, redsMayTouch: true });

    session.lobby.seats = [
      { seatId: 'host', name: 'Host', pieceKey: 'red', kind: 'human', clientId: 'host' },
      { seatId: 'bot-1', name: 'Computer 1', pieceKey: 'blue', kind: 'bot', clientId: null },
      { seatId: 'bot-2', name: 'Computer 2', pieceKey: 'white', kind: 'bot', clientId: null },
    ];
    const started = jest.fn();
    session.on('start', started);
    session.startGame();
    clearInterval(session.beatTimer);
    expect(started.mock.calls[0][0].options).toMatchObject({ board: 'random', victoryPoints: 12, extremesMayTouch: false });
  });

  test('each friend receives only their own cards', () => {
    const session = hostSession();
    const state = gameState();
    session.broadcastGame(state, redactFor);

    expect(session.transport.broadcast).not.toHaveBeenCalled();
    expect(session.transport.send).toHaveBeenCalledTimes(1);
    const [peer, message] = session.transport.send.mock.calls[0];
    expect(peer).toBe('peer-a');
    expect(message.t).toBe('game');
    expect(message.state.hands.p2).toEqual(hand(2));
    expect(message.state.hands.p1).toEqual({ hidden: 1 });
    expect(message.state.devCards.p1).toEqual([{ hidden: true }]);
    expect(message.state.devDeck).toBe(2);
    // The host keeps the full state for saves and rejoins.
    expect(session.lastGameState).toBe(state);
    expect(session.gameFor('p2').hands.p3).toEqual({ hidden: 3 });
  });

  test('without a view function everyone gets the same snapshot', () => {
    const session = hostSession();
    session.broadcastGame(gameState());
    expect(session.transport.broadcast).toHaveBeenCalledTimes(1);
  });

  test('each friend learns only their own Player ID', () => {
    const session = hostSession();
    session.emit = jest.fn();
    session.players = [
      { id: 'p1', clientId: null, kind: 'human', code: 'HOST11' },
      { id: 'p2', clientId: 'peer-a', kind: 'human', code: 'AAAA22' },
      { id: 'p3', clientId: 'peer-b', kind: 'human', code: 'BBBB33' },
    ];
    session.announceStart();

    expect(session.transport.broadcast).not.toHaveBeenCalled();
    const starts = Object.fromEntries(session.transport.send.mock.calls.map(([peer, message]) => [peer, message]));
    expect(starts['peer-a'].players.map((player) => player.code)).toEqual([null, 'AAAA22', null]);
    expect(starts['peer-b'].players.map((player) => player.code)).toEqual([null, null, 'BBBB33']);
  });
});
