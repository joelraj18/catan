import { useEffect, useRef, useState } from 'react';
import { PIECES } from '../pages/Game/pieces.jsx';

// "Anu", "Anu and Ravi", "you, Anu and Ravi".
const listNames = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

// Table chat shared by everyone in a private room. System lines (joins,
// the Longest Road changing hands, the winner) are set apart from player messages.
//
// During their turn a player can open a trade talk with the people they
// pick: a Trade tab only those people see, gone when the talk ends.
export default function ChatPanel({
  session,
  title = 'Table chat',
  compact = false,
  canStartTrade = false,
  tradeCandidates = [],
  myPlayerId = null,
}) {
  const [messages, setMessages] = useState(() => session?.chat || []);
  const [tradeChat, setTradeChat] = useState(() => session?.tradeChat || []);
  const [tradeMode, setTradeMode] = useState(() => session?.tradeMode || null);
  const [mode, setMode] = useState('chat');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const me = myPlayerId ?? session?.myPlayerId ?? null;
  const member = Boolean(tradeMode && me && tradeMode.members.includes(me));
  const owner = Boolean(tradeMode && me && tradeMode.owner === me);
  const trading = member && mode === 'trade';
  const shown = trading ? tradeChat : messages;
  const said = shown.filter((message) => !message.system).length;

  useEffect(() => {
    if (!session) {
      return undefined;
    }

    setMessages(session.chat);
    setTradeChat(session.tradeChat || []);
    setTradeMode(session.tradeMode || null);
    const offChat = session.on('chat', (chat) => setMessages(chat));
    const offTradeChat = session.on('trade-chat', (chat) => setTradeChat(chat));
    const offTrade = session.on('trade-mode', (trade) => setTradeMode(trade));
    return () => {
      offChat();
      offTradeChat();
      offTrade();
    };
  }, [session]);

  // Switches to Trade when a trade talk I am in opens, back to Chat after.
  useEffect(() => {
    setMode(member ? 'trade' : 'chat');
    if (!member) setPicking(false);
  }, [member, tradeMode?.id]);

  useEffect(() => {
    const list = listRef.current;

    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
  }, [shown]);

  const nameOf = (id) =>
    id === me
      ? 'you'
      : tradeCandidates.find((entry) => entry.id === id)?.name || session?.players?.find((entry) => entry.id === id)?.name || 'Someone';

  const send = (event) => {
    event.preventDefault();

    if (draft.trim()) {
      if (trading) session?.sendTradeChat(draft);
      else session?.sendChat(draft);
      setDraft('');
    }
  };

  const openPicker = () => {
    setPicked(owner ? tradeMode.members.filter((id) => id !== me) : []);
    setPicking(true);
  };

  const startTrade = (event) => {
    event.preventDefault();
    if (!picked.length) return;
    session?.openTrade(picked);
    setPicking(false);
  };

  const candidates = tradeCandidates.filter((entry) => entry.id !== me);
  const traders = tradeMode ? listNames(tradeMode.members.map(nameOf)) : '';

  return (
    <section
      className={`chat-panel ${compact ? 'chat-panel--compact' : ''} ${trading ? 'chat-panel--trade' : ''}`}
      aria-label={trading ? 'Trade talk' : title}
    >
      <header className="chat-panel-head">
        {member ? (
          <div className="chat-modes" role="tablist" aria-label="Chat or trade talk">
            <button type="button" role="tab" aria-selected={!trading} className={!trading ? 'is-on' : ''} onClick={() => setMode('chat')}>
              Chat
            </button>
            <button type="button" role="tab" aria-selected={trading} className={trading ? 'is-on' : ''} onClick={() => setMode('trade')}>
              🔒 Trade
            </button>
          </div>
        ) : (
          <p className="eyebrow">{title}</p>
        )}
        <span>{said === 1 ? '1 message' : `${said} messages`}</span>
      </header>

      {trading && (
        <p className="chat-trade-banner">
          🔒 Only {traders} can see this — it disappears when the trade talk ends
        </p>
      )}

      {tradeMode && !member && <p className="chat-trade-note">{nameOf(tradeMode.owner)} is in a trade talk</p>}

      {(owner || (canStartTrade && !tradeMode)) && !picking && (
        <div className="chat-trade-bar">
          {owner ? (
            <>
              <button type="button" className="text-link" onClick={openPicker}>
                Add or remove people
              </button>
              <button type="button" className="text-link chat-trade-end" onClick={() => session?.closeTrade()}>
                End trade talk
              </button>
            </>
          ) : (
            <button type="button" className="text-link" onClick={openPicker} disabled={!candidates.length}>
              🔒 Trade talk
            </button>
          )}
        </div>
      )}

      {picking && (owner || canStartTrade) && (
        <form className="chat-trade-pick" onSubmit={startTrade}>
          <fieldset>
            <legend>Who joins the trade talk</legend>
            {candidates.map((entry) => (
              <label key={entry.id} className="chat-trade-person">
                <input
                  type="checkbox"
                  checked={picked.includes(entry.id)}
                  onChange={(event) =>
                    setPicked((current) => (event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id)))
                  }
                />
                <strong style={{ color: PIECES[entry.pieceKey]?.colour }}>{entry.name}</strong>
              </label>
            ))}
          </fieldset>
          <div className="chat-trade-actions">
            <button type="submit" className="chat-trade-go" disabled={!picked.length}>
              {owner ? 'Update trade talk' : 'Start trade talk'}
            </button>
            <button type="button" className="text-link" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <ol className="chat-list" ref={listRef} aria-live="polite">
        {shown.length === 0 && <li className="chat-empty">{trading ? 'Say what you would trade' : 'Say hello to the table'}</li>}

        {shown.map((message) => (
          <li key={message.id} className={message.system ? 'chat-line chat-line--system' : `chat-line ${trading ? 'chat-line--trade' : ''}`}>
            {!message.system && (
              <strong style={{ color: PIECES[message.pieceKey]?.colour }}>{message.name}</strong>
            )}
            <span>{message.text}</span>
          </li>
        ))}
      </ol>

      <form className="chat-form" onSubmit={send}>
        <input
          type="text"
          value={draft}
          maxLength={240}
          placeholder={trading ? 'Message the trade talk' : 'Message the table'}
          aria-label={trading ? 'Trade talk message' : 'Chat message'}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send message">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
          </svg>
        </button>
      </form>
    </section>
  );
}
