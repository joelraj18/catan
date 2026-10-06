import { useCallback, useEffect, useRef, useState } from 'react';
import { playSfx } from '../../services/sfx';
import { EMOTES, EmotePortrait, emoteOf } from './emotes.jsx';
import useFreshEvent from './useFreshEvent';
import './emotes.css';

const BUBBLE_MS = 2600;
const COOLDOWN_MS = 2600;
const MUTE_KEY = 'catan-emotes-muted';

const readMuted = () => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};

// Where a bubble goes: beside a seat in the side column, above it when the
// seats sit full width (tablets and phones), always inside the window.
const placeFor = (playerId) => {
  const rect = document.querySelector(`[data-anchor="seat-${playerId}"]`)?.getBoundingClientRect();
  if (!rect || !rect.width) return null;
  // A seat scrolled out of view: the bubble shows at the top of the screen.
  if (rect.bottom < 70 || rect.top > window.innerHeight - 70) {
    return { left: Math.max(8, window.innerWidth / 2 - 115), top: 64, side: false, float: true };
  }
  const side = rect.right < window.innerWidth * 0.45;
  const left = side ? rect.right + 10 : rect.left + 56;
  const top = side ? rect.top + 6 : rect.top - 6;
  return {
    left: Math.max(8, Math.min(window.innerWidth - 230, left)),
    top: Math.max(60, Math.min(window.innerHeight - 80, top)),
    side,
  };
};

// Reactions at the table: a picker to send one, and speech bubbles beside
// the seat of whoever sent it, from people (through the room) and from
// computer opponents (through the game's event feed).
export default function EmoteBar({ session, events, players, myPlayerId, effectsOn, volume }) {
  const [bubbles, setBubbles] = useState([]);
  const [open, setOpen] = useState(false);
  const [coolUntil, setCoolUntil] = useState(0);
  const [muted, setMuted] = useState(readMuted);
  const timers = useRef(new Set());
  const sound = useRef({ effectsOn, volume, muted });
  sound.current = { effectsOn, volume, muted };

  const show = useCallback(
    ({ id, playerId, key }) => {
      if (!emoteOf(key) || !players.some((player) => player.id === playerId)) return;
      if (sound.current.muted && playerId !== myPlayerId) return;
      const place = placeFor(playerId);
      setBubbles((current) => [...current.filter((bubble) => bubble.playerId !== playerId), { id, playerId, key, place }]);
      if (sound.current.effectsOn) playSfx(`emote-${key}`, sound.current.volume * 0.85);
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setBubbles((current) => current.filter((bubble) => bubble.id !== id));
      }, BUBBLE_MS);
      timers.current.add(timer);
    },
    [players, myPlayerId],
  );

  useEffect(() => session?.on('emote', (message) => show(message)), [session, show]);

  // Computer opponents react through the event feed.
  const botEmote = useFreshEvent(events, 'emote');
  const lastBot = useRef(null);
  useEffect(() => {
    if (!botEmote || botEmote.id === lastBot.current) return;
    lastBot.current = botEmote.id;
    show({ id: `bot-${botEmote.id}`, playerId: botEmote.actor, key: botEmote.key });
  }, [botEmote, show]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !event.target.closest?.('.emote-picker, .emote-button') && setOpen(false);
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const send = (key) => {
    if (Date.now() < coolUntil) return;
    session?.sendEmote(key);
    setCoolUntil(Date.now() + COOLDOWN_MS);
    setOpen(false);
  };

  const toggleMuted = () => {
    setMuted((current) => {
      try {
        window.localStorage.setItem(MUTE_KEY, current ? '0' : '1');
      } catch {
        // Not saved; the choice still holds for this visit.
      }
      return !current;
    });
  };

  const nameOf = (id) => (id === myPlayerId ? 'You' : players.find((player) => player.id === id)?.name || '');

  return (
    <>
      <div className="emote-dock">
        <button
          type="button"
          className="emote-button"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((current) => !current)}
          title="React with an emote"
        >
          <EmotePortrait emote="sheep" size={26} />
          <span>React</span>
        </button>
        {open && (
          <div className="emote-picker" role="menu" aria-label="Emotes">
            <div className="emote-grid">
              {EMOTES.map((emote) => (
                <button
                  key={emote.key}
                  type="button"
                  role="menuitem"
                  className="emote-choice"
                  disabled={Date.now() < coolUntil}
                  onClick={() => send(emote.key)}
                  title={`${emote.name}: ${emote.line}`}
                >
                  <EmotePortrait emote={emote.key} size={40} />
                  <span>{emote.line}</span>
                </button>
              ))}
            </div>
            <label className="emote-mute">
              <input type="checkbox" checked={muted} onChange={toggleMuted} />
              Hide other players&apos; emotes
            </label>
          </div>
        )}
      </div>

      <div className="emote-layer" aria-live="polite">
        {bubbles.map((bubble) =>
          bubble.place ? (
            <div
              key={bubble.id}
              className={`emote-bubble ${bubble.place.side ? 'emote-bubble--side' : bubble.place.float ? 'emote-bubble--float' : 'emote-bubble--above'}`}
              style={{ left: bubble.place.left, top: bubble.place.top }}
              role="status"
            >
              <EmotePortrait emote={bubble.key} size={42} />
              <span>
                <strong>{nameOf(bubble.playerId)}</strong>
                {emoteOf(bubble.key)?.line}
              </span>
            </div>
          ) : null,
        )}
      </div>
    </>
  );
}
