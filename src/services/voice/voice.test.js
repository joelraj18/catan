import RoomSession from '../roomSession';
import VoiceClient from './voiceClient';
import { newVoiceKeys, seal, sharedKey, toBase64, unseal } from './voiceCrypto';
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

describe('walkie-talkie open mic', () => {
  // Stand-ins for the browser's recorder, audio, level meter and blobs.
  let recorders;
  let audios;
  let urls;
  let events;
  let micLevel;
  const saved = {};
  const GLOBALS = ['MediaRecorder', 'AudioContext', 'Audio', 'Blob', 'RTCPeerConnection'];

  class FakeBlob {
    constructor(parts = [], { type } = {}) {
      this.type = type;
      const chunks = parts.map((part) => (part instanceof FakeBlob ? part.bytes : part));
      this.bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      chunks.reduce((offset, chunk) => {
        this.bytes.set(chunk, offset);
        return offset + chunk.length;
      }, 0);
      this.size = this.bytes.length;
    }

    async arrayBuffer() {
      return this.bytes.buffer.slice(0);
    }
  }

  class FakeRecorder {
    static isTypeSupported(type) {
      return type.startsWith('audio/webm');
    }

    constructor(stream, options) {
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      this.n = recorders.length;
      recorders.push(this);
    }

    start() {
      this.state = 'recording';
      events.push(`start ${this.n}`);
    }

    stop() {
      this.state = 'inactive';
      events.push(`stop ${this.n}`);
      this.ondataavailable({ data: new FakeBlob([new Uint8Array([this.n])]) });
      this.sent = this.onstop();
    }
  }

  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.playing = false;
      audios.push(this);
    }

    play() {
      this.playing = true;
      return Promise.resolve();
    }

    pause() {
      this.playing = false;
    }

    end() {
      this.playing = false;
      this.onended();
    }
  }

  class FakeContext {
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }

    createAnalyser() {
      return { getByteTimeDomainData: (data) => data.fill(128 + micLevel) };
    }

    close() {
      return Promise.resolve();
    }
  }

  const fakeStream = () => {
    const tracks = [{ enabled: true, stop: jest.fn() }];
    return { getAudioTracks: () => tracks, getTracks: () => tracks };
  };

  const fakeSession = (me) => ({ myClientId: me, isHost: false, voiceRosterCache: null, on: () => () => {}, sendVoice: jest.fn() });
  const roster = (people) => ({ channels: [{ id: 'table', members: Object.keys(people) }], people });
  const clipsSent = (client) => client.session.sendVoice.mock.calls.map(([message]) => message).filter((message) => message.t === 'voice-clip');
  const heard = () => audios.map((audio) => urls[Number(audio.src.split(':')[1])].bytes[0]);
  const playingNow = () => audios.filter((audio) => audio.playing).length;

  // Anu talks to Ravi, who is on walkie-talkie.
  const talker = async () => {
    const ravi = newVoiceKeys();
    const anu = new VoiceClient(fakeSession('a'));
    await anu.join('table');
    anu.onRoster(roster({ a: { key: anu.keys.publicKey }, b: { key: ravi.publicKey } }));
    return anu;
  };

  // Ravi listens to Anu; clipFrom seals a numbered clip as Anu's client would.
  const listener = () => {
    const anu = newVoiceKeys();
    const ravi = new VoiceClient(fakeSession('b'));
    ravi.onRoster(roster({ a: { key: anu.publicKey }, b: { key: ravi.keys.publicKey } }));
    const clipFrom = async (seq, byte = seq) => {
      const key = await sharedKey(anu.secret, ravi.keys.publicKey);
      const data = toBase64(await seal(key, new Uint8Array([byte])));
      return { t: 'voice-clip', from: 'a', to: 'b', id: `c${seq}`, part: 0, total: 1, type: 'audio/webm', seq, at: Date.now(), data };
    };
    return { ravi, clipFrom };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    recorders = [];
    audios = [];
    urls = [];
    events = [];
    micLevel = 40;
    GLOBALS.forEach((name) => {
      saved[name] = window[name];
    });
    saved.mediaDevices = navigator.mediaDevices;
    saved.createObjectURL = URL.createObjectURL;
    saved.revokeObjectURL = URL.revokeObjectURL;
    window.MediaRecorder = FakeRecorder;
    window.AudioContext = FakeContext;
    window.Audio = FakeAudio;
    window.Blob = FakeBlob;
    window.RTCPeerConnection = jest.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => fakeStream() }, configurable: true });
    URL.createObjectURL = (blob) => `blob:${urls.push(blob) - 1}`;
    URL.revokeObjectURL = () => {};
    window.history.replaceState({}, '', '/?voice=walkie');
  });

  afterEach(() => {
    jest.useRealTimers();
    GLOBALS.forEach((name) => {
      window[name] = saved[name];
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: saved.mediaDevices, configurable: true });
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
    window.history.replaceState({}, '', '/');
  });

  test('the open mic starts a fresh recorder every 1.2 s, the new one before the old one stops', async () => {
    const anu = await talker();
    expect(recorders).toHaveLength(1);
    expect(recorders[0].state).toBe('recording');

    jest.advanceTimersByTime(1200);
    expect(recorders).toHaveLength(2);
    expect(events).toEqual(['start 0', 'start 1', 'stop 0']);
    await recorders[0].sent;
    jest.advanceTimersByTime(1200);
    await recorders[1].sent;

    const sent = clipsSent(anu);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: 'b', part: 0, total: 1, type: 'audio/webm;codecs=opus' });
    expect(sent[1].seq).toBe(sent[0].seq + 1);
    expect(sent[1].at - sent[0].at).toBe(1200);
    anu.destroy();
  });

  test('a clip that stayed quiet is not sent, and one listener gets at most two clips a second', async () => {
    const anu = await talker();
    micLevel = 1;
    jest.advanceTimersByTime(1200);
    await recorders[0].sent;
    expect(clipsSent(anu)).toHaveLength(0);

    micLevel = 40;
    jest.advanceTimersByTime(1200);
    await recorders[1].sent;
    expect(clipsSent(anu)).toHaveLength(1);

    // Two more inside the same second: only one more goes out.
    await anu.sendClip(new Uint8Array([7]), 'audio/webm', { seq: 1 });
    await anu.sendClip(new Uint8Array([8]), 'audio/webm', { seq: 2 });
    expect(clipsSent(anu)).toHaveLength(2);
    anu.destroy();
  });

  test('muting, leaving or losing the last walkie listener stops the recording', async () => {
    const anu = await talker();
    anu.setMuted(true);
    expect(recorders[0].state).toBe('inactive');
    jest.advanceTimersByTime(5000);
    expect(recorders).toHaveLength(1);

    anu.setMuted(false);
    expect(recorders).toHaveLength(2);
    expect(recorders[1].state).toBe('recording');
    anu.onRoster(roster({ a: { key: anu.keys.publicKey } }));
    expect(recorders[1].state).toBe('inactive');

    anu.onRoster(roster({ a: { key: anu.keys.publicKey }, b: { key: newVoiceKeys().publicKey } }));
    expect(recorders[2].state).toBe('recording');
    anu.leave();
    expect(recorders[2].state).toBe('inactive');
    jest.advanceTimersByTime(5000);
    expect(recorders).toHaveLength(3);
    anu.destroy();
  });

  test('a sender plays in order, one clip at a time, with their speaking light on', async () => {
    const { ravi, clipFrom } = listener();
    await ravi.onClip(await clipFrom(2));
    await ravi.onClip(await clipFrom(1));
    expect(audios).toHaveLength(0); // the jitter buffer
    jest.advanceTimersByTime(300);
    expect(heard()).toEqual([1]);
    expect(ravi.speaking('a')).toBe(true);

    audios[0].end();
    expect(heard()).toEqual([1, 2]);
    expect(playingNow()).toBe(1);

    // An older client's clip has no number: it plays after what is waiting.
    const old = await clipFrom(3, 9);
    delete old.seq;
    delete old.at;
    await ravi.onClip(old);
    expect(playingNow()).toBe(1);
    audios[1].end();
    expect(heard()).toEqual([1, 2, 9]);
    audios[2].end();
    expect(ravi.speaking('a')).toBe(false);

    // Volume and deafen reach the clip that is playing.
    await ravi.onClip(await clipFrom(4));
    jest.advanceTimersByTime(300);
    ravi.setVolume('a', 0.3);
    expect(audios[3].volume).toBe(0.3);
    ravi.setDeafened(true);
    expect(playingNow()).toBe(0);
    await ravi.onClip(await clipFrom(5));
    jest.advanceTimersByTime(300);
    expect(audios).toHaveLength(4);
    ravi.destroy();
  });

  test('a clip that arrives after a later one played is dropped, and a long backlog is skipped', async () => {
    const { ravi, clipFrom } = listener();
    await ravi.onClip(await clipFrom(1));
    jest.advanceTimersByTime(300);
    await ravi.onClip(await clipFrom(3));
    audios[0].end();
    await ravi.onClip(await clipFrom(2)); // too late: 3 is playing
    audios[1].end();
    expect(heard()).toEqual([1, 3]);
    expect(playingNow()).toBe(0);

    // More than 3 s waiting: only the newest is kept.
    await ravi.onClip(await clipFrom(10));
    jest.advanceTimersByTime(300);
    await ravi.onClip(await clipFrom(11));
    await ravi.onClip(await clipFrom(12));
    await ravi.onClip(await clipFrom(13));
    await ravi.onClip(await clipFrom(14));
    expect(playingNow()).toBe(1);
    audios[2].end();
    audios[3].end();
    expect(heard()).toEqual([1, 3, 10, 13, 14]);
    await ravi.onClip(await clipFrom(12));
    expect(audios).toHaveLength(5);
    ravi.destroy();
  });
});
