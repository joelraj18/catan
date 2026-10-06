import RoomSession, { EMOTE_GAP_MS } from '../../services/roomSession';
import { SFX_KEYS, playSfx } from '../../services/sfx';
import { flightsFor } from './CardFlights';
import { beginnerBoard } from './catanBoard';
import GameEngine from './catanEngine';
import { EMOTE_KEYS } from './emotes.jsx';

const startedHost = () => {
  const session = new RoomSession('host');
  session.transport = { send: jest.fn(), broadcast: jest.fn(), kick: jest.fn(), close: jest.fn() };
  session.started = true;
  session.myPlayerId = 'p1';
  session.lobby.seats = [
    { seatId: 'host', name: 'Host', pieceKey: 'red', kind: 'human', clientId: 'host' },
    { seatId: 'g', name: 'Guest', pieceKey: 'blue', kind: 'human', clientId: 'peer-g' },
  ];
  session.players = [
    { id: 'p1', name: 'Host', clientId: null },
    { id: 'p2', name: 'Guest', clientId: 'peer-g' },
  ];
  return session;
};

describe('emotes', () => {
  test('the host passes on known emotes, stamped with the sender, at most one per gap', () => {
    const session = startedHost();
    const seen = [];
    session.on('emote', (message) => seen.push(message));
    session.handleGuestMessage('peer-g', { t: 'emote', key: 'sheep' });
    session.handleGuestMessage('peer-g', { t: 'emote', key: 'dragon' }); // too soon
    session.handleGuestMessage('peer-g', { t: 'emote', key: 'nonsense' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ t: 'emote', key: 'sheep', playerId: 'p2' });
    expect(session.transport.broadcast).toHaveBeenCalledWith(seen[0]);

    // The host's own emote goes out as player 1.
    session.sendEmote('knight');
    expect(seen[1]).toMatchObject({ key: 'knight', playerId: 'p1' });

    // After the gap the guest may react again.
    session.emoteAt.set('p2', Date.now() - EMOTE_GAP_MS - 1);
    session.handleGuestMessage('peer-g', { t: 'emote', key: 'dragon' });
    expect(seen).toHaveLength(3);
    expect(EMOTE_KEYS).toHaveLength(8);
  });

  test('computer opponents react now and then, never more than once in a few turns', () => {
    const engine = new GameEngine({
      players: ['bot', 'bot', 'bot'].map((kind, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, pieceKey: ['red', 'blue', 'white'][i], kind })),
      timing: { roll: 0, botDelay: 1e9, botStep: 1e9 },
      options: { board: 'beginner' },
    });
    for (let i = 0; i < 20; i += 1) engine.botEmote('p2', 'farmer', 1);
    expect(engine.state.events.filter((event) => event.type === 'emote')).toHaveLength(1);
    engine.state = { ...engine.state, turnCount: engine.state.turnCount + 3 };
    engine.botEmote('p2', 'farmer', 1);
    engine.botEmote('p2', 'farmer', 0); // never
    expect(engine.state.events.filter((event) => event.type === 'emote')).toHaveLength(2);
    engine.destroy();
  });
});

describe('the harvest', () => {
  test('cards rise from the tiles and the last one to each player carries the total', () => {
    const board = beginnerBoard();
    const hills = board.hexes.find((hex) => hex.terrain === 'hills');
    const fields = board.hexes.find((hex) => hex.terrain === 'fields');
    const event = { type: 'produce', gains: { p1: { brick: 2, grain: 1 }, p2: { grain: 1 } }, hexes: [hills.id, fields.id] };
    const trips = flightsFor(event, 'p1', board);
    expect(trips.every((trip) => trip.rise)).toBe(true);
    expect(trips.filter((trip) => trip.from === `hex-${hills.id}`)).toHaveLength(2);
    expect(trips.filter((trip) => trip.gain)).toEqual([
      expect.objectContaining({ to: 'hand-grain', gain: { seat: 'seat-p1', total: 3 } }),
      expect.objectContaining({ to: 'seat-p2', gain: { seat: 'seat-p2', total: 1 } }),
    ]);
  });
});

describe('sounds', () => {
  test('every effect builds its sound without error', () => {
    const node = () => ({
      connect: jest.fn(function connect(next) {
        return next;
      }),
      start: jest.fn(),
      stop: jest.fn(),
      frequency: { value: 0, setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      gain: { value: 0, setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      Q: { value: 0 },
      threshold: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    });
    window.AudioContext = jest.fn(() => ({
      state: 'running',
      currentTime: 0,
      sampleRate: 8000,
      destination: node(),
      createOscillator: node,
      createGain: node,
      createBiquadFilter: node,
      createBufferSource: node,
      createDynamicsCompressor: node,
      createConvolver: node,
      createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    }));
    expect(SFX_KEYS).toEqual(expect.arrayContaining(['dragon', 'dragonWake', 'myTurn', 'pluck-grain', 'emote-sheep', 'monopoly', 'knight']));
    SFX_KEYS.forEach((key) => expect([key, playSfx(key, 0.5)]).toEqual([key, true]));
    expect(playSfx('no-such-sound')).toBe(false);
  });
});
