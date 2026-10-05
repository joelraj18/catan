import { PREMIUM_MODEL_LABEL, PREMIUM_PROVIDER } from '../services/premiumAi';

// Explains exactly how a premium AI key is handled, so players can decide
// whether to trust the page with it.
export default function ApiKeyInfo({ onClose }) {
  return (
    <div className="key-info-overlay" onClick={onClose}>
      <div
        className="key-info-sheet"
        role="dialog"
        aria-labelledby="key-info-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span className="key-info-shield" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3zM8.8 12.2l2.2 2.2 4.4-4.6" />
            </svg>
          </span>
          <div>
            <p className="eyebrow">Premium AI</p>
            <h3 id="key-info-title">Your API key is safe</h3>
          </div>
          <button type="button" className="property-card-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="key-info-lead">
          Your API key is 100% safe, it is only held in your browser's active memory for this session
          and is never stored, cached or sent anywhere other than the official API provider
        </p>

        <h4>How Manapally keeps that promise</h4>
        <ul>
          <li>The key lives in one in memory variable inside this tab, never in localStorage, sessionStorage, IndexedDB, cookies or the address bar</li>
          <li>It is never sent to other players or to the room service, and Manapally has no server of its own to send it to</li>
          <li>Requests go over HTTPS from your browser straight to api.anthropic.com, the official {PREMIUM_PROVIDER}, using {PREMIUM_MODEL_LABEL}</li>
          <li>The field is masked and cleared the moment you press Use key</li>
          <li>The key is gone when you press Forget key, leave the room, reload or close the tab</li>
          <li>The code is open, see src/services/premiumAi.js in the Manapally repository to check every line</li>
        </ul>

        <h4>Good habits for any key</h4>
        <ul>
          <li>Create a dedicated key with a low spending limit in the Claude Console and revoke it after playing</li>
          <li>If your browser offers to save the key as a password, choose Never</li>
          <li>Browser extensions with access to every site can read what is typed on any page, so play with extensions you trust</li>
        </ul>

        <h4>Prefer not to use a key</h4>
        <p>
          Computer opponents need no key at all, they play with the built in strategy and cost nothing
        </p>
      </div>
    </div>
  );
}
