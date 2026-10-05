# MANAPALLY — AI Engineering Context

## Purpose

MANAPALLY is an original, premium South Indian online strategy board game built in an existing React codebase. This document is the operating context for an AI engineer continuing that codebase. It defines how to work safely, the product direction, and the intended gameplay systems. It is not a request to rebuild the application.

**Primary product subtitle:** `Premium South Indian Strategy Board Game`

Use the subtitle consistently in primary product marketing contexts (such as the landing-page hero) unless a task supplies replacement copy. It is concise, professional, and should be supported by a short explanatory sentence rather than a long slogan.

## Non-negotiable working protocol

1. Treat the repository as an existing product, not a starter project.
2. Inspect the repository before editing: read the package scripts, app entry points, routing, game-state/data modules, component structure, styling system, asset conventions, and any existing instructions.
3. The repository and its current game data are the source of truth. Do not replace property names, board-space data, prices, copy, or other game content unless the user explicitly supplies the exact change.
4. Preserve the architecture, conventions, dependencies, public interfaces, and working behavior. Prefer small, focused edits to existing modules over new parallel systems.
5. Do not rewrite whole files, replace the app shell, migrate frameworks, add a design system, change build tooling, or refactor unrelated code merely for style.
6. Before changing code, identify the exact files that need edits and the files that must remain untouched. If a requested change would require an architectural decision or conflicts with existing behavior, explain the conflict and request direction.
7. Keep changes incremental, coherent, and easy to review. Reuse existing components, state patterns, utilities, CSS tokens, and assets whenever possible.
8. Run the available lint, type-check, test, and/or production build checks after implementation. Fix issues caused by the change. Report any checks that cannot be run and why.

## Approved target architecture

First inspect and preserve the repository’s actual architecture. The structure below is the approved target organization for new work or deliberate, justified consolidation—not permission to create empty directories, mechanically move files, or rewrite a working application.

```text
src/
├── assets/
│   ├── backgrounds/
│   ├── board/
│   ├── cards/
│   ├── icons/
│   ├── logo/
│   ├── music/
│   ├── sounds/
│   ├── textures/
│   ├── tokens/
│   └── videos/
├── components/
├── context/
├── hooks/
├── pages/
│   ├── Home/
│   ├── Lobby/
│   ├── Game/
│   ├── Profile/
│   └── Settings/
├── services/
├── utils/
├── styles/
└── Game.jsx
```

Architecture responsibilities:

- `assets/` contains product-owned visual and audio media, grouped by purpose. `textures/` and `videos/` are approved additions when an actual asset needs them.
- `components/` holds reusable, presentation-focused UI primitives and composition components; page-specific logic stays with its page unless reuse is established.
- `context/` contains shared app/game state only when context is the existing or appropriate state pattern; do not make context a dumping ground.
- `hooks/` contains reusable behavior and state orchestration hooks.
- `pages/` owns route-level screens: Home, Lobby, Game, Profile, and Settings.
- `services/` owns boundary integrations and shared side-effect systems, such as audio playback, multiplayer/networking, persistence, and API adapters.
- `utils/` contains pure reusable helpers, including data transformations and game calculations that do not need React.
- `styles/` contains global tokens, resets, fonts, shared animation definitions, and other global styling only. Keep component/page styles colocated where that matches the existing codebase.
- `Game.jsx` remains a compatibility/entry composition point only if it already serves that purpose; do not duplicate the page architecture around it.

## Delivery order and quality bar

Do not rush into the board simply because its data is available. Deliver a complete product experience in this order unless the user explicitly changes priorities:

1. **Sprint 1 — Landing experience:** loading screen, landing page, background, navigation, hero, reusable buttons/cards, footer, responsive styling, and motion.
2. **Sprint 2 — Player entry:** login or guest name, profile selection, multiplayer lobby, create/join room, and settings.
3. **Sprint 3 — Game:** board, dice, districts, turn state, movement animations, audio hooks, and game rules.

Every implemented component must be production-quality, reusable where appropriate, responsive, accessible, and connected to real behavior or an intentional interface. Do not add placeholder-only components or empty folders merely to satisfy the target structure.

### Sprint 1 component contracts

Implement these in this order when Sprint 1 is requested, adapting filenames and imports to the repository’s established conventions:

1. `Game.jsx` — compose the relevant app/page experience without becoming a monolithic state container.
2. `BackgroundEffects.jsx` — background visuals only: animated emerald gradient, marble-texture overlay, dark vignette, soft radial light, and restrained gold ambient glow. No text, controls, or business logic.
3. `FloatingParticles.jsx` — only subtle particles (approximately 20–30) with randomized horizontal position, delay, duration, opacity, and slow floating motion. Respect reduced-motion preferences.
4. `Navbar.jsx` — a minimal, elegant, near-transparent navigation with MANAPALLY, Home, Roadmap, About, GitHub, and a clear Play action. Use real routes/links where available; do not add dead navigation without making its intent clear.
5. `Hero.jsx` — title, the primary product subtitle, one concise supporting sentence, two calls to action, and a small `In Active Development` status badge.
6. `GoldButton.jsx` — one reusable button primitive with default, hover, active, disabled, loading, variant, and optional-icon support. Its public API should be stable enough for future expansion.
7. `FeatureCard.jsx` — prop-driven and reusable. Initial content: Multiplayer, Original Districts, Premium Design, Strategic Gameplay. Use SVG/icon components where available; do not rely on decorative emoji. On hover, lift subtly with a soft gold glow.
8. `Footer.jsx` — Version 0.1, Made with React, © 2026 Manapally, and GitHub; leave a clean path for future Privacy, Terms, and Credits links.
9. `LoadingScreen.jsx` — black background; gold coin or monogram fade-in; MANAPALLY reveal; animated loading indicator; controlled fade into the landing page. Never block the app indefinitely if assets fail.
10. Styling — create or extend the applicable game, hero, navigation, and animation CSS modules/files. Keep global styles limited to shared foundations.

The Sprint 1 result should feel like a premium, responsive, animated game landing experience: emerald atmosphere, restrained gold particles, a refined hero panel, premium buttons, and a polished loading transition. “AAA-style” here means deliberate quality and finish, not visual clutter or heavy effects.

## Product identity and originality

The game should feel like **royal South Indian luxury**: refined, warm, ceremonial, strategic, and tactile. It may draw broad inspiration from property-management board games, but must remain an original product.

Do not copy another game’s board layout, space sequence, rules text, card text, tokens, currency treatment, logos, artwork, UI composition, or protected visual identity. Create original terminology and presentation only when explicitly requested; otherwise preserve existing project content.

## Visual and interaction design system

Aim for a polished, calm, high-value tabletop experience:

- Rich, deep backgrounds such as charcoal, indigo, teak, or near-black; avoid flat generic dashboards.
- Warm royal accents: antique gold, brass, ivory, sandalwood, muted emerald, ruby, and saffron used sparingly.
- Strong contrast and readable type at every board scale. Decorative display type may be used for headings; game information must remain highly legible.
- Fine borders, subtle engraved/printed texture, restrained shadows, and deliberate spacing. The board should feel crafted, not glossy or busy.
- Motion should be brief, purposeful, and accessible. Respect reduced-motion preferences where the project supports them.
- Avoid neon, casino visual language, cartoonish clip art, excessive gradients, excessive glassmorphism, and generic component-library styling.
- Maintain responsive behavior and keyboard/touch usability; do not trade functional clarity for ornament.

Use existing color tokens, typography, components, and CSS architecture where present. Extend them consistently rather than introducing a disconnected visual layer.

## Game and economy direction

The economy should be easy to understand, strategically meaningful, and balanced around the game’s actual board size and round count. Starting funds, pass-start rewards, property prices, rents, fees, upgrades, and event effects must form one coherent system.

When changing the economy:

- Preserve the project’s current data as the baseline unless exact replacement values are provided.
- Use data-driven values and calculations rather than scattering magic numbers through UI components.
- Ensure purchases remain attainable early, mid-game choices matter, and the endgame does not become unwinnable through a single unlucky event.
- Clearly distinguish optional strategic choices (buy, upgrade, trade, use a benefit) from mandatory outcomes (fees, movement, penalties).
- Keep game copy concise, premium, and plain enough for players to understand at a glance.

## Board implementation requirements

The board is a functional game surface, not a static mockup. Keep board-space definitions, coordinates/order, ownership, prices, rents, special-space behavior, and rendering linked through the project’s established state/data layer.

Implement or preserve the following principles:

- Board spaces must render from data and remain in their defined sequence.
- Each space must communicate its identity, category, current ownership/state, and key action without overcrowding the board.
- Special spaces must have clear, original behavior and visual distinction.
- The active player, current turn, dice result, available actions, balances, and relevant event feedback must be visible without obstructing play.
- Player tokens must occupy the correct space and remain visually distinct when multiple tokens share one location.
- Game logic must be separated from presentation as far as the current architecture permits; do not duplicate rule calculations across components.

Only change names, locations, visual labels, costs, or a board mapping when those exact changes are supplied. Do not infer a replacement table from broad references or external games.

## Turn, dice, and movement rules

Use two dice for each normal turn.

1. The active player initiates a roll.
2. Generate and show both die values and their total.
3. Move the active token one space at a time, in board order, for the total number of steps.
4. Animate or stage movement so each step is perceptible; do not teleport directly to the destination unless reduced-motion handling requires it.
5. During each crossed step, detect passing the designated start space. Award the configured pass-start benefit exactly once per crossing, update the balance/state, and give clear feedback.
6. Once movement completes, resolve the destination space through its data-defined rule: for example, a purchasable space, an owned-space charge, a fee, a card/event, a station/route effect, or another existing special rule.
7. Finish all destination resolution and player feedback before advancing the turn.
8. Prevent duplicate rolls, overlapping animations, duplicate rewards, and action input while a roll/move/resolution is in progress.

If the current game has rules for doubles, detention, bonus turns, or other exceptions, preserve them. Do not invent or remove such rules without an explicit request.

## 18-round progression

The intended session is an 18-round game. A round is complete after every active player has completed one resolved turn. The game must track the current round and player turn accurately, present useful progress to players, and conclude only after round 18 has fully resolved.

At completion, calculate and present the winner using the project’s defined scoring/asset rules. If no winner calculation exists, do not invent a scoring model silently—identify the missing rule and propose the smallest compatible implementation for approval.

## Audio hooks and future audio architecture

Audio should enhance feedback without being required for gameplay. Create or preserve a small, central audio abstraction rather than hard-coding media playback throughout components.

Required sound hook points:

- die roll;
- each token movement step, with sensible throttling to avoid noise;
- landing/resolving a station or route space;
- passing the start space and receiving its reward;
- optional: purchase, payment, event reveal, turn change, and game completion.

Future audio requirements:

- Keep sound identifiers semantic (for example, `diceRoll`, `tokenStep`, `stationLand`, `passStart`) rather than tying game code to filenames.
- Centralize asset lookup, volume, mute state, preload strategy, and playback behavior in the existing audio/service layer or a minimal compatible extension.
- Support missing/unavailable assets gracefully; game logic must never depend on audio playback succeeding.
- Respect browser autoplay restrictions and user mute/volume preferences.
- Avoid adding copyrighted or externally sourced audio without explicit approval and licensing confirmation.

## Supplied board implementation specification

This section is an **explicitly authorized board/game-data brief** supplied by the product owner. It is the exception to the general rule against independently changing names and values: implement this specification only when the accompanying task requests the 40-space board conversion. Do not mix it with a partial legacy board, invent missing rules, or modify it in future tasks unless a new explicit data change is supplied.

### Session, board, and centre

- Use a square, clockwise 40-space board: 9 ordinary spaces on each side plus four corners.
- Use two dice. Show each result and move the active token one space at a time in the UI; play the provided token-step audio at a throttled cadence while moving.
- The session has 18 rounds. Advance the round only once every player has completed and fully resolved their turn. End after the final player resolves round 18.
- The start/coronation space awards **₹2,00,000** whenever a player passes or lands on it, except where a rule expressly prevents collection.
- Create semantic sound hooks for token movement, landing on a station/route, and passing start; the user has movement audio and expects additional station/start audio later.
- The central board has a large diagonal, rounded deep-crimson banner with gold trim reading `MANAPALLY`; a dotted `Temple Hundi` card area sits upper-left and a dotted `Raja's Order` card area lower-right, both diagonally aligned.

### Space data — positions 0–39

Use these exact positions, kinds, and values. `property` entries reference the property schedule below; `route` entries cost ₹2,00,000; both utilities cost ₹1,50,000.

| Pos. | Space | Kind / outcome |
|---:|---|---|
| 0 | Rajyabhishekam (Coronation) | start; collect ₹2,00,000 |
| 1 | Pallava Path | property |
| 2 | Temple Hundi | community/event |
| 3 | Satavahana Street | property |
| 4 | Kandayam (Land Tax) | pay 10% or ₹2,00,000 |
| 5 | Chola Express | route |
| 6 | Chera Road | property |
| 7 | Raja's Order | chance/event |
| 8 | Hoysala Halebidu Marg | property |
| 9 | Pandya Madurai Street | property |
| 10 | Kaidi Kottai / Just Visiting | detention / visit |
| 11 | Wodeyar Mysuru Place | property |
| 12 | Kaveri Power Company | utility |
| 13 | Travancore Avenue | property |
| 14 | Nayak Madurai Mahal Road | property |
| 15 | Pandya Express | route |
| 16 | Kakatiya Warangal Place | property |
| 17 | Temple Hundi | community/event |
| 18 | Golconda Fort Avenue | property |
| 19 | Chola Thanjavur Avenue | property |
| 20 | Ambari Vishram / Free Parking | free parking |
| 21 | Krishnadevaraya Hampi Avenue | property |
| 22 | Raja's Order | chance/event |
| 23 | Rajaraja Chola Avenue | property |
| 24 | Rani Abbakka Avenue | property |
| 25 | Chera Express | route |
| 26 | Tipu Sultan Avenue | property |
| 27 | Chandragiri Avenue | property |
| 28 | Tungabhadra Water Works | utility |
| 29 | Chalukya Badami Gardens | property |
| 30 | Go to Kaidi Kottai | move directly to detention; do not pass start or collect |
| 31 | Padmanabhapuram Avenue | property |
| 32 | Vijayanagara Empire Avenue | property |
| 33 | Temple Hundi | community/event |
| 34 | Mysore Palace Avenue | property |
| 35 | Vijayanagara Express | route |
| 36 | Raja's Order | chance/event |
| 37 | Meenakshi Amman Place | property |
| 38 | Vajra (Diamond) Tax | pay ₹75,000 |
| 39 | Brihadeeswarar Boulevard | property |

Rendering orientation: positions 0–10 occupy the bottom row right-to-left (upright text); 10–20 the left column bottom-to-top (clockwise rotated text); 20–30 the top row left-to-right (upside-down text); and 30–39 the right column top-to-bottom (counter-clockwise rotated text). Colour bars sit on the inner edge of each property space.

### Properties, upgrades, rent, and mortgage

Store these as structured data (not display-only text). Each entry is: `property — purchase / house / base rent / 1 / 2 / 3 / 4 / hotel / mortgage`, all in rupees.

```text
Pallava Path — 60,000 / 50,000 / 2,000 / 10,000 / 30,000 / 90,000 / 1,60,000 / 2,50,000 / 30,000
Satavahana Street — 60,000 / 50,000 / 4,000 / 20,000 / 60,000 / 1,80,000 / 3,20,000 / 4,50,000 / 30,000
Chera Road — 1,00,000 / 50,000 / 6,000 / 30,000 / 90,000 / 2,70,000 / 4,00,000 / 5,50,000 / 50,000
Hoysala Halebidu Marg — 1,00,000 / 50,000 / 6,000 / 30,000 / 90,000 / 2,70,000 / 4,00,000 / 5,50,000 / 50,000
Pandya Madurai Street — 1,20,000 / 50,000 / 8,000 / 40,000 / 1,00,000 / 3,00,000 / 4,50,000 / 6,00,000 / 60,000
Wodeyar Mysuru Place; Travancore Avenue — 1,40,000 / 1,00,000 / 10,000 / 50,000 / 1,50,000 / 4,50,000 / 6,25,000 / 7,50,000 / 70,000
Nayak Madurai Mahal Road — 1,60,000 / 1,00,000 / 12,000 / 60,000 / 1,80,000 / 5,00,000 / 7,00,000 / 9,00,000 / 80,000
Kakatiya Warangal Place; Golconda Fort Avenue — 1,80,000 / 1,00,000 / 14,000 / 70,000 / 2,00,000 / 5,50,000 / 7,50,000 / 9,50,000 / 90,000
Chola Thanjavur Avenue — 2,00,000 / 1,00,000 / 16,000 / 80,000 / 2,20,000 / 6,00,000 / 8,00,000 / 10,00,000 / 1,00,000
Krishnadevaraya Hampi Avenue; Rajaraja Chola Avenue — 2,20,000 / 1,50,000 / 18,000 / 90,000 / 2,50,000 / 7,00,000 / 8,75,000 / 10,50,000 / 1,10,000
Rani Abbakka Avenue — 2,40,000 / 1,50,000 / 20,000 / 1,00,000 / 3,00,000 / 7,50,000 / 9,25,000 / 11,00,000 / 1,20,000
Tipu Sultan Avenue; Chandragiri Avenue — 2,60,000 / 1,50,000 / 22,000 / 1,10,000 / 3,30,000 / 8,00,000 / 9,75,000 / 11,50,000 / 1,30,000
Chalukya Badami Gardens — 2,80,000 / 1,50,000 / 24,000 / 1,20,000 / 3,60,000 / 8,50,000 / 10,25,000 / 12,00,000 / 1,40,000
Padmanabhapuram Avenue; Vijayanagara Empire Avenue — 3,00,000 / 2,00,000 / 26,000 / 1,30,000 / 3,90,000 / 9,00,000 / 11,00,000 / 12,75,000 / 1,50,000
Mysore Palace Avenue — 3,20,000 / 2,00,000 / 28,000 / 1,50,000 / 4,50,000 / 10,00,000 / 12,00,000 / 14,00,000 / 1,60,000
Meenakshi Amman Place — 3,50,000 / 2,00,000 / 35,000 / 1,75,000 / 5,00,000 / 11,00,000 / 13,00,000 / 15,00,000 / 1,75,000
Brihadeeswarar Boulevard — 4,00,000 / 2,00,000 / 50,000 / 2,00,000 / 6,00,000 / 14,00,000 / 17,00,000 / 20,00,000 / 2,00,000
```

Routes use rent of ₹25,000 / ₹50,000 / ₹1,00,000 / ₹2,00,000 when the same owner holds 1 / 2 / 3 / 4 routes; route mortgage is ₹1,00,000. One utility charges `4 × dice total × ₹1,000`; both utilities charge `10 × dice total × ₹1,000`; utility mortgage is ₹75,000.

### Colour and surface tokens

| Group | Token | Hex |
|---|---|---|
| First property group | Royal maroon | `#5E2A3A` |
| Second group | Peacock mist | `#8FB8D8` |
| Third group | Rani rose | `#D24C80` |
| Fourth group | Saffron | `#E8912D` |
| Fifth group | Kumkum red | `#C4353A` |
| Sixth group | Turmeric gold | `#E6B422` |
| Seventh group | Emerald | `#2F8F5B` |
| Final group | Royal indigo | `#27407F` |
| Board surface | Pale celadon | `#D6EADF` |
| Centre banner | Deep crimson / gold trim | `#B92D3A` / `#C8A24A` |
| Lines and lettering | Soft charcoal | `#2A2A2A` |

Map groups in ascending board order: 1/3; 6/8/9; 11/13/14; 16/18/19; 21/23/24; 26/27/29; 31/32/34; 37/39.

### Event card content

Implement card effects as data and resolve them through the shared movement/payment pipeline. Maintain original, concise wording in the UI; the supplied effects are:

- **Raja's Order (16 cards):** advance to 39; advance to 0 and collect; advance to 24 or 11 and collect if passing start; advance to nearest route twice (buy if unowned, otherwise pay double rent); advance to nearest utility (buy if unowned, otherwise roll and pay 10× dice total × ₹1,000); receive ₹50,000 dividend; detention-release card; move back 3; go directly to detention without start reward; repair charge ₹25,000 per house and ₹1,00,000 per hotel; pay ₹15,000 fine; travel to position 5 with start reward if crossed; pay each other player ₹50,000; collect ₹1,50,000.
- **Temple Hundi (16 cards):** advance to 0 and collect; collect ₹2,00,000; pay ₹50,000; collect ₹50,000; detention-release card; go directly to detention without start reward; collect ₹1,00,000; collect ₹20,000; collect ₹10,000 from each other player; collect ₹1,00,000; pay ₹1,00,000; pay ₹50,000; collect ₹25,000; repairs at ₹40,000 per house and ₹1,15,000 per hotel; collect ₹10,000; collect ₹1,00,000.

Keep the two repeated nearest-route cards in the Raja's Order deck. If an exact deck order, shuffle behavior, doubles rule, detention release rule, trading rule, or bankruptcy rule is absent in the repository and not supplied in a task, do not silently invent it—flag it for product approval.

## Definition of done for a change

A requested change is complete only when it is implemented within the existing architecture, visually consistent, accessible at the relevant viewport sizes, free of obvious duplicated state/rules, and verified with the repository’s available checks. Report:

- files changed and why;
- files intentionally left untouched;
- user-visible behavior added or changed;
- validation commands/checks and results;
- assumptions, follow-ups, or unresolved decisions.
