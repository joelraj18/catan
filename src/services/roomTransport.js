// Message transports for private rooms.
//
// `peer` uses PeerJS: WebRTC data channels between browsers, introduced by the
// free public PeerJS signalling server, so a static site on GitHub Pages needs
// no backend of its own. Game traffic flows directly between players.
//
// `relay` (services/relayTransport.js) carries messages through public relays
// over secure websockets on port 443, for networks that block WebRTC or the
// PeerJS server. A host listens on both at once; a guest tries Direct first
// and moves to Relay when Direct is blocked or slow. ?net=relay forces it.
//
// `local` uses a BroadcastChannel, which links tabs of the same browser. It
// powers automated tests and works offline. Add ?net=local to the URL to use it.
//
// Both expose the same small interface:
//   host:  { ready, send(peerId, msg), broadcast(msg), kick(peerId), close() }
//   guest: { ready, send(msg), close() }
// with callbacks onPeerOpen(peerId), onMessage(peerId, msg), onPeerClose(peerId),
// onClose() and onError(code).

import Peer from 'peerjs';
import { guestWithRelay, hostWithRelay } from './relayTransport';

const ID_PREFIX = 'catan-room-';
const CONNECT_TIMEOUT = 15000;
const DIRECT_GRACE = 7000;
const ROUTE_KEY = 'catan-route';

export const transportKind = () => {
  try {
    const net = new URLSearchParams(window.location.search).get('net');
    return net === 'local' || net === 'relay' ? net : 'peer';
  } catch {
    return 'peer';
  }
};

// STUN finds each browser's public address; TURN relays the data when the
// two cannot reach each other. A TURN service on port 443 (for example a free
// Metered or Cloudflare account) can be added at build time through
// REACT_APP_TURN_URLS, REACT_APP_TURN_USERNAME and REACT_APP_TURN_CREDENTIAL.
export const iceServers = () => {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs',
      credential: 'peerjsp',
    },
  ];
  const extra = (process.env.REACT_APP_TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);

  if (extra.length) {
    servers.push({
      urls: extra,
      username: process.env.REACT_APP_TURN_USERNAME || '',
      credential: process.env.REACT_APP_TURN_CREDENTIAL || '',
    });
  }

  return servers;
};

const peerOptions = () => ({ debug: 0, config: { iceServers: iceServers() } });

// The route that worked last time is tried first next time.
export const savedRoute = () => {
  try {
    return window.localStorage.getItem(ROUTE_KEY) === 'relay' ? 'relay' : 'direct';
  } catch {
    return 'direct';
  }
};

const saveRoute = (route) => {
  try {
    window.localStorage.setItem(ROUTE_KEY, route);
  } catch {
    // Private windows may block storage.
  }
};

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ PeerJS

const peerErrorCode = (error) => {
  switch (error?.type) {
    case 'unavailable-id':
      return 'code-taken';
    case 'peer-unavailable':
      return 'not-found';
    case 'browser-incompatible':
      return 'unsupported';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'blocked';
    default:
      return 'network';
  }
};

const hostWithPeer = (code, handlers) => {
  const peer = new Peer(`${ID_PREFIX}${code.toLowerCase()}`, peerOptions());
  const connections = new Map();

  const ready = new Promise((resolve, reject) => {
    peer.on('open', () => resolve());
    peer.on('error', (error) => {
      const reason = peerErrorCode(error);
      reject(new Error(reason));
      handlers.onError?.(reason);
    });
  });

  peer.on('connection', (connection) => {
    connection.on('open', () => {
      connections.set(connection.peer, connection);
      handlers.onPeerOpen?.(connection.peer);
    });
    connection.on('data', (data) => handlers.onMessage?.(connection.peer, data));
    connection.on('close', () => {
      connections.delete(connection.peer);
      handlers.onPeerClose?.(connection.peer);
    });
    connection.on('error', () => {});
  });

  peer.on('disconnected', () => {
    // Lost the signalling server; existing data channels keep working, but
    // reconnecting lets new friends still find the room.
    if (!peer.destroyed) {
      peer.reconnect();
    }
  });

  return {
    ready,
    owns: (peerId) => connections.has(peerId),
    send: (peerId, message) => connections.get(peerId)?.send(message),
    broadcast: (message) => connections.forEach((connection) => connection.send(message)),
    kick: (peerId) => connections.get(peerId)?.close(),
    close: () => peer.destroy(),
  };
};

const guestWithPeer = (code, handlers) => {
  const peer = new Peer(peerOptions());
  let connection = null;

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT);

    peer.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(peerErrorCode(error)));
    });

    peer.on('open', () => {
      connection = peer.connect(`${ID_PREFIX}${code.toLowerCase()}`, {
        reliable: true,
        serialization: 'json',
      });
      connection.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      connection.on('data', (data) => handlers.onMessage?.('host', data));
      connection.on('close', () => handlers.onClose?.());
      connection.on('error', () => {});
    });
  });

  return {
    ready,
    send: (message) => connection?.open && connection.send(message),
    close: () => peer.destroy(),
  };
};

// -------------------------------------------------------- BroadcastChannel

// Posting on a channel that has been closed throws, and a transport may be
// closed more than once (a failed reconnect closes it, then the next try
// does again), so every post goes through this guard.
const safeChannel = (name) => {
  const channel = new BroadcastChannel(name);
  let closed = false;

  return {
    set onmessage(fn) {
      channel.onmessage = fn;
    },
    post(message) {
      if (!closed) {
        channel.postMessage(message);
      }
    },
    close() {
      closed = true;
      channel.close();
    },
    get closed() {
      return closed;
    },
  };
};

const hostWithChannel = (code, handlers) => {
  const channel = safeChannel(`${ID_PREFIX}${code}`);
  const guests = new Set();

  channel.onmessage = ({ data }) => {
    if (!data || data.to !== 'host') {
      return;
    }

    if (data.kind === 'probe') {
      channel.post({ to: data.from, kind: 'here' });
    } else if (data.kind === 'join') {
      guests.add(data.from);
      channel.post({ to: data.from, kind: 'accepted' });
      handlers.onPeerOpen?.(data.from);
    } else if (data.kind === 'leave') {
      guests.delete(data.from);
      handlers.onPeerClose?.(data.from);
    } else if (data.kind === 'msg' && guests.has(data.from)) {
      handlers.onMessage?.(data.from, data.payload);
    }
  };

  const onUnload = () => channel.post({ to: '*', kind: 'host-gone' });
  window.addEventListener('pagehide', onUnload);

  return {
    ready: Promise.resolve(),
    send: (peerId, payload) => channel.post({ to: peerId, kind: 'msg', payload }),
    broadcast: (payload) => guests.forEach((id) => channel.post({ to: id, kind: 'msg', payload })),
    kick: (peerId) => {
      guests.delete(peerId);
      channel.post({ to: peerId, kind: 'host-gone' });
    },
    close: () => {
      if (channel.closed) return;
      onUnload();
      window.removeEventListener('pagehide', onUnload);
      channel.close();
    },
  };
};

const guestWithChannel = (code, handlers) => {
  const channel = safeChannel(`${ID_PREFIX}${code}`);
  const id = randomId();

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('not-found')), 2500);

    channel.onmessage = ({ data }) => {
      if (!data || (data.to !== id && data.to !== '*')) {
        return;
      }

      if (data.kind === 'here') {
        channel.post({ to: 'host', from: id, kind: 'join' });
      } else if (data.kind === 'accepted') {
        clearTimeout(timer);
        resolve();
      } else if (data.kind === 'msg') {
        handlers.onMessage?.('host', data.payload);
      } else if (data.kind === 'host-gone') {
        handlers.onClose?.();
      }
    };

    channel.post({ to: 'host', from: id, kind: 'probe' });
  });

  const onUnload = () => channel.post({ to: 'host', from: id, kind: 'leave' });
  window.addEventListener('pagehide', onUnload);

  return {
    ready,
    send: (payload) => channel.post({ to: 'host', from: id, kind: 'msg', payload }),
    close: () => {
      if (channel.closed) return;
      onUnload();
      window.removeEventListener('pagehide', onUnload);
      channel.close();
    },
  };
};

// ------------------------------------------------------------ the ladder

// The host listens on Direct and Relay together, so a friend on any network
// finds the room. It is ready as soon as either route is up, which keeps a
// host on a locked down network online through Relay.
const hostOnEveryRoute = (code, handlers) => {
  const routes = { direct: 'trying', relay: 'trying' };
  const report = () => handlers.onRoutes?.({ ...routes });
  const relay = hostWithRelay(code, handlers);
  let direct = null;
  let closed = false;
  let opened = false;

  const ready = new Promise((resolve, reject) => {
    let relayFailed = null;
    let directFailed = null;
    const up = () => {
      opened = true;
      resolve();
    };
    const bothFailed = () => directFailed && relayFailed && reject(directFailed);

    // After a reload the old room name can stay taken for a few seconds. When
    // Relay already has the room open, Direct keeps trying in the background.
    const openDirect = (attempt) => {
      direct = hostWithPeer(code, { ...handlers, onError: () => {} });
      direct.ready.then(
        () => {
          routes.direct = 'up';
          report();
          up();
        },
        (error) => {
          if (error.message === 'code-taken' && opened && attempt < 6 && !closed) {
            direct.close();
            setTimeout(() => !closed && openDirect(attempt + 1), 3000);
            return;
          }
          routes.direct = 'blocked';
          report();
          if (error.message === 'code-taken' && !opened) {
            reject(error);
            return;
          }
          directFailed = error;
          bothFailed();
        },
      );
    };

    openDirect(0);
    relay.ready.then(
      () => {
        routes.relay = 'up';
        report();
        up();
      },
      (error) => {
        routes.relay = 'blocked';
        report();
        relayFailed = error;
        bothFailed();
      },
    );
  });

  const owner = (peerId) => (relay.owns(peerId) ? relay : direct);

  return {
    ready,
    routeOf: (peerId) => (relay.owns(peerId) ? 'relay' : 'direct'),
    send: (peerId, message) => owner(peerId).send(peerId, message),
    broadcast: (message) => {
      direct.broadcast(message);
      relay.broadcast(message);
    },
    kick: (peerId) => owner(peerId).kick(peerId),
    close: () => {
      closed = true;
      direct.close();
      relay.close();
    },
  };
};

// A guest tries the route that worked last time, and if it fails or is still
// not open after a few seconds, starts the other one alongside. The first to
// open wins and the other is closed, so the host only ever sees one hello.
const guestOnBestRoute = (code, handlers, { mode = 'auto' } = {}) => {
  const order = mode === 'relay' ? ['relay'] : mode === 'direct' ? ['direct'] : savedRoute() === 'relay' ? ['relay', 'direct'] : ['direct', 'relay'];
  const make = { direct: guestWithPeer, relay: guestWithRelay };
  const started = [];
  let winner = null;
  let closed = false;

  const ready = new Promise((resolve, reject) => {
    const errors = {};
    let graceTimer = null;

    const settleFailure = () => {
      if (winner || Object.keys(errors).length < order.length) return;
      // A room missing on Direct may still be open on Relay, so the most
      // useful reason wins: no room, then a blocked network.
      const reasons = Object.values(errors);
      reject(new Error(reasons.includes('not-found') ? 'not-found' : reasons.includes('blocked') ? 'blocked' : reasons[0]));
    };

    const start = (route) => {
      if (closed || winner || started.some((entry) => entry.route === route)) return;
      handlers.onStage?.(route);

      const transport = make[route](code, {
        onMessage: (...args) => winner?.transport === transport && handlers.onMessage?.(...args),
        onClose: () => winner?.transport === transport && handlers.onClose?.(),
      });
      started.push({ route, transport });

      transport.ready.then(
        () => {
          if (winner || closed) {
            transport.close();
            return;
          }
          clearTimeout(graceTimer);
          winner = { route, transport };
          saveRoute(route);
          started.filter((entry) => entry.transport !== transport).forEach((entry) => entry.transport.close());
          resolve();
        },
        (error) => {
          errors[route] = error.message === 'timeout' ? 'not-found' : error.message;
          const next = order[order.indexOf(route) + 1];
          if (next) start(next);
          settleFailure();
        },
      );
    };

    start(order[0]);
    if (order[1]) {
      graceTimer = setTimeout(() => start(order[1]), DIRECT_GRACE);
    }
  });

  return {
    ready,
    get route() {
      return winner?.route || null;
    },
    send: (message) => winner?.transport.send(message),
    close: () => {
      closed = true;
      started.forEach((entry) => entry.transport.close());
    },
  };
};

export const openHostTransport = (code, handlers) => {
  const kind = transportKind();
  if (kind === 'local') {
    setTimeout(() => handlers.onRoutes?.({ direct: 'up', relay: 'off' }), 0);
    return { ...hostWithChannel(code, handlers), routeOf: () => 'direct' };
  }
  if (kind === 'relay') {
    const relay = hostWithRelay(code, handlers);
    relay.ready.then(
      () => handlers.onRoutes?.({ direct: 'off', relay: 'up' }),
      () => handlers.onRoutes?.({ direct: 'off', relay: 'blocked' }),
    );
    return { ...relay, routeOf: () => 'relay' };
  }
  return hostOnEveryRoute(code, handlers);
};

export const openGuestTransport = (code, handlers, options = {}) => {
  const kind = transportKind();
  if (kind === 'local') return { ...guestWithChannel(code, handlers), route: 'local' };
  return guestOnBestRoute(code, handlers, kind === 'relay' ? { mode: 'relay' } : options);
};
