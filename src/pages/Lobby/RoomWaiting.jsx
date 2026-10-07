import { useEffect, useRef, useState } from 'react';
import ApiKeyInfo from '../../components/ApiKeyInfo';
import BrandLogo from '../../components/BrandLogo';
import ChatPanel from '../../components/ChatPanel';
import VoicePanel from '../../components/VoicePanel';
import VersionNotice from '../../components/VersionNotice';
import GoldButton from '../../components/GoldButton';
import ThemeToggle from '../../components/ThemeToggle';
import {
  clearPremiumKey,
  hasPremiumKey,
  onPremiumKeyChange,
  setPremiumKey,
  verifyPremiumKey,
} from '../../services/premiumAi';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../services/roomSession';
import { PIECES, PieceMark } from '../Game/pieces.jsx';
import {
  BOT_SKILL_CHOICES,
  DEFAULT_SETTINGS,
  HAND_LIMIT_CHOICES,
  TIMER_CHOICES,
  VICTORY_CHOICES,
  botSkillLabel,
  timerLabel,
} from '../Game/gameSettings';
import '../Game/board-game.css';
import './lobby.css';
import './room-waiting.css';

const seatRole = (seat, session) => {
  if (seat.kind === 'bot') return 'Computer opponent';
  if (seat.kind === 'ai') return 'AI opponent · Premium';
  if (seat.clientId === 'host') return 'Host';
  return 'Friend';
};

// The invite link carries the room code, and the test switches when present.
const inviteLink = (code) => {
  const url = new URL(window.location.href);
  const keep = ['net', 'relay', 'speed'];
  [...url.searchParams.keys()].forEach((key) => !keep.includes(key) && url.searchParams.delete(key));
  url.searchParams.set('join', code);
  url.hash = '';
  return url.toString();
};

const routeSummary = (routes) => {
  const open = ['direct', 'relay'].filter((route) => routes[route] === 'up');

  if (open.length === 2) return 'Open for friends directly and through Relay';
  if (open[0] === 'relay') return 'Open for friends through Relay, this network blocks direct links';
  if (open[0] === 'direct') return 'Open for friends directly';
  return 'Opening the room';
};

export default function RoomWaiting({ session, onLeave }) {
  const [lobby, setLobby] = useState(session.lobby);
  const [routes, setRoutes] = useState(session.routes);
  const [copyState, setCopyState] = useState('idle');
  const [linkState, setLinkState] = useState('idle');
  const [hasKey, setHasKey] = useState(hasPremiumKey());
  const [hasDraft, setHasDraft] = useState(false);
  const [keyStatus, setKeyStatus] = useState(hasPremiumKey() ? 'valid' : 'idle');
  const [showKeyInfo, setShowKeyInfo] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const keyInputRef = useRef(null);
  const isHost = session.isHost;

  useEffect(() => session.on('lobby', (next) => setLobby({ ...next, seats: [...next.seats] })), [session]);
  useEffect(() => session.on('routes', (next) => setRoutes({ ...next })), [session]);
  useEffect(() => onPremiumKeyChange(setHasKey), []);

  // The add opponent menu closes on Escape or a click anywhere else.
  useEffect(() => {
    if (openMenu === null) {
      return undefined;
    }

    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest('.seat-add')) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);

    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [openMenu]);

  const seats = lobby.seats;
  const openSeats = Math.max(0, lobby.tableSize - seats.length);
  const hasAiSeat = seats.some((seat) => seat.kind === 'ai');

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(session.code);
      setCopyState('copied');
    } catch {
      setCopyState('blocked');
    }

    window.setTimeout(() => setCopyState('idle'), 2200);
  };

  const shareInvite = async () => {
    const link = inviteLink(session.code);

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Catan', text: `Join my Catan table, room code ${session.code}`, url: link });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setLinkState('copied');
    } catch {
      setLinkState('blocked');
    }

    window.setTimeout(() => setLinkState('idle'), 2600);
  };

  const addOpponent = (kind) => {
    session.addOpponent(kind);
    setOpenMenu(null);
  };

  // The field is uncontrolled, so the key never enters React state. It goes
  // straight into the premium AI module's memory and the field is wiped.
  // It is then checked with Anthropic; a rejected key is dropped at once.
  const applyKey = async () => {
    const input = keyInputRef.current;

    if (!input || keyStatus === 'checking' || !setPremiumKey(input.value)) {
      return;
    }

    input.value = '';
    setHasDraft(false);
    setKeyStatus('checking');

    const result = await verifyPremiumKey();

    if (result === 'invalid') {
      clearPremiumKey();
    }

    setKeyStatus(result);
  };

  const forgetKey = () => {
    clearPremiumKey();
    setKeyStatus('idle');
    seats.filter((seat) => seat.kind === 'ai').forEach((seat) => session.removeSeat(seat.seatId));
  };

  return (
    <main className="waiting-room-page">
      <header className="waiting-topbar">
        <button className="lobby-brand" type="button" onClick={onLeave} aria-label="Leave the room">
          <BrandLogo size={22} />
        </button>

        <div className="room-status">
          <span className={`status-dot ${session.status === 'offline' ? 'status-dot--offline' : ''}`} />
          {session.status === 'offline' ? 'Offline table' : 'Private table online'}
        </div>

        <div className="topbar-right">
          <ThemeToggle />
          <button className="lobby-back" type="button" onClick={onLeave}>
            Leave room
          </button>
        </div>
      </header>

      <VersionNotice session={session} />

      <section className="waiting-room-layout">
        <div className="waiting-room-intro">
          <p className="eyebrow">The private table</p>

          <h1>
            The Island
            <br />
            <em>Awaits</em>
          </h1>

          <p>
            {isHost
              ? 'Share the invite link or the room code with your friends, they appear here as they arrive'
              : 'You are seated, the host starts the game once the table is ready'}
          </p>

          <div className="invite-code-card">
            <span>Room code</span>
            <strong>{session.code}</strong>
            <div className="invite-actions">
              <button type="button" onClick={copyRoomCode} aria-live="polite">
                {copyState === 'copied' ? 'Copied' : copyState === 'blocked' ? 'Copy blocked, share the code above' : 'Copy room code'}
              </button>
              {isHost && (
                <button type="button" className="invite-link-button" onClick={shareInvite} aria-live="polite">
                  {linkState === 'copied' ? 'Invite link copied' : linkState === 'blocked' ? 'Copy blocked' : 'Share invite link'}
                </button>
              )}
            </div>
          </div>

          {isHost && session.status !== 'offline' && (
            <div className="route-status" role="status">
              <span className={`route-pill ${routes.direct === 'up' ? 'route-pill--up' : routes.direct === 'trying' ? '' : 'route-pill--down'}`}>
                Direct
              </span>
              <span className={`route-pill ${routes.relay === 'up' ? 'route-pill--up' : routes.relay === 'trying' ? '' : 'route-pill--down'}`}>
                Relay
              </span>
              <p>{routeSummary(routes)}, on a phone keep this tab open while friends join</p>
            </div>
          )}

          {!isHost && session.route === 'relay' && (
            <p className="route-note">You joined through Relay, a secure route for networks that block direct links</p>
          )}

          {session.status === 'offline' && (
            <p className="offline-note">
              This network blocks every game route, so friends cannot join right now, you can still play with
              computer and AI opponents, or switch to mobile data and create a new room
            </p>
          )}

          <VoicePanel session={session} />
          <ChatPanel session={session} title="Room chat" />
        </div>

        <div className="waiting-room-panel">
          <div className="waiting-panel-heading">
            <div>
              <p className="eyebrow">Players at the table</p>
              <h2>
                {seats.length} <span>of {lobby.tableSize} seated</span>
              </h2>
            </div>

            <span className="host-badge">{isHost ? 'You are the host' : 'Guest'}</span>
          </div>

          {isHost && (
            <div className="seat-count-section">
              <span className="field-label">Table size</span>
              <div className="seat-count-picker settings-picker">
                {[2, 3, 4, 5, 6].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`seat-count-btn ${lobby.tableSize === count ? 'seat-count-btn--selected' : ''}`}
                    onClick={() => session.setTableSize(count)}
                    disabled={count < seats.length}
                    aria-pressed={lobby.tableSize === count}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="seat-count-section">
            <span className="field-label">Board</span>
            {isHost ? (
              <div className="seat-count-picker">
                {[
                  ['beginner', 'Beginners\u2019 map'],
                  ['random', 'Random island'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`seat-count-btn ${(lobby.board || 'beginner') === key ? 'seat-count-btn--selected' : ''}`}
                    onClick={() => session.setBoard(key)}
                    aria-pressed={(lobby.board || 'beginner') === key}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="board-choice-note">
                {(lobby.board || 'beginner') === 'random' ? 'Random island' : 'Beginners\u2019 map'}
              </p>
            )}
            <p className="board-choice-note">
              {(lobby.board || 'beginner') === 'random'
                ? 'Shuffled terrain, numbers and harbours. Everyone places 2 settlements and 2 roads in turn to begin'
                : 'The balanced map from the rulebook, with every starting settlement and road already placed'}
            </p>
          </div>

          <GameSettings
            settings={{ ...DEFAULT_SETTINGS, ...(lobby.settings || {}), board: lobby.board || 'beginner' }}
            isHost={isHost}
            onChange={(patch) => session.setSettings(patch)}
          />

          <div className="player-seat-list">
            {seats.map((seat, index) => {
              const piece = PIECES[seat.pieceKey];
              const mine = seat.clientId === session.myClientId;

              return (
                <article
                  className={`player-seat ${seat.clientId === 'host' ? 'player-seat--host' : ''} ${mine ? 'player-seat--mine' : ''}`}
                  key={seat.seatId}
                >
                  <div className="player-token" style={{ color: piece.colour }}>
                    <PieceMark piece={seat.pieceKey} variant="token" />
                  </div>

                  <div className="player-details">
                    <strong>
                      {seat.name}
                      {mine && <em className="you-chip">You</em>}
                    </strong>
                    <span>
                      {seatRole(seat, session)} · {piece.label}
                      {isHost && seat.route === 'relay' && <em className="relay-chip">Relay</em>}
                    </span>
                  </div>

                  {isHost && seat.clientId !== 'host' ? (
                    <button
                      type="button"
                      className="seat-remove"
                      onClick={() => session.removeSeat(seat.seatId)}
                      aria-label={`Remove ${seat.name}`}
                      title="Remove from the table"
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="seat-number">0{index + 1}</span>
                  )}
                </article>
              );
            })}

            {Array.from({ length: openSeats }, (_, index) => {
              const seatNumber = seats.length + index + 1;
              const menuOpen = openMenu === seatNumber;

              return (
                <article
                  className={`player-seat player-seat--open ${menuOpen ? 'player-seat--menu' : ''}`}
                  key={`open-${seatNumber}`}
                >
                  <div className="empty-token">
                    <span className="waiting-pulse" />
                  </div>

                  <div className="player-details">
                    <strong className="waiting-text">
                      Waiting for someone to join
                      <span className="waiting-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </strong>
                    <span>Seat 0{seatNumber} · share the invite link to fill it</span>
                  </div>

                  {isHost && (
                    <div className="seat-add">
                      <button
                        type="button"
                        className="seat-add-button"
                        aria-expanded={menuOpen}
                        onClick={() => setOpenMenu(menuOpen ? null : seatNumber)}
                      >
                        Add opponent
                      </button>

                      {menuOpen && (
                        <div className="seat-add-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => addOpponent('bot')}>
                            <strong>Computer opponent</strong>
                            <span>Free, plays the built in strategy</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => addOpponent('ai')}
                            disabled={!hasKey || keyStatus === 'checking'}
                          >
                            <strong>AI opponent · Premium</strong>
                            <span>{hasKey ? 'Thinks with Claude using your key' : 'Add your API key below first'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {isHost && (
            <div className="premium-ai">
              <div className="premium-ai-head">
                <div>
                  <p className="eyebrow">Premium AI opponents</p>
                  <span>Opponents that plan each turn with Claude using your own API key, about one short request per turn</span>
                </div>
                <button
                  type="button"
                  className="match-info-button"
                  onClick={() => setShowKeyInfo(true)}
                  aria-label="How your API key is kept safe"
                  title="How your API key is kept safe"
                >
                  i
                </button>
              </div>

              {hasKey ? (
                <div className={`premium-ai-status premium-ai-status--${keyStatus}`} aria-live="polite">
                  <span className={`status-dot ${keyStatus === 'unreachable' ? 'status-dot--offline' : ''}`} />
                  <span>
                    {keyStatus === 'checking'
                      ? 'Checking your key with Anthropic'
                      : keyStatus === 'unreachable'
                        ? 'Could not reach Anthropic to check the key, AI opponents use the computer strategy if a call fails'
                        : `Key verified and held in this tab's memory only${hasAiSeat ? ', AI opponents are ready' : ', add an AI opponent to a seat'}`}
                  </span>
                  <button type="button" className="text-link" onClick={forgetKey}>
                    Forget key
                  </button>
                </div>
              ) : (
                <div className="premium-ai-form">
                  <input
                    ref={keyInputRef}
                    type="password"
                    className="lobby-input"
                    defaultValue=""
                    onChange={(event) => setHasDraft(event.target.value.trim().length > 0)}
                    onKeyDown={(event) => event.key === 'Enter' && applyKey()}
                    placeholder="Claude API key"
                    aria-label="Claude API key"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                  <GoldButton variant="ghost" onClick={applyKey} disabled={!hasDraft}>
                    Use key
                  </GoldButton>
                  {keyStatus === 'invalid' && (
                    <p className="premium-ai-error" role="alert">
                      Anthropic rejected that key, check it in the Claude Console and try again
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="host-controls">
            <div>
              <p className="eyebrow">{isHost ? 'Host controls' : 'Getting ready'}</p>
              <span>
                {isHost
                  ? seats.length < MIN_PLAYERS
                    ? `Wait for friends or add opponents to the open seats, Catan needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`
                    : `Start with ${seats.length} players, the first to ${lobby.settings?.victoryPoints || 10} victory points on their turn wins`
                  : 'Waiting for the host to start the game'}
              </span>
            </div>

            {isHost && (
              <GoldButton onClick={() => session.startGame()} disabled={seats.length < MIN_PLAYERS}>
                Start game
              </GoldButton>
            )}
          </div>
        </div>
      </section>

      {showKeyInfo && <ApiKeyInfo onClose={() => setShowKeyInfo(false)} />}
    </main>
  );
}

// The table rules the host sets before the game; guests see them as a summary.
function GameSettings({ settings, isHost, onChange }) {
  const random = settings.board === 'random';

  if (!isHost) {
    return (
      <div className="seat-count-section game-settings">
        <span className="field-label">Table rules</span>
        <ul className="settings-summary">
          <li>Timer {timerLabel(settings.turnSeconds)}</li>
          <li>Discard above {settings.handLimit}</li>
          <li>{settings.victoryPoints} points to win</li>
          <li>{botSkillLabel(settings.botSkill)} computers</li>
          {random && <li>{settings.redsMayTouch ? '6 & 8 may touch' : '6 & 8 apart'}</li>}
          {random && <li>{settings.extremesMayTouch ? '2 & 12 may touch' : '2 & 12 apart'}</li>}
        </ul>
      </div>
    );
  }

  const segment = (label, key, choices, format = (value) => value, note = null) => (
    <div className="settings-row">
      <span className="settings-label">
        {label}
        {note && <em>{note}</em>}
      </span>
      <div className="seat-count-picker settings-picker" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className={`seat-count-btn ${settings[key] === choice ? 'seat-count-btn--selected' : ''}`}
            aria-pressed={settings[key] === choice}
            onClick={() => onChange({ [key]: choice })}
          >
            {format(choice)}
          </button>
        ))}
      </div>
    </div>
  );

  const toggle = (label, key, note) => (
    <label className={`settings-toggle ${random ? '' : 'settings-toggle--off'}`}>
      <input
        type="checkbox"
        checked={settings[key]}
        disabled={!random}
        onChange={(event) => onChange({ [key]: event.target.checked })}
      />
      <span className="settings-switch" aria-hidden="true" />
      <span className="settings-toggle-text">
        <strong>{label}</strong>
        <em>{note}</em>
      </span>
    </label>
  );

  return (
    <div className="seat-count-section game-settings">
      <span className="field-label">Table rules</span>
      {segment('Turn timer', 'turnSeconds', TIMER_CHOICES, timerLabel, 'to roll, then per move')}
      {segment('Discard on a 7 above', 'handLimit', HAND_LIMIT_CHOICES, (value) => `${value} cards`)}
      {segment('Points to win', 'victoryPoints', VICTORY_CHOICES)}
      {segment('Computer opponents', 'botSkill', BOT_SKILL_CHOICES, botSkillLabel, 'casual keeps it gentle')}
      <div className="settings-toggles">
        {toggle('6 and 8 may touch', 'redsMayTouch', 'Red numbers side by side make rich, swingy spots')}
        {toggle('2 and 12 may touch', 'extremesMayTouch', 'Off keeps the rarest numbers apart')}
      </div>
      {!random && <p className="board-choice-note">Number rules apply to the random island</p>}
    </div>
  );
}
