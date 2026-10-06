# Catan

Catan in the browser: settle the island, trade resources and build your way to 10 victory points. For 3 to 4 players, with friends, computer opponents or premium AI opponents. An unofficial fan edition following the 5th edition rules (Game Rules & Almanac, 2020).

## The game

- **Boards.** The host picks the beginners' map from the rulebook (Illustration A, with every starting settlement and road placed and starting resources dealt), or a random island: shuffled terrain, number tokens with no two red numbers (6 and 8) side by side, shuffled harbours, and a two round snake set-up.
- **A turn.** Roll for production (settlements 1 card, cities 2, nothing under the robber, the bank shortage rule applies), then trade and build in any order. A 7 makes everyone with more than 7 cards discard half (rounded down); the roller moves the robber and steals a random card.
- **Trading.** Domestic trades only with the player whose turn it is (offers to one player or the whole table, counter offers from the others), no gifts and no like for like. Maritime trade at 4:1, 3:1 with a generic harbour or 2:1 with a special harbour.
- **Building.** Road (brick, lumber), settlement (brick, lumber, wool, grain) with the Distance Rule, city (3 ore, 2 grain), development card (ore, wool, grain). Each player has 15 roads, 5 settlements and 4 cities.
- **Development cards.** 14 knights, 2 Road Building, 2 Year of Plenty, 2 Monopoly and 5 victory points. One card per turn, never one bought that turn; victory point cards count straight away.
- **Special cards.** Longest Road (5+ continuous roads, broken by an opponent's settlement, with the Almanac's tie rules) and Largest Army (3+ knights), 2 points each.
- **Winning.** The first player with 10 or more points during their own turn wins.

Each player only receives their own hand and development cards; others see counts. Dice use the browser's cryptographic random generator.

## How the premium AI plays

Premium AI seats use the host's own Claude API key, held only in the tab's memory, and are built to make few, small requests:

- **The heuristic ranks, Claude decides.** The computer strategy lists every legal move, best first. Claude is asked only where it changes the game: the two starting settlements, **one plan per turn** (an ordered list of builds, card plays and bank trades, then end turn), the robber when the best hexes score within 20% of each other, and trade offers from a person when their value is unclear, or from anyone close to winning. Everything else, including turns with fewer than two real options, is played by the strategy for free.
- **Small, cached prompts.** The rules and the game's board form a fixed system prefix with a cache breakpoint, so after the first request they are read from the prompt cache. Each request then adds only a few compact lines (own hand, opponents' visible points and card counts, robber, last events) and a numbered option list. One JSON schema (`{plan, comment}`) is used for every decision at low effort, so the prefix never changes.
- **Hidden information stays hidden.** The prompt is built from the seat's redacted view: its own cards only.
- **Budget and fallback.** Each AI seat makes at most 40 requests per game (`AI_CALL_BUDGET`), and its calls and tokens appear under its name. Errors, refusals, timeouts or a spent budget fall back to the computer's choice.

## Code map

- `src/pages/Game/catanBoard.js` hex geometry (19 hexes, 54 intersections, 72 paths), the beginners' map and the random map
- `src/pages/Game/catanRules.js` the rules as pure functions, including what each seat may see
- `src/pages/Game/catanEngine.js` the host's game engine: phases, turns, trades, timers, computer moves
- `src/pages/Game/catanBot.js` computer opponents
- `src/pages/Game/hexArt.jsx` the island drawn in SVG, `BoardGame.jsx` the game screen
- `src/services/premiumAi.js` premium AI opponents with the player's own Claude API key

## How players connect

Catan is a static site with no backend. The host's browser runs the match. Friends reach it in one of two ways:

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
- `npm test` runs the unit tests, including a rules audit that plays complete computer games and checks every snapshot.
- `npm run build` builds the site, and `npm run deploy` publishes it to GitHub Pages.
