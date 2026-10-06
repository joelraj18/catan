// A tiny Cloudflare Worker that hands the Catan app short-lived TURN
// credentials from Cloudflare Realtime TURN (1,000 GB a month free). The
// API token stays here, in the Worker's secrets; the app only ever sees
// credentials that expire.
//
// Set up (all on the free plan):
// 1. In the Cloudflare dashboard, open Realtime > TURN Server and create a
//    TURN key. Note its Key ID and API token.
// 2. Create a Worker with this file, then add three settings under the
//    Worker's Settings > Variables and Secrets:
//      TURN_KEY_ID          the Key ID (a plain variable)
//      TURN_KEY_API_TOKEN   the API token (a secret)
//      ALLOWED_ORIGINS      your site, e.g. https://you.github.io
// 3. Build the app with REACT_APP_TURN_ENDPOINT set to the Worker's URL.

const TTL_SECONDS = 12 * 3600;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((entry) => entry.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (allowed.length && !allowed.includes(origin)) return new Response('Forbidden', { status: 403, headers: cors });

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );

    return new Response(await response.text(), {
      status: response.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
