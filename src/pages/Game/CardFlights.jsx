import { useEffect, useRef } from 'react';
import { RESOURCES, TERRAINS } from './catanBoard';
import { ResourceIcon } from './hexArt.jsx';

// Cards that physically travel: from a producing tile to whoever collects,
// from a robbed player to the thief, from every player to the one who
// played Monopoly, between two traders, and to and from the bank. Each
// move in the game's event feed becomes a few small cards flying in an arc
// from one place on screen to another, then the place they land gives a
// small bump. Events play one after another, never on top of each other;
// after a long gap (a background tab, a reconnect) the backlog is skipped
// rather than replayed. With reduced motion nothing flies.

const FLIGHT_MS = 720;
const HARVEST_MS = 1250; // a harvest card rises from its tile, then flies
const HARVEST_DELAY_MS = 260; // the tiles glow first
const STAGGER_MS = 90;
const MAX_CARDS = 4; // per sender and kind of card in one move
const MAX_HARVEST = 6; // a big harvest still shows every card, up to this
const MAX_BACKLOG = 6;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const resourceOfHex = (board, hexId) => TERRAINS[board?.hexes?.[hexId]?.terrain]?.resource;

// The trips one event makes: { from, to, card, shake? } in anchor names.
export const flightsFor = (event, me, board) => {
  const at = (id, resource) => (id === me ? (resource && resource !== 'back' ? `hand-${resource}` : 'hand') : `seat-${id}`);
  const trips = [];
  const send = (from, to, bundle, extra = {}) =>
    Object.entries(bundle || {}).forEach(([card, count]) => {
      for (let i = 0; i < Math.min(count, extra.rise ? MAX_HARVEST : MAX_CARDS); i += 1) {
        trips.push({ from: typeof from === 'function' ? from(card) : from, to: typeof to === 'function' ? to(card) : to, card, ...extra });
      }
    });

  switch (event.type) {
    case 'produce':
      // Cards rise out of each paying tile and fly to whoever collects
      // them; the last card to reach a player carries the total for a
      // "+N" on their seat.
      Object.entries(event.gains || {}).forEach(([id, bundle]) => {
        const before = trips.length;
        send(
          (card) => {
            const hexId = (event.hexes || []).find((hex) => resourceOfHex(board, hex) === card);
            return hexId === undefined ? 'bank' : `hex-${hexId}`;
          },
          (card) => at(id, card),
          bundle,
          { rise: true },
        );
        const total = Object.values(bundle || {}).reduce((sum, n) => sum + n, 0);
        if (trips.length > before) trips[trips.length - 1].gain = { seat: `seat-${id}`, total };
      });
      break;
    case 'steal': {
      const card = event.resource || 'back';
      trips.push({ from: at(event.victim, card), to: at(event.actor, card), card, shake: at(event.victim, card) });
      break;
    }
    case 'monopoly':
      Object.entries(event.from || {}).forEach(([id, count]) =>
        send(at(id, event.resource), at(event.actor, event.resource), { [event.resource]: count }, { shake: at(id, event.resource) }),
      );
      break;
    case 'trade':
      send((card) => at(event.actor, card), (card) => at(event.partner, card), event.give);
      send((card) => at(event.partner, card), (card) => at(event.actor, card), event.get);
      break;
    case 'maritime':
      send((card) => at(event.actor, card), 'bank', event.give);
      send('bank', (card) => at(event.actor, card), event.get);
      break;
    case 'yop':
      send('bank', (card) => at(event.actor, card), event.bundle);
      break;
    case 'discard':
      if (event.bundle) send((card) => at(event.actor, card), 'bank', event.bundle);
      else send(at(event.actor), 'bank', { back: event.count || 1 });
      break;
    case 'build':
      if (!event.free) send((card) => at(event.actor, card), 'bank', event.paid);
      break;
    case 'buyDev':
      send((card) => at(event.actor, card), 'bank', event.paid);
      trips.push({ from: 'bank', to: at(event.actor), card: 'dev' });
      break;
    default:
      break;
  }
  return trips;
};

const anchor = (name) => document.querySelector(`[data-anchor="${name}"]`);

const centre = (element) => {
  const rect = element?.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

// A "+N" that pops beside a player's seat when their harvest lands.
const popGain = (layer, anchorName, total) => {
  const rect = anchor(anchorName)?.getBoundingClientRect();
  if (!rect || !rect.width || !layer) return;
  const badge = document.createElement('div');
  badge.className = 'gain-pop';
  badge.textContent = `+${total}`;
  badge.style.left = `${Math.min(window.innerWidth - 30, rect.right - 22)}px`;
  badge.style.top = `${rect.top + 14}px`;
  layer.appendChild(badge);
  const pop = badge.animate(
    [
      { transform: 'translate(-50%, 6px) scale(0.6)', opacity: 0 },
      { transform: 'translate(-50%, -4px) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -10px) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -22px) scale(0.95)', opacity: 0 },
    ],
    { duration: 1100, easing: 'ease-out' },
  );
  pop.onfinish = () => badge.remove();
};

export default function CardFlights({ events, me, board, onLand = null }) {
  const layer = useRef(null);
  const templates = useRef(null);
  const seen = useRef(null);
  const queue = useRef([]);
  const busy = useRef(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const landRef = useRef(onLand);
  landRef.current = onLand;

  useEffect(() => {
    const list = Array.isArray(events) ? events : [];
    const newest = list.length ? list[list.length - 1].id : 0;
    if (seen.current === null || newest < seen.current) {
      seen.current = newest;
      return;
    }
    const fresh = list.filter((event) => event.id > seen.current);
    seen.current = newest;
    if (!fresh.length || reduced() || document.hidden) return;

    // A harvest goes first, so the cards rise while the tiles still glow.
    queue.current.push(...fresh);
    queue.current.sort((a, b) => (a.type === 'produce' ? 0 : 1) - (b.type === 'produce' ? 0 : 1) || a.id - b.id);
    if (queue.current.length > MAX_BACKLOG) queue.current = queue.current.slice(-2);

    const fly = (trip, delay) => {
      const from = centre(anchor(trip.from));
      const toElement = anchor(trip.to);
      const to = centre(toElement);
      const template = templates.current?.querySelector(`[data-card="${trip.card}"]`);
      if (!from || !to || !template || !layer.current) return 0;
      const card = template.cloneNode(true);
      card.removeAttribute('data-card');
      card.style.left = `${from.x}px`;
      card.style.top = `${from.y}px`;
      layer.current.appendChild(card);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lift = Math.min(90, 30 + Math.hypot(dx, dy) * 0.18);
      const at = (x, y) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      const frames = trip.rise
        ? [
            // Out of the tile: up from the glow, a little turn, a pause.
            { transform: `${at(0, 6)} scale(0.35) rotate(-14deg)`, opacity: 0 },
            { transform: `${at(0, -26)} scale(1.12) rotate(-6deg)`, opacity: 1, offset: 0.2 },
            { transform: `${at(0, -32)} scale(1.1) rotate(4deg)`, opacity: 1, offset: 0.36 },
            { transform: `${at(dx * 0.5, dy * 0.5 - 32 - lift)} scale(1.04) rotate(8deg)`, opacity: 1, offset: 0.68 },
            { transform: `${at(dx, dy)} scale(0.72) rotate(0deg)`, opacity: 1, offset: 0.92 },
            { transform: `${at(dx, dy)} scale(0.5)`, opacity: 0 },
          ]
        : [
            { transform: `${at(0, 0)} scale(0.55) rotate(-10deg)`, opacity: 0 },
            { transform: `${at(0, 0)} scale(1) rotate(-4deg)`, opacity: 1, offset: 0.15 },
            { transform: `${at(dx * 0.5, dy * 0.5 - lift)} scale(1.06) rotate(6deg)`, opacity: 1, offset: 0.55 },
            { transform: `${at(dx, dy)} scale(0.72) rotate(0deg)`, opacity: 1, offset: 0.9 },
            { transform: `${at(dx, dy)} scale(0.5)`, opacity: 0 },
          ];
      const duration = trip.rise ? HARVEST_MS : FLIGHT_MS;
      const flight = card.animate(frames, { duration, delay, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)', fill: 'both' });
      flight.onfinish = () => {
        card.remove();
        landRef.current?.(trip);
        if (trip.gain) popGain(layer.current, trip.gain.seat, trip.gain.total);
        toElement?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], {
          duration: 280,
          easing: 'ease-out',
        });
      };
      if (trip.shake) {
        anchor(trip.shake)?.animate?.(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(-2px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 360, delay },
        );
      }
      return delay + duration;
    };

    const next = () => {
      const event = queue.current.shift();
      if (!event) {
        busy.current = false;
        return;
      }
      busy.current = true;
      const trips = flightsFor(event, me, boardRef.current);
      const start = event.type === 'produce' ? HARVEST_DELAY_MS : 0;
      const ends = trips.map((trip, index) => fly(trip, start + index * (event.type === 'produce' ? 110 : STAGGER_MS)));
      const longest = Math.max(0, ...ends);
      // The next move starts as this one's cards come in to land.
      window.setTimeout(next, longest ? longest * 0.7 : 0);
    };

    if (!busy.current) next();
  }, [events, me]);

  useEffect(() => {
    const host = layer.current;
    return () => {
      queue.current = [];
      host?.replaceChildren?.();
    };
  }, []);

  return (
    <>
      <div className="flight-layer" ref={layer} aria-hidden="true" />
      <div className="flight-templates" ref={templates} aria-hidden="true">
        {RESOURCES.map((resource) => (
          <div key={resource} data-card={resource} className={`flight-card game-card--${resource}`}>
            <span className="flight-card-art">
              <ResourceIcon resource={resource} size={16} />
            </span>
          </div>
        ))}
        <div data-card="back" className="flight-card flight-card--back">
          <span className="flight-card-art">?</span>
        </div>
        <div data-card="dev" className="flight-card flight-card--dev">
          <span className="flight-card-art">★</span>
        </div>
      </div>
    </>
  );
}
