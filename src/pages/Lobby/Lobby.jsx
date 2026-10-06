import { useEffect, useRef, useState } from 'react';
import BrandLogo from '../../components/BrandLogo';
import GoldButton from '../../components/GoldButton';
import ThemeToggle from '../../components/ThemeToggle';
import { PIECES, PIECE_ORDER, PieceMark } from '../Game/pieces.jsx';
import './lobby.css';

const playerOptions = PIECE_ORDER.map((key) => ({
  id: key,
  name: PIECES[key].label,
  color: PIECES[key].colour,
}));

const nextSteps = [
  'Choose a display name and a colour',
  'Create a room and share its code or invite link',
  'Friends open the link or enter the code to join, or add computer and AI opponents',
];

const JOIN_ERRORS = {
  'not-found':
    'No open room with that code, check the code and ask the host to keep the Catan tab open on their screen',
  blocked: 'Your network blocks game connections, open Having trouble joining below and run Check connection',
  unsupported: 'This browser cannot open game connections, try Chrome, Edge, Firefox or Safari',
  full: 'That table is already full',
  started: 'That match has already started, use Rejoin with your Player ID if you were playing',
  'unknown-player': 'That Player ID is not seated in this match, check it and the room code',
  'not-ready': 'The host is reopening the room, try again in a few seconds',
  removed: 'The host removed you from that table',
  network: 'Could not reach the room service, check your connection and try again',
};

const STAGES = {
  direct: 'Connecting directly to the room',
  relay: 'Trying Relay, the route that works on college and office networks',
  'joined-direct': 'Joined directly',
  'joined-relay': 'Joined through Relay',
};

const ROUTE_MODES = [
  { id: 'auto', label: 'Auto', note: 'Recommended' },
  { id: 'direct', label: 'Direct', note: 'Fastest' },
  { id: 'relay', label: 'Relay', note: 'Strict networks' },
];

const CHECK_ROWS = [
  { id: 'service', label: 'Room service' },
  { id: 'direct', label: 'Direct link' },
  { id: 'turn', label: 'Direct through a TURN server' },
  { id: 'relay', label: 'Relay' },
];

const CHECK_WORDS = { ok: 'Open', limited: 'Limited', blocked: 'Blocked' };

// The last seat this device played, so a dropped player finds both codes
// already filled in. Read directly so the room module still loads lazily.
const lastSeat = () => {
  try {
    return JSON.parse(window.localStorage.getItem('catan-seat') || 'null') || {};
  } catch {
    return {};
  }
};

const codeInput = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export default function Lobby({ onBack, onSession, initialPiece = 'red', initialCode = '' }) {
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState(() => codeInput(initialCode));
  const [stage, setStage] = useState('');
  const [mode, setMode] = useState('auto');
  const [check, setCheck] = useState(null); // null | 'running' | results
  const nameRef = useRef(null);
  const [rejoinRoom, setRejoinRoom] = useState(() => lastSeat().code || '');
  const [rejoinId, setRejoinId] = useState(() => lastSeat().playerCode || '');
  const [selectedToken, setSelectedToken] = useState(PIECES[initialPiece] ? initialPiece : 'red');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null); // 'create' | 'join' | 'rejoin' | null

  const selectedPlayer = playerOptions.find((player) => player.id === selectedToken) || playerOptions[0];

  // Someone who arrived through an invite link only needs a name.
  useEffect(() => {
    if (initialCode) nameRef.current?.focus();
  }, [initialCode]);

  const showMessage = (text) => {
    setMessage(text);
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setMessage(''), text.length > 80 ? 6500 : 3600);
  };

  const runCheck = async () => {
    setCheck('running');
    const { runConnectionCheck, checkVerdict } = await import('../../services/connectionCheck');
    const result = await runConnectionCheck();
    setCheck({ ...result, verdict: checkVerdict(result) });
  };

  const nameIsValid = () => {
    if (displayName.trim().length < 2) {
      showMessage('Please enter a display name with at least 2 letters');
      return false;
    }

    return true;
  };

  // The room module (and PeerJS with it) loads only when a room is opened.
  const loadRooms = () => import('../../services/roomSession');

  const createRoom = async () => {
    if (!nameIsValid() || busy) return;

    setBusy('create');

    try {
      const { default: RoomSession } = await loadRooms();
      const session = await RoomSession.host({ name: displayName, pieceKey: selectedToken });
      onSession(session);
    } catch {
      showMessage(JOIN_ERRORS.network);
      setBusy(null);
    }
  };

  const joinRoom = async () => {
    if (!nameIsValid() || busy) return;

    if (roomCode.trim().length !== 6) {
      showMessage('Enter the 6 character room code from your host');
      return;
    }

    setBusy('join');
    setStage('');

    try {
      const { default: RoomSession } = await loadRooms();
      const session = await RoomSession.join({
        code: roomCode,
        name: displayName,
        pieceKey: selectedToken,
        mode,
        onStage: setStage,
      });
      onSession(session);
    } catch (error) {
      setStage('');
      showMessage(JOIN_ERRORS[error.message] || JOIN_ERRORS.network);
      setBusy(null);
    }
  };

  // Back into a match under way with a Player ID. On the device that hosted
  // it, the saved match reopens the room itself; anywhere else it asks the
  // host for the seat.
  const rejoinMatch = async () => {
    if (busy) return;

    if (rejoinRoom.length !== 6 || rejoinId.length !== 6) {
      showMessage('Enter the 6 character room code and your 6 character Player ID');
      return;
    }

    setBusy('rejoin');

    try {
      const { default: RoomSession, savedHostGame } = await loadRooms();
      const hosted = savedHostGame();
      const session =
        hosted && hosted.code === rejoinRoom && hosted.players?.[0]?.code === rejoinId
          ? await RoomSession.resumeHost(hosted)
          : await RoomSession.join({ code: rejoinRoom, rejoin: rejoinId, pieceKey: selectedToken, mode, onStage: setStage });
      onSession(session, { resume: session.startConfig });
    } catch (error) {
      setStage('');
      showMessage(JOIN_ERRORS[error.message] || JOIN_ERRORS.network);
      setBusy(null);
    }
  };

  return (
    <main className="lobby-page">
      <div className="lobby-topbar">
        <button className="lobby-brand" type="button" onClick={onBack} aria-label="Catan home">
          <BrandLogo size={22} />
        </button>

        <div className="topbar-right">
          <ThemeToggle />
          <button className="lobby-back" type="button" onClick={onBack}>
            <span aria-hidden="true">‹</span> Home
          </button>
        </div>
      </div>

      <section className="lobby-layout">
        <div className="lobby-intro">
          <p className="eyebrow">Private game rooms</p>

          <h1>
            Gather your
            <br />
            <em>Inner Circle</em>
          </h1>

          <p>Create a private room where friends can join via a room code</p>

          <ol className="lobby-steps">
            {nextSteps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>

          <div className="lobby-status">
            <span className="status-dot" />
            Private rooms for 2 to 6 players, anywhere in the world
          </div>
        </div>

        <div className="lobby-panel">
          <div className="lobby-panel-heading">
            <span className="panel-number">1</span>

            <div>
              <p className="eyebrow">Your identity</p>
              <h2>Enter the court</h2>
            </div>
          </div>

          <label className="field-label" htmlFor="display-name">
            Display name
          </label>

          <input
            id="display-name"
            ref={nameRef}
            className="lobby-input"
            type="text"
            maxLength="18"
            autoComplete="nickname"
            value={displayName}
            placeholder="What should the table call you?"
            onChange={(event) => setDisplayName(event.target.value)}
          />

          <div className="token-heading">
            <div>
              <p className="field-label">Choose your colour</p>
              <span>If a friend already holds it, you get the next free colour</span>
            </div>

            <span className="selected-token-name">{selectedPlayer.name}</span>
          </div>

          <div className="token-picker">
            {playerOptions.map((player) => (
              <button
                key={player.id}
                type="button"
                className={`token-choice ${selectedToken === player.id ? 'token-choice--selected' : ''}`}
                style={{ '--token-color': player.color, color: player.color }}
                onClick={() => setSelectedToken(player.id)}
                aria-pressed={selectedToken === player.id}
                aria-label={`Choose ${player.name}`}
              >
                <PieceMark piece={player.id} variant="token" />
              </button>
            ))}
          </div>

          <GoldButton onClick={createRoom} loading={busy === 'create'} disabled={Boolean(busy && busy !== 'create')}>
            Create a private room
          </GoldButton>

          <div className="lobby-divider">
            <span>or join a friend's table</span>
          </div>

          <div className="join-room-row">
            <input
              className="lobby-input room-code-input"
              type="text"
              value={roomCode}
              maxLength="6"
              aria-label="Room code"
              autoComplete="off"
              placeholder="Room code"
              onChange={(event) => setRoomCode(codeInput(event.target.value))}
              onKeyDown={(event) => event.key === 'Enter' && joinRoom()}
            />

            <GoldButton variant="ghost" onClick={joinRoom} loading={busy === 'join'} disabled={Boolean(busy && busy !== 'join')}>
              Join room
            </GoldButton>
          </div>

          {stage && busy && (
            <p className={`join-stage ${stage.startsWith('joined') ? 'join-stage--done' : ''}`} role="status" aria-live="polite">
              <span className="join-stage-dot" aria-hidden="true" />
              {STAGES[stage] || stage}
            </p>
          )}

          <div className="lobby-divider">
            <span>or rejoin a match you left</span>
          </div>

          <p className="rejoin-help">
            Your Player ID is shown in the game, enter it with the room code to take back your seat
            with your cards, roads and settlements
          </p>

          <div className="join-room-row rejoin-row">
            <input
              className="lobby-input room-code-input"
              type="text"
              value={rejoinRoom}
              maxLength="6"
              aria-label="Room code to rejoin"
              autoComplete="off"
              placeholder="Room code"
              onChange={(event) => setRejoinRoom(codeInput(event.target.value))}
            />
            <input
              className="lobby-input room-code-input"
              type="text"
              value={rejoinId}
              maxLength="6"
              aria-label="Your Player ID"
              autoComplete="off"
              placeholder="Player ID"
              onChange={(event) => setRejoinId(codeInput(event.target.value))}
              onKeyDown={(event) => event.key === 'Enter' && rejoinMatch()}
            />

            <GoldButton variant="ghost" onClick={rejoinMatch} loading={busy === 'rejoin'} disabled={Boolean(busy && busy !== 'rejoin')}>
              Rejoin
            </GoldButton>
          </div>

          <details className="join-help">
            <summary>Having trouble joining</summary>

            <p>
              Catan connects friends directly, and when a college, office or VPN network blocks that it
              switches to Relay by itself, a secure route over the same port as any website
            </p>

            <span className="field-label">How to connect</span>
            <div className="route-modes" role="radiogroup" aria-label="How to connect">
              {ROUTE_MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.id}
                  className={`route-mode ${mode === option.id ? 'route-mode--selected' : ''}`}
                  onClick={() => setMode(option.id)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.note}</span>
                </button>
              ))}
            </div>

            <button type="button" className="check-button" onClick={runCheck} disabled={check === 'running'}>
              {check === 'running' ? 'Checking your connection' : 'Check connection'}
            </button>

            {check && check !== 'running' && (
              <div className="check-results" role="status">
                <ul>
                  {CHECK_ROWS.map((row) => (
                    <li key={row.id} className={`check-${check[row.id]}`}>
                      <span aria-hidden="true">{check[row.id] === 'ok' ? '✓' : check[row.id] === 'limited' ? '!' : '✕'}</span>
                      {row.label}
                      <em>{CHECK_WORDS[check[row.id]]}</em>
                    </li>
                  ))}
                </ul>
                <p>{check.verdict}</p>
                {check.relays?.length > 0 && (
                  <details className="relay-list">
                    <summary>
                      Relay servers, {check.relays.filter((entry) => entry.ok).length} of {check.relays.length} answered
                    </summary>
                    <ul>
                      {check.relays.map((entry, index) => (
                        <li key={entry.host} className={entry.ok ? 'check-ok' : 'check-blocked'}>
                          Relay {index + 1}
                          <em>{entry.ok ? `${entry.ms} ms` : entry.reason}</em>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <ul className="join-tips">
              <li>Ask the host for the invite link, it opens Catan with the room code filled in</li>
              <li>The host keeps the Catan tab open and the screen on, a phone pauses tabs in the background</li>
              <li>Open the link in Chrome, Safari or Edge, not inside Instagram or WhatsApp</li>
              <li>If nothing works, switch between wifi and mobile data and turn off any VPN</li>
            </ul>
          </details>
        </div>
      </section>

      <div className={`lobby-toast ${message ? 'lobby-toast--visible' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </main>
  );
}
