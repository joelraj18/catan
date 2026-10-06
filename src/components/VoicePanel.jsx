import { useEffect, useState } from 'react';
import { voiceFor, voiceSupported } from '../services/voice/voiceClient';
import { PieceMark } from '../pages/Game/pieces.jsx';
import './voice-panel.css';

// Re-renders when anything about voice changes: the roster, a link coming
// up, someone starting or stopping speaking.
export function useVoice(session) {
  const client = voiceFor(session);
  const [, setTick] = useState(0);
  useEffect(() => client?.on(() => setTick((tick) => tick + 1)), [client]);
  return client;
}

const ROUTE_LABEL = { direct: 'Direct', turn: 'Relay', walkie: 'Walkie-talkie' };
const ROUTE_TITLE = {
  direct: 'Browser to browser, encrypted',
  turn: 'Through a TURN relay on port 443, still encrypted end to end',
  walkie: 'This network blocks live audio: hold Talk and your clip is sent, sealed for this person only',
};

function MicIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function EarIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

// Voice for the table: one shared channel and private channels for any
// few players who want to talk on their own.
export default function VoicePanel({ session, compact = false }) {
  const voice = useVoice(session);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');

  if (!voice) return null;

  const roster = voice.roster || { channels: [], people: {} };
  const me = session.myClientId;
  const people = roster.people || {};
  const others = Object.keys(people).filter((id) => id !== me);
  const inChannel = roster.channels.find((channel) => channel.id === voice.channel);
  const visible = roster.channels.filter((channel) => !channel.invited || channel.invited.includes(me));
  const walkie = voice.walkiePeers().length > 0;
  const supported = voiceSupported();

  const person = (id) => people[id] || { name: id === me ? 'You' : 'Someone', pieceKey: null };

  return (
    <section className={`voice-panel ${compact ? 'voice-panel--compact' : ''}`} aria-label="Voice chat">
      <div className="voice-head">
        <p className="eyebrow">Voice</p>
        {inChannel ? <span className="voice-live">● In {inChannel.name}</span> : <span>{supported ? 'Off' : 'Not available here'}</span>}
      </div>

      {voice.invites.map((invite) => (
        <div key={invite.channel} className="voice-invite" role="status">
          <span>
            <strong>{person(invite.from).name}</strong> invited you to <strong>{invite.name}</strong>
          </span>
          <div>
            <button type="button" className="voice-button voice-button--go" onClick={() => voice.join(invite.channel)}>
              Join
            </button>
            <button type="button" className="text-link" onClick={() => voice.dismissInvite(invite.channel)}>
              Not now
            </button>
          </div>
        </div>
      ))}

      {voice.error && <p className="voice-error">{voice.error}</p>}

      <ul className="voice-channels">
        {visible.map((channel) => {
          const mine = channel.id === voice.channel;
          return (
            <li key={channel.id} className={`voice-channel ${mine ? 'voice-channel--mine' : ''}`}>
              <div className="voice-channel-head">
                <strong>
                  {channel.invited ? '🔒 ' : ''}
                  {channel.name}
                </strong>
                {mine ? (
                  <button type="button" className="voice-button" onClick={() => voice.leave()}>
                    Leave
                  </button>
                ) : (
                  <button type="button" className="voice-button voice-button--go" disabled={!supported} onClick={() => voice.join(channel.id)}>
                    Join
                  </button>
                )}
              </div>
              {channel.members.length > 0 && (
                <ul className="voice-members">
                  {channel.members.map((id) => {
                    const who = person(id);
                    const peer = mine && id !== me ? voice.peers.get(id) : null;
                    const route = peer?.route || (peer ? 'connecting' : null);
                    return (
                      <li key={id} className={`voice-member ${voice.speaking(id) ? 'voice-member--speaking' : ''} ${who.pieceKey ? `seat-${who.pieceKey}` : ''}`}>
                        <span className="voice-avatar">{who.pieceKey && <PieceMark piece={who.pieceKey} variant="token" />}</span>
                        <span className="voice-name">{id === me ? 'You' : who.name}</span>
                        {route && (
                          <span className={`voice-route voice-route--${route}`} title={ROUTE_TITLE[route] || 'Connecting'}>
                            {ROUTE_LABEL[route] || 'Connecting'}
                          </span>
                        )}
                        {peer && peer.mode !== 'walkie' && (
                          <input
                            className="voice-volume"
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={peer.volume}
                            aria-label={`Volume for ${who.name}`}
                            onChange={(event) => voice.setVolume(id, Number(event.target.value))}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {inChannel && (
        <div className="voice-controls">
          <button
            type="button"
            className={`voice-toggle ${voice.muted ? 'voice-toggle--off' : ''}`}
            aria-pressed={voice.muted}
            onClick={() => voice.setMuted(!voice.muted)}
            title={voice.muted ? 'Unmute your microphone' : 'Mute your microphone'}
          >
            <MicIcon off={voice.muted} />
            {voice.muted ? 'Muted' : 'Mic on'}
          </button>
          <button
            type="button"
            className={`voice-toggle ${voice.deafened ? 'voice-toggle--off' : ''}`}
            aria-pressed={voice.deafened}
            onClick={() => voice.setDeafened(!voice.deafened)}
            title={voice.deafened ? 'Hear the channel again' : 'Stop hearing the channel'}
          >
            <EarIcon off={voice.deafened} />
            {voice.deafened ? 'Deafened' : 'Hearing'}
          </button>
          {walkie && (
            <button
              type="button"
              className={`voice-talk ${voice.talking ? 'voice-talk--on' : ''}`}
              onPointerDown={() => voice.startTalking()}
              onPointerUp={() => voice.stopTalking()}
              onPointerLeave={() => voice.talking && voice.stopTalking()}
              onKeyDown={(event) => event.key === ' ' && !event.repeat && voice.startTalking()}
              onKeyUp={(event) => event.key === ' ' && voice.stopTalking()}
            >
              {voice.talking ? 'Talking…' : 'Hold to talk'}
            </button>
          )}
        </div>
      )}

      {supported && others.length > 0 && !creating && (
        <button type="button" className="text-link voice-new" onClick={() => setCreating(true)}>
          + Private channel
        </button>
      )}

      {creating && (
        <form
          className="voice-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!picked.length) return;
            voice.createChannel(name, picked);
            setCreating(false);
            setPicked([]);
            setName('');
          }}
        >
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder="Channel name (optional)"
            aria-label="Channel name"
            onChange={(event) => setName(event.target.value)}
          />
          <fieldset>
            <legend>Who can join</legend>
            {others.map((id) => (
              <label key={id} className={`voice-pick ${people[id].pieceKey ? `seat-${people[id].pieceKey}` : ''}`}>
                <input
                  type="checkbox"
                  checked={picked.includes(id)}
                  onChange={(event) =>
                    setPicked((current) => (event.target.checked ? [...current, id] : current.filter((entry) => entry !== id)))
                  }
                />
                {people[id].pieceKey && <PieceMark piece={people[id].pieceKey} variant="token" />}
                {people[id].name}
              </label>
            ))}
          </fieldset>
          <div className="voice-create-actions">
            <button type="submit" className="voice-button voice-button--go" disabled={!picked.length}>
              Create and join
            </button>
            <button type="button" className="text-link" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
          <p className="voice-note">Only the people you pick can join. Nobody else hears it, the host included.</p>
        </form>
      )}
    </section>
  );
}
