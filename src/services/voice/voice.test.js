import RoomSession from '../roomSession';
import { newVoiceKeys, seal, sharedKey, unseal } from './voiceCrypto';
import { restCredential } from './voiceIce';

const hostWithGuests = () => {
  const session = new RoomSession('host');
  session.transport = { send: jest.fn(), broadcast: jest.fn(), kick: jest.fn(), close: jest.fn() };
  session.lobby.seats = [
    { seatId: 'host', name: 'Host', pieceKey: 'red', kind: 'human', clientId: 'host' },
    { seatId: 'a', name: 'Anu', pieceKey: 'blue', kind: 'human', clientId: 'a' },
    { seatId: 'b', name: 'Ravi', pieceKey: 'white', kind: 'human', clientId: 'b' },
    { seatId: 'bot-1', name: 'Computer 1', pieceKey: 'orange', kind: 'bot', clientId: null },
  ];
  return session;
};

const sentTo = (session, to, t) => session.transport.send.mock.calls.filter(([peer, message]) => peer === to && message.t === t);

describe('voice channels on the host', () => {
  test('the table channel: joining publishes the roster, people only, no computers', () => {
    const session = hostWithGuests();
    session.handleGuestMessage('a', { t: 'voice-join', channel: 'table', key: 'a'.repeat(64) });
    const roster = session.voiceRoster();
    expect(roster.channels[0]).toMatchObject({ id: 'table', members: ['a'] });
    expect(Object.keys(roster.people).sort()).toEqual(['a', 'b', 'host']);
    expect(roster.people.a.key).toBe('a'.repeat(64));
    expect(session.transport.broadcast).toHaveBeenCalledWith({ t: 'voice-roster', roster });
  });

  test('signals and clips pass only between members of the same channel', () => {
    const session = hostWithGuests();
    session.handleGuestMessage('a', { t: 'voice-join', channel: 'table' });
    session.handleGuestMessage('a', { t: 'voice-signal', to: 'b', data: { sdp: 1 } });
    expect(sentTo(session, 'b', 'voice-signal')).toHaveLength(0); // b is not in voice

    session.handleGuestMessage('b', { t: 'voice-join', channel: 'table' });
    session.handleGuestMessage('a', { t: 'voice-signal', to: 'b', data: { sdp: 1 } });
    expect(sentTo(session, 'b', 'voice-signal')).toEqual([['b', { t: 'voice-signal', to: 'b', data: { sdp: 1 }, from: 'a' }]]);

    // A claimed sender is ignored: the host stamps who it came from.
    session.handleGuestMessage('a', { t: 'voice-clip', to: 'b', from: 'host', data: 'x', part: 0, total: 1 });
    expect(sentTo(session, 'b', 'voice-clip')[0][1].from).toBe('a');
  });

  test('a private channel: only the invited can join, outsiders hear nothing', () => {
    const session = hostWithGuests();
    session.handleGuestMessage('a', { t: 'voice-join', channel: 'table' });
    session.handleGuestMessage('b', { t: 'voice-join', channel: 'table' });
    session.handleGuestMessage('a', { t: 'voice-create', name: 'Plans', invite: ['host', 'bot-1-client'] });
    const channel = session.voiceRoster().channels.find((entry) => entry.id !== 'table');
    expect(channel).toMatchObject({ name: 'Plans', invited: ['a', 'host'], members: ['a'] });

    // b was not invited.
    session.handleGuestMessage('b', { t: 'voice-join', channel: channel.id });
    expect(session.voiceRoster().channels.find((entry) => entry.id === channel.id).members).toEqual(['a']);
    session.handleGuestMessage('a', { t: 'voice-signal', to: 'b', data: {} });
    expect(sentTo(session, 'b', 'voice-signal')).toHaveLength(0);

    // The host was invited: it hears about it, joins, and the two can talk.
    const invites = [];
    session.on('voice-invite', (message) => invites.push(message));
    session.handleGuestMessage('a', { t: 'voice-create', name: 'Again', invite: ['host'] });
    expect(invites).toHaveLength(1);
    // Making "Again" moved a out of "Plans", which closed as it emptied.
    expect(session.voiceRoster().channels.some((entry) => entry.id === channel.id)).toBe(false);
    session.sendVoice({ t: 'voice-join', channel: invites[0].channel });
    const signals = [];
    session.on('voice-signal', (message) => signals.push(message));
    session.handleGuestMessage('a', { t: 'voice-signal', to: 'host', data: { hi: 1 } });
    expect(signals).toEqual([{ t: 'voice-signal', to: 'host', data: { hi: 1 }, from: 'a' }]);
  });

  test('leaving, or dropping out, takes a person out; an empty private channel closes', () => {
    const session = hostWithGuests();
    session.handleGuestMessage('a', { t: 'voice-create', invite: ['b'] });
    const id = session.voiceRoster().channels[1].id;
    session.handleGuestLeft('a');
    expect(session.voiceRoster().channels.map((channel) => channel.id)).toEqual(['table']);
    expect(session.voiceRoster().channels.some((channel) => channel.id === id)).toBe(false);
  });
});

describe('voice security', () => {
  test('a clip sealed for one listener opens only with their key', async () => {
    const alice = newVoiceKeys();
    const bob = newVoiceKeys();
    const eve = newVoiceKeys();
    const clip = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const sealed = await seal(await sharedKey(alice.secret, bob.publicKey), clip);
    expect(await unseal(await sharedKey(bob.secret, alice.publicKey), sealed)).toEqual(clip);
    await expect(unseal(await sharedKey(eve.secret, alice.publicKey), sealed)).rejects.toBeTruthy();
  });

  test('TURN credentials follow the coturn REST scheme', async () => {
    // HMAC-SHA1("key", "The quick brown fox jumps over the lazy dog") in base64.
    expect(await restCredential('key', 'The quick brown fox jumps over the lazy dog')).toBe('3nybhbi3iqa8ino29wqQcBydtNk=');
  });
});
