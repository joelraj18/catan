import { useEffect, useRef } from 'react';
import { RESOURCES, TERRAINS } from './catanBoard';
import { ResourceIcon } from './hexArt.jsx';
import { DevBack } from './GameCards.jsx';
import { EASE, MOTION, motionLevel, scaled } from '../../services/motion';

// Cards that physically travel: from a producing tile to whoever collects,
// from a robbed player to the thief, from every player to the one who
// played Monopoly, between two traders, and to and from the bank. Each
// move in the game's event feed becomes a few small cards flying along a
// smooth curve from one place on screen to another. A card leaving your
// hand first lifts out of it; a card arriving lights up the card it joins.
// Events play one after another, never on top of each other; after a long
// gap (a background tab, a reconnect) the backlog is skipped rather than
// replayed. They play whatever the computer's reduced-motion setting says
// (services/motion.js); only the game's own "Animations: Off" stops them.

const HARVEST_DELAY_MS = 260; // the tiles glow first
const STAGGER_MS = 70;
const LIFT_MS = 150; // a card rising out of your hand before it leaves
const MAX_CARDS = 4; // per sender and kind of card in one move
const MAX_HARVEST = 6; // a big harvest still shows every card, up to this
const MAX_BACKLOG = 6;
const EDGE = 24; // how far inside the window an off-screen target is drawn

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

// Where a card should head for: another player's cards land on the card
// count in their seat, and anything with no place on screen falls back to
// the seat, then the bank, instead of vanishing.
export const anchorFor = (name, card, find = anchor) => {
  const tries = [];
  if (name?.startsWith('seat-') && card !== 'dev') tries.push(`cards-${name.slice(5)}`);
  tries.push(name);
  if (name?.startsWith('hand-')) tries.push('hand');
  tries.push('bank');
  for (const option of tries) {
    const element = find(option);
    const rect = element?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return element;
  }
  return null;
};

// The middle of an element, pulled inside the window when it is scrolled
// out of view, so the card still visibly heads toward that player.
export const visibleCentre = (element, view = { width: window.innerWidth, height: window.innerHeight }) => {
  const rect = element?.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  const clamp = (value, max) => Math.min(max - EDGE, Math.max(EDGE, value));
  return { x: clamp(rect.left + rect.width / 2, view.width), y: clamp(rect.top + rect.height / 2, view.height) };
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Keyframes along a curve from (x0, y0) to (dx, dy), bending up by lift:
// even steps, a gentle tilt that follows the direction of travel, a little
// growth in the middle of the flight and a soft fade at each end.
export const curveFrames = ({ x0 = 0, y0 = 0, dx, dy, lift, steps = 14, fadeIn = true, from = 0.82 }) => {
  const cx = (x0 + dx) / 2;
  const cy = Math.min(y0, dy) - lift;
  const frames = [];
  for (let i = 0; i <= steps; i += 1) {
    const offset = i / steps;
    const t = easeInOut(offset);
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * dx;
    const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * dy;
    const tilt = Math.max(-10, Math.min(10, (dx - x0) * 0.02)) * Math.sin(Math.PI * offset);
    const scale = offset < 0.5 ? from + (1.06 - from) * (offset / 0.5) : 1.06 - 0.26 * ((offset - 0.5) / 0.5);
    const opacity = fadeIn && offset < 0.08 ? offset / 0.08 : offset > 0.94 ? (1 - offset) / 0.06 : 1;
    frames.push({
      offset,
      transform: `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px)) scale(${scale.toFixed(3)}) rotate(${tilt.toFixed(2)}deg)`,
      opacity: Number(opacity.toFixed(3)),
    });
  }
  return frames;
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
    if (!fresh.length || motionLevel() === 'off' || document.hidden) return;

    // A harvest goes first, so the cards rise while the tiles still glow.
    queue.current.push(...fresh);
    queue.current.sort((a, b) => (a.type === 'produce' ? 0 : 1) - (b.type === 'produce' ? 0 : 1) || a.id - b.id);
    if (queue.current.length > MAX_BACKLOG) queue.current = queue.current.slice(-2);

    const fly = (trip, delay) => {
      const fromElement = anchorFor(trip.from, trip.card);
      const toElement = anchorFor(trip.to, trip.card);
      const from = visibleCentre(fromElement);
      const to = visibleCentre(toElement);
      const template = templates.current?.querySelector(`[data-card="${trip.card}"]`);
      if (!from || !to || !template || !layer.current) return 0;

      // A card leaving your own hand lifts out of it first.
      const leavesHand = trip.from.startsWith('hand') && !trip.rise;
      const lift = leavesHand ? scaled(LIFT_MS) : 0;
      if (leavesHand) {
        fromElement.querySelector?.('.game-card-face')?.animate?.(
          [
            { transform: 'translateY(0) rotate(0deg)' },
            { transform: 'translateY(-14px) rotate(-4deg)', offset: 0.35 },
            { transform: 'translateY(0) rotate(0deg)' },
          ],
          { duration: lift * 2.6, delay, easing: EASE.out },
        );
      }

      const card = template.cloneNode(true);
      card.removeAttribute('data-card');
      card.style.left = `${from.x}px`;
      card.style.top = `${from.y - (leavesHand ? 14 : 0)}px`;
      layer.current.appendChild(card);
      const dx = to.x - from.x;
      const dy = to.y - from.y + (leavesHand ? 14 : 0);
      const arc = Math.min(110, 34 + Math.hypot(dx, dy) * 0.2);
      const frames = trip.rise
        ? [
            // Out of the tile: up from the glow with a little turn, then
            // away along the curve.
            { offset: 0, transform: 'translate(-50%, calc(-50% + 6px)) scale(0.35) rotate(-12deg)', opacity: 0 },
            { offset: 0.16, transform: 'translate(-50%, calc(-50% - 26px)) scale(1.1) rotate(-4deg)', opacity: 1 },
            { offset: 0.26, transform: 'translate(-50%, calc(-50% - 30px)) scale(1.08) rotate(2deg)', opacity: 1 },
            ...curveFrames({ y0: -30, dx, dy, lift: arc, steps: 12, fadeIn: false, from: 1.08 })
              .slice(1)
              .map((frame) => ({ ...frame, offset: 0.26 + frame.offset * 0.74 })),
          ]
        : curveFrames({ dx, dy, lift: arc });
      const duration = scaled(trip.rise ? MOTION.harvest : MOTION.flight);
      const flight = card.animate(frames, { duration, delay: delay + lift, easing: 'linear', fill: 'both' });
      flight.onfinish = () => {
        card.remove();
        landRef.current?.(trip);
        if (trip.gain) popGain(layer.current, trip.gain.seat, trip.gain.total);
        toElement?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], {
          duration: scaled(MOTION.base),
          easing: EASE.out,
        });
        // The card it joins in your hand lights up in its colour.
        toElement?.querySelector?.('.game-card-face')?.animate?.(
          [
            { transform: 'translateY(0)', filter: 'brightness(1)' },
            { transform: 'translateY(-8px)', filter: 'brightness(1.18)', offset: 0.4 },
            { transform: 'translateY(0)', filter: 'brightness(1)' },
          ],
          { duration: scaled(MOTION.slow), easing: EASE.out },
        );
      };
      if (trip.shake) {
        anchorFor(trip.shake, trip.card)?.animate?.(
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
      return delay + lift + duration;
    };

    const next = () => {
      const event = queue.current.shift();
      if (!event) {
        busy.current = false;
        return;
      }
      busy.current = true;
      const trips = flightsFor(event, me, boardRef.current);
      const harvest = event.type === 'produce';
      const start = harvest ? scaled(HARVEST_DELAY_MS) : 0;
      const ends = trips.map((trip, index) => fly(trip, start + index * scaled(harvest ? 100 : STAGGER_MS)));
      const longest = Math.max(0, ...ends);
      // The next move starts as this one's cards come in to land.
      window.setTimeout(next, longest ? longest * 0.6 : 0);
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
          <DevBack size={22} />
        </div>
      </div>
    </>
  );
}
