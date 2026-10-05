/**
 * @jest-environment node
 */
const { webcrypto } = require('crypto');

// The noble libraries read crypto when they load, so the globals come first.
if (!global.crypto?.subtle) {
  global.crypto = webcrypto;
}

global.window = { addEventListener() {}, removeEventListener() {}, location: { search: '' } };

const { guestWithRelay, hostWithRelay, openRelayPool, seal, unseal } = require('./relayTransport');

// An in memory stand in for a set of Nostr relays: REQ subscribes by kind and
// #t tag, EVENT fans out to every matching subscription on that relay.
const makeHub = ({ limited = {} } = {}) => {
  const relays = new Map();
  const accepted = {};
  let published = 0;

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.subs = new Map();
      if (!relays.has(url)) relays.set(url, new Set());
      relays.get(url).add(this);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 1);
    }

    send(frame) {
      const message = JSON.parse(frame);
      if (message[0] === 'REQ') {
        this.subs.set(message[1], message[2]);
      } else if (message[0] === 'EVENT') {
        published += 1;
        const event = message[1];
        accepted[this.url] = (accepted[this.url] || 0) + 1;
        if (limited[this.url] !== undefined && accepted[this.url] > limited[this.url]) {
          setTimeout(() => this.onmessage?.({ data: JSON.stringify(['OK', event.id, false, 'rate-limited: slow down']) }), 1);
          return;
        }
        relays.get(this.url).forEach((socket) =>
          socket.subs.forEach((filter, id) => {
            if (filter.kinds.includes(event.kind) && event.tags.some((tag) => filter['#t'].includes(tag[1]))) {
              setTimeout(() => socket.onmessage?.({ data: JSON.stringify(['EVENT', id, event]) }), 1);
            }
          }),
        );
      }
    }

    close() {
      this.readyState = 3;
      relays.get(this.url).delete(this);
    }
  }

  return { FakeSocket, published: () => published, accepted };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('relay transport', () => {
  test('seal and unseal round trip, large payloads compressed', async () => {
    const key = await webcrypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const small = { to: 'host', kind: 'probe' };
    const large = { to: '*', kind: 'msg', payload: { t: 'game', state: { log: Array(300).fill('Joel rolled 6 + 5 = 11') } } };

    expect(await unseal(key, await seal(key, small))).toEqual(small);
    const sealed = await seal(key, large);
    expect(await unseal(key, sealed)).toEqual(large);
    // Browsers deflate large envelopes; the Jest sandbox has no CompressionStream.
    const compresses = typeof CompressionStream === 'function' && typeof Response === 'function';
    expect(!compresses || sealed.length < JSON.stringify(large).length / 3).toBe(true);
  });

  test('a sealed envelope cannot be read with another room key', async () => {
    const a = await webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(1), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const b = await webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(2), 'AES-GCM', false, ['encrypt', 'decrypt']);
    await expect(unseal(b, await seal(a, { secret: 1 }))).rejects.toBeTruthy();
  });

  test('a guest joins a host, messages flow both ways and duplicates across relays are dropped', async () => {
    const { FakeSocket } = makeHub();
    const options = { urls: ['wss://one', 'wss://two'], Socket: FakeSocket, tickCalm: 20, tickBusy: 60 };
    const hostEvents = [];
    const guestEvents = [];

    const host = hostWithRelay('ABC234', {
      onPeerOpen: (id) => hostEvents.push(['open', id]),
      onMessage: (id, message) => hostEvents.push(['msg', message]),
      onPeerClose: (id) => hostEvents.push(['close', id]),
    }, options);
    await host.ready;

    const guest = guestWithRelay('ABC234', { onMessage: (_, message) => guestEvents.push(message) }, options);
    await guest.ready;

    const guestId = hostEvents.find((entry) => entry[0] === 'open')[1];
    expect(host.owns(guestId)).toBe(true);
    expect(hostEvents.filter((entry) => entry[0] === 'open')).toHaveLength(1);

    guest.send({ t: 'hello', name: 'Asha' });
    host.send(guestId, { t: 'welcome', clientId: guestId });
    host.broadcast({ t: 'chat', message: { text: 'hi' } });
    await wait(80);

    expect(hostEvents.filter((entry) => entry[0] === 'msg')).toEqual([['msg', { t: 'hello', name: 'Asha' }]]);
    expect(guestEvents).toEqual([{ t: 'welcome', clientId: guestId }, { t: 'chat', message: { text: 'hi' } }]);

    guest.close();
    await wait(80);
    expect(hostEvents).toContainEqual(['close', guestId]);
    host.close();
  });

  test('another room code never sees the traffic', async () => {
    const { FakeSocket } = makeHub();
    const options = { urls: ['wss://one'], Socket: FakeSocket, tickCalm: 20, tickBusy: 60 };
    const host = hostWithRelay('ABC234', {}, options);
    await host.ready;
    const stray = guestWithRelay('XYZ987', {}, options);
    stray.ready.catch(() => {});
    const seen = [];
    const pool = openRelayPool('XYZ987', (envelope) => seen.push(envelope), options);
    await pool.ready;
    host.broadcast({ t: 'chat' });
    await wait(50);
    expect(seen.filter((envelope) => envelope.from === 'host')).toEqual([]);
    stray.close();
    pool.close();
    host.close();
  });

  test('game snapshots are coalesced to the newest one', async () => {
    const { FakeSocket } = makeHub();
    const options = { urls: ['wss://one'], Socket: FakeSocket, tickCalm: 20, tickBusy: 60 };
    const host = hostWithRelay('ABC234', {}, options);
    await host.ready;
    const received = [];
    const guest = guestWithRelay('ABC234', { onMessage: (_, message) => received.push(message) }, options);
    await guest.ready;

    for (let index = 1; index <= 10; index += 1) {
      host.broadcast({ t: 'game', state: { index }, sentAt: Date.now() + index });
    }
    await wait(500);

    const games = received.filter((message) => message.t === 'game');
    expect(games.length).toBeLessThanOrEqual(2);
    expect(games[games.length - 1].state.index).toBe(10);
    guest.close();
    host.close();
  });

  test('a rate limited relay is rested and the other relay carries the room', async () => {
    const { FakeSocket, accepted } = makeHub({ limited: { 'wss://strict': 3 } });
    const options = { urls: ['wss://strict', 'wss://open'], Socket: FakeSocket, tickCalm: 20, tickBusy: 60 };
    const host = hostWithRelay('ABC234', {}, options);
    await host.ready;
    const received = [];
    const guest = guestWithRelay('ABC234', { onMessage: (_, message) => received.push(message) }, options);
    await guest.ready;

    for (let index = 1; index <= 12; index += 1) {
      host.broadcast({ t: 'chat', message: { text: `line ${index}` } });
      await wait(90);
    }
    await wait(200);

    expect(received.map((message) => message.message.text)).toEqual(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`));
    // Once refused, the strict relay is skipped instead of hammered.
    expect(accepted['wss://strict']).toBeLessThan(accepted['wss://open']);
    guest.close();
    host.close();
  });

  test('a message every relay refused is sent again and still arrives', async () => {
    const limits = { 'wss://only': 4 };
    const { FakeSocket } = makeHub({ limited: limits });
    const options = { urls: ['wss://only'], Socket: FakeSocket, tickCalm: 20, tickBusy: 40, restFor: 100 };
    const host = hostWithRelay('ABC234', {}, options);
    await host.ready;
    const received = [];
    const guest = guestWithRelay('ABC234', { onMessage: (_, message) => received.push(message) }, options);
    await guest.ready;

    // The relay now refuses everything, so the message waits for a retry.
    host.broadcast({ t: 'chat', text: 'important' });
    await wait(150);
    expect(received).toEqual([]);

    // Once the relay accepts again, the retry gets it through.
    limits['wss://only'] = Infinity;
    await wait(1500);
    expect(received).toEqual([{ t: 'chat', text: 'important' }]);
    guest.close();
    host.close();
  });

  test('many messages in one tick travel as one event', async () => {
    const { FakeSocket, published } = makeHub();
    const options = { urls: ['wss://one'], Socket: FakeSocket, tickCalm: 50, tickBusy: 100 };
    const host = hostWithRelay('ABC234', {}, options);
    await host.ready;
    const received = [];
    const guest = guestWithRelay('ABC234', { onMessage: (_, message) => received.push(message) }, options);
    await guest.ready;
    await wait(120);

    const before = published();
    for (let index = 0; index < 20; index += 1) host.broadcast({ t: 'chat', index });
    await wait(150);

    expect(received.filter((message) => message.t === 'chat')).toHaveLength(20);
    expect(published() - before).toBeLessThanOrEqual(2);
    guest.close();
    host.close();
  });

  test('a batch too large for one event is split and arrives in order', async () => {
    const { FakeSocket } = makeHub();
    const options = { urls: ['wss://one'], Socket: FakeSocket, tickCalm: 30, tickBusy: 60 };
    const host = hostWithRelay('ABC234', {}, options);
    await host.ready;
    const received = [];
    const guest = guestWithRelay('ABC234', { onMessage: (_, message) => received.push(message) }, options);
    await guest.ready;

    const bulky = 'x'.repeat(15000);
    for (let index = 0; index < 6; index += 1) host.broadcast({ t: 'chat', index, bulky });
    await wait(300);

    expect(received.map((message) => message.index)).toEqual([0, 1, 2, 3, 4, 5]);
    guest.close();
    host.close();
  });

  test('joins and messages from an earlier host session are ignored', async () => {
    const { FakeSocket } = makeHub();
    const options = { urls: ['wss://one'], Socket: FakeSocket, tickCalm: 20, tickBusy: 60 };
    const opened = [];
    const host = hostWithRelay('ABC234', { onPeerOpen: (id) => opened.push(id) }, options);
    await host.ready;
    const stale = openRelayPool('ABC234', () => {}, options);
    await stale.ready;
    stale.publish({ from: 'rold', hs: 'rprevious', items: [{ to: 'host', kind: 'join', hs: 'rprevious' }] });
    stale.publish({ from: 'rold', hs: 'rprevious', items: [{ to: 'host', kind: 'msg', payload: { t: 'hello' } }] });
    await wait(60);
    expect(opened).toEqual([]);
    stale.close();
    host.close();
  });

  test('a guest finds no room when nobody hosts the code', async () => {
    const { FakeSocket } = makeHub();
    const guest = guestWithRelay('NOROOM', {}, { urls: ['wss://one'], Socket: FakeSocket, findTimeout: 200 });
    await expect(guest.ready).rejects.toThrow('not-found');
    guest.close();
  });

  test('a blocked network reports blocked when no relay opens', async () => {
    class DeadSocket {
      constructor() {
        this.readyState = 0;
      }

      send() {}

      close() {}
    }
    const guest = guestWithRelay('ABC234', {}, { urls: ['wss://one'], Socket: DeadSocket, openTimeout: 100 });
    await expect(guest.ready).rejects.toThrow('blocked');
    guest.close();
  });
});
