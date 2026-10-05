// A quick look at what this device's network allows, so a player who cannot
// join learns why and what to try. The checks run side by side:
//   service  can the PeerJS room service be reached
//   direct   can WebRTC find a public route (STUN) or a TURN relay
//   turn     can it reach a TURN relay in particular
//   relay    how many websocket relays echo a test event back, and how fast
// Each resolves to 'ok', 'limited' or 'blocked'.

import Peer from 'peerjs';
import { probeRelays } from './relayTransport';
import { iceServers, transportKind } from './roomTransport';

const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

const checkService = () =>
  new Promise((resolve) => {
    let peer;

    try {
      peer = new Peer({ debug: 0 });
    } catch {
      resolve('blocked');
      return;
    }

    const done = (result) => {
      peer.destroy();
      resolve(result);
    };

    peer.on('open', () => done('ok'));
    peer.on('error', () => done('blocked'));
    setTimeout(() => done('blocked'), 6000);
  });

// Gathers ICE candidates: a public (srflx) or relay candidate means a direct
// link can be made, only local (host) candidates mean it most likely cannot.
const checkDirect = () =>
  new Promise((resolve) => {
    if (typeof RTCPeerConnection !== 'function') {
      resolve({ direct: 'blocked', turn: 'blocked' });
      return;
    }

    const found = new Set();
    let connection;

    try {
      connection = new RTCPeerConnection({ iceServers: iceServers() });
    } catch {
      resolve({ direct: 'blocked', turn: 'blocked' });
      return;
    }

    const finish = () => {
      connection.close();
      resolve({
        direct: found.has('srflx') || found.has('relay') ? 'ok' : found.size ? 'limited' : 'blocked',
        turn: found.has('relay') ? 'ok' : 'blocked',
      });
    };

    connection.onicecandidate = ({ candidate }) => {
      if (!candidate) {
        finish();
        return;
      }

      const type = candidate.type || / typ (\w+)/.exec(candidate.candidate)?.[1];
      if (type) found.add(type);
    };

    connection.createDataChannel('check');
    connection
      .createOffer()
      .then((offer) => connection.setLocalDescription(offer))
      .catch(() => resolve({ direct: 'blocked', turn: 'blocked' }));
    setTimeout(finish, 6000);
  });

export const runConnectionCheck = async () => {
  if (transportKind() === 'local') {
    return { service: 'ok', direct: 'ok', turn: 'ok', relay: 'ok', relays: [] };
  }

  const [service, ice, relays] = await Promise.all([
    withTimeout(checkService(), 7000, 'blocked'),
    withTimeout(checkDirect(), 7000, { direct: 'blocked', turn: 'blocked' }),
    probeRelays(),
  ]);
  const working = relays.filter((entry) => entry.ok).length;
  // Relay needs a couple of servers so that one resting after a rate limit
  // leaves another to carry the game.
  const relay = working >= 2 ? 'ok' : working === 1 ? 'limited' : 'blocked';

  return { service, ...ice, relay, relays };
};

// Plain advice for the result, in the order a player should act on it.
export const checkVerdict = ({ service, direct, relay }) => {
  if (service === 'ok' && direct === 'ok') {
    return relay === 'blocked'
      ? 'Your connection is ready for direct play, friends on strict networks may not reach you through Relay'
      : 'Your connection is ready, you can host and join directly, with Relay as a backup';
  }

  if (relay === 'limited') {
    return 'Your network blocks direct links and only one relay answered, the game can run but may lag, mobile data or a hotspot will be smoother';
  }

  if (relay === 'ok') {
    return 'Your network blocks direct links, Manapally switches to Relay by itself so you can still play';
  }

  return 'This network blocks every game route, switch to mobile data or a hotspot, turn off any VPN or ad blocking DNS and try again';
};
