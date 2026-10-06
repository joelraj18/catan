import { useEffect, useRef, useState } from 'react';
import { PIECES } from '../pages/Game/pieces.jsx';

// Table chat shared by everyone in a private room. System lines (joins,
// the Longest Road changing hands, the winner) are set apart from player messages.
export default function ChatPanel({ session, title = 'Table chat', compact = false }) {
  const [messages, setMessages] = useState(() => session?.chat || []);
  const said = messages.filter((message) => !message.system).length;
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (!session) {
      return undefined;
    }

    setMessages(session.chat);
    return session.on('chat', (chat) => setMessages(chat));
  }, [session]);

  useEffect(() => {
    const list = listRef.current;

    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const send = (event) => {
    event.preventDefault();

    if (draft.trim()) {
      session?.sendChat(draft);
      setDraft('');
    }
  };

  return (
    <section className={`chat-panel ${compact ? 'chat-panel--compact' : ''}`} aria-label={title}>
      <header className="chat-panel-head">
        <p className="eyebrow">{title}</p>
        <span>{said === 1 ? '1 message' : `${said} messages`}</span>
      </header>

      <ol className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && <li className="chat-empty">Say hello to the table</li>}

        {messages.map((message) => (
          <li key={message.id} className={message.system ? 'chat-line chat-line--system' : 'chat-line'}>
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
          placeholder="Message the table"
          aria-label="Chat message"
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
