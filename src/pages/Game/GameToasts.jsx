import { useEffect, useRef, useState } from 'react';
import { GEOMETRY, RESOURCE_LABELS } from './catanBoard';
import { hasResources } from './catanRules';
import { ResourceIcon } from './hexArt.jsx';

const TOAST_MS = 4200;
const LEAVE_MS = 240;
const MAX_TOASTS = 3;

const lower = (resource) => RESOURCE_LABELS[resource]?.toLowerCase() || 'card';

function Cards({ bundle }) {
  const entries = Object.entries(bundle || {}).filter(([, count]) => count > 0);
  return (
    <span className="toast-cards">
      {entries.map(([resource, count]) => (
        <span key={resource} className={`toast-card res-${resource}`}>
          <ResourceIcon resource={resource} size={13} />
          {count}
        </span>
      ))}
    </span>
  );
}

// The side note one event earns for this viewer, or null when it is not
// worth interrupting them for.
export const describeEvent = (event, { me, nameOf, board, buildings }) => {
  const actor = event.actor === me ? 'You' : nameOf(event.actor);
  switch (event.type) {
    case 'monopoly': {
      const resource = lower(event.resource);
      if (event.actor === me) {
        return { tone: 'gain', title: `Monopoly: you took ${event.total} ${resource}`, bundle: { [event.resource]: event.total } };
      }
      const lost = event.from?.[me];
      if (lost) {
        return { tone: 'loss', title: `${actor} played Monopoly`, text: `You gave ${lost} ${resource}`, bundle: { [event.resource]: lost } };
      }
      return { tone: 'info', title: `${actor} played Monopoly`, text: `Took ${event.total} ${resource} from the table` };
    }
    case 'steal':
      if (event.actor === me) {
        return { tone: 'gain', title: `You stole from ${nameOf(event.victim)}`, bundle: event.resource ? { [event.resource]: 1 } : null };
      }
      if (event.victim === me) {
        return { tone: 'loss', title: `${actor} stole from you`, bundle: event.resource ? { [event.resource]: 1 } : null };
      }
      return { tone: 'info', title: `${actor} stole a card from ${nameOf(event.victim)}` };
    case 'trade': {
      if (event.actor === me || event.partner === me) {
        const mine = event.actor === me;
        return {
          tone: 'trade',
          title: `Trade done with ${nameOf(mine ? event.partner : event.actor)}`,
          gave: mine ? event.give : event.get,
          got: mine ? event.get : event.give,
        };
      }
      return { tone: 'info', title: `${actor} traded with ${nameOf(event.partner)}` };
    }
    case 'maritime':
      return event.actor === me ? { tone: 'trade', title: 'Bank trade done', gave: event.give, got: event.get } : null;
    case 'yop':
      return event.actor === me
        ? { tone: 'gain', title: 'Year of Plenty', bundle: event.bundle }
        : { tone: 'info', title: `${actor} played Year of Plenty`, bundle: event.bundle };
    case 'robber': {
      if (event.actor === me) return null;
      const touches = GEOMETRY.hexes[event.to]?.vertices.some((vertexId) => buildings?.[vertexId]?.owner === me);
      if (!touches) return null;
      const hex = board?.hexes?.[event.to];
      return {
        tone: 'loss',
        title: 'The robber blocks you',
        text: `${actor} moved it onto your ${hex?.terrain || 'hex'}${hex?.number ? ` ${hex.number}` : ''}`,
      };
    }
    default:
      return null;
  }
};

// Small notes that slide in at the side: what just happened to you, and
// offers waiting for your answer, with the buttons right on them.
export default function GameToasts({ view, myPlayerId, act, players, myHand, localTime }) {
  const [toasts, setToasts] = useState([]);
  const seen = useRef(null);
  const timers = useRef(new Set());

  const nameOf = (id) => players.find((player) => player.id === id)?.name || 'someone';
  const events = view.events;

  useEffect(() => {
    const list = Array.isArray(events) ? events : [];
    const newest = list.length ? list[list.length - 1].id : 0;
    // Whatever happened before this board opened is not news.
    if (seen.current === null || newest < seen.current) {
      seen.current = newest;
      return;
    }
    const fresh = list.filter((event) => event.id > seen.current);
    if (!fresh.length) return;
    seen.current = newest;

    const context = { me: myPlayerId, nameOf, board: view.board, buildings: view.buildings };
    const notes = fresh.map((event) => ({ id: event.id, ...describeEvent(event, context) })).filter((note) => note.title);
    if (!notes.length) return;

    setToasts((current) => [...current, ...notes].slice(-MAX_TOASTS));
    notes.forEach((note) => {
      const leave = setTimeout(() => {
        timers.current.delete(leave);
        setToasts((current) => current.map((toast) => (toast.id === note.id ? { ...toast, leaving: true } : toast)));
        const drop = setTimeout(() => {
          timers.current.delete(drop);
          setToasts((current) => current.filter((toast) => toast.id !== note.id));
        }, LEAVE_MS);
        timers.current.add(drop);
      }, TOAST_MS);
      timers.current.add(leave);
    });
    // Only new events matter; names and the board are read as they are now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, myPlayerId]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const live = view.turnPhase === 'actions' && !view.gameOver;
  const trades = live ? view.trades || [] : [];
  // Offers waiting on this player's answer.
  const asks = trades.filter(
    (trade) =>
      trade.from !== myPlayerId &&
      (trade.to === myPlayerId || !trade.to) &&
      trade.responses?.[myPlayerId] === undefined,
  );
  // This player's own open offers that someone took up.
  const taken = trades.filter((trade) => trade.from === myPlayerId && !trade.to && (trade.accepted || []).length);

  if (!toasts.length && !asks.length && !taken.length) return null;

  return (
    <div className="game-toasts" aria-live="polite">
      {taken.slice(0, 1).map((trade) => (
        <div key={`taken-${trade.id}`} className="game-toast game-toast--offer game-toast--trade">
          {trade.choosing ? (
            <>
              <strong className="game-toast-title">{trade.accepted.map(nameOf).join(' and ')} accepted</strong>
              <span className="game-toast-text">Pick who you trade with</span>
              <div className="game-toast-actions">
                {trade.accepted.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="property-action-btn"
                    onClick={() => act({ type: 'trade-complete', tradeId: trade.id, partnerId: id })}
                  >
                    {nameOf(id)}
                  </button>
                ))}
              </div>
              {trade.choiceEndsAt && <TimeBar endsAt={localTime(trade.choiceEndsAt)} />}
            </>
          ) : (
            <>
              <strong className="game-toast-title">{nameOf(trade.accepted[0])} accepted your offer</strong>
              <span className="game-toast-text">Trading in a moment, unless someone else says yes too</span>
              {trade.closesAt && <TimeBar endsAt={localTime(trade.closesAt)} />}
            </>
          )}
        </div>
      ))}

      {asks.slice(0, 2).map((trade) => {
        const able = hasResources(myHand, trade.get);
        return (
          <div key={`ask-${trade.id}`} className="game-toast game-toast--offer">
            <strong className="game-toast-title">
              {nameOf(trade.from)} offers {trade.to ? 'you' : 'the table'} a trade
            </strong>
            <span className="game-toast-swap">
              <span>You get</span>
              <Cards bundle={trade.give} />
              <span>You give</span>
              <Cards bundle={trade.get} />
            </span>
            <div className="game-toast-actions">
              <button
                type="button"
                className="property-action-btn"
                disabled={!able}
                title={able ? '' : 'You do not have those cards'}
                onClick={() => act({ type: 'trade-respond', tradeId: trade.id, accept: true })}
              >
                Accept
              </button>
              <button type="button" className="text-link" onClick={() => act({ type: 'trade-respond', tradeId: trade.id, accept: false })}>
                Decline
              </button>
            </div>
          </div>
        );
      })}

      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`game-toast game-toast--${toast.tone} ${toast.leaving ? 'game-toast--leaving' : ''}`}
          role="status"
        >
          <strong className="game-toast-title">{toast.title}</strong>
          {toast.text && <span className="game-toast-text">{toast.text}</span>}
          {toast.bundle && <Cards bundle={toast.bundle} />}
          {(toast.gave || toast.got) && (
            <span className="game-toast-swap">
              <span>Gave</span>
              <Cards bundle={toast.gave} />
              <span>Got</span>
              <Cards bundle={toast.got} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// A thin bar that empties as a short wait runs out.
function TimeBar({ endsAt }) {
  // Measured once: the bar then runs down on its own, without re-renders.
  const [{ total, left }] = useState(() => {
    const remaining = Math.max(0, endsAt - Date.now());
    return { total: Math.max(remaining, 2500), left: remaining };
  });
  return (
    <span className="game-toast-time" aria-hidden="true">
      <span style={{ animationDuration: `${left}ms`, transform: `scaleX(${left / total})` }} />
    </span>
  );
}
