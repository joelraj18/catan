// Relay: room messages carried through public Nostr relays.
//
// Direct WebRTC needs the PeerJS signalling server and an open path between
// two browsers. College and office networks, VPNs and some mobile carriers
// block one or both. Relays are ordinary secure websockets on port 443, the
// same as any website, so they get through almost everywhere.
//
// Every message is sealed with AES GCM under a key made from the room code,
// so only people who know the code can read it, and sent as a short lived
// (ephemeral) event that relays forward without storing. Several relays are
// used at once and duplicates are dropped, so one relay going down does not
// matter. The signing key is made fresh for each tab and only kept in memory.
//
// It speaks the same small protocol as the BroadcastChannel transport:
// probe, here, join, accepted, msg, leave, host-gone, plus ping so each side
// notices when the other has gone quiet.

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

// Open public relays. Some limit how often one address may post, so the
// list is long: a relay that pushes back is rested and the rest carry on.
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.damus.io',
  'wss://offchain.pub',
  'wss://relay.nostr.bg',
  'wss://nostr.oxtr.dev',
  'wss://relay.snort.social',
];

const KIND = 25050;
const OPEN_TIMEOUT = 8000;
const FIND_TIMEOUT = 12000;
const PROBE_EVERY = 2500;
const QUIET_PING = 20000;
const SILENT_FOR = 65000;
const SEEN_LIMIT = 2000;
const REST_FOR = 20000;
const RETRY_LIMIT = 6;
const PENDING_FOR = 30000;

// Everything a side sends is batched into one event per tick. A tick is
// short while the relays are happy and stretches when they push back, and
// only the newest board snapshot in a batch is kept.
export const TICK_CALM = 900;
export const TICK_BUSY = 2500;
// Guests send little, mostly button presses, so they wait less.
const GUEST_TICK_CALM = 250;
const GUEST_TICK_BUSY = 1200;
// Relays commonly refuse events over 64 KB. A batch is split well below
// that, allowing for browsers that cannot compress.
const BATCH_CHARS = 40000;
// Joining is a short back and forth, so those steps skip the tick.
const TICK_URGENT = 120;
const URGENT_KINDS = ['probe', 'here', 'join', 'accepted', 'host-gone'];
// Voice set-up and walkie-talkie clips go out at once too.
const URGENT_MESSAGES = ['hello', 'welcome', 'reject', 'chat-log', 'start', 'voice-signal', 'voice-clip', 'voice-roster', 'voice-invite'];
const isUrgent = (item) => URGENT_KINDS.includes(item.kind) || URGENT_MESSAGES.includes(item.payload?.t);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ?relay=wss://a,wss://b swaps the relay list, used by tests with a local relay.
export const relayUrls = () => {
  try {
    const custom = new URLSearchParams(window.location.search).get('relay');
    const list = custom ? custom.split(',').map((url) => url.trim()).filter((url) => /^wss?:\/\//.test(url)) : [];
    return list.length ? list : DEFAULT_RELAYS;
  } catch {
    return DEFAULT_RELAYS;
  }
};

const randomId = () => `r${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;

const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
};

const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

// --------------------------------------------------------------- sealing

const roomTopic = (code) => bytesToHex(sha256(encoder.encode(`catan topic ${code.toUpperCase()}`))).slice(0, 32);

const roomKey = (code) =>
  crypto.subtle.importKey('raw', sha256(encoder.encode(`catan room ${code.toUpperCase()}`)), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

const pipeThrough = async (bytes, stream) => {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
};

// One flag byte says whether the body was deflated, so a browser without
// CompressionStream can still talk to one that has it.
export const seal = async (key, envelope) => {
  const plain = encoder.encode(JSON.stringify(envelope));
  let body = plain;
  let flag = 0;

  if (canCompress() && plain.length > 512) {
    body = await pipeThrough(plain, new CompressionStream('deflate'));
    flag = 1;
  }

  const framed = new Uint8Array(body.length + 1);
  framed[0] = flag;
  framed.set(body, 1);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, framed));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return toBase64(out);
};

export const unseal = async (key, text) => {
  const bytes = fromBase64(text);
  const framed = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)),
  );
  const body = framed.subarray(1);
  const plain = framed[0] === 1 ? await pipeThrough(body, new DecompressionStream('deflate')) : body;
  return JSON.parse(decoder.decode(plain));
};

// ------------------------------------------------------------- the clock

// Relays refuse short lived events stamped more than a minute away from their
// own clock, and some phones and laptops run minutes off. The page's own web
// server says the real time in its Date header, which corrects for that.
let clockOffset = 0;
let clockChecked = null;

const checkClock = () => {
  if (clockChecked || typeof fetch !== 'function' || !window.location?.href?.startsWith('http')) {
    return clockChecked || Promise.resolve();
  }

  clockChecked = fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
    .then((response) => {
      const server = Date.parse(response.headers.get('date') || '');
      if (Number.isFinite(server) && Math.abs(server - Date.now()) > 20000) {
        clockOffset = server - Date.now();
      }
    })
    .catch(() => {});
  return clockChecked;
};

const nowSeconds = () => Math.floor((Date.now() + clockOffset) / 1000);

// ------------------------------------------------------------- the pool

// Reasons a relay gives for refusing an event: slow down, or never here.
const RATE_LIMITED = /rate|limit|slow|too many|spam/i;
const NOT_ALLOWED = /auth|restricted|blocked|pow|payment|paid|whitelist|not allowed|forbidden|kind/i;

// Opens every relay, keeps them open while the room lives, and hands over
// each sealed envelope once, in the order it arrived.
export const openRelayPool = (
  code,
  onEnvelope,
  { urls = relayUrls(), Socket = window.WebSocket, openTimeout = OPEN_TIMEOUT, restFor = REST_FOR } = {},
) => {
  const secret = schnorr.utils.randomPrivateKey();
  const pubkey = bytesToHex(schnorr.getPublicKey(secret));
  const topic = roomTopic(code);
  const keyReady = roomKey(code);
  const sockets = new Map();
  const health = new Map(); // url -> { restUntil, banned }
  const pending = new Map(); // event id -> { envelope, tries, targets, refused }
  const seen = new Set();
  const backlog = [];
  let closed = false;
  // Every delay this pool starts, so closing it leaves nothing running.
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!closed) fn();
    }, ms);
    timers.add(timer);
  };
  let chain = Promise.resolve();
  let sending = Promise.resolve();
  let markOpen;
  let markFailed;

  const ready = new Promise((resolve, reject) => {
    markOpen = resolve;
    markFailed = reject;
  });
  ready.catch(() => {});
  const failTimer = setTimeout(() => markFailed(new Error('blocked')), openTimeout);
  const clock = checkClock();

  const remember = (id) => {
    seen.add(id);
    if (seen.size > SEEN_LIMIT) {
      seen.delete(seen.values().next().value);
    }
  };

  const handleEvent = (event) => {
    if (!event || event.kind !== KIND || seen.has(event.id)) return;
    remember(event.id);
    if (event.pubkey === pubkey) return;

    chain = chain
      .then(async () => onEnvelope(await unseal(await keyReady, event.content)))
      .catch(() => {});
  };

  const stateOf = (url) => {
    if (!health.has(url)) health.set(url, { restUntil: 0, banned: false });
    return health.get(url);
  };

  const subscribe = (socket) =>
    socket.send(JSON.stringify(['REQ', 'room', { kinds: [KIND], '#t': [topic], since: nowSeconds() - 30 }]));

  const connect = (url, attempt = 0) => {
    if (closed || stateOf(url).banned) return;
    let socket;

    try {
      socket = new Socket(url);
    } catch {
      return;
    }

    sockets.set(url, socket);

    socket.onopen = () => {
      attempt = 0;
      clock.then(() => {
        if (socket.readyState !== 1) return;
        subscribe(socket);
        backlog.splice(0).forEach((frame) => socket.send(frame));
        clearTimeout(failTimer);
        markOpen();
      });
    };

    socket.onmessage = ({ data }) => {
      try {
        const frame = JSON.parse(typeof data === 'string' ? data : decoder.decode(data));
        if (frame[0] === 'EVENT') {
          handleEvent(frame[2]);
        } else if (frame[0] === 'OK' && frame[2] === true) {
          pending.delete(frame[1]);
        } else if (frame[0] === 'OK' && frame[2] === false) {
          const reason = String(frame[3] || '');
          if (RATE_LIMITED.test(reason)) stateOf(url).restUntil = Date.now() + restFor;
          else if (NOT_ALLOWED.test(reason)) stateOf(url).banned = true;
          refused(frame[1], url);
        } else if (frame[0] === 'CLOSED' && frame[1] === 'room') {
          // The relay dropped our subscription; ask once more a little later.
          later(() => socket.readyState === 1 && subscribe(socket), 5000);
        } else if (frame[0] === 'NOTICE' && RATE_LIMITED.test(String(frame[1]))) {
          stateOf(url).restUntil = Date.now() + restFor;
        }
      } catch {
        // Not ours, or not JSON.
      }
    };

    socket.onerror = () => {};
    socket.onclose = () => {
      if (sockets.get(url) === socket) sockets.delete(url);
      // Anything this relay had not confirmed yet may never arrive.
      [...pending.keys()].forEach((id) => refused(id, url));
      if (!closed) {
        later(() => connect(url, attempt + 1), Math.min(15000, 1000 * 2 ** attempt));
      }
    };
  };

  urls.forEach((url) => connect(url));

  // A phone that comes back from the background reopens dropped relays at
  // once instead of waiting out the backoff.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    urls.forEach((url) => {
      if (!sockets.has(url)) connect(url);
    });
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  const openSockets = () => [...sockets.entries()].filter(([, socket]) => socket.readyState === 1);

  const publish = async (envelope, tries = 0) => {
    const content = await seal(await keyReady, envelope);
    const event = { pubkey, created_at: nowSeconds(), kind: KIND, tags: [['t', topic]], content };
    event.id = bytesToHex(sha256(encoder.encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))));
    event.sig = bytesToHex(schnorr.sign(event.id, secret));
    remember(event.id);

    const frame = JSON.stringify(['EVENT', event]);
    const live = openSockets();
    const now = Date.now();
    const willing = live.filter(([url]) => stateOf(url).restUntil <= now);
    // When every relay is resting, try only the one closest to the end of its
    // rest, rather than spend every relay's allowance on refusals.
    const targets = willing.length
      ? willing
      : live.sort(([a], [b]) => stateOf(a).restUntil - stateOf(b).restUntil).slice(0, 1);

    if (targets.length) {
      pending.set(event.id, { envelope, tries, targets: new Set(targets.map(([url]) => url)), refused: new Set() });
      later(() => pending.delete(event.id), PENDING_FOR);
      targets.forEach(([, socket]) => socket.send(frame));
    } else if (backlog.length < 50) {
      backlog.push(frame);
    }
  };

  const queue = (envelope, tries) => {
    if (!closed) sending = sending.then(() => publish(envelope, tries)).catch(() => {});
  };

  // An event every relay refused (or dropped) reached nobody, so it goes out
  // again as a fresh event once some relay should be willing to take it.
  function refused(id, url) {
    const entry = pending.get(id);
    if (!entry || !entry.targets.has(url)) return;
    entry.refused.add(url);
    if (entry.refused.size < entry.targets.size) return;
    pending.delete(id);
    if (entry.tries >= RETRY_LIMIT) return;

    const now = Date.now();
    const rests = openSockets().map(([relay]) => stateOf(relay).restUntil - now);
    const soonest = rests.length ? Math.min(...rests) : 3000;
    later(() => queue(entry.envelope, entry.tries + 1), Math.min(15000, Math.max(800, soonest)));
  }

  return {
    ready,
    // Sealing is asynchronous, so sends are queued to leave in order.
    publish: (envelope) => queue(envelope, 0),
    // True when fewer than two relays can take events right now, so the
    // room should send less often until the rested ones recover.
    strained: () => {
      const live = openSockets();
      const healthy = live.filter(([url]) => stateOf(url).restUntil <= Date.now()).length;
      return healthy < Math.min(2, live.length) || healthy === 0;
    },
    close: () => {
      closed = true;
      clearTimeout(failTimer);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      sockets.forEach((socket) => {
        try {
          socket.close();
        } catch {
          // Already gone.
        }
      });
      sockets.clear();
    },
  };
};

// One event per tick carries every queued message. A newer board snapshot
// for the same recipient replaces one still waiting, since only the latest
// matters.
const makeOutbox = (pool, header, { tickCalm = TICK_CALM, tickBusy = TICK_BUSY } = {}) => {
  let queue = [];
  let timer = null;
  let last = 0;
  let lastSent = Date.now();

  const flush = () => {
    timer = null;
    if (!queue.length) return;
    last = Date.now();
    lastSent = last;
    const items = queue;
    queue = [];

    let batch = [];
    let size = 0;
    items.forEach((item) => {
      const length = JSON.stringify(item).length;
      if (batch.length && size + length > BATCH_CHARS) {
        pool.publish({ ...header(), items: batch });
        batch = [];
        size = 0;
      }
      batch.push(item);
      size += length;
    });
    pool.publish({ ...header(), items: batch });
  };

  let timerDue = 0;

  const schedule = (urgent) => {
    const tick = urgent ? Math.min(TICK_URGENT, tickCalm) : pool.strained() ? tickBusy : tickCalm;
    const due = Date.now() + Math.max(0, tick - (Date.now() - last));
    if (timer && timerDue <= due) return;
    clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(flush, due - Date.now());
  };

  return {
    push: (item) => {
      if (item.kind === 'msg' && item.payload?.t === 'game') {
        queue = queue.filter((entry) => !(entry.kind === 'msg' && entry.payload?.t === 'game' && entry.to === item.to));
      }
      queue.push(item);
      schedule(isUrgent(item));
    },
    // Sent at once, for a goodbye as the page closes.
    now: (item) => {
      clearTimeout(timer);
      timer = null;
      queue.push(item);
      flush();
    },
    idleFor: () => Date.now() - lastSent,
    stop: () => clearTimeout(timer),
  };
};

// ------------------------------------------------------------------ host

// Relays replay the last few seconds to a new subscriber, so every host run
// has its own session id. Guests echo it, and anything carrying another
// session's id (from before a reload) is ignored.
export const hostWithRelay = (code, handlers, options = {}) => {
  const guests = new Map(); // id -> last heard
  const session = randomId();
  let pool = null;

  const receive = (from, item) => {
    if (item.kind === 'probe') {
      outbox.push({ to: from, kind: 'here' });
      return;
    }

    if (guests.has(from)) guests.set(from, Date.now());

    if (item.kind === 'join') {
      const fresh = !guests.has(from);
      guests.set(from, Date.now());
      outbox.push({ to: from, kind: 'accepted' });
      if (fresh) handlers.onPeerOpen?.(from);
    } else if (item.kind === 'leave') {
      if (guests.delete(from)) handlers.onPeerClose?.(from);
    } else if (item.kind === 'msg' && guests.has(from)) {
      handlers.onMessage?.(from, item.payload);
    }
  };

  pool = openRelayPool(
    code,
    (data) => {
      if (!data || typeof data.from !== 'string' || data.from === 'host' || !Array.isArray(data.items)) return;
      data.items.forEach((item) => {
        if (item?.to !== 'host') return;
        if (item.kind !== 'probe' && (item.hs || data.hs) !== session) return;
        receive(data.from, item);
      });
    },
    options,
  );

  const outbox = makeOutbox(pool, () => ({ from: 'host', hs: session }), options);

  // Quiet rooms still say they are alive now and then; a guest that stays
  // silent long enough has closed its tab or lost signal.
  const watch = setInterval(() => {
    if (guests.size && outbox.idleFor() > QUIET_PING) outbox.push({ to: '*', kind: 'ping' });
    const cutoff = Date.now() - SILENT_FOR;
    guests.forEach((heard, id) => {
      if (heard < cutoff) {
        guests.delete(id);
        handlers.onPeerClose?.(id);
      }
    });
  }, 5000);

  const onUnload = () => outbox.now({ to: '*', kind: 'host-gone' });
  window.addEventListener('pagehide', onUnload);

  return {
    ready: pool.ready,
    owns: (peerId) => guests.has(peerId),
    send: (peerId, payload) => outbox.push({ to: peerId, kind: 'msg', payload }),
    broadcast: (payload) => {
      if (guests.size) outbox.push({ to: '*', kind: 'msg', payload });
    },
    kick: (peerId) => {
      guests.delete(peerId);
      outbox.push({ to: peerId, kind: 'host-gone' });
    },
    close: () => {
      clearInterval(watch);
      window.removeEventListener('pagehide', onUnload);
      onUnload();
      outbox.stop();
      setTimeout(() => pool.close(), 400);
    },
  };
};

// ----------------------------------------------------------------- guest

export const guestWithRelay = (code, handlers, options = {}) => {
  const id = randomId();
  let heard = Date.now();
  let joined = false;
  let hostSession = null;
  let gameSeq = 0;
  let probe = null;
  let watch = null;
  let findTimer = null;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const receive = (data, item) => {
    if (item.kind === 'here' && !joined) {
      outbox.push({ to: 'host', kind: 'join', hs: data.hs });
    } else if (item.kind === 'accepted' && !joined) {
      hostSession = data.hs;
      heard = Date.now();
      joined = true;
      clearInterval(probe);
      clearTimeout(findTimer);
      resolveReady();
    } else if (item.kind === 'msg' && joined) {
      // Relays can deliver a little out of order; a stale board is dropped.
      if (item.payload?.t === 'game') {
        const at = item.payload.sentAt || 0;
        if (at < gameSeq) return;
        gameSeq = at;
      }
      handlers.onMessage?.('host', item.payload);
    } else if (item.kind === 'host-gone' && joined) {
      handlers.onClose?.();
    }
  };

  const pool = openRelayPool(
    code,
    (data) => {
      if (!data || data.from !== 'host' || !Array.isArray(data.items)) return;
      if (joined && data.hs !== hostSession) return;
      if (joined) heard = Date.now();
      data.items.forEach((item) => {
        if (item && (item.to === id || item.to === '*')) receive(data, item);
      });
    },
    options,
  );

  // A join names the host session it answers; everything after carries the
  // session it was accepted into.
  const outbox = makeOutbox(pool, () => ({ from: id, hs: hostSession }), {
    tickCalm: options.tickCalm ?? GUEST_TICK_CALM,
    tickBusy: options.tickBusy ?? GUEST_TICK_BUSY,
  });

  pool.ready.then(
    () => {
      outbox.push({ to: 'host', kind: 'probe' });
      probe = setInterval(() => outbox.push({ to: 'host', kind: 'probe' }), PROBE_EVERY);
      findTimer = setTimeout(() => rejectReady(new Error('not-found')), options.findTimeout || FIND_TIMEOUT);
    },
    (error) => rejectReady(error),
  );

  ready.then(
    () => {
      watch = setInterval(() => {
        if (outbox.idleFor() > QUIET_PING) outbox.push({ to: 'host', kind: 'ping' });
        if (Date.now() - heard > SILENT_FOR) {
          clearInterval(watch);
          handlers.onClose?.();
        }
      }, 5000);
    },
    () => {},
  );

  const onUnload = () => outbox.now({ to: 'host', kind: 'leave' });
  window.addEventListener('pagehide', onUnload);

  return {
    ready,
    send: (payload) => joined && outbox.push({ to: 'host', kind: 'msg', payload }),
    close: () => {
      clearInterval(probe);
      clearInterval(watch);
      clearTimeout(findTimer);
      window.removeEventListener('pagehide', onUnload);
      if (joined) onUnload();
      outbox.stop();
      setTimeout(() => pool.close(), 400);
    },
  };
};

// For the connection check: can this device reach any relay at all?
export const canReachRelay = async (options) => {
  const pool = openRelayPool('CHECK0', () => {}, options);
  try {
    await pool.ready;
    return true;
  } catch {
    return false;
  } finally {
    pool.close();
  }
};

// For the connection check: every relay is sent one sealed event on a
// throwaway topic and timed until it comes back. Shows which relays this
// network and device can actually use, and how fast they are.
export const probeRelays = (urls = relayUrls(), { Socket = window.WebSocket, timeout = 7000 } = {}) =>
  Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          const host = url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
          const secret = schnorr.utils.randomPrivateKey();
          const pubkey = bytesToHex(schnorr.getPublicKey(secret));
          const topic = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
          let socket;
          let sentAt = 0;
          let done = false;

          const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              socket?.close();
            } catch {
              // Already gone.
            }
            resolve({ host, ...result });
          };
          const timer = setTimeout(() => finish({ ok: false, reason: sentAt ? 'no echo' : 'unreachable' }), timeout);

          try {
            socket = new Socket(url);
          } catch {
            finish({ ok: false, reason: 'unreachable' });
            return;
          }

          socket.onopen = () => {
            socket.send(JSON.stringify(['REQ', 'probe', { kinds: [KIND], '#t': [topic], since: nowSeconds() - 30 }]));
            const event = { pubkey, created_at: nowSeconds(), kind: KIND, tags: [['t', topic]], content: 'probe' };
            event.id = bytesToHex(sha256(encoder.encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))));
            event.sig = bytesToHex(schnorr.sign(event.id, secret));
            sentAt = Date.now();
            socket.send(JSON.stringify(['EVENT', event]));
          };
          socket.onmessage = ({ data }) => {
            try {
              const frame = JSON.parse(data);
              if (frame[0] === 'EVENT' && frame[2]?.pubkey === pubkey) finish({ ok: true, ms: Date.now() - sentAt });
              else if (frame[0] === 'OK' && frame[2] === false) finish({ ok: false, reason: RATE_LIMITED.test(frame[3]) ? 'rate limited' : 'refused' });
            } catch {
              // Ignore.
            }
          };
          socket.onerror = () => finish({ ok: false, reason: 'unreachable' });
        }),
    ),
  );
