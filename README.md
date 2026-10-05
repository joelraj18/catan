# Manapally

A property trading board game set in Andhra Pradesh and Telangana, played in the browser with friends, computer opponents or premium AI opponents.

## How players connect

Manapally is a static site with no backend. The host's browser runs the match. Friends reach it in one of two ways:

- **Direct.** A WebRTC data channel between the browsers, introduced by the public PeerJS signalling server. This is the fastest route.
- **Relay.** Messages go through public Nostr relays over secure websockets on port 443, the same port as ordinary websites. College, office and VPN networks that block WebRTC or the PeerJS server usually allow this. Every message is encrypted with AES GCM under a key derived from the room code, and is sent as an ephemeral event that relays forward without storing.

Public relays are free and shared, and some cap how often one address may post. Damus, for example, allows about eight events a minute by default. Relay is built for that:

- Each side sends at most one event per tick, roughly every 0.9 s for the host and 0.25 s for a guest. The event carries everything queued, and only the newest board snapshot is kept. A two player game sends about 50 events a minute from the host and 15 from a guest, each about 2 KB.
- Joining steps skip the tick, so a friend joins in about two seconds.
- A relay that answers "rate limited" rests for 20 s and the others carry the room. A relay that needs payment or login is dropped.
- An event every relay refused is sent again, so no move or message is lost.
- When fewer than two relays are willing, the tick stretches to 2.5 s. The game slows down rather than stalls.
- Device clocks are corrected from the site's Date header, because relays refuse short lived events more than a minute old.

In tests with relays capped at 20 events a minute, games stayed in sync at about half normal speed.

The host listens on both routes at once. A guest in Auto mode tries Direct first, falls back to Relay when Direct is blocked or slow, and remembers which route worked. Under **Having trouble joining** in the lobby, players can pick a route by hand and run a connection check.

### Optional TURN server, recommended for college networks

A TURN server on port 443 lets Direct work on networks that block WebRTC, so play stays as quick as on home wifi. To set one up:

1. Create a free account at metered.ca. The free plan includes a monthly TURN allowance, far more than games need, since each one uses a few MB.
2. Under TURN Server, create a credential. Copy the `turns:` URL on port 443 (TCP) and the username and password.
3. Put them in a `.env` file in the project root, then run `npm run deploy`:

```
REACT_APP_TURN_URLS=turns:example.turn.server:443?transport=tcp
REACT_APP_TURN_USERNAME=...
REACT_APP_TURN_CREDENTIAL=...
```

These are ICE relay credentials, not secrets, and they are served to every visitor. A provider that issues only short lived credentials, such as Cloudflare, needs a small backend to mint them and does not fit this static site.

**Check connection** in the lobby shows whether the TURN route is open. It also lists every relay with its round trip time, so you can see what a given network allows.

### Testing switches

- `?net=local` uses a BroadcastChannel between tabs of one browser, for automated tests.
- `?net=relay` forces Relay.
- `?relay=wss://a,wss://b` replaces the relay list, for example with a local test relay.
- `?join=CODE` opens the lobby with the room code filled in. Invite links use this.

## Scripts

- `npm start` runs the development server.
- `npm test` runs the unit tests.
- `npm run build` builds the site, and `npm run deploy` publishes it to GitHub Pages.
