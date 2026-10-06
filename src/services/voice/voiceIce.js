// Where voice finds its way through: the room's STUN and TURN servers, plus
// free TURN relays that also answer on port 443 over TLS, which looks like
// ordinary HTTPS to a firewall, so audio gets through college and office
// networks that block everything else:
// - Metered's Open Relay (20 GB a month free) with time-limited credentials
//   from its public static-auth secret (the coturn REST scheme: the user
//   name is an expiry time, the password its HMAC-SHA1 under the secret);
// - optionally Cloudflare Realtime TURN (1,000 GB a month free), when the
//   build names a credentials endpoint in REACT_APP_TURN_ENDPOINT, such as
//   the small Cloudflare Worker in workers/turn-credentials.js. The
//   Cloudflare API token stays in that Worker, never in this app.
import { iceServers } from '../roomTransport';

const OPEN_RELAY_HOST = 'staticauth.openrelay.metered.ca';
const OPEN_RELAY_SECRET = 'openrelayprojectsecret';
const CREDENTIAL_HOURS = 12;

const toBase64 = (bytes) => {
  let text = '';
  new Uint8Array(bytes).forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return btoa(text);
};

// The coturn REST API credential for a user name: base64(HMAC-SHA1(secret, name)).
export const restCredential = async (secret, username) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(username)));
};

const openRelay = async () => {
  const username = `${Math.floor(Date.now() / 1000) + CREDENTIAL_HOURS * 3600}:catan`;
  const credential = await restCredential(OPEN_RELAY_SECRET, username);
  return {
    urls: [
      `turn:${OPEN_RELAY_HOST}:80`,
      `turn:${OPEN_RELAY_HOST}:80?transport=tcp`,
      `turn:${OPEN_RELAY_HOST}:443`,
      `turns:${OPEN_RELAY_HOST}:443?transport=tcp`,
    ],
    username,
    credential,
  };
};

const fromEndpoint = async () => {
  const endpoint = process.env.REACT_APP_TURN_ENDPOINT;
  if (!endpoint) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const body = await response.json();
    const servers = body.iceServers || body;
    return Array.isArray(servers) ? servers : [servers];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
};

let cached = null;

// Built once per page and refreshed after a few hours.
export const voiceIceServers = async () => {
  if (cached && cached.until > Date.now()) return cached.servers;
  const [relay, extra] = await Promise.all([openRelay().catch(() => null), fromEndpoint()]);
  const servers = [...iceServers(), ...(relay ? [relay] : []), ...extra];
  cached = { servers, until: Date.now() + 4 * 3600 * 1000 };
  return servers;
};
